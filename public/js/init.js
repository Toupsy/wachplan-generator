// ============================================================
// init.js – Event-Listener und Startsequenz
// ============================================================

// Metric/Chart ID → State-Key Mappings (used in syncMetricCheckboxes + DOMContentLoaded)
const METRICS_MAP = {
  'metric-hw-balance':  'hwBoatBalance',
  'metric-tower-dist':  'towerDistribution',
  'metric-boat-pairing':'boatPairingDiversity'
};

const CHARTS_MAP = {
  'chart-assignments':  'assignmentsPerPerson',
  'chart-hw-days':      'hwDaysPerPerson',
  'chart-tower-util':   'towerUtilization'
};

/** Checkbox-Zustände aus fairnessMetricsDisplay übernehmen (nach State-Import).
 * Muss VOR DOMContentLoaded definiert sein, da es von importStateJSON aufgerufen wird! */
function syncMetricCheckboxes(){
  Object.entries(METRICS_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if(el) el.checked = !!fairnessMetricsDisplay[key];
  });

  Object.entries(CHARTS_MAP).forEach(([id, key]) => {
    const el = document.getElementById(id);
    if(el) el.checked = !!fairnessChartsDisplay[key];
  });
}

/** Mobile Switch Setup (Tab-Umschalter für <768px)
 * Zeigt nur ein Panel gleichzeitig an und erlaubt Umschaltung via Segment-Buttons.
 */
function setupMobileSwitch() {
  const btns = document.querySelectorAll('.ms-btn');
  const panels = document.querySelectorAll('.main-panel');

  const showPanel = (idx) => {
    panels.forEach((p, i) => p.classList.toggle('mobile-active', i === idx));
    btns.forEach((b, i) => b.classList.toggle('active', i === idx));
  };

  btns.forEach((btn) => {
    btn.addEventListener('click', () => {
      const idx = +btn.dataset.target;
      showPanel(idx);
    });
  });

  showPanel(0);  // Start: Einstellungen
}

// ── Version Update Check ─────────────────────────────────────────
// Überprüft ob eine neuere Version verfügbar ist und zeigt eine Warnung
async function checkForUpdate() {
  try {
    const res = await fetch('/api/version');
    const data = await res.json();
    const serverVersion = data.version;
    const storedVersion = localStorage.getItem('app-version');

    // Neuere Release auf GitHub als die laufende Installation? → kleine Meldung,
    // einmal pro neuer Version (Server vergleicht via /api/version, s. server.js)
    if (data.updateAvailable && localStorage.getItem('gh-update-notified') !== data.latest) {
      showToast(`✨ Neue Version ${data.latest} auf GitHub verfügbar (installiert: ${serverVersion})`);
      localStorage.setItem('gh-update-notified', data.latest);
    }

    if (storedVersion && storedVersion !== serverVersion) {
      // Neue Version verfügbar!
      console.log(`🔄 Update verfügbar: ${storedVersion} → ${serverVersion}`);

      // Zeige Banner mit Reload-Option
      const banner = document.createElement('div');
      banner.id = 'update-banner';
      banner.style.cssText = `
        position: fixed;
        top: 0;
        left: 0;
        right: 0;
        background: linear-gradient(135deg, #667eea 0%, #764ba2 100%);
        color: white;
        padding: 12px 20px;
        text-align: center;
        z-index: 9999;
        font-size: 14px;
        font-weight: 500;
        box-shadow: 0 2px 8px rgba(0,0,0,0.2);
      `;
      banner.innerHTML = `
        <span style="margin-right: 10px;">✨ Neue Version verfügbar (${serverVersion})</span>
        <button id="reload-app-btn" style="
          background: white;
          color: #667eea;
          border: none;
          padding: 6px 12px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
          transition: transform 0.2s;
        " onmouseover="this.style.transform='scale(1.05)'" onmouseout="this.style.transform='scale(1)'">
          Aktualisieren
        </button>
        <button id="dismiss-update-btn" style="
          background: rgba(255,255,255,0.2);
          color: white;
          border: 1px solid white;
          padding: 6px 12px;
          margin-left: 8px;
          border-radius: 4px;
          cursor: pointer;
          font-weight: 600;
        ">
          Später
        </button>
      `;

      document.body.insertBefore(banner, document.body.firstChild);

      // Reload-Button
      document.getElementById('reload-app-btn').onclick = () => {
        localStorage.setItem('app-version', serverVersion);
        location.reload();
      };

      // Dismiss-Button
      document.getElementById('dismiss-update-btn').onclick = () => {
        banner.remove();
      };
    } else if (!storedVersion) {
      // Erste Nutzung — Version speichern
      localStorage.setItem('app-version', serverVersion);
    }
  } catch (error) {
    console.warn('Version check failed:', error);
  }
}

