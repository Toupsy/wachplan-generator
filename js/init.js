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
  e.target.value = ''; // Reset damit dieselbe Datei erneut gewählt werden kann
};

// ── Startsequenz ─────────────────────────────────────────────────
seed();
forcedPlacements = freshForcedPlacements();   // sicherheitshalber neu initialisieren

document.getElementById('start-date').value = startDate;
updateSeedDisplay();
autoCodes();
renderPeople();
renderTowerCfg();
renderBoatCfg();
renderHWBoatSelector();
renderPositionDescUI();
