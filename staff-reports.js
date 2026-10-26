'use strict';
// Staff reports. Two forms share one store:
//   /report-staff   anyone signed in with Discord can report a staff member.
//   /staff/reports  staff only: report another staff member (inactivity, procedure, ...).
// Reporters sign in with Discord (identify scope only) so reports can't be spammed
// anonymously. Staff are members holding a role in CLOUDCORD_STAFF_ROLE_IDS, or anyone
// with an accepted staff application. Reviews use the existing staff admin session.
//
// Optional: CLOUDCORD_STAFF_REPORTS_WEBHOOK_URL posts a short notice (no report text).

const crypto = require('crypto');
const express = require('express');
const rateLimit = require('express-rate-limit');

const CATEGORIES = {
    public: ['Abuse of power', 'Rude or disrespectful', 'Unfair punishment', 'Leaking or privacy', 'Scam or impersonation', 'Other'],
    internal: ['Inactivity', 'Not following procedures', 'Abuse of permissions', 'Leaking', 'Conflict or behaviour', 'Other']
};
const STATUSES = ['open', 'reviewing', 'resolved', 'dismissed'];
const PAGES = { public: '/report-staff', internal: '/staff/reports' };
const STAFF_CHECK_MS = 5 * 60 * 1000;
const WEBHOOK_RE = /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/;

const text = (value, max) => typeof value === 'string' ? value.trim().slice(0, max) : '';

function cleanReport(body, kind) {
    const report = {
        subject: text(body?.subject, 100),
        subjectId: text(body?.subjectId, 22),
        category: text(body?.category, 60),
        details: text(body?.details, 4000),
        evidence: text(body?.evidence, 1500),
        happenedAt: text(body?.happenedAt, 60)
    };
    if (!report.subject || report.details.length < 20 || !CATEGORIES[kind].includes(report.category)) return null;
    if (report.subjectId && !/^\d{15,22}$/.test(report.subjectId)) return null;
    return report;
}

