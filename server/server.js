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
const { createSessionMiddleware } = require('./db/session');
const { initDatabase, validateEnv, startPlanRetentionCleanup } = require('./db/init');
const authApi = require('./api/auth');
const plansApi = require('./api/plans');
const adminApi = require('./api/admin');
const importApi = require('./api/import');

const app = express();
app.set('trust proxy', 1);
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// Load app version at startup (not cached in require)
const APP_VERSION = (() => {
  try {
    const pkg = JSON.parse(fs.readFileSync(path.join(__dirname, '..', 'package.json'), 'utf-8'));
    return pkg.version;
  } catch {
    return 'unknown';
  }
})();

// ── GitHub-Release-Check (für /api/version) ────────────────────
// Serverseitig statt im Browser: kein CSP-Loch (connect-src bleibt 'self'),
// und das unauthentifizierte GitHub-Rate-Limit (60/h) trifft nur den Server.
const GITHUB_RELEASE_URL = 'https://api.github.com/repos/Toupsy/Wachplan-Generator/releases/latest';
const RELEASE_CACHE_TTL_MS = 6 * 60 * 60 * 1000; // 6h
let _releaseCache = { latest: null, releaseUrl: null, fetchedAt: 0 };

/** Vergleicht zwei Semver-Strings ("0.9.1"); >0 wenn a neuer als b. */
function compareVersions(a, b) {
  const pa = String(a).replace(/^v/, '').split('.').map(Number);
  const pb = String(b).replace(/^v/, '').split('.').map(Number);
  for (let i = 0; i < 3; i++) {
    const d = (pa[i] || 0) - (pb[i] || 0);
    if (d !== 0 || Number.isNaN(d)) return Number.isNaN(d) ? 0 : d;
  }
  return 0;
}

/** Neueste GitHub-Release-Version, in-memory gecacht. Fehler → latest:null. */
async function getLatestRelease() {
  if (Date.now() - _releaseCache.fetchedAt < RELEASE_CACHE_TTL_MS) return _releaseCache;
  try {
    const res = await fetch(GITHUB_RELEASE_URL, {
      headers: { 'Accept': 'application/vnd.github+json', 'User-Agent': 'wachplan-generator' },
      signal: AbortSignal.timeout(5000)
    });
    if (!res.ok) throw new Error(`GitHub API ${res.status}`);
    const data = await res.json();
    _releaseCache = {
      latest: String(data.tag_name || '').replace(/^v/, '') || null,
      releaseUrl: data.html_url || null,
      fetchedAt: Date.now()
    };
  } catch (err) {
    console.warn('GitHub release check failed:', err.message);
    // Fehlversuch ebenfalls cachen (15min), sonst hämmert jeder Seitenaufruf GitHub
    _releaseCache = { latest: null, releaseUrl: null, fetchedAt: Date.now() - RELEASE_CACHE_TTL_MS + 15 * 60 * 1000 };
  }
  return _releaseCache;
}

// ── Umgebungsvariablen validieren ──────────────────────────────
validateEnv();

// ── Middleware (vor Session-Init, wird unten konfiguriert) ───────
app.use(express.json({ limit: '10mb' }));
app.use(express.urlencoded({ extended: true, limit: '10mb' }));

// ── Basis-Security-Header ──────────────────────────────────────
app.use((req, res, next) => {
  res.setHeader('X-Content-Type-Options', 'nosniff');
  res.setHeader('X-Frame-Options', 'SAMEORIGIN');           // Clickjacking-Schutz
  res.setHeader('Referrer-Policy', 'same-origin');
  res.setHeader('Content-Security-Policy',
    "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
    "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com; " +
    "connect-src 'self' ws: wss:; frame-ancestors 'self'");
  if (process.env.NODE_ENV === 'production')
    res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
  next();
});

// ── Health-Check (für Docker/K8s) ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── Placeholder für API Routes (werden in start() registriert) ──

// ── Server starten ────────────────────────────────────────────
async function start() {
  try {
    const dbPath = path.join(__dirname, '..', 'data', 'wachplan.db');

    // Initialize database FIRST
    await initDatabase();
    console.log('✓ Database ready');

    // Start plan retention cleanup (if configured).
    // WICHTIG: connection.js exportiert kein `db`-Feld – die Verbindung kommt über
    // getDb() (Singleton, nach initDatabase live). Früher wurde hier `.db` (undefined)
    // übergeben → das 24h-Intervall warf TypeError (vom catch verschluckt) und die
    // DSGVO-Plan-Retention lief nie. getDb() liefert die gültige Laufzeit-Verbindung.
    const retentionDays = parseInt(process.env.PLAN_RETENTION_DAYS) || 0;
    const { getDb } = require('./db/connection');
    startPlanRetentionCleanup(getDb(), retentionDays);

    // Session middleware (SQLite-Store, zentral in db/session.js).
    // resave/saveUninitialized=true für SQLite-Reliability.
    // Referenz behalten → wird vom WebSocket-Upgrade (Realtime) zur Auth genutzt.
    const sessionMiddleware = createSessionMiddleware({ resave: true, saveUninitialized: true });
    app.use(sessionMiddleware);

    // Register API routes AFTER session middleware
    console.log('Registering API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/plans', plansApi);
    app.use('/api/admin', adminApi);
    app.use('/api/import', importApi);

    // Version endpoint (public, no auth needed)
    app.get('/api/version', async (req, res) => {
      const { latest, releaseUrl } = await getLatestRelease();
      res.json({
        version: APP_VERSION,
        latest,
        releaseUrl,
        updateAvailable: !!latest && compareVersions(latest, APP_VERSION) > 0
      });
    });

    // Config endpoint (public, no auth needed)
    app.get('/api/config', (req, res) => {
      const configPath = path.join(__dirname, 'config.json');
      try {
        const config = JSON.parse(fs.readFileSync(configPath, 'utf-8'));
        res.json(config);
      } catch (error) {
        console.error('Config load error:', error);
        res.status(500).json({ error: 'Config not available' });
      }
    });

    console.log('✓ API routes registered');

    // Register static files and SPA routes AFTER API routes
    app.use(express.static(path.join(__dirname, '..', 'public')));

    // SPA-Route: Immer index/main servieren
    app.get('/', (req, res) => {
      res.sendFile(path.join(__dirname, '..', 'public', 'Wachplan-Generator.html'));
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

    // Realtime/Live-Update (WebSocket auf /ws) an den HTTP-Server hängen
    const { setupRealtime } = require('./realtime');
    setupRealtime(server, sessionMiddleware);

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
