/**
 * Express.js Server für DLRG Wachplan-Generator
 * - SPA-Hosting mit Docker-Support
 * - Session-basierte Authentifizierung
 * - SQLite Database für User & Plans
 */

const express = require('express');
const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { initDatabase, validateEnv } = require('./db/init');
const authApi = require('./api/auth');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ── Umgebungsvariablen validieren ──────────────────────────────
validateEnv();

// ── Session-Store initialisieren ──────────────────────────────
const dbPath = path.join(__dirname, 'data', 'wachplan.db');
const sessionStore = new SqliteStore({ db: dbPath });

// ── Middleware ───────────────────────────────────────────────
app.use(express.json());
app.use(express.urlencoded({ extended: true }));

// Session-Middleware
app.use(session({
  store: sessionStore,
  secret: process.env.SESSION_SECRET,
  resave: false,
  saveUninitialized: false,
  cookie: {
    secure: process.env.NODE_ENV === 'production',
    httpOnly: true,
    sameSite: 'strict',
    maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
  }
}));

// ── Health-Check (für Docker/K8s) ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── API Routes ──────────────────────────────────────────────────
app.use('/api/auth', authApi);

// ── Statische Dateien (NACH Auth-Routes) ──────────────────────
app.use(express.static(path.join(__dirname, '.')));

// ── SPA-Route: Immer index/main servieren ──────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Wachplan-Generator.html'));
});

// ── 404 Handler ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// ── Error Handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Server starten ────────────────────────────────────────────
async function start() {
  try {
    // Initialize database
    await initDatabase();
    console.log('✓ Database ready');

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

start();

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM empfangen, fahre herunter...');
  server.close(() => {
    console.log('Server wurde beendet');
    process.exit(0);
  });
});
