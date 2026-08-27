"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const TERMS_VERSION = "2026-08-27";
const REQUIRED = ["DATABASE_URL", "CLOUDCORD_DISCORD_CLIENT_ID", "CLOUDCORD_DISCORD_CLIENT_SECRET", "CLOUDCORD_DISCORD_BOT_TOKEN", "CLOUDCORD_DISCORD_GUILD_ID", "CLOUDCORD_DISCORD_REDIRECT_URI", "CLOUDCORD_MEMBERSHIP_SESSION_SECRET"];
const digest = value => crypto.createHmac("sha256", process.env.CLOUDCORD_MEMBERSHIP_SESSION_SECRET || "unconfigured").update(value).digest("hex");

function makeMembershipRouter(express) {
    const router = express.Router();
    const enabled = REQUIRED.every(name => Boolean(process.env[name]));
    const pool = enabled ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: process.env.NODE_ENV === "production" ? { rejectUnauthorized: false } : undefined }) : null;
    const pending = new Map();
    const schema = `CREATE TABLE IF NOT EXISTS cloudcord_membership_devices (
        device_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, terms_version TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    let ready;
    const ensureReady = () => ready ||= pool.query(schema);

    router.get("/api/cloudcord/onboarding/config", (_req, res) => {
        res.set("Cache-Control", "no-store").json({ enabled, termsVersion: TERMS_VERSION, termsUrl: "https://cloudcord.xohus.lol/tos" });
    });

    router.post("/api/cloudcord/onboarding/start", express.json({ limit: "8kb" }), async (req, res) => {
        if (!enabled) return res.status(503).json({ error: "CloudCord membership is not configured" });
        if (req.body?.termsVersion !== TERMS_VERSION || req.body?.accepted !== true) return res.status(400).json({ error: "Current Terms must be accepted" });
        await ensureReady();
        const state = crypto.randomBytes(32).toString("base64url");
        pending.set(state, { status: "pending", expires: Date.now() + 10 * 60_000 });
        const query = new URLSearchParams({ client_id: process.env.CLOUDCORD_DISCORD_CLIENT_ID, redirect_uri: process.env.CLOUDCORD_DISCORD_REDIRECT_URI, response_type: "code", scope: "identify guilds.join", state, prompt: "consent" });
        res.set("Cache-Control", "no-store").json({ state, authorizeUrl: `https://discord.com/oauth2/authorize?${query}` });
    });

    router.get("/discord/join/callback", async (req, res) => {
        const item = pending.get(String(req.query.state || ""));
        if (!enabled || !item || item.expires < Date.now() || typeof req.query.code !== "string") return res.status(400).send("Invalid or expired CloudCord authorization.");
        try {
            const tokenRes = await fetch("https://discord.com/api/v10/oauth2/token", { method: "POST", headers: { "Content-Type": "application/x-www-form-urlencoded" }, body: new URLSearchParams({ client_id: process.env.CLOUDCORD_DISCORD_CLIENT_ID, client_secret: process.env.CLOUDCORD_DISCORD_CLIENT_SECRET, grant_type: "authorization_code", code: req.query.code, redirect_uri: process.env.CLOUDCORD_DISCORD_REDIRECT_URI }) });
            if (!tokenRes.ok) throw new Error("Discord authorization failed");
            const token = await tokenRes.json();
            const userRes = await fetch("https://discord.com/api/v10/users/@me", { headers: { Authorization: `Bearer ${token.access_token}` } });
            if (!userRes.ok) throw new Error("Discord identity failed");
            const user = await userRes.json();
            const joinRes = await fetch(`https://discord.com/api/v10/guilds/${process.env.CLOUDCORD_DISCORD_GUILD_ID}/members/${user.id}`, { method: "PUT", headers: { Authorization: `Bot ${process.env.CLOUDCORD_DISCORD_BOT_TOKEN}`, "Content-Type": "application/json" }, body: JSON.stringify({ access_token: token.access_token }) });
            if (!joinRes.ok && joinRes.status !== 204) throw new Error("Discord server join failed");
            const deviceToken = crypto.randomBytes(32).toString("base64url");
            await pool.query("INSERT INTO cloudcord_membership_devices (device_hash,user_id,terms_version) VALUES ($1,$2,$3) ON CONFLICT (device_hash) DO NOTHING", [digest(deviceToken), user.id, TERMS_VERSION]);
            pending.set(req.query.state, { status: "complete", expires: Date.now() + 2 * 60_000, deviceToken });
            res.set("Cache-Control", "no-store").send("CloudCord verification complete. You may return to Discord.");
        } catch (error) {
            console.error("[CLOUDCORD MEMBERSHIP]", error);
            pending.set(req.query.state, { status: "error", expires: Date.now() + 2 * 60_000 });
            res.status(502).send("CloudCord could not complete Discord verification.");
        }
    });

    router.get("/api/cloudcord/onboarding/status/:state", (req, res) => {
        const item = pending.get(req.params.state);
        if (!item || item.expires < Date.now()) return res.status(404).json({ status: "expired" });
        if (item.status === "complete") { pending.delete(req.params.state); return res.json({ status: "complete", deviceToken: item.deviceToken }); }
        res.json({ status: item.status });
    });

    router.get("/api/cloudcord/membership", async (req, res) => {
        if (!enabled) return res.status(503).json({ enabled: false });
        const token = String(req.get("authorization") || "").replace(/^Bearer\s+/i, "");
        const record = await pool.query("SELECT user_id,terms_version FROM cloudcord_membership_devices WHERE device_hash=$1", [digest(token)]);
        if (!record.rowCount || record.rows[0].terms_version !== TERMS_VERSION) return res.status(401).json({ member: false, reauthorize: true });
        const memberRes = await fetch(`https://discord.com/api/v10/guilds/${process.env.CLOUDCORD_DISCORD_GUILD_ID}/members/${record.rows[0].user_id}`, { headers: { Authorization: `Bot ${process.env.CLOUDCORD_DISCORD_BOT_TOKEN}` } });
        await pool.query("UPDATE cloudcord_membership_devices SET last_checked_at=NOW() WHERE device_hash=$1", [digest(token)]);
        res.set("Cache-Control", "no-store").json({ member: memberRes.ok, reauthorize: !memberRes.ok });
    });

    return router;
}

module.exports = { makeMembershipRouter };
