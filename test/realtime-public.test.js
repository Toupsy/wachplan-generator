/**
 * test/realtime-public.test.js
 *
 * Feature 49: Live-Updates für öffentliche Beobachter-Links (?view=TOKEN).
 * Verifiziert end-to-end, dass ein anonymer WebSocket-Client per
 * { type:'join-public', token } dem Plan-Raum beitritt und broadcastPlanUpdate()
 * ihn erreicht – auch wenn der Socket ein Session-Cookie des Speichernden trägt
 * (gleicher Browser) – und dass ungültige Tokens bzw. anonyme `join` scheitern.
 */

const { test, before, after } = require('node:test');
const assert = require('node:assert/strict');
const path = require('path');
const fs = require('fs');
const http = require('http');
const crypto = require('crypto');

const tmpDb = path.join(__dirname, '..', 'data', `test-realtime-public-${Date.now()}.db`);
process.env.DATABASE_PATH = tmpDb;
process.env.SESSION_DB_PATH = tmpDb.replace(/\.db$/, '-sessions.db');
process.env.MASTER_SECRET = 'x'.repeat(32);
process.env.SALT = 'y'.repeat(16);
process.env.SESSION_SECRET = 'z'.repeat(16);

const express = require('express');
const { initDatabase } = require('../server/db/init');
const { dbRun, getDb } = require('../server/db/connection');
const { setupRealtime, broadcastPlanUpdate } = require('../server/realtime');
const { createSessionMiddleware } = require('../server/db/session');
const { encryptPlanState } = require('../server/db/crypto');
const WebSocket = require('ws');

const hashLinkToken = t => crypto.createHash('sha256').update(t).digest('hex');

let server, sessionMw, port, planId, token;

before(async () => {
  await initDatabase();
  await dbRun("INSERT INTO users (id, username, password_hash) VALUES (1,'ed','h')");
  const { encrypted, iv, authTag } = encryptPlanState(JSON.stringify({ hello: 'world' }), 1);
  const r = await dbRun(
    "INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag) VALUES (1,'P',?,?,?)",
    [encrypted, iv, authTag]
  );
  planId = r.lastID;
  token = crypto.randomBytes(32).toString('hex');
  await dbRun(
    "INSERT INTO plan_public_links (plan_id, token_hash, created_by, expires_at) VALUES (?,?,?,?)",
    [planId, hashLinkToken(token), 1, Date.now() + 3600_000]
  );

  // EINE Middleware-Instanz für Login-Mint UND WS-Upgrade (gleicher Store/Secret).
  sessionMw = createSessionMiddleware();
  const app = express();
  app.use(sessionMw);
  app.get('/mint', (req, res) => { req.session.userId = 1; res.json({ ok: true }); });

  server = http.createServer(app);
  setupRealtime(server, sessionMw);
  await new Promise(res => server.listen(0, res));
  port = server.address().port;
});

after(async () => {
  try { server.close(); } catch {}
  if (sessionMw && sessionMw.closeStore) await sessionMw.closeStore();
  await new Promise(res => getDb().close(res));
  for (const f of [tmpDb, process.env.SESSION_DB_PATH]) { try { fs.unlinkSync(f); } catch {} }
});

function connect(headers) {
  const ws = new WebSocket(`ws://127.0.0.1:${port}/ws`, headers ? { headers } : undefined);
  return new Promise((resolve, reject) => {
    ws.on('open', () => resolve(ws));
    ws.on('error', reject);
  });
}

function nextMessage(ws, timeoutMs = 500) {
  return new Promise((resolve) => {
    const t = setTimeout(() => resolve(null), timeoutMs);
    ws.once('message', (d) => { clearTimeout(t); resolve(JSON.parse(d.toString())); });
  });
}

// Loggt ein und liefert den Session-Cookie zurück (für den „gleicher Browser"-Fall).
function mintSessionCookie() {
  return new Promise((resolve, reject) => {
    http.get({ port, path: '/mint' }, (res) => {
      const cookies = res.headers['set-cookie'] || [];
      res.resume();
      const c = cookies.map(s => s.split(';')[0]).join('; ');
      c ? resolve(c) : reject(new Error('no cookie'));
    }).on('error', reject);
  });
}

test('anonymer Beobachter tritt per gültigem Token bei und erhält plan-updated', async () => {
  const ws = await connect();
  ws.send(JSON.stringify({ type: 'join-public', token }));
  assert.deepEqual(await nextMessage(ws), { type: 'joined-public' });

  broadcastPlanUpdate(planId, 1); // Bearbeiter (user 1) speichert
  assert.deepEqual(await nextMessage(ws), { type: 'plan-updated', planId });
  ws.close();
});

test('Beobachter erhält Updates auch mit Saver-Session-Cookie (gleicher Browser)', async () => {
  // Eigentümer öffnet den ?view-Link im selben Browser → der WS-Upgrade liest den
  // Cookie, ws.userId=1. join-public muss ihn trotzdem dauerhaft versorgen, obwohl
  // er als Saver (exceptUserId=1) speichert.
  const cookie = await mintSessionCookie();
  const ws = await connect({ Cookie: cookie });
  ws.send(JSON.stringify({ type: 'join-public', token }));
  assert.deepEqual(await nextMessage(ws), { type: 'joined-public' });

  broadcastPlanUpdate(planId, 1); // Eigentümer speichert
  assert.deepEqual(await nextMessage(ws), { type: 'plan-updated', planId },
    'Beobachter darf trotz Saver-Cookie nicht als Speichernder ausgeschlossen werden');
  ws.close();
});

test('ungültiges/abgelaufenes Token wird abgewiesen (kein join, kein Broadcast)', async () => {
  const ws = await connect();
  ws.send(JSON.stringify({ type: 'join-public', token: 'f'.repeat(64) }));
  assert.equal(await nextMessage(ws), null, 'kein joined-public');

  broadcastPlanUpdate(planId, 1);
  assert.equal(await nextMessage(ws), null, 'nicht im Raum → kein plan-updated');
  ws.close();
});

test('anonymer Socket darf NICHT regulär (join) einem Raum beitreten', async () => {
  const ws = await connect();
  ws.send(JSON.stringify({ type: 'join', planId }));
  assert.equal(await nextMessage(ws), null, 'kein joined ohne Session');

  broadcastPlanUpdate(planId, 1);
  assert.equal(await nextMessage(ws), null, 'nicht im Raum → kein plan-updated');
  ws.close();
});
