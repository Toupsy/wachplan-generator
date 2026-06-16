/**
 * test/auth-flow.test.js
 *
 * Integrationstest für Registrierung mit E-Mail-Verifizierung,
 * Login-Sperre für unbestätigte Accounts, Passwort-Reset per
 * Einmal-Token und reCAPTCHA-Verifizierung (gemockt).
 *
 * Läuft gegen eine Wegwerf-SQLite-DB (DATABASE_PATH) und den
 * Outbox-Mail-Transport (MAIL_TRANSPORT=outbox, kein SMTP nötig).
 */

const path = require('path');
const fs = require('fs');

// Env MUSS vor den requires stehen (REGISTRATION_MODE & dbPath werden bei
// Modul-Load gelesen)
const dataDir = path.join(__dirname, '..', 'data');
fs.mkdirSync(dataDir, { recursive: true });
// Reste abgestürzter früherer Läufe entsorgen (Teardown läuft dann nicht)
for (const f of fs.readdirSync(dataDir)) {
  if (f.startsWith('test-auth-')) { try { fs.unlinkSync(path.join(dataDir, f)); } catch {} }
}
const testDbPath = path.join(dataDir, `test-auth-${process.pid}-${Date.now()}.db`);
process.env.DATABASE_PATH = testDbPath;
process.env.MASTER_SECRET = 'test-master-secret-test-master-secret';
process.env.SALT = 'test-salt-test-salt';
process.env.SESSION_SECRET = 'test-session-secret';
process.env.REGISTRATION_MODE = 'open';
process.env.MAIL_TRANSPORT = 'outbox';
process.env.APP_BASE_URL = 'http://example.test';
delete process.env.RECAPTCHA_SITE_KEY;
delete process.env.RECAPTCHA_SECRET_KEY;
delete process.env.SMTP_HOST;

const { test } = require('node:test');
const assert = require('node:assert/strict');
const express = require('express');
const { initDatabase } = require('../server/db/init');
const { createSessionMiddleware } = require('../server/db/session');
const { dbGet, dbRun, getDb } = require('../server/db/connection');
const mailer = require('../server/mailer');
const captcha = require('../server/captcha');
const authApi = require('../server/api/auth');

let server, base;

function lastMail() {
  return mailer._outbox[mailer._outbox.length - 1];
}

async function api(method, p, body, cookie) {
  const res = await fetch(base + p, {
    method,
    redirect: 'manual',
    headers: {
      'Content-Type': 'application/json',
      ...(cookie ? { Cookie: cookie } : {})
    },
    body: body ? JSON.stringify(body) : undefined
  });
  let data = null;
  try { data = await res.json(); } catch {}
  return { status: res.status, data, headers: res.headers };
}

