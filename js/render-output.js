// ============================================================
// render-output.js – Hauptbereich: Tages-Ansicht + Matrix
// ============================================================

/** Rendert den kompletten Ausgabe-Bereich neu. */
function renderOutput(){
  const panel = document.getElementById('output-panel');
  let { schedule } = lastResult;

  // ── Wende transparent placements visuell an (ohne generate()) ────
  // Für Case 1: Personen VISUELL verschieben, aber Plan bleibt unverändert
  schedule = schedule.map((day, dayIdx) => {
    const dayForcedTransparent = (forcedPlacements[dayIdx] || []).filter(f => f.transparent);
    if(dayForcedTransparent.length === 0) return day;

    // Kopiere den Day, damit original unverändert bleibt
    const dayClone = JSON.parse(JSON.stringify(day));

    dayForcedTransparent.forEach(f => {
      const person = people.find(p => p.id === f.personId);
      if(!person) return;

      // Entferne Person aus natürlichem Slot
      dayClone.assign.forEach(slot => {
        if(slot.kind === 'tower')
          slot.occupants = slot.occupants.filter(p => p.id !== f.personId);
        else if(slot.kind === 'boat'){
          slot.occupants = slot.occupants.filter(p => p.id !== f.personId);
          if(slot.occupants.length > 0) slot.bootsf = slot.occupants[0];
          else slot.bootsf = null;
        }
        else if(slot.kind === 'main'){
          slot.fuehrung = slot.fuehrung.filter(p => p.id !== f.personId);
          slot.mainGuards = slot.mainGuards.filter(p => p.id !== f.personId);
          slot.base = slot.base.filter(p => p.id !== f.personId);
          slot.bootsfLeft = slot.bootsfLeft.filter(p => p.id !== f.personId);
          if(slot.hwBoatSlot?.bootsf?.id === f.personId) slot.hwBoatSlot.bootsf = null;
        }
      });

      // Füge in Zielslot ein
      if(f.kind === 'tower'){
        const s = dayClone.assign.find(s => s.kind === 'tower' && s.towerId === f.slotId);
        if(s) s.occupants.push(person);
      } else if(f.kind === 'boat'){
        const s = dayClone.assign.find(s => s.kind === 'boat' && s.boatId === f.slotId);
        if(s){
          s.occupants.push(person);
          s.bootsf = s.occupants[0];
        }
      } else if(f.kind === 'hwboat'){
        const main = dayClone.assign.find(s => s.kind === 'main');
        if(main?.hwBoatSlot && main.hwBoatSlot.boatId === f.slotId){
          main.hwBoatSlot.bootsf = person;
        }
      } else if(f.kind === 'main'){
        const main = dayClone.assign.find(s => s.kind === 'main');
        if(main) main.base.push(person);
      }
    });

    return dayClone;
  });

  // ── Globale Statistiken ────────────────────────────────────────
  const allPairs    = Object.entries(lastResult.pairCount);
  const distinctPairs  = allPairs.filter(([,v])=>v>0).length;
  const repeatedPairs  = allPairs.filter(([,v])=>v>1).length;
  let uuTotal = 0, repeatTowers = 0;
  schedule.forEach(day => day.assign.forEach(s => {
    if(s.occupants?.length===2 && (s.occupants[0].role+s.occupants[1].role)==='UU') uuTotal++;
  }));
  Object.values(lastResult.stats).forEach(s =>
    Object.values(s.towerVisits).forEach(v => { if(v>2) repeatTowers++; }));

  // NEW: Fairness metrics
  const hwBalance = lastResult.fairnessMetrics?.hwBalance || {};
  const boatDiversity = lastResult.fairnessMetrics?.boatPairingDiversity || {};
  const towerDist = lastResult.fairnessMetrics?.towerDistribution || {};
  const hwBalanceColor = hwBalance.isBalanced ? 'var(--green)' : 'var(--warn)';
  const boatDiversityColor = boatDiversity.maxRepeats <= 2 ? 'var(--green)' : 'var(--warn)';
  const towerDistColor = towerDist.minUniqueTowers >= towers.length * 0.5 ? 'var(--green)' : 'var(--warn)';

  // ── Kopfbereich ────────────────────────────────────────────────
  let html = `
    <div class="out-header">
      <div>
        <div class="section-label" style="margin-bottom:8px;">Wachplan · ${DAYS} Tage · sukzessiv</div>
        <div class="day-tabs">
          ${schedule.map((d,i) => {
            const flags = [];
            if(d.sickCount > 0)            flags.push('🤒');
            if(d.manualClosed.length > 0)  flags.push('⛔');
            return `<button class="day-tab ${i===activeDay?'active':''}" data-day="${i}">${dayLabel(i)}${flags.length?`<span class="flag">${flags.join('')}</span>`:''}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="export-row">
        <button class="ghost-btn" id="btn-official" style="border-color:var(--warn);color:var(--warn)">📋 XLSX (${dayLabel(activeDay)})</button>
        <button class="ghost-btn" id="btn-csv">↓ CSV</button>
        <button class="ghost-btn" id="btn-print">⎙ Drucken</button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat"><div class="num">${distinctPairs}</div><div class="lbl">verschiedene Paare</div></div>
      <div class="stat"><div class="num" style="color:${repeatedPairs?'var(--warn)':'var(--green)'}">${repeatedPairs}</div><div class="lbl">Paar-Wiederholungen</div></div>
      <div class="stat"><div class="num" style="color:${uuTotal?'var(--coral)':'var(--green)'}">${uuTotal}</div><div class="lbl">U+U Besetzungen</div></div>
      <div class="stat"><div class="num" style="color:${repeatTowers?'var(--coral)':'var(--green)'}">${repeatTowers}</div><div class="lbl">Turm &gt;2× gleich</div></div>
      ${fairnessMetricsDisplay.hwBoatBalance ? `<div class="stat"><div class="num" style="color:${hwBalanceColor}">${hwBalance.avgHwVisits||0} | ${hwBalance.avgTowerWithBoatDays||0}</div><div class="lbl">🏠 HW | ⛵ Boot-Turm</div></div>` : ''}
      ${fairnessMetricsDisplay.towerDistribution ? `<div class="stat"><div class="num" style="color:${towerDistColor}">${towerDist.avgUniqueTowers||0}</div><div class="lbl">📍 Ø verschiedene Türme</div></div>` : ''}
      ${fairnessMetricsDisplay.boatPairingDiversity ? `<div class="stat"><div class="num" style="color:${boatDiversityColor}">${boatDiversity.diversePercent||0}%</div><div class="lbl">👥 Boot-Paare unique</div></div>` : ''}
    </div>`;

  // ── Tages-Panels ──────────────────────────────────────────────
  schedule.forEach((d, di) => {
    const dayForced = forcedPlacements[di] || [];
    const forcedIds = new Set(dayForced.map(f => f.personId));

    html += `<div class="day-panel" style="display:${di===activeDay?'block':'none'}" data-panel="${di}">`;

    // Tages-Steuerung
    html += `<div class="day-controls">
      <div class="dc-head">
        <div><span class="dc-title">${dayLabel(di)}</span> <span class="dc-sub">— Status nur für diesen Tag</span></div>
        <div class="date-pick"><label>📅 Datum</label>
          <input type="date" value="${computeDayDates()[di]||''}" readonly title="Aus Startdatum berechnet"></div>
      </div>
      <div class="dc-section">
        <div class="lbl">🤒 Krank melden</div>
        <div class="toggle-grid">
          ${people.map(p=>`<span class="toggle-chip ${dayState[di].sick.has(p.id)?'sick':''}" data-sick="${p.id}" data-day="${di}">
            <i class="role-dot rd-${p.role.toLowerCase()}"></i><span class="nm">${escapeHtml(p.name)}</span>
            ${dayState[di].sick.has(p.id)?'<span class="x">KRANK</span>':''}</span>`).join('')}
        </div>
      </div>
      <div class="dc-section">
        <div class="lbl">⛔ Turm schließen</div>
        <div class="toggle-grid">
          ${towers.map(t=>`<span class="toggle-chip ${dayState[di].closed.has(t.id)?'closed-t':''}" data-closet="${t.id}" data-day="${di}">
            🗼 <span class="nm">${escapeHtml(t.name)}</span>
            ${dayState[di].closed.has(t.id)?'<span class="x">ZU</span>':''}</span>`).join('')}
        </div>
      </div>
      ${boats.length?`<div class="dc-section">
        <div class="lbl">🚤 Boot außer Dienst</div>
        <div class="toggle-grid">
          ${boats.map(b=>`<span class="toggle-chip ${dayState[di].closedBoats.has(b.id)?'closed-t':''}" data-closeb="${b.id}" data-day="${di}">
            🚤 <span class="nm">${escapeHtml(b.name)}</span>
            ${dayState[di].closedBoats.has(b.id)?'<span class="x">ZU</span>':''}</span>`).join('')}
        </div>
      </div>`:''}
      ${dayForced.length?`<div class="dc-section">
        <div class="lbl" style="color:var(--warn)">🔒 Manuelle Zuweisungen aktiv</div>
        <div class="toggle-grid">
          ${dayForced.map(f=>{
            const p=getP(f.personId); if(!p) return '';
            let dest = f.kind==='tower' ? `🗼 ${getT(f.slotId)?.name||'?'}` :
                       f.kind==='boat'  ? `🚤 ${getBoat(f.slotId)?.name||'?'}` : '⛱ HW';
            return `<span class="toggle-chip" style="border-color:var(--warn)">
              🔒 ${escapeHtml(p.name)} → ${dest}
              <span class="x" data-clear-forced="${f.personId}" data-clear-day="${di}" style="cursor:pointer">✕</span>
            </span>`;
          }).join('')}
        </div>
        <button class="add-btn" style="margin-top:6px;border-color:rgba(255,179,71,0.4);color:var(--warn)"
          data-clear-all-day="${di}">Alle Fixierungen heute aufheben</button>
      </div>`:''}
    </div>`;

    // Warn-Notices
    if(d.manualClosed.length)
      html+=`<div class="notice bad">⛔ <div>Manuell geschlossen: <strong>${d.manualClosed.map(t=>escapeHtml(t.name)).join(', ')}</strong></div></div>`;
    if(d.personnelClosed.length)
      html+=`<div class="notice bad">⚠️ <div>Personalmangel – geschlossen: <strong>${d.personnelClosed.map(t=>escapeHtml(t.name)).join(', ')}</strong></div></div>`;
    if(d.boatsManualClosed.length)
      html+=`<div class="notice bad">🚤 <div>Außer Dienst: <strong>${d.boatsManualClosed.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    if(d.boatsClosedTower.length)
      html+=`<div class="notice warn-n">🚤 <div>Boot zu (Turm zu): <strong>${d.boatsClosedTower.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    if(d.boatsNoBootsf.length)
      html+=`<div class="notice warn-n">🚤 <div>Boot zu (kein BF): <strong>${d.boatsNoBootsf.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    const uuToday = d.assign.filter(s=>s.kind==='tower'&&s.occupants.length===2&&(s.occupants[0].role+s.occupants[1].role)==='UU').length;
    if(uuToday>0) html+=`<div class="notice warn-n">⚠️ <div>${uuToday}× zwei Unerfahrene auf einem Turm.</div></div>`;

    // ── Karten ─────────────────────────────────────────────────
    html += `<div class="towers-grid">`;
    d.assign.forEach(slot => {
      // ─ Hauptwache ─
      if(slot.kind === 'main'){
        const occ = (p, lbl, kind, slotId) => `
          <div class="occupant" draggable="true" data-person-id="${p.id}" data-source-kind="${kind}" data-source-slot="${slotId}">
            <i class="role-dot rd-${p.role.toLowerCase()}"></i>
            ${escapeHtml(p.name)}
            ${forcedIds.has(p.id)?'<span class="forced-badge" title="Manuell fixiert">🔒</span>':''}
            <span class="o-role">${lbl||ROLE[p.role]}</span>
            <button class="move-btn" data-move-person="${p.id}" data-move-day="${di}"
              data-move-kind="${kind}" data-move-slot="${slotId||''}" title="Verschieben">↕</button>
          </div>`;
        html += `<div class="tower-card main" style="grid-column:span 2;" data-drop-kind="main" data-drop-slot="${MAIN_ID}">
          <div class="tc-head"><span class="tc-name">⛱ ${slot.tower}</span><span class="tc-type main">Zentrale · k=${slot.k}</span></div>
          ${slot.fuehrung.map(p=>occ(p,'Führung','main',MAIN_ID)).join('')}
          ${slot.mainGuards.map(p=>occ(p,p.role==='E'?'Erfahren · HW':'Unerf. · HW','main',MAIN_ID)).join('')}
          ${slot.base.map(p=>occ(p,p.role==='E'?'Erfahren · HW':'Unerf. · HW','main',MAIN_ID)).join('')}
          ${slot.bootsfLeft.map(p=>occ(p,'Bootsführer · HW','main',MAIN_ID)).join('')}
          ${slot.hwBoatSlot ? `
            <div class="hq-divider">🚤 HW-Boot: ${escapeHtml(slot.hwBoatSlot.name)}</div>
            ${slot.hwBoatSlot.bootsf ? occ(slot.hwBoatSlot.bootsf,'Bootsführer','hwboat',slot.hwBoatSlot.boatId) : '<div style="color:var(--coral);font-size:.78rem;padding:6px 0">⚠ Kein Bootsführer verfügbar</div>'}
          ` : ''}
          ${slot.sick.map(p=>`<div class="occupant" style="opacity:.55"><i class="role-dot rd-${p.role.toLowerCase()}"></i><span style="text-decoration:line-through">${escapeHtml(p.name)}</span><span class="o-role" style="color:var(--coral)">krank</span></div>`).join('')}
        </div>`;
      }
      // ─ Turm ─
      else if(slot.kind === 'tower'){
        html += `<div class="tower-card" data-drop-kind="tower" data-drop-slot="${slot.towerId}">
          <div class="tc-head"><span class="tc-name">🗼 ${escapeHtml(slot.tower)}</span><span class="tc-type normal">Turm · ${escapeHtml(slot.code||'?')} · P${slot.prio}</span></div>
          ${slot.occupants.map(p=>`
            <div class="occupant" draggable="true" data-person-id="${p.id}" data-source-kind="tower" data-source-slot="${slot.towerId}">
              <i class="role-dot rd-${p.role.toLowerCase()}"></i>${escapeHtml(p.name)}
              ${forcedIds.has(p.id)?'<span class="forced-badge" title="Manuell fixiert">🔒</span>':''}
              <span class="o-role">${ROLE[p.role]}</span>
              <button class="move-btn" data-move-person="${p.id}" data-move-day="${di}"
                data-move-kind="tower" data-move-slot="${slot.towerId}" title="Verschieben">↕</button>
            </div>`).join('')}
          ${slot.warn?`<div class="warn-pair">⚠ ${slot.warn}</div>`:''}
        </div>`;
      }
      // ─ Boot ─
      else if(slot.kind === 'boat'){
        html += `<div class="tower-card boot" data-drop-kind="boat" data-drop-slot="${slot.boatId}">
          <div class="tc-head"><span class="tc-name">🚤 ${escapeHtml(slot.name)}</span><span class="tc-type boot">Boot · ${escapeHtml(slot.code||'?')}</span></div>
          <div class="boat-link">→ ${escapeHtml(slot.towerName)}</div>
          ${slot.occupants.map(p=>`
            <div class="occupant" draggable="true" data-person-id="${p.id}" data-source-kind="boat" data-source-slot="${slot.boatId}">
              <i class="role-dot rd-${p.role.toLowerCase()}"></i>${escapeHtml(p.name)}
              ${forcedIds.has(p.id)?'<span class="forced-badge" title="Manuell fixiert">🔒</span>':''}
              <span class="o-role">${ROLE[p.role]}</span>
              <button class="move-btn" data-move-person="${p.id}" data-move-day="${di}"
                data-move-kind="boat" data-move-slot="${slot.boatId}" title="Verschieben">↕</button>
            </div>`).join('')}
        </div>`;
      }
    });

    // Geschlossene Türme & Boote
    [...d.manualClosed,...d.personnelClosed].forEach(t => {
      const reason = d.manualClosed.includes(t)?'manuell geschlossen':'Personalmangel';
      html += `<div class="tower-card closed"><div class="tc-head"><span class="tc-name">🗼 ${escapeHtml(t.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });
    [...d.boatsManualClosed,...d.boatsClosedTower,...d.boatsNoBootsf].forEach(b => {
      const reason = d.boatsManualClosed.includes(b)?'manuell außer Dienst':d.boatsClosedTower.includes(b)?'Turm zu':'kein Bootsführer';
      html += `<div class="tower-card closed boot"><div class="tc-head"><span class="tc-name">🚤 ${escapeHtml(b.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });

    html += `</div></div>`;
  });

  html += renderTowerStatsPerPerson();
  html += renderMatrix();
  panel.innerHTML = html;

  // ── Event-Listener ─────────────────────────────────────────────
  panel.querySelectorAll('.day-tab').forEach(t =>
    t.onclick = e => { activeDay = +e.currentTarget.dataset.day; renderOutput(); });

  const togSets = [
    { sel: '[data-sick]',    key: 'sick',        getter: d => dayState[d].sick },
    { sel: '[data-closet]',  key: 'closet',      getter: d => dayState[d].closed },
    { sel: '[data-closeb]',  key: 'closeb',      getter: d => dayState[d].closedBoats },
  ];
  togSets.forEach(({ sel, key, getter }) => {
    panel.querySelectorAll(sel).forEach(el =>
      el.onclick = e => {
        const id = +e.currentTarget.dataset[key], day = +e.currentTarget.dataset.day;
        const s = getter(day);
        s.has(id) ? s.delete(id) : s.add(id);
        generate();
      });
  });

  // Move-Buttons
  panel.querySelectorAll('.move-btn').forEach(btn =>
    btn.onclick = e => {
      e.stopPropagation();
      const b = e.currentTarget;
      openMoveModal(
        +b.dataset.movePerson,
        +b.dataset.moveDay,
        b.dataset.moveKind,
        +b.dataset.moveSlot || null
      );
    });

  // Fixierung aufheben (Einzelperson)
  panel.querySelectorAll('[data-clear-forced]').forEach(el =>
    el.onclick = e => {
      e.stopPropagation();
      const personId = +e.currentTarget.dataset.clearForced;
      const day      = +e.currentTarget.dataset.clearDay;
      clearForced(personId, day, 'today');
    });

  // Alle Fixierungen des Tages aufheben
  panel.querySelectorAll('[data-clear-all-day]').forEach(btn =>
    btn.onclick = e => {
      const day = +e.currentTarget.dataset.clearAllDay;
      forcedPlacements[day] = [];
      generate();
    });

  // ── Drag-and-Drop Event Handler ───────────────────────────────────
  const grid = panel.querySelector('.towers-grid');
  let dragSrc = null;

  grid.addEventListener('dragstart', e => {
    const occ = e.target.closest('.occupant');
    if(!occ) return;
    // Slot normalisieren: 0 für MAIN_ID (Hauptwache), sonst echte ID
    dragSrc = {
      personId: +occ.dataset.personId,
      kind: occ.dataset.sourceKind,
      slot: +occ.dataset.sourceSlot || 0
    };
    occ.style.opacity = '0.4';
    e.dataTransfer.effectAllowed = 'move';
    e.dataTransfer.setData('text/plain', dragSrc.personId);
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.tower-card');
    if(card && !card.classList.contains('closed')) {
      card.style.backgroundColor = 'rgba(24,168,216,0.15)';
      card.style.borderColor = 'var(--sea-bright)';
    }
  });

  grid.addEventListener('dragleave', e => {
    const card = e.target.closest('.tower-card');
    if(card) {
      card.style.backgroundColor = '';
      card.style.borderColor = '';
    }
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.tower-card');
    if(!card || !dragSrc) return;

    const targetKind = card.dataset.dropKind;
    const targetSlot = +card.dataset.dropSlot;

    // dragSrc VOR dem Modal-Aufruf sichern!
    // dragend feuert (async) sobald die Maus losgelassen wird → setzt dragSrc = null.
    // Da showConfirmation ein Modal öffnet, ist dragSrc beim Bestätigen bereits null.
    const srcPersonId = dragSrc.personId;
    const srcKind     = dragSrc.kind;
    const srcSlot     = dragSrc.slot;

    const clearCard = () => { card.style.backgroundColor = ''; card.style.borderColor = ''; };

    // Validierung: Nicht in geschlossene Türme
    if(card.classList.contains('closed')) {
      showToast('⚠️ Kann nicht zu geschlossenen Türmen/Booten verschoben werden');
      clearCard();
      return;
    }

    // Verhindern von Drop in denselben Slot
    if(srcKind === targetKind && srcSlot === targetSlot) {
      clearCard();
      return;
    }

    // Validierung: Rolle
    const p = getP(srcPersonId);
    const isBoatTarget = (targetKind === 'boat' || targetKind === 'hwboat');
    const isRoleViolation = isBoatTarget && p && p.role !== 'B';

    const confirmMsg = isRoleViolation
      ? `${p.name} ist ${ROLE[p.role]}, nicht Bootsführer. Trotzdem zum Boot verschieben?`
      : `Verschiebe ${p?.name || 'Person'} zu ${card.dataset.dropKind}?`;

    showConfirmation(
      confirmMsg,
      (recalcFuture) => {
        if(recalcFuture){
          // Case 2: Schedule direkt modifizieren + nur Folgetage neu generieren
          _applyMoveToSchedule(srcPersonId, activeDay, targetKind, targetSlot);
          _applyMove(srcPersonId, activeDay, targetKind, targetSlot, true);
          generate(activeDay + 1);
        } else {
          // Case 1: Nur visuell (kein generate!)
          _applyMove(srcPersonId, activeDay, targetKind, targetSlot, false);
        }

        renderOutput();
        clearCard();
      },
      clearCard,
      true  // showRecalcCheckbox immer anzeigen
    );
  });

  grid.addEventListener('dragend', e => {
    const occ = e.target.closest('.occupant');
    if(occ) occ.style.opacity = '';
    dragSrc = null;
  });

  document.getElementById('btn-csv').onclick   = exportCSV;
  document.getElementById('btn-print').onclick = () => window.print();
  const bo = document.getElementById('btn-official');
  if(bo) bo.onclick = () => exportOfficial(activeDay);
}

/** Tower-Einsatzverteilung pro Person */
function renderTowerStatsPerPerson(){
  if(!lastResult?.stats) return '';
  const tMap = {}; towers.forEach(t => tMap[t.id] = t);
  const threshold = towers.length * 0.5;
  let html = '<div class="section-label" style="margin-top:30px;">Turm-Einsatzverteilung pro Person</div>';
  html += '<div style="font-size:.85rem;overflow-x:auto"><table style="width:100%;border-collapse:collapse">';
  html += '<tr style="border-bottom:1px solid var(--line)"><th style="text-align:left;padding:6px;font-weight:bold">Person</th>';
  html += '<th style="text-align:center;padding:6px;font-weight:bold">Gesamt</th><th style="text-align:center;padding:6px;font-weight:bold">Türme</th>';
  html += '<th style="text-align:left;padding:6px;font-weight:bold">Details</th></tr>';
  people.forEach(p => {
    const stat = lastResult.stats[p.id];
    if(!stat) return;
    const cnt = Object.keys(stat.towerVisits||{}).length;
    const deets = Object.entries(stat.towerVisits||{}).sort(([a],[b])=>(tMap[b]?.prio||0)-(tMap[a]?.prio||0))
      .map(([tid,c])=>(tMap[tid]?.name||`T${tid}`)+'('+c+')').join(', ');
    html += `<tr style="border-bottom:1px solid var(--line-strong)"><td style="padding:6px">${escapeHtml(p.name)}</td>`;
    html += `<td style="text-align:center;padding:6px">${stat.total}</td><td style="text-align:center;padding:6px;color:${cnt>=threshold?'var(--green)':'var(--warn)'};font-weight:bold">${cnt}</td>`;
    html += `<td style="padding:6px;font-size:.75rem;color:var(--text-dim)">${escapeHtml(deets)}</td></tr>`;
  });
  html += '</table></div>';
  return html;
}

/** Paarungs-Matrix. */
function renderMatrix(){
  const g = lastResult.peopleGuards;
  if(g.length < 2 || g.length > 18) return '';
  let h = `<div class="section-label" style="margin-top:30px;">Paarungs-Matrix
    <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-dim);font-size:11px">
      (wie oft zwei Personen über alle Tage zusammen am Turm)
    </span></div>
    <div class="matrix-wrap"><table class="matrix"><tr><th></th>`;
  g.forEach(p => h += `<th>${escapeHtml(p.name.slice(0,6))}</th>`);
  h += '</tr>';
  g.forEach(a => {
    h += `<tr><th class="rowh">${escapeHtml(a.name.slice(0,8))}</th>`;
    g.forEach(b => {
      if(a.id===b.id){ h+=`<td class="self">—</td>`; return; }
      const v = lastResult.pairCount[[a.id,b.id].sort((x,y)=>x-y).join('|')]||0;
      h += `<td class="${v===0?'zero':v===1?'one':'multi'}">${v}</td>`;
    });
    h += '</tr>';
  });
  return h + '</table></div>';
}
