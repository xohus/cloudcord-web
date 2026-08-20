"use strict";

const crypto = require("crypto");
const rateLimit = require("express-rate-limit");
const { Pool } = require("pg");

const MAX_ITEM_BYTES = 5 * 1024 * 1024;
const MAX_TOTAL_BYTES = 15 * 1024 * 1024;
const KEY_PATTERN = /^(settings|quickCss|dataStore(?:\/[A-Za-z0-9_.:-]{1,180})?)$/;

function requiredEnv(name) {
    const value = process.env[name];
    if (!value) throw new Error(`StoreCloud requires ${name}`);
    return value;
}

function encryptionKey() {
    const raw = requiredEnv("STORECLOUD_ENCRYPTION_KEY");
    const decoded = Buffer.from(raw, "base64");
    if (decoded.length !== 32) throw new Error("STORECLOUD_ENCRYPTION_KEY must be 32 random bytes encoded as base64");
    return decoded;
}

function digest(value) {
    return crypto.createHash("sha256").update(value).digest("hex");
}

function checksum(value) {
    return digest(value).slice(0, 16);
}

function seal(value) {
    const iv = crypto.randomBytes(12);
    const cipher = crypto.createCipheriv("aes-256-gcm", encryptionKey(), iv);
    const ciphertext = Buffer.concat([cipher.update(value), cipher.final()]);
    return Buffer.concat([iv, cipher.getAuthTag(), ciphertext]);
}

function open(value) {
    const iv = value.subarray(0, 12);
    const tag = value.subarray(12, 28);
    const decipher = crypto.createDecipheriv("aes-256-gcm", encryptionKey(), iv);
    decipher.setAuthTag(tag);
    return Buffer.concat([decipher.update(value.subarray(28)), decipher.final()]);
}

