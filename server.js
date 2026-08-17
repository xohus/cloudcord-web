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
app.use(helmet());
app.use(cors());
app.use(express.json());

// Session setup
app.use(session({
    secret: process.env.SESSION_SECRET || 'cloudcord-super-secret-key-123!',
    resave: false,
    saveUninitialized: true,
    cookie: { secure: process.env.NODE_ENV === 'production', httpOnly: true, maxAge: 24 * 60 * 60 * 1000 }
}));

// Rate limiting for abuse protection
const limiter = rateLimit({
    windowMs: 15 * 60 * 1000, // 15 minutes
    max: 500 // limit each IP to 500 requests per windowMs
});
app.use(limiter);

const authLimiter = rateLimit({
    windowMs: 60 * 60 * 1000, // 1 hour
    max: 10 // limit each IP to 10 agreement attempts per hour
});

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

app.post('/api/source/agree', authLimiter, (req, res) => {
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

// Helper to walk directory and build tree
function getFilesTree(dir, basePath = '') {
    let results = [];
    if (!fs.existsSync(dir)) return results;
    
    const list = fs.readdirSync(dir);
    list.forEach(file => {
        const fullPath = path.join(dir, file);
        const relPath = path.join(basePath, file);
        const stat = fs.statSync(fullPath);
        
        if (stat && stat.isDirectory()) {
            results.push({
                name: file,
                path: relPath.replace(/\\\\/g, '/'),
                type: 'directory',
                children: getFilesTree(fullPath, relPath)
            });
        } else {
            results.push({
                name: file,
                path: relPath.replace(/\\\\/g, '/'),
                type: 'file',
                size: stat.size
            });
        }
    });
    return results;
}

app.get('/api/source/files', checkSourceAccess, (req, res) => {
    logAudit('SOURCE_FILES_LISTED', req);
    try {
        const tree = getFilesTree(SOURCE_DIR);
        res.json({ tree });
    } catch (err) {
        res.status(500).json({ error: 'Failed to read source tree' });
    }
});

app.get('/api/source/file/*', checkSourceAccess, (req, res) => {
    const filePathParam = req.params[0];
    if (!filePathParam || filePathParam.includes('..')) {
        logAudit('PATH_TRAVERSAL_ATTEMPT', req, { attemptedPath: filePathParam });
        return res.status(400).json({ error: 'Invalid path' });
    }
    
    const safePath = path.join(SOURCE_DIR, filePathParam);
    if (!safePath.startsWith(SOURCE_DIR)) {
        logAudit('PATH_TRAVERSAL_ATTEMPT', req, { attemptedPath: filePathParam });
        return res.status(403).json({ error: 'Access denied' });
    }
    
    if (!fs.existsSync(safePath)) {
        return res.status(404).json({ error: 'File not found' });
    }
    
    const stat = fs.statSync(safePath);
    if (stat.isDirectory()) {
        return res.status(400).json({ error: 'Path is a directory' });
    }
    
    logAudit('FILE_ACCESSED', req, { file: filePathParam });
    res.sendFile(safePath);
});

// Serve the source.html for /source route
app.get('/source', (req, res) => {
    res.sendFile(path.join(__dirname, 'public', 'source.html'));
});

app.listen(PORT, () => {
    console.log(\Server is running on port \\);
});
