// ============================================================
// Zentrale SQLite Datenbankverbindung
// Verhindert Konflikte zwischen mehreren sqlite3-Instanzen
// ============================================================

const sqlite3 = require('sqlite3');
const path = require('path');

// DATABASE_PATH wie in db/init.js respektieren – vorher las init.js die eine,
// connection.js stur die andere Datei (Inkonsistenz); außerdem nutzen Tests
// darüber eine Wegwerf-DB.
const dbPath = process.env.DATABASE_PATH || path.join(__dirname, '..', '..', 'data', 'wachplan.db');
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        db = null;
        return;
      }
      // Enable foreign key constraint enforcement (GDPR Art. 17 cascading deletes)
      db.run('PRAGMA foreign_keys = ON', (err) => {
        if (err) console.warn('⚠ Foreign keys error:', err.message);
      });
      // Enable WAL mode for better concurrency. Übersprungen im Test (NODE_ENV=test):
      // WAL legt -wal/-shm-Sidecar-Dateien an, deren Shared-Memory-Mapping auf manchen
      // (Container-/CI-)Dateisystemen unter dem schnellen Wegwerf-DB-Zyklus der Tests
      // sporadisch `SQLITE_IOERR` auslöst. Tests brauchen die WAL-Nebenläufigkeit nicht.
      if (process.env.NODE_ENV !== 'test') {
        db.run('PRAGMA journal_mode = WAL', (err) => {
          if (err) console.warn('⚠ WAL mode error:', err.message);
        });
      }
      db.run('PRAGMA busy_timeout = 5000', (err) => {
        if (err) console.warn('⚠ Busy timeout error:', err.message);
      });
    });

    db.on('error', (err) => {
      console.error('❌ Database error:', err);
    });
  }
  return db;
}

// Transiente SQLite-Fehler (`SQLITE_BUSY`, `SQLITE_IOERR`) treten unter Last bzw. auf
// manchen (Container-/CI-)Dateisystemen sporadisch auf, obwohl die Operation bei einem
// erneuten Versuch sofort gelingt. Ein kurzer, beschränkter Retry hält die DB-Schicht
// robust (und stabilisiert die Test-Suite), ohne echte Fehler dauerhaft zu verschlucken.
const TRANSIENT_CODES = new Set(['SQLITE_BUSY', 'SQLITE_IOERR', 'SQLITE_PROTOCOL']);
const MAX_DB_RETRIES = 5;

function _sleep(ms) { return new Promise(r => setTimeout(r, ms)); }

async function _withRetry(fn) {
  let lastErr;
  for (let attempt = 0; attempt <= MAX_DB_RETRIES; attempt++) {
    try {
      return await fn();
    } catch (err) {
      lastErr = err;
      if (!TRANSIENT_CODES.has(err && err.code) || attempt === MAX_DB_RETRIES) throw err;
      await _sleep(10 * (attempt + 1)); // 10,20,30,40,50ms Backoff
    }
  }
  throw lastErr;
}

// Promisify für async/await (mit Retry bei transienten Fehlern)
const dbRun = (query, params = []) => _withRetry(() => new Promise((resolve, reject) => {
  getDb().run(query, params, function(err) {
    if (err) reject(err);
    else resolve({ lastID: this.lastID, changes: this.changes });
  });
}));

const dbGet = (query, params = []) => _withRetry(() => new Promise((resolve, reject) => {
  getDb().get(query, params, (err, row) => {
    if (err) reject(err);
    else resolve(row);
  });
}));

const dbAll = (query, params = []) => _withRetry(() => new Promise((resolve, reject) => {
  getDb().all(query, params, (err, rows) => {
    if (err) reject(err);
    else resolve(rows || []);
  });
}));

module.exports = { getDb, dbRun, dbGet, dbAll, dbPath };
