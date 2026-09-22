const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');
const { Readable } = require('stream');
const crypto = require('crypto');
const { Pool } = require('pg');
const { makeStoreCloudRouter } = require('./storecloud');
const { makeMembershipRouter } = require('./membership');

const app = express();
const PORT = process.env.PORT || 3000;
const SOURCE_DIR = path.join(__dirname, 'sourcevault-data');
const SERVER_STARTED_AT = new Date().toISOString();

function postgresSsl() {
    const configured = String(process.env.DATABASE_SSL || process.env.PGSSLMODE || '').trim().toLowerCase();
    if (['require', 'required', 'true', '1', 'no-verify'].includes(configured)) return { rejectUnauthorized: false };
    if (['verify-full', 'verify-ca'].includes(configured)) return { rejectUnauthorized: true };
    if (['disable', 'disabled', 'false', '0'].includes(configured)) return false;

    try {
        const mode = new URL(process.env.DATABASE_URL).searchParams.get('sslmode')?.toLowerCase();
        if (mode === 'require') return { rejectUnauthorized: false };
        if (mode === 'verify-full' || mode === 'verify-ca') return { rejectUnauthorized: true };
    } catch {}

    // Internal Coolify, Railway, and Docker Postgres connections commonly do
    // not expose TLS. Enable it explicitly for an external TLS-only database.
    return false;
}

const realCordDb = process.env.DATABASE_URL ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: postgresSsl() }) : null;
const realCordLicenseTableReady = realCordDb
    ? realCordDb.query(`CREATE TABLE IF NOT EXISTS realcord_license_activations (license_hash TEXT PRIMARY KEY, activated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())`)
        .catch(error => console.error('Could not prepare the RealCord license table:', error.message))
    : Promise.resolve();
const profileTableReady = realCordDb
    ? realCordDb.query(`CREATE TABLE IF NOT EXISTS cloudcord_profiles (
        id TEXT PRIMARY KEY,
        owner_id TEXT NOT NULL,
        profile JSONB NOT NULL,
        edit_token_hash TEXT NOT NULL,
        updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`).then(() => realCordDb.query('CREATE INDEX IF NOT EXISTS cloudcord_profiles_owner_updated_idx ON cloudcord_profiles (owner_id, updated_at DESC)'))
        .catch(error => console.error('Could not prepare the CloudCord profile table:', error.message))
    : Promise.resolve();
const staffApplicationsTableReady = realCordDb
    ? realCordDb.query(`CREATE TABLE IF NOT EXISTS cloudcord_staff_applications (
        id UUID PRIMARY KEY,
        discord_user_id TEXT NOT NULL,
        discord_username TEXT NOT NULL,
        discord_global_name TEXT,
        discord_avatar TEXT,
        role TEXT NOT NULL,
        answers JSONB NOT NULL,
        status TEXT NOT NULL DEFAULT 'pending',
        review_note TEXT,
        submitted_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
        reviewed_at TIMESTAMPTZ
    )`).then(() => realCordDb.query('CREATE INDEX IF NOT EXISTS cloudcord_staff_applications_status_idx ON cloudcord_staff_applications (status, submitted_at DESC)'))
        .catch(error => console.error('Could not prepare the staff applications table:', error.message))
    : Promise.resolve();

// Security middlewares
app.set('trust proxy', 1); // Trust Railway/Cloudflare proxy for accurate IP
app.use(helmet({
    contentSecurityPolicy: {
        directives: {
            defaultSrc: ["'self'"],
            scriptSrc: ["'self'", "'unsafe-inline'"],
            styleSrc: ["'self'", "'unsafe-inline'", "https://fonts.googleapis.com"],
            fontSrc: ["'self'", "https://fonts.gstatic.com", "data:"],
            imgSrc: ["'self'", "data:", "blob:", "https:"],
            connectSrc: [
                "'self'",
                "https://cloudcord-profiles.ggxohus.workers.dev",
                "https://api.github.com",
                "https://raw.githubusercontent.com"
            ]
        }
    },
    crossOriginEmbedderPolicy: false
}));
app.use(cors());

// Keep the public identity unambiguous for people, crawlers, and OAuth flows.
app.use((req, res, next) => {
    const host = String(req.hostname || '').toLowerCase();
    if (host === 'cloudcord.xohus.lol') return res.redirect(301, `https://getcloudcord.com${req.originalUrl}`);
    next();
});

// Docker/Coolify liveness check. Keep this independent of external services so
// a temporary database or GitHub outage does not restart a healthy web server.
app.get('/health', (_req, res) => {
    res.status(200).type('text/plain').send('ok');
});

