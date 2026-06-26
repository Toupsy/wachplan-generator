// ============================================================
// render-sidebar.js – Sidebar: Wachgänger, Türme, Boote, Extras
// ============================================================

function renderPeople(){
  const c = document.getElementById('people-edit');
  c.innerHTML = '';

  if(people.length > 28){
    const warning = document.createElement('div');
    warning.className = 'warning-box';
    warning.style.cssText = 'color:var(--coral);font-size:0.85rem;padding:8px;margin-bottom:8px;border-left:3px solid var(--coral);background:rgba(255,100,100,0.05)';
    warning.textContent = `⚠️ ${people.length} Personen – XLSX fasst max. 28! Personen 29+ erscheinen ohne Namen.`;
    c.appendChild(warning);
  }

  let dragSrcPerson = null;
  let dragMode = null; // 'swap' oder 'insert'

  people.forEach((p, i) => {
    const row = document.createElement('div');
    row.className = 'person-edit';
    row.draggable = true;
    row.dataset.idx = i;
    const hasLabels = (p.labels || '').trim().length > 0;
    row.innerHTML = `
      <span class="pnr" style="cursor:grab" title="Ziehen zum Sortieren – ändert die Nr. in der Besetzungsliste (XLSX-Export)">${i+1}</span>
      <input type="text" value="${escapeHtml(p.name)}" data-id="${p.id}" class="pname" placeholder="Name" draggable="false">
      <select data-id="${p.id}" class="prole" draggable="false">
        <option value="F" ${p.role==='F'?'selected':''}>Führung</option>
        <option value="B" ${p.role==='B'?'selected':''}>Bootsführer</option>
        <option value="W" ${p.role==='W'?'selected':''}>Wachgänger</option>
      </select>
      ${p.role==='F' ? `<div class="exp-placeholder"></div>` : `<div class="exp-group">
        <label class="exp-toggle" title="Erfahren?">
          <input type="checkbox" data-id="${p.id}" class="exp-checkbox" ${p.experienced?'checked':''}>
          <span>Erf.</span>
        </label>
        ${p.role==='B' ? `<label class="hw-wish-toggle" title="HW-Wunsch: bei BF-Überzahl mindestens 1× aktiver Hauptwache-Dienst pro Woche">
          <input type="checkbox" data-id="${p.id}" class="hwwish-checkbox" ${p.wantsHW?'checked':''}>
          <span>🏠</span>
        </label>` : ''}
        ${(p.role==='W' || p.role==='B') ? `<label class="san-toggle" title="Sanitäter – wird auf San-Türmen wenn möglich immer eingesetzt">
          <input type="checkbox" data-id="${p.id}" class="san-checkbox" ${p.sanitaeter?'checked':''}>
          <span>🚑</span>
        </label>` : ''}
      </div>`}
      <div class="row-actions">
        ${(p.role==='W' || p.role==='B') ? `<button class="mini-btn partner-btn ${(p.partnerWishIds&&p.partnerWishIds.length)?'has-wish':''}" data-id="${p.id}" title="Wunsch-Turmpartner wählen – wird im Laufe der Woche erfüllt, ohne die Fairness zu beeinflussen">🤝${(p.partnerWishIds&&p.partnerWishIds.length)?`<span class="wish-badge">${p.partnerWishIds.length}</span>`:''}</button>` : ''}
        <label class="label-toggle" title="Labels bearbeiten">
          <input type="checkbox" data-id="${p.id}" class="labels-checkbox" ${hasLabels ? 'checked' : ''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--sea-bright);flex-shrink:0">
          <span style="font-size:0.7rem;color:var(--text-dim)">🏷️</span>
        </label>
      </div>
      <button class="mini-btn del-p" data-id="${p.id}">×</button>`;
    c.appendChild(row);

    // Labels in separate row, shown only when checkbox is checked
    const labelsRow = document.createElement('div');
    labelsRow.className = 'person-labels-row';
    labelsRow.style.display = hasLabels ? 'grid' : 'none';
    labelsRow.setAttribute('data-id', p.id);
    labelsRow.innerHTML = `
      <input type="text" value="${escapeHtml(p.labels||'')}" data-id="${p.id}" class="plabels" placeholder="Labels (z.B. Sanitäter, Rettungsschwimmer)" maxlength="200">`;
    c.appendChild(labelsRow);

    // ── Drag & Drop: Reihenfolge (= Nr. im XLSX-Export) ändern ──────
    row.addEventListener('dragstart', e => {
      dragSrcPerson = i;
      e.dataTransfer.effectAllowed = 'move';
      setTimeout(() => row.style.opacity = '0.4', 0);
    });
    row.addEventListener('dragend', () => {
      row.style.opacity = '';
      c.querySelectorAll('.person-edit').forEach(r => {
        r.style.background = '';
        r.style.borderTop = '';
      });
    });
    row.addEventListener('dragover', e => {
      if(dragSrcPerson === null) return;
      e.preventDefault();
      e.dataTransfer.dropEffect = 'move';
      // Obere Hälfte = Einfügen (Reorder), untere Hälfte = Tauschen
      const rect = row.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      if(e.clientY < midpoint){
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
      if(dragSrcPerson === null || dragSrcPerson === i) return;

      if(dragMode === 'swap'){
        [people[dragSrcPerson], people[i]] = [people[i], people[dragSrcPerson]];
      } else {
        const moved = people.splice(dragSrcPerson, 1)[0];
        const targetIdx = dragSrcPerson < i ? i - 1 : i;
        people.splice(targetIdx, 0, moved);
      }

      dragSrcPerson = null;
      dragMode = null;
      // Reihenfolge ändert nur die Besetzungs-Nr. (personNr) → KEIN generate(),
      // der Plan selbst bleibt unverändert; nur neu rendern + speichern.
      renderPeople();
      scheduleAutoSave();
    });
  });

  // Event handler for label checkbox
  c.querySelectorAll('.labels-checkbox').forEach(checkbox => {
    checkbox.onchange = e => {
      const personId = +e.target.dataset.id;
      const p = getP(personId);
      p.enableLabels = e.target.checked;
      if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'enableLabels', p.enableLabels);
      const labelsRow = Array.from(c.querySelectorAll('.person-labels-row')).find(row => +row.getAttribute('data-id') === personId);
      if (labelsRow) {
        labelsRow.style.display = e.target.checked ? 'grid' : 'none';
      }
      scheduleAutoSave();
      renderOutput();
    };
  });
  c.querySelectorAll('.pname').forEach(i =>
    i.oninput = e => { getP(+e.target.dataset.id).name = e.target.value; });
  c.querySelectorAll('.plabels').forEach(i =>
    i.oninput = e => { const p = getP(+e.target.dataset.id); p.labels = e.target.value; if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'labels', p.labels); });
  c.querySelectorAll('.prole').forEach(s =>
    s.onchange = e => {
      const p = getP(+e.target.dataset.id);
      p.role = e.target.value;
      if(p.experienced === undefined) p.experienced = true;  // Default erfahren
      if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'role', p.role);
      renderPeople();
      scheduleAutoSave();
    });
  c.querySelectorAll('.exp-checkbox').forEach(cb =>
    cb.onchange = e => { const p = getP(+e.target.dataset.id); p.experienced = e.target.checked; if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'experienced', p.experienced); scheduleAutoSave(); renderOutput(); });
  c.querySelectorAll('.hwwish-checkbox').forEach(cb =>
    cb.onchange = e => { const p = getP(+e.target.dataset.id); p.wantsHW = e.target.checked; if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'wantsHW', p.wantsHW); generate(); scheduleAutoSave(); });
  c.querySelectorAll('.san-checkbox').forEach(cb =>
    cb.onchange = e => { const p = getP(+e.target.dataset.id); p.sanitaeter = e.target.checked; if(typeof recordRosterOverride === 'function') recordRosterOverride(p, 'sanitaeter', p.sanitaeter); generate(); scheduleAutoSave(); });
  // Turmpartner-Wünsche: 🤝-Button öffnet das Auswahl-Modal (Mehrfachauswahl).
  c.querySelectorAll('.partner-btn').forEach(b =>
    b.onclick = e => openPartnerModal(+e.currentTarget.dataset.id));
  c.querySelectorAll('.del-p').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      people = people.filter(p => p.id !== id);
      // Dangling Turmpartner-Wünsche auf die gelöschte Person entfernen.
      people.forEach(p => { if(Array.isArray(p.partnerWishIds)) p.partnerWishIds = p.partnerWishIds.filter(x => x !== id); });
      dayState.forEach(d => { d.sick.delete(id); d.absent.delete(id); });
      forcedPlacements.forEach(fp => {
        const idx = fp.findIndex(f => f.personId === id);
        if(idx >= 0) fp.splice(idx, 1);
      });
      renderPeople();
      scheduleAutoSave();
    });
}

