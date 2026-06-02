// ============================================================
// render-sidebar.js – Sidebar: Wachgänger, Türme, Boote, Extras
// ============================================================

function renderPeople(){
  const c = document.getElementById('people-edit');
  c.innerHTML = '';
  people.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'person-edit';
    row.innerHTML = `
      <span class="pnr" title="Nr. in Besetzungsliste">${i+1}</span>
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
      forcedPlacements.forEach(fp => {
        const idx = fp.findIndex(f => f.personId === id);
        if(idx >= 0) fp.splice(idx, 1);
      });
      renderPeople();
    });
}

function renderTowerCfg(){
  autoCodes();
  const c = document.getElementById('tower-cfg');
  c.innerHTML = '';
  let dragSrcTower = null;
  let dragMode = null; // 'swap' oder 'insert'

  towers.forEach((t, i) => {
    const row = document.createElement('div');
    row.className = 'tower-row';
    row.draggable = true;
    row.dataset.idx = i;
    row.innerHTML = `
      <span style="color:var(--text-dim);font-size:1rem;cursor:grab;user-select:none;padding-right:4px;flex-shrink:0" title="Ziehen zum Sortieren">⠿</span>
      <input type="text" value="${escapeHtml(t.name)}" data-id="${t.id}" class="tname" placeholder="Turmname" draggable="false">
      <div class="tower-row-meta">
        <span class="code-input" title="Stationscode">
          <label>CODE</label>
          <input type="text" value="${escapeHtml(t.code||'')}" data-id="${t.id}" class="tcode" placeholder="9/xx" draggable="false">
        </span>
        <span class="prio-input">
          <label>PRIO</label>
          <input type="number" min="1" value="${t.prio}" data-id="${t.id}" class="tprio" draggable="false">
        </span>
        <div class="slot-spinner">
          <button class="slot-btn slot-minus" data-id="${t.id}" data-type="tower">−</button>
          <span class="slot-display">${t.slotCount||2}</span>
          <button class="slot-btn slot-plus" data-id="${t.id}" data-type="tower">+</button>
        </div>
        <button class="mini-btn del-t" data-id="${t.id}">×</button>
      </div>`;

    row.addEventListener('dragstart', e => {
      dragSrcTower = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      c.querySelectorAll('.tower-row').forEach(r => {
        r.style.background = '';
        r.style.borderTop = '';
      });
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Y-Position prüfen: obere Hälfte = Insert, untere Hälfte = Swap
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const isInsertZone = e.clientY < midpoint;

      if(isInsertZone) {
        dragMode = 'insert';
        row.style.borderTop = '3px solid var(--green)';
        row.style.background = '';
      } else {
        dragMode = 'swap';
        row.style.borderTop = '';
        row.style.background = 'rgba(24,168,216,.15)';
      }
    });
    row.addEventListener('dragleave', () => {
      row.style.background = '';
      row.style.borderTop = '';
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.style.background = '';
      row.style.borderTop = '';
      if(dragSrcTower === null || dragSrcTower === i) return;

      if(dragMode === 'swap') {
        // Tauschen
        [towers[dragSrcTower], towers[i]] = [towers[i], towers[dragSrcTower]];
      } else {
        // Insert
        const moved = towers.splice(dragSrcTower, 1)[0];
        const targetIdx = dragSrcTower < i ? i - 1 : i;
        towers.splice(targetIdx, 0, moved);
      }

      // Prio aus Position ableiten
      towers.forEach((t, idx) => t.prio = towers.length - idx);
      dragSrcTower = null;
      dragMode = null;
      generate(); renderTowerCfg();
    });

    c.appendChild(row);
  });
  c.querySelectorAll('.tname').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).name = e.target.value; });
  c.querySelectorAll('.tcode').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).code = e.target.value.trim(); });
  c.querySelectorAll('.tprio').forEach(i =>
    i.oninput = e => { getT(+e.target.dataset.id).prio = Math.max(1, +e.target.value||1); });
  c.querySelectorAll('.slot-minus[data-type="tower"]').forEach(b =>
    b.onclick = e => { const t = getT(+e.target.dataset.id); if(t.slotCount > 1) { t.slotCount--; generate(); renderTowerCfg(); } });
  c.querySelectorAll('.slot-plus[data-type="tower"]').forEach(b =>
    b.onclick = e => { const t = getT(+e.target.dataset.id); if(t.slotCount < 10) { t.slotCount++; generate(); renderTowerCfg(); } });
  c.querySelectorAll('.del-t').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      towers = towers.filter(t => t.id !== id);
      boats.forEach(bt => { if(bt.towerId === id) bt.towerId = null; });
      dayState.forEach(d => d.closed.delete(id));
      forcedPlacements.forEach(fp => {
        const toRemove = fp.filter(f => f.kind==='tower' && f.slotId===id);
        toRemove.forEach(f => fp.splice(fp.indexOf(f), 1));
      });
      renderTowerCfg(); renderBoatCfg(); renderPositionDescUI(); renderHWBoatSelector();
    });
}

function renderBoatCfg(){
  autoCodes();
  const c = document.getElementById('boat-cfg');
  if(!c) return;
  c.innerHTML = '';
  let dragSrcBoat = null;
  let dragMode = null; // 'swap' oder 'insert'

  boats.forEach((b, i) => {
    const row = document.createElement('div');
    row.className = 'tower-row boat-row';
    row.draggable = true;
    row.dataset.idx = i;
    const towerOpts = ['<option value="">— frei —</option>',
      '<option value="HW" ' + (b.towerId==='HW'?'selected':'') + '>⛱ Hauptwache</option>',
    ].concat(
      towers.map(t =>
        `<option value="${t.id}" ${b.towerId===t.id?'selected':''}>→ ${escapeHtml(t.name)} (${escapeHtml(t.code||'?')})</option>`)
    ).join('');
    row.innerHTML = `
      <span style="color:var(--text-dim);font-size:1rem;cursor:grab;user-select:none;padding-right:4px;flex-shrink:0" title="Ziehen zum Sortieren">⠿</span>
      <input type="text" value="${escapeHtml(b.name)}" data-id="${b.id}" class="bname" placeholder="Bootname" draggable="false">
      <div class="tower-row-meta">
        <span class="code-input">
          <label>CODE</label>
          <input type="text" value="${escapeHtml(b.code||'')}" data-id="${b.id}" class="bcode" placeholder="78/x" draggable="false">
        </span>
        <select class="bassign" data-id="${b.id}" style="flex:1;min-width:0" draggable="false">${towerOpts}</select>
        <div class="slot-spinner">
          <button class="slot-btn slot-minus" data-id="${b.id}" data-type="boat">−</button>
          <span class="slot-display">${b.slotCount||1}</span>
          <button class="slot-btn slot-plus" data-id="${b.id}" data-type="boat">+</button>
        </div>
        <button class="mini-btn del-b" data-id="${b.id}">×</button>
      </div>`;

    row.addEventListener('dragstart', e => {
      dragSrcBoat = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      c.querySelectorAll('.boat-row').forEach(r => {
        r.style.background = '';
        r.style.borderTop = '';
      });
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';

      // Y-Position prüfen: obere Hälfte = Insert, untere Hälfte = Swap
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const isInsertZone = e.clientY < midpoint;

      if(isInsertZone) {
        dragMode = 'insert';
        row.style.borderTop = '3px solid var(--green)';
        row.style.background = '';
      } else {
        dragMode = 'swap';
        row.style.borderTop = '';
        row.style.background = 'rgba(24,168,216,.15)';
      }
    });
    row.addEventListener('dragleave', () => {
      row.style.background = '';
      row.style.borderTop = '';
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.style.background = '';
      row.style.borderTop = '';
      if(dragSrcBoat === null || dragSrcBoat === i) return;

      if(dragMode === 'swap') {
        // Tauschen
        [boats[dragSrcBoat], boats[i]] = [boats[i], boats[dragSrcBoat]];
      } else {
        // Insert
        const moved = boats.splice(dragSrcBoat, 1)[0];
        const targetIdx = dragSrcBoat < i ? i - 1 : i;
        boats.splice(targetIdx, 0, moved);
      }

      dragSrcBoat = null;
      dragMode = null;
      generate(); renderBoatCfg();
    });

    c.appendChild(row);
  });
  c.querySelectorAll('.bname').forEach(i => {
    i.oninput = e  => { getBoat(+e.target.dataset.id).name = e.target.value; };
    i.onblur  = () => { renderHWBoatSelector(); renderPositionDescUI(); };
  });
  c.querySelectorAll('.bcode').forEach(i =>
    i.oninput = e => { getBoat(+e.target.dataset.id).code = e.target.value.trim(); });
  c.querySelectorAll('.bassign').forEach(s =>
    s.onchange = e => {
      const val = e.target.value;
      getBoat(+e.target.dataset.id).towerId = val === 'HW' ? 'HW' : (+val || null);
      renderHWBoatSelector();
    });
  c.querySelectorAll('.slot-minus[data-type="boat"]').forEach(b =>
    b.onclick = e => { const bo = getBoat(+e.target.dataset.id); if(bo.slotCount > 1) { bo.slotCount--; generate(); renderBoatCfg(); } });
  c.querySelectorAll('.slot-plus[data-type="boat"]').forEach(b =>
    b.onclick = e => { const bo = getBoat(+e.target.dataset.id); if(bo.slotCount < 3) { bo.slotCount++; generate(); renderBoatCfg(); } });
  c.querySelectorAll('.del-b').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      if(hwBoatId === id) hwBoatId = null;
      boats = boats.filter(x => x.id !== id);
      dayState.forEach(d => d.closedBoats.delete(id));
      forcedPlacements.forEach(fp => {
        const toRemove = fp.filter(f => f.kind==='boat' && f.slotId===id);
        toRemove.forEach(f => fp.splice(fp.indexOf(f), 1));
      });
      renderBoatCfg(); renderHWBoatSelector();
    });
}

/** Feature 6: Dropdown zur HW-Boot-Auswahl */
function renderHWBoatSelector(){
  const c = document.getElementById('hw-boat-select');
  if(!c) return;
  const opts = ['<option value="">— kein HW-Boot —</option>'].concat(
    boats.map(b => `<option value="${b.id}" ${hwBoatId===b.id?'selected':''}>${escapeHtml(b.name)} (${escapeHtml(b.code||'?')})</option>`)
  ).join('');
  c.innerHTML = opts;
  c.onchange = e => { hwBoatId = +e.target.value || null; };
}

/**
 * Befüllt exportColumns automatisch:
 * Pro Turm (Prio absteigend): zuerst zugeordnete Boote, dann der Turm selbst.
 * Boote ohne Turm-Zuordnung danach. Abschluss: WF → WF2 → HW → HW2.
 */
function autoFillExportColumns(){
  const cols = [];
  towers.slice().sort((a,b) => b.prio - a.prio).forEach(t => {
    boats.filter(b => b.towerId === t.id && b.id !== hwBoatId)
         .forEach(b => { if(b.code) cols.push(b.code); });
    if(t.code) cols.push(t.code);
  });
  boats.filter(b => (!b.towerId || b.towerId === 'HW') && b.id !== hwBoatId)
       .forEach(b => { if(b.code) cols.push(b.code); });
  cols.push('WF');
  if(people.filter(p => p.role==='F').length > 2) cols.push('WF2');
  cols.push('HW', 'HW2');
  while(cols.length < TEMPLATE_STATION_COLS.length) cols.push('');
  exportColumns = cols.slice(0, TEMPLATE_STATION_COLS.length);
  renderExportColumnUI();
}

/** XLSX-Stationsspalten-Konfiguration mit Drag & Drop zum Umsortieren */
function renderExportColumnUI(){
  const c = document.getElementById('export-col-fields');
  if(!c) return;
  while(exportColumns.length < TEMPLATE_STATION_COLS.length) exportColumns.push('');

  const knownCodes = [
    ...boats.map(b => b.code).filter(Boolean),
    ...towers.map(t => t.code).filter(Boolean),
    'WF','WF2','HW','HW2',
  ];

  c.innerHTML = '';
  let dragSrcIdx = null;

  TEMPLATE_STATION_COLS.forEach((col, i) => {
    const row = document.createElement('div');
    row.draggable = true;
    row.dataset.idx = i;
    row.style.cssText = 'display:grid;grid-template-columns:18px 46px 1fr;gap:5px;align-items:center;margin-bottom:5px;border-radius:6px;padding:1px 2px;transition:background .1s';
    const colLabel = colLetter(col);
    row.innerHTML = `
      <span style="color:var(--text-dim);font-size:1rem;cursor:grab;user-select:none;text-align:center;line-height:1">⠿</span>
      <span style="font-family:\'Spline Sans Mono\',monospace;font-size:.68rem;color:var(--text-dim);text-align:right;padding-right:4px">${colLabel}21</span>
      <input type="text" list="excol-list-${i}" class="excol-input pos-desc-input" draggable="false"
        data-idx="${i}" value="${escapeHtml(exportColumns[i]||'')}"
        placeholder="leer = unbenutzt"
        style="padding:5px 8px;font-size:.78rem">
      <datalist id="excol-list-${i}">
        ${knownCodes.map(k => `<option value="${escapeHtml(k)}">`).join('')}
      </datalist>`;

    row.addEventListener('dragstart', e => {
      dragSrcIdx = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => { row.style.opacity = '0.35'; }, 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      c.querySelectorAll('[data-idx]').forEach(r => r.style.background = '');
    });
    row.addEventListener('dragover', e => {
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      row.style.background = 'rgba(24,168,216,.18)';
    });
    row.addEventListener('dragleave', () => { row.style.background = ''; });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.style.background = '';
      if(dragSrcIdx === null || dragSrcIdx === i) return;
      const tmp = exportColumns[dragSrcIdx];
      exportColumns[dragSrcIdx] = exportColumns[i];
      exportColumns[i] = tmp;
      dragSrcIdx = null;
      renderExportColumnUI();
    });

    c.appendChild(row);
  });

  c.querySelectorAll('.excol-input').forEach(inp =>
    inp.oninput = e => { exportColumns[+e.target.dataset.idx] = e.target.value.trim(); });
}

/** Feature 2: Positionsbeschriftungen für XLSX (C11,C13,C15,C17,C19) */
function renderPositionDescUI(){
  const c = document.getElementById('pos-desc-fields');
  if(!c) return;
  c.innerHTML = '';
  const defaultPlaceholders = ['Wachführer', 'Bootsführer', 'Bootsführerin', 'Koch', 'Sanitäter'];
  for(let pos = 3; pos <= 7; pos++){
    const row = document.createElement('div');
    row.className = 'pos-desc-row';
    const placeholderIdx = pos - 3;
    const placeholder = defaultPlaceholders[placeholderIdx] || '';
    row.innerHTML = `
      <label class="pos-label">Pos. ${pos} <span style="color:var(--text-dim);font-size:.65rem">(C${pos*2+5})</span></label>
      <input type="text" class="pos-desc-input" data-pos="${pos}"
        value="${escapeHtml(positionDescriptions[pos]||'')}"
        placeholder="z.B. ${placeholder}">`;
    c.appendChild(row);
  }
  c.querySelectorAll('.pos-desc-input').forEach(i =>
    i.oninput = e => { positionDescriptions[+e.target.dataset.pos] = e.target.value; });
}
