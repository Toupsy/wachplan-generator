// ============================================================
// Session-Middleware (SQLite-Store) – zentral für server.js + admin-server.js
// ============================================================

const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { dbPath } = require('./connection');

// Erstellt die Session-Middleware mit SQLite-Store.
// Beiden Servern nun gemeinsam: resave=false, saveUninitialized=false
// → Sessions entstehen nur beim Login via regenerate(), reduziert DB-Bloat
// Per-Server Overrides via Optionen noch möglich wenn nötig (z.B. für Legacy).
// secure: GDPR (Art. 32) – setzen wenn HTTPS/TLS aktiv.
function createSessionMiddleware({ resave = false, saveUninitialized = false } = {}) {
  const store = new SqliteStore({ db: dbPath, mode: 0o666 });
  store.on('error', (err) => {
    console.warn('⚠ Session store error (continuing):', err.message);
  });
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
