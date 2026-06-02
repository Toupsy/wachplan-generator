// ============================================================
// Admin Server - Separate Port für Admin Panel
// Läuft auf Port 3001 (konfigurierbar via ADMIN_PORT)
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { initDatabase, validateEnv } = require('./db/init');
const authApi = require('./api/auth');
const adminApi = require('./api/admin');

const app = express();
app.set('trust proxy', 1);
const ADMIN_PORT = process.env.ADMIN_PORT || 3001;
const HOST = process.env.HOST || '0.0.0.0';

// ── Umgebungsvariablen validieren ──────────────────────────────
validateEnv();

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

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

    // THEN initialize session store
    const dbPath = path.join(__dirname, 'data', 'wachplan.db');
    const sessionStore = new SqliteStore({
      db: dbPath,
      mode: 0o666
    });

    // Handle session store errors gracefully
    sessionStore.on('error', (err) => {
      console.warn('⚠ Session store error (continuing):', err.message);
    });

    // THEN configure session middleware
    app.use(session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET,
      resave: false,
      saveUninitialized: false,
      cookie: {
        secure: process.env.COOKIE_SECURE === 'true',
        httpOnly: true,
        sameSite: 'strict',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    }));

    // Register API routes AFTER session middleware
    console.log('Registering admin API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/admin', adminApi);
    console.log('✓ Admin API routes registered');

    // Admin Panel UI (Static)
    app.use(express.static(path.join(__dirname, '.')));

    // Admin Panel Route
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'admin.html'));
    });

    // Redirect /admin.html to root
    app.get('/admin.html', (req, res) => {
      res.redirect('/');
    });

    // 404 Handler
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found', path: req.url, service: 'admin-panel' });
    });

    // Error Handler
    app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Handle uncaught errors
    process.on('uncaughtException', (err) => {
      console.error('❌ Uncaught Exception:', err);
    });

    process.on('unhandledRejection', (reason, promise) => {
      console.error('❌ Unhandled Rejection:', reason);
    });

    // Start admin server
    const server = app.listen(ADMIN_PORT, HOST, () => {
      console.log(`🔐 DLRG Wachplan-Generator Admin Panel läuft`);
      console.log(`   URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${ADMIN_PORT}`);
      console.log(`   Authentifizierung: ENABLED`);
      console.log(`   Datenbank: ${dbPath}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM empfangen, fahre herunter...');
      server.close(() => {
        console.log('Admin Server wurde beendet');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Fehler beim Starten des Admin Servers:', error.message);
    process.exit(1);
  }
}

start();
