const assert = require('node:assert/strict');
const fs = require('node:fs');
const vm = require('node:vm');
const source = fs.readFileSync('public/script.js', 'utf8');
const block = source.slice(source.indexOf("let tiltImages = document.querySelectorAll('.tilt-img');"), source.indexOf('// Image crossfade carousel')) + '\n}';
function run(userAgent, maxTouchPoints) {
    const image = () => ({ classList: { remove() {} }, removeAttribute() {}, setAttribute() {}, cloneNode: image });
    const images = [image(), image()];
    const showcase = { appendChild: item => images.push(item), querySelectorAll: () => images };
    vm.runInNewContext(block, { navigator: { userAgent, maxTouchPoints }, document: { querySelectorAll: () => images, getElementById: () => showcase } });
    return images;
}
const mac = run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 0);
assert.equal(mac.length, 3);
for (const [index, screen] of ['messages', 'profile', 'settings'].entries()) {
    assert.equal(mac[index].src, `/assets/mac/${screen}.jpg`);
    assert(fs.existsSync(`public/assets/mac/${screen}.jpg`));
}
assert.equal(run('Mozilla/5.0 (Macintosh; Intel Mac OS X 10_15_7)', 5)[0].src, 'ipad-client1.jpg');
assert.equal(run('Mozilla/5.0 (iPhone; CPU iPhone OS 18_0 like Mac OS X)', 5)[0].src, 'iphone-client1.jpg');
assert.equal(run('Mozilla/5.0 (Linux; Android 15)', 5)[0].src, '/assets/android/messages.jpg');
assert.equal(run('Mozilla/5.0 (Windows NT 10.0; Win64; x64)', 0)[0].src, undefined);
console.log('PASS: macOS loads all three screenshots; iPad, iPhone, Android and Windows previews preserved.');
