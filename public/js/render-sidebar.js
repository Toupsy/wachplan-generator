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
      ${p.role==='B' ? `<select data-id="${p.id}" class="bf-level" title="BF Erfahrungslevel">
        <option value="E" ${p.bfLevel==='E'?'selected':''}>BF-E</option>
        <option value="U" ${p.bfLevel==='U'?'selected':''}>BF-U</option>
      </select>` : ''}
      <button class="mini-btn del-p" data-id="${p.id}">×</button>`;
    c.appendChild(row);
  });
  c.querySelectorAll('.pname').forEach(i =>
    i.oninput = e => { getP(+e.target.dataset.id).name = e.target.value; });
  c.querySelectorAll('.prole').forEach(s =>
    s.onchange = e => { getP(+e.target.dataset.id).role = e.target.value; renderPeople(); });
  c.querySelectorAll('.bf-level').forEach(s =>
    s.onchange = e => { getP(+e.target.dataset.id).bfLevel = e.target.value; });
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
      scheduleAutoSave();
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
    const assignedBoats = boats.filter(b => b.towerId === t.id);
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
          <label style="font-size:.75rem;flex-shrink:0;color:var(--text-dim)">👥</label>
          <button class="slot-btn slot-minus" data-id="${t.id}" data-type="tower">−</button>
          <span class="slot-display">${t.slotCount||2}</span>
          <button class="slot-btn slot-plus" data-id="${t.id}" data-type="tower">+</button>
          <span style="font-size:.65rem;color:var(--text-dim)">Wachgänger</span>
        </div>
        <div style="display:flex;align-items:center;gap:8px">
          <input type="checkbox" class="leader-checkbox" data-id="${t.id}" ${(t.leaderCount||0)>0?'checked':''} title="Führungskräfte einschalten" style="width:18px;height:18px;cursor:pointer;accent-color:var(--sea-bright);flex-shrink:0">
          <div class="leader-spinner" title="Anzahl benötigter Führungskräfte" style="flex:1;min-width:180px">
            <label style="font-size:.75rem;flex-shrink:0;color:var(--text-dim)">👔</label>
            <button class="slot-btn leader-minus" data-id="${t.id}" ${(t.leaderCount||0)===0?'disabled':''}>−</button>
            <span class="leader-display">${t.leaderCount||0}</span>
            <button class="slot-btn leader-plus" data-id="${t.id}" ${(t.leaderCount||0)>=3?'disabled':''}>+</button>
            <span style="font-size:.65rem;color:var(--text-dim)">Führungskräfte</span>
          </div>
        </div>
        <button class="mini-btn del-t" data-id="${t.id}">×</button>
      </div>
      ${assignedBoats.length > 0 ? `<div class="tower-boats">${assignedBoats.map(b => `<div class="tower-boat-item" data-boat-id="${b.id}" draggable="true" data-tower-id="${t.id}" title="Zum Turm bewegen">🚤 ${escapeHtml(b.name)} (${escapeHtml(b.code||'?')})</div>`).join('')}</div>` : ''}`;

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
      const boatId = e.dataTransfer.getData('boatId');

      if(boatId){
        // Drag von Boot - Boot zu Turm ziehen
        e.dataTransfer.dropEffect = 'move';
        row.style.background = 'rgba(78,168,216,.2)';
        row.style.borderLeft = '4px solid var(--green)';
      } else {
        // Drag von Turm - normale Tower-Reorder-Logik
        e.dataTransfer.dropEffect = 'move';
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
      }
    });
    row.addEventListener('dragleave', () => {
      row.style.background = '';
      row.style.borderTop = '';
      row.style.borderLeft = '';
    });
    row.addEventListener('drop', e => {
      e.preventDefault();
      row.style.background = '';
      row.style.borderTop = '';
      row.style.borderLeft = '';

      const boatId = +e.dataTransfer.getData('boatId');
      if(boatId){
        // Boot wurde auf Turm gezogen
        const boat = getBoat(boatId);
        if(boat.towerId !== t.id){
          boat.towerId = t.id;
          // Wenn Boot war HW-Boot, clear hwBoatId
          if(hwBoatId === boat.id){
            hwBoatId = null;
          }
          renderBoatCfg();
          renderTowerCfg();
          renderHWBoatSelector();
          showToast(`✅ 🚤 ${escapeHtml(boat.name)} → ${escapeHtml(t.name)}`);
        }
      } else if(dragSrcTower !== null && dragSrcTower !== i) {
        // Tower wurde auf Tower gezogen
        if(dragMode === 'swap') {
          // Tauschen
          [towers[dragSrcTower], towers[i]] = [towers[i], towers[dragSrcTower]];
        } else {
          // Insert
          const moved = towers.splice(dragSrcTower, 1)[0];
          const targetIdx = dragSrcTower < i ? i - 1 : i;
          towers.splice(targetIdx, 0, moved);
        }

        // Priorisierung bleibt unverändert - wird manuell eingegeben
        dragSrcTower = null;
        dragMode = null;
        generate(); renderTowerCfg();
      }
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
  c.querySelectorAll('.leader-checkbox').forEach(cb =>
    cb.onchange = e => { const t = getT(+e.target.dataset.id); if(!e.target.checked) { t.leaderCount = 0; } else if((t.leaderCount||0) === 0) { t.leaderCount = 1; } generate(); renderTowerCfg(); scheduleAutoSave(); });
  c.querySelectorAll('.leader-minus').forEach(b =>
    b.onclick = e => { const t = getT(+e.target.dataset.id); if((t.leaderCount||0) > 0) { t.leaderCount--; if(t.leaderCount === 0) { const cb = e.target.closest('.tower-row-meta').querySelector('.leader-checkbox'); if(cb) cb.checked = false; } generate(); renderTowerCfg(); } });
  c.querySelectorAll('.leader-plus').forEach(b =>
    b.onclick = e => { const t = getT(+e.target.dataset.id); if((t.leaderCount||0) < 3) { t.leaderCount++; const cb = e.target.closest('.tower-row-meta').querySelector('.leader-checkbox'); if(cb) cb.checked = true; generate(); renderTowerCfg(); } });
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
      scheduleAutoSave();
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
        <span class="prio-input">
          <label>PRIO</label>
          <input type="number" min="1" value="${b.prio}" data-id="${b.id}" class="bprio" draggable="false">
        </span>
        <select class="bassign" data-id="${b.id}" style="flex:1;min-width:0" draggable="false">${towerOpts}</select>
        <button class="mini-btn del-b" data-id="${b.id}">×</button>
      </div>`;

    row.addEventListener('dragstart', e => {
      dragSrcBoat = i;
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('boatId', b.id);
      e.dataTransfer.setData('boatName', b.name);
      setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      c.querySelectorAll('.boat-row').forEach(r => {
        r.style.background = '';
        r.style.borderTop = '';
        r.style.borderLeft = '';
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
  c.querySelectorAll('.bprio').forEach(i =>
    i.oninput = e => { getBoat(+e.target.dataset.id).prio = Math.max(1, +e.target.value||1); });
  c.querySelectorAll('.bassign').forEach(s =>
    s.onchange = e => {
      const boat = getBoat(+e.target.dataset.id);
      const val = e.target.value;
      boat.towerId = val === 'HW' ? 'HW' : (+val || null);
      // Wenn Boot die HW-Boot war und jetzt nicht mehr zur HW zugeordnet ist, hwBoatId clearen
      if(hwBoatId === boat.id && val !== 'HW'){
        hwBoatId = null;
      }
      renderHWBoatSelector();
    });
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
      scheduleAutoSave();
    });
}

/** Feature 6: Dropdown zur HW-Boot-Auswahl (nur Boote die zur HW zugeordnet sind) */
function renderHWBoatSelector(){
  const c = document.getElementById('hw-boat-select');
  if(!c) return;
  // Nur Boote filtern die zur HW zugeordnet sind (towerId === 'HW')
  const opts = ['<option value="">— kein HW-Boot —</option>'].concat(
    boats.filter(b => b.towerId === 'HW').map(b => `<option value="${b.id}" ${hwBoatId===b.id?'selected':''}>${escapeHtml(b.name)} (${escapeHtml(b.code||'?')})</option>`)
  ).join('');
  c.innerHTML = opts;
  c.onchange = e => {
    const boatId = +e.target.value || null;
    // Validierung: Boot muss zur HW zugeordnet sein
    if(boatId && getBoat(boatId).towerId !== 'HW'){
      showToast('⚠️ Boot muss erst zur Hauptwache zugeordnet werden');
      e.target.value = hwBoatId || '';
      return;
    }
    hwBoatId = boatId;
  };
}

/**
 * Befüllt exportColumns automatisch:
 * Pro Turm (nach Turmzahl aufsteigend, z.B. 9/12, 9/13, ...): zuerst zugeordnete Boote, dann der Turm selbst.
 * Nach Turm 9/13: WF → HW.
 * Rest mit leeren Einträgen auffüllen.
 */
function autoFillExportColumns(){
  const cols = [];

  // Sortiere Türme nach Turmzahl (NOT Priorisierung)
  // Extrahiere Zahl nach "/" und sortiere numerisch (9/12, 9/13, ..., 9/18)
  const sortedTowers = towers.slice().sort((a,b) => {
    const numA = parseInt(a.name.split('/')[1] || a.name) || 0;
    const numB = parseInt(b.name.split('/')[1] || b.name) || 0;
    return numA - numB;
  });
  console.log('DEBUG autoFillExportColumns - sortedTowers:', sortedTowers.map(t => `${t.name}(prio${t.prio})`));

  sortedTowers.forEach(t => {
    // Boote zu diesem Turm
    boats.filter(b => b.towerId === t.id && b.id !== hwBoatId)
         .forEach(b => { if(b.code) cols.push(b.code); });

    // Turm selbst
    if(t.code) cols.push(t.code);
    else console.log('⚠️ Tower hat keinen Code:', t.name);

    // Nach Turm 9/13: [leer], WF, HW, [leer]
    if(t.name === '9/13'){
      cols.push('');
      cols.push('WF');
      cols.push('HW');
      cols.push('');
    }
  });

  console.log('DEBUG autoFillExportColumns - final cols:', cols);
  while(cols.length < TEMPLATE_STATION_COLS.length) cols.push('');
  exportColumns = cols.slice(0, TEMPLATE_STATION_COLS.length);
  console.log('DEBUG autoFillExportColumns - exportColumns:', exportColumns);
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
