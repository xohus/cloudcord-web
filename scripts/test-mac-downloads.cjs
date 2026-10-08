const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const server = fs.readFileSync('server.js', 'utf8');
const page = fs.readFileSync('public/mac-install.html', 'utf8');
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
    assert.equal(output.url, `https://github.com/xohus/cloudcord/releases/download/mac-public-beta/CloudCord-mac-${architecture}-preview.dmg`);
    assert(page.includes(`/download/mac/${architecture}`));
}
let rejected = false;
handler({ params: { architecture: 'not-a-build' } }, { status: code => { assert.equal(code, 404); return { send: () => { rejected = true; } }; } });
assert(rejected);
assert(home.includes('href="/mac-install"'));
assert(!page.includes('github.com'));
assert(page.includes('Do not disable Gatekeeper'));
assert(page.includes('not guarantee safety'));
assert(page.includes('0/61 detections'));
assert(page.includes('0/60 detections'));
assert(page.includes('name="viewport"'));
console.log('PASS: Mac download handlers, architecture validation, website links and accurate security notes. Visual layout still needs browser verification.');
