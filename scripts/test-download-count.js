const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('public/script.js', 'utf8');
const block = source.slice(source.indexOf('    // 7.'), source.lastIndexOf('\n});'));
const metric = 'lifetime_official_downloads';
async function run(payload, options = {}) {
    const element = {}, calls = [], cache = new Map(Object.entries(options.cache || {}));
    let refresh;
    const storage = {
        getItem: key => cache.get(key) ?? null,
        removeItem: key => cache.delete(key),
        setItem: (key, value) => cache.set(key, value)
    };
    if (options.blockStorage) for (const key of Object.keys(storage)) storage[key] = () => { throw Error('storage disabled'); };
    vm.runInNewContext(block, {
        document: { getElementById: () => element }, localStorage: storage, AbortSignal,
        console: { error() {} }, setInterval: fn => { refresh = fn; },
        fetch: async url => {
            calls.push(url);
            if (options.fail || options.failProxy && url.startsWith('/')) throw Error('offline');
            return { ok: true, json: async () => payload };
        }
    });
    await new Promise(setImmediate);
    return { element, calls, cache, refresh };
}
(async () => {
    let result = await run({ count: 1113, metric }, { cache: { cloudcordVerifiedInstallCount: '1613' } });
    assert.equal(result.element.innerText, (1113).toLocaleString());
    assert(!result.cache.has('cloudcordVerifiedInstallCount'));
    assert.equal(result.cache.get('cloudcordVerifiedDownloadCountV2'), '1113');
    result = await run({ count: 0, metric }, { blockStorage: true });
    assert.equal(result.element.innerText, '0', 'zero is valid and storage failures cannot hide live data');
    result = await run({ count: 42, metric }, { failProxy: true });
    assert.equal(result.calls.length, 2);
    assert.equal(result.element.innerText, '42');
    for (const count of [null, '', '123', -1, 1.5, Number.MAX_SAFE_INTEGER + 1]) {
        result = await run({ count, metric });
        assert.equal(result.element.innerText, '—', `invalid count ${count} must not become a number`);
    }
    result = await run({ count: 500, metric: 'different_metric' });
    assert.equal(result.element.innerText, '—');
    result = await run(null, { fail: true, cache: { cloudcordVerifiedInstallCount: '999999' } });
    assert.equal(result.element.innerText, '—', 'never show the inflated legacy cache during an outage');
    result = await run(null, { fail: true, cache: { cloudcordVerifiedDownloadCountV2: '0' } });
    assert.equal(result.element.innerText, '0', 'a verified zero survives an outage');
    assert.match(result.element.title, /last verified/);
    const html = fs.readFileSync('public/index.html', 'utf8');
    assert.match(html, /id="install-counter">—</);
    assert(!html.includes('Live Installs'));
    console.log('PASS exact download totals, inflated-cache migration, zero, blocked storage, fallback, malformed data and outages');
})().catch(error => { console.error(error); process.exitCode = 1; });
