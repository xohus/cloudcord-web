const crypto = require('crypto');

const durations = new Set(['7d', '30d', '90d', '6m', '1y', 'lifetime']);
const duration = String(process.argv[2] || '').toLowerCase();

if (!durations.has(duration)) {
    console.error('Usage: npm run key -- 7d|30d|90d|6m|1y|lifetime');
    process.exit(1);
}

const key = `REALCORD-${crypto.randomBytes(24).toString('hex').toUpperCase()}`;
const hash = crypto.createHash('sha256').update(key).digest('hex');
const record = { hash, duration };

console.log(`Customer key:\n${key}\n`);
console.log('Append this pair to Railway REALCORD_LICENSE_RECORDS:');
console.log(`${record.duration},${record.hash}`);
