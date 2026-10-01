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
    if (!width || !height || width > 512 || height > 512) throw new Error('PNG dimensions must be 512 × 512 or smaller');
    return png;
}

function makeBadgeRouter(express, file) {
    const router = express.Router();
    const { DatabaseSync } = require('node:sqlite');
    file ||= process.env.CLOUDCORD_BADGE_DB_FILE || path.join(process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share'), 'CloudCord', 'web', 'badges.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(file);
    db.exec('PRAGMA journal_mode=WAL; PRAGMA max_page_count=16384; CREATE TABLE IF NOT EXISTS custom_badges (id TEXT PRIMARY KEY, user_id TEXT NOT NULL, name TEXT NOT NULL, png BLOB NOT NULL); CREATE INDEX IF NOT EXISTS custom_badges_user ON custom_badges(user_id);');
    const publicBadge = row => ({ id: row.id, userId: row.user_id, name: row.name, icon: `https://getcloudcord.com/v1/custom-badges/${row.id}.png` });
    router.get('/v1/custom-badges', (_req, res) => {
        res.set('Cache-Control', 'public, max-age=30').json({ badges: db.prepare('SELECT id, user_id, name FROM custom_badges ORDER BY rowid').all().map(publicBadge) });
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
