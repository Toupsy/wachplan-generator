// ============================================================
// db-session-autoheal.test.js
// Auto-Heilung einer auf die (wegwerfbare) sessions-Tabelle beschränkten
// DB-Beschädigung: erkennen + gefahrlos entfernen, ohne Nutzer/Pläne zu verlieren.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const os = require('os');
const path = require('path');
const sqlite3 = require('sqlite3');

// init.js liest beim Laden keine Pflicht-Env (validateEnv läuft separat),
// die Helfer arbeiten nur auf der übergebenen Verbindung.
const { isSessionsOnlyCorruption, healSessionCorruption } = require('../server/db/init');

// Reale Produktions-Meldung (gekürzt) als Referenz.
const REAL_MSG =
  'integrity_check: *** in database main ***; Tree 32 page 32 cell 1: Rowid 130 out of order; ' +
  'wrong # of entries in index sqlite_autoindex_sessions_1; ' +
  'row 43 missing from index sqlite_autoindex_sessions_1; ' +
  'row 44 missing from index sqlite_autoindex_sessions_1';

test('isSessionsOnlyCorruption: erkennt sessions-isolierte Beschädigung', () => {
  assert.strictEqual(isSessionsOnlyCorruption(REAL_MSG), true);
});

test('isSessionsOnlyCorruption: Schema-Index (idx_*) disqualifiziert', () => {
  assert.strictEqual(
    isSessionsOnlyCorruption('row 5 missing from index idx_plans_user_id; sessions erwähnt'),
    false
  );
});

test('isSessionsOnlyCorruption: Autoindex anderer Tabelle disqualifiziert', () => {
  assert.strictEqual(
    isSessionsOnlyCorruption('wrong # of entries in index sqlite_autoindex_users_1; sessions'),
    false
  );
});

test('isSessionsOnlyCorruption: ohne sessions-Bezug → false', () => {
  assert.strictEqual(isSessionsOnlyCorruption('Tree 4 page 4 cell 0: Rowid 1 out of order'), false);
  assert.strictEqual(isSessionsOnlyCorruption(''), false);
  assert.strictEqual(isSessionsOnlyCorruption(undefined), false);
});

function makeDb() {
  const file = path.join(os.tmpdir(), `autoheal_${process.pid}_${Date.now()}_${Math.random().toString(36).slice(2)}.db`);
  return new sqlite3.Database(file);
}

function setupData(db) {
  return new Promise((resolve, reject) => {
    db.serialize(() => {
      db.run('CREATE TABLE users (id INTEGER PRIMARY KEY, username TEXT UNIQUE)');
      db.run('CREATE TABLE plans (id INTEGER PRIMARY KEY, name TEXT)');
      db.run('CREATE TABLE sessions (sid TEXT PRIMARY KEY, expired INTEGER, sess TEXT)');
      db.run("INSERT INTO users (id,username) VALUES (1,'chief')");
      db.run("INSERT INTO plans (id,name) VALUES (1,'Plan A')");
      db.run("INSERT INTO sessions (sid,expired,sess) VALUES ('abc',1,'{}')", err =>
        err ? reject(err) : resolve()
      );
    });
  });
}

const get = (db, sql) => new Promise((res, rej) => db.get(sql, (e, r) => (e ? rej(e) : res(r))));
const all = (db, sql) => new Promise((res, rej) => db.all(sql, (e, r) => (e ? rej(e) : res(r))));

test('healSessionCorruption: entfernt sessions, bewahrt Nutzer/Pläne', async () => {
  delete process.env.DB_NO_SESSION_AUTOHEAL;
  const db = makeDb();
  await setupData(db);

  const healed = await healSessionCorruption(db, { message: REAL_MSG });
  assert.strictEqual(healed, true, 'sollte erfolgreich heilen');

  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  assert.ok(!tables.includes('sessions'), 'sessions-Tabelle entfernt');

  assert.strictEqual((await get(db, 'SELECT count(*) c FROM users')).c, 1, 'Nutzer erhalten');
  assert.strictEqual((await get(db, 'SELECT count(*) c FROM plans')).c, 1, 'Pläne erhalten');

  await new Promise(r => db.close(r));
});

test('healSessionCorruption: keine Heilung bei Nicht-sessions-Beschädigung', async () => {
  const db = makeDb();
  await setupData(db);
  const healed = await healSessionCorruption(db, { message: 'row 5 missing from index idx_plans_user_id' });
  assert.strictEqual(healed, false);
  const tables = (await all(db, "SELECT name FROM sqlite_master WHERE type='table'")).map(r => r.name);
  assert.ok(tables.includes('sessions'), 'sessions bleibt unangetastet');
  await new Promise(r => db.close(r));
});

test('healSessionCorruption: per DB_NO_SESSION_AUTOHEAL=1 abschaltbar', async () => {
  const db = makeDb();
  await setupData(db);
  process.env.DB_NO_SESSION_AUTOHEAL = '1';
  try {
    const healed = await healSessionCorruption(db, { message: REAL_MSG });
    assert.strictEqual(healed, false);
  } finally {
    delete process.env.DB_NO_SESSION_AUTOHEAL;
  }
  await new Promise(r => db.close(r));
});