// Keep inexpensive endpoints from being used to exhaust application workers. A
// CDN/WAF should absorb volumetric attacks before they reach this process.
const siteLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 180,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { error: 'Too many requests. Please try again shortly.' },
    // Do not spend the shared API quota on webpages, JS/CSS/images, or client
    // runtime downloads. Those GET/HEAD responses are cacheable/read-only and
    // many legitimate users can appear under one proxy address.
    skip: req => {
        if (req.path === '/health') return true;
        // Staff applications and review have dedicated, tighter limiters. Keeping
        // them out of this shared quota prevents unrelated client traffic behind
        // the same proxy from locking applicants and reviewers out.
        if (req.path.startsWith('/api/staff/') || req.path.startsWith('/api/admin/staff/')) return true;
        if (!['GET', 'HEAD'].includes(req.method)) return false;
        if (req.path.startsWith('/api/proxy/raw/') || req.path.startsWith('/api/proxy/assets/')) return true;
        return !req.path.startsWith('/api/') && !req.path.startsWith('/v1/');
    }
});
app.use(siteLimiter);
// StoreCloud's sync endpoint accepts larger encrypted settings archives and
// applies its own 16 MB JSON limit. Mount it before the site's default parser
// so Express's 100 KB default does not reject valid sync requests first.
app.use(makeStoreCloudRouter(express));
app.use(makeMembershipRouter(express));
// Fake profiles may contain an avatar and banner encoded as data URLs. Keep the
// limit bounded, but large enough for the media limits enforced by clients.
app.use(express.json({ limit: '4mb' }));

// Profile cards can request several users at once while Discord mounts and
// remounts its profile surfaces. Keep reads independent from writes so normal
// browsing cannot consume the quota needed to save a Fake Profile.
const profileReadLimiter = rateLimit({ windowMs: 60 * 1000, limit: 600, standardHeaders: 'draft-7', legacyHeaders: false });
const profileWriteLimiter = rateLimit({ windowMs: 60 * 1000, limit: 120, standardHeaders: 'draft-7', legacyHeaders: false });
const validOwnerId = value => /^\d{15,22}$/.test(String(value || ''));
const hashProfileToken = token => crypto.createHash('sha256').update(String(token)).digest('hex');

app.get('/v1/profiles/user/:ownerId', profileReadLimiter, async (req, res) => {
    if (!realCordDb) return res.status(503).json({ error: 'Profile sync unavailable' });
    if (!validOwnerId(req.params.ownerId)) return res.status(400).json({ error: 'Invalid user' });
    await profileTableReady;
    const result = await realCordDb.query('SELECT id, owner_id, profile, updated_at FROM cloudcord_profiles WHERE owner_id = $1 ORDER BY updated_at DESC LIMIT 1', [req.params.ownerId]);
    if (!result.rows.length) return res.status(404).json({ error: 'Profile not found' });
    // Every client publishes a complete canonical snapshot. Returning the last
    // updated row gives deterministic last-write-wins behavior across devices;
    // merging historical rows allowed stale fields to reappear indefinitely.
    const latest = result.rows[0];
    const profile = latest.profile || {};
    res.set('Cache-Control', 'no-store');
    res.json({ schemaVersion: 1, id: latest.id, ownerId: latest.owner_id, profile, updatedAt: latest.updated_at });
});

app.post('/v1/profiles', profileWriteLimiter, async (req, res) => {
    if (!realCordDb) return res.status(503).json({ error: 'Profile sync unavailable' });
    if (!validOwnerId(req.body?.ownerId) || !req.body?.profile || typeof req.body.profile !== 'object' || Array.isArray(req.body.profile)) return res.status(400).json({ error: 'Invalid profile' });
    await profileTableReady;
    // Each installation owns its own row/edit token. Cross-device CloudCord
    // installs cannot safely share that secret without account linking, so a
    // second installation is allowed to create a new row for the same Discord
    // user. Reads select the most recently updated row, giving deterministic
    // last-write-wins sync without exposing another device's edit token.
    const id = crypto.randomUUID();
    const editToken = crypto.randomBytes(32).toString('base64url');
    await realCordDb.query('INSERT INTO cloudcord_profiles (id, owner_id, profile, edit_token_hash) VALUES ($1, $2, $3, $4)', [id, String(req.body.ownerId), req.body.profile, hashProfileToken(editToken)]);
    res.status(201).json({ id, editToken });
});

app.put('/v1/profiles/:id', profileWriteLimiter, async (req, res) => {
    if (!realCordDb) return res.status(503).json({ error: 'Profile sync unavailable' });
    const token = String(req.get('authorization') || '').replace(/^Bearer\s+/i, '');
    if (!token || !validOwnerId(req.body?.ownerId) || !req.body?.profile || typeof req.body.profile !== 'object' || Array.isArray(req.body.profile)) return res.status(400).json({ error: 'Invalid profile update' });
    await profileTableReady;
    // An edit token owns one immutable profile identity. Never let a valid token
    // for one row move that row onto somebody else's Discord user id.
    const result = await realCordDb.query('UPDATE cloudcord_profiles SET profile = $1, updated_at = NOW() WHERE id = $2 AND owner_id = $3 AND edit_token_hash = $4 RETURNING id', [req.body.profile, req.params.id, String(req.body.ownerId), hashProfileToken(token)]);
    if (!result.rows[0]) return res.status(401).json({ error: 'Invalid profile token' });
    res.json({ id: result.rows[0].id, updated: true });
});

