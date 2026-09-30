'use strict';
const assert = require('node:assert/strict');
const fs = require('node:fs');
const os = require('node:os');
const path = require('node:path');
const { makeLocalProfiles } = require('../local-profiles');
const directory = fs.mkdtempSync(path.join(os.tmpdir(), 'cloudcord-profile-test-'));
const file = path.join(directory, 'profiles.sqlite');
let store;
try {
    store = makeLocalProfiles(file);
    assert.equal(store.latest('100000000000000001'), null);
    assert.deepEqual(store.create('test-id', '100000000000000001', { syncRevision: 2, banner: 'original' }, 'hash'), { id: 'test-id' });
    assert.equal(store.update('test-id', '100000000000000001', { syncRevision: 3 }, 'wrong').unauthorized, true);
    assert.equal(store.update('test-id', '100000000000000002', { syncRevision: 3 }, 'hash').unauthorized, true);
    assert.ok(store.update('test-id', '100000000000000001', { syncRevision: 1 }, 'hash').stale);
    assert.equal(store.latest('100000000000000001').profile.banner, 'original');
    assert.equal(store.create('huge', '100000000000000001', { data: 'a'.repeat(3 * 1024 * 1024) }, 'hash').tooLarge, true);
    assert.deepEqual(store.update('test-id', '100000000000000001', { syncRevision: 3, banner: 'updated' }, 'hash'), { id: 'test-id' });
    store.close(); store = makeLocalProfiles(file);
    assert.equal(store.latest('100000000000000001').profile.banner, 'updated');
    console.log('local profile persistence, ownership, revisions and size checks passed');
} finally {
    store?.close();
    fs.rmSync(directory, { recursive: true });
}
