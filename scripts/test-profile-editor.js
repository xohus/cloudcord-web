"use strict";
const fs = require("node:fs"), vm = require("node:vm"), assert = require("node:assert/strict");
const server = fs.readFileSync("server.js", "utf8"), routes = new Map();
const original = { bio: "keep my bio", badgeFlags: 8, avatar: "https://example.com/old.png", banner: "https://example.com/banner.png" };
let saved;
const context = {
    app: { get: (path, ...handlers) => routes.set("GET " + path, handlers.at(-1)), post: (path, ...handlers) => routes.set("POST " + path, handlers.at(-1)) },
    profileReadLimiter() {}, profileWriteLimiter() {}, profileHandler: fn => fn,
    realCordDb: null, profileTableReady: Promise.resolve(),
    localProfiles: { create: (id, owner, profile) => { saved = { id, owner, profile }; return { id }; } },
    latestProfileForOwner: async () => ({ profile: original }),
    crypto: require("node:crypto"), hashProfileToken: value => value, Date, Buffer
};
vm.runInNewContext(server.slice(server.indexOf("app.get('/api/cloudcord/profile'"), server.indexOf("app.get('/v1/profiles/user")), context);
const res = () => ({ statusCode: 200, status(value) { this.statusCode = value; return this; }, sendStatus(value) { this.statusCode = value; return this; }, json(value) { this.body = value; return this; }, set() { return this; } });
(async () => {
    const response = res();
    await routes.get("POST /api/cloudcord/profile")({ badgeUserId: "123456789012345678", body: { ownerId: "someone-else", avatar: "data:image/jpeg;base64,/9j/AA==" } }, response);
    assert.equal(response.body.saved, true);
    assert.equal(saved.owner, "123456789012345678");
    assert.equal(saved.profile.bio, original.bio);
    assert.equal(saved.profile.banner, original.banner);
    assert.equal(saved.profile.badgeFlags, 8);
    assert.equal(original.avatar, "https://example.com/old.png");
    const invalid = res();
    await routes.get("POST /api/cloudcord/profile")({ badgeUserId: "123456789012345678", body: { avatar: "data:image/svg+xml;base64,AA==" } }, invalid);
    assert.equal(invalid.statusCode, 400);
    const unauthorized = res();
    await routes.get("POST /api/cloudcord/profile")({ body: { avatar: "anything" } }, unauthorized);
    assert.equal(unauthorized.statusCode, 401);
    new vm.Script(fs.readFileSync("public/profile-editor.js", "utf8"));
    console.log("profile editor checks passed: verified owner only, preserves other fields, rejects SVG, requires verification");
})().catch(error => { console.error(error); process.exitCode = 1; });
