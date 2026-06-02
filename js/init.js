// ============================================================
// init.js – Event-Listener und Startsequenz
// ============================================================

/** Checkbox-Zustände aus fairnessMetricsDisplay übernehmen (nach State-Import).
 * Muss VOR DOMContentLoaded definiert sein, da es von importStateJSON aufgerufen wird! */
function syncMetricCheckboxes(){
  const METRICS_MAP = {
    'metric-hw-balance':  'hwBoatBalance',
    'metric-tower-dist':  'towerDistribution',
    'metric-boat-pairing':'boatPairingDiversity'
  };
  Object.entries(METRICS_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if(el) el.checked = !!fairnessMetricsDisplay[key];
  });
}

// ── Startsequenz (nach Authentifizierung) ─────────────────────────
// Muss VOR DOMContentLoaded definiert sein, damit es global sichtbar ist!
async function initAfterAuth() {
  const _restored = await autoLoad();   // gespeicherten Stand wiederherstellen (async!)
  if(!_restored){
    // Kein Speicherstand → Template von Konfiguration laden
    if (typeof seedFromConfig === 'function') {
      await seedFromConfig();
    } else {
      seed();  // Fallback zu altem seed() wenn config nicht verfügbar
    }
    forcedPlacements = freshForcedPlacements();
    dayState = freshDayState();

    document.getElementById('start-date').value = startDate;
    updateSeedDisplay();
    renderPeople();
    renderTowerCfg();
    renderBoatCfg();
    renderHWBoatSelector();
    renderPositionDescUI();
    autoFillExportColumns();   // Standardmäßig aus Türmen & Booten befüllen

    // Neu erstellten Plan sofort speichern
    await autoSave();
  }
  _updateSaveIndicator();
}

