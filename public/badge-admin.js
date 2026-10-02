(() => {
    const dashboard = document.getElementById('dashboardView');
    if (!dashboard) return;
    const section = document.createElement('section');
    section.className = 'admin-heading';
    section.style.cssText = 'display:block;margin-top:40px;padding-top:24px;border-top:1px solid #36373d';
    section.innerHTML = '<h2>custom badge review · beta</h2><p>AI-approved badges are already live. check for copied staff logos, impersonation, unsafe content and personal information; keep or delete them. all user badges are labeled custom.</p><button type="button" id="badgeRefresh">refresh badges</button><p id="badgeReviewMessage" role="status"></p><div id="badgeReviewList"></div>';
    dashboard.querySelector('main').append(section);
    const list = section.querySelector('#badgeReviewList'), message = section.querySelector('#badgeReviewMessage');
    let loading = false;
    const api = async (url, options = {}) => {
        const r = await fetch(url, { credentials: 'same-origin', ...options, headers: { 'Content-Type': 'application/json', ...options.headers } });
        const body = await r.json().catch(() => ({}));
        if (!r.ok) throw new Error(body.error || `request failed (${r.status})`);
        return body;
    };
    async function load() {
        if (loading || dashboard.hidden) return;
        loading = true; message.textContent = 'loading badges…'; list.replaceChildren();
        try {
            const data = await api('/api/admin/badges/submissions');
            message.textContent = data.submissions.length ? '' : 'no badge submissions yet';
            for (const badge of data.submissions) {
                const card = document.createElement('article'); card.style.cssText = 'padding:16px;margin-top:12px;border:1px solid #36373d;border-radius:14px';
                const img = document.createElement('img'); img.src = `/api/admin/badges/submissions/${encodeURIComponent(badge.id)}/png`; img.alt = 'submitted badge'; img.style.cssText = 'width:64px;height:64px;object-fit:contain;background:#222;border-radius:8px';
                const title = document.createElement('h3'); title.textContent = badge.name;
                const details = document.createElement('p'); details.textContent = `user ${badge.user_id} · ${badge.status} · ${new Date(badge.created_at).toLocaleString()}`;
                card.append(img, title, details);
                for (const action of badge.status === 'needs_review' ? ['approve', 'reject'] : badge.status === 'approved' ? ['keep', 'revoke'] : badge.status === 'kept' ? ['revoke'] : []) {
                    const button = document.createElement('button'); button.type = 'button'; button.textContent = action === 'revoke' ? 'delete' : action;
                    button.style.marginRight = '10px';
                    button.onclick = async () => {
                        if (!confirm(`${action} this badge?`)) return;
                        button.disabled = true;
                        try { await api(`/api/admin/badges/submissions/${encodeURIComponent(badge.id)}/decision`, { method: 'POST', body: JSON.stringify({ action }) }); await load(); }
                        catch (e) { message.textContent = e.message; button.disabled = false; }
                    };
                    card.append(button);
                }
                list.append(card);
            }
        } catch (e) { message.textContent = e.message; }
        finally { loading = false; }
    }
    section.querySelector('#badgeRefresh').onclick = load;
    new MutationObserver(() => { if (!dashboard.hidden) load(); else { list.replaceChildren(); message.textContent = ''; } }).observe(dashboard, { attributes: true, attributeFilter: ['hidden'] });
    load();
})();
