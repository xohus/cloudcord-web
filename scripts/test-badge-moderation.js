'use strict';
const assert = require('node:assert/strict');
const { checkName, moderate } = require('../badge-moderation');
(async () => {
    for (const name of ['owner', 'ｓｔａｆｆ', 'v3rified', 'c l o u d c o r d', 'Discord admin', 'www.test.com', 'mod\u200berator']) assert.ok(checkName(name), name);
    assert.equal(checkName('star traveler'), null);
    const previous = process.env.OPENAI_API_KEY;
    delete process.env.OPENAI_API_KEY;
    assert.equal((await moderate('star', 'png')).status, 'unavailable');
    process.env.OPENAI_API_KEY = 'test';
    const response = flagged => async (_url, options) => { assert.equal(JSON.parse(options.body).model, 'omni-moderation-latest'); return { ok: true, json: async () => ({ results: [{ flagged }] }) }; };
    assert.equal((await moderate('star', 'png', response(true))).status, 'blocked');
    assert.equal((await moderate('star', 'png', response(false))).status, 'approved');
    assert.equal((await moderate('star', 'png', async () => ({ ok: false }))).status, 'unavailable');
    assert.equal((await moderate('star', 'png', async () => ({ ok: true, json: async () => ({}) }))).status, 'unavailable');
    if (previous === undefined) delete process.env.OPENAI_API_KEY; else process.env.OPENAI_API_KEY = previous;
    console.log('badge moderation tests passed');
})().catch(error => { console.error(error); process.exitCode = 1; });
