'use strict';
const RULES = ['no sexual content, threats, hate or harassment', 'no personal information', 'no staff, verified or official impersonation', 'AI-approved PNGs publish immediately and remain subject to admin review'];
function checkName(name) {
    if (typeof name !== 'string' || !name.trim() || name.length > 40) return 'use a name between 1 and 40 characters';
    const normalized = name.normalize('NFKD').toLowerCase().replace(/[\u0300-\u036f\u200b-\u200f\u202a-\u202e\u2060-\u206f]/g, '').replace(/[013457]/g, c => ({0:'o',1:'i',3:'e',4:'a',5:'s',7:'t'})[c]).replace(/[^a-z0-9]/g, '');
    if (/(owner|staff|admin|moderator|manager|verified|official|cloudcord|discord|xohus|gunshild|tqgs|lyx)/.test(normalized)) return 'that name is reserved — no staff or official impersonation';
    // Narrow ASCII names avoid unsupported homoglyph/confusable identities in beta.
    if (!/^[a-zA-Z0-9 ._!\-]+$/.test(name)) return 'beta badge names support English letters, numbers and basic punctuation only';
    if (/https?:|www\.|@|\d{7,}/i.test(name)) return 'no links, contact details or personal information';
    return null;
}
async function moderate(name, png, request = fetch) {
    const error = checkName(name);
    if (error) return { status: 'blocked', message: error };
    if (!process.env.OPENAI_API_KEY) return { status: 'unavailable', message: 'moderation is unavailable — nothing was published' };
    try {
        const response = await request('https://api.openai.com/v1/moderations', {
            method: 'POST', signal: AbortSignal.timeout(15000),
            headers: { Authorization: `Bearer ${process.env.OPENAI_API_KEY}`, 'Content-Type': 'application/json' },
            body: JSON.stringify({ model: 'omni-moderation-latest', input: [{ type: 'text', text: name }, { type: 'image_url', image_url: { url: `data:image/png;base64,${png}` } }] })
        });
        if (!response.ok) throw new Error('unavailable');
        const result = (await response.json()).results?.[0];
        if (!result || typeof result.flagged !== 'boolean') throw new Error('invalid response');
        if (result.flagged) return { status: 'blocked', message: 'this badge was flagged for unsafe content — change the name or PNG and try again' };
        return { status: 'approved', message: 'AI safety check passed — published, pending a second admin review' };
    } catch { return { status: 'unavailable', message: 'moderation could not finish — nothing was published. try again later' }; }
}
module.exports = { RULES, checkName, moderate };
