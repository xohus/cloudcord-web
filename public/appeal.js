// /appeal: sign in with Discord, file an appeal and see the status of your own.
(() => {
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
    const LABELS = { open: 'Waiting for review', reviewing: 'Being reviewed', accepted: 'Accepted', denied: 'Denied' };

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

    function renderAppeals(appeals) {
        $('myAppeals').hidden = !appeals.length;
        $('appealList').replaceChildren(...appeals.map(appeal => {
            const item = document.createElement('div');
            item.style.cssText = 'padding:12px 0;border-top:1px solid rgba(127,127,127,.25)';
            const head = document.createElement('b');
            head.textContent = `${appeal.type} · ${LABELS[appeal.status] || appeal.status}`;
            const when = document.createElement('div');
            when.style.cssText = 'opacity:.7;font-size:.85rem';
            when.textContent = `Sent ${new Date(appeal.submitted_at).toLocaleDateString()}${appeal.reviewed_at ? ` · decided ${new Date(appeal.reviewed_at).toLocaleDateString()}` : ''}`;
            item.append(head, when);
            if (appeal.decision_note && ['accepted', 'denied'].includes(appeal.status)) {
                const note = document.createElement('p');
                note.style.cssText = 'margin:6px 0 0;white-space:pre-wrap;overflow-wrap:anywhere';
                note.textContent = appeal.decision_note;
                item.append(note);
            }
            return item;
        }));
    }

    async function load() {
        const error = new URLSearchParams(location.search).get('error');
        if (error && ERRORS[error]) { showToast(ERRORS[error]); history.replaceState(null, '', location.pathname); }
        let me;
        try { me = await api('/api/appeals/me'); }
        catch { return setGate('Appeals are unavailable', 'Try again in a little while.'); }

        form.elements.type.replaceChildren(new Option('Choose one', ''), ...me.types.map(t => new Option(t, t)));
        if (!me.signedIn) return setGate('Sign in to continue', 'Appeals are tied to your Discord account so we know whose punishment to review. Only your public identity is requested. You can sign in even if you are banned from the server.', { label: 'Continue with Discord', run: () => { location.href = '/staff-reports/login?next=appeal'; } });
        $('signedInAs').hidden = false;
        $('signedInName').textContent = me.user.name;
        if (me.user.avatar) $('signedInAvatar').src = me.user.avatar;
        renderAppeals(me.appeals);
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
        if (!data.type || (data.statement || '').trim().length < 30) return showToast('Choose what you are appealing and explain why in a few sentences.');
        const button = form.querySelector('button[type=submit]');
        button.disabled = true;
        try {
            await api('/api/appeals', { method: 'POST', body: JSON.stringify(data) });
            form.reset();
            await load();
            setGate('Appeal sent', 'Management will review it. Check back here for the decision.', { label: 'Back to my appeals', run: () => { gate.hidden = true; form.hidden = false; } });
        } catch (error) { showToast(error.message); }
        finally { button.disabled = false; }
    });

    load();
})();
