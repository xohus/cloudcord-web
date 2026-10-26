// Profile template gallery (/templates).
(() => {
    const PAGE = 24;
    const $ = id => document.getElementById(id);
    const grid = $('tplGrid');
    const state = { q: '', category: '', sort: 'popular', offset: 0, loading: false };

    function showToast(message) {
        const toast = $('toast');
        toast.textContent = message;
        toast.classList.add('show');
        clearTimeout(showToast.timer);
        showToast.timer = setTimeout(() => toast.classList.remove('show'), 2500);
    }

    function card(template) {
        const p = template.preview || {};
        const item = document.createElement('article');
        item.className = 'tpl-card';
        item.style.setProperty('--accent', p.accent || '#5865f2');
        const banner = document.createElement('div');
        banner.className = 'tpl-banner';
        if (p.banner) banner.style.backgroundImage = `url("${encodeURI(p.banner)}")`;
        const avatar = document.createElement('div');
        avatar.className = 'tpl-avatar';
        if (p.avatar) { const img = document.createElement('img'); img.src = p.avatar; img.alt = ''; img.loading = 'lazy'; avatar.append(img); }
        const body = document.createElement('div');
        body.className = 'tpl-body';
        const title = document.createElement('h2');
        title.textContent = template.name;
        const meta = document.createElement('p');
        meta.className = 'tpl-meta';
        meta.textContent = `${template.category || 'Other'} · ${(template.uses || 0).toLocaleString()} ${template.uses === 1 ? 'use' : 'uses'}`;
        body.append(title, meta);
        if (template.description || p.bio) {
            const desc = document.createElement('p');
            desc.className = 'tpl-desc';
            desc.textContent = template.description || p.bio;
            body.append(desc);
        }
        const actions = document.createElement('div');
        actions.className = 'tpl-actions';
        const copy = document.createElement('button');
        copy.type = 'button';
        copy.className = 'submit-button';
        copy.textContent = 'Copy code';
        copy.onclick = async () => {
            try { await navigator.clipboard.writeText(template.id); showToast(`Copied ${template.id}. Paste it in Custom Profile → Templates.`); }
            catch { showToast(`Code: ${template.id}`); }
        };
        const open = document.createElement('a');
        open.className = 'secondary-button';
        open.href = `/p/${encodeURIComponent(template.id)}`;
        open.textContent = 'View';
        actions.append(copy, open);
        body.append(actions);
        item.append(banner, avatar, body);
        return item;
    }

    async function load(reset) {
        if (state.loading) return;
        state.loading = true;
        if (reset) { state.offset = 0; grid.replaceChildren(); }
        const query = new URLSearchParams({ limit: PAGE, offset: state.offset, sort: state.sort });
        if (state.q) query.set('q', state.q);
        if (state.category) query.set('category', state.category);
        try {
            const response = await fetch(`/v1/shares?${query}`);
            const data = await response.json();
            if (!response.ok) throw new Error(data.error || 'Could not load templates');
            if (!$('tplCategories').childElementCount) renderCategories(data.categories || []);
            data.shares.forEach(t => grid.append(card(t)));
            state.offset += data.shares.length;
            $('tplMore').hidden = data.shares.length < PAGE;
            $('tplEmpty').hidden = grid.childElementCount > 0;
        } catch (error) {
            showToast(error.message);
        } finally { state.loading = false; }
    }

    function renderCategories(categories) {
        const box = $('tplCategories');
        for (const name of ['', ...categories]) {
            const chip = document.createElement('button');
            chip.type = 'button';
            chip.textContent = name || 'All';
            chip.className = name === state.category ? 'active' : '';
            chip.onclick = () => {
                state.category = name;
                box.querySelectorAll('button').forEach(b => b.classList.toggle('active', b === chip));
                load(true);
            };
            box.append(chip);
        }
    }

    let searchTimer;
    $('tplSearch').addEventListener('input', event => {
        clearTimeout(searchTimer);
        searchTimer = setTimeout(() => { state.q = event.target.value.trim(); load(true); }, 300);
    });
    document.querySelectorAll('.tpl-sort button').forEach(button => button.addEventListener('click', () => {
        state.sort = button.dataset.sort;
        document.querySelectorAll('.tpl-sort button').forEach(b => b.classList.toggle('active', b === button));
        load(true);
    }));
    $('tplMore').addEventListener('click', () => load(false));
    load(true);
})();
