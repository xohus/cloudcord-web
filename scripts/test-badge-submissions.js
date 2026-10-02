'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const moderation = require('../badge-moderation');
// No paid or live API calls in this integration test.
moderation.moderate = async () => ({ status: 'approved', message: 'AI approved' });
const { makeBadgeRouter } = require('../custom-badges');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcord-submission-test-'));
const service = makeBadgeRouter(express, path.join(temp, 'badges.sqlite'));
const app = express(); app.use(express.json());
app.use((req, _res, next) => { if (req.get('authorization') === 'Bearer test') req.badgeUserId = '463515440606609419'; if (req.get('authorization') === 'Bearer admin-test') req.session = { staffAdmin: true }; next(); });
app.use(service.router);
const server = app.listen(0, '127.0.0.1', async () => {
    try {
        const url = `http://127.0.0.1:${server.address().port}`;
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
        assert.equal((await fetch(`${url}/v1/badge-submissions`)).status, 401);
        const r = await fetch(`${url}/v1/badge-submissions`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'star', png, userId: '1497588725788442637' }) });
        assert.equal(r.status, 201);
        assert.equal((await r.json()).status, 'approved');
        const pending = await (await fetch(`${url}/v1/badge-submissions`, { headers: { Authorization: 'Bearer test' } })).json();
        assert.equal(pending.submissions.length, 1);
        assert.equal((await (await fetch(`${url}/v1/custom-badges`)).json()).badges.length, 1);
        assert.equal(pending.submissions[0].png, undefined);
        const id = pending.submissions[0].id;
        assert.equal((await fetch(`${url}/api/admin/badges/submissions`)).status, 401);
        const decision = (action, origin = 'https://getcloudcord.com') => fetch(`${url}/api/admin/badges/submissions/${id}/decision`, { method: 'POST', headers: { Authorization: 'Bearer admin-test', Origin: origin, 'Content-Type': 'application/json' }, body: JSON.stringify({ action }) });
        assert.equal((await decision('keep', 'https://evil.example')).status, 403);
        assert.equal((await decision('keep')).status, 200);
        const published = (await (await fetch(`${url}/v1/custom-badges`)).json()).badges;
        assert.equal(published.length, 1);
        assert.equal(published[0].userId, '463515440606609419');
        assert.ok(published[0].name.endsWith(' · custom'));
        assert.equal((await decision('approve')).status, 409);
        assert.equal((await decision('revoke')).status, 200);
        assert.equal((await (await fetch(`${url}/v1/custom-badges`)).json()).badges.length, 0);
        console.log('AI-approved publication, ownership, admin keep/delete and CSRF checks passed');
    } catch (e) { console.error(e); process.exitCode = 1; }
    finally { server.close(); service.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