document.addEventListener('DOMContentLoaded', () => {

// ── Sidebar – Wachgänger ─────────────────────────────────────────
const addPersonBtn = document.getElementById('add-person');
if(addPersonBtn) addPersonBtn.onclick = () => {
  people.push({ id:++uid, name:'', role:'E' });
  renderPeople();
};
document.querySelectorAll('.quick-add button').forEach(b =>
  b.onclick = () => { people.push({ id:++uid, name:'', role:b.dataset.role }); renderPeople(); });

// ── Sidebar – Türme & Boote ──────────────────────────────────────
const addTowerBtn = document.getElementById('add-tower');
if(addTowerBtn) addTowerBtn.onclick = () => {
  const minP = towers.length ? Math.min(...towers.map(t=>t.prio)) : 1;
  towers.push({ id:++uid, name:`Turm ${towers.length+1}`, prio:Math.max(1,minP), code:'' });
  renderTowerCfg(); renderBoatCfg(); renderPositionDescUI(); renderHWBoatSelector();
};
const addBoatBtn = document.getElementById('add-boat');
if(addBoatBtn) addBoatBtn.onclick = () => {
  const minP = boats.length ? Math.min(...boats.map(b=>b.prio)) : (towers[0]?.prio||1);
  boats.push({ id:++uid, name:`Boot ${boats.length+1}`, code:'', towerId:towers[0]?.id||null, prio:minP });
  renderBoatCfg(); renderHWBoatSelector();
};

// ── Sidebar – Hauptwache ─────────────────────────────────────────
const mainKInput = document.getElementById('main-k');
if(mainKInput) mainKInput.oninput = e => {
  mainK = Math.max(0, +e.target.value||0);
};

// ── Sidebar – Datum & Generierung ────────────────────────────────
const startDateInput = document.getElementById('start-date');
if(startDateInput) startDateInput.onchange = e => { startDate = e.target.value; };
const generateBtn = document.getElementById('generate');
if(generateBtn) generateBtn.onclick = async () => {
  const seedVal = +document.getElementById('seed-input').value || 0;
  if(seedVal > 0) applySeedConstraints(seedVal);
  generate();
  await autoSave();
};

/** Generiere verschiedene Startkonstellationen basierend auf Seed.
 * Seed > 0 erzeugt forcierte Zuweisungen für Day 1, ab Tag 2 läuft normal.
 * Nutzt Fisher-Yates Shuffle mit Seed für deterministische Permutation.
 */
function applySeedConstraints(seed){
  // Verfügbare Slots Day 1
  const avail = { towers: [], boats: [], main: 0 };
  towers.filter(t => !dayState[0].closed.has(t.id)).slice(0, 3).forEach(t => {
    avail.towers.push(...Array(t.slotCount||2).fill(t.id));
  });
  boats.filter(b => !dayState[0].closedBoats.has(b.id)).slice(0, 2).forEach(b => {
    avail.boats.push(b.id);
  });
  avail.main = mainK + 2;

  // Seeded shuffle helper (LCG-basiert wie seededRand)
  const seedShuffle = (arr, seedVal) => {
    const result = arr.slice();
    let rng = seedVal;
    for(let i = result.length - 1; i > 0; i--){
      rng = (rng * 1664525 + 1013904223) & 0x7fffffff;
      const j = rng % (i + 1);
      [result[i], result[j]] = [result[j], result[i]];
    }
    return result;
  };

  forcedPlacements[0] = [];

  // Shuffelte E/U Personen, dann verteile auf Türme
  const eu = people.filter(p => p.role === 'E' || p.role === 'U');
  const shuffledEU = seedShuffle(eu, seed).slice(0, avail.towers.length);
  shuffledEU.forEach((p, i) => {
    forcedPlacements[0].push({
      personId: p.id,
      kind: 'tower',
      slotId: avail.towers[i],
      transparent: false
    });
  });

  // Shuffelte Bootsführer, dann verteile auf Boote
  const bs = people.filter(p => p.role === 'B');
  const shuffledBF = seedShuffle(bs, seed * 2).slice(0, avail.boats.length);
  shuffledBF.forEach((p, i) => {
    forcedPlacements[0].push({
      personId: p.id,
      kind: 'boat',
      slotId: avail.boats[i],
      transparent: false
    });
  });

  // Rest zur Hauptwache
  const usedIds = new Set([...shuffledEU, ...shuffledBF].map(p => p.id));
  const remaining = people.filter(p => !usedIds.has(p.id)).slice(0, Math.max(1, avail.main - 2));
  remaining.forEach(p => {
    forcedPlacements[0].push({
      personId: p.id,
      kind: 'main',
      slotId: 0,
      transparent: false
    });
  });

  showToast(`🎲 Seed ${seed}: ${forcedPlacements[0].length} Personen fixiert für Tag 1`);
};


// ── Sidebar – Tageanzahl ─────────────────────────────────────────
const numDaysInput = document.getElementById('num-days');
if(numDaysInput) numDaysInput.oninput = e => {
  const v = Math.min(14, Math.max(1, +e.target.value || 6));
  if(v === DAYS) return;
  DAYS = v;
  // dayState und forcedPlacements anpassen
  while(dayState.length < DAYS)        dayState.push({ sick:new Set(), closed:new Set(), closedBoats:new Set() });
  while(forcedPlacements.length < DAYS) forcedPlacements.push([]);
  dayState.length        = DAYS;
  forcedPlacements.length = DAYS;
  if(activeDay >= DAYS) activeDay = 0;
  if(lastResult) generate();
};

// ── Move-Modal ────────────────────────────────────────────────────
const moveModalCloseBtn = document.getElementById('move-modal-close-btn');
if(moveModalCloseBtn) moveModalCloseBtn.onclick = closeMoveModal;
const moveModal = document.getElementById('move-modal');
if(moveModal) moveModal.addEventListener('click', e => {
  if(e.target === e.currentTarget) closeMoveModal();  // Klick außerhalb schließt Modal
});

// ── XLSX-Stationsspalten ──────────────────────────────────────────
const autoExportColsBtn = document.getElementById('btn-auto-export-cols');
if(autoExportColsBtn) autoExportColsBtn.onclick = () => {
  autoFillExportColumns();
  showToast('✅ Stationsspalten automatisch befüllt');
};

// ── Fairness-Metriken Anzeige ─────────────────────────────────────
const METRICS_MAP = {
  'metric-hw-balance':  'hwBoatBalance',
  'metric-tower-dist':  'towerDistribution',
  'metric-boat-pairing':'boatPairingDiversity'
};
Object.entries(METRICS_MAP).forEach(([id, key]) => {
  const el = document.getElementById(id);
  if(el) el.onchange = e => {
    fairnessMetricsDisplay[key] = e.target.checked;
    if(lastResult) renderOutput();
  };
});

// ── Import / Export Planstatus ────────────────────────────────────
const exportStateBtn = document.getElementById('btn-export-state');
if(exportStateBtn) exportStateBtn.onclick = exportStateJSON;

const importStateBtn = document.getElementById('btn-import-state');
if(importStateBtn) importStateBtn.onclick = () => {
  const importFileInput = document.getElementById('import-file-input');
  if(importFileInput) importFileInput.click();
};
const importFileInput = document.getElementById('import-file-input');
if(importFileInput) importFileInput.onchange = e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => importStateJSON(ev.target.result);
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
};
const clearSaveBtn = document.getElementById('btn-clear-save');
if(clearSaveBtn) clearSaveBtn.onclick = clearLocalSave;

// ── Login-Modal starten (nach init.js geladen) ─────────────────
// initAfterAuth() wird NUR von login-modal.js aufgerufen, NACH erfolgreichem Login!
if (document.readyState === 'loading') {
  document.addEventListener('DOMContentLoaded', initLoginModal);
} else {
  initLoginModal();
}

}); // Ende DOMContentLoaded
