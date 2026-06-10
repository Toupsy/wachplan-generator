// ============================================================
// state-io.js – Planstatus-Import / Export (Feature 7) + Server-Sync
// ============================================================

const STATE_VERSION = 6;

// Migriert eine Person vom alten Rollenmodell (role 'E'/'U' + bfLevel) auf das
// neue Modell (role 'F'|'B'|'W' + experienced:bool). Idempotent.
function migratePerson(p){
  let role = p.role, experienced;
  if(role === 'E'){ role = 'W'; experienced = true; }
  else if(role === 'U'){ role = 'W'; experienced = false; }
  else if(role === 'B'){ experienced = (p.experienced !== undefined) ? p.experienced : (p.bfLevel !== 'U'); }
  else if(role === 'F'){ experienced = false; }       // bei Führung irrelevant
  else { role = 'W'; experienced = (p.experienced !== undefined) ? p.experienced : true; }
  const { bfLevel, ...rest } = p;
  return { ...rest, role, experienced };
}
const STORAGE_KEY   = 'dlrg_wachplan_autosave';  // Fallback für offline

// Globale Variablen für Server-Sync
let currentPlanId = null;  // Die aktuell bearbeitete Plan-ID
let currentPlanName = 'Wachplan';  // Name des aktuellen Plans
let currentPlanCanEdit = true;     // false = Nur-Lese (view-Mitbearbeiter) → kein Speichern
let _suppressAutoSave = false;     // true während Laden/Remote-Apply → kein Speicher-Echo

// Debounced Autosave: bei jeder Änderung aufrufen, speichert gebündelt nach kurzer Pause.
let _autoSaveTimer = null;
function scheduleAutoSave(delay = 1200){
  if(currentPlanCanEdit === false || _suppressAutoSave) return;
  if(_autoSaveTimer) clearTimeout(_autoSaveTimer);
  _autoSaveTimer = setTimeout(() => { _autoSaveTimer = null; autoSave(); }, delay);
}

/**
 * Serialisiert den kompletten Anwendungsstatus als JSON-Blob
 * und startet den Browser-Download.
 */
function _buildStateObject(){
  return {
    version:              STATE_VERSION,
    exportedAt:           new Date().toISOString(),
    uid,
    randomSeed,
    startDate,
    mainK,
    fairRotation,
    serviceStartHour,
    serviceEndHour,
    days:                 DAYS,
    positionDescriptions: { ...positionDescriptions },
    fairnessMetricsDisplay: { ...fairnessMetricsDisplay },
    exportColumns:        [...exportColumns],
    people:               people.map(p => {
      const obj = { ...p };
      if(obj.experienced === undefined) obj.experienced = (p.role !== 'F');  // Default erfahren (außer F)
      return obj;
    }),
    towers:               towers.map(t => ({ ...t, slotCount: t.slotCount || 2, leaderCount: t.leaderCount || 0 })),
    boats:                boats.map(b => ({ ...b, slotCount: b.slotCount || 1 })),
    dayState: dayState.map(d => ({
      sick:        [...d.sick],
      closed:      [...d.closed],
      closedBoats: [...d.closedBoats],
    })),
    forcedPlacements: forcedPlacements.map(fp => fp.map(f => ({ ...f }))),
  };
}

function exportStateJSON(){
  const state = _buildStateObject();

  const json = JSON.stringify(state, null, 2);
  const blob = new Blob([json], { type: 'application/json;charset=utf-8' });
  const a    = document.createElement('a');
  a.href     = URL.createObjectURL(blob);
  a.download = `wachplan_status_${(startDate||'entwurf').replace(/-/g,'')}.json`;
  a.click();
  showToast('✅ Status exportiert');
}

/**
 * Liest eine JSON-Datei und stellt den Anwendungsstatus wieder her.
 * Fehlende Felder (ältere Exporte) werden mit Standardwerten gefüllt.
 *
 * @param {string} json  – Inhalt der geladenen JSON-Datei
 */