// Lightweight status endpoint for uptime monitors and the public status page.
// BOTCORD_STATUS can be changed to "operational" after the desktop feature is restored.
app.get(['/api/status', '/v1/status'], (req, res) => {
    const botCordOperational = process.env.BOTCORD_STATUS === 'operational';
    res.set('Cache-Control', 'public, max-age=15, stale-while-revalidate=60');
    res.json({
        ok: true,
        checkedAt: new Date().toISOString(),
        startedAt: SERVER_STARTED_AT,
        uptimeSeconds: Math.floor(process.uptime()),
        services: {
            web: { status: 'operational', label: 'Operational' },
            botcord: {
                status: botCordOperational ? 'operational' : 'maintenance',
                label: botCordOperational ? 'Operational' : 'Temporarily unavailable'
            }
        }
    });
});

// Direct live installs proxy to bypass any CORS/client network issues.
// Never manufacture a count: retain the last verified upstream value during a
// transient outage, or return an unavailable response if none has been verified.
let lastVerifiedInstallCount = null;
app.get(['/api/usage/installs', '/v1/usage/installs'], async (req, res) => {
    try {
        const workerRes = await fetch('https://cloudcord-profiles.ggxohus.workers.dev/v1/usage/installs', {
            headers: { 'Accept': 'application/json' }
        });
        if (!workerRes.ok) {
            throw new Error(`Usage service returned ${workerRes.status}`);
        }

        const data = await workerRes.json();
        const count = Number(data?.count);
        if (!Number.isSafeInteger(count) || count < 0) {
            throw new Error('Usage service returned an invalid count');
        }

        lastVerifiedInstallCount = count;
        res.set('Cache-Control', 'no-store');
        return res.json({ ...data, count, verified: true });
    } catch (e) {
        res.set('Cache-Control', 'no-store');
        if (lastVerifiedInstallCount !== null) {
            return res.json({
                count: lastVerifiedInstallCount,
                metric: 'lifetime_official_downloads',
                verified: true,
                stale: true
            });
        }
        return res.status(503).json({
            error: 'Verified install count temporarily unavailable'
        });
    }
});

// Session setup
app.use(session({
    // A production deployment must provide a secret; never use a public default.
    secret: process.env.SESSION_SECRET || crypto.randomBytes(32).toString('hex'),
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, sameSite: 'lax', maxAge: 24 * 60 * 60 * 1000 }
}));

// Audit logger
function logAudit(event, req, additionalInfo = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        event,
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        sessionID: req.sessionID,
        userAgent: req.headers['user-agent'],
        ...additionalInfo
    };
    console.log('[SOURCEVAULT AUDIT]', JSON.stringify(logEntry));
}

// Public discovery files live at the project root so they can also be maintained
// alongside deployment metadata. Expose them at their conventional web paths.
app.get('/robots.txt', (req, res) => {
    res.type('text/plain').sendFile(path.join(__dirname, 'robots.txt'));
});

app.get('/sitemap.xml', (req, res) => {
    res.type('application/xml').sendFile(path.join(__dirname, 'sitemap.xml'));
});

app.get('/llms.txt', (req, res) => {
    res.type('text/plain').sendFile(path.join(__dirname, 'llms.txt'));
});

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '1h',
    etag: true,
    setHeaders: (res, servedPath) => {
        const fileName = path.basename(servedPath).toLowerCase();
        if (['index.html', 'script.js', 'admin.html', 'admin.js', 'staff-application.html', 'staff-application.js'].includes(fileName)) {
            res.setHeader('Cache-Control', 'no-store, max-age=0');
        }
    }
}));

// SourceVault API

// Middleware to check access
function checkSourceAccess(req, res, next) {
    if (!req.session.agreed) {
        logAudit('ACCESS_DENIED', req, { reason: 'No CPSL agreement in session' });
        return res.status(403).json({ error: 'Access denied. You must agree to the CPSL.' });
    }
    next();
}

app.post('/api/source/agree', (req, res) => {
    req.session.agreed = true;
    logAudit('CPSL_AGREEMENT', req, { cpslVersion: '1.0' });
    res.json({ success: true });
});

app.get('/api/source/status', (req, res) => {
    res.json({
        agreed: !!req.session.agreed,
        version: '1.0.0',
        revision: 'latest' // Could be read from a version.json
    });
});

const GITHUB_REPO = 'xohus/cloudcord';
const REALCORD_REPO = 'xohus/realcord';

const realCordLicenseLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 10,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    message: { valid: false, error: 'Too many verification attempts. Try again shortly.' }
});

const realCordKeyLimiter = rateLimit({
    windowMs: 60 * 1000,
    limit: 5,
    standardHeaders: 'draft-7',
    legacyHeaders: false,
    keyGenerator: req => crypto.createHash('sha256').update(String(req.body?.key || 'empty')).digest('hex'),
    message: { valid: false, error: 'Too many attempts for this license key. Try again shortly.' }
});

function parseRealCordSecrets(value) {
    if (!value) return [];
    try {
        const parsed = JSON.parse(value);
        if (Array.isArray(parsed)) return parsed.map(String).map(item => item.trim()).filter(Boolean);
    } catch { }
    return String(value).split(/[\r\n,]+/).map(item => item.trim()).filter(Boolean);
}

const staffApplicationLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 8, standardHeaders: 'draft-7', legacyHeaders: false });
const staffAdminLimiter = rateLimit({ windowMs: 15 * 60 * 1000, limit: 12, standardHeaders: 'draft-7', legacyHeaders: false });
const STAFF_ROLES = new Set(['Support Team', 'Moderator', 'Administrator', 'Developer']);
const STAFF_FIELDS = new Set([
    'discordUsername', 'discordId', 'age', 'timezone', 'role', 'motivation', 'experience', 'availability',
    'cloudcordTime', 'devices', 'angryUser', 'friendViolation', 'securityBug', 'disagreement', 'bestChoice',
    'additional', 'supportUnknown', 'supportDiagnostics', 'supportExplain', 'supportEscalate', 'modViolations',
    'modEvidence', 'modAppeal', 'modActions', 'adminResponsibilities', 'adminDispute', 'adminAbuse',
    'adminIncident', 'devStack', 'devWork', 'devDebug', 'devTesting', 'devSafety', 'devImprovement'
]);

function cleanStaffAnswers(input) {
    if (!input || typeof input !== 'object' || Array.isArray(input)) return null;
    const answers = {};
    for (const [key, value] of Object.entries(input)) {
        if (!STAFF_FIELDS.has(key) || typeof value !== 'string') continue;
        answers[key] = value.trim().slice(0, 5000);
    }
    if (!STAFF_ROLES.has(answers.role)) return null;
    const required = ['discordUsername', 'discordId', 'age', 'timezone', 'motivation', 'experience', 'availability', 'cloudcordTime', 'angryUser', 'friendViolation', 'securityBug', 'disagreement', 'bestChoice'];
    if (required.some(key => !answers[key]) || !/^\d{15,22}$/.test(answers.discordId)) return null;
    return answers;
}

function checkStaffAdmin(req, res, next) {
    if (req.session.staffAdmin === true) return next();
    res.status(401).json({ error: 'Admin authentication required' });
}

async function discordBotRequest(route, options = {}) {
    const token = String(process.env.CLOUDCORD_DISCORD_BOT_TOKEN || '');
    if (!token) throw new Error('CloudCord bot token is not configured');
    return fetch(`https://discord.com/api/v10${route}`, {
        ...options,
        headers: { Authorization: `Bot ${token}`, 'Content-Type': 'application/json', ...(options.headers || {}) }
    });
}

async function sendStaffDecisionDm(application, decision, note) {
    const dmResponse = await discordBotRequest('/users/@me/channels', {
        method: 'POST',
        body: JSON.stringify({ recipient_id: application.discord_user_id })
    });
    if (!dmResponse.ok) throw new Error(`Discord DM channel failed (${dmResponse.status})`);
    const dm = await dmResponse.json();
    const accepted = decision === 'accepted';
    const content = [
        accepted ? '## Your CloudCord staff application was accepted' : '## Your CloudCord staff application was not accepted',
        accepted
            ? `Your application for **${application.role}** has been approved. A staff member will contact you with the next steps.`
            : `Thank you for applying for **${application.role}**. We are not moving forward with this application at this time.`,
        note ? `\n**Staff note:** ${String(note).slice(0, 1000)}` : '',
        '\n— CloudCord Staff'
    ].filter(Boolean).join('\n');
    const messageResponse = await discordBotRequest(`/channels/${dm.id}/messages`, {
        method: 'POST',
        body: JSON.stringify({ content, allowed_mentions: { parse: [] } })
    });
    if (!messageResponse.ok) throw new Error(`Discord DM failed (${messageResponse.status})`);
}

app.post('/api/staff/applications/start', staffApplicationLimiter, (req, res) => {
    if (!realCordDb) return res.status(503).json({ error: 'Applications are temporarily unavailable' });
    const answers = cleanStaffAnswers(req.body?.answers);
    if (!answers || req.body?.confidentiality !== true || req.body?.consequences !== true) return res.status(400).json({ error: 'Complete every required field before continuing' });
    const clientId = process.env.CLOUDCORD_DISCORD_CLIENT_ID;
    const redirectUri = process.env.CLOUDCORD_STAFF_REDIRECT_URI || 'https://getcloudcord.com/staff-application/callback';
    if (!clientId || !process.env.CLOUDCORD_DISCORD_CLIENT_SECRET) return res.status(503).json({ error: 'Discord sign-in is not configured' });
    const state = crypto.randomBytes(24).toString('base64url');
    req.session.staffApplication = { state, answers, createdAt: Date.now() };
    const query = new URLSearchParams({ client_id: clientId, redirect_uri: redirectUri, response_type: 'code', scope: 'identify', state, prompt: 'consent' });
    res.set('Cache-Control', 'no-store').json({ authorizeUrl: `https://discord.com/oauth2/authorize?${query}` });
});

