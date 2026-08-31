"use strict";

const crypto = require("crypto");
const { Pool } = require("pg");

const TERMS_VERSION = "2026-08-27";
const REQUIRED = ["DATABASE_URL", "CLOUDCORD_DISCORD_CLIENT_ID", "CLOUDCORD_DISCORD_CLIENT_SECRET", "CLOUDCORD_DISCORD_BOT_TOKEN", "CLOUDCORD_DISCORD_GUILD_ID", "CLOUDCORD_DISCORD_REDIRECT_URI", "CLOUDCORD_MEMBERSHIP_SESSION_SECRET"];
const digest = value => crypto.createHmac("sha256", process.env.CLOUDCORD_MEMBERSHIP_SESSION_SECRET || "unconfigured").update(value).digest("hex");
const databaseSsl = () => ["require", "required", "true", "1"].includes(String(process.env.DATABASE_SSL || process.env.PGSSLMODE || "").toLowerCase())
    ? { rejectUnauthorized: false }
    : false;

function makeMembershipRouter(express) {
    const router = express.Router();
    const enabled = REQUIRED.every(name => Boolean(process.env[name]));
    const oauth2Off = ["true", "1", "yes", "on"].includes(String(process.env.OAUTH2_OFF || process.env["oauth2-off"] || "").toLowerCase());
    const pool = enabled ? new Pool({ connectionString: process.env.DATABASE_URL, ssl: databaseSsl() }) : null;
    const pending = new Map();
    const schema = `CREATE TABLE IF NOT EXISTS cloudcord_membership_devices (
        device_hash TEXT PRIMARY KEY, user_id TEXT NOT NULL, terms_version TEXT NOT NULL,
        created_at TIMESTAMPTZ NOT NULL DEFAULT NOW(), last_checked_at TIMESTAMPTZ NOT NULL DEFAULT NOW()
    )`;
    let ready;
    const ensureReady = () => ready ||= pool.query(schema);

    router.get("/api/cloudcord/onboarding/config", (_req, res) => {
        res.set("Cache-Control", "no-store").json({ enabled, oauth2Off, termsVersion: TERMS_VERSION, termsUrl: "https://cloudcord.xohus.lol/tos", guildId: enabled ? process.env.CLOUDCORD_DISCORD_GUILD_ID : null });
    });

    router.post("/api/cloudcord/onboarding/start", express.json({ limit: "8kb" }), async (req, res) => {
        if (!enabled || oauth2Off) return res.status(503).json({ error: oauth2Off ? "CloudCord OAuth is temporarily disabled" : "CloudCord membership is not configured" });
        if (req.body?.termsVersion !== TERMS_VERSION || req.body?.accepted !== true) return res.status(400).json({ error: "Current Terms must be accepted" });
        await ensureReady();
        const state = crypto.randomBytes(32).toString("base64url");
        pending.set(state, { status: "pending", expires: Date.now() + 10 * 60_000 });
        const query = new URLSearchParams({ client_id: process.env.CLOUDCORD_DISCORD_CLIENT_ID, redirect_uri: process.env.CLOUDCORD_DISCORD_REDIRECT_URI, response_type: "code", scope: "identify guilds.join", state, prompt: "consent" });
        res.set("Cache-Control", "no-store").json({ state, authorizeUrl: `https://discord.com/oauth2/authorize?${query}` });
    });

    router.get("/discord/join/callback", async (req, res) => {
        const item = pending.get(String(req.query.state || ""));
        if (!enabled || !item || item.expires < Date.now()) return res.status(400).send("Invalid or expired CloudCord authorization.");
        if (req.query.error === "access_denied") {
            pending.set(req.query.state, { status: "blacklisted", expires: Date.now() + 10 * 60_000 });
            return res.status(200).type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>CloudCord access denied</title><style>body{margin:0;background:#111214;color:#f2f3f5;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}.card{padding:32px;border:1px solid #3f4147;border-radius:16px;background:#1e1f22;max-width:380px}h1{margin:0 0 10px;font-size:24px}p{color:#b5bac1}</style><div class="card"><h1>Access denied</h1><p>CloudCord access was denied. Return to Discord.</p></div>`);
        }
        if (typeof req.query.code !== "string") return res.status(400).send("Invalid CloudCord authorization response.");
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
            const state = JSON.stringify(String(req.query.state));
            res.set("Cache-Control", "no-store").type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>CloudCord verified</title><style>body{margin:0;background:#111214;color:#f2f3f5;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}.card{padding:32px;border:1px solid #2b2d31;border-radius:16px;background:#1e1f22;max-width:380px}h1{margin:0 0 10px;font-size:24px}p{color:#b5bac1}</style><div class="card"><h1>You're verified</h1><p>You joined the CloudCord server. This window can close now.</p></div><script>const state=${state};if(window.opener){window.opener.postMessage({type:"cloudcord-oauth-complete",state},location.origin);setTimeout(()=>window.close(),700)}else{location.replace("/join?state="+encodeURIComponent(state))}</script>`);
        } catch (error) {
            console.error("[CLOUDCORD MEMBERSHIP]", error);
            pending.set(req.query.state, { status: "error", expires: Date.now() + 2 * 60_000 });
            res.status(200).type("html").send(`<!doctype html><meta name="viewport" content="width=device-width"><title>CloudCord verification</title><style>body{margin:0;background:#111214;color:#f2f3f5;font:16px system-ui;display:grid;place-items:center;min-height:100vh;text-align:center}.card{padding:32px;border:1px solid #3f4147;border-radius:16px;background:#1e1f22;max-width:380px}h1{margin:0 0 10px;font-size:24px}p{color:#b5bac1}</style><div class="card"><h1>Verification could not finish</h1><p>Return to CloudCord and try again. If this continues, check that the CloudCord bot is inside the server and the bot token and server ID are correct.</p></div>`);
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
