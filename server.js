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
    skip: req => req.path === '/health'
});
app.use(siteLimiter);
// StoreCloud's sync endpoint accepts larger encrypted settings archives and
// applies its own 16 MB JSON limit. Mount it before the site's default parser
// so Express's 100 KB default does not reject valid sync requests first.
app.use(makeStoreCloudRouter(express));
app.use(makeMembershipRouter(express));
app.use(express.json({ limit: '256kb' }));

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

// Direct live installs proxy to bypass any CORS/client network issues
app.get(['/api/usage/installs', '/v1/usage/installs'], async (req, res) => {
    try {
        const workerRes = await fetch('https://cloudcord-profiles.ggxohus.workers.dev/v1/usage/installs', {
            headers: { 'Accept': 'application/json' }
        });
        if (workerRes.ok) {
            const data = await workerRes.json();
            return res.json(data);
        }
        res.json({ count: 99, metric: 'lifetime_official_downloads' });
    } catch (e) {
        res.json({ count: 99, metric: 'lifetime_official_downloads' });
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

// Serve static files
app.use(express.static(path.join(__dirname, 'public'), {
    extensions: ['html'],
    maxAge: '1h',
    etag: true
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

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});


