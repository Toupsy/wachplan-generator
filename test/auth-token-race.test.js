/**
 * test/auth-token-race.test.js
 *
 * Regressionstest für den atomaren Einmal-Token-Wächter in consumeAuthToken.
 * Verifiziert, dass das UPDATE mit vollständiger WHERE-Bedingung (inkl.
 * used_at IS NULL) als atomarer Wächter fungiert – nur der erste Aufruf
 * erhält changes === 1, alle weiteren changes === 0.
 */

const path = require('path');
const fs = require('fs');
const crypto = require('node:crypto');

const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
for (const f of fs.readdirSync(dataDir)) {
  if (f.startsWith('test-token-race-')) { try { fs.unlinkSync(path.join(dataDir, f)); } catch {} }
}
const testDbPath = path.join(dataDir, `test-token-race-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;
process.env.MASTER_SECRET = 'test-master-secret-test-master-secret';
process.env.SALT = 'test-salt-test-salt';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.REGISTRATION_MODE = 'disabled';
delete process.env.SMTP_HOST;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { initDatabase } = require('../server/db/init');
const { dbRun, getDb } = require('../server/db/connection');

function hashToken(t) {
  return crypto.createHash('sha256').update(t).digest('hex');
}

async function insertToken(userId, type, ttlMs = 60_000) {
  const token = crypto.randomBytes(32).toString('hex');
  const hash = hashToken(token);
  await dbRun(
    'INSERT INTO auth_tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)',
    [userId, hash, type, Date.now() + ttlMs]
  );
  return { token, hash };
}

function atomicClaim(hash, type) {
  return dbRun(
    'UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?',
    [hash, type, Date.now()]
  );
}

test('Auth-Token-Race: atomarer UPDATE-Wächter verhindert Doppeleinlösung', async (t) => {
  await initDatabase();
  // Rollback-Journal wie in server.js (kein WAL in Tests)
  await dbRun('PRAGMA journal_mode = DELETE');

  // Testnutzer anlegen (kein Admin-Seed ohne ADMIN_USERNAME/ADMIN_PASSWORD)
  const { lastID: userId } = await dbRun(
    "INSERT INTO users (username, password_hash, is_admin) VALUES ('testuser', 'x', 0)"
  );

  await t.test('zwei parallele Einlösungen → genau einer gewinnt (changes=1)', async () => {
    const { hash } = await insertToken(userId, 'password_reset');
    const [r1, r2] = await Promise.all([
      atomicClaim(hash, 'password_reset'),
      atomicClaim(hash, 'password_reset'),
    ]);
    const wins = [r1.changes, r2.changes].filter(c => c === 1).length;
    const losses = [r1.changes, r2.changes].filter(c => c === 0).length;
    assert.equal(wins, 1, 'Genau ein UPDATE muss das Token beanspruchen');
    assert.equal(losses, 1, 'Das andere UPDATE muss changes=0 liefern');
  });

  await t.test('bereits eingelöstes Token liefert changes=0', async () => {
    const { hash } = await insertToken(userId, 'verify_email');
    const r1 = await atomicClaim(hash, 'verify_email');
    assert.equal(r1.changes, 1, 'Erste Einlösung muss erfolgreich sein');
    const r2 = await atomicClaim(hash, 'verify_email');
    assert.equal(r2.changes, 0, 'Zweite Einlösung muss scheitern (used_at gesetzt)');
  });

  await t.test('abgelaufenes Token kann nicht eingelöst werden', async () => {
    const { hash } = await insertToken(userId, 'password_reset', -1000);
    const r = await atomicClaim(hash, 'password_reset');
    assert.equal(r.changes, 0, 'Abgelaufenes Token darf nicht eingelöst werden');
  });

  await t.test('falscher Typ liefert changes=0 (kein Cross-Type-Reuse)', async () => {
    const { hash } = await insertToken(userId, 'verify_email', 60_000);
    const r = await atomicClaim(hash, 'password_reset');
    assert.equal(r.changes, 0, 'Falscher Typ darf Token nicht einlösen');
  });

  // ── Teardown ──
  await new Promise(resolve => getDb().close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) try { fs.unlinkSync(f); } catch {}
  }
});
