document.addEventListener('DOMContentLoaded', async () => {
    const gateContainer = document.getElementById('gate-container');
    const appContainer = document.getElementById('app-container');
    const agreeBtn = document.getElementById('agree-btn');
    const fileTree = document.getElementById('file-tree');
    const breadcrumb = document.getElementById('breadcrumb');
    const codeBlock = document.getElementById('code-block');
    
    // Anti-copy & anti-screenshot protections
    
    // Disable right click
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    // Disable keyboard shortcuts (Ctrl+C, Ctrl+P, Ctrl+S, etc.)
    document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (['c', 'p', 's', 'u', 'a'].includes(key)) {
                e.preventDefault();
            }
        }
    });
    
    // Disable copy event
    document.addEventListener('copy', e => {
        e.preventDefault();
        e.clipboardData.setData('text/plain', 'Access denied by CloudCord Proprietary Source License.');
    });
    
    // Visibility blur to prevent screenshots when app loses focus
    const overlay = document.getElementById('obfuscation-overlay');
    document.addEventListener('visibilitychange', () => {
        if (document.visibilityState === 'hidden') {
            overlay.style.display = 'flex';
        } else {
            overlay.style.display = 'none';
        }
    });
    window.addEventListener('blur', () => { overlay.style.display = 'flex'; });
    window.addEventListener('focus', () => { overlay.style.display = 'none'; });
    
    // Check if already agreed
    try {
        const statusRes = await fetch('/api/source/status');
        const status = await statusRes.json();
        
        if (status.agreed) {
            showApp();
        }
    } catch (err) {
        console.error('Status check failed', err);
    }
    
    agreeBtn.addEventListener('click', async () => {
        agreeBtn.innerText = "Processing...";
        agreeBtn.disabled = true;
        
        try {
            const res = await fetch('/api/source/agree', { method: 'POST' });
            if (res.ok) {
                showApp();
            } else {
                alert('Verification failed. Try again.');
                agreeBtn.innerText = "I Agree & Continue";
                agreeBtn.disabled = false;
            }
        } catch (err) {
            alert('Network error.');
            agreeBtn.innerText = "I Agree & Continue";
            agreeBtn.disabled = false;
        }
    });
    
    async function showApp() {
        gateContainer.style.display = 'none';
        appContainer.classList.add('visible');
        await loadFileTree();
    }
    
    function renderTree(nodes, parentEl) {
        // Sort directories first
        nodes.sort((a, b) => {
            if (a.type === 'directory' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });
        
        nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = 'tree-item ' + node.type;
            
            if (node.type === 'directory') {
                el.innerHTML = '📁 ' + node.name;
                parentEl.appendChild(el);
                
                const childrenContainer = document.createElement('div');
                childrenContainer.style.display = 'none'; // Collapsed by default
                childrenContainer.style.paddingLeft = '10px';
                parentEl.appendChild(childrenContainer);
                
                el.addEventListener('click', () => {
                    childrenContainer.style.display = childrenContainer.style.display === 'none' ? 'block' : 'none';
                    el.innerHTML = (childrenContainer.style.display === 'none' ? '📁 ' : '📂 ') + node.name;
                });
                
                renderTree(node.children, childrenContainer);
            } else {
                el.innerHTML = '📄 ' + node.name;
                parentEl.appendChild(el);
                
                el.addEventListener('click', () => {
                    document.querySelectorAll('.tree-item.file').forEach(i => i.style.color = 'var(--text-secondary)');
                    el.style.color = 'var(--accent-purple)';
                    loadFile(node.path);
                });
            }
        });
    }
    
    async function loadFileTree() {
        try {
            const res = await fetch('/api/source/files');
            if (res.ok) {
                const data = await res.json();
                fileTree.innerHTML = '';
                renderTree(data.tree, fileTree);
            } else if (res.status === 403) {
                location.reload(); // Session expired
            }
        } catch (err) {
            fileTree.innerHTML = '<div style="color:var(--accent-red)">Error loading source tree.</div>';
        }
    }
    
    async function loadFile(filePath) {
        breadcrumb.innerText = 'CloudCord / ' + filePath.split('/').join(' / ');
        codeBlock.textContent = 'Loading...';
        
        try {
            const res = await fetch('/api/source/file/' + filePath);
            if (res.ok) {
                const text = await res.text();
                codeBlock.textContent = text;
                
                // Set language class based on extension
                const ext = filePath.split('.').pop().toLowerCase();
                let lang = 'javascript';
                if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
                else if (ext === 'css') lang = 'css';
                else if (ext === 'html') lang = 'html';
                else if (ext === 'json') lang = 'json';
                else if (ext === 'md') lang = 'markdown';
                
                codeBlock.className = 'language-' + lang;
                Prism.highlightElement(codeBlock);
            } else {
                codeBlock.textContent = 'Error: ' + res.statusText;
            }
        } catch (err) {
            codeBlock.textContent = 'Failed to load file.';
        }
    }
});
