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
const DB_BUSY_TIMEOUT_MS = Number.parseInt(process.env.DB_BUSY_TIMEOUT_MS || '30000', 10);
let db = null;

function getDb() {
  if (!db) {
    db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX,
      (err) => {
      if (err) {
        console.error('❌ Database connection error:', err);
        db = null;
        return;
      }
      if (typeof db.configure === 'function') db.configure('busyTimeout', DB_BUSY_TIMEOUT_MS);
      // Enable foreign key constraint enforcement (GDPR Art. 17 cascading deletes)
      db.run('PRAGMA foreign_keys = ON', (err) => {
        if (err) console.warn('⚠ Foreign keys error:', err.message);
      });
      // Rollback-Journal (DELETE) statt WAL.
      // GRUND (SQLITE_CORRUPT-Dauerfix): In docker-compose teilen sich ZWEI Prozesse
      // (wachplan + wachplan-admin, gleiches Image) dieselbe DB auf dem Volume
      // `wachplan-data`. WALs Shared-Memory-Koordination (`-shm`, mmap) ist
      // prozessübergreifend NICHT kohärent → „database disk image is malformed"
      // schon beim ersten gleichzeitigen Schreiben (z. B. audit_log beim plan_create).
      // DELETE-Modus nutzt POSIX-fcntl-Locks, die zwischen Prozessen zuverlässig
      // serialisieren; `busy_timeout` lässt contendende Writer warten statt mit
      // SQLITE_BUSY zu scheitern. Für die geringe Schreiblast völlig ausreichend.
      db.run(`PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`, (err) => {
        if (err) console.warn('⚠ Busy timeout error:', err.message);
      });
      db.run('PRAGMA journal_mode = DELETE', (err) => {
        if (err) console.warn('⚠ journal_mode error:', err.message);
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
