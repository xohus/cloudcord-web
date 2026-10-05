const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)[0];
assert.match(nav, /assets\/cloudcord-favicon\.png/);
assert.doesNotMatch(nav, /wordmark|logo-full/);
assert.doesNotMatch(html, /fixed and online/);
assert.match(html, />Windows<\/span>/);
for (const page of ['index', 'features', 'faq', 'team', 'plugins', 'changelog', 'status']) {
    const text = fs.readFileSync(`public/${page}.html`, 'utf8');
    assert.doesNotMatch(text, /class="(?:announcement-bar|has-announcement)"/);
}
assert.match(html, /assets\/cloudcord-wordmark\.png/);
const css = fs.readFileSync('public/styles.css', 'utf8');
assert.match(css, /mask-mode: luminance/);
assert.ok(fs.existsSync('public/assets/cloudcord-wordmark.png'));
console.log('header icon, transparent logo references, Windows label and announcement removal passed');
