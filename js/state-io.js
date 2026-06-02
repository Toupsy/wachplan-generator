// ============================================================
// state-io.js – Planstatus-Import / Export (Feature 7) + Server-Sync
// ============================================================

const STATE_VERSION = 3;
const STORAGE_KEY   = 'dlrg_wachplan_autosave';  // Fallback für offline

// Globale Variablen für Server-Sync
let currentPlanId = null;  // Die aktuell bearbeitete Plan-ID
let currentPlanName = 'Wachplan';  // Name des aktuellen Plans

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
    hwBoatId,
    days:                 DAYS,
    positionDescriptions: { ...positionDescriptions },
    fairnessMetricsDisplay: { ...fairnessMetricsDisplay },
    exportColumns:        [...exportColumns],
    people:               people.map(p => ({ ...p })),
    towers:               towers.map(t => ({ ...t, slotCount: t.slotCount || 2 })),
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
  hwBoatId          = s.hwBoatId          ?? null;
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

  people = (s.people || []).map(p => ({ ...p }));
  towers = (s.towers || []).map(t => ({ ...t, slotCount: t.slotCount || 2 }));
  boats  = (s.boats  || []).map(b => ({ ...b, slotCount: b.slotCount || 1 }));

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
  updateSeedDisplay();
  autoCodes();
  renderPeople();
  renderTowerCfg();
  renderBoatCfg();
  renderHWBoatSelector();
  renderPositionDescUI();
  renderExportColumnUI();

  // Plan neu berechnen falls Ergebnis vorhanden war
  if(lastResult) generate();

  if(!silent) showToast('✅ Status importiert – ' + people.length + ' Personen, '
    + towers.length + ' Türme, ' + boats.length + ' Boote');
}

// ── Server-Synchronisation ────────────────────────────

async function autoSave(){
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
        console.error('Failed to create plan:', response.statusText);
        _fallbackSaveToStorage(state);
        return;
      }

      const data = await response.json();
      currentPlanId = data.id;
      console.log('✓ Neuer Plan erstellt, ID:', currentPlanId);
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
      console.error('Failed to save plan:', response.statusText);
      _fallbackSaveToStorage(state);
      return;
    }

    _updateSaveIndicator();
  } catch(error) {
    console.error('autoSave error:', error);
    _fallbackSaveToStorage(state);  // Fallback auf localStorage
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
      console.log('Could not fetch plans, falling back to localStorage');
      return _autoLoadFromStorage();
    }

    const data = await response.json();
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

    const planData = await planResponse.json();
    currentPlanId = planData.id;
    currentPlanName = planData.name;

    // Importiere die dekryptierten Daten
    // Note: planData.state ist bereits ein String (JSON) von der API
    importStateJSON(planData.state, true);  // silent
    generate();
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
    generate();
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
      el.textContent = '💾 ' + currentPlanName + ' (' + ts + ')';
      el.style.display = '';
    } else {
      el.textContent = '💾 Neuer Plan...';
      el.style.display = '';
    }
  } catch(e) { el.style.display = 'none'; }
}
