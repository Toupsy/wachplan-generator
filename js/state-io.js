// ============================================================
// state-io.js – Planstatus-Import / Export (Feature 7)
// ============================================================

const STATE_VERSION = 2;

/**
 * Serialisiert den kompletten Anwendungsstatus als JSON-Blob
 * und startet den Browser-Download.
 */
function exportStateJSON(){
  const state = {
    version:              STATE_VERSION,
    exportedAt:           new Date().toISOString(),
    uid,
    randomSeed,
    startDate,
    mainK,
    hwBoatId,
    positionDescriptions: { ...positionDescriptions },
    people:               people.map(p => ({ ...p })),
    towers:               towers.map(t => ({ ...t })),
    boats:                boats.map(b => ({ ...b })),
    // Sets müssen als Arrays gespeichert werden
    dayState: dayState.map(d => ({
      sick:        [...d.sick],
      closed:      [...d.closed],
      closedBoats: [...d.closedBoats],
    })),
    forcedPlacements: forcedPlacements.map(fp => fp.map(f => ({ ...f }))),
  };

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
function importStateJSON(json){
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
  positionDescriptions = Object.assign({ 3:'',4:'',5:'',6:'',7:'' },
                                       s.positionDescriptions || {});

  people = (s.people || []).map(p => ({ ...p }));
  towers = (s.towers || []).map(t => ({ ...t }));
  boats  = (s.boats  || []).map(b => ({ ...b }));

  // uid sicherstellen (max vorhandener ID + 1)
  const allIds = [...people,...towers,...boats].map(x=>x.id).filter(Boolean);
  if(allIds.length) uid = Math.max(uid, ...allIds);

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

  // Plan neu berechnen falls Ergebnis vorhanden war
  if(lastResult) generate();

  showToast('✅ Status importiert – ' + people.length + ' Personen, '
    + towers.length + ' Türme, ' + boats.length + ' Boote');
}
