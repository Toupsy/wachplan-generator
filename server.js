/**
 * Express.js Server für DLRG Wachplan-Generator
 * - SPA-Hosting mit Docker-Support
 * - Session-basierte Authentifizierung
 * - SQLite Database für User & Plans
 */

require('dotenv').config();  // Lade .env Datei

const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { initDatabase, validateEnv } = require('./db/init');
const authApi = require('./api/auth');
const plansApi = require('./api/plans');
const adminApi = require('./api/admin');
const importApi = require('./api/import');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ── Umgebungsvariablen validieren ──────────────────────────────
validateEnv();

// ── Middleware (vor Session-Init, wird unten konfiguriert) ───────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// ── Health-Check (für Docker/K8s) ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Placeholder für API Routes (werden in start() registriert) ──

// ── Server starten ────────────────────────────────────────────
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
    console.log('Registering API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/plans', plansApi);
    app.use('/api/admin', adminApi);
    app.use('/api/import', importApi);
    console.log('✓ API routes registered');

    // Register static files and SPA routes AFTER API routes
    app.use(express.static(path.join(__dirname, '.')));

    // SPA-Route: Immer index/main servieren
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, 'Wachplan-Generator.html'));
    });

    // 404 Handler (NACH all anderen routes)
    app.use((req, res) => {
      res.status(404).json({ error: 'Not found', path: req.url });
    });

    // Error Handler
    app.use((err, req, res, next) => {
      console.error('Error:', err);
      res.status(500).json({ error: 'Internal server error' });
    });

    // Start server
    const server = app.listen(PORT, HOST, () => {
      console.log(`🚀 DLRG Wachplan-Generator läuft`);
      console.log(`   URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
      console.log(`   Authentifizierung: ENABLED`);
      console.log(`   Datenbank: ${dbPath}`);
    });

    // Graceful shutdown
    process.on('SIGTERM', () => {
      console.log('SIGTERM empfangen, fahre herunter...');
      server.close(() => {
        console.log('Server wurde beendet');
        process.exit(0);
      });
    });
  } catch (error) {
    console.error('❌ Fehler beim Starten des Servers:', error.message);
    process.exit(1);
  }
}

// Handle uncaught errors
process.on('uncaughtException', (err) => {
  console.error('❌ Uncaught Exception:', err);
  // Don't exit, let the server continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  // Don't exit, let the server continue
});

start();