app.get('/staff-application/callback', staffApplicationLimiter, async (req, res) => {
    const pending = req.session.staffApplication;
    delete req.session.staffApplication;
    if (req.query.error) return res.redirect('/staff-application?error=oauth_denied');
    if (!pending || Date.now() - Number(pending.createdAt) > 15 * 60 * 1000 || !timingSafeTextEqual(req.query.state || '', pending.state) || !req.query.code) return res.redirect('/staff-application?error=session_expired');
    try {
        const redirectUri = process.env.CLOUDCORD_STAFF_REDIRECT_URI || 'https://getcloudcord.com/staff-application/callback';
        const tokenResponse = await fetch('https://discord.com/api/v10/oauth2/token', {
            method: 'POST', headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
            body: new URLSearchParams({ client_id: process.env.CLOUDCORD_DISCORD_CLIENT_ID, client_secret: process.env.CLOUDCORD_DISCORD_CLIENT_SECRET, grant_type: 'authorization_code', code: String(req.query.code), redirect_uri: redirectUri })
        });
        if (!tokenResponse.ok) throw new Error(`Discord authorization failed (${tokenResponse.status})`);
        const token = await tokenResponse.json();
        const userResponse = await fetch('https://discord.com/api/v10/users/@me', { headers: { Authorization: `Bearer ${token.access_token}` } });
        if (!userResponse.ok) throw new Error(`Discord identity failed (${userResponse.status})`);
        const user = await userResponse.json();
        if (String(user.id) !== String(pending.answers.discordId)) return res.redirect('/staff-application?error=identity_mismatch');
        await staffApplicationsTableReady;
        const avatar = user.avatar ? `https://cdn.discordapp.com/avatars/${user.id}/${user.avatar}.${String(user.avatar).startsWith('a_') ? 'gif' : 'png'}?size=128` : null;
        await realCordDb.query(`INSERT INTO cloudcord_staff_applications (id, discord_user_id, discord_username, discord_global_name, discord_avatar, role, answers)
            VALUES ($1,$2,$3,$4,$5,$6,$7)`, [crypto.randomUUID(), user.id, user.username, user.global_name || null, avatar, pending.answers.role, pending.answers]);
        logAudit('STAFF_APPLICATION_SUBMITTED', req, { discordUserId: user.id, role: pending.answers.role });
        res.redirect('/staff-application?submitted=1');
    } catch (error) {
        console.error('[STAFF APPLICATION OAUTH]', error);
        res.redirect('/staff-application?error=submit_failed');
    }
});

app.post('/api/admin/staff/login', staffAdminLimiter, (req, res) => {
    const configured = String(process.env.ADMIN_PASSWORD || '');
    const supplied = String(req.body?.password || '');
    if (!configured || !timingSafeTextEqual(configured, supplied)) {
        logAudit('STAFF_ADMIN_LOGIN_FAILED', req);
        return res.status(401).json({ error: 'Invalid admin password' });
    }
    req.session.staffAdmin = true;
    req.session.save(() => res.json({ authenticated: true }));
});

app.post('/api/admin/staff/logout', checkStaffAdmin, (req, res) => {
    delete req.session.staffAdmin;
    req.session.save(() => res.json({ authenticated: false }));
});

app.get('/api/admin/staff/session', (req, res) => res.json({ authenticated: req.session.staffAdmin === true }));

app.get('/api/admin/staff/applications', checkStaffAdmin, async (req, res) => {
    if (!realCordDb) return res.status(503).json({ error: 'Database unavailable' });
    await staffApplicationsTableReady;
    const status = ['pending', 'accepted', 'denied'].includes(req.query.status) ? req.query.status : 'pending';
    const result = await realCordDb.query(`SELECT id, discord_user_id, discord_username, discord_global_name, discord_avatar, role, answers, status, review_note, submitted_at, reviewed_at
        FROM cloudcord_staff_applications WHERE status = $1 ORDER BY submitted_at DESC LIMIT 200`, [status]);
    res.set('Cache-Control', 'private, no-store').json({ applications: result.rows });
});

app.post('/api/admin/staff/applications/:id/decision', checkStaffAdmin, staffAdminLimiter, async (req, res) => {
    const decision = String(req.body?.decision || '');
    const note = String(req.body?.note || '').trim().slice(0, 1000);
    if (!['accepted', 'denied'].includes(decision)) return res.status(400).json({ error: 'Invalid decision' });
    await staffApplicationsTableReady;
    const result = await realCordDb.query(`UPDATE cloudcord_staff_applications SET status=$1, review_note=$2, reviewed_at=NOW()
        WHERE id=$3 AND status='pending' RETURNING *`, [decision, note || null, req.params.id]);
    if (!result.rows[0]) return res.status(404).json({ error: 'Pending application not found' });
    let notified = true;
    let notificationError = null;
    try { await sendStaffDecisionDm(result.rows[0], decision, note); }
    catch (error) { notified = false; notificationError = error.message; console.error('[STAFF DECISION DM]', error); }
    logAudit('STAFF_APPLICATION_REVIEWED', req, { applicationId: req.params.id, decision, notified });
    res.json({ updated: true, notified, notificationError });
});

function timingSafeTextEqual(left, right) {
    const expected = Buffer.from(String(left));
    const supplied = Buffer.from(String(right));
    return expected.length === supplied.length && crypto.timingSafeEqual(expected, supplied);
}

const REALCORD_PLANS = {
    '7d': { label: '7 days', price: 2.49, days: 7 },
    '30d': { label: '30 days', price: 5.49, days: 30 },
    '90d': { label: '90 days', price: 11.99, days: 90 },
    '6m': { label: '6 months', price: 19.99, months: 6 },
    '1y': { label: '1 year', price: 29.99, years: 1 },
    'lifetime': { label: 'Lifetime', price: 39.99 }
};

