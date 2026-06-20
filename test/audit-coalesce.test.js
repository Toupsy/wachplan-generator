// ============================================================
// audit-coalesce.test.js
// Regressionsschutz für das Audit-Log-Coalescing (auditLogCoalesced) + Retention.
// Autosave schreibt nach JEDER generate() ein plan_update – ohne Coalescing flutet
// das Admin-Audit-Log mit identischen „Wachplan-Änderungen". auditLogCoalesced fasst
// wiederholte Events pro User+Plan innerhalb eines Zeitfensters zu EINER Zeile zusammen.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');

// Fenster aktiv setzen, BEVOR init.js (Konstante wird beim require gelesen) geladen wird.
process.env.AUDIT_PLAN_UPDATE_WINDOW_MIN = '10';
// Pflicht-Secrets, damit das Modul ohne validateEnv-Abbruch ladbar ist.
process.env.MASTER_SECRET = process.env.MASTER_SECRET || 'x'.repeat(40);
process.env.SALT = process.env.SALT || 'y'.repeat(20);
process.env.SESSION_SECRET = process.env.SESSION_SECRET || 'z'.repeat(20);

const sqlite3 = require('sqlite3');
const { auditLog, auditLogCoalesced } = require('../server/db/init');

// Frische In-Memory-DB nur mit der audit_log-Tabelle (entkoppelt vom vollen Schema).
function freshDb() {
  const db = new sqlite3.Database(':memory:');
  return new Promise((resolve, reject) => {
    db.run(
      `CREATE TABLE audit_log (
        id INTEGER PRIMARY KEY AUTOINCREMENT,
        user_id INTEGER, action TEXT, entity_type TEXT, entity_id INTEGER,
        details TEXT, ip_address TEXT,
        timestamp DATETIME DEFAULT CURRENT_TIMESTAMP
      )`,
      (err) => (err ? reject(err) : resolve(db))
    );
  });
}

const rows = (db) =>
  new Promise((resolve, reject) =>
    db.all('SELECT * FROM audit_log ORDER BY id', (e, r) => (e ? reject(e) : resolve(r)))
  );

test('wiederholte plan_update werden pro User+Plan zu einer Zeile koalesziert', async () => {
  const db = await freshDb();
  for (let i = 0; i < 6; i++) {
    await auditLogCoalesced(db, 7, 'plan_update', 'plan', 42, null, '1.2.3.4');
  }
  const r = await rows(db);
  assert.strictEqual(r.length, 1, 'sechs Autosaves → genau eine Audit-Zeile');
  assert.strictEqual(r[0].entity_id, 42);
});

test('verschiedene Pläne/User koaleszieren nicht miteinander', async () => {
  const db = await freshDb();
  await auditLogCoalesced(db, 7, 'plan_update', 'plan', 42, null, null);
  await auditLogCoalesced(db, 7, 'plan_update', 'plan', 99, null, null); // anderer Plan
  await auditLogCoalesced(db, 8, 'plan_update', 'plan', 42, null, null); // anderer User
  const r = await rows(db);
  assert.strictEqual(r.length, 3);
});

test('Umbenennung (auditLog direkt) bleibt eine eigene Zeile', async () => {
  const db = await freshDb();
  await auditLogCoalesced(db, 7, 'plan_update', 'plan', 42, null, null);
  await auditLog(db, 7, 'plan_update', 'plan', 42, { name: 'Neuer Name' }, null);
  const r = await rows(db);
  assert.strictEqual(r.length, 2, 'bedeutsame Rename-Events werden nicht verdichtet');
});

test('Coalescing bumpt den Zeitstempel des bestehenden Eintrags', async () => {
  const db = await freshDb();
  const first = await auditLogCoalesced(db, 7, 'plan_update', 'plan', 42, null, null);
  // Eintrag künstlich altern lassen, dann erneut koaleszieren.
  await new Promise((res, rej) =>
    db.run("UPDATE audit_log SET timestamp = datetime('now','-1 minutes') WHERE id = ?", [first.id], (e) => (e ? rej(e) : res()))
  );
  const before = (await rows(db))[0].timestamp;
  const second = await auditLogCoalesced(db, 7, 'plan_update', 'plan', 42, null, null);
  assert.strictEqual(second.id, first.id, 'gleiche Zeile wiederverwendet');
  assert.strictEqual(second.coalesced, true);
  const after = (await rows(db))[0].timestamp;
  assert.ok(after >= before, 'Zeitstempel wurde aktualisiert');
});