function makeStaffReports({ db, botRequest, checkStaffAdmin, timingSafeTextEqual, logAudit, env = process.env, fetchImpl = fetch }) {
    const router = express.Router();
    const submitLimiter = rateLimit({ windowMs: 60 * 60 * 1000, limit: 5, standardHeaders: 'draft-7', legacyHeaders: false, message: { error: 'Too many reports. Try again later.' } });
    const authLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 20, standardHeaders: 'draft-7', legacyHeaders: false });
    // Reuses the staff application's Discord redirect, so no new redirect URL has to be registered.
    const redirectUri = env.CLOUDCORD_STAFF_REDIRECT_URI || 'https://getcloudcord.com/staff-application/callback';
    const staffRoles = new Set(String(env.CLOUDCORD_STAFF_ROLE_IDS || '').split(/[\s,]+/).filter(Boolean));
    const webhookUrl = WEBHOOK_RE.test(String(env.CLOUDCORD_STAFF_REPORTS_WEBHOOK_URL || '')) ? env.CLOUDCORD_STAFF_REPORTS_WEBHOOK_URL : null;

    const ready = db
        ? db.query(`CREATE TABLE IF NOT EXISTS cloudcord_staff_reports (
            id UUID PRIMARY KEY,
            kind TEXT NOT NULL,
            reporter_id TEXT NOT NULL,
            reporter_name TEXT,
            subject TEXT NOT NULL,
            subject_id TEXT,
            category TEXT NOT NULL,
            details TEXT NOT NULL,
            evidence TEXT,
            happened_at TEXT,
            status TEXT NOT NULL DEFAULT 'open',
            review_note TEXT,
            submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            reviewed_at TIMESTAMPTZ)`).catch(error => console.error('[STAFF REPORTS] table:', error.message))
        : Promise.resolve();

    async function isStaff(userId) {
        const guildId = String(env.CLOUDCORD_DISCORD_GUILD_ID || '');
        if (guildId && staffRoles.size && env.CLOUDCORD_DISCORD_BOT_TOKEN) {
            try {
                const response = await botRequest(`/guilds/${encodeURIComponent(guildId)}/members/${encodeURIComponent(userId)}`);
                if (response.ok) {
                    const member = await response.json();
                    if ((member.roles || []).some(role => staffRoles.has(String(role)))) return true;
                }
            } catch (error) { console.error('[STAFF REPORTS] role check:', error.message); }
        }
        if (!db) return false;
        try {
            const result = await db.query("SELECT 1 FROM cloudcord_staff_applications WHERE discord_user_id=$1 AND status='accepted' LIMIT 1", [userId]);
            return result.rows.length > 0;
        } catch { return false; }
    }

    async function staffFor(req) {
        const user = req.session.reportUser;
        if (!user) return false;
        if (user.staffCheckedAt && Date.now() - user.staffCheckedAt < STAFF_CHECK_MS) return user.isStaff === true;
        user.isStaff = await isStaff(user.id);
        user.staffCheckedAt = Date.now();
        return user.isStaff;
    }

    async function notify(report) {
        if (!webhookUrl) return;
        const where = report.kind === 'internal' ? 'Internal staff report' : 'Public staff report';
        const content = `**${where}** · ${report.category}\nAbout: **${report.subject}**\nReview it in the admin panel.`;
        try {
            await fetchImpl(webhookUrl, { method: 'POST', headers: { 'content-type': 'application/json' }, body: JSON.stringify({ content, allowed_mentions: { parse: [] } }) });
        } catch (error) { console.error('[STAFF REPORTS] webhook:', error.message); }
    }

    router.get('/staff-reports/login', authLimiter, (req, res) => {
        const back = req.query.next === 'internal' ? 'internal' : 'public';
        const clientId = env.CLOUDCORD_DISCORD_CLIENT_ID;
        if (!clientId || !env.CLOUDCORD_DISCORD_CLIENT_SECRET) return res.redirect(`${PAGES[back]}?error=signin_unavailable`);
        const state = crypto.randomBytes(24).toString('base64url');
        req.session.staffReportLogin = { state, back, createdAt: Date.now() };
        const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state });
        res.redirect(`https://discord.com/oauth2/authorize?${query}`);
    });

    async function handleCallback(req, res) {
        const pending = req.session.staffReportLogin;
        delete req.session.staffReportLogin;
        const back = PAGES[pending?.back] || PAGES.public;
        if (req.query.error) return res.redirect(`${back}?error=signin_denied`);
        if (!pending || Date.now() - Number(pending.createdAt) > 15 * 60 * 1000 || !timingSafeTextEqual(req.query.state || '', pending.state) || !req.query.code) return res.redirect(`${back}?error=signin_expired`);
        try {
            const tokenResponse = await fetchImpl('https://discord.com/api/v10/oauth2/token', {
                method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
                body: new URLSearchParams({ client_id: env.CLOUDCORD_DISCORD_CLIENT_ID, client_secret: env.CLOUDCORD_DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri })
            });
            if (!tokenResponse.ok) throw new Error(`token ${tokenResponse.status}`);
            const token = await tokenResponse.json();
            const userResponse = await fetchImpl('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
            if (!userResponse.ok) throw new Error(`identity ${userResponse.status}`);
            const user = await userResponse.json();
            const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.png?size=64` : null;
            req.session.reportUser = { id: String(user.id), username: user.username, name: user.global_name || user.username, avatar };
            req.session.save(() => res.redirect(back));
        } catch (error) {
            console.error('[STAFF REPORTS OAUTH]', error.message);
            res.redirect(`${back}?error=signin_failed`);
        }
    }

    router.post('/api/staff-reports/logout', (req, res) => {
        delete req.session.reportUser;
        req.session.save(() => res.json({ signedIn: false }));
    });

    router.get('/api/staff-reports/me', async (req, res) => {
        res.set('Cache-Control', 'private, no-store');
        const user = req.session.reportUser;
        if (!user) return res.json({ signedIn: false, categories: CATEGORIES, admin: req.session.staffAdmin === true });
        const staff = await staffFor(req);
        res.json({ signedIn: true, user: { username: user.username, name: user.name, avatar: user.avatar }, staff, admin: req.session.staffAdmin === true, categories: CATEGORIES });
    });

    router.post('/api/staff-reports', submitLimiter, async (req, res) => {
        if (!db) return res.status(503).json({ error: 'Reports are temporarily unavailable' });
        const user = req.session.reportUser;
        if (!user) return res.status(401).json({ error: 'Sign in with Discord first' });
        const kind = req.body?.kind === 'internal' ? 'internal' : 'public';
        if (kind === 'internal' && !(await staffFor(req))) return res.status(403).json({ error: 'Only CloudCord staff can file internal reports' });
        const report = cleanReport(req.body, kind);
        if (!report) return res.status(400).json({ error: 'Fill in who, the category, and at least a couple of sentences of details' });
        if (report.subjectId && report.subjectId === user.id) return res.status(400).json({ error: "You can't report yourself" });
        await ready;
        const id = crypto.randomUUID();
        await db.query(`INSERT INTO cloudcord_staff_reports (id, kind, reporter_id, reporter_name, subject, subject_id, category, details, evidence, happened_at)
            VALUES ($1,$2,$3,$4,$5,$6,$7,$8,$9,$10)`,
        [id, kind, user.id, user.username, report.subject, report.subjectId || null, report.category, report.details, report.evidence || null, report.happenedAt || null]);
        logAudit('STAFF_REPORT_SUBMITTED', req, { kind, category: report.category });
        void notify({ ...report, kind });
        res.status(201).json({ id });
    });

    router.get('/api/admin/staff/reports', checkStaffAdmin, async (req, res) => {
        if (!db) return res.status(503).json({ error: 'Database unavailable' });
        await ready;
        const status = STATUSES.includes(req.query.status) ? req.query.status : 'open';
        const kind = ['public', 'internal'].includes(req.query.kind) ? req.query.kind : null;
        const result = await db.query(`SELECT * FROM cloudcord_staff_reports WHERE status=$1 AND ($2::text IS NULL OR kind=$2)
            ORDER BY submitted_at DESC LIMIT 200`, [status, kind]);
        res.set('Cache-Control', 'private, no-store').json({ reports: result.rows });
    });

    router.post('/api/admin/staff/reports/:id/status', checkStaffAdmin, async (req, res) => {
        const status = String(req.body?.status || '');
        if (!STATUSES.includes(status)) return res.status(400).json({ error: 'Invalid status' });
        const note = text(req.body?.note, 1000);
        await ready;
        const result = await db.query(`UPDATE cloudcord_staff_reports SET status=$1, review_note=COALESCE(NULLIF($2,''), review_note), reviewed_at=NOW()
            WHERE id=$3 RETURNING id`, [status, note, req.params.id]).catch(() => ({ rows: [] }));
        if (!result.rows[0]) return res.status(404).json({ error: 'Report not found' });
        logAudit('STAFF_REPORT_REVIEWED', req, { reportId: req.params.id, status });
        res.json({ updated: true });
    });

    // server.js calls this from /staff-application/callback when a report sign-in is pending.
    router.handleCallback = handleCallback;
    return router;
}

module.exports = { makeStaffReports, cleanReport, CATEGORIES };
