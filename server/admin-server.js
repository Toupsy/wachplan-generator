// ============================================================
// Admin Server - Separate Port für Admin Panel
// Läuft auf Port 3001 (konfigurierbar via ADMIN_PORT)
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const { createSessionMiddleware } = require('./db/session');
const { initDatabase, validateEnv } = require('./db/init');
const { dbRun, dbPath } = require('./db/connection');
const authApi = require('./api/auth');
const adminApi = require('./api/admin');
const {
  securityHeaders,
  notFoundHandler,
  jsonErrorHandler,
  installSigtermHandler,
  installFatalHandlers,
} = require('./http-common');

const app = express();
app.set('trust proxy', 1);
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// ── Umgebungsvariablen validieren ──────────────────────────────
validateEnv();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Basis-Security-Header ──────────────────────────────────────
app.use(securityHeaders());

// ── Health-Check (für Docker/K8s) ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', service: 'admin-panel', timestamp: new Date().toISOString() });
});

// ── Admin Server starten ────────────────────────────────────────
async function start() {
  try {
    // Initialize database FIRST
    await initDatabase();
    console.log('✓ Database ready');

    // Wait until the runtime connection has applied busy_timeout/journal_mode
    // before connect-sqlite3 opens its own writer connection.
    await dbRun('SELECT 1');

    // Session middleware (SQLite-Store, zentral in db/session.js)
    app.use(createSessionMiddleware({ resave: false, saveUninitialized: false }));

    // Register API routes AFTER session middleware
    console.log('Registering admin API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/admin', adminApi);
    console.log('✓ Admin API routes registered');

    // Admin Panel UI (Static)
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // Admin Panel Route
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'public', 'admin.html'));
    });

    // Redirect /admin.html to root
    app.get('/admin.html', (req, res) => {
      res.redirect('/');
    });

    // 404 Handler
    app.use(notFoundHandler('admin-panel'));

    // Error Handler
    app.use(jsonErrorHandler());

    // Start admin server
    const server = app.listen(ADMIN_PORT, HOST, () => {
      console.log(`🔐 DLRG Wachplan-Generator Admin Panel läuft`);
      console.log(`   URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${ADMIN_PORT}`);
      console.log(`   Authentifizierung: ENABLED`);
      console.log(`   Datenbank: ${dbPath}`);
    });

    installSigtermHandler(server, 'Admin Server');
  } catch (error) {
    console.error('❌ Fehler beim Starten des Admin Servers:', error.message);
    process.exit(1);
  }
}

installFatalHandlers();

start();
