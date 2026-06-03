// ============================================================
// Session-Middleware (SQLite-Store) – zentral für server.js + admin-server.js
// ============================================================

const session = require('express-session');
const SqliteStore = require('connect-sqlite3')(session);
const { dbPath } = require('./connection');

// Erstellt die Session-Middleware mit SQLite-Store.
// server.js nutzt resave/saveUninitialized=true (SQLite-Reliability),
// admin-server.js nutzt false/false → per Option überschreibbar.
// secure:false, weil der Proxy HTTPS terminiert und intern via HTTP weiterleitet.
function createSessionMiddleware({ resave = true, saveUninitialized = true } = {}) {
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
      secure: false,
      httpOnly: true,
      sameSite: 'lax',
      maxAge: 7 * 24 * 60 * 60 * 1000 // 7 days
    }
  });
}

module.exports = { createSessionMiddleware };