function parseRealCordRecords() {
    const raw = String(process.env.REALCORD_LICENSE_RECORDS || '').trim();
    if (!raw) return [];
    try {
        const records = JSON.parse(raw);
        return Array.isArray(records) ? records : [];
    } catch { }

    const values = raw.split(/[\r\n,]+/).map(value => value.trim()).filter(Boolean);
    const records = [];
    for (let index = 0; index + 1 < values.length; index += 2) {
        records.push({ duration: values[index].toLowerCase(), hash: values[index + 1].toLowerCase() });
    }
    return records;
}

function calculateRealCordExpiry(activatedAt, plan) {
    if (plan === REALCORD_PLANS.lifetime) return null;
    const expiresAt = new Date(activatedAt);
    if (plan.days) expiresAt.setUTCDate(expiresAt.getUTCDate() + plan.days);
    if (plan.months) expiresAt.setUTCMonth(expiresAt.getUTCMonth() + plan.months);
    if (plan.years) expiresAt.setUTCFullYear(expiresAt.getUTCFullYear() + plan.years);
    return expiresAt;
}

async function findRealCordLicense(license, activate = false) {
    if (!license || license.length < 12 || license.length > 160) return null;
    const submittedHash = crypto.createHash('sha256').update(license).digest('hex');
    for (const record of parseRealCordRecords()) {
        const plan = REALCORD_PLANS[String(record.duration || '').toLowerCase()];
        if (!plan || !record.hash || !timingSafeTextEqual(String(record.hash).toLowerCase(), submittedHash)) continue;
        if (!realCordDb) throw new Error('DATABASE_URL is required for duration-aware RealCord licenses');
        await realCordLicenseTableReady;
        if (activate) await realCordDb.query('INSERT INTO realcord_license_activations (license_hash) VALUES ($1) ON CONFLICT (license_hash) DO NOTHING', [submittedHash]);
        const activation = await realCordDb.query('SELECT activated_at FROM realcord_license_activations WHERE license_hash = $1', [submittedHash]);
        if (!activation.rows[0]) return { pendingActivation: true, duration: plan.label, price: plan.price, expiresAt: null };
        const activatedAt = new Date(activation.rows[0].activated_at);
        const expiresAt = calculateRealCordExpiry(activatedAt, plan);
        if (expiresAt && (Number.isNaN(expiresAt.getTime()) || expiresAt <= new Date())) return null;
        return { duration: plan.label, price: plan.price, activatedAt: activatedAt.toISOString(), expiresAt: expiresAt?.toISOString() || null };
    }

    // Backward-compatible entries have no duration metadata and are treated as lifetime.
    const configuredHashes = parseRealCordSecrets(process.env.REALCORD_LICENSE_HASHES).map(hash => hash.toLowerCase());
    const configuredKeys = parseRealCordSecrets(process.env.REALCORD_LICENSE_KEYS);
    const legacyMatch = configuredHashes.some(hash => timingSafeTextEqual(hash, submittedHash))
        || configuredKeys.some(key => timingSafeTextEqual(key, license));
    return legacyMatch ? { duration: 'Lifetime', price: REALCORD_PLANS.lifetime.price, expiresAt: null } : null;
}

async function checkRealCordLicense(req, res, next) {
    try {
        const license = String(req.headers['x-realcord-license'] || '').trim();
        const record = await findRealCordLicense(license, false);
        if (!record) return res.status(401).json({ error: 'Unauthorized license' });
        req.realCordLicense = record;
        next();
    } catch (error) {
        console.error('[REALCORD LICENSE]', error);
        res.status(503).json({ error: 'License service unavailable' });
    }
}

function realCordGitHubHeaders(accept = 'application/vnd.github+json') {
    return {
        'Authorization': `Bearer ${process.env.REALCORD_GITHUB_PAT || process.env.GITHUB_PAT}`,
        'Accept': accept,
        'User-Agent': 'CloudCord-Web-RealCord-Updater',
        'X-GitHub-Api-Version': '2022-11-28'
    };
}

app.post('/api/realcord/license', realCordLicenseLimiter, realCordKeyLimiter, async (req, res) => {
    res.set('Cache-Control', 'private, no-store');
    return res.status(423).json({
        valid: false,
        shutdown: true,
        error: 'RealCord has been shut down. Using third-party Discord clients can result in Discord limiting or terminating your account.'
    });
    /* RealCord shutdown: keep the previous verifier below for a recoverable rollback. */
    try {
        const license = String(req.body?.key || '').trim();
        res.set('Cache-Control', 'private, no-store');
        const record = await findRealCordLicense(license, true);
        if (!record) return res.status(401).json({ valid: false, error: 'License key is invalid or expired' });
        res.json({ valid: true, tier: 'RealCord', ...record });
    } catch (error) {
        console.error('[REALCORD REDEEM]', error);
        res.status(503).json({ valid: false, error: 'License service unavailable' });
    }
});

