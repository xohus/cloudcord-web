const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('server.js', 'utf8');
const start = source.indexOf("let runtimeCommit =");
const end = source.indexOf("app.get('/api/proxy/commits'", start);
const commit = 'a'.repeat(40);
let handler;
const requests = [];
vm.runInNewContext(source.slice(start, end), {
    app: { get: (_path, _auth, fn) => { handler = fn; } },
    checkClientAuth: () => {}, process: { env: { GITHUB_PAT: 'expired-test-token' } }, GITHUB_REPO: 'xohus/cloudcord', URL, Buffer,
    fetch: async (url, options) => {
        requests.push(String(url));
        if (String(url).includes('api.github.com') && options.headers.Authorization) return { ok: false, status: 401 };
        return { ok: true, headers: { get: () => 'application/json' },
            json: async () => String(url).includes('api.github.com') ? { sha: commit } : { sha256: 'hash', size: 123 },
            arrayBuffer: async () => Buffer.from('runtime') };
    },
});
(async () => {
    let manifest;
    const response = { set: () => {}, json: value => { manifest = value; }, send: () => {}, status: () => response };
    await handler({ params: { 0: 'dist/runtime-manifest.json' }, query: {} }, response);
    assert.equal(requests.filter(url => url.includes('api.github.com')).length, 2);
    assert.equal(manifest.url, `https://getcloudcord.com/api/proxy/raw/dist/cc.js?ref=${commit}`);
    const pinned = 'b'.repeat(40);
    requests.length = 0;
    await handler({ params: { 0: 'dist/cc.js' }, query: { ref: pinned } }, response);
    assert.equal(requests.length, 1);
    assert(requests[0].includes(`/${pinned}/dist/cc.js`));
    requests.length = 0;
    await handler({ params: { 0: 'dist/cc.js' }, query: { ref: '../../bad' } }, response);
    assert(requests[0].includes(`/${commit}/dist/cc.js`));
    console.log('PASS: manifest pins runtime bytes to a commit; pinned requests survive branch changes; invalid refs cannot select paths.');
})().catch(error => { console.error(error); process.exitCode = 1; });
