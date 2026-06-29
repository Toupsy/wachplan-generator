// ============================================================
// realtime.js – Live-Update via WebSocket (/ws)
//
// Clients verbinden sich nach Login, senden { type:'join', planId } für den
// aktuell offenen Plan. Bei jedem erfolgreichen PUT /api/plans/:id ruft die
// Plans-API broadcastPlanUpdate(planId, saverUserId) → alle anderen verbundenen
// Mitbearbeiter dieses Plans bekommen { type:'plan-updated' } und laden den
// Plan neu (ohne Seiten-Reload). Auth über die bestehende Express-Session.
//
// Öffentliche Beobachter (Feature 38, ?view=TOKEN) verbinden sich OHNE Session
// (anonym) und treten via { type:'join-public', token } dem Raum ihres Plans
// bei – Auth allein über das unguessbare Token (gleiche Prüfung wie
// /api/public/plan/:token). So bekommen auch Nur-Lese-Links Live-Updates.
// ============================================================

const crypto = require('crypto');
const { WebSocketServer } = require('ws');
const { getPlanAccess } = require('./db/access');
const { parsePositiveInt } = require('./db/ids');
const { dbGet } = require('./db/connection');

// Beobachter-Token: 256-Bit-Zufall → 64 Hex-Zeichen. In der DB liegt nur der
// SHA-256-Hash (Spiegelung von api/public.js / api/plans.js – bewusst inline,
// um den Require-Zyklus realtime.js ↔ api/plans.js zu vermeiden).
const PUBLIC_TOKEN_RE = /^[0-9a-f]{64}$/;
const hashLinkToken = t => crypto.createHash('sha256').update(t).digest('hex');

// Token → plan_id, oder null wenn ungültig/abgelaufen/zurückgezogen.
async function resolvePublicToken(token) {
  if (typeof token !== 'string' || !PUBLIC_TOKEN_RE.test(token)) return null;
  const link = await dbGet(
    `SELECT plan_id, expires_at FROM plan_public_links
      WHERE token_hash = ? AND revoked_at IS NULL`,
    [hashLinkToken(token)]
  );
  if (!link || link.expires_at <= Date.now()) return null;
  return link.plan_id;
}

const rooms = new Map(); // planId(String) → Set<ws>

function leaveRoom(ws) {
  const key = ws._planRoom;
  if (!key) return;
  const set = rooms.get(key);
  if (set) { set.delete(ws); if (set.size === 0) rooms.delete(key); }
  ws._planRoom = null;
}

function joinRoom(planId, ws) {
  leaveRoom(ws);
  const key = String(planId);
  let set = rooms.get(key);
  if (!set) { set = new Set(); rooms.set(key, set); }
  set.add(ws);
  ws._planRoom = key;
}

// Von api/plans.js nach erfolgreichem Speichern aufgerufen.
function broadcastPlanUpdate(planId, exceptUserId) {
  const set = rooms.get(String(planId));
  if (!set) return;
  const msg = JSON.stringify({ type: 'plan-updated', planId: Number(planId) });
  for (const ws of set) {
    if (ws.userId === exceptUserId) continue;            // den Speichernden nicht benachrichtigen
    if (ws.readyState === ws.OPEN) ws.send(msg);
  }
}

function setupRealtime(server, sessionMiddleware) {
  const wss = new WebSocketServer({ noServer: true });

  server.on('upgrade', (req, socket, head) => {
    const path = (req.url || '').split('?')[0];
    if (!path.endsWith('/ws')) { socket.destroy(); return; }

    // Session aus dem Cookie laden (Dummy-Res: wir lesen nur, speichern nichts).
    // Anonyme Verbindungen (kein Login) sind erlaubt – sie können ausschließlich
    // einem öffentlichen Beobachter-Raum via { type:'join-public', token } beitreten
    // (Auth über das Token). Das reguläre { type:'join', planId } verlangt eine
    // Session (ws.userId), da getPlanAccess(planId, null) → false liefert.
    const dummyRes = { getHeader() {}, setHeader() {}, on() {}, once() {}, emit() {}, end() {}, writeHead() {} };
    try {
      sessionMiddleware(req, dummyRes, () => {
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.userId = (req.session && req.session.userId) || null;
          wss.emit('connection', ws, req);
        });
      });
    } catch (e) { socket.destroy(); }
  });

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg.type === 'join' && msg.planId != null) {
        if (!ws.userId) return;                          // anonyme Sockets dürfen nur join-public
        const planId = parsePositiveInt(msg.planId);
        if (!planId) return;                             // ungültige ID → ignorieren
        try {
          const access = await getPlanAccess(planId, ws.userId);
          if (access) {                                  // nur bei Zugriff (Owner/Mitbearbeiter)
            joinRoom(planId, ws);
            // readyState prüfen: Socket kann zwischen Access-Check und send schließen.
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'joined', planId }));
            }
          }
        } catch (e) {
          console.error('WebSocket join error:', e);     // nicht stumm verschlucken
        }
      } else if (msg.type === 'join-public' && msg.token != null) {
        // Beobachter-Link: Auth allein über das Token (kein Login nötig).
        try {
          const planId = await resolvePublicToken(msg.token);
          if (planId) {
            // Als Beobachter beitreten → IMMER Updates erhalten. ws.userId leeren,
            // falls der Socket ein Session-Cookie mitführte (z.B. der eingeloggte
            // Eigentümer öffnet den Link im selben Browser): sonst gälte er beim
            // Speichern als „der Speichernde" (exceptUserId) und würde übersprungen.
            ws.userId = null;
            joinRoom(planId, ws);
            if (ws.readyState === ws.OPEN) {
              ws.send(JSON.stringify({ type: 'joined-public' }));
            }
          }
        } catch (e) {
          console.error('WebSocket join-public error:', e);
        }
      } else if (msg.type === 'leave') {
        leaveRoom(ws);
      }
    });
    ws.on('close', () => leaveRoom(ws));
    ws.on('error', () => leaveRoom(ws));
  });

  console.log('✓ Realtime (WebSocket /ws) aktiv');
  return wss;
}

module.exports = { setupRealtime, broadcastPlanUpdate };
