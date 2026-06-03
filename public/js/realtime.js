// ============================================================
// realtime.js – Live-Update-Client (WebSocket /ws)
//
// Verbindet sich nach Login, tritt dem Raum des aktuell offenen Plans bei
// (realtimeJoin) und lädt den Plan neu, wenn ein Mitbearbeiter speichert
// ({ type:'plan-updated' }) – ohne Seiten-Reload. Auto-Reconnect bei Abbruch.
// ============================================================

let _ws = null;
let _wsReconnectTimer = null;
let _joinedPlanId = null;

function realtimeConnect(){
  if(_ws && (_ws.readyState === WebSocket.OPEN || _ws.readyState === WebSocket.CONNECTING)) return;
  const proto = location.protocol === 'https:' ? 'wss:' : 'ws:';
  try { _ws = new WebSocket(`${proto}//${location.host}/ws`); }
  catch(e){ _scheduleReconnect(); return; }

  _ws.onopen = () => {
    // Aktuell offenen Plan (sofern vorhanden) beitreten
    if(typeof currentPlanId !== 'undefined' && currentPlanId != null) realtimeJoin(currentPlanId);
  };
  _ws.onmessage = (ev) => {
    let msg; try { msg = JSON.parse(ev.data); } catch(e){ return; }
    if(msg.type === 'plan-updated' && msg.planId === currentPlanId){
      if(typeof applyRemotePlanState === 'function') applyRemotePlanState();
    }
  };
  _ws.onclose = () => { _ws = null; _joinedPlanId = null; _scheduleReconnect(); };
  _ws.onerror = () => { try { _ws.close(); } catch(e){} };
}

function _scheduleReconnect(){
  if(_wsReconnectTimer) return;
  _wsReconnectTimer = setTimeout(() => { _wsReconnectTimer = null; realtimeConnect(); }, 3000);
}

/** Dem Live-Update-Raum eines Plans beitreten (bei Laden/Wechsel/Erstellen aufgerufen). */
function realtimeJoin(planId){
  if(planId == null) return;
  _joinedPlanId = planId;
  if(_ws && _ws.readyState === WebSocket.OPEN){
    _ws.send(JSON.stringify({ type:'join', planId }));
  } else {
    realtimeConnect();   // verbindet und tritt in onopen bei
  }
}

document.addEventListener('DOMContentLoaded', () => {
  // Erst nach erfolgreicher Auth sinnvoll – initAfterAuth ruft realtimeConnect()
  // zusätzlich auf. Hier nur ein früher Versuch (schlägt ohne Session still fehl).
  realtimeConnect();
});
