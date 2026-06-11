// ============================================================
// realtime.js – Live-Update via WebSocket (/ws)
//
// Clients verbinden sich nach Login, senden { type:'join', planId } für den
// aktuell offenen Plan. Bei jedem erfolgreichen PUT /api/plans/:id ruft die
// Plans-API broadcastPlanUpdate(planId, saverUserId) → alle anderen verbundenen
// Mitbearbeiter dieses Plans bekommen { type:'plan-updated' } und laden den
// Plan neu (ohne Seiten-Reload). Auth über die bestehende Express-Session.
// ============================================================

const { WebSocketServer } = require('ws');
const { getPlanAccess } = require('./db/access');
const { parsePositiveInt } = require('./db/ids');

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

    // Session aus dem Cookie laden (Dummy-Res: wir lesen nur, speichern nichts)
    const dummyRes = { getHeader() {}, setHeader() {}, on() {}, once() {}, emit() {}, end() {}, writeHead() {} };
    try {
      sessionMiddleware(req, dummyRes, () => {
        if (!req.session || !req.session.userId) { socket.destroy(); return; }
        wss.handleUpgrade(req, socket, head, (ws) => {
          ws.userId = req.session.userId;
          wss.emit('connection', ws, req);
        });
      });
    } catch (e) { socket.destroy(); }
  });

  wss.on('connection', (ws) => {
    ws.on('message', async (data) => {
      let msg; try { msg = JSON.parse(data.toString()); } catch (e) { return; }
      if (msg.type === 'join' && msg.planId != null) {
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
