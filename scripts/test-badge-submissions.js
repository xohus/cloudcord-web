'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const express = require('express');
const moderation = require('../badge-moderation');
// No paid or live API calls in this integration test.
moderation.moderate = async () => ({ status: 'needs_review', message: 'pending review' });
const { makeBadgeRouter } = require('../custom-badges');
const temp = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcord-submission-test-'));
const service = makeBadgeRouter(express, path.join(temp, 'badges.sqlite'));
const app = express(); app.use(express.json());
app.use((req, _res, next) => { if (req.get('authorization') === 'Bearer test') req.badgeUserId = '463515440606609419'; next(); });
app.use(service.router);
const server = app.listen(0, '127.0.0.1', async () => {
    try {
        const url = `http://127.0.0.1:${server.address().port}`;
        const png = 'iVBORw0KGgoAAAANSUhEUgAAAAEAAAABCAQAAAC1HAwCAAAAC0lEQVR42mP8/x8AAwMCAO+jVZkAAAAASUVORK5CYII=';
        assert.equal((await fetch(`${url}/v1/badge-submissions`)).status, 401);
        const r = await fetch(`${url}/v1/badge-submissions`, { method: 'POST', headers: { Authorization: 'Bearer test', 'Content-Type': 'application/json' }, body: JSON.stringify({ name: 'star', png, userId: '1497588725788442637' }) });
        assert.equal(r.status, 202);
        assert.equal((await r.json()).status, 'needs_review');
        const pending = await (await fetch(`${url}/v1/badge-submissions`, { headers: { Authorization: 'Bearer test' } })).json();
        assert.equal(pending.submissions.length, 1);
        assert.equal((await (await fetch(`${url}/v1/custom-badges`)).json()).badges.length, 0);
        assert.equal(pending.submissions[0].png, undefined);
        console.log('submission ownership, authentication and unpublished review queue passed');
    } catch (e) { console.error(e); process.exitCode = 1; }
    finally { server.close(); service.close(); fs.rmSync(temp, { recursive: true, force: true }); }
});