// ── Startsequenz (nach Authentifizierung) ─────────────────────────
// Muss VOR DOMContentLoaded definiert sein, damit es global sichtbar ist!
async function initAfterAuth() {
  const _restored = await autoLoad();   // gespeicherten Stand wiederherstellen (async!)
  if(!_restored){
    // Kein Speicherstand → Template von Konfiguration laden
    if (typeof seedFromConfig === 'function') {
      seedFromConfig();
      // If seedFromConfig failed (appConfig null), fall back to seed()
      if (!towers || towers.length === 0) {
        console.log('seedFromConfig failed, using fallback seed');
        seed();
      }
    } else {
      seed();  // Fallback zu altem seed() wenn function nicht verfügbar
    }
    forcedPlacements = freshForcedPlacements();
    dayState = freshDayState();

    document.getElementById('start-date').value = startDate;
    updateSeedDisplay();
    renderPeople();
    renderTowerCfg();
    renderBoatCfg();
    renderPositionDescUI();
    renderExportColumnUI();   // Render exportColumns (bereits von seedFromConfig() gesetzt)

    // Neu erstellten Plan sofort speichern
    await autoSave();
  }
  _updateSaveIndicator();
  // Live-Update-Verbindung aufbauen (Session ist jetzt vorhanden)
  if(typeof realtimeConnect === 'function') realtimeConnect();
  if(typeof currentPlanId !== 'undefined' && currentPlanId != null && typeof realtimeJoin === 'function') realtimeJoin(currentPlanId);
  // Überprüfe auf verfügbare Updates
  checkForUpdate();
}

document.addEventListener('DOMContentLoaded', () => {

// ── Mobile Switch Setup (Tab-Umschalter für <768px) ──────────────
setupMobileSwitch();

// ── Sidebar – Wachgänger ─────────────────────────────────────────
const addPersonBtn = document.getElementById('add-person');
if(addPersonBtn) addPersonBtn.onclick = () => {
  people.push({ id:++uid, name:'', role:'W', experienced:true, enableLabels: true });
  renderPeople();
  scheduleAutoSave();
};
document.querySelectorAll('.quick-add button').forEach(b =>
  b.onclick = () => {
    const role = b.dataset.role;
    people.push({ id:++uid, name:'', role, experienced: b.dataset.exp !== 'false', enableLabels: true });
    renderPeople();
    scheduleAutoSave();
  });

// ── Sidebar – Türme & Boote ──────────────────────────────────────
const addTowerBtn = document.getElementById('add-tower');
if(addTowerBtn) addTowerBtn.onclick = () => {
  const minP = towers.length ? Math.min(...towers.map(t=>t.prio)) : 1;
  towers.push({ id:++uid, name:`Turm ${towers.length+1}`, prio:Math.max(1,minP), code:'', slotCount:2, leaderCount:0 });
  renderTowerCfg(); renderBoatCfg(); renderPositionDescUI();
  scheduleAutoSave();
};
const addBoatBtn = document.getElementById('add-boat');
if(addBoatBtn) addBoatBtn.onclick = () => {
  const minP = boats.length ? Math.min(...boats.map(b=>b.prio)) : (towers[0]?.prio||1);
  boats.push({ id:++uid, name:`Boot ${boats.length+1}`, code:'', towerId:towers[0]?.id||null, prio:minP, slotCount:1 });
  renderBoatCfg();
  scheduleAutoSave();
};

// ── Autosave bei JEDER Sidebar-Eingabe (Namen, Rollen, Codes, Prios, k, Tage, …) ──
// Programmatisches Setzen von .value löst kein input/change aus → nur echte Nutzer-Edits.
const _sidebarEl = document.querySelector('.sidebar');
if(_sidebarEl){
  _sidebarEl.addEventListener('input',  () => scheduleAutoSave());
  _sidebarEl.addEventListener('change', () => scheduleAutoSave());
}

// ── Sidebar – Hauptwache ─────────────────────────────────────────
const mainKInput = document.getElementById('main-k');
if(mainKInput) mainKInput.oninput = e => {
  mainK = Math.max(0, +e.target.value||0);
};

// ── Sidebar – Dienstzeit (Feature 15) ────────────────────────────────
const serviceStartHourInput = document.getElementById('service-start-hour');
const serviceEndHourInput = document.getElementById('service-end-hour');
if(serviceStartHourInput) serviceStartHourInput.onchange = e => {
  serviceStartHour = Math.max(8, Math.min(19, +e.target.value||9));
  if(serviceEndHour < serviceStartHour) serviceEndHour = serviceStartHour;
  if(serviceEndHourInput) serviceEndHourInput.value = serviceEndHour;
  scheduleAutoSave();
};
if(serviceEndHourInput) serviceEndHourInput.onchange = e => {
  serviceEndHour = Math.max(8, Math.min(19, +e.target.value||17));
  if(serviceStartHour > serviceEndHour) serviceStartHour = serviceEndHour;
  if(serviceStartHourInput) serviceStartHourInput.value = serviceStartHour;
  scheduleAutoSave();
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
  // Auto-switch to schedule view on mobile after generate
  const btns = document.querySelectorAll('.ms-btn');
  const panels = document.querySelectorAll('.main-panel');
  if (btns.length > 0 && window.matchMedia('(max-width: 900px)').matches) {
    panels.forEach((p, i) => p.classList.toggle('mobile-active', i === 1));
    btns.forEach((b, i) => b.classList.toggle('active', i === 1));
  }
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
  const eu = people.filter(p => p.role === 'W');
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
  while(dayState.length < DAYS)        dayState.push({ sick:new Set(), absent:new Set(), closed:new Set(), closedBoats:new Set() });
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
Object.entries(METRICS_MAP).forEach(([id, key]) => {
  const el = document.getElementById(id);
  if(el) el.onchange = e => {
    fairnessMetricsDisplay[key] = e.target.checked;
    if(lastResult) renderOutput();
  };
});

// ── Fairness-Visualisierungen (Charts) ─────────────────────────────
Object.entries(CHARTS_MAP).forEach(([id, key]) => {
  const el = document.getElementById(id);
  if(el) el.onchange = e => {
    fairnessChartsDisplay[key] = e.target.checked;
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
