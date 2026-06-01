// ============================================================
// state-io.js – Planstatus-Import / Export (Feature 7) + Lokale Persistenz
// ============================================================

const STATE_VERSION = 3;
const STORAGE_KEY   = 'dlrg_wachplan_autosave';

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
  try { s = JSON.parse(json); }
  catch(e){ alert('Ungültige JSON-Datei: ' + e.message); return; }

  if(!s.people || !s.towers){
    alert('Die Datei enthält keinen gültigen Wachplan-Status.');
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

// ── Lokale Persistenz (localStorage) ────────────────────────────

function autoSave(){
  try {
    localStorage.setItem(STORAGE_KEY, JSON.stringify(_buildStateObject()));
    _updateSaveIndicator();
  } catch(e) {}
}

function autoLoad(){
  let raw;
  try { raw = localStorage.getItem(STORAGE_KEY); } catch(e) { return false; }
  if(!raw) return false;
  try {
    importStateJSON(raw, true);  // silent – eigene Toast folgt
    generate();
    showToast('♻️ Letzter Stand wiederhergestellt');
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
    const raw = localStorage.getItem(STORAGE_KEY);
    if(raw){
      const s = JSON.parse(raw);
      const ts = s.exportedAt ? new Date(s.exportedAt).toLocaleTimeString('de-DE',{hour:'2-digit',minute:'2-digit'}) : '';
      el.textContent = '💾 Gespeichert ' + ts;
      el.style.display = '';
    } else {
      el.style.display = 'none';
    }
  } catch(e) { el.style.display = 'none'; }
}
