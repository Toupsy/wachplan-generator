// ============================================================
// Session-Middleware (SQLite-Store) – zentral für server.js + admin-server.js
// ============================================================

const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { dbPath } = require('./connection');

// Eigene DB-Datei NUR für Sessions. KERNFIX gegen SQLITE_CORRUPT: Früher öffnete
// connect-sqlite3 eine zweite, eigenständige sqlite3-Connection auf DIESELBE
// wachplan.db wie die Haupt-App (getDb()). Zwei unabhängige Writer auf eine Datei –
// zumal auf NAS-Volumes mit unzuverlässigem fcntl-Locking – korrumpieren die Freelist
// ("Page N: never used", "freelist leaf count too big", "2nd reference to page").
// Eine eigene Datei bedeutet genau EINEN Writer pro Datei → SQLites Rollback-Journal
// (DELETE) ist wieder absturzsicher, auch bei hartem Container-Kill. Über
// SESSION_DB_PATH überschreibbar.
const sessionDbPath = process.env.SESSION_DB_PATH
  || path.join(path.dirname(dbPath), 'sessions.db');

// Singleton-Referenz auf den aktiven Store, damit destroyUserSessions() Sessions
// über DESSEN eigene Connection löschen kann (statt über die Haupt-Connection einen
// zweiten Writer auf die sessions-Tabelle zu setzen).
let activeStore = null;

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
  const store = new SqliteStore({ dir: path.dirname(sessionDbPath), db: path.basename(sessionDbPath) });
  activeStore = store;
  store.on('error', (err) => {
    console.warn('⚠ Session store error (continuing):', err.message);
  });
  // Eigene Connection des Stores: ohne busy_timeout schlagen Session-Writes
  // mit SQLITE_BUSY fehl, sobald gleichzeitig geschrieben wird.
  // journal_mode=DELETE statt WAL erzwingen (wie connection.js/init.js): kein
  // prozessübergreifendes WAL-Shared-Memory auf NAS-Volumes.
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

// Invalidiert alle Sessions eines Users über die EIGENE Connection des Stores
// (sessions.db). Ersetzt das frühere `DELETE FROM sessions` auf der Haupt-Connection
// (auth.js/admin.js), das die sessions-Tabelle in der Haupt-DB voraussetzte und einen
// zweiten Writer auf wachplan.db einführte. No-op, solange noch keine Session
// geschrieben wurde (Tabelle existiert dann noch nicht).
// Transiente Fehler (BUSY/LOCKED/IOERR) werden mit Backoff bis SESSION_STORE_RETRIES
// wiederholt, damit Passwort-Reset-Sicherheitsversprechen auch bei kurzen Store-Fehlern hält.
function destroyUserSessions(userId) {
  return new Promise((resolve, reject) => {
    const store = activeStore;
    if (!store || !store.db || typeof store.db.run !== 'function') return resolve(0);
    let attempt = 0;
    const run = () => {
      store.db.run(
        "DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?",
        [userId],
        function(err) {
          if (err) {
            if (/no such table/i.test(err.message)) return resolve(0);
            if (isTransientSessionError(err) && attempt < SESSION_STORE_RETRIES) {
              attempt += 1;
              setTimeout(run, 100 * attempt);
              return;
            }
            return reject(err);
          }
          resolve(this.changes);
        }
      );
    };
    run();
  });
}

module.exports = { createSessionMiddleware, destroyUserSessions, _wrapStoreMethodWithRetry: wrapStoreMethodWithRetry };
