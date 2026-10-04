"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const routes = new Map();
const router = { get: (path, handler) => routes.set(path, handler), post: (path, ...handlers) => routes.set(path, handlers.at(-1)), use: (path, handler) => routes.set("AUTH", handler) };
const env = Object.fromEntries(["DATABASE_URL", "CLOUDCORD_DISCORD_CLIENT_ID", "CLOUDCORD_DISCORD_CLIENT_SECRET", "CLOUDCORD_DISCORD_BOT_TOKEN", "CLOUDCORD_DISCORD_GUILD_ID", "CLOUDCORD_DISCORD_REDIRECT_URI", "CLOUDCORD_MEMBERSHIP_SESSION_SECRET"].map(key => [key, "test"]));
delete env.CLOUDCORD_DISCORD_BOT_TOKEN;
delete env.CLOUDCORD_DISCORD_GUILD_ID;
let fetchCount = 0;
const context = {
    module: { exports: {} }, process: { env }, console, URLSearchParams, Date, Map,
    require: name => name === "pg" ? { Pool: class { async query() { return { rowCount: 1, rows: [{ user_id: "123456789012345678", terms_version: "2026-08-27" }] }; } } } : require(name),
    fetch: async () => ({ ok: true, status: 200, json: async () => ++fetchCount === 1 ? { access_token: "limited-test-token" } : { id: "123456789012345678" } })
};
vm.runInNewContext(fs.readFileSync("membership.js", "utf8"), context);
context.module.exports.makeMembershipRouter({ Router: () => router, json: () => () => {} });
const response = () => ({ code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, type() { return this; }, redirect(value) { this.redirected = value; return this; } });
(async () => {
    const start = response();
    await routes.get("/api/cloudcord/onboarding/start")({ body: { accepted: true, termsVersion: "2026-08-27", returnToClient: true } }, start);
    assert.ok(start.body.state);
    assert.equal(new URL(start.body.authorizeUrl).searchParams.get("scope"), "identify");
    const auth = response();
    routes.get("/api/cloudcord/onboarding/authorize/:state")({ params: { state: start.body.state } }, auth);
    assert.equal(new URL(auth.redirected).searchParams.get("state"), start.body.state);
    const callback = response();
    await routes.get("/discord/join/callback")({ query: { state: start.body.state, code: "test" } }, callback);
    assert.equal(callback.redirected, "/upload");
    assert.match(callback.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax/);
    const standalone = response();
    await routes.get("/api/cloudcord/onboarding/start")({ body: { accepted: true, termsVersion: "2026-08-27" } }, standalone);
    fetchCount = 0;
    const mobileCallback = response();
    await routes.get("/discord/join/callback")({ query: { state: standalone.body.state, code: "mobile-test" } }, mobileCallback);
    assert.equal(mobileCallback.redirected, "/upload");
    assert.match(mobileCallback.headers["Set-Cookie"], /HttpOnly; Secure; SameSite=Lax/);
    const cookie = callback.headers["Set-Cookie"].split(";")[0];
    let authorized = false;
    const account = { method: "POST", get: key => ({ cookie, origin: "https://getcloudcord.com" })[key] };
    await routes.get("AUTH")(account, response(), () => authorized = true);
    assert.equal(authorized, true);
    assert.equal(account.badgeUserId, "123456789012345678");
    const crossSite = response();
    await routes.get("AUTH")({ method: "POST", get: key => ({ cookie, origin: "https://other.example" })[key] }, crossSite, () => assert.fail("cross-site cookie write"));
    assert.equal(crossSite.code, 403);
    const status = response();
    routes.get("/api/cloudcord/onboarding/status/:state")({ params: { state: start.body.state } }, status);
    assert.equal(status.body.status, "complete");
    assert.ok(status.body.deviceToken);
    assert.equal(status.headers["Cache-Control"], "no-store");
    const expired = response();
    routes.get("/api/cloudcord/onboarding/authorize/:state")({ params: { state: "invalid" } }, expired);
    assert.equal(expired.code, 400);
    const page = fs.readFileSync("public/join.html", "utf8");
    new vm.Script(page.match(/<script>([\s\S]*?)<\/script>/)[1]);
    assert.match(page, /if \(clientState\).*return;/);
    const script = page.match(/<script>([\s\S]*?)<\/script>/)[1];
    for (const search of ["?complete=1", "?state=test-state"]) {
        const label = {}, listeners = {}, heading = {};
        const terms = { checked: true, closest: () => label, addEventListener: (name, fn) => listeners["terms-" + name] = fn };
        const button = { addEventListener: (name, fn) => listeners["button-" + name] = fn };
        const nodes = { "#terms": terms, "#connect": button, "#status": {}, "#terms-link": {}, h1: heading };
        let requests = 0;
        vm.runInNewContext(script, {
            document: { querySelector: selector => nodes[selector] },
            location: { search, origin: "https://getcloudcord.com" }, URLSearchParams,
            sessionStorage: { getItem: () => null, removeItem() {} }, localStorage: { setItem() {} },
            addEventListener() {}, clearTimeout() {}, setTimeout() {},
            fetch: async url => { requests++; return { json: async () => url.includes("/config") ? { enabled: true, termsVersion: "test" } : { status: "complete", deviceToken: "test" } }; }
        });
        await new Promise(resolve => setImmediate(resolve));
        assert.equal(label.hidden, true);
        assert.equal(terms.disabled, true);
        assert.equal(button.hidden, true);
        assert.equal(button.disabled, true);
        const before = requests;
        listeners["terms-change"]();
        await listeners["button-click"]();
        assert.equal(button.disabled, true);
        assert.equal(requests, before);
    }
    console.log("badge verification handoff passed: valid state, Discord redirect, app-only token, expiry, page syntax");
})().catch(error => { console.error(error); process.exitCode = 1; });
