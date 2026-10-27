// Appeals review in /admin: bans, mutes, blacklists, demotions and staff removals from /appeal.
(() => {
    const dashboard = document.getElementById('dashboardView');
    if (!dashboard) return;
    const section = document.createElement('section');
    section.className = 'admin-heading';
    section.style.cssText = 'display:block;margin-top:40px;padding-top:24px;border-top:1px solid #36373d';
    section.innerHTML = `<h2>Appeals</h2>
        <p>Appeals from /appeal. The note you add when accepting or denying is shown to the person.</p>
        <div class="queue-tabs" role="tablist" id="appealStatusTabs">
            <button class="active" data-status="open">Open <span id="openAppealCount">0</span></button>
            <button data-status="reviewing">Reviewing</button>
            <button data-status="accepted">Accepted</button>
            <button data-status="denied">Denied</button>
        </div>
        <p id="appealMessage" role="status"></p><div id="appealAdminList"></div>`;
    dashboard.querySelector('main').append(section);
    const list = section.querySelector('#appealAdminList'), message = section.querySelector('#appealMessage');
    let status = 'open', loading = false;
    const api = async (url, options = {}) => {
        const r = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        return body;
    };
    const line = (tag, text, css = '') => { const el = document.createElement(tag); el.textContent = text; if (css) el.style.cssText = css; return el; };

    async function load() {
        if (loading || dashboard.hidden) return;
        loading = true; message.textContent = 'Loading appeals…'; list.replaceChildren();
        try {
            const data = await api(`/api/admin/staff/appeals?status=${status}`);
            if (status === 'open') section.querySelector('#openAppealCount').textContent = data.appeals.length;
            message.textContent = data.appeals.length ? '' : `No ${status} appeals.`;
            for (const appeal of data.appeals) {
                const card = document.createElement('article');
                card.style.cssText = 'padding:16px;margin-top:12px;border:1px solid #36373d;border-radius:14px;display:grid;gap:6px';
                card.append(
                    line('h3', `${appeal.type} · ${appeal.user_name || appeal.user_id}`, 'margin:0'),
                    line('p', `User ID ${appeal.user_id} · ${new Date(appeal.submitted_at).toLocaleString()}`, 'margin:0;opacity:.7;font-size:.85rem'),
                    line('p', appeal.statement, 'margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere')
                );
                for (const [label, value] of [['Reason given', appeal.reason], ['Issued by', appeal.issued_by], ['When', appeal.happened_at], ['Evidence', appeal.evidence], ['Decision note', appeal.decision_note]])
                    if (value) card.append(line('p', `${label}: ${value}`, 'margin:0;opacity:.8;white-space:pre-wrap;overflow-wrap:anywhere'));
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
                const note = document.createElement('input');
                note.placeholder = 'Note to the person (optional)';
                note.style.cssText = 'flex:1 1 200px;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #36373d;background:transparent;color:inherit';
                actions.append(note);
                for (const next of ['reviewing', 'accepted', 'denied'].filter(s => s !== appeal.status)) {
                    const button = line('button', { reviewing: 'Reviewing', accepted: 'Accept', denied: 'Deny' }[next]);
                    button.type = 'button';
                    button.onclick = async () => {
                        button.disabled = true;
                        try { await api(`/api/admin/staff/appeals/${encodeURIComponent(appeal.id)}/status`, { method: 'POST', body: JSON.stringify({ status: next, note: note.value }) }); await load(); }
                        catch (e) { message.textContent = e.message; button.disabled = false; }
                    };
                    actions.append(button);
                }
                card.append(actions);
                list.append(card);
            }
        } catch (e) { message.textContent = e.message; }
        finally { loading = false; }
    }
    section.querySelectorAll('#appealStatusTabs button').forEach(button => button.addEventListener('click', () => {
        section.querySelectorAll('#appealStatusTabs button').forEach(item => item.classList.toggle('active', item === button));
        status = button.dataset.status; load();
    }));
    new MutationObserver(() => { if (!dashboard.hidden) load(); else { list.replaceChildren(); message.textContent = ''; } }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
    load();
})();
