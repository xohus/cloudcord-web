'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const { makeBadgeRouter } = require('../custom-badges');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcord-badges-test-'));
process.env.CLOUDCORD_BADGE_API_KEY = 'test-secret';
const service = makeBadgeRouter(express, path.join(temp, 'badges.sqlite'));
const app = express(); app.use(express.json({ limit: '1mb' })); app.use(service.router);
const server = app.listen(0, '127.0.0.1', async () => {
    try {
        const base = `http://127.0.0.1:${server.address().port}`;
        const send = (body, key = 'test-secret') => fetch(`${base}/v1/admin/badges`, { method: 'POST', headers: { authorization: `Bearer ${key}`, 'content-type': 'application/json' }, body: JSON.stringify(body) });
        const userId = '100000000000000001';
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jXioAAAAASUVORK5CYII=';
        assert.equal((await send({ action: 'list', userId }, 'wrong')).status, 401);
        assert.equal((await send({ action: 'add', userId, name: 'test', png: 'bad' })).status, 400);
        let response = await send({ action: 'add', userId, name: 'test', png }); assert.equal(response.status, 201);
        const { badge } = await response.json();
        assert.equal((await send({ action: 'edit', userId: '100000000000000002', id: badge.id, name: 'wrong owner' })).status, 404);
        assert.equal((await send({ action: 'edit', userId, id: badge.id, name: 'edited' })).status, 200);
        const catalog = await (await fetch(`${base}/v1/custom-badges`)).json(); assert.equal(catalog.badges[0].name, 'edited'); assert.ok(!('png' in catalog.badges[0]));
        const image = await fetch(`${base}/v1/custom-badges/${badge.id}.png`); assert.equal(image.headers.get('content-type'), 'image/png');
        assert.equal((await send({ action: 'list', userId })).status, 200);
        assert.equal((await send({ action: 'remove', userId, id: badge.id })).status, 200);
        assert.equal((await fetch(`${base}/v1/custom-badges/${badge.id}.png`)).status, 404);
        console.log('badge API auth, PNG validation, add/edit/list/remove and images passed');
    } catch (error) { console.error(error); process.exitCode = 1; }
    finally { server.close(() => { service.close(); fs.rmSync(temp, { recursive: true }); }); }
});