// ── Turmpartner-Wunsch-Modal (Feature 48) ────────────────────────────
// Mehrfachauswahl der gewünschten Turmpartner. Bewusst ausgelagert ins Modal, damit die ohnehin
// dichte Personen-Zeile nur einen einzigen 🤝-Button trägt. Nur W/B sind wähl-/wünschbar – F
// werden nie über bestPair auf Türme verteilt (eigener poolF) → ein F-Wunsch wäre nie erfüllbar.
let _partnerModalPersonId = null;
function openPartnerModal(personId){
  const p = getP(personId);
  if(!p) return;
  _partnerModalPersonId = personId;
  const overlay = document.getElementById('partner-modal');
  const title   = document.getElementById('partner-modal-title');
  const listEl  = document.getElementById('partner-modal-list');
  title.textContent = `Wunschpartner für ${p.name || '(ohne Name)'}`;

  const wished = new Set(p.partnerWishIds || []);
  const candidates = people.filter(o => o.id !== personId && (o.role === 'W' || o.role === 'B'));
  if(candidates.length === 0){
    listEl.innerHTML = `<div class="partner-empty">Keine weiteren Wachgänger/Bootsführer vorhanden.</div>`;
  } else {
    listEl.innerHTML = candidates.map(o => `
      <label class="partner-pick">
        <input type="checkbox" value="${o.id}" ${wished.has(o.id) ? 'checked' : ''}>
        <span class="role-dot ${roleDot(o)}"></span>
        <span class="partner-pick-name">${o.name ? escapeHtml(o.name) : '(ohne Name)'}</span>
      </label>`).join('');
  }
  overlay.style.display = 'flex';
}

