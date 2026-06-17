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
const { execFileSync, spawn } = require('child_process');

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

function runConcurrentInit(dbPath) {
  const script = `
    process.env.MASTER_SECRET='${'x'.repeat(40)}';
    process.env.SALT='${'y'.repeat(20)}';
    process.env.SESSION_SECRET='${'z'.repeat(20)}';
    process.env.ADMIN_USERNAME='admin';
    process.env.ADMIN_PASSWORD='${'p'.repeat(20)}';
    process.env.DB_INIT_LOCK_TIMEOUT_MS='10000';
    const { initDatabase } = require('./server/db/init');
    (async () => {
      await initDatabase();
      console.log('INIT_OK');
    })().catch(e => { console.error('ERR:' + e.code + ':' + e.message); process.exit(1); });
  `;

  const env = { ...process.env, DATABASE_PATH: dbPath, NODE_ENV: 'production' };
  const children = [
    spawn('node', ['-e', script], { cwd: REPO, env }),
    spawn('node', ['-e', script], { cwd: REPO, env })
  ];

  return Promise.all(children.map(child => new Promise((resolve) => {
    let out = '';
    let err = '';
    child.stdout.on('data', chunk => { out += chunk; });
    child.stderr.on('data', chunk => { err += chunk; });
    child.on('close', code => resolve({ code, out, err }));
  })));
}

test('App-Verbindung nutzt journal_mode=delete (kein WAL)', () => {
  const dbPath = path.join(os.tmpdir(), `journaltest_${process.pid}_${Date.now()}.db`);
  const out = journalModeAfterInit(dbPath);
  assert.match(out, /JOURNAL=delete/, 'journal_mode muss "delete" sein, war:\n' + out);
});

test('Parallele initDatabase-Prozesse serialisieren Schema-Initialisierung', async () => {
  const dbPath = path.join(os.tmpdir(), `inittest_${process.pid}_${Date.now()}.db`);
  const results = await runConcurrentInit(dbPath);
  const combined = results.map(r => r.out + r.err).join('\n--- child ---\n');

  assert.deepStrictEqual(results.map(r => r.code), [0, 0], combined);
  assert.match(combined, /INIT_OK/, combined);
  assert.doesNotMatch(combined, /SQLITE_CORRUPT|database disk image is malformed|Timed out waiting/, combined);
});

test('Gleichzeitige Writes zweier Verbindungen ohne SQLITE_CORRUPT', () => {
  const dbPath = path.join(os.tmpdir(), `journaltest2_${process.pid}_${Date.now()}.db`);
  const out = journalModeAfterInit(dbPath);
  assert.match(out, /AUDITROWS=2/, 'beide gleichzeitigen Inserts müssen ankommen:\n' + out);
  assert.doesNotMatch(out, /SQLITE_CORRUPT/, 'keine Korruption:\n' + out);
});
