const fs = require('node:fs');
const assert = require('node:assert/strict');
const html = fs.readFileSync('public/index.html', 'utf8');
const nav = html.match(/<nav\b[\s\S]*?<\/nav>/)[0];
assert.match(nav, /assets\/cloudcord-favicon\.png/);
assert.doesNotMatch(nav, /wordmark|logo-full/);
assert.doesNotMatch(html, /fixed and online/);
assert.doesNotMatch(html, /next-gen|zero compromises|ultimate chat experience/i);
assert.match(html, /hero-logo-frame/);
assert.match(html, />Windows<\/span>/);
for (const page of ['index', 'features', 'faq', 'team', 'plugins', 'changelog', 'status']) {
    const text = fs.readFileSync(`public/${page}.html`, 'utf8');
    assert.doesNotMatch(text, /class="(?:announcement-bar|has-announcement)"/);
}
assert.match(html, /assets\/logo-full\.png/);
const css = fs.readFileSync('public/styles.css', 'utf8');
assert.doesNotMatch(css, /mask-image:/);
assert.match(css, /filter: url\("#cloudcord-remove-black"\)/);
assert.match(html, /id="cloudcord-remove-black"/);
assert.ok(fs.existsSync('public/assets/logo-full.png'));
console.log('header icon, transparent logo references, Windows label and announcement removal passed');