test('Auth-Flow: Registrierung, Verifizierung, Login, Passwort-Reset', async (t) => {
  // ── Setup: DB + Express-App mit Session + Auth-Routen ──
  await initDatabase();
  // WAL ist in Sandbox-Dateisystemen mit zwei Connections (Haupt + Session-Store)
  // unzuverlässig (sporadisch SQLITE_CORRUPT) → Tests fahren mit klassischem
  // Rollback-Journal. Wartet zugleich die Pragma-Queue von getDb() ab, BEVOR
  // der Session-Store seine Connection öffnet (wie server.js).
  await dbRun('PRAGMA journal_mode = DELETE');
  const app = express();
  app.use(createSessionMiddleware({}));
  app.use('/api/auth', authApi);
  await new Promise(resolve => { server = app.listen(0, '127.0.0.1', resolve); });
  base = `http://127.0.0.1:${server.address().port}`;

  let verifyToken, resetToken, sessionCookie;

  await t.test('registration-status meldet Verifizierung + Reset aktiv, kein CAPTCHA', async () => {
    const { status, data } = await api('GET', '/api/auth/registration-status');
    assert.equal(status, 200);
    assert.equal(data.enabled, true);
    assert.equal(data.emailVerification, true);
    assert.equal(data.passwordReset, true);
    assert.equal(data.captchaSiteKey, null);
  });

  await t.test('Registrierung ohne E-Mail wird abgelehnt (Verifizierung aktiv)', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      username: 'alice', password: 'supersecret123', acceptedPrivacy: true
    });
    assert.equal(status, 400);
  });

  await t.test('Registrierung mit Passwort-Mismatch wird abgelehnt', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      username: 'alice', password: 'supersecret123', password2: 'anderespasswort1',
      email: 'alice@example.test', acceptedPrivacy: true
    });
    assert.equal(status, 400);
    assert.match(data.error, /stimmen nicht überein/);
  });

  await t.test('Registrierung mit ungültiger E-Mail wird abgelehnt', async () => {
    const { status } = await api('POST', '/api/auth/register', {
      username: 'alice', password: 'supersecret123', password2: 'supersecret123',
      email: 'keine-email', acceptedPrivacy: true
    });
    assert.equal(status, 400);
  });

  await t.test('Registrierung legt unbestätigten Account an + versendet Mail', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      username: 'alice', password: 'supersecret123', password2: 'supersecret123',
      email: 'alice@example.test', acceptedPrivacy: true
    });
    assert.equal(status, 200);
    assert.equal(data.verificationRequired, true);

    const user = await dbGet('SELECT pending_verification FROM users WHERE username = ?', ['alice']);
    assert.equal(user.pending_verification, 1);

    assert.equal(mailer._outbox.length, 1);
    assert.equal(lastMail().to, 'alice@example.test');
    const m = lastMail().text.match(/verify-email\?token=([a-f0-9]{64})/);
    assert(m, 'Mail enthält Verifizierungslink');
    verifyToken = m[1];
  });

  await t.test('Doppelte E-Mail wird generisch abgelehnt (keine Enumeration)', async () => {
    const { status, data } = await api('POST', '/api/auth/register', {
      username: 'alice2', password: 'supersecret123', password2: 'supersecret123',
      email: 'alice@example.test', acceptedPrivacy: true
    });
    assert.equal(status, 400);
    assert.equal(data.error, 'Registrierung nicht möglich');
  });

  await t.test('Login vor Verifizierung wird mit 403/email_unverified blockiert', async () => {
    const { status, data } = await api('POST', '/api/auth/login', {
      username: 'alice', password: 'supersecret123'
    });
    assert.equal(status, 403);
    assert.equal(data.code, 'email_unverified');
  });

  await t.test('resend-verification sendet neue Mail (alter Token wird entwertet)', async () => {
    const { status } = await api('POST', '/api/auth/resend-verification', { username: 'alice' });
    assert.equal(status, 200);
    assert.equal(mailer._outbox.length, 2);
    const m = lastMail().text.match(/verify-email\?token=([a-f0-9]{64})/);
    assert(m);
    const oldToken = verifyToken;
    verifyToken = m[1];
    assert.notEqual(verifyToken, oldToken);

    // Alter Token ist tot
    const res = await api('GET', `/api/auth/verify-email?token=${oldToken}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?verified=0');
  });

  await t.test('Ungültiger Verifizierungstoken → Redirect /?verified=0', async () => {
    const res = await api('GET', '/api/auth/verify-email?token=' + 'f'.repeat(64));
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?verified=0');
  });

  await t.test('Gültiger Verifizierungstoken aktiviert Account', async () => {
    const res = await api('GET', `/api/auth/verify-email?token=${verifyToken}`);
    assert.equal(res.status, 302);
    assert.equal(res.headers.get('location'), '/?verified=1');

    const user = await dbGet('SELECT pending_verification FROM users WHERE username = ?', ['alice']);
    assert.equal(user.pending_verification, 0);

    // Token-Wiederverwendung schlägt fehl
    const reuse = await api('GET', `/api/auth/verify-email?token=${verifyToken}`);
    assert.equal(reuse.headers.get('location'), '/?verified=0');
  });

  await t.test('Login nach Verifizierung funktioniert (Session-Cookie)', async () => {
    const res = await fetch(base + '/api/auth/login', {
      method: 'POST',
      headers: { 'Content-Type': 'application/json' },
      body: JSON.stringify({ username: 'alice', password: 'supersecret123' })
    });
    assert.equal(res.status, 200);
    sessionCookie = (res.headers.get('set-cookie') || '').split(';')[0];
    assert(sessionCookie, 'Set-Cookie vorhanden');

    const me = await api('GET', '/api/auth/me', null, sessionCookie);
    assert.equal(me.status, 200);
    assert.equal(me.data.username, 'alice');
  });

  await t.test('Reset-Anfrage für unbekannte E-Mail antwortet generisch, ohne Mail', async () => {
    const before = mailer._outbox.length;
    const { status, data } = await api('POST', '/api/auth/request-password-reset', {
      email: 'unbekannt@example.test'
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);
    assert.equal(mailer._outbox.length, before);
  });

  await t.test('Reset-Anfrage für bekannte E-Mail versendet Reset-Link', async () => {
    const { status } = await api('POST', '/api/auth/request-password-reset', {
      email: 'alice@example.test'
    });
    assert.equal(status, 200);
    const m = lastMail().text.match(/\?reset=([a-f0-9]{64})/);
    assert(m, 'Mail enthält Reset-Link');
    resetToken = m[1];
  });

  await t.test('reset-password validiert Token und Passwortlänge', async () => {
    let res = await api('POST', '/api/auth/reset-password', {
      token: 'f'.repeat(64), password: 'neuespasswort1', password2: 'neuespasswort1'
    });
    assert.equal(res.status, 400);

    res = await api('POST', '/api/auth/reset-password', {
      token: resetToken, password: 'kurz', password2: 'kurz'
    });
    assert.equal(res.status, 400);
  });

  await t.test('Gültiger Reset setzt Passwort und invalidiert Sessions', async () => {
    const { status, data } = await api('POST', '/api/auth/reset-password', {
      token: resetToken, password: 'neuespasswort1', password2: 'neuespasswort1'
    });
    assert.equal(status, 200);
    assert.equal(data.success, true);

    // Alte Session ist tot (alle Sessions des Users gelöscht)
    const me = await api('GET', '/api/auth/me', null, sessionCookie);
    assert.equal(me.status, 401);

    // Altes Passwort ungültig, neues funktioniert
    const oldLogin = await api('POST', '/api/auth/login', { username: 'alice', password: 'supersecret123' });
    assert.equal(oldLogin.status, 401);
    const newLogin = await api('POST', '/api/auth/login', { username: 'alice', password: 'neuespasswort1' });
    assert.equal(newLogin.status, 200);

    // Token-Wiederverwendung schlägt fehl
    const reuse = await api('POST', '/api/auth/reset-password', {
      token: resetToken, password: 'nochmalneu123', password2: 'nochmalneu123'
    });
    assert.equal(reuse.status, 400);
  });

  await t.test('Abgelaufener Reset-Token wird abgelehnt', async () => {
    await api('POST', '/api/auth/request-password-reset', { email: 'alice@example.test' });
    const m = lastMail().text.match(/\?reset=([a-f0-9]{64})/);
    const token = m[1];
    // Ablauf in die Vergangenheit setzen
    await dbRun('UPDATE auth_tokens SET expires_at = ? WHERE type = ?', [Date.now() - 1000, 'password_reset']);

    const res = await api('POST', '/api/auth/reset-password', {
      token, password: 'neuespasswort2', password2: 'neuespasswort2'
    });
    assert.equal(res.status, 400);
  });

  await t.test('CAPTCHA: fehlendes/abgelehntes Token blockiert, gültiges erlaubt Registrierung', async () => {
    process.env.RECAPTCHA_SITE_KEY = 'test-site-key';
    process.env.RECAPTCHA_SECRET_KEY = 'test-secret-key';
    try {
      // Status liefert jetzt den Site-Key
      const st = await api('GET', '/api/auth/registration-status');
      assert.equal(st.data.captchaSiteKey, 'test-site-key');

      // Ohne Token → abgelehnt (kein Google-Call nötig)
      let res = await api('POST', '/api/auth/register', {
        username: 'bob', password: 'supersecret123', password2: 'supersecret123',
        email: 'bob@example.test', acceptedPrivacy: true
      });
      assert.equal(res.status, 400);
      assert.match(res.data.error, /Bot-Schutz/);

      // Google sagt nein → abgelehnt
      captcha._setFetch(async () => ({ json: async () => ({ success: false, 'error-codes': ['invalid-input-response'] }) }));
      res = await api('POST', '/api/auth/register', {
        username: 'bob', password: 'supersecret123', password2: 'supersecret123',
        email: 'bob@example.test', acceptedPrivacy: true, captchaToken: 'bad'
      });
      assert.equal(res.status, 400);

      // Score unter Schwelle → abgelehnt
      captcha._setFetch(async () => ({ json: async () => ({ success: true, score: 0.1, action: 'register' }) }));
      res = await api('POST', '/api/auth/register', {
        username: 'bob', password: 'supersecret123', password2: 'supersecret123',
        email: 'bob@example.test', acceptedPrivacy: true, captchaToken: 'low'
      });
      assert.equal(res.status, 400);

      // Gültig → Registrierung geht durch
      captcha._setFetch(async () => ({ json: async () => ({ success: true, score: 0.9, action: 'register' }) }));
      res = await api('POST', '/api/auth/register', {
        username: 'bob', password: 'supersecret123', password2: 'supersecret123',
        email: 'bob@example.test', acceptedPrivacy: true, captchaToken: 'good'
      });
      assert.equal(res.status, 200);
      assert.equal(res.data.verificationRequired, true);
    } finally {
      delete process.env.RECAPTCHA_SITE_KEY;
      delete process.env.RECAPTCHA_SECRET_KEY;
      captcha._setFetch((...args) => fetch(...args));
    }
  });

  // ── Teardown ──
  await new Promise(resolve => server.close(resolve));
  await new Promise(resolve => getDb().close(resolve));
  for (const suffix of ['', '-wal', '-shm']) {
    const f = testDbPath + suffix;
    if (fs.existsSync(f)) fs.unlinkSync(f);
  }
});
