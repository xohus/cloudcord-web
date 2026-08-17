const express = require('express');
const session = require('express-session');
const helmet = require('helmet');
const cors = require('cors');
const rateLimit = require('express-rate-limit');
const fs = require('fs');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const SOURCE_DIR = path.join(__dirname, 'sourcevault-data');

// Security middlewares
app.set('trust proxy', 1); // Trust Railway/Cloudflare proxy for accurate IP
app.use(helmet());
app.use(cors());
app.use(express.json());

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'cloudcord-super-secret-key-123!',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: false, httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// Rate limiters temporarily disabled for debugging

// Audit logger
function logAudit(event, req, additionalInfo = {}) {
    const logEntry = {
        timestamp: new Date().toISOString(),
        event,
        ip: req.ip || req.headers['x-forwarded-for'] || req.connection.remoteAddress,
        sessionID: req.sessionID,
        userAgent: req.headers['user-agent'],
        ...additionalInfo
    };
    console.log('[SOURCEVAULT AUDIT]', JSON.stringify(logEntry));
}

// Serve static files
app.use(express.static(path.join(__dirname, 'public')));

// SourceVault API

// Middleware to check access
function checkSourceAccess(req, res, next) {
    if (!req.session.agreed) {
        logAudit('ACCESS_DENIED', req, { reason: 'No CPSL agreement in session' });
        return res.status(403).json({ error: 'Access denied. You must agree to the CPSL.' });
    }
    next();
}

app.post('/api/source/agree', (req, res) => {
    req.session.agreed = true;
    logAudit('CPSL_AGREEMENT', req, { cpslVersion: '1.0' });
    res.json({ success: true });
});

app.get('/api/source/status', (req, res) => {
    res.json({
        agreed: !!req.session.agreed,
        version: '1.0.0',
        revision: 'latest' // Could be read from a version.json
    });
});

const GITHUB_REPO = 'xohus/cloudcord';

app.get('/api/source/files', checkSourceAccess, async (req, res) => {
    logAudit('SOURCE_FILES_LISTED', req);
    
    const token = process.env.GITHUB_PAT;
    if (!token) {
        return res.status(500).json({ error: 'SourceVault is unconfigured. GITHUB_PAT missing.' });
    }
    
    try {
        const ghRes = await fetch('https://api.github.com/repos/' + GITHUB_REPO + '/git/trees/main?recursive=1', {
            headers: {
                'Authorization': 'Bearer ' + token,
                'Accept': 'application/vnd.github.v3+json',
                'User-Agent': 'CloudCord-SourceVault'
            }
        });
        
        if (!ghRes.ok) {
            console.error('GitHub API error:', await ghRes.text());
            return res.status(500).json({ error: 'Failed to fetch repository tree from GitHub' });
        }
        
        const data = await ghRes.json();
        
        const excludePatterns = [/^\.git/, /^\.env/, /^node_modules/, /^dist/, /^LICENSE/i];
        const root = { type: 'directory', children: [] };
        
        data.tree.forEach(item => {
            if (excludePatterns.some(p => p.test(item.path))) return;
            
            const parts = item.path.split('/');
            let current = root;
            
            for (let i = 0; i < parts.length; i++) {
                const part = parts[i];
                const isLast = (i === parts.length - 1);
                
                let child = current.children.find(c => c.name === part);
                if (!child) {
                    if (isLast && item.type === 'blob') {
                        current.children.push({
                            name: part,
                            path: item.path,
                            type: 'file',
                            size: item.size
                        });
                    } else if (item.type === 'tree' || !isLast) {
                        child = {
                            name: part,
                            path: parts.slice(0, i + 1).join('/'),
                            type: 'directory',
                            children: []
                        };
                        current.children.push(child);
                    }
                }
                current = child;
            }
        });
        
        res.json({ tree: root.children });
    } catch (err) {
        console.error('Tree fetch failed', err);
        res.status(500).json({ error: 'Failed to read source tree' });
    }
});

app.get('/api/source/file/*', checkSourceAccess, async (req, res) => {
    const filePathParam = req.params[0];
    const excludePatterns = [/^\.git/, /^\.env/, /^node_modules/, /^dist/, /^LICENSE/i];
    
    if (!filePathParam || filePathParam.includes('..') || excludePatterns.some(p => p.test(filePathParam))) {
        return res.status(400).json({ error: 'Invalid path or access denied' });
    }
    
    const token = process.env.GITHUB_PAT;
    if (!token) {
        return res.status(500).json({ error: 'SourceVault is unconfigured. GITHUB_PAT missing.' });
    }
    
    try {
        const ghRes = await fetch('https://raw.githubusercontent.com/' + GITHUB_REPO + '/main/' + filePathParam, {
            headers: {
                'Authorization': 'Bearer ' + token,
                'User-Agent': 'CloudCord-SourceVault'
            }
        });
        
        if (ghRes.status === 404) {
            return res.status(404).json({ error: 'File not found' });
        }
        
        if (!ghRes.ok) {
            return res.status(500).json({ error: 'Failed to fetch file from GitHub' });
        }
        
        const buffer = await ghRes.arrayBuffer();
        const contentType = ghRes.headers.get('content-type') || 'application/octet-stream';
        res.set('Content-Type', contentType);
        
        logAudit('FILE_ACCESSED', req, { file: filePathParam });
        res.send(Buffer.from(buffer));
    } catch (err) {
        res.status(500).json({ error: 'Failed to fetch file' });
    }
});

// Serve the source.html for /source route
app.get('/source', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'source.html'));
});

app.listen(PORT, () => {
    console.log(`Server is running on port ${PORT}`);
});

