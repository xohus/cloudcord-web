(() => {
    const form = document.getElementById('staffForm');
    if (!form) return;

    const storageKey = 'cloudcordStaffApplicationDraftV1';
    const roleQuestions = {
        'Support Team': [
            ['supportUnknown', 'How would you help someone who only says, “CloudCord doesn’t work”?'],
            ['supportDiagnostics', 'What information and diagnostics would you request before reporting a bug?'],
            ['supportExplain', 'How would you explain technical instructions to an inexperienced user?'],
            ['supportEscalate', 'When should a support request be escalated to a moderator or developer?']
        ],
        Moderator: [
            ['modViolations', 'How would you handle spam, harassment, or repeated rule violations?'],
            ['modEvidence', 'What evidence should be collected before punishing a member?'],
            ['modAppeal', 'How would you handle an appeal from someone you punished?'],
            ['modActions', 'When would you warn, mute, kick, or ban someone?']
        ],
        Administrator: [
            ['adminResponsibilities', 'How would you organize staff responsibilities and permissions?'],
            ['adminDispute', 'How would you resolve a dispute between two staff members?'],
            ['adminAbuse', 'What would you do if a moderator repeatedly abused their permissions?'],
            ['adminIncident', 'How would you respond to a raid or serious security incident?']
        ],
        Developer: [
            ['devStack', 'Which programming languages, frameworks, and platforms do you know?'],
            ['devWork', 'Link examples of your previous work, if available.'],
            ['devDebug', 'How would you debug a problem that only happens on one Discord version or device?'],
            ['devTesting', 'How do you test changes before releasing them?'],
            ['devSafety', 'How would you prevent a client hook from breaking unrelated Discord features?'],
            ['devImprovement', 'Describe one CloudCord feature or bug you would improve and how you would approach it.']
        ]
    };

    const roleContainer = document.getElementById('roleQuestionFields');
    const roleDescription = document.getElementById('roleDescription');
    const progressBar = document.getElementById('progressBar');
    const progressText = document.getElementById('progressText');
    const progressDetail = document.getElementById('progressDetail');
    const saveIndicator = document.getElementById('saveIndicator');
    const modal = document.getElementById('resultModal');
    const toast = document.getElementById('toast');
    let saveTimer;

    function selectedRole() { return form.querySelector('[name="role"]:checked')?.value || ''; }

    function renderRoleQuestions(role, restored = {}) {
        const questions = roleQuestions[role];
        if (!questions) {
            roleDescription.textContent = 'Choose a role above to reveal this section.';
            roleContainer.className = 'field-stack role-empty';
            roleContainer.innerHTML = '<div class="empty-state"><span>?</span><p>Your selected role determines the questions shown here.</p></div>';
            return;
        }
        roleDescription.textContent = `Questions tailored for the ${role} role.`;
        roleContainer.className = 'field-stack';
        roleContainer.innerHTML = questions.map(([name, label]) => `<label class="field"><span>${label} <b>*</b></span><textarea name="${name}" rows="4" required></textarea></label>`).join('');
        for (const [name] of questions) if (restored[name]) roleContainer.querySelector(`[name="${name}"]`).value = restored[name];
    }

    function formDataObject() {
        const data = {};
        new FormData(form).forEach((value, key) => { data[key] = value; });
        form.querySelectorAll('input[type="checkbox"]').forEach(input => { data[input.name] = input.checked; });
        return data;
    }

    function saveDraft() {
        localStorage.setItem(storageKey, JSON.stringify(formDataObject()));
        saveIndicator.textContent = 'Draft saved locally';
    }

    function restoreDraft() {
        let data = {};
        try { data = JSON.parse(localStorage.getItem(storageKey) || '{}'); } catch {}
        if (data.role) {
            const role = form.querySelector(`[name="role"][value="${CSS.escape(data.role)}"]`);
            if (role) role.checked = true;
        }
        renderRoleQuestions(data.role, data);
        for (const [key, value] of Object.entries(data)) {
            const field = form.elements.namedItem(key);
            if (!field || key === 'role') continue;
            if (field.type === 'checkbox') field.checked = Boolean(value);
            else field.value = value;
        }
    }

    function updateProgress() {
        const required = [...form.querySelectorAll('[required]')];
        const complete = required.filter(field => field.type === 'radio' ? selectedRole() : field.type === 'checkbox' ? field.checked : field.value.trim()).length;
        const uniqueRequired = required.length - Math.max(0, form.querySelectorAll('[name="role"]').length - 1);
        const uniqueComplete = complete - Math.max(0, selectedRole() ? form.querySelectorAll('[name="role"]').length - 1 : 0);
        const percent = uniqueRequired ? Math.round((uniqueComplete / uniqueRequired) * 100) : 0;
        progressBar.style.width = `${percent}%`;
        progressText.textContent = `${percent}%`;
        progressDetail.textContent = percent === 100 ? 'Everything is ready.' : `${Math.max(0, uniqueRequired - uniqueComplete)} required answer${uniqueRequired - uniqueComplete === 1 ? '' : 's'} remaining.`;
    }

    function scheduleSave() {
        saveIndicator.textContent = 'Saving draft…';
        clearTimeout(saveTimer);
        saveTimer = setTimeout(saveDraft, 350);
        updateProgress();
    }

    function showToast(message) {
        toast.textContent = message;
        toast.classList.add('show');
        setTimeout(() => toast.classList.remove('show'), 2200);
    }

    form.addEventListener('change', event => {
        if (event.target.name === 'role') renderRoleQuestions(event.target.value);
        scheduleSave();
    });
    form.addEventListener('input', event => {
        event.target.closest('.field')?.classList.remove('invalid');
        scheduleSave();
    });
    form.addEventListener('submit', event => {
        event.preventDefault();
        const firstInvalid = [...form.querySelectorAll('[required]')].find(field => !field.checkValidity());
        if (firstInvalid) {
            firstInvalid.closest('.field, .role-fieldset, .agreement')?.classList.add('invalid');
            firstInvalid.scrollIntoView({ behavior: 'smooth', block: 'center' });
            firstInvalid.focus({ preventScroll: true });
            showToast('Please complete every required field.');
            return;
        }
        modal.classList.add('open');
        modal.setAttribute('aria-hidden', 'false');
        document.body.style.overflow = 'hidden';
    });

    document.getElementById('authorizeApplication').addEventListener('click', async event => {
        const button = event.currentTarget;
        button.disabled = true;
        button.querySelector('span').textContent = 'Opening Discord…';
        try {
            const data = formDataObject();
            const response = await fetch('/api/staff/applications/start', {
                method: 'POST',
                headers: { 'Content-Type': 'application/json' },
                body: JSON.stringify({ answers: data, confidentiality: data.confidentiality === true, consequences: data.consequences === true })
            });
            const result = await response.json();
            if (!response.ok || !result.authorizeUrl) throw new Error(result.error || 'Could not start Discord verification');
            location.assign(result.authorizeUrl);
        } catch (error) {
            button.disabled = false;
            button.querySelector('span').textContent = 'Continue with Discord';
            showToast(error.message || 'Could not submit the application.');
        }
    });
    document.querySelectorAll('[data-close-modal]').forEach(button => button.addEventListener('click', () => {
        modal.classList.remove('open');
        modal.setAttribute('aria-hidden', 'true');
        document.body.style.overflow = '';
    }));
    document.querySelectorAll('.section-index button').forEach(button => button.addEventListener('click', () => document.getElementById(button.dataset.target)?.scrollIntoView({ behavior: 'smooth', block: 'start' })));

    const observer = new IntersectionObserver(entries => entries.forEach(entry => {
        if (entry.isIntersecting) {
            document.querySelectorAll('.section-index button').forEach(button => button.classList.toggle('active', button.dataset.target === entry.target.id));
        }
    }), { rootMargin: '-25% 0px -60%', threshold: 0 });
    document.querySelectorAll('.form-section').forEach(section => observer.observe(section));

    restoreDraft();
    updateProgress();
    const query = new URLSearchParams(location.search);
    if (query.get('submitted') === '1') {
        localStorage.removeItem(storageKey);
        form.reset();
        renderRoleQuestions('');
        updateProgress();
        setTimeout(() => showToast('Application submitted successfully.'), 250);
        history.replaceState({}, '', '/staff-application');
    } else if (query.get('error')) {
        const errors = {
            oauth_denied: 'Discord verification was cancelled.',
            session_expired: 'Your verification expired. Please try again.',
            identity_mismatch: 'The Discord account did not match the user ID in the form.',
            submit_failed: 'The application could not be submitted. Please try again.'
        };
        setTimeout(() => showToast(errors[query.get('error')] || 'Something went wrong.'), 250);
        history.replaceState({}, '', '/staff-application');
    }
})();