function importStateJSON(json, silent = false){
  let s;
  try {
    // Handle both string and object (from server or file)
    if (typeof json === 'string') {
      s = JSON.parse(json);
    } else {
      s = json;  // Already an object
    }
  }
  catch(e){
    if(!silent) alert('Ungültige JSON-Datei: ' + e.message);
    else console.error('importStateJSON parse error:', e);
    return;
  }

  if(!s.people || !s.towers){
    if(!silent) alert('Die Datei enthält keinen gültigen Wachplan-Status.');
    else console.error('importStateJSON invalid schema: missing people or towers');
    return;
  }

  uid               = s.uid               ?? 0;
  randomSeed        = s.randomSeed        ?? 0;
  startDate         = s.startDate         ?? '';
  mainK             = s.mainK             ?? 2;
  fairRotation      = s.fairRotation      ?? false;
  serviceStartHour  = s.serviceStartHour  ?? 9;
  serviceEndHour    = s.serviceEndHour    ?? 17;
  DAYS              = s.days              ?? 6;
  positionDescriptions = Object.assign({ 3:'',4:'',5:'',6:'',7:'' },
                                       s.positionDescriptions || {});
  fairnessMetricsDisplay = Object.assign(
    { hwBoatBalance:true, towerDistribution:true, boatPairingDiversity:true },
    s.fairnessMetricsDisplay || {});
  // Checkboxen mit wiederhergestelltem Zustand synchronisieren
  syncMetricCheckboxes();
  exportColumns = Array.isArray(s.exportColumns) ? [...s.exportColumns] : [];
  // Tageanzahl-Input synchronisieren
  const daysInput = document.getElementById('num-days');
  if(daysInput) daysInput.value = DAYS;

  people = (s.people || []).map(p => ({
    ...migratePerson(p),   // altes Rollenmodell (E/U + bfLevel) → role 'W' + experienced
    labels: p.labels || '',
    enableLabels: p.enableLabels !== undefined ? p.enableLabels : ((p.labels||'').trim().length > 0)  // Fallback für alte Exporte
  }));
  towers = (s.towers || []).map(t => ({ ...t, slotCount: t.slotCount || 2, leaderCount: t.leaderCount || 0 }));
  boats  = (s.boats  || []).map(b => ({ ...b, slotCount: b.slotCount || 1 }));

  // Migration v5→v6: hwBoatId → Boote mit towerId='HW' einheitlich behandeln
  if(s.version < 6 && s.hwBoatId){
    const hwBoot = boats.find(b => b.id === s.hwBoatId);
    if(hwBoot && hwBoot.towerId !== 'HW'){
      hwBoot.towerId = 'HW';
    }
  }

  // uid sicherstellen (max vorhandener ID + 1)
  let maxId = uid;
  [...people,...towers,...boats].forEach(x => { if(x.id > maxId) maxId = x.id; });
  uid = maxId;

  // dayState mit Sets rekonstruieren
  dayState = (s.dayState || []).map(d => ({
    sick:        new Set(d.sick        || []),
    closed:      new Set(d.closed      || []),
    closedBoats: new Set(d.closedBoats || []),
  }));
  // Fehlende Tage auffüllen
  while(dayState.length < DAYS) dayState.push({ sick:new Set(), closed:new Set(), closedBoats:new Set() });

  // forcedPlacements
  forcedPlacements = (s.forcedPlacements || []).map(fp => (fp || []).map(f => ({ ...f })));
  while(forcedPlacements.length < DAYS) forcedPlacements.push([]);

  // UI neu aufbauen
  document.getElementById('start-date').value = startDate;
  document.getElementById('main-k').value     = mainK;
  const fairCb = document.getElementById('fair-rotation');
  if(fairCb) fairCb.checked = fairRotation;
  document.getElementById('service-start-hour').value = serviceStartHour;
  document.getElementById('service-end-hour').value   = serviceEndHour;
  updateSeedDisplay();
  autoCodes();
  renderPeople();
  renderTowerCfg();
  renderBoatCfg();
  renderPositionDescUI();
  renderExportColumnUI();

  // Plan neu berechnen falls Ergebnis vorhanden war
  if(lastResult) runGenerate();

  if(!silent) showToast('✅ Status importiert – ' + people.length + ' Personen, '
    + towers.length + ' Türme, ' + boats.length + ' Boote');
}

// ── Server-Synchronisation ────────────────────────────

