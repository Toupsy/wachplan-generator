// ============================================================
// render-sidebar.js – Sidebar: Wachgänger, Türme, Boote
// ============================================================

/** Rendert die Wachgänger-Liste in der Sidebar. */
function renderPeople(){
  const c = document.getElementById('people-edit');
  c.innerHTML = '';
  people.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'person-edit';
    row.innerHTML = `
      <span class="pnr" title="Nummer in der Besetzungsliste">${i + 1}</span>
      <input type="text" value="${escapeHtml(p.name)}" data-id="${p.id}" class="pname" placeholder="Name">
      <select data-id="${p.id}" class="prole">
        <option value="F" ${p.role==='F'?'selected':''}>Führung</option>
        <option value="B" ${p.role==='B'?'selected':''}>Bootsführer</option>
        <option value="E" ${p.role==='E'?'selected':''}>Erfahren</option>
        <option value="U" ${p.role==='U'?'selected':''}>Unerfahren</option>
      </select>
      <button class="mini-btn del-p" data-id="${p.id}">×</button>`;
    c.appendChild(row);
  });

  c.querySelectorAll('.pname').forEach(i =>
    i.oninput = e => { getP(+e.target.dataset.id).name = e.target.value; });

  c.querySelectorAll('.prole').forEach(s =>
    s.onchange = e => { getP(+e.target.dataset.id).role = e.target.value; renderPeople(); });

  c.querySelectorAll('.del-p').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      people = people.filter(p => p.id !== id);
      dayState.forEach(d => d.sick.delete(id));
      renderPeople();
    });
}

/** Rendert die Turm-Konfiguration in der Sidebar. */
function renderTowerCfg(){
  autoCodes();
  const c = document.getElementById('tower-cfg');
  c.innerHTML = '';
  towers.forEach(t => {
    const row = document.createElement('div');
    row.className = 'tower-row';
    row.innerHTML = `
      <input type="text" value="${escapeHtml(t.name)}" data-id="${t.id}" class="tname">
      <span class="code-input" title="Stationscode">
        <label>CODE</label>
        <input type="text" value="${escapeHtml(t.code||'')}" data-id="${t.id}" class="tcode" placeholder="9/xx">
      </span>
      <span class="prio-input">
        <label>PRIO</label>
        <input type="number" min="1" value="${t.prio}" data-id="${t.id}" class="tprio">
      </span>
      <button class="mini-btn del-t" data-id="${t.id}">×</button>`;
    c.appendChild(row);
  });

  c.querySelectorAll('.tname').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).name = e.target.value; renderBoatCfg(); });

  c.querySelectorAll('.tcode').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).code = e.target.value.trim(); });

  c.querySelectorAll('.tprio').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).prio = Math.max(1, +e.target.value || 1); });

  c.querySelectorAll('.del-t').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      towers = towers.filter(t => t.id !== id);
      boats.forEach(bt => { if(bt.towerId === id) bt.towerId = null; });
      dayState.forEach(d => d.closed.delete(id));
      renderTowerCfg();
      renderBoatCfg();
    });
}

/** Rendert die Boot-Konfiguration in der Sidebar. */
function renderBoatCfg(){
  autoCodes();
  const c = document.getElementById('boat-cfg');
  if(!c) return;
  c.innerHTML = '';

  boats.forEach(b => {
    const row = document.createElement('div');
    row.className = 'tower-row boat-row';
    const towerOpts = ['<option value="">— frei —</option>'].concat(
      towers.map(t =>
        `<option value="${t.id}" ${b.towerId === t.id ? 'selected' : ''}>→ ${escapeHtml(t.name)} (${escapeHtml(t.code||'?')})</option>`)
    ).join('');
    row.innerHTML = `
      <input type="text" value="${escapeHtml(b.name)}" data-id="${b.id}" class="bname">
      <span class="code-input">
        <label>CODE</label>
        <input type="text" value="${escapeHtml(b.code||'')}" data-id="${b.id}" class="bcode" placeholder="78/x">
      </span>
      <select class="bassign" data-id="${b.id}">${towerOpts}</select>
      <button class="mini-btn del-b" data-id="${b.id}">×</button>`;
    c.appendChild(row);
  });

  c.querySelectorAll('.bname').forEach(i =>
    i.oninput = e => { getBoat(+e.target.dataset.id).name = e.target.value; });

  c.querySelectorAll('.bcode').forEach(i =>
    i.oninput = e => { getBoat(+e.target.dataset.id).code = e.target.value.trim(); });

  c.querySelectorAll('.bassign').forEach(s =>
    s.onchange = e => { getBoat(+e.target.dataset.id).towerId = +e.target.value || null; });

  c.querySelectorAll('.del-b').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      boats = boats.filter(x => x.id !== id);
      dayState.forEach(d => d.closedBoats.delete(id));
      renderBoatCfg();
    });
}
