const assert = require('node:assert/strict');
const fs = require('node:fs');
const css = fs.readFileSync('public/brand-icons.css', 'utf8');
assert.match(css, /body img\[src\*="cloudcord-favicon\.png"\][\s\S]*?filter: brightness\(0\) invert\(1\)/);
assert.match(css, /body\.light img\[src\*="cloudcord-favicon\.png"\][\s\S]*?filter: brightness\(0\);/);
assert.match(css, /object-fit: contain/);
assert.match(fs.readFileSync('public/styles.css', 'utf8'), /@import url\("\/brand-icons\.css/);
for (const file of ['public/upload.html', 'public/join.html']) assert.match(fs.readFileSync(file, 'utf8'), /href="\/brand-icons\.css/);
console.log('PASS: dark/light cloud icon styles, undistorted aspect ratio and standalone page coverage');