function makeStoreCloudRouter(express) {
    const router = express.Router();
    const pool = process.env.DATABASE_URL
        ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined })
        : null;
    const redirectUri = process.env.DISCORD_REDIRECT_URI || "https://cloudcord.xohus.lol/v1/oauth/callback";
    const limiter = rateLimit({ windowMs: 60_000, limit: 90, standardHeaders: true, legacyHeaders: false });

    const ready = pool?.query(`
        CREATE TABLE IF NOT EXISTS storecloud_devices (
            user_id TEXT NOT NULL,
            secret_hash TEXT NOT NULL,
            created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            last_used_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, secret_hash)
        );
        CREATE TABLE IF NOT EXISTS storecloud_items (
            user_id TEXT NOT NULL,
            key TEXT NOT NULL,
            value BYTEA NOT NULL,
            checksum TEXT NOT NULL,
            version BIGINT NOT NULL,
            byte_size INTEGER NOT NULL,
            updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW(),
            PRIMARY KEY (user_id, key)
        );
    `);

    // OAuth configuration is static and must remain available even while the
    // database is recovering. Scope readiness checks to routes that need it so
    // StoreCloud cannot take down the website or public status endpoint.
    router.get("/v1/oauth/settings", (_req, res) => res.json({ clientId: requiredEnv("DISCORD_CLIENT_ID"), redirectUri }));

    router.use(["/v1/oauth/callback", "/v2"], limiter);
    router.use(["/v1/oauth/callback", "/v2"], async (_req, res, next) => {
        if (!ready) return res.status(503).json({ error: "StoreCloud database is not configured" });
        try { await ready; next(); }
        catch (error) { console.error("[STORECLOUD] database initialization failed", error); res.status(503).json({ error: "StoreCloud is unavailable" }); }
    });

    router.get("/v1/oauth/callback", async (req, res) => {
        if (typeof req.query.code !== "string" || req.query.code.length > 256)
            return res.status(400).json({ error: "Missing OAuth code" });
        try {
            const tokenResponse = await fetch("https://discord.com/api/v10/oauth2/token", {
                method: "POST",
                headers: { "Content-Type": "application/x-www-form-urlencoded" },
                body: new URLSearchParams({
                    client_id: requiredEnv("DISCORD_CLIENT_ID"),
                    client_secret: requiredEnv("DISCORD_CLIENT_SECRET"),
                    grant_type: "authorization_code",
                    code: req.query.code,
                    redirect_uri: redirectUri
                })
            });
            if (!tokenResponse.ok) return res.status(401).json({ error: "Discord authorization failed" });
            const token = await tokenResponse.json();
            const userResponse = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
            if (!userResponse.ok) return res.status(401).json({ error: "Discord identity verification failed" });
            const user = await userResponse.json();
            if (!/^\d{15,22}$/.test(user.id)) return res.status(401).json({ error: "Invalid Discord identity" });

            const secret = crypto.randomBytes(32).toString("base64url");
            await pool.query("INSERT INTO storecloud_devices (user_id, secret_hash) VALUES ($1, $2)", [user.id, digest(secret)]);
            res.set("Cache-Control", "no-store").json({ secret });
        } catch (error) {
            console.error("[STORECLOUD] OAuth callback failed", error);
            res.status(502).json({ error: "Authorization service unavailable" });
        }
    });

    async function authenticate(req, res, next) {
        try {
            const header = req.get("authorization");
            if (!header || header.length > 512) return res.status(401).json({ error: "Unauthorized" });
            const decoded = Buffer.from(header.replace(/^Basic\s+/i, ""), "base64").toString("utf8");
            const separator = decoded.lastIndexOf(":");
            if (separator < 1) return res.status(401).json({ error: "Unauthorized" });
            const secret = decoded.slice(0, separator);
            const userId = decoded.slice(separator + 1);
            if (!/^\d{15,22}$/.test(userId)) return res.status(401).json({ error: "Unauthorized" });
            const result = await pool.query("UPDATE storecloud_devices SET last_used_at = NOW() WHERE user_id = $1 AND secret_hash = $2 RETURNING user_id", [userId, digest(secret)]);
            if (!result.rowCount) return res.status(401).json({ error: "Unauthorized" });
            req.storeCloudUserId = userId;
            next();
        } catch (error) {
            next(error);
        }
    }

    router.post("/v2/sync", authenticate, express.json({ limit: "16mb" }), async (req, res, next) => {
        const client = await pool.connect();
        try {
            const clientManifest = Array.isArray(req.body?.client_manifest) ? req.body.client_manifest : [];
            const uploads = Array.isArray(req.body?.uploads) ? req.body.uploads : [];
            if (clientManifest.length > 64 || uploads.length > 64) return res.status(413).json({ error: "Too many sync items" });

            await client.query("BEGIN");
            const sizeResult = await client.query("SELECT COALESCE(SUM(byte_size), 0)::bigint AS total FROM storecloud_items WHERE user_id = $1", [req.storeCloudUserId]);
            let total = Number(sizeResult.rows[0].total);
            const uploaded = [];
            const errors = [];

            for (const upload of uploads) {
                try {
                    if (typeof upload?.key !== "string" || !KEY_PATTERN.test(upload.key)) throw new Error("Unsupported sync key");
                    if (typeof upload.value !== "string") throw new Error("Invalid value");
                    const value = Buffer.from(upload.value, "base64");
                    if (value.length > MAX_ITEM_BYTES) throw new Error("Item is too large");
                    const actualChecksum = checksum(value);
                    if (upload.checksum && upload.checksum !== actualChecksum) throw new Error("Checksum mismatch");
                    const old = await client.query("SELECT byte_size FROM storecloud_items WHERE user_id = $1 AND key = $2", [req.storeCloudUserId, upload.key]);
                    const nextTotal = total - Number(old.rows[0]?.byte_size || 0) + value.length;
                    if (nextTotal > MAX_TOTAL_BYTES) throw new Error("Storage quota exceeded");
                    const version = Date.now();
                    await client.query(`INSERT INTO storecloud_items (user_id, key, value, checksum, version, byte_size)
                        VALUES ($1, $2, $3, $4, $5, $6)
                        ON CONFLICT (user_id, key) DO UPDATE SET value = EXCLUDED.value, checksum = EXCLUDED.checksum, version = EXCLUDED.version, byte_size = EXCLUDED.byte_size, updated_at = NOW()`,
                    [req.storeCloudUserId, upload.key, seal(value), actualChecksum, version, value.length]);
                    total = nextTotal;
                    uploaded.push({ key: upload.key, version, checksum: actualChecksum });
                } catch (error) { errors.push({ key: String(upload?.key || "unknown"), error: error.message }); }
            }

            const result = await client.query("SELECT key, value, checksum, version FROM storecloud_items WHERE user_id = $1 ORDER BY key", [req.storeCloudUserId]);
            const clientVersions = new Map(clientManifest.map(entry => [entry.key, `${entry.version}:${entry.checksum}`]));
            const serverManifest = result.rows.map(row => ({ key: row.key, version: Number(row.version), checksum: row.checksum }));
            const downloads = result.rows
                .filter(row => clientVersions.get(row.key) !== `${Number(row.version)}:${row.checksum}`)
                .map(row => ({ key: row.key, value: open(row.value).toString("base64"), version: Number(row.version), checksum: row.checksum }));
            await client.query("COMMIT");
            res.set("Cache-Control", "no-store").json({ server_manifest: serverManifest, downloads, uploaded, errors });
        } catch (error) {
            await client.query("ROLLBACK");
            next(error);
        } finally { client.release(); }
    });

    router.get("/v2/manifest", authenticate, async (req, res, next) => {
        try {
            const result = await pool.query("SELECT key, version, checksum FROM storecloud_items WHERE user_id = $1 ORDER BY key", [req.storeCloudUserId]);
            res.json({ entries: result.rows.map(row => ({ key: row.key, version: Number(row.version), checksum: row.checksum })) });
        } catch (error) { next(error); }
    });

    router.delete("/v2/data/:key", authenticate, async (req, res, next) => {
        try {
            if (!KEY_PATTERN.test(req.params.key)) return res.status(400).json({ error: "Invalid key" });
            const result = await pool.query("DELETE FROM storecloud_items WHERE user_id = $1 AND key = $2", [req.storeCloudUserId, req.params.key]);
            res.sendStatus(result.rowCount ? 204 : 404);
        } catch (error) { next(error); }
    });

    router.get("/v2/status", async (_req, res) => {
        try { await pool.query("SELECT 1"); res.json({ service: "StoreCloud", status: "ok" }); }
        catch { res.status(503).json({ service: "StoreCloud", status: "unavailable" }); }
    });

    return router;
}

module.exports = { makeStoreCloudRouter };

