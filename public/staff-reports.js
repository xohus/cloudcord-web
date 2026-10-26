// Shared script for /report-staff (public) and /staff/reports (staff only).
(() => {
    const kind = document.body.dataset.reportKind === 'internal' ? 'internal' : 'public';
    const $ = id => document.getElementById(id);
    const form = $('reportForm');
    const gate = $('reportGate');
    const toast = $('toast');
    const ERRORS = {
        signin_denied: 'Discord sign-in was cancelled.',
        signin_expired: 'Sign-in took too long. Try again.',
        signin_failed: 'Discord sign-in failed. Try again.',
        signin_unavailable: 'Discord sign-in is not set up yet.'
    };

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove('show'), 4000);
    }

    async function api(path, options = {}) {
        const response = await fetch(path, { credentials: 'same-origin', headers: { 'content-type': 'application/json' }, ...options });
        const body = await response.json().catch(() => ({}));
        if (!response.ok) throw new Error(body.error || `Request failed (${response.status})`);
        return body;
    }

    function setGate(title, message, action) {
        gate.hidden = false;
        form.hidden = true;
        $('gateTitle').textContent = title;
        $('gateText').textContent = message;
        const button = $('gateAction');
        button.hidden = !action;
        if (action) { button.textContent = action.label; button.onclick = action.run; }
    }

    const signIn = () => { location.href = `/staff-reports/login?next=${kind}`; };

    async function load() {
        const error = new URLSearchParams(location.search).get('error');
        if (error && ERRORS[error]) { showToast(ERRORS[error]); history.replaceState(null, '', location.pathname); }
        let me;
        try { me = await api('/api/staff-reports/me'); }
        catch { return setGate('Reports are unavailable', 'Try again in a little while.'); }

        const select = form.elements.category;
        select.replaceChildren(new Option('Choose a category', ''), ...me.categories[kind].map(c => new Option(c, c)));
        if (me.admin) loadReview();

        if (!me.signedIn) return setGate('Sign in to continue', 'Reports are tied to your Discord account so they cannot be spammed. Only your public identity is requested, and staff never see who reported them.', { label: 'Continue with Discord', run: signIn });
        $('signedInAs').hidden = false;
        $('signedInName').textContent = me.user.name;
        if (me.user.avatar) $('signedInAvatar').src = me.user.avatar;
        if (kind === 'internal' && !me.staff) return setGate('Staff only', 'This page is for CloudCord staff. To report a staff member as a user, use the public form.', { label: 'Open the public form', run: () => { location.href = '/report-staff'; } });
        gate.hidden = true;
        form.hidden = false;
    }

    $('signOut').addEventListener('click', async () => {
        await api('/api/staff-reports/logout', { method: 'POST' }).catch(() => {});
        location.reload();
    });

    form.addEventListener('submit', async event => {
        event.preventDefault();
        const data = Object.fromEntries(new FormData(form));
        if (!data.subject || !data.category || (data.details || '').trim().length < 20) return showToast('Fill in who, the category, and at least a couple of sentences of details.');
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try {
            await api('/api/staff-reports', { method: 'POST', body: JSON.stringify({ ...data, kind }) });
            form.reset();
            setGate('Report sent', 'Thank you. Management will review it privately.', { label: 'Send another', run: () => { gate.hidden = true; form.hidden = false; } });
        } catch (error) { showToast(error.message); }
        finally { button.disabled = false; }
    });

    // Admins (signed in on /admin) also get the review queue on the internal page.
    async function loadReview() {
        const panel = $('reviewPanel');
        if (!panel) return;
        panel.hidden = false;
        const list = $('reviewList');
        const status = $('reviewStatus');
        async function render() {
            list.replaceChildren();
            let reports = [];
            try { reports = (await api(`/api/admin/staff/reports?status=${status.value}`)).reports; }
            catch (error) { list.textContent = error.message; return; }
            if (!reports.length) { list.innerHTML = '<p class="review-empty">Nothing here.</p>'; return; }
            for (const report of reports) {
                const card = document.createElement('article');
                card.className = 'review-card';
                const head = document.createElement('header');
                const title = document.createElement('strong');
                title.textContent = `${report.subject}${report.subject_id ? ` (${report.subject_id})` : ''}`;
                const meta = document.createElement('span');
                meta.textContent = `${report.kind === 'internal' ? 'Staff' : 'Public'} · ${report.category} · ${new Date(report.submitted_at).toLocaleString()} · by ${report.reporter_name || report.reporter_id}`;
                head.append(title, meta);
                const details = document.createElement('p');
                details.textContent = report.details;
                card.append(head, details);
                for (const [label, value] of [['Evidence', report.evidence], ['When', report.happened_at], ['Note', report.review_note]]) {
                    if (!value) continue;
                    const line = document.createElement('p');
                    line.className = 'review-extra';
                    line.textContent = `${label}: ${value}`;
                    card.append(line);
                }
                const actions = document.createElement('div');
                actions.className = 'review-actions';
                const note = document.createElement('input');
                note.placeholder = 'Note (optional)';
                actions.append(note);
                for (const next of ['reviewing', 'resolved', 'dismissed'].filter(s => s !== report.status)) {
                    const button = document.createElement('button');
                    button.type = 'button';
                    button.className = 'secondary-button';
                    button.textContent = next[0].toUpperCase() + next.slice(1);
                    button.onclick = async () => {
                        try { await api(`/api/admin/staff/reports/${report.id}/status`, { method: 'POST', body: JSON.stringify({ status: next, note: note.value }) }); render(); }
                        catch (error) { showToast(error.message); }
                    };
                    actions.append(button);
                }
                card.append(actions);
                list.append(card);
            }
        }
        status.addEventListener('change', render);
        render();
    }

    load();
})();
