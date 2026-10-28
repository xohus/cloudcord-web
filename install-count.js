'use strict';
// Lifetime CloudCord installs: GitHub download counts of the installer files only
// (Windows setup, Mac .dmg, iOS .ipa, Android .apk). Update files such as
// cloudcord.asar and its .sha256 are fetched by installed apps on every update
// check, so counting them made the total grow by ~1,000 a day.

const RELEASES_URL = 'https://api.github.com/repos/xohus/cloudcord/releases?per_page=100';
const INSTALLER_RE = /\.(exe|dmg|ipa|apk)$/i;
const CACHE_MS = 5 * 60 * 1000;

function countInstalls(releases) {
    let count = 0;
    for (const release of releases || [])
        for (const asset of release.assets || [])
            if (INSTALLER_RE.test(asset.name)) count += Number(asset.download_count) || 0;
    return count;
}

function makeInstallCount({ fetchImpl = fetch, token = process.env.GITHUB_PAT } = {}) {
    let cached = null;
    return async function readInstallCount() {
        if (cached && Date.now() - cached.at < CACHE_MS) return cached.count;
        const headers = { accept: 'application/vnd.github+json', 'user-agent': 'cloudcord-web' };
        if (token) headers.authorization = `Bearer ${token}`;
        const response = await fetchImpl(RELEASES_URL, { headers, signal: AbortSignal.timeout(8000) });
        if (!response.ok) throw new Error(`GitHub returned ${response.status}`);
        const count = countInstalls(await response.json());
        cached = { count, at: Date.now() };
        return count;
    };
}

module.exports = { makeInstallCount, countInstalls };
