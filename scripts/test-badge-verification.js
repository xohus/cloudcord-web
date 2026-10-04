"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const routes = new Map();
const router = { get: (path, handler) => routes.set(path, handler), post: (path, ...handlers) => routes.set(path, handlers.at(-1)), use() {} };
const env = Object.fromEntries(["DATABASE_URL", "CLOUDCORD_DISCORD_CLIENT_ID", "CLOUDCORD_DISCORD_CLIENT_SECRET", "CLOUDCORD_DISCORD_BOT_TOKEN", "CLOUDCORD_DISCORD_GUILD_ID", "CLOUDCORD_DISCORD_REDIRECT_URI", "CLOUDCORD_MEMBERSHIP_SESSION_SECRET"].map(key => [key, "test"]));
let fetchCount = 0;
const context = {
    module: { exports: {} }, process: { env }, console, URLSearchParams, Date, Map,
    require: name => name === "pg" ? { Pool: class { async query() { return { rowCount: 1, rows: [] }; } } } : require(name),
    fetch: async () => ({ ok: true, status: 200, json: async () => ++fetchCount === 1 ? { access_token: "limited-test-token" } : { id: "123456789012345678" } })
};
vm.runInNewContext(fs.readFileSync("membership.js", "utf8"), context);
context.module.exports.makeMembershipRouter({ Router: () => router, json: () => () => {} });
const response = () => ({ code: 200, headers: {}, set(key, value) { this.headers[key] = value; return this; }, status(code) { this.code = code; return this; }, json(value) { this.body = value; return this; }, send(value) { this.body = value; return this; }, type() { return this; }, redirect(value) { this.redirected = value; return this; } });
(async () => {
    const start = response();
    await routes.get("/api/cloudcord/onboarding/start")({ body: { accepted: true, termsVersion: "2026-08-27", returnToClient: true } }, start);
    assert.ok(start.body.state);
    const auth = response();
    routes.get("/api/cloudcord/onboarding/authorize/:state")({ params: { state: start.body.state } }, auth);
    assert.equal(new URL(auth.redirected).searchParams.get("state"), start.body.state);
    const callback = response();
    await routes.get("/discord/join/callback")({ query: { state: start.body.state, code: "test" } }, callback);
    assert.equal(callback.redirected, "/badges/verify?complete=1");
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
    console.log("badge verification handoff passed: valid state, Discord redirect, app-only token, expiry, page syntax");
})().catch(error => { console.error(error); process.exitCode = 1; });
