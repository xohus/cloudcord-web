"use strict";
const fs = require("node:fs");
const vm = require("node:vm");
const assert = require("node:assert/strict");
const server = fs.readFileSync("server.js", "utf8");
assert.ok(server.indexOf("app.use(session({") < server.indexOf("app.use(require('./custom-badges')"), "Session middleware must run before badge routes");
assert.equal(server.split("app.use(require('./custom-badges')").length, 2, "Mount badge router once");
const source = fs.readFileSync("custom-badges.js", "utf8");
const guard = source.slice(source.indexOf("    const admin ="), source.indexOf("    router.get('/api/admin/badges/submissions'"));
const context = vm.createContext({});
vm.runInContext(guard + "\nthis.guard = admin;", context);
function response() { return { code: 200, status(code) { this.code = code; return this; }, json(body) { this.body = body; return this; } }; }
for (const session of [undefined, {}, { staffAdmin: false }]) {
    const res = response();
    context.guard({ session, method: "GET" }, res, () => assert.fail("Unauthenticated review allowed"));
    assert.equal(res.code, 401);
}
for (const method of ["GET", "POST"]) {
    let allowed = false;
    context.guard({ session: { staffAdmin: true }, method, get: () => "https://getcloudcord.com" }, response(), () => allowed = true);
    assert.ok(allowed, "Logged-in admin can read and decide on badges");
}
const crossSite = response();
context.guard({ session: { staffAdmin: true }, method: "POST", get: () => "https://other.example" }, crossSite, () => assert.fail("Cross-site decision allowed"));
assert.equal(crossSite.code, 403);
console.log("badge admin auth passed: middleware order, logged-in review, anonymous rejection and cross-site protection");