let _saving = false, _saveQueued = false;
async function autoSave(){
  if(currentPlanCanEdit === false || _suppressAutoSave) return; // Nur-Lese / Remote-Apply: nicht speichern
  if(_saving){ _saveQueued = true; return; } // Läuft schon → einen Nachlauf einplanen
  _saving = true;
  const state = _buildStateObject();

  try {
    // Wenn noch keine Plan-ID vorhanden, erstelle einen neuen Plan
    if(!currentPlanId){
      const response = await fetch('/api/plans', {
        method: 'POST',
        headers: { 'Content-Type': 'application/json' },
        credentials: 'include',
        body: JSON.stringify({ name: currentPlanName, state })
      });

      if(!response.ok){
        if (response.status === 503) {
          console.log('⚠️ API unavailable (preview mode) – saving to localStorage');
        } else {
          console.error('Failed to create plan:', response.statusText);
        }
        _fallbackSaveToStorage(state);
        return;
      }

      const data = await response.json();
      currentPlanId = data.id;
      console.log('✓ Neuer Plan erstellt, ID:', currentPlanId);
      if(typeof realtimeJoin === 'function') realtimeJoin(currentPlanId);  // Live-Update beitreten
      _updateSaveIndicator();
      return;
    }

    // Plan existiert bereits, aktualisiere ihn
    const response = await fetch(`/api/plans/${currentPlanId}`, {
      method: 'PUT',
      headers: { 'Content-Type': 'application/json' },
      credentials: 'include',
      body: JSON.stringify({ state, name: currentPlanName })
    });

    if(!response.ok){
      if (response.status === 503) {
        console.log('⚠️ API unavailable (preview mode) – saving to localStorage');
      } else {
        console.error('Failed to save plan:', response.statusText);
      }
      _fallbackSaveToStorage(state);
      return;
    }

    _updateSaveIndicator();
  } catch(error) {
    console.error('autoSave error:', error);
    _fallbackSaveToStorage(state);  // Fallback auf localStorage
  } finally {
    _saving = false;
    if(_saveQueued){ _saveQueued = false; scheduleAutoSave(50); }  // zwischenzeitliche Änderung nachspeichern
  }
}

// Fallback: Speichere auf localStorage wenn Server nicht erreichbar
function _fallbackSaveToStorage(state){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(state));
    console.log('⚠️ Offline-Modus: Plan lokal gespeichert');
  } catch(e) {}
}

async function autoLoad(){
  try {
    // Hole Liste aller Pläne des Users
    const response = await fetch('/api/plans', { credentials: 'include' });
    if(!response.ok) {
      if (response.status === 503) {
        console.log('⚠️ API not available (preview mode) – using offline localStorage');
      } else {
        console.log('Could not fetch plans, falling back to localStorage');
      }
      return _autoLoadFromStorage();
    }

    let data;
    try {
      data = await response.json();
    } catch (parseError) {
      console.error('Failed to parse plans list response JSON:', parseError);
      return _autoLoadFromStorage();
    }

    const plans = data.plans || [];

    if(plans.length === 0) {
      console.log('Keine Pläne gefunden');
      return false;
    }

    // Lade den letzten bearbeiteten Plan
    const lastPlan = plans[0];
    const planResponse = await fetch(`/api/plans/${lastPlan.id}`, { credentials: 'include' });
    if(!planResponse.ok) {
      console.error('Failed to load plan:', planResponse.statusText);
      return false;
    }

    let planData;
    try {
      planData = await planResponse.json();
    } catch (parseError) {
      console.error('Failed to parse plan response JSON:', parseError);
      return false;
    }

    if (!planData.id || !planData.state) {
      console.error('Invalid plan data structure:', planData);
      return false;
    }

    currentPlanId = planData.id;
    currentPlanName = planData.name;
    currentPlanCanEdit = planData.canEdit !== false;  // view-Mitbearbeiter: nur lesen
    if(typeof realtimeJoin === 'function') realtimeJoin(currentPlanId);  // Live-Update beitreten

    // Importiere die dekryptierten Daten
    // Note: planData.state ist bereits ein String (JSON) von der API
    importStateJSON(planData.state, true);  // silent
    runGenerate();
    showToast('♻️ Plan „' + currentPlanName + '" wiederhergestellt');
    return true;

  } catch(error) {
    console.error('autoLoad error:', error);
    return _autoLoadFromStorage();
  }
}

// Fallback: Lade aus localStorage wenn Server nicht verfügbar
function _autoLoadFromStorage(){
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch(e) { return false; }
  if(!raw) return false;
  try {
    importStateJSON(raw, true);
    runGenerate();
    showToast('⚠️ Offline-Modus: Letzter Stand wiederhergestellt');
    return true;
  } catch(e) {
    try { localStorage.removeItem(STORAGE_KEY); } catch(_) {}
    return false;
  }
}

function clearLocalSave(){
  try { localStorage.removeItem(STORAGE_KEY); } catch(e) {}
  _updateSaveIndicator();
  showToast('🗑️ Lokaler Speicherstand gelöscht');
}

function _updateSaveIndicator(){
  const el = document.getElementById('autosave-indicator');
  if(!el) return;
  try {
    if(currentPlanId){
      const ts = new Date().toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'});
      el.textContent = (currentPlanCanEdit ? '💾 ' : '👁 ') + currentPlanName + ' (' + ts + ')';
      el.style.display = '';
    } else {
      el.textContent = '💾 Neuer Plan...';
      el.style.display = '';
    }
  } catch(e) { el.style.display = 'none'; }
}

