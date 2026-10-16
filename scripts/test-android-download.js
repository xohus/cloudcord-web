const fs = require('node:fs');
const vm = require('node:vm');
const assert = require('node:assert/strict');

const source = fs.readFileSync(require('node:path').join(__dirname, '../server.js'), 'utf8');
const start = source.indexOf("app.get('/download/android',");
const end = source.indexOf('// Session setup', start);
assert(start >= 0 && end > start);
const routes = {};
vm.runInNewContext(source.slice(start, end), { app: { get: (path, handler) => { routes[path] = handler; } } });
let html = '', url = '';
const response = {
    set: () => response,
    type: () => response,
    send: value => { html = value; },
    redirect: (status, value) => { assert.equal(status, 302); url = value; }
};
routes['/download/android']({}, response);
routes['/download/android/apk']({}, response);
assert(html.includes('installs separately'));
assert(html.includes('Do not uninstall'));
assert(html.includes('Fetches the latest Discord version'));
assert(!html.includes('currently targets Discord 344.13'));
assert(html.includes('Compatibility with every new Discord release is not guaranteed'));
assert(html.includes('OSL-3.0'));
assert.equal(url, 'https://github.com/xohus/cloudcord/releases/download/new_beta_android/CloudCordManager-Test2-7829c8f.apk');
console.log('PASS Android warning page and pinned repair download route');
