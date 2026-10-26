'use strict';
// Profile templates: someone publishes a copy of their CloudCord profile and
// others apply it or add it to their Saved profiles. Public ones form the
// template gallery (getcloudcord.com/templates and the in-app Templates tab).
//   public   - listed in /v1/shares and readable by anyone
//   unlisted - readable by anyone with the link, never listed
//   private  - readable only with the share's edit token (a personal cloud copy)
const crypto = require('node:crypto');
const express = require('express');

const VISIBILITIES = new Set(['public', 'unlisted', 'private']);
const CATEGORIES = ['Aesthetic', 'Anime', 'Gaming', 'Minimal', 'Dark', 'Cute', 'Funny', 'Other'];
const SORTS = new Set(['popular', 'new']);
const MAX_PROFILE_BYTES = 1536 * 1024;
const CODE_ALPHABET = 'abcdefghijkmnpqrstuvwxyzABCDEFGHJKLMNPQRSTUVWXYZ23456789';

const validOwnerId = value => /^\d{15,22}$/.test(String(value || ''));
const validCode = value => /^[A-Za-z0-9]{6,16}$/.test(String(value || ''));
const hashToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');
const bearer = req => String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');

function newCode() {
    const bytes = crypto.randomBytes(8);
    return Array.from(bytes, byte => CODE_ALPHABET[byte % CODE_ALPHABET.length]).join('');
}

function cleanName(value) {
    return String(value || '').replace(/[\u0000-\u001f\u007f]/g, '').trim().slice(0, 60);
}

/** Small, safe summary for lists and the share page. */
function previewOf(profile) {
    const https = value => typeof value === 'string' && /^https:\/\//i.test(value) ? value.slice(0, 2048) : '';
    const color = value => typeof value === 'number' && Number.isFinite(value) ? '#' + (value >>> 0 & 0xffffff).toString(16).padStart(6, '0')
        : typeof value === 'string' && /^#[0-9a-f]{6}$/i.test(value) ? value : '';
    return {
        name: String(profile?.globalName || profile?.displayName || profile?.username || '').slice(0, 64),
        username: String(profile?.username || '').slice(0, 64),
        avatar: https(profile?.avatar),
        banner: https(profile?.banner),
        bio: String(profile?.bio || '').slice(0, 300),
        accent: color(profile?.accentColor ?? profile?.primaryColor)
    };
}