// Licensed RealCord updates are delivered by CloudCord Web. The private GitHub
// token stays server-side; clients receive only a verified checksum and proxy URL.
app.get('/api/realcord/update', checkRealCordLicense, async (req, res) => {
    if (!process.env.REALCORD_GITHUB_PAT && !process.env.GITHUB_PAT)
        return res.status(503).json({ error: 'Update service is not configured' });
    try {
        const releaseRes = await fetch(`https://api.github.com/repos/${REALCORD_REPO}/releases/tags/realcord-latest`, {
            headers: realCordGitHubHeaders()
        });
        if (!releaseRes.ok) return res.status(503).json({ error: 'No RealCord update is available' });
        const release = await releaseRes.json();
        const archive = release.assets?.find(asset => asset.name === 'RealCord-Windows-x64.zip');
        const checksum = release.assets?.find(asset => asset.name === 'RealCord-Windows-x64.zip.sha256');
        if (!archive || !checksum) return res.status(503).json({ error: 'RealCord update assets are incomplete' });

        const checksumRes = await fetch(`https://api.github.com/repos/${REALCORD_REPO}/releases/assets/${checksum.id}`, {
            headers: realCordGitHubHeaders('application/octet-stream')
        });
        if (!checksumRes.ok) return res.status(503).json({ error: 'RealCord update checksum is unavailable' });
        const sha256 = (await checksumRes.text()).trim().split(/\s+/)[0];
        res.set('Cache-Control', 'private, no-store');
        res.json({
            version: release.name,
            sha256,
            downloadUrl: `${req.protocol}://${req.get('host')}/api/realcord/update/download/${archive.id}`
        });
    } catch (error) {
        console.error('[REALCORD UPDATE]', error);
        res.status(503).json({ error: 'RealCord update service is unavailable' });
    }
});

app.get('/api/realcord/update/download/:assetId', checkRealCordLicense, async (req, res) => {
    if (!/^\d+$/.test(req.params.assetId)) return res.status(400).json({ error: 'Invalid update asset' });
    if (!process.env.REALCORD_GITHUB_PAT && !process.env.GITHUB_PAT)
        return res.status(503).json({ error: 'Update service is not configured' });
    try {
        const assetRes = await fetch(`https://api.github.com/repos/${REALCORD_REPO}/releases/assets/${req.params.assetId}`, {
            headers: realCordGitHubHeaders('application/octet-stream')
        });
        if (!assetRes.ok || !assetRes.body) return res.status(502).json({ error: 'RealCord update download failed' });
        res.set({
            'Content-Type': 'application/zip',
            'Cache-Control': 'private, no-store',
            'Content-Disposition': 'attachment; filename="RealCord-Windows-x64.zip"'
        });
        Readable.fromWeb(assetRes.body).pipe(res);
    } catch (error) {
        console.error('[REALCORD UPDATE DOWNLOAD]', error);
        if (!res.headersSent) res.status(502).json({ error: 'RealCord update download failed' });
        else res.destroy(error);
    }
});

app.get('/api/source/files', checkSourceAccess, async (req, res) => {
    logAudit('SOURCE_FILES_LISTED', req);
    
    const token = process.env.GITHUB_PAT;
    if (!token) {
        return res.status(500).json({ error: 'SourceVault is unconfigured. GITHUB_PAT missing.' });
    }
    
    try {
        const ghRes = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/git/trees/main?recursive=1', {
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudCord-SourceVault'
            }
        });
        
        if (!ghRes.ok) {
            console.error('GitHub API error:', await ghRes.text());
            return res.status(500).json({ error: 'Failed to fetch repository tree from GitHub' });
        }
        
        const data = await ghRes.json();
        
        const excludePatterns = [/^\.git/, /^\.env/, /^node_modules/, /^dist/, /^LICENSE/i];
        const root = { type: 'directory', children: [] };
        
        data.tree.forEach(item => {
            if (excludePatterns.some(p => p.test(item.path))) return;
            
            const parts = item.path.split('/');
            let current = root;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isLast = (i === parts.length - 1);
                
                let child = current.children.find(c => c.name === part);
                if (!child) {
                    if (isLast && item.type === 'blob') {
                        current.children.push({
                            name: part,
                            path: item.path,
                            type: 'file',
                            size: item.size
                        });
                    } else if (item.type === 'tree' || !isLast) {
                        child = {
                            name: part,
                            path: parts.slice(0, i + 1).join('/'),
                            type: 'directory',
                            children: []
                        };
                        current.children.push(child);
                    }
                }
                current = child;
            }
        });
        
        res.json({ tree: root.children });
    } catch (err) {
        console.error('Tree fetch failed', err);
        res.status(500).json({ error: 'Failed to read source tree' });
    }
});

