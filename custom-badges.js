'use strict';
const crypto = require('node:crypto');
const path = require('node:path');
const fs = require('node:fs');
const os = require('node:os');
const rateLimit = require('express-rate-limit');

function validatePng(encoded) {
    if (typeof encoded !== 'string' || encoded.length > 700000 || !/^[A-Za-z0-9+/]+={0,2}$/.test(encoded)) throw new Error('send a PNG under 512 KB');
    const png = Buffer.from(encoded, 'base64');
    if (png.length < 33 || png.length > 512 * 1024 || png.subarray(0, 8).toString('hex') !== '89504e470d0a1a0a' || png.subarray(12, 16).toString() !== 'IHDR') throw new Error('invalid PNG');
    const width = png.readUInt32BE(16), height = png.readUInt32BE(20);
    if (!width || !height || width > 4096 || height > 4096) throw new Error('PNG dimensions are too large; crop or optimize the image first');
    return png;
}

function makeBadgeRouter(express, file) {
    const router = express.Router();
    const { DatabaseSync } = require('node:sqlite');
    file ||= process.env.CLOUDCORD_BADGE_DB_FILE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'CloudCord', 'web', 'badges.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(file);
    db.exec('CREATE TABLE IF NOT EXISTS badge_submissions (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, png BLOB NOT NULL, status TEXT NOT NULL, created_at TEXT NOT NULL);');
    const { RULES, checkName, moderate } = require('./badge-moderation');
    const admin = (req, res, next) => {
        if (req.session?.staffAdmin !== true) return res.status(401).json({ error: 'admin authentication required' });
        if (req.method === 'POST' && req.get('origin') !== 'https://getcloudcord.com') return res.status(403).json({ error: 'invalid request origin' });
        next();
    };
    router.get('/api/admin/badges/submissions', admin, (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ rules: RULES, submissions: db.prepare('SELECT id,user_id,name,status,created_at FROM badge_submissions ORDER BY created_at DESC LIMIT 100').all() });
    });
    router.get('/api/admin/badges/submissions/:id/png', admin, (req, res) => {
        const row = db.prepare('SELECT png FROM badge_submissions WHERE id=?').get(req.params.id);
        if (!row) return res.sendStatus(404);
        res.set('Cache-Control', 'no-store').type('png').send(Buffer.from(row.png));
    });
    router.post('/api/admin/badges/submissions/:id/decision', admin, rateLimit({ windowMs: 60000, limit: 30 }), (req, res) => {
        const action = req.body?.action;
        if (!['approve', 'reject', 'revoke', 'keep'].includes(action)) return res.status(400).json({ error: 'choose keep, reject or revoke' });
        db.exec('BEGIN IMMEDIATE');
        try {
            const row = db.prepare('SELECT * FROM badge_submissions WHERE id=?').get(req.params.id);
            if (!row || (action === 'keep' ? row.status !== 'approved' : action === 'revoke' ? !['approved', 'kept'].includes(row.status) : row.status !== 'needs_review')) {
                db.exec('ROLLBACK'); return res.status(409).json({ error: 'submission is no longer waiting for that decision' });
            }
            if (action === 'approve') {
                if (db.prepare('SELECT COUNT(*) AS count FROM custom_badges WHERE user_id=?').get(row.user_id).count >= 10 || db.prepare('SELECT COUNT(*) AS count FROM custom_badges').get().count >= 1000) {
                    db.exec('ROLLBACK'); return res.status(409).json({ error: 'published badge limit reached' });
                }
                db.prepare('INSERT INTO custom_badges VALUES (?,?,?,?)').run(row.id, row.user_id, `${row.name} · custom`, row.png);
            } else if (action !== 'keep') db.prepare('DELETE FROM custom_badges WHERE id=?').run(row.id);
            const status = action === 'keep' || action === 'approve' ? 'kept' : 'rejected';
            db.prepare('UPDATE badge_submissions SET status=? WHERE id=?').run(status, row.id);
            db.exec('COMMIT'); res.json({ status });
        } catch { db.exec('ROLLBACK'); res.status(500).json({ error: 'could not save decision — try again' }); }
    });
    router.get('/v1/badge-submissions', (req, res) => {
        if (!req.badgeUserId) return res.sendStatus(401);
        res.set('Cache-Control', 'no-store').json({ beta: true, rules: RULES, submissions: db.prepare('SELECT id,name,status,created_at FROM badge_submissions WHERE user_id=? ORDER BY created_at DESC').all(req.badgeUserId), badges: db.prepare('SELECT id,name FROM custom_badges WHERE user_id=? ORDER BY rowid DESC').all(req.badgeUserId) });
    });
    router.post('/v1/badge-submissions/:id/remove', rateLimit({ windowMs: 60000, limit: 20 }), (req, res) => {
        if (!req.badgeUserId) return res.sendStatus(401);
        db.exec('BEGIN IMMEDIATE');
        try {
            const owned = db.prepare('SELECT id FROM custom_badges WHERE id=? AND user_id=?').get(req.params.id, req.badgeUserId);
            if (!owned) { db.exec('ROLLBACK'); return res.status(404).json({ message: 'Badge not found on your account' }); }
            db.prepare('DELETE FROM custom_badges WHERE id=? AND user_id=?').run(req.params.id, req.badgeUserId);
            db.prepare("UPDATE badge_submissions SET status='removed' WHERE id=? AND user_id=?").run(req.params.id, req.badgeUserId);
            db.exec('COMMIT'); res.set('Cache-Control', 'no-store').json({ removed: true });
        } catch { db.exec('ROLLBACK'); res.status(503).json({ message: 'Could not remove badge. Try again.' }); }
    });
    router.post('/v1/badge-submissions', rateLimit({ windowMs: 3600000, limit: 5 }), async (req, res) => {
        res.set('Cache-Control', 'no-store');
        if (!req.badgeUserId) return res.sendStatus(401);
        try {
            if (db.prepare("SELECT COUNT(*) AS count FROM badge_submissions WHERE user_id=? AND status='needs_review'").get(req.badgeUserId).count >= 5) return res.status(409).json({ message: 'Beta limit: 5 pending badges per account' });
            const { name, png } = req.body || {};
            const bytes = validatePng(png);
            const error = checkName(name);
            if (error) return res.status(422).json({ status: 'blocked', message: error });
            const decision = await moderate(name, png);
            if (decision.status !== 'approved') return res.status(decision.status === 'blocked' ? 422 : 503).json(decision);
            db.exec('BEGIN IMMEDIATE');
            try {
                if (db.prepare('SELECT COUNT(*) AS count FROM custom_badges WHERE user_id=?').get(req.badgeUserId).count >= 10 || db.prepare('SELECT COUNT(*) AS count FROM custom_badges').get().count >= 1000) {
                    db.exec('ROLLBACK'); return res.status(409).json({ message: 'published badge limit reached' });
                }
                const id = crypto.randomUUID();
                db.prepare('INSERT INTO badge_submissions VALUES (?,?,?,?,?,?)').run(id, req.badgeUserId, name.trim(), bytes, 'approved', new Date().toISOString());
                db.prepare('INSERT INTO custom_badges VALUES (?,?,?,?)').run(id, req.badgeUserId, `${name.trim()} · custom`, bytes);
                db.exec('COMMIT');
                res.status(201).json({ beta: true, ...decision });
            } catch (error) { db.exec('ROLLBACK'); throw error; }
        } catch { res.status(400).json({ status: 'blocked', message: 'Use a valid PNG under 512 KB. The upload page can optimize your image.' }); }
    });
    db.exec('PRAGMA journal_mode=WAL; PRAGMA max_page_count=16384; CREATE TABLE IF NOT EXISTS custom_badges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, png BLOB NOT NULL); CREATE INDEX IF NOT EXISTS custom_badges_user ON custom_badges(user_id);');
    const publicBadge = row => ({ id: row.id, userId: row.user_id, name: row.name, icon: `https://getcloudcord.com/v1/custom-badges/${row.id}.png` });
    router.get('/v1/custom-badges', (_req, res) => {
        res.set('Cache-Control', 'no-store').json({ badges: db.prepare('SELECT id, user_id, name FROM custom_badges ORDER BY rowid').all().map(publicBadge) });
    });
    router.get('/v1/custom-badges/:image', (req, res) => {
        const id = req.params.image.replace(/\.png$/, '');
        if (!/^[a-f0-9-]{36}$/.test(id)) return res.sendStatus(404);
        const row = db.prepare('SELECT png FROM custom_badges WHERE id = ?').get(id);
        if (!row) return res.sendStatus(404);
        res.set('Cache-Control', 'public, max-age=30').type('png').send(Buffer.from(row.png));
    });
    router.post('/v1/admin/badges', rateLimit({ windowMs: 60000, limit: 60, standardHeaders: true, legacyHeaders: false }), (req, res) => {
        const expected = process.env.CLOUDCORD_BADGE_API_KEY || '';
        const supplied = (req.get('authorization') || '').replace(/^Bearer\s+/i, '');
        const a = Buffer.from(expected), b = Buffer.from(supplied);
        if (!a.length || a.length !== b.length || !crypto.timingSafeEqual(a, b)) return res.sendStatus(401);
        try {
            const { action, userId, id, name, png } = req.body || {};
            if (!/^\d{15,22}$/.test(userId || '')) return res.status(400).json({ error: 'invalid user id' });
            if (action === 'list') return res.json({ badges: db.prepare('SELECT id, user_id, name FROM custom_badges WHERE user_id = ?').all(userId).map(publicBadge) });
            if (action === 'remove') {
                const deleted = db.prepare('DELETE FROM custom_badges WHERE id = ? AND user_id = ?').run(String(id), userId);
                return res.status(deleted.changes ? 200 : 404).json({ removed: Boolean(deleted.changes) });
            }
            if (!['add', 'edit'].includes(action)) return res.status(400).json({ error: 'invalid action' });
            if (name !== undefined && (typeof name !== 'string' || !name.trim() || name.length > 80)) return res.status(400).json({ error: 'badge name must be 1–80 characters' });
            if (action === 'add') {
                if (!name || !png) return res.status(400).json({ error: 'name and PNG required' });
                if (db.prepare('SELECT COUNT(*) AS total FROM custom_badges').get().total >= 1000 || db.prepare('SELECT COUNT(*) AS total FROM custom_badges WHERE user_id = ?').get(userId).total >= 10) return res.status(409).json({ error: 'badge quota reached' });
                const badgeId = crypto.randomUUID();
                db.prepare('INSERT INTO custom_badges VALUES (?, ?, ?, ?)').run(badgeId, userId, name.trim(), validatePng(png));
                return res.status(201).json({ badge: publicBadge({ id: badgeId, user_id: userId, name: name.trim() }) });
            }
            const current = db.prepare('SELECT * FROM custom_badges WHERE id = ? AND user_id = ?').get(String(id), userId);
            if (!current) return res.sendStatus(404);
            if (name === undefined && png === undefined) return res.status(400).json({ error: 'choose a new name or PNG' });
            db.prepare('UPDATE custom_badges SET name = ?, png = ? WHERE id = ?').run(name?.trim() || current.name, png === undefined ? current.png : validatePng(png), id);
            res.json({ badge: publicBadge({ ...current, name: name?.trim() || current.name }) });
        } catch (error) { res.status(400).json({ error: error.message }); }
    });
    return { router, close: () => db.close() };
}
module.exports = { makeBadgeRouter, validatePng };