function closePartnerModal(){
  const overlay = document.getElementById('partner-modal');
  if(overlay) overlay.style.display = 'none';
  _partnerModalPersonId = null;
}

// Übernimmt die im Modal gewählten Wünsche auf die Person.
function _savePartnerModal(){
  const p = _partnerModalPersonId != null ? getP(_partnerModalPersonId) : null;
  if(!p){ closePartnerModal(); return; }
  const listEl = document.getElementById('partner-modal-list');
  const ids = Array.from(listEl.querySelectorAll('input[type=checkbox]:checked')).map(cb => +cb.value);
  p.partnerWishIds = ids;
  // Name-basiert als Roster-Override merken (überlebt ein Neu-Ableiten mit frischen ids).
  if(typeof recordRosterOverride === 'function'){
    const names = ids.map(id => getP(id)?.name).filter(Boolean);
    recordRosterOverride(p, 'partnerWishNames', names);
  }
  closePartnerModal();
  generate();
  renderPeople();   // Badge am 🤝-Button aktualisieren
  scheduleAutoSave();
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
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:8px" title="Als Führungsturm markieren – hier wird wenn möglich immer eine Führungskraft eingesetzt"><input type="checkbox" class="leadertower-checkbox" data-id="${t.id}" ${t.leaderTower?'checked':''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--sea-bright);flex-shrink:0"><span style="font-size:.75rem;color:var(--text-dim)">👔</span></label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:8px" title="Als Hauptstrand-Turm markieren – fairer Ausgleich Hauptstrand ↔ Außentürme"><input type="checkbox" class="mainbeach-checkbox" data-id="${t.id}" ${t.mainBeach?'checked':''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--sea-bright);flex-shrink:0"><span style="font-size:.75rem;color:var(--text-dim)">🏖️</span></label>
          <label style="display:flex;align-items:center;gap:6px;cursor:pointer;margin-left:8px" title="Als San-Turm markieren – hier wird wenn möglich immer ein Sanitäter eingesetzt"><input type="checkbox" class="santower-checkbox" data-id="${t.id}" ${t.sanTower?'checked':''} style="width:18px;height:18px;cursor:pointer;accent-color:var(--coral);flex-shrink:0"><span style="font-size:.75rem;color:var(--text-dim)">🚑</span></label>
        </div>
        <button class="mini-btn del-t" data-id="${t.id}">×</button>
      </div>
      ${assignedBoats.length > 0 ? `<div class="tower-boats">${assignedBoats.map(b => `<div class="tower-boat-item" data-boat-id="${b.id}" draggable="true" data-tower-id="${t.id}" title="Zum Turm bewegen">🚤 ${escapeHtml(b.name)} (${escapeHtml(b.code||'?')})</div>`).join('')}</div>` : ''}
    `;

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
          renderBoatCfg();
          renderTowerCfg();
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
  c.querySelectorAll('.mainbeach-checkbox').forEach(cb =>
    cb.onchange = e => {
      getT(+e.target.dataset.id).mainBeach = e.target.checked;
      generate(); renderTowerCfg(); scheduleAutoSave();
    });
  c.querySelectorAll('.santower-checkbox').forEach(cb =>
    cb.onchange = e => {
      getT(+e.target.dataset.id).sanTower = e.target.checked;
      generate(); renderTowerCfg(); scheduleAutoSave();
    });
  c.querySelectorAll('.leadertower-checkbox').forEach(cb =>
    cb.onchange = e => {
      getT(+e.target.dataset.id).leaderTower = e.target.checked;
      generate(); renderTowerCfg(); scheduleAutoSave();
    });
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
      renderTowerCfg(); renderBoatCfg(); renderPositionDescUI();
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
    i.onblur  = () => { renderPositionDescUI(); };
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
      scheduleAutoSave();
    });
  c.querySelectorAll('.del-b').forEach(b =>
    b.onclick = e => {
      const id = +e.target.dataset.id;
      boats = boats.filter(x => x.id !== id);
      dayState.forEach(d => d.closedBoats.delete(id));
      forcedPlacements.forEach(fp => {
        const toRemove = fp.filter(f => f.kind==='boat' && f.slotId===id);
        toRemove.forEach(f => fp.splice(fp.indexOf(f), 1));
      });
      renderBoatCfg();
      scheduleAutoSave();
    });
}


/**
 * Befüllt exportColumns automatisch:
 * Pro Turm (nach Turmzahl aufsteigend, z.B. 9/12, 9/13, ...): zuerst zugeordnete Boote, dann der Turm selbst.
 * Nach allen Türmen: HW-Boote, dann WF → HW.
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

  sortedTowers.forEach(t => {
    // Boote zu diesem Turm
    boats.filter(b => b.towerId === t.id)
         .forEach(b => { if(b.code) cols.push(b.code); });

    // Turm selbst
    if(t.code) cols.push(t.code);
  });

  // HW-Boote (zusätzliche Stationsspalten)
  boats.filter(b => b.towerId === 'HW')
       .forEach(b => { if(b.code) cols.push(b.code); });

  // WF + HW deterministisch (nicht an einen Turmnamen gekoppelt)
  cols.push('');
  cols.push('WF');
  cols.push('HW');
  cols.push('');

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
    'WF','HW',
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

/** Algorithmus-Parameter: Scoring-Gewichte für den Fairness-Algorithmus bearbeitbar machen */
function renderAlgoParams(){
  const c = document.getElementById('algo-params-fields');
  if(!c) return;

  const defaults = defaultAlgoParams();
  const groups = [
    {
      label: 'Turm-Rotation & Fairness',
      params: [
        { key:'pairRepeatWeight',        label:'Paar-Wiederholung',            desc:'Strafe wenn zwei Personen denselben Partner wie an einem Vortag haben',                  min:0, max:2000 },
        { key:'towerVisitWeight',        label:'Gleicher Turm (pro Besuch)',   desc:'Strafe für wiederholten Besuch desselben Turms (pro Besuch)',                            min:0, max:1000 },
        { key:'consecutiveTowerPenalty', label:'Aufeinanderfolgend. Turm',     desc:'Strafe wenn jemand heute denselben Turm wie gestern belegt',                             min:0, max:1000 },
        { key:'totalFairnessWeight',     label:'Gesamtlast-Ausgleich',         desc:'Gewicht für Ausgleich der akkumulierten Gesamteinsätze (höher = strikter)',              min:0, max:100  },
        { key:'beachBalanceWeight',      label:'Hauptstrand-Ausgleich/Tag',    desc:'Strafe pro Überhang-Tag beim Hauptstrand/Außenturm-Ausgleich (nur wenn beide aktiv)',    min:0, max:300  },
      ],
    },
    {
      label: 'E/U-Mischung',
      params: [
        { key:'uuPenaltyTower',    label:'2 Unerfahrene auf Turm',         desc:'Strafe wenn zwei Unerfahrene auf einen Turm kommen',                                    min:0, max:5000  },
        { key:'uuPenaltyHW',       label:'2 Unerfahrene an HW',            desc:'Niedrigere Strafe – erlaubt Unerfahrenen-Paare an der Hauptwache',                     min:0, max:2000  },
        { key:'eePenaltyNormal',   label:'2 Erfahrene (normal)',           desc:'Leichte Bremsung von Erfahrenen-Paaren wenn genug Erfahrene vorhanden',               min:0, max:500   },
        { key:'eePenaltyReserve',  label:'2 Erfahrene (Erfahrene knapp)', desc:'Starke Trennung wenn Erfahrene knapp – jeder Turm soll genau einen bekommen',         min:0, max:5000  },
        { key:'reserveExpPenalty', label:'Erfahrener an HW (wenn knapp)', desc:'Verhindert dass Erfahrene an HW "verbraucht" werden wenn Türme sie zwingend brauchen', min:0, max:20000 },
      ],
    },
    {
      label: 'Hauptwache (HW)',
      params: [
        { key:'hwVisitWeightTower', label:'HW-Tage → Turm-Bonus',          desc:'Pro akkumuliertem HW-Tag bekommt die Person einen Bonus für Turm-Zuweisung',          min:0, max:300   },
        { key:'hwVisitWeightHW',    label:'HW-Wiederholungsbesuch',        desc:'Strafe pro bisherigem HW-Dienst – sorgt für Rotation (analog zum Turm-Wiederholungsbesuch)', min:0, max:1000  },
        { key:'hwWishBonusEarly',   label:'BF-HW-Wunsch (früh)',           desc:'Bonus für BF mit HW-Wunsch der noch unerfüllt ist (>2 Tage vor Ende der Woche)',      min:0, max:5000  },
        { key:'hwWishBonusNear',    label:'BF-HW-Wunsch (2 Tage vor Ende)',desc:'Eskalierter Bonus wenn noch 2 Tage bleiben um den Wunsch zu erfüllen',               min:0, max:20000 },
      ],
    },
    {
      label: 'BF-Schutz',
      params: [
        { key:'surplusBfActivePenalty', label:'Überzahl-BF auf Boot-Turm',     desc:'Überzählige BF meiden Türme mit aktivem Boot (verhindert BF ohne Boot)',     min:0, max:3000 },
        { key:'surplusBfClosedBonus',   label:'Überzahl-BF auf inakt. Boot-T.',desc:'Bonus: Überzählige BF bevorzugt an Türme ohne aktives Boot',                  min:0, max:1000 },
        { key:'towerBoatHeavyPenalty',  label:'Beide boot-lastig auf Turm',    desc:'Strafe wenn beide Turm-Personen schon viele Turm+Boot-Dienste hatten',       min:0, max:500  },
      ],
    },
    {
      label: 'Boote',
      params: [
        { key:'boatVisitWeight',   label:'Gleiches Boot (pro Besuch)', desc:'Strafe pro Wiederholungsfahrt auf demselben Boot',                                   min:0, max:500  },
        { key:'boatHwBonus',       label:'HW-Tage → Boot-Bonus',      desc:'Wer viele HW-Tage hatte wird bei der Boot-Zuweisung bevorzugt (pro HW-Tag)',         min:0, max:100  },
        { key:'boatRotationBase',  label:'Boot-Rotations-Basis',      desc:'Basisstrafe pro Lookback-Schritt – verhindert denselben BF aufeinanderfolgende Tage', min:0, max:5000 },
      ],
    },
  ];

  c.innerHTML = '';
  groups.forEach(group => {
    const groupDiv = document.createElement('div');
    groupDiv.style.cssText = 'margin-bottom:18px';

    const groupLabel = document.createElement('div');
    groupLabel.style.cssText = 'font-size:.75rem;font-weight:600;color:var(--foam);text-transform:uppercase;letter-spacing:.08em;margin-bottom:8px;padding-bottom:4px;border-bottom:1px solid var(--line)';
    groupLabel.textContent = group.label;
    groupDiv.appendChild(groupLabel);

    group.params.forEach(param => {
      const row = document.createElement('div');
      row.style.cssText = 'display:grid;grid-template-columns:1fr 72px 22px;gap:5px;align-items:center;margin-bottom:5px';

      const labelEl = document.createElement('label');
      labelEl.style.cssText = 'font-size:.78rem;color:var(--text);cursor:help';
      labelEl.title = param.desc;
      labelEl.textContent = param.label;

      const input = document.createElement('input');
      input.type = 'number';
      input.min = param.min;
      input.max = param.max;
      input.value = algoParams[param.key];
      input.dataset.key = param.key;
      input.title = param.desc;
      input.style.cssText = 'background:var(--navy-2);border:1px solid var(--line-strong);border-radius:6px;color:var(--text);font-family:\'Spline Sans Mono\',monospace;font-size:.8rem;padding:4px 6px;text-align:right;color-scheme:dark;width:100%';

      const resetBtn = document.createElement('button');
      resetBtn.textContent = '↺';
      resetBtn.title = `Standard: ${defaults[param.key]}`;
      resetBtn.style.cssText = 'font-size:.8rem;color:var(--text-dim);background:none;border:none;cursor:pointer;padding:2px;line-height:1;opacity:.7';
      resetBtn.type = 'button';

      resetBtn.onclick = () => {
        algoParams[param.key] = defaults[param.key];
        input.value = defaults[param.key];
        if(lastResult) generate();
        scheduleAutoSave();
      };
      input.oninput = e => {
        const v = parseFloat(e.target.value);
        if(!isNaN(v) && v >= param.min) {
          algoParams[param.key] = v;
          if(lastResult) generate();
          scheduleAutoSave();
        }
      };

      row.appendChild(labelEl);
      row.appendChild(input);
      row.appendChild(resetBtn);
      groupDiv.appendChild(row);
    });

    c.appendChild(groupDiv);
  });

  const resetAllBtn = document.createElement('button');
  resetAllBtn.className = 'ghost-btn';
  resetAllBtn.type = 'button';
  resetAllBtn.style.cssText = 'width:100%;margin-top:4px;border-color:var(--warn);color:var(--warn);font-size:.78rem';
  resetAllBtn.textContent = '↺ Alle Parameter zurücksetzen';
  resetAllBtn.onclick = () => {
    algoParams = defaultAlgoParams();
    renderAlgoParams();
    if(lastResult) generate();
    scheduleAutoSave();
    showToast('✅ Algorithmus-Parameter zurückgesetzt');
  };
  c.appendChild(resetAllBtn);
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
