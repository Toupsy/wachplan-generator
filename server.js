/**
 * Express.js Server für DLRG Wachplan-Generator
 * - SPA-Hosting mit Docker-Support
 * - Session-basierte Authentifizierung
 * - SQLite Database für User & Plans
 */

require('dotenv').config();  // Lade .env Datei

const express = require('express');
const path = require('path');
const fs = require('fs');
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
    const dbPath = path.join(__dirname, 'data', 'wachplan.db');

    // Initialize database FIRST
    await initDatabase();
    console.log('✓ Database ready');

    // THEN initialize session store - use same path
    // NOTE: sqlite3 handles concurrent connections via WAL mode
    const sessionStore = new SqliteStore({
      db: dbPath,
      mode: parseInt('0666', 8)  // rw-rw-rw- permissions
    });

    console.log('📦 Session store initialized with:', dbPath);

    // Handle session store errors gracefully
    sessionStore.on('error', (err) => {
      console.warn('⚠ Session store error (continuing):', err.message);
    });

    // Session middleware – secure:false weil der Proxy HTTPS terminiert
    // und intern über HTTP weiterleitet. Cookies funktionieren trotzdem
    // unter HTTPS, da der Secure-Flag nur HTTPS→HTTP verhindert.
    app.use(session({
      store: sessionStore,
      secret: process.env.SESSION_SECRET,
      resave: true,  // Force save on every request for SQLite reliability
      saveUninitialized: true,  // Save even uninitialized sessions
      cookie: {
        secure: false,
        httpOnly: true,
        sameSite: 'lax',
        maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
      }
    }));

    // Register API routes AFTER session middleware
    console.log('Registering API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/plans', plansApi);
    app.use('/api/admin', adminApi);
    app.use('/api/import', importApi);

    // Version endpoint (public, no auth needed)
    app.get('/api/version', (req, res) => {
      const versionPath = path.join(__dirname, 'VERSION');
      try {
        const version = fs.readFileSync(versionPath, 'utf-8').trim();
        res.json({ version });
      } catch (error) {
        res.status(500).json({ error: 'Version not available' });
      }
    });

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
  // For database errors, this is likely fatal - exit
  if (err.message && err.message.includes('database')) {
    console.error('⚠️  Database error - exiting');
    process.exit(1);
  }
  // Don't exit for other errors, let the server continue
});

process.on('unhandledRejection', (reason, promise) => {
  console.error('❌ Unhandled Rejection:', reason);
  // For database errors, this is likely fatal - exit
  if (reason && reason.message && reason.message.includes('database')) {
    console.error('⚠️  Database error - exiting');
    process.exit(1);
  }
  // Don't exit for other errors, let the server continue
});

start();