/** Postgres store (production) or node:sqlite (local testing). */
function makeStore({ db, sqliteFile }) {
    if (db) {
        const ready = db.query(`CREATE TABLE IF NOT EXISTS cloudcord_profile_shares (
            id TEXT PRIMARY KEY,
            owner_id TEXT NOT NULL,
            name TEXT NOT NULL,
            visibility TEXT NOT NULL,
            profile JSONB NOT NULL,
            edit_token_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
        )`).then(() => db.query('CREATE INDEX IF NOT EXISTS cloudcord_profile_shares_public_idx ON cloudcord_profile_shares (visibility, updated_at DESC)'))
            .then(() => db.query("ALTER TABLE cloudcord_profile_shares ADD COLUMN IF NOT EXISTS category TEXT NOT NULL DEFAULT 'Other', ADD COLUMN IF NOT EXISTS description TEXT NOT NULL DEFAULT '', ADD COLUMN IF NOT EXISTS uses INTEGER NOT NULL DEFAULT 0"));
        return {
            ready,
            get: async id => (await db.query('SELECT id, owner_id, name, visibility, profile, edit_token_hash, category, description, uses, updated_at FROM cloudcord_profile_shares WHERE id = $1', [id])).rows[0] || null,
            listPublic: async ({ limit, offset, q, category, sort }) => (await db.query(`SELECT id, owner_id, name, profile, category, description, uses, updated_at FROM cloudcord_profile_shares
                WHERE visibility = 'public' AND ($2::text IS NULL OR category = $2) AND ($3::text IS NULL OR name ILIKE $3 OR description ILIKE $3)
                ORDER BY ${sort === 'popular' ? 'uses DESC, updated_at DESC' : 'updated_at DESC'} LIMIT $1 OFFSET $4`, [limit, category, q ? `%${q.replace(/[%_\\]/g, '\\$&')}%` : null, offset])).rows,
            insert: (row) => db.query('INSERT INTO cloudcord_profile_shares (id, owner_id, name, visibility, profile, edit_token_hash, category, description) VALUES ($1, $2, $3, $4, $5, $6, $7, $8)', [row.id, row.owner_id, row.name, row.visibility, row.profile, row.edit_token_hash, row.category, row.description]),
            update: (id, row) => db.query('UPDATE cloudcord_profile_shares SET name = $2, visibility = $3, profile = $4, category = $5, description = $6, updated_at = NOW() WHERE id = $1', [id, row.name, row.visibility, row.profile, row.category, row.description]),
            use: id => db.query("UPDATE cloudcord_profile_shares SET uses = uses + 1 WHERE id = $1 AND visibility <> 'private'", [id]),
            remove: id => db.query('DELETE FROM cloudcord_profile_shares WHERE id = $1', [id])
        };
    }
    const { DatabaseSync } = require('node:sqlite');
    require('node:fs').mkdirSync(require('node:path').dirname(sqliteFile), { recursive: true });
    const sqlite = new DatabaseSync(sqliteFile);
    sqlite.exec(`CREATE TABLE IF NOT EXISTS shares (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL, name TEXT NOT NULL, visibility TEXT NOT NULL,
        profile TEXT NOT NULL, edit_token_hash TEXT NOT NULL, updated_at TEXT NOT NULL)`);
    for (const column of ["category TEXT NOT NULL DEFAULT 'Other'", "description TEXT NOT NULL DEFAULT ''", 'uses INTEGER NOT NULL DEFAULT 0']) {
        try { sqlite.exec(`ALTER TABLE shares ADD COLUMN ${column}`); } catch { /* column already exists */ }
    }
    const decode = row => row ? { ...row, profile: JSON.parse(row.profile) } : null;
    return {
        ready: Promise.resolve(),
        get: async id => decode(sqlite.prepare('SELECT * FROM shares WHERE id = ?').get(id)),
        listPublic: async ({ limit, offset, q, category, sort }) => sqlite.prepare(`SELECT id, owner_id, name, profile, category, description, uses, updated_at FROM shares
            WHERE visibility = 'public' AND (?1 IS NULL OR category = ?1) AND (?2 IS NULL OR name LIKE ?2 OR description LIKE ?2)
            ORDER BY ${sort === 'popular' ? 'uses DESC, updated_at DESC' : 'updated_at DESC'} LIMIT ?3 OFFSET ?4`).all(category, q ? `%${q}%` : null, limit, offset).map(decode),
        insert: async row => sqlite.prepare('INSERT INTO shares (id, owner_id, name, visibility, profile, edit_token_hash, updated_at, category, description) VALUES (?, ?, ?, ?, ?, ?, ?, ?, ?)').run(row.id, row.owner_id, row.name, row.visibility, JSON.stringify(row.profile), row.edit_token_hash, new Date().toISOString(), row.category, row.description),
        update: async (id, row) => sqlite.prepare('UPDATE shares SET name = ?, visibility = ?, profile = ?, category = ?, description = ?, updated_at = ? WHERE id = ?').run(row.name, row.visibility, JSON.stringify(row.profile), row.category, row.description, new Date().toISOString(), id),
        use: async id => sqlite.prepare("UPDATE shares SET uses = uses + 1 WHERE id = ? AND visibility <> 'private'").run(id),
        remove: async id => sqlite.prepare('DELETE FROM shares WHERE id = ?').run(id)
    };
}

// The official starter templates were withdrawn; remove any copies seeded earlier.
const WITHDRAWN_STARTER_IDS = ["ccMidnight01", "ccSakura0001", "ccOcean00001", "ccForest0001", "ccSunset0001", "ccMono000001", "ccNeon000001", "ccGold000001"];
async function removeStarterTemplates(store) {
    for (const id of WITHDRAWN_STARTER_IDS) {
        const row = await store.get(id);
        if (row && row.owner_id === "0") await store.remove(id);
    }
}

