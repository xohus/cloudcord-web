'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function loadPrivateSettings() {
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.config');
    const file = process.env.CLOUDCORD_SETTINGS_FILE || path.join(base, 'CloudCord', 'web', 'settings.json');
    if (!fs.existsSync(file)) return;
    const settings = JSON.parse(fs.readFileSync(file, 'utf8'));
    for (const [name, value] of Object.entries(settings)) {
        if (/^[A-Z][A-Z0-9_]*$/.test(name) && typeof value === 'string' && !process.env[name]) process.env[name] = value;
    }
}
module.exports = { loadPrivateSettings };
