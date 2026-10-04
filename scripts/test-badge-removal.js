"use strict";
const fs = require("node:fs"), os = require("node:os"), path = require("node:path"), assert = require("node:assert/strict");
const { DatabaseSync } = require("node:sqlite");
const routes = new Map(), router = { get: (url, ...handlers) => routes.set("GET " + url, handlers.at(-1)), post: (url, ...handlers) => routes.set("POST " + url, handlers.at(-1)) };
const dir = fs.mkdtempSync(path.join(os.tmpdir(), "cloudcord-badge-test-")), file = path.join(dir, "badges.sqlite");
const service = require("../custom-badges").makeBadgeRouter({ Router: () => router }, file);
const db = new DatabaseSync(file);
db.prepare("INSERT INTO custom_badges VALUES (?,?,?,?)").run("test-badge", "owner", "My Badge", Buffer.from("test"));
const response = () => ({ code: 200, status(value) { this.code = value; return this; }, sendStatus(value) { this.code = value; return this; }, set() { return this; }, json(value) { this.body = value; return this; } });
try {
    const remove = routes.get("POST /v1/badge-submissions/:id/remove");
    const denied = response();
    remove({ badgeUserId: "someone-else", params: { id: "test-badge" } }, denied);
    assert.equal(denied.code, 404);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM custom_badges").get().count, 1);
    const list = response();
    routes.get("GET /v1/badge-submissions")({ badgeUserId: "owner" }, list);
    assert.equal(list.body.badges.length, 1);
    const own = response();
    remove({ badgeUserId: "owner", params: { id: "test-badge" } }, own);
    assert.equal(own.body.removed, true);
    assert.equal(db.prepare("SELECT COUNT(*) AS count FROM custom_badges").get().count, 0);
    console.log("badge removal checks passed: own badges listed, cross-account removal blocked, owner removal saved");
} finally { db.close(); service.close(); for (const name of fs.readdirSync(dir)) fs.unlinkSync(path.join(dir, name)); fs.rmdirSync(dir); }
