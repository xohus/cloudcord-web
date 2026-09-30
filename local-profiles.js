'use strict';
const fs = require('node:fs');
const path = require('node:path');
const os = require('node:os');
function makeLocalProfiles(file) {
    const { DatabaseSync } = require('node:sqlite');
    const base = process.env.LOCALAPPDATA || path.join(os.homedir(), '.local', 'share');
    file ||= path.join(base, 'CloudCord', 'web', 'profiles.sqlite');
    fs.mkdirSync(path.dirname(file), { recursive: true, mode: 0o700 });
    const db = new DatabaseSync(file);
    db.exec(`PRAGMA journal_mode=WAL;
        PRAGMA max_page_count=65536;
        CREATE TABLE IF NOT EXISTS profiles (id TEXT PRIMARY KEY, owner_id TEXT NOT NULL,
            profile TEXT NOT NULL, edit_token_hash TEXT NOT NULL, updated_at TEXT NOT NULL);
        CREATE INDEX IF NOT EXISTS profiles_owner_updated ON profiles(owner_id, updated_at DESC);`);
    const decode = row => row ? { ...row, profile: JSON.parse(row.profile) } : null;
    const latest = owner => decode(db.prepare('SELECT id, owner_id, profile, updated_at FROM profiles WHERE owner_id = ? ORDER BY updated_at DESC, rowid DESC LIMIT 1').get(String(owner)));
    const revision = profile => Math.max(0, Number(profile?.syncRevision || 0) || 0);
    function save(id, owner, profile, tokenHash, update) {
        const serialized = JSON.stringify(profile);
        if (Buffer.byteLength(serialized) > 3 * 1024 * 1024) return { tooLarge: true };
        db.exec('BEGIN IMMEDIATE');
        try {
            const current = latest(owner);
            let result;
            if (update && !db.prepare('SELECT id FROM profiles WHERE id = ? AND owner_id = ? AND edit_token_hash = ?').get(id, String(owner), tokenHash)) result = { unauthorized: true };
            else if (current && revision(profile) < revision(current.profile)) result = { stale: current };
            else {
                const date = new Date().toISOString();
                if (update) db.prepare('UPDATE profiles SET profile = ?, updated_at = ? WHERE id = ?').run(serialized, date, id);
                else db.prepare('INSERT INTO profiles VALUES (?, ?, ?, ?, ?)').run(id, String(owner), serialized, tokenHash, date);
                result = { id };
            }
            db.exec('COMMIT');
            return result;
        } catch (error) { db.exec('ROLLBACK'); throw error; }
    }
    return { latest, create: (id, owner, profile, hash) => save(id, owner, profile, hash, false), update: (id, owner, profile, hash) => save(id, owner, profile, hash, true), close: () => db.close() };
}
module.exports = { makeLocalProfiles };
