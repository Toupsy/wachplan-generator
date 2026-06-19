// ============================================================
// Admin Server - Separate Port für Admin Panel
// Läuft auf Port 3001 (konfigurierbar via ADMIN_PORT)
//
// WICHTIG (SQLITE_CORRUPT-Ursache): Wird dieser Entry-Point als EIGENER Prozess
// neben server.js gestartet (zwei Container, gleiches Volume), öffnen ZWEI Prozesse
// dieselbe wachplan.db. SQLite koordiniert gleichzeitige Zugriffe nur INNERHALB eines
// Prozesses zuverlässig (per-Inode-Mutex); zwischen Prozessen hängt es an den
// advisory-Locks + Page-Cache-Kohärenz des Dateisystems – auf einem (NAS-/Netzwerk-)
// Volume unzuverlässig → transientes „database disk image is malformed". Daher bettet
// server.js dieses Panel im Standard-Deployment über `createAdminApp()` in den
// HAUPTPROZESS ein (ein einziger DB-Öffner). Dieser Standalone-Start bleibt für
// Setups erhalten, die das Panel bewusst getrennt betreiben (dann aber EIGENE DB!).
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

const HOST = process.env.HOST || '0.0.0.0';

// Baut die Admin-Panel-Express-App.
// `sessionMiddleware` kann übergeben werden, damit der Hauptprozess (server.js) das
// Panel auf ADMIN_PORT mitbedienen kann, ohne eine zweite DB-Verbindung/-Prozess zu
// öffnen. Ohne Übergabe (echter Standalone-Betrieb) erzeugt die App ihre eigene.
function createAdminApp({ sessionMiddleware } = {}) {
  const app = express();
  app.set('trust proxy', 1);

  app.use(express.json());
  app.use(express.urlencoded({ extended: true }));
  app.use(securityHeaders());

  app.get('/health', (req, res) => {
    res.json({ status: 'ok', service: 'admin-panel', timestamp: new Date().toISOString() });
  });

  app.use(sessionMiddleware || createSessionMiddleware({ resave: false, saveUninitialized: false }));

  app.use('/api/auth', authApi);
  app.use('/api/admin', adminApi);

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

  app.use(notFoundHandler('admin-panel'));
  app.use(jsonErrorHandler());

  return app;
}

// ── Admin Server starten (Standalone-Prozess) ───────────────────
async function start() {
  try {
    validateEnv();

    // Initialize database FIRST
    await initDatabase();
    console.log('✓ Database ready');

    // Wait until the runtime connection has applied busy_timeout/journal_mode
    // before connect-sqlite3 opens its own writer connection.
    await dbRun('SELECT 1');

    const ADMIN_PORT = process.env.ADMIN_PORT || 3001;
    const app = createAdminApp();

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

module.exports = { createAdminApp };

// Nur als eigener Prozess starten, wenn direkt aufgerufen – beim `require` aus
// server.js (eingebettetes Panel) darf KEIN zweiter Listener/DB-Prozess hochfahren.
if (require.main === module) {
  installFatalHandlers();
  start();
}