app.get('/api/source/file/*', checkSourceAccess, async (req, res) => {
    const filePathParam = req.params[0];
    const excludePatterns = [/^\.git/, /^\.env/, /^node_modules/, /^dist/, /^LICENSE/i];
    
    if (!filePathParam || filePathParam.includes('..') || excludePatterns.some(p => p.test(filePathParam))) {
        return res.status(400).json({ error: 'Invalid path or access denied' });
    }
    
    const token = process.env.GITHUB_PAT;
    if (!token) {
        return res.status(500).json({ error: 'SourceVault is unconfigured. GITHUB_PAT missing.' });
    }
    
    try {
        const ghRes = await fetch('https://raw.githubusercontent.com/' + GITHUB_REPO + '/main/' + filePathParam, {
            headers: {
                'Authorization': 'Bearer ' + token,
                'User-Agent': 'CloudCord-SourceVault'
            }
        });
        
        if (ghRes.status === 404) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        if (!ghRes.ok) {
            return res.status(500).json({ error: 'Failed to fetch file from GitHub' });
        }
        
        const buffer = await ghRes.arrayBuffer();
        const contentType = ghRes.headers.get('content-type') || 'application/octet-stream';
        res.set('Content-Type', contentType);
        
        logAudit('FILE_ACCESSED', req, { file: filePathParam });
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});

// ==========================================
// CLIENT RUNTIME PROXY
// Securely serves updates to the iOS/Android/Desktop apps
// without exposing the GITHUB_PAT to the public.
// ==========================================

function checkClientAuth(req, res, next) {
    // Simple protection against casual browser scraping
    if (req.headers['user-agent'] && req.headers['user-agent'].includes('Mozilla') && !req.headers['x-cc-client']) {
        return res.status(403).json({ error: 'Direct browser access to runtime assets is forbidden.' });
    }
    next();
}

app.get('/api/proxy/releases/latest', checkClientAuth, async (req, res) => {
    const token = process.env.GITHUB_PAT;
    if (!token) return res.status(500).json({ error: 'Unconfigured' });
    
    try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/latest`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudCord-Client'
            }
        });
        if (!ghRes.ok) return res.status(ghRes.status).send('GitHub Error');
        const data = await ghRes.json();
        
        // Rewrite asset download URLs to proxy through this server
        if (data.assets) {
            data.assets = data.assets.map(asset => {
                asset.browser_download_url = `https://${req.get('host')}/api/proxy/assets/${asset.id}`;
                return asset;
            });
        }
        res.json(data);
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

app.get('/api/proxy/assets/:assetId', checkClientAuth, async (req, res) => {
    const token = process.env.GITHUB_PAT;
    if (!token) return res.status(500).json({ error: 'Unconfigured' });
    
    try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/releases/assets/${req.params.assetId}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/octet-stream',
                'User-Agent': 'CloudCord-Client'
            },
            redirect: 'manual' // We need to handle the S3 redirect manually or let node-fetch follow it
        });
        
        // GitHub redirects asset downloads to AWS S3
        if (ghRes.status === 302 || ghRes.status === 301) {
            return res.redirect(ghRes.headers.get('location'));
        }
        
        if (!ghRes.ok) return res.status(ghRes.status).send('GitHub Error');
        
        const contentType = ghRes.headers.get('content-type') || 'application/octet-stream';
        res.set('Content-Type', contentType);
        
        const buffer = await ghRes.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

app.get('/api/proxy/raw/*', checkClientAuth, async (req, res) => {
    const filePathParam = req.params[0];
    const token = process.env.GITHUB_PAT;
    if (!token) return res.status(500).json({ error: 'Unconfigured' });
    
    try {
        const upstreamUrl = new URL(`https://raw.githubusercontent.com/${GITHUB_REPO}/main/${filePathParam}`);
        upstreamUrl.searchParams.set('cloudcord_version', Date.now().toString());
        const ghRes = await fetch(upstreamUrl, {
            cache: 'no-store',
            headers: {
                'Authorization': `Bearer ${token}`,
                'Cache-Control': 'no-cache',
                'User-Agent': 'CloudCord-Client'
            }
        });
        
        if (!ghRes.ok) return res.status(ghRes.status).send('GitHub Error');
        
        const contentType = ghRes.headers.get('content-type') || 'text/plain';
        res.set('Content-Type', contentType);
        res.set('Cache-Control', 'no-store, max-age=0');
        
        const buffer = await ghRes.arrayBuffer();
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

app.get('/api/proxy/commits', checkClientAuth, async (req, res) => {
    const token = process.env.GITHUB_PAT;
    if (!token) return res.status(500).json({ error: 'Unconfigured' });
    
    try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/commits?page=${req.query.page || 1}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudCord-Client'
            }
        });
        if (!ghRes.ok) return res.status(ghRes.status).send('GitHub Error');
        const data = await ghRes.json();
        res.json(data);
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

app.get('/api/proxy/compare/:compareString', checkClientAuth, async (req, res) => {
    const token = process.env.GITHUB_PAT;
    if (!token) return res.status(500).json({ error: 'Unconfigured' });
    
    try {
        const ghRes = await fetch(`https://api.github.com/repos/${GITHUB_REPO}/compare/${req.params.compareString}`, {
            headers: {
                'Authorization': `Bearer ${token}`,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudCord-Client'
            }
        });
        if (!ghRes.ok) return res.status(ghRes.status).send('GitHub Error');
        const data = await ghRes.json();
        res.json(data);
    } catch (err) {
        res.status(500).send('Proxy Error');
    }
});

// Serve the source.html for /source route
app.get('/source', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'source.html'));
});

app.get('/join', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'join.html'));
});

// Intentionally unlisted in the site navigation. Share this route directly
// when staff applications are open.
app.get('/staff-application', (_req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'staff-application.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


