document.addEventListener('DOMContentLoaded', async () => {
    const gateContainer = document.getElementById('gate-container');
    const appContainer = document.getElementById('app-container');
    const agreeBtn = document.getElementById('agree-btn');
    const fileTree = document.getElementById('file-tree');
    const breadcrumb = document.getElementById('breadcrumb');
    const codeBlock = document.getElementById('code-block');
    
    // Icons
    const folderIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--accent-purple);"><path d="M22 19a2 2 0 0 1-2 2H4a2 2 0 0 1-2-2V5a2 2 0 0 1 2-2h5l2 3h9a2 2 0 0 1 2 2z"></path></svg>';
    const fileIcon = '<svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" style="color: var(--text-muted);"><path d="M14 2H6a2 2 0 0 0-2 2v16a2 2 0 0 0 2 2h12a2 2 0 0 0 2-2V8z"></path><polyline points="14 2 14 8 20 8"></polyline><line x1="16" y1="13" x2="8" y2="13"></line><line x1="16" y1="17" x2="8" y2="17"></line><polyline points="10 9 9 9 8 9"></polyline></svg>';

    // Anti-copy & anti-screenshot protections
    document.addEventListener('contextmenu', e => e.preventDefault());
    
    document.addEventListener('keydown', e => {
        if (e.ctrlKey || e.metaKey) {
            const key = e.key.toLowerCase();
            if (['c', 'p', 's', 'u', 'a'].includes(key)) {
                e.preventDefault();
            }
        }
    });
    
    document.addEventListener('copy', e => {
        e.preventDefault();
        e.clipboardData.setData('text/plain', 'Access denied by CloudCord Proprietary Source License.');
    });
    
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
    
    function buildTreeUI(nodes, parentEl) {
        nodes.sort((a, b) => {
            if (a.type === 'directory' && b.type === 'file') return -1;
            if (a.type === 'file' && b.type === 'directory') return 1;
            return a.name.localeCompare(b.name);
        });
        
        nodes.forEach(node => {
            const el = document.createElement('div');
            el.className = 'tree-item ' + node.type;
            
            if (node.type === 'directory') {
                const wrap = document.createElement('div');
                wrap.style.display = 'flex';
                wrap.style.alignItems = 'center';
                wrap.style.gap = '8px';
                wrap.innerHTML = folderIcon + ' <span>' + node.name + '</span>';
                el.appendChild(wrap);
                
                const childrenContainer = document.createElement('div');
                childrenContainer.style.display = 'none';
                childrenContainer.style.paddingLeft = '10px';
                
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    const isHidden = childrenContainer.style.display === 'none';
                    childrenContainer.style.display = isHidden ? 'block' : 'none';
                });
                
                parentEl.appendChild(el);
                parentEl.appendChild(childrenContainer);
                if (node.children) {
                    buildTreeUI(node.children, childrenContainer);
                }
            } else {
                el.innerHTML = fileIcon + ' <span style="margin-left:8px;">' + node.name + '</span>';
                parentEl.appendChild(el);
                
                el.addEventListener('click', (e) => {
                    e.stopPropagation();
                    document.querySelectorAll('.tree-item.file').forEach(i => i.style.background = 'transparent');
                    el.style.background = 'var(--bg-tertiary)';
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
                buildTreeUI(data.tree, fileTree);
            } else if (res.status === 403) {
                location.reload(); 
            }
        } catch (err) {
            fileTree.innerHTML = '<div style="color:var(--accent-red)">Error loading source tree.</div>';
        }
    }
    
    async function loadFile(filePath) {
        breadcrumb.innerText = filePath;
        const codeBlock = document.getElementById('code-block');
        codeBlock.textContent = 'Loading...';
        
        try {
            const res = await fetch('/api/source/file/' + encodeURIComponent(filePath).replace(/%2F/g, '/'));
            if (res.ok) {
                const text = await res.text();
                codeBlock.textContent = text;
                
                codeBlock.className = '';
                const ext = filePath.split('.').pop().toLowerCase();
                let lang = 'javascript';
                if (ext === 'ts' || ext === 'tsx') lang = 'typescript';
                else if (ext === 'html') lang = 'html';
                else if (ext === 'css') lang = 'css';
                else if (ext === 'json') lang = 'json';
                else if (ext === 'md') lang = 'markdown';
                
                codeBlock.classList.add('language-' + lang);
                if (window.Prism && Prism.languages[lang]) {
                    Prism.highlightElement(codeBlock);
                }
            } else {
                codeBlock.textContent = 'Error: ' + res.statusText;
            }
        } catch (err) {
            codeBlock.textContent = 'Error loading file content. ' + err.message;
        }
    }
});