// ── Mehrere benannte Pläne: Verwaltung ───────────────────────

/** Liste aller Pläne (eigene + geteilte). */
async function fetchPlansList(){
  const res = await fetch('/api/plans', { credentials:'include' });
  if(!res.ok) return [];
  const data = await res.json().catch(()=>({}));
  return data.plans || [];
}

/** UI komplett aus aktuellem State neu aufbauen (nach Import/Load/New). */
function _rebuildAllUI(){
  const sd = document.getElementById('start-date'); if(sd) sd.value = startDate || '';
  const mk = document.getElementById('main-k');     if(mk) mk.value = mainK;
  const fr = document.getElementById('fair-rotation'); if(fr) fr.checked = fairRotation;
  if(typeof updateSeedDisplay === 'function') updateSeedDisplay();
  autoCodes();
  renderPeople(); renderTowerCfg(); renderBoatCfg();
  renderPositionDescUI(); renderExportColumnUI();
}

/** Einen bestimmten Plan laden (ohne Speicher-Echo). */
async function loadPlanById(id){
  try {
    const res = await fetch(`/api/plans/${id}`, { credentials:'include' });
    if(!res.ok){ showToast('Plan konnte nicht geladen werden', true); return false; }
    const data = await res.json().catch(()=>({}));
    if(!data.state){ showToast('Plan ist leer/ungültig', true); return false; }
    currentPlanId = data.id;
    currentPlanName = data.name;
    currentPlanCanEdit = data.canEdit !== false;
    _suppressAutoSave = true;
    try { importStateJSON(data.state, true); runGenerate(); }
    finally { _suppressAutoSave = false; }
    if(typeof realtimeJoin === 'function') realtimeJoin(currentPlanId);
    _updateSaveIndicator();
    showToast('📂 „' + currentPlanName + '" geladen' + (currentPlanCanEdit ? '' : ' (nur Ansicht)'));
    return true;
  } catch(e){ console.error('loadPlanById', e); return false; }
}

/** Neuen, leeren Plan aus der Config-Vorlage erstellen (wird beim ersten Speichern angelegt). */
function createNewPlan(name){
  resetGlobalState();               // Reset all state to defaults (towers, boats, DAYS, etc.)
  currentPlanName = (name||'').trim() || 'Wachplan';
  currentPlanCanEdit = true;
  if(typeof seedFromConfig === 'function') seedFromConfig();
  _rebuildAllUI();
  runGenerate();                       // ruft autoSave → POST → setzt currentPlanId + realtimeJoin
  _updateSaveIndicator();
  showToast('➕ Neuer Plan „' + currentPlanName + '"');
}

/** Aktuellen Plan umbenennen (wird per Autosave/PUT gespeichert). */
function renameCurrentPlan(name){
  const n = (name||'').trim();
  if(!n) return;
  currentPlanName = n;
  _updateSaveIndicator();
  scheduleAutoSave(200);
}

/** Plan löschen. Wenn es der aktuelle ist → auf einen anderen wechseln oder neuen anlegen. */
async function deletePlanById(id){
  try {
    const res = await fetch(`/api/plans/${id}`, { method:'DELETE', credentials:'include' });
    if(!res.ok){ const d=await res.json().catch(()=>({})); showToast(d.error||'Löschen fehlgeschlagen', true); return false; }
    showToast('🗑️ Plan gelöscht');
    if(id === currentPlanId){
      const rest = (await fetchPlansList()).filter(p => p.isOwner);
      if(rest.length){ await loadPlanById(rest[0].id); }
      else { createNewPlan('Wachplan'); }
    }
    return true;
  } catch(e){ console.error('deletePlanById', e); return false; }
}

/** Von realtime.js bei { type:'plan-updated' } aufgerufen: aktuellen Plan neu laden, ohne Echo. */
async function applyRemotePlanState(){
  if(currentPlanId == null) return;
  try {
    const res = await fetch(`/api/plans/${currentPlanId}`, { credentials:'include' });
    if(!res.ok) return;
    const data = await res.json().catch(()=>({}));
    if(!data.state) return;
    _suppressAutoSave = true;
    try {
      currentPlanCanEdit = data.canEdit !== false;
      currentPlanName = data.name;
      importStateJSON(data.state, true);
      runGenerate();
    } finally { _suppressAutoSave = false; }
    _updateSaveIndicator();
    showToast('🔄 Aktualisiert von Mitbearbeiter');
  } catch(e){ console.error('applyRemotePlanState', e); }
}
