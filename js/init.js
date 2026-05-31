// ============================================================
// init.js – Event-Listener und Startsequenz
// ============================================================

// ── Sidebar – Wachgänger ─────────────────────────────────────────
document.getElementById('add-person').onclick = () => {
  people.push({ id:++uid, name:'', role:'E' });
  renderPeople();
};
document.querySelectorAll('.quick-add button').forEach(b =>
  b.onclick = () => { people.push({ id:++uid, name:'', role:b.dataset.role }); renderPeople(); });

// ── Sidebar – Türme & Boote ──────────────────────────────────────
document.getElementById('add-tower').onclick = () => {
  const minP = towers.length ? Math.min(...towers.map(t=>t.prio)) : 1;
  towers.push({ id:++uid, name:`Turm ${towers.length+1}`, prio:Math.max(1,minP), code:'' });
  renderTowerCfg(); renderBoatCfg(); renderPositionDescUI(); renderHWBoatSelector();
};
document.getElementById('add-boat').onclick = () => {
  const minP = boats.length ? Math.min(...boats.map(b=>b.prio)) : (towers[0]?.prio||1);
  boats.push({ id:++uid, name:`Boot ${boats.length+1}`, code:'', towerId:towers[0]?.id||null, prio:minP });
  renderBoatCfg(); renderHWBoatSelector();
};

// ── Sidebar – Hauptwache ─────────────────────────────────────────
document.getElementById('main-k').oninput = e => {
  mainK = Math.max(0, +e.target.value||0);
};

// ── Sidebar – Datum & Generierung ────────────────────────────────
document.getElementById('start-date').onchange = e => { startDate = e.target.value; };
document.getElementById('generate').onclick    = generate;

// ── Sidebar – Tageanzahl ─────────────────────────────────────────
document.getElementById('num-days').oninput = e => {
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
document.getElementById('randomize').onclick   = () => {
  randomSeed = Math.floor(Math.random()*999998)+1;
  updateSeedDisplay();
  showToast('🎲 Neuer Seed: '+randomSeed+' – nächste Generierung verwendet ihn für Tag 1');
};

// ── Move-Modal ────────────────────────────────────────────────────
document.getElementById('move-modal-close-btn').onclick = closeMoveModal;
document.getElementById('move-modal').addEventListener('click', e => {
  if(e.target === e.currentTarget) closeMoveModal();  // Klick außerhalb schließt Modal
});

// ── XLSX-Template laden ───────────────────────────────────────────
document.getElementById('btn-load-template').onclick = () => {
  document.getElementById('template-file-input').click();
};
document.getElementById('template-file-input').onchange = async e => {
  const file = e.target.files[0];
  if(!file) return;
  const arr = new Uint8Array(await file.arrayBuffer());
  _cacheTemplate(arr);
  showToast('✅ Template gespeichert: ' + file.name);
  e.target.value = '';
  // Falls ein Export-Aufruf ausstehend war, jetzt ausführen
  if(_pendingExportDay !== null){
    const d = _pendingExportDay;
    _pendingExportDay = null;
    _doExport(arr, d);
  }
};

// ── XLSX-Stationsspalten ──────────────────────────────────────────
document.getElementById('btn-auto-export-cols').onclick = () => {
  autoFillExportColumns();
  showToast('✅ Stationsspalten automatisch befüllt');
};

// ── Import / Export Planstatus ────────────────────────────────────
document.getElementById('btn-export-state').onclick = exportStateJSON;

document.getElementById('btn-import-state').onclick = () => {
  document.getElementById('import-file-input').click();
};
document.getElementById('import-file-input').onchange = e => {
  const file = e.target.files[0];
  if(!file) return;
  const reader = new FileReader();
  reader.onload = ev => importStateJSON(ev.target.result);
  reader.readAsText(file, 'utf-8');
  e.target.value = '';
};
document.getElementById('btn-clear-save').onclick = clearLocalSave;

// ── Startsequenz ─────────────────────────────────────────────────
const _restored = autoLoad();   // gespeicherten Stand wiederherstellen
if(!_restored){
  // Kein Speicherstand → Beispieldaten laden
  seed();
  forcedPlacements = freshForcedPlacements();
  dayState = freshDayState();

  document.getElementById('start-date').value = startDate;
  updateSeedDisplay();
  autoCodes();
  renderPeople();
  renderTowerCfg();
  renderBoatCfg();
  renderHWBoatSelector();
  renderPositionDescUI();
  autoFillExportColumns();   // Standardmäßig aus Türmen & Booten befüllen
}
_updateSaveIndicator();
_updateTemplateStatus();
