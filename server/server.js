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
const { initDatabase, validateEnv, startPlanRetentionCleanup, startAuditLogCleanup, startAuthTokensCleanup } = require('./db/init');
const authApi = require('./api/auth');
const plansApi = require('./api/plans');
const adminApi = require('./api/admin');
const importApi = require('./api/import');
const publicApi = require('./api/public');
const {
  securityHeaders,
  notFoundHandler,
  jsonErrorHandler,
  installSigtermHandler,
  installFatalHandlers,
  trustProxyValue,
  overrideClientIp,
} = require('./http-common');

const app = express();
app.set('trust proxy', trustProxyValue());
// Echte Client-IP aus Proxy-Headern (CF-Connecting-IP/X-Forwarded-For) übernehmen,
// damit Audit-Log + Rate-Limiting ohne NGINX-Umbau die echte IP sehen.
app.use(overrideClientIp());
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
// reCAPTCHA v3 (Bot-Schutz Registrierung/Passwort-Reset) braucht Script- und
// Frame-Freigaben für Google – nur wenn Keys konfiguriert sind (server/captcha.js).
const captchaEnabled = !!(process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY);
app.use(securityHeaders({ captcha: captchaEnabled, worker: true }));

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
    const { getDb, dbRun } = require('./db/connection');
    startPlanRetentionCleanup(getDb(), retentionDays);
    // Audit-Log-Cleanup: hält die plan_update-Historie schlank (Default 30 Tage,
    // konfigurierbar via AUDIT_PLAN_UPDATE_RETENTION_DAYS). Unabhängig von der Plan-Retention.
    startAuditLogCleanup(getDb());
    // auth_tokens-Cleanup: verbrauchte/abgelaufene Einmal-Tokens täglich bereinigen.
    startAuthTokensCleanup(getDb());

    // Pragma-Queue der Haupt-Connection (foreign_keys, journal_mode=DELETE,
    // busy_timeout) abwarten, BEVOR der Session-Store seine eigene Connection auf
    // dieselbe Datei öffnet – sonst racen der journal_mode-Switch und
    // CREATE TABLE sessions (IOERR).
    await dbRun('SELECT 1');

    // Session middleware (SQLite-Store, zentral in db/session.js).
    // Avoid rewriting sessions on every request; NAS-backed SQLite needs low write pressure.
    // Referenz behalten → wird vom WebSocket-Upgrade (Realtime) zur Auth genutzt.
    const sessionMiddleware = createSessionMiddleware({ resave: false, saveUninitialized: false });
    app.use(sessionMiddleware);

    // Register API routes AFTER session middleware
    console.log('Registering API routes...');
    app.use('/api/auth', authApi);
    app.use('/api/plans', plansApi);
    app.use('/api/admin', adminApi);
    app.use('/api/import', importApi);
    app.use('/api/public', publicApi);   // Beobachter-Links (kein Auth)

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

    // Register static files and SPA routes AFTER API routes.
    // Index-HTML mit Asset-Version ausliefern (Cache-Busting): die lokalen <script>-URLs
    // tragen ?v=__ASSET_V__ → beim Ausliefern durch APP_VERSION ersetzt. So holt der
    // Browser/CDN nach jedem Release garantiert die NEUEN JS-Dateien (andere Version =
    // andere Query = anderer Cache-Key) statt veralteter, gecachter Skripte.
    const INDEX_HTML = path.join(__dirname, '..', 'public', 'Wachplan-Generator.html');
    const serveIndex = (req, res) => {
      fs.readFile(INDEX_HTML, 'utf-8', (err, html) => {
        if (err) { res.status(500).send('Index nicht verfügbar'); return; }
        res.set('Cache-Control', 'no-cache');
        res.type('html').send(html.replace(/__ASSET_V__/g, encodeURIComponent(APP_VERSION)));
      });
    };
    // Index-Routen VOR express.static, damit die Versions-Injektion greift (nicht die Rohdatei).
    app.get('/', serveIndex);
    app.get('/Wachplan-Generator.html', serveIndex);

    app.use(express.static(path.join(__dirname, '..', 'public')));

    // 404 Handler (NACH all anderen routes)
    app.use(notFoundHandler());

    // Error Handler
    app.use(jsonErrorHandler());

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

    installSigtermHandler(server, 'Server');

    // ── Admin-Panel IM SELBEN Prozess auf ADMIN_PORT mitbedienen ──────
    // GRUND (SQLITE_CORRUPT-Dauerfix): Lief das Admin-Panel als zweiter Container
    // (admin-server.js) neben diesem Server, öffneten ZWEI Prozesse dieselbe
    // wachplan.db auf dem geteilten Volume. SQLite koordiniert gleichzeitige Zugriffe
    // nur INNERHALB eines Prozesses zuverlässig – zwischen Prozessen auf einem
    // (NAS-)Volume kippt das in transientes „database disk image is malformed"
    // (sichtbar seit das Audit-Log #294 beide Prozesse gleichzeitig schreiben ließ).
    // Ein Prozess, der beide Ports bedient, öffnet die DB nur einmal → Problem behoben.
    // Die Admin-App teilt sich dieselbe Session-Middleware (= dieselbe DB-Verbindung).
    // RUN_EMBEDDED_ADMIN=0 → klassischer Zwei-Prozess-Betrieb (nur mit getrennter DB!).
    const adminPort = process.env.ADMIN_PORT;
    if (adminPort && process.env.RUN_EMBEDDED_ADMIN !== '0') {
      const { createAdminApp } = require('./admin-server');
      const adminApp = createAdminApp({ sessionMiddleware });
      adminApp.listen(adminPort, HOST, () => {
        console.log(`🔐 Admin-Panel (eingebettet) läuft`);
        console.log(`   URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${adminPort}`);
      });
    }
  } catch (error) {
    console.error('❌ Fehler beim Starten des Servers:', error.message);
    process.exit(1);
  }
}

installFatalHandlers();

start();
