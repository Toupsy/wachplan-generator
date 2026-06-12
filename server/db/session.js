// ============================================================
// Session-Middleware (SQLite-Store) – zentral für server.js + admin-server.js
// ============================================================

const path = require('path');
const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { dbPath } = require('./connection');

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
  if (store.db && typeof store.db.run === 'function') {
    store.db.run('PRAGMA busy_timeout = 5000', () => {});
  }
  return session({
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
}

module.exports = { createSessionMiddleware };