function readBody(body) {
    const name = cleanName(body?.name);
    const visibility = String(body?.visibility || '');
    const profile = body?.profile;
    if (!name) return { error: 'Give the profile a name' };
    if (!VISIBILITIES.has(visibility)) return { error: 'Visibility must be public, unlisted or private' };
    if (!profile || typeof profile !== 'object' || Array.isArray(profile)) return { error: 'Invalid profile' };
    if (Buffer.byteLength(JSON.stringify(profile)) > MAX_PROFILE_BYTES) return { error: 'Profile is too large. Use image links instead of uploaded images.', status: 413 };
    const category = CATEGORIES.includes(body?.category) ? body.category : 'Other';
    const description = String(body?.description || '').replace(/[\u0000-\u001f\u007f]/g, ' ').trim().slice(0, 200);
    return { name, visibility, profile, category, description };
}

function makeProfileSharesRouter({ db, sqliteFile, readLimiter, writeLimiter }) {
    const router = express.Router();
    if (!db && !sqliteFile) {
        router.use((req, res) => res.status(503).json({ error: 'Profile sharing unavailable' }));
        return { router, store: null };
    }
    const store = makeStore({ db, sqliteFile });
    store.ready = store.ready.then(() => removeStarterTemplates(store)).catch(error => console.error('starter templates:', error.message));
    const handle = fn => (req, res) => Promise.resolve().then(() => store.ready).then(() => fn(req, res)).catch(error => {
        console.error('profile share failed:', error.message);
        if (!res.headersSent) res.status(503).json({ error: 'Profile sharing temporarily unavailable' });
    });
    const owns = (row, req) => !!row && !!bearer(req) && hashToken(bearer(req)) === row.edit_token_hash;

    router.get('/', readLimiter, handle(async (req, res) => {
        const limit = Math.min(100, Math.max(1, Number(req.query.limit) || 50));
        const offset = Math.min(10000, Math.max(0, Number(req.query.offset) || 0));
        const q = String(req.query.q || '').trim().slice(0, 60) || null;
        const category = CATEGORIES.includes(req.query.category) ? req.query.category : null;
        const sort = SORTS.has(req.query.sort) ? req.query.sort : 'popular';
        const rows = await store.listPublic({ limit, offset, q, category, sort });
        res.set('Cache-Control', 'public, max-age=30').json({ categories: CATEGORIES, shares: rows.map(row => ({ id: row.id, name: row.name, ownerId: row.owner_id, category: row.category, description: row.description, uses: Number(row.uses) || 0, preview: previewOf(row.profile), updatedAt: row.updated_at })) });
    }));

    router.get('/:id', readLimiter, handle(async (req, res) => {
        if (!validCode(req.params.id)) return res.status(404).json({ error: 'Profile not found' });
        const row = await store.get(req.params.id);
        // A private share looks exactly like a missing one to everyone but its owner.
        if (!row || (row.visibility === 'private' && !owns(row, req))) return res.status(404).json({ error: 'Profile not found' });
        res.set('Cache-Control', 'no-store').json({ id: row.id, name: row.name, ownerId: row.owner_id, visibility: row.visibility, category: row.category, description: row.description, uses: Number(row.uses) || 0, profile: row.profile, updatedAt: row.updated_at });
    }));

    // Counts someone applying or saving a template; one count per address per template a day.
    const recentUses = new Map();
    router.post('/:id/use', writeLimiter, handle(async (req, res) => {
        if (!validCode(req.params.id)) return res.status(404).json({ error: 'Profile not found' });
        const key = `${req.ip}:${req.params.id}`;
        const now = Date.now();
        if (recentUses.size > 50000) recentUses.clear();
        if (now - (recentUses.get(key) || 0) > 24 * 60 * 60 * 1000) { recentUses.set(key, now); await store.use(req.params.id); }
        res.json({ counted: true });
    }));

    router.post('/', writeLimiter, handle(async (req, res) => {
        if (!validOwnerId(req.body?.ownerId)) return res.status(400).json({ error: 'Invalid user' });
        const body = readBody(req.body);
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        const editToken = crypto.randomBytes(32).toString('base64url');
        let id = newCode();
        for (let attempt = 0; attempt < 5 && await store.get(id); attempt++) id = newCode();
        await store.insert({ id, owner_id: String(req.body.ownerId), name: body.name, visibility: body.visibility, profile: body.profile, category: body.category, description: body.description, edit_token_hash: hashToken(editToken) });
        res.status(201).json({ id, editToken, visibility: body.visibility });
    }));

    router.put('/:id', writeLimiter, handle(async (req, res) => {
        const row = validCode(req.params.id) ? await store.get(req.params.id) : null;
        if (!owns(row, req)) return res.status(401).json({ error: 'Only the device that shared this profile can change it' });
        const body = readBody({ name: req.body?.name ?? row.name, visibility: req.body?.visibility ?? row.visibility, profile: req.body?.profile ?? row.profile, category: req.body?.category ?? row.category, description: req.body?.description ?? row.description });
        if (body.error) return res.status(body.status || 400).json({ error: body.error });
        await store.update(row.id, body);
        res.json({ id: row.id, updated: true, visibility: body.visibility });
    }));

    router.delete('/:id', writeLimiter, handle(async (req, res) => {
        const row = validCode(req.params.id) ? await store.get(req.params.id) : null;
        if (!owns(row, req)) return res.status(401).json({ error: 'Only the device that shared this profile can delete it' });
        await store.remove(row.id);
        res.json({ deleted: true });
    }));

    return { router, store };
}

