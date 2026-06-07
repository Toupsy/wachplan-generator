// ============================================================
// Admin Server - Separate Port für Admin Panel
// Läuft auf Port 3001 (konfigurierbar via ADMIN_PORT)
// ============================================================

require('dotenv').config();

const express = require('express');
const path = require('path');
const { createSessionMiddleware } = require('./db/session');
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

// ── Basis-Security-Header ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline'; " +
    "connect-src 'self' ws: wss:; frame-ancestors 'self'");
  if (process.env.NODE_ENV === 'production')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

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

    // Session middleware (SQLite-Store, zentral in db/session.js)
    const dbPath = path.join(__dirname, '..', 'data', 'wachplan.db');  // für Log unten
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
