// ============================================================
// Session-Middleware (SQLite-Store) – zentral für server.js + admin-server.js
// ============================================================

const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { dbPath } = require('./connection');
const DB_BUSY_TIMEOUT_MS = Number.parseInt(process.env.DB_BUSY_TIMEOUT_MS || '30000', 10);
const SESSION_STORE_RETRIES = Number.parseInt(process.env.SESSION_STORE_RETRIES || '5', 10);
const TRANSIENT_SESSION_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_IOERR', 'SQLITE_PROTOCOL']);

function isTransientSessionError(err) {
  return !!(err && TRANSIENT_SESSION_CODES.has(err.code));
}

function wrapStoreMethodWithRetry(store, methodName) {
  const original = store[methodName];
  if (typeof original !== 'function') return;

  store[methodName] = function(...args) {
    const cb = args[args.length - 1];
    if (typeof cb !== 'function') return original.apply(this, args);

    let attempt = 0;
    const run = () => {
      const retryArgs = args.slice(0, -1).concat((err, result) => {
        if (isTransientSessionError(err) && attempt < SESSION_STORE_RETRIES) {
          attempt += 1;
          setTimeout(run, 100 * attempt);
          return;
        }
        cb(err, result);
      });
      original.apply(this, retryArgs);
    };

    run();
  };
}

// Erstellt die Session-Middleware mit SQLite-Store.
// server.js nutzt resave/saveUninitialized=true (SQLite-Reliability),
// admin-server.js nutzt false/false → per Option überschreibbar.
// secure: GDPR (Art. 32) – setzen wenn HTTPS/TLS aktiv.
//
// WICHTIG: connect-sqlite3 baut den Pfad als `dir + '/' + db` und reicht
// `mode` als sqlite3-Open-Flags durch. Das frühere `{ db: dbPath, mode: 0o666 }`
// setzte dadurch versehentlich OPEN_MEMORY (0o666 enthält Bit 0x80) → Sessions
// lagen in einer In-Memory-DB: kein Überleben von Neustarts (Merke-mich) und
// die Session-Löschung (GDPR, Passwort-Reset) auf der Haupt-DB griff nie.
function createSessionMiddleware({ resave = true, saveUninitialized = true } = {}) {
  const store = new SqliteStore({ dir: path.dirname(dbPath), db: path.basename(dbPath) });
  store.on('error', (err) => {
    console.warn('⚠ Session store error (continuing):', err.message);
  });
  // Eigene Connection des Stores: ohne busy_timeout schlagen Session-Writes
  // mit SQLITE_BUSY fehl, sobald die Haupt-Connection gerade schreibt.
  // journal_mode=DELETE statt WAL erzwingen (wie connection.js/init.js): diese
  // dritte Writer-Connection darf die geteilte DB nicht auf WAL umschalten, sonst
  // korrumpiert die prozessübergreifende WAL-Koordination die Datei (SQLITE_CORRUPT).
  if (store.db && typeof store.db.run === 'function') {
    if (typeof store.db.configure === 'function') store.db.configure('busyTimeout', DB_BUSY_TIMEOUT_MS);
    store.db.run(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`, () => {});
    store.db.run('PRAGMA journal_mode = DELETE', () => {});
  }
  wrapStoreMethodWithRetry(store, 'get');
  wrapStoreMethodWithRetry(store, 'set');
  wrapStoreMethodWithRetry(store, 'destroy');
  // express-session calls store.touch() at the end of most authenticated requests
  // even when the session data did not change. On NAS-backed SQLite this turns
  // every plan save into an extra writer on the same DB file and can surface as
  // SQLITE_IOERR after the route already sent its JSON response. Session creation,
  // login, logout and explicit saves still write via set()/destroy(); this only
  // avoids the per-request expiry UPDATE. Set SESSION_TOUCH_WRITES=1 to restore it.
  if (process.env.SESSION_TOUCH_WRITES !== '1') {
    store.touch = (sid, session, fn) => {
      if (typeof fn === 'function') fn(null, true);
    };
  }
  const middleware = session({
    store,
    secret: process.env.SESSION_SECRET,
    resave,
    saveUninitialized,
    cookie: {
      secure: process.env.COOKIE_SECURE === 'true' || process.env.NODE_ENV === 'production',
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  });
  middleware.store = store;
  middleware.closeStore = () => new Promise((resolve) => {
    if (typeof store.close === 'function') return store.close(resolve);
    if (store.db && typeof store.db.close === 'function') return store.db.close(resolve);
    resolve();
  });
  return middleware;
}

module.exports = { createSessionMiddleware, _wrapStoreMethodWithRetry: wrapStoreMethodWithRetry };
