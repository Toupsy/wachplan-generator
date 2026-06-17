// ============================================================
// db-journal-mode.test.js
// Regressionsschutz: Die DB läuft im Rollback-Journal-Modus (DELETE), NICHT in WAL.
// WAL ist zwischen den zwei Containern (wachplan + wachplan-admin) auf dem geteilten
// Volume nicht prozess-kohärent → SQLITE_CORRUPT beim Schreiben (z. B. audit_log).
// DELETE nutzt POSIX-Locks und ist prozessübergreifend sicher.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

// In einem frischen Kindprozess (saubere DATABASE_PATH-Bindung) initialisieren und
// den effektiven journal_mode der App-Verbindung (connection.js) ausgeben.
function journalModeAfterInit(dbPath) {
  const script = `
    process.env.MASTER_SECRET='${'x'.repeat(40)}';
    process.env.SALT='${'y'.repeat(20)}';
    process.env.SESSION_SECRET='${'z'.repeat(20)}';
    const { initDatabase } = require('./server/db/init');
    const { getDb, dbAll, dbRun } = require('./server/db/connection');
    (async () => {
      await initDatabase();
      const r = await dbAll('PRAGMA journal_mode');
      // Gleichzeitige Writes über eine zweite Verbindung (admin-Prozess-Simulation):
      const sqlite3 = require('sqlite3');
      const db2 = new sqlite3.Database(process.env.DATABASE_PATH);
      await new Promise(res => db2.run('PRAGMA busy_timeout=5000', res));
      await Promise.all([
        dbRun("INSERT INTO audit_log (action) VALUES ('t1')"),
        new Promise((res, rej) => db2.run("INSERT INTO audit_log (action) VALUES ('t2')", e => e ? rej(e) : res())),
      ]);
      const c = await dbAll('SELECT COUNT(*) AS n FROM audit_log');
      console.log('JOURNAL=' + (r[0] && r[0].journal_mode));
      console.log('AUDITROWS=' + c[0].n);
      db2.close(); process.exit(0);
    })().catch(e => { console.error('ERR:' + e.code + ':' + e.message); process.exit(1); });
  `;
  const out = execFileSync('node', ['-e', script], {
    cwd: REPO,
    env: { ...process.env, DATABASE_PATH: dbPath, NODE_ENV: 'production' },
    encoding: 'utf8',
  });
  return out;
}

test('App-Verbindung nutzt journal_mode=delete (kein WAL)', () => {
  const dbPath = path.join(os.tmpdir(), `journaltest_${process.pid}_${Date.now()}.db`);
  const out = journalModeAfterInit(dbPath);
  assert.match(out, /JOURNAL=delete/, 'journal_mode muss "delete" sein, war:\n' + out);
});

test('Gleichzeitige Writes zweier Verbindungen ohne SQLITE_CORRUPT', () => {
  const dbPath = path.join(os.tmpdir(), `journaltest2_${process.pid}_${Date.now()}.db`);
  const out = journalModeAfterInit(dbPath);
  assert.match(out, /AUDITROWS=2/, 'beide gleichzeitigen Inserts müssen ankommen:\n' + out);
  assert.doesNotMatch(out, /SQLITE_CORRUPT/, 'keine Korruption:\n' + out);
});
