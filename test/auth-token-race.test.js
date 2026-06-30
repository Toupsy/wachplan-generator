/**
 * test/auth-token-race.test.js
 *
 * Regression-Test gegen die TOCTOU-Lücke in consumeAuthToken().
 *
 * Vorher las consumeAuthToken die Zeile per SELECT (used_at IS NULL) und setzte
 * used_at in einem SEPARATEN UPDATE. Zwei gleichzeitige Anfragen mit demselben
 * Token (Doppelklick auf den Reset-Link / Replay) konnten beide das SELECT
 * bestehen, bevor eine das UPDATE ausführte → Token doppelt eingelöst.
 *
 * Fix: das UPDATE ist selbst der Wächter (used_at IS NULL in der WHERE-Klausel);
 * nur der Aufruf mit this.changes === 1 erhält die Zeile. Dieser Test feuert N
 * gleichzeitige Einlösungen auf dasselbe Token und erwartet GENAU EINE Erfolg.
 */

const path = require('node:path');
const fs = require('node:fs');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
for (const f of fs.readdirSync(dataDir)) {
  if (f.startsWith('test-tokrace-')) { try { fs.unlinkSync(path.join(dataDir, f)); } catch {} }
}
const testDbPath = path.join(dataDir, `test-tokrace-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;
process.env.MASTER_SECRET = 'test-master-secret-test-master-secret';
process.env.SALT = 'test-salt-test-salt';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.MAIL_TRANSPORT = 'outbox';
delete process.env.SMTP_HOST;

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../server/db/init');
const { dbRun, dbGet, getDb } = require('../server/db/connection');
const authApi = require('../server/api/auth');

const { _createAuthToken: createAuthToken, _consumeAuthToken: consumeAuthToken } = authApi;

let userId;

before(async () => {
  await initDatabase();
  const res = await dbRun(
    "INSERT INTO users (username, password_hash, is_admin) VALUES ('tokrace', 'x', 0)"
  );
  userId = res.lastID;
});

after(() => {
  try { getDb().close(); } catch {}
  for (const ext of ['', '-wal', '-shm', '-journal']) {
    try { fs.unlinkSync(testDbPath + ext); } catch {}
  }
});

test('Token-Helfer sind am Router exportiert', () => {
  assert.equal(typeof createAuthToken, 'function');
  assert.equal(typeof consumeAuthToken, 'function');
});

test('Gleichzeitige Einlösung desselben Tokens gelingt genau einmal', async () => {
  const token = await createAuthToken(userId, 'password_reset');

  // N parallele Einlösungen – nur eine darf die Zeile bekommen.
  const N = 8;
  const results = await Promise.all(
    Array.from({ length: N }, () => consumeAuthToken(token, 'password_reset'))
  );

  const winners = results.filter(r => r && r.user_id === userId);
  assert.equal(winners.length, 1, `Genau ein Aufruf darf das Token einlösen, war: ${winners.length}`);

  // Danach ist das Token verbraucht.
  const again = await consumeAuthToken(token, 'password_reset');
  assert.equal(again, null, 'verbrauchtes Token darf nicht erneut einlösbar sein');
});

test('Falscher Typ / ungültiges Format lösen nicht ein', async () => {
  const token = await createAuthToken(userId, 'verify_email');
  assert.equal(await consumeAuthToken(token, 'password_reset'), null, 'Typ-Mismatch → kein Treffer');
  assert.equal(await consumeAuthToken('zu-kurz', 'verify_email'), null, 'ungültiges Format → null');
  // korrekter Typ löst ein
  const ok = await consumeAuthToken(token, 'verify_email');
  assert.ok(ok && ok.user_id === userId, 'korrekter Typ löst ein');
});

test('Abgelaufenes Token wird nicht eingelöst', async () => {
  const token = await createAuthToken(userId, 'password_reset');
  // Ablauf in die Vergangenheit setzen
  await dbRun('UPDATE auth_tokens SET expires_at = ? WHERE user_id = ? AND type = ?',
    [Date.now() - 1000, userId, 'password_reset']);
  assert.equal(await consumeAuthToken(token, 'password_reset'), null, 'abgelaufen → null');
});
