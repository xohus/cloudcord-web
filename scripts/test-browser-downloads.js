const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');
const source = fs.readFileSync('server.js', 'utf8');
const routes = new Map();
const block = source.slice(source.indexOf('for (const [browser, asset]'), source.indexOf("app.get('/api/browser/release'"));
vm.runInNewContext(block, { app: { get: (paths, handler) => { for (const path of paths) routes.set(path, handler); } } });
for (const [browser, old, asset] of [['chrome', 'CloudCord-Chrome-Brave.zip', 'extension-chrome.zip'], ['firefox', 'CloudCord-Firefox.zip', 'extension-firefox.zip'], ['userscript', 'CloudCord.user.js', 'CloudCord.user.js']]) {
    for (const path of [`/download/browser/${browser}`, `/downloads/${old}`]) {
        const res = { set(key, value) { assert.equal(key, 'Cache-Control'); assert.equal(value, 'no-store'); return this; }, redirect(status, url) { assert.equal(status, 302); assert.ok(url.startsWith(`https://github.com/xohus/cloudcord/releases/download/new_beta_t_desktop/${asset}?v=`)); } };
        routes.get(path)({}, res);
    }
    assert.ok(fs.readFileSync('public/index.html', 'utf8').includes(`href="/download/browser/${browser}"`));
}
console.log('browser downloads passed: current buttons, legacy links and cache bypass');
