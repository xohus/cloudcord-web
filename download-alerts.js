'use strict';
// Download alerts for the CloudCord Discord: a webhook message for new downloads,
// @here every 1,000 and @everyone every 5,000 verified downloads.
//
// The verified total is the website's install count (installer downloads only).
// It is polled, so downloads from any link are counted; the website's own /download
// routes add which platform people picked. The last announced total is kept in
// Postgres so restarts never repeat or skip a milestone.
//
// Configure with CLOUDCORD_DOWNLOADS_WEBHOOK_URL (a Discord webhook URL).

const POLL_MS = 60 * 1000;
const SOON_MS = 15 * 1000;
const USAGE_URL = 'https://cloudcord-profiles.ggxohus.workers.dev/v1/usage/installs';
const PLATFORM_LABELS = { windows: 'Windows', mac: 'macOS', ios: 'iOS', android: 'Android' };

function milestoneFor(previous, current) {
    // The highest milestone crossed between the two totals, if any.
    const five = Math.floor(current / 5000) * 5000;
    if (five > previous && five > 0) return { total: five, mention: '@everyone' };
    const thousand = Math.floor(current / 1000) * 1000;
    if (thousand > previous && thousand > 0) return { total: thousand, mention: '@here' };
    return null;
}

function platformSummary(counts) {
    const parts = Object.entries(counts).filter(([, n]) => n > 0).map(([key, n]) => `${PLATFORM_LABELS[key] || key} ${n}`);
    return parts.length ? parts.join(' · ') : '';
}

function makeDownloadAlerts({ db, webhookUrl, readTotal: readTotalOverride, fetchImpl = fetch, now = () => Date.now(), logger = console }) {
    const enabled = !!webhookUrl && /^https:\/\/(?:ptb\.|canary\.)?discord(?:app)?\.com\/api\/webhooks\/\d+\/[\w-]+$/.test(webhookUrl);
    const platformHits = {};
    let lastCount = null;
    let timer = null;
    let soonTimer = null;
    let checking = false;

    const ready = db
        ? db.query('CREATE TABLE IF NOT EXISTS cloudcord_download_alerts (id TEXT PRIMARY KEY, last_count BIGINT NOT NULL, updated_at TIMESTAMPTZ NOT NULL DEFAULT NOW())')
            .then(() => db.query("SELECT last_count FROM cloudcord_download_alerts WHERE id = 'total'"))
            .then(result => { if (result.rows[0]) lastCount = Number(result.rows[0].last_count); })
            .catch(error => logger.error('download alerts: could not prepare storage:', error.message))
        : Promise.resolve();

    async function saveCount(count) {
        lastCount = count;
        if (!db) return;
        await db.query("INSERT INTO cloudcord_download_alerts (id, last_count) VALUES ('total', $1) ON CONFLICT (id) DO UPDATE SET last_count = $1, updated_at = NOW()", [count]);
    }

    async function post(content, mention) {
        // Retry once when Discord rate limits the webhook.
        for (let attempt = 0; attempt < 2; attempt++) {
            const response = await fetchImpl(webhookUrl, {
                method: 'POST',
                headers: { 'content-type': 'application/json' },
                body: JSON.stringify({ content: content.slice(0, 2000), allowed_mentions: { parse: mention ? ['everyone'] : [] } })
            });
            if (response.status === 429 && attempt === 0) {
                const body = await response.json().catch(() => ({}));
                await new Promise(resolve => setTimeout(resolve, Math.min(10000, Math.ceil((Number(body.retry_after) || 2) * 1000))));
                continue;
            }
            if (!response.ok) throw new Error(`webhook returned ${response.status}`);
            return;
        }
    }

    async function readTotal() {
        if (readTotalOverride) return readTotalOverride();
        const response = await fetchImpl(USAGE_URL, { headers: { accept: 'application/json' }, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`usage service returned ${response.status}`);
        const count = Number((await response.json())?.count);
        if (!Number.isSafeInteger(count) || count < 0) throw new Error('usage service returned an invalid count');
        return count;
    }

    async function check() {
        if (!enabled || checking) return;
        checking = true;
        try {
            await ready;
            const count = await readTotal();
            // First run: start from today's total so old downloads aren't announced.
            if (lastCount === null) { await saveCount(count); return; }
            if (count <= lastCount) return;
            const added = count - lastCount;
            const platforms = platformSummary(platformHits);
            for (const key of Object.keys(platformHits)) platformHits[key] = 0;
            const total = count.toLocaleString('en-US');
            const line = added === 1
                ? `Someone downloaded CloudCord${platforms ? ` for ${platforms.replace(/ 1$/, '')}` : ''}. Total: **${total}**`
                : `**${added.toLocaleString('en-US')}** new CloudCord downloads${platforms ? ` (${platforms})` : ''}. Total: **${total}**`;
            await post(line, null);
            const milestone = milestoneFor(lastCount, count);
            if (milestone) await post(`${milestone.mention} CloudCord just passed **${milestone.total.toLocaleString('en-US')}** downloads! Thank you all.`, milestone.mention);
            await saveCount(count);
        } catch (error) {
            logger.error('download alerts:', error.message);
        } finally {
            checking = false;
        }
    }

    return {
        enabled,
        /** Call from a /download route; counts the platform and checks the total soon. */
        noteDownload(platform) {
            if (!enabled) return;
            platformHits[platform] = (platformHits[platform] || 0) + 1;
            if (!soonTimer) soonTimer = setTimeout(() => { soonTimer = null; void check(); }, SOON_MS);
        },
        start() {
            if (!enabled) { if (webhookUrl) logger.error('download alerts: CLOUDCORD_DOWNLOADS_WEBHOOK_URL is not a Discord webhook URL'); return; }
            void check();
            timer = setInterval(() => void check(), POLL_MS);
            timer.unref?.();
        },
        stop() { clearInterval(timer); clearTimeout(soonTimer); },
        check
    };
}

module.exports = { makeDownloadAlerts, milestoneFor };
