'use strict';
// Appeals at /appeal: anyone punished by CloudCord (server ban, mute, warning, app or
// badge blacklist) or staff who were demoted or removed can ask for a review.
// Appellants sign in with the staff-report Discord sign-in (req.session.reportUser),
// can see the status of their own appeals, and management reviews them in /admin.
//
// Optional: CLOUDCORD_APPEALS_WEBHOOK_URL posts a short notice (no appeal text).

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const TYPES = ['Server ban', 'Mute or timeout', 'Warning', 'CloudCord app or badge blacklist', 'Staff demotion', 'Removed from staff', 'Other'];
const STATUSES = ['open', 'reviewing', 'accepted', 'denied'];
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function cleanAppeal(body) {
    const appeal = {
        type: text(body?.type, 60),
        reason: text(body?.reason, 500),
        issuedBy: text(body?.issuedBy, 100),
        happenedAt: text(body?.happenedAt, 60),
        statement: text(body?.statement, 4000),
        evidence: text(body?.evidence, 1500)
    };
    if (!TYPES.includes(appeal.type) || appeal.statement.length < 30) return null;
    return appeal;
}

function makeAppeals({ db, checkStaffAdmin, logAudit, env = process.env, fetchImpl = fetch }) {
    const router = express.Router();
    const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 3, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many appeals. Try again later.' } });
    const webhookUrl = WEBHOOK_RE.test(String(env.CLOUDCORD_APPEALS_WEBHOOK_URL || '')) ? env.CLOUDCORD_APPEALS_WEBHOOK_URL : null;

    const ready = db
        ? db.query(`CREATE TABLE IF NOT EXISTS cloudcord_appeals (
            id UUID PRIMARY KEY,
            user_id TEXT NOT NULL,
            user_name TEXT,
            type TEXT NOT NULL,
            reason TEXT,
            issued_by TEXT,
            happened_at TEXT,
            statement TEXT NOT NULL,
            evidence TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            decision_note TEXT,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at TIMESTAMPTZ)`).catch(error => console.error('[APPEALS] table:', error.message))
        : Promise.resolve();

    async function notify(appeal) {
        if (!webhookUrl) return;
        const content = `**New appeal** · ${appeal.type}\nFrom: **${appeal.userName}**\nReview it in the admin panel.`;
        try {
            await fetchImpl(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
        } catch (error) { console.error('[APPEALS] webhook:', error.message); }
    }

    router.get('/api/appeals/me', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const user = req.session.reportUser;
        if (!user) return res.json({ signedIn: false, types: TYPES });
        let appeals = [];
        if (db) {
            await ready;
            const result = await db.query(`SELECT id, type, status, decision_note, submitted_at, reviewed_at FROM cloudcord_appeals
                WHERE user_id=$1 ORDER BY submitted_at DESC LIMIT 20`, [user.id]).catch(() => ({ rows: [] }));
            appeals = result.rows;
        }
        res.json({ signedIn: true, user: { username: user.username, name: user.name, avatar: user.avatar }, types: TYPES, appeals });
    });

    router.post('/api/appeals', submitLimiter, async (req, res) => {
        if (!db) return res.status(503).json({ error: 'Appeals are temporarily unavailable' });
        const user = req.session.reportUser;
        if (!user) return res.status(401).json({ error: 'Sign in with Discord first' });
        const appeal = cleanAppeal(req.body);
        if (!appeal) return res.status(400).json({ error: 'Choose what you are appealing and explain why in a few sentences' });
        await ready;
        const open = await db.query("SELECT 1 FROM cloudcord_appeals WHERE user_id=$1 AND type=$2 AND status IN ('open','reviewing') LIMIT 1", [user.id, appeal.type]);
        if (open.rows.length) return res.status(409).json({ error: 'You already have an open appeal for this. Wait for a decision.' });
        const id = crypto.randomUUID();
        await db.query(`INSERT INTO cloudcord_appeals (id, user_id, user_name, type, reason, issued_by, happened_at, statement, evidence)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9)`,
        [id, user.id, user.username, appeal.type, appeal.reason || null, appeal.issuedBy || null, appeal.happenedAt || null, appeal.statement, appeal.evidence || null]);
        logAudit('APPEAL_SUBMITTED', req, { type: appeal.type });
        void notify({ ...appeal, userName: user.username });
        res.status(201).json({ id });
    });

    router.get('/api/admin/staff/appeals', checkStaffAdmin, async (req, res) => {
        if (!db) return res.status(503).json({ error: 'Database unavailable' });
        await ready;
        const status = STATUSES.includes(req.query.status) ? req.query.status : 'open';
        const result = await db.query('SELECT * FROM cloudcord_appeals WHERE status=$1 ORDER BY submitted_at DESC LIMIT 200', [status]);
        res.set('Cache-Control', 'private, no-store').json({ appeals: result.rows });
    });

    router.post('/api/admin/staff/appeals/:id/status', checkStaffAdmin, async (req, res) => {
        const status = String(req.body?.status || '');
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const note = text(req.body?.note, 1000);
        await ready;
        const result = await db.query(`UPDATE cloudcord_appeals SET status=$1, decision_note=COALESCE(NULLIF($2,''), decision_note), reviewed_at=NOW()
            WHERE id=$3 RETURNING id`, [status, note, req.params.id]).catch(() => ({ rows: [] }));
        if (!result.rows[0]) return res.status(404).json({ error: 'Appeal not found' });
        logAudit('APPEAL_REVIEWED', req, { appealId: req.params.id, status });
        res.json({ updated: true });
    });

    return router;
}

module.exports = { makeAppeals, cleanAppeal, TYPES };