const escapeHtml = value => String(value ?? '').replace(/[&<>"']/g, char => ({ '&': '&amp;', '<': '&lt;', '>': '&gt;', '"': '&quot;', "'": '&#39;' })[char]);

/** The page behind a share link: a profile card and how to import it. */
function renderSharePage(row) {
    const missing = !row || row.visibility === 'private';
    const preview = missing ? null : previewOf(row.profile);
    const title = missing ? 'Profile not found · CloudCord' : `${row.name} · CloudCord profile`;
    const accent = preview?.accent || '#5865f2';
    const card = missing
        ? '<p class="share-empty">This profile doesn\'t exist or is private.</p>'
        : `<article class="share-card" style="--accent:${escapeHtml(accent)}">
            <div class="share-banner"${preview.banner ? ` style="background-image:url('${escapeHtml(preview.banner)}')"` : ''}></div>
            <div class="share-avatar">${preview.avatar ? `<img src="${escapeHtml(preview.avatar)}" alt="">` : ''}</div>
            <div class="share-body">
                <h1>${escapeHtml(preview.name || row.name)}</h1>
                ${preview.username ? `<p class="share-username">@${escapeHtml(preview.username)}</p>` : ''}
                ${preview.bio ? `<p class="share-bio">${escapeHtml(preview.bio)}</p>` : ''}
            </div>
        </article>
        <section class="share-import">
            <h2>Use this profile</h2>
            <p>In CloudCord, open <strong>Custom Profile → Templates</strong>, choose <strong>Use a code</strong> and paste this:</p>
            <code class="share-code">${escapeHtml(row.id)}</code>
            <p class="share-note">It's added to your Saved profiles. Nothing changes until you choose to use it.</p>
        </section>`;
    return `<!doctype html><html lang="en"><head><meta charset="utf-8"><meta name="viewport" content="width=device-width, initial-scale=1">
<title>${escapeHtml(title)}</title>
<meta name="robots" content="${!missing && row.visibility === 'public' ? 'index' : 'noindex'}">
<meta property="og:title" content="${escapeHtml(missing ? 'CloudCord profile' : row.name)}">
<meta property="og:description" content="${escapeHtml(missing ? 'A shared CloudCord profile' : (preview.bio || 'A shared CloudCord profile. Import it into CloudCord.'))}">
${preview?.avatar ? `<meta property="og:image" content="${escapeHtml(preview.avatar)}">` : ''}
<meta name="theme-color" content="${escapeHtml(accent)}">
<link rel="icon" href="/favicon.png"><link rel="stylesheet" href="/share.css">
</head><body><main class="share-page">${card}<p class="share-foot"><a href="/templates">Browse more templates</a> · <a href="/">CloudCord</a></p></main></body></html>`;
}

module.exports = { makeProfileSharesRouter, renderSharePage, previewOf, CATEGORIES };
