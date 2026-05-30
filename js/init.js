// ============================================================
// init.js – Event-Listener und Startsequenz
// ============================================================

// ── Sidebar-Buttons ──────────────────────────────────────────────

document.getElementById('add-person').onclick = () => {
  people.push({ id: ++uid, name: '', role: 'E' });
  renderPeople();
};

document.querySelectorAll('.quick-add button').forEach(b =>
  b.onclick = () => { people.push({ id: ++uid, name: '', role: b.dataset.role }); renderPeople(); });

document.getElementById('add-tower').onclick = () => {
  const minP = towers.length ? Math.min(...towers.map(t => t.prio)) : 1;
  towers.push({ id: ++uid, name: `Turm ${towers.length + 1}`, prio: Math.max(1, minP), code: '' });
  renderTowerCfg();
  renderBoatCfg();
};

document.getElementById('add-boat').onclick = () => {
  const minP = boats.length ? Math.min(...boats.map(b => b.prio)) : (towers[0]?.prio || 1);
  boats.push({ id: ++uid, name: `Boot ${boats.length + 1}`, code: '', towerId: towers[0]?.id || null, prio: minP });
  renderBoatCfg();
};

document.getElementById('main-k').oninput = e => {
  mainK = Math.max(0, +e.target.value || 0);
};

document.getElementById('start-date').onchange = e => {
  startDate = e.target.value;
};

document.getElementById('generate').onclick = generate;

document.getElementById('randomize').onclick = () => {
  randomSeed = Math.floor(Math.random() * 999998) + 1;
  updateSeedDisplay();
  showToast('🎲 Neuer Seed: ' + randomSeed + ' – nächste Generierung verwendet ihn für Tag 1');
};

// ── Startsequenz ─────────────────────────────────────────────────

seed();                                            // Beispieldaten laden
document.getElementById('start-date').value = startDate;  // Datumsfeld initialisieren
updateSeedDisplay();                               // Seed-Badge aktualisieren
renderPeople();                                    // Sidebar befüllen
renderTowerCfg();
renderBoatCfg();
