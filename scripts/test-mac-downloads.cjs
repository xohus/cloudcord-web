const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const server = fs.readFileSync('server.js', 'utf8');
const home = fs.readFileSync('public/index.html', 'utf8');
const start = server.indexOf("app.get('/download/mac/:architecture'");
assert(start >= 0);
const end = server.indexOf('\n});', start) + 4;
let handler;
vm.runInNewContext(server.slice(start, end), { app: { get: (_path, fn) => { handler = fn; } } });
for (const architecture of ['arm64', 'x64']) {
    const output = {};
    handler({ params: { architecture } }, {
        set: (key, value) => { output[key] = value; },
        redirect: (status, url) => { output.status = status; output.url = url; }
    });
    assert.equal(output.status, 302);
    assert.equal(output['Cache-Control'], 'no-store');
    assert.equal(output.url, `https://github.com/xohus/cloudcord/releases/download/mac-public-beta/CloudCord-mac-${architecture}-56f21964c.dmg`);
    assert(home.includes(`/download/mac/${architecture}`));
}
let rejected = false;
handler({ params: { architecture: 'not-a-build' } }, { status: code => { assert.equal(code, 404); return { send: () => { rejected = true; } }; } });
assert(rejected);
assert(home.includes('id="mac-download-btn"'));
assert(home.includes('id="mac-downloads" hidden'));
assert(!home.includes('/mac-install'));
assert(!home.includes('ios-legacy-331'));
const script = fs.readFileSync('public/script.js', 'utf8');
assert(script.includes("macDownloadBtn.addEventListener('click', showMacDownloads)"));
assert(script.includes("macDownloadBack.addEventListener('click', showPlatformDownloads)"));
console.log('PASS: Mac architecture chooser, download handlers and removed 331 fallback.');
