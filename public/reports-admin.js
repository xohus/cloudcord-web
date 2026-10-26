// Staff reports review in /admin: public reports from /report-staff and staff
// reports from /staff/reports, both in one queue.
(() => {
    const dashboard = document.getElementById('dashboardView');
    if (!dashboard) return;
    const section = document.createElement('section');
    section.className = 'admin-heading';
    section.style.cssText = 'display:block;margin-top:40px;padding-top:24px;border-top:1px solid #36373d';
    section.innerHTML = `<h2>Staff reports</h2>
        <p>Reports about staff from the public form (/report-staff) and from staff (/staff/reports). Reporters are only visible here.</p>
        <div class="queue-tabs" role="tablist" id="reportStatusTabs">
            <button class="active" data-status="open">Open <span id="openReportCount">0</span></button>
            <button data-status="reviewing">Reviewing</button>
            <button data-status="resolved">Resolved</button>
            <button data-status="dismissed">Dismissed</button>
        </div>
        <div class="queue-tabs" role="tablist" id="reportKindTabs" style="margin-top:8px">
            <button class="active" data-kind="">All</button>
            <button data-kind="public">Public</button>
            <button data-kind="internal">From staff</button>
        </div>
        <p id="reportMessage" role="status"></p><div id="reportList"></div>`;
    dashboard.querySelector('main').append(section);
    const list = section.querySelector('#reportList'), message = section.querySelector('#reportMessage');
    let status = 'open', kind = '', loading = false;
    const api = async (url, options = {}) => {
        const r = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `Request failed (${r.status})`);
        return body;
    };
    const line = (tag, text, css = '') => { const el = document.createElement(tag); el.textContent = text; if (css) el.style.cssText = css; return el; };

    async function load() {
        if (loading || dashboard.hidden) return;
        loading = true; message.textContent = 'Loading reports…'; list.replaceChildren();
        try {
            const data = await api(`/api/admin/staff/reports?status=${status}${kind ? `&kind=${kind}` : ''}`);
            if (status === 'open' && !kind) section.querySelector('#openReportCount').textContent = data.reports.length;
            message.textContent = data.reports.length ? '' : `No ${status} reports.`;
            for (const report of data.reports) {
                const card = document.createElement('article');
                card.style.cssText = 'padding:16px;margin-top:12px;border:1px solid #36373d;border-radius:14px;display:grid;gap:6px';
                card.append(
                    line('h3', `${report.subject}${report.subject_id ? ` (${report.subject_id})` : ''}`, 'margin:0'),
                    line('p', `${report.kind === 'internal' ? 'From staff' : 'Public'} · ${report.category} · ${new Date(report.submitted_at).toLocaleString()} · reported by ${report.reporter_name || report.reporter_id} (${report.reporter_id})`, 'margin:0;opacity:.7;font-size:.85rem'),
                    line('p', report.details, 'margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere')
                );
                for (const [label, value] of [['Evidence', report.evidence], ['When', report.happened_at], ['Review note', report.review_note]])
                    if (value) card.append(line('p', `${label}: ${value}`, 'margin:0;opacity:.8;white-space:pre-wrap;overflow-wrap:anywhere'));
                const actions = document.createElement('div');
                actions.style.cssText = 'display:flex;flex-wrap:wrap;gap:8px;margin-top:8px';
                const note = document.createElement('input');
                note.placeholder = 'Note (optional)';
                note.style.cssText = 'flex:1 1 200px;min-width:0;padding:8px 10px;border-radius:8px;border:1px solid #36373d;background:transparent;color:inherit';
                actions.append(note);
                for (const next of ['reviewing', 'resolved', 'dismissed'].filter(s => s !== report.status)) {
                    const button = line('button', next[0].toUpperCase() + next.slice(1));
                    button.type = 'button';
                    button.onclick = async () => {
                        button.disabled = true;
                        try { await api(`/api/admin/staff/reports/${encodeURIComponent(report.id)}/status`, { method: 'POST', body: JSON.stringify({ status: next, note: note.value }) }); await load(); }
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
    const tabs = (id, apply) => section.querySelectorAll(`#${id} button`).forEach(button => button.addEventListener('click', () => {
        section.querySelectorAll(`#${id} button`).forEach(item => item.classList.toggle('active', item === button));
        apply(button); load();
    }));
    tabs('reportStatusTabs', button => { status = button.dataset.status; });
    tabs('reportKindTabs', button => { kind = button.dataset.kind; });
    new MutationObserver(() => { if (!dashboard.hidden) load(); else { list.replaceChildren(); message.textContent = ''; } }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
    load();
})();
