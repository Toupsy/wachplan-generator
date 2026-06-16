// ============================================================
// render-output.js – Hauptbereich: Tages-Ansicht + Matrix
// ============================================================

// Merkt sich, welche Tages-Steuerungs-Sektionen aufgeklappt sind (UI-only, pro Sektionstyp).
// Überdauert die innerHTML-Neuaufbauten bei jeder generate()/renderOutput(), damit eine
// gerade geöffnete Sektion nach einem Klick nicht wieder zuklappt. Default: alles zu.
const dcSectionOpen = {};

/**
 * Rendert eine einklappbare Sektion der Tages-Steuerung als <details>/<summary>.
 * @param {string} key   eindeutiger Sektionstyp (z. B. 'sick') → Auf/Zu-Zustand wird gemerkt
 * @param {string} label HTML des Titels (kommt in das .lbl-Element)
 * @param {string} body  HTML des aufklappbaren Inhalts (z. B. die toggle-grid)
 * @param {number} count Anzahl aktiver Einträge → als Badge neben dem Titel (0 = keins)
 */
function dcSection(key, label, body, count){
  const open  = dcSectionOpen[key] ? ' open' : '';
  const badge = count > 0 ? `<span class="dc-count">${count}</span>` : '';
  return `<details class="dc-section" data-dc-section="${key}"${open}>
      <summary class="dc-summary"><span class="lbl">${label}</span>${badge}</summary>
      ${body}
    </details>`;
}

/** Rendert den kompletten Ausgabe-Bereich neu. */
function renderOutput(){
  // Sicherstelle dass dayState korrekt initialisiert ist
  if(!dayState || dayState.length === 0){
    dayState = Array.from({ length: DAYS }, () => ({
      sick: new Set(),
      absent: new Set(),
      closed: new Set(),
      closedBoats: new Set()
    }));
  }
  while(dayState.length < DAYS){
    dayState.push({ sick: new Set(), absent: new Set(), closed: new Set(), closedBoats: new Set() });
  }

  const panel = document.getElementById('output-panel');
  if(!lastResult) return;
  // Beobachter-Modus: aktueller Plan ist nur mit Leserechten geteilt (share-role 'view').
  // → minimalistische Ansicht ohne Sidebar/Editier-UI (s. body.view-only CSS).
  const viewOnly = (typeof currentPlanCanEdit !== 'undefined' && currentPlanCanEdit === false);
  let { schedule } = lastResult;

  // ── Wende transparent placements visuell an (ohne generate()) ────
  // Für Case 1: Personen VISUELL verschieben, aber Plan bleibt unverändert.
  // Zusätzlich: dediziertes hwBoatSlot → uniformer Boot-Slot (towerId='HW'),
  // damit ALLE Boote gleich behandelt werden (Inline-Render + D&D in beide Richtungen).
  schedule = schedule.map((day, dayIdx) => {
    const dayForcedTransparent = (forcedPlacements[dayIdx] || []).filter(f => f.transparent);

    // Immer klonen (auch ohne Placements) für die HW-Boot-Normalisierung.
    const dayClone = JSON.parse(JSON.stringify(day));

    // 1) Personen-Transparent-Placements
    dayForcedTransparent.forEach(f => {
      if(f.kind === 'boat-reassign') return;  // Boote separat (Schritt 3)
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

    // 2) Normalisiere dediziertes hwBoatSlot → Boot-Slot mit towerId='HW'
    const mainSlot = dayClone.assign.find(s => s.kind === 'main');
    if(mainSlot && mainSlot.hwBoatSlot){
      const hb = mainSlot.hwBoatSlot;
      const bObj = boats.find(b => b.id === hb.boatId);
      dayClone.assign.push({
        kind:'boat', boatId:hb.boatId, name:hb.name, code:hb.code,
        prio: bObj?.prio ?? 0, towerId:'HW', towerName:'Hauptwache',
        occupants: hb.bootsf ? [hb.bootsf] : [], bootsf: hb.bootsf || null
      });
      mainSlot.hwBoatSlot = null;
    }

    // 3) Boot-Reassignments (uniform: nur towerId ändern; 'HW' für Hauptwache)
    dayForcedTransparent.filter(f => f.kind === 'boat-reassign').forEach(f => {
      const boatSlot = dayClone.assign.find(s => s.kind === 'boat' && s.boatId === f.boatId);
      if(!boatSlot) return;
      if(f.targetKind === 'tower') {
        boatSlot.towerId = f.targetSlotId;
        boatSlot.towerName = towers.find(t => t.id === f.targetSlotId)?.name || '';
      } else if(f.targetKind === 'main' || f.targetKind === 'hwboat') {
        boatSlot.towerId = 'HW';
        boatSlot.towerName = 'Hauptwache';
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
    if(s.occupants?.length===2 && (effLevel(s.occupants[0])+effLevel(s.occupants[1]))==='UU') uuTotal++;
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
  const dayTabsHtml = schedule.map((d,i) => {
    const flags = [];
    if(d.sickCount > 0)            flags.push('🤒');
    if(d.absentCount > 0)          flags.push('👋');
    if(d.manualClosed.length > 0)  flags.push('⛔');
    return `<button class="day-tab ${i===activeDay?'active':''}" data-day="${i}">${dayLabel(i)}${flags.length?`<span class="flag">${flags.join('')}</span>`:''}</button>`;
  }).join('');

  let html;
  if(viewOnly){
    // Beobachter: schlanke Kopfzeile (Plan-Name, Tag-Navigation, Pläne wechseln, Abmelden).
    html = `
    <div class="vo-bar">
      <div class="vo-title">👁 ${escapeHtml(typeof currentPlanName !== 'undefined' ? currentPlanName : 'Wachplan')} <span class="vo-badge">Nur Ansicht</span></div>
      <div class="vo-actions">
        <button class="ghost-btn" id="vo-plans" style="border-color:var(--sea-bright);color:var(--sea-bright)">📋 Pläne</button>
        <button class="ghost-btn" id="vo-logout" style="border-color:var(--coral);color:var(--coral)">🚪 Abmelden</button>
      </div>
    </div>
    <div class="out-header">
      <div>
        <div class="section-label" style="margin-bottom:8px;">Turmbesetzungen · ${DAYS} Tage</div>
        <div class="day-tabs">${dayTabsHtml}</div>
      </div>
    </div>`;
  } else {
    html = `
    <div class="out-header">
      <div>
        <div class="section-label" style="margin-bottom:8px;">Wachplan · ${DAYS} Tage · sukzessiv</div>
        <div class="day-tabs">${dayTabsHtml}</div>
      </div>
      <div class="export-row">
        <button class="ghost-btn" id="btn-official" style="border-color:var(--warn);color:var(--warn)">📋 XLSX (${dayLabel(activeDay)})</button>
        <button class="ghost-btn" id="btn-csv">↓ CSV</button>
        <button class="ghost-btn" id="btn-export-stats-csv">📊 Statistik (CSV)</button>
        <button class="ghost-btn" id="btn-print-all">🖨️ Alle Tage drucken</button>
        <button class="ghost-btn" id="btn-print-day">🖨️ Diesen Tag drucken</button>
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
  }

  // ── Tages-Panels ──────────────────────────────────────────────
  schedule.forEach((d, di) => {
    const dayForced = forcedPlacements[di] || [];
    const forcedIds = new Set(dayForced.map(f => f.personId));
    const dayLabelTxt = dayLabel(di);

    html += `<div class="day-panel ${di===activeDay?'active':''}" id="day-panel-${di}" style="display:${di===activeDay?'block':'none'}" data-panel="${di}" data-panel-name="Tag ${di + 1} - ${dayLabelTxt}" data-day-index="${di}">`;

    // Beobachter-Modus: kompakter Tages-Header (Datum statt Editier-Steuerung)
    if(viewOnly){
      const _vd = computeDayDates()[di];
      html += `<div class="vo-day-head"><span class="dc-title">${dayLabel(di)}</span>${_vd?`<span class="vo-date">📅 ${_vd}</span>`:''}</div>`;
    } else {
    // Tages-Steuerung
    html += `<div class="day-controls">
      <div class="dc-head">
        <div><span class="dc-title">${dayLabel(di)}</span> <span class="dc-sub">— Status nur für diesen Tag</span></div>
        <div class="date-pick"><label>📅 Datum</label>
          <input type="date" value="${computeDayDates()[di]||''}" readonly title="Aus Startdatum berechnet"></div>
      </div>
      ${dcSection('sick',
        '🚫 Außer Dienst melden <span style="text-transform:none;letter-spacing:0;color:var(--text-dim)">(wird an der Hauptwache geführt)</span>',
        `<div class="toggle-grid">
          ${people.map(p=>`<span class="toggle-chip ${dayState[di].sick.has(p.id)?'sick':''}" data-sick="${p.id}" data-day="${di}">
            <i class="role-dot rd-${roleDot(p)}"></i><span class="nm">${escapeHtml(p.name)}</span>
            ${dayState[di].sick.has(p.id)?'<span class="x">a. D.</span>':''}</span>`).join('')}
        </div>`,
        dayState[di].sick.size)}
      ${dcSection('absent',
        '👋 Komplett abwesend <span style="text-transform:none;letter-spacing:0;color:var(--text-dim)">(nicht im Plan, Export & Druck)</span>',
        `<div class="toggle-grid">
          ${people.map(p=>`<span class="toggle-chip ${dayState[di].absent.has(p.id)?'absent':''}" data-absent="${p.id}" data-day="${di}">
            <i class="role-dot rd-${roleDot(p)}"></i><span class="nm">${escapeHtml(p.name)}</span>
            ${dayState[di].absent.has(p.id)?'<span class="x">abw.</span>':''}</span>`).join('')}
        </div>`,
        dayState[di].absent.size)}
      ${dcSection('closet',
        '⛔ Turm schließen',
        `<div class="toggle-grid">
          ${towers.map(t=>`<span class="toggle-chip ${dayState[di].closed.has(t.id)?'closed-t':''}" data-closet="${t.id}" data-day="${di}">
            🗼 <span class="nm">${escapeHtml(t.name)}</span>
            ${dayState[di].closed.has(t.id)?'<span class="x">ZU</span>':''}</span>`).join('')}
        </div>`,
        dayState[di].closed.size)}
      ${boats.length ? dcSection('closeb',
        '🚤 Boot außer Dienst',
        `<div class="toggle-grid">
          ${boats.map(b=>`<span class="toggle-chip ${dayState[di].closedBoats.has(b.id)?'closed-t':''}" data-closeb="${b.id}" data-day="${di}">
            🚤 <span class="nm">${escapeHtml(b.name)}</span>
            ${dayState[di].closedBoats.has(b.id)?'<span class="x">ZU</span>':''}</span>`).join('')}
        </div>`,
        dayState[di].closedBoats.size) : ''}
      ${dayForced.length ? dcSection('forced',
        '<span style="color:var(--warn)">🔒 Manuelle Zuweisungen aktiv</span>',
        `<div class="toggle-grid">
          ${dayForced.map(f=>{
            const p=getP(f.personId); if(!p) return '';
            let dest = f.kind==='tower' ? `🗼 ${escapeHtml(getT(f.slotId)?.name||'?')}` :
                       f.kind==='boat'  ? `🚤 ${escapeHtml(getBoat(f.slotId)?.name||'?')}` : '⛱ HW';
            return `<span class="toggle-chip" style="border-color:var(--warn)">
              🔒 ${escapeHtml(p.name)} → ${dest}
              <span class="x" data-clear-forced="${f.personId}" data-clear-day="${di}" style="cursor:pointer">✕</span>
            </span>`;
          }).join('')}
        </div>
        <button class="add-btn" style="margin-top:6px;border-color:rgba(255,179,71,0.4);color:var(--warn)"
          data-clear-all-day="${di}">Alle Fixierungen heute aufheben</button>`,
        dayForced.length) : ''}
    </div>`;
    }

    // Warn-Notices
    if(d.manualClosed.length)
      html+=`<div class="notice bad">⛔ <div>Manuell geschlossen: <strong>${d.manualClosed.map(t=>escapeHtml(t.name)).join(', ')}</strong></div></div>`;
    if(d.personnelClosed.length)
      html+=`<div class="notice bad">⚠️ <div>Personalmangel – geschlossen: <strong>${d.personnelClosed.map(t=>escapeHtml(t.name)).join(', ')}</strong></div></div>`;
    if(d.boatsManualClosed.length)
      html+=`<div class="notice bad">🚤 <div>a. D.: <strong>${d.boatsManualClosed.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    if(d.boatsClosedTower.length)
      html+=`<div class="notice warn-n">🚤 <div>Boot zu (Turm zu): <strong>${d.boatsClosedTower.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    if(d.boatsNoBootsf.length)
      html+=`<div class="notice warn-n">🚤 <div>Boot zu (kein BF): <strong>${d.boatsNoBootsf.map(b=>escapeHtml(b.name)).join(', ')}</strong></div></div>`;
    // Beobachter-Modus: UU-Hinweis ausblenden (Erfahrungs-Einstufung nicht offenlegen).
    const uuToday = viewOnly ? 0 : d.assign.filter(s=>s.kind==='tower'&&s.occupants.length===2&&(effLevel(s.occupants[0])+effLevel(s.occupants[1]))==='UU').length;
    if(uuToday>0) html+=`<div class="notice warn-n">⚠️ <div>${uuToday}× zwei Unerfahrene auf einem Turm.</div></div>`;

    // ── Karten ─────────────────────────────────────────────────
    // Map: towerId → [Boot-Slots] (Boote werden INLINE im Turm gerendert, wie HW-Boot)
    const boatsByTower = {};
    d.assign.forEach(s => {
      if(s.kind === 'boat' && s.towerId){
        (boatsByTower[s.towerId] = boatsByTower[s.towerId] || []).push(s);
      }
    });

    // Einheitlicher Occupant-Renderer (Turm, Boot, Hauptwache).
    // label=null → Standardrolle ROLE[p.role]. data-move-slot nutzt slotId||''
    // (MAIN_ID=0 → '' wie zuvor; Move-Modal behandelt HW gesondert).
    const renderOccupant = (p, label, kind, slotId) => {
      const labels = (p.enableLabels && (p.labels||'').trim().length > 0)
        ? (p.labels||'').trim()
          .split(',')
          .map(l => l.trim())
          .filter(l => l)
        : [];
      const labelText = labels.length > 0 ? ' - <span class="person-labels">' + labels.map(l => `<span class="label-tag">${escapeHtml(l)}</span>`).join(' ') + '</span>' : '';
      // Beobachter-Modus: Erfahrung (erfahren/unerfahren) nicht erkennbar machen –
      // weder über die Punkt-Farbe noch über das Label.
      const dotCls  = viewOnly ? roleDotSafe(p) : roleDot(p);
      const roleTxt = label || (viewOnly ? roleLabelSafe(p) : roleLabel(p));
      return `
          <div class="occupant" draggable="${viewOnly?'false':'true'}" data-person-id="${p.id}" data-source-kind="${kind}" data-source-slot="${slotId}">
            <i class="role-dot rd-${dotCls}"></i>${escapeHtml(p.name)}${labelText}
            ${forcedIds.has(p.id)?'<span class="forced-badge" title="Manuell fixiert">🔒</span>':''}
            <span class="o-role">${roleTxt}</span>
            ${viewOnly?'':`<button class="move-btn" data-move-person="${p.id}" data-move-day="${di}"
              data-move-kind="${kind}" data-move-slot="${slotId||''}" title="Verschieben">↕</button>`}
          </div>`;
    };

    // Inline-Boot-Renderer (wie HW-Boot in der Hauptwache)
    const renderInlineBoat = (bsList) => {
      if(!bsList || !bsList.length) return '';
      return bsList.map(bs => `
        <div class="hq-divider boat-inline" id="boat-inline-${di}-${bs.boatId}" draggable="true" data-boat-id="${bs.boatId}" data-boat-name="${escapeHtml(bs.name)}" data-boat-code="${escapeHtml(bs.code||'?')}" data-panel-name="Boot: ${escapeHtml(bs.name)}" title="Ziehen um Boot auf anderen Turm/HW zu verschieben">🚤 Boot: ${escapeHtml(bs.name)} · ${escapeHtml(bs.code||'?')}</div>
        ${(bs.occupants && bs.occupants.length)
          ? bs.occupants.map(p => renderOccupant(p, 'Bootsführer', 'boat', bs.boatId)).join('')
          : '<div style="color:var(--coral);font-size:.78rem;padding:6px 0">⚠ Kein Bootsführer verfügbar</div>'}`).join('');
    };

    html += `<div class="towers-grid">`;
    d.assign.forEach(slot => {
      // Boot-Slots werden inline im Turm gerendert → hier überspringen
      if(slot.kind === 'boat') return;
      // ─ Hauptwache ─
      if(slot.kind === 'main'){
        html += `<div class="tower-card main" id="card-main-${di}" style="grid-column:span 2;" data-drop-kind="main" data-drop-slot="${MAIN_ID}" data-panel-name="Hauptwache" data-card-type="main">
          <div class="tc-head" draggable="true" style="cursor:grab" data-card-kind="main" data-card-slot="${MAIN_ID}" title="Zum Sortieren ziehen"><span class="tc-name">⛱ ${slot.tower}</span><span class="tc-type main">Zentrale · k=${slot.k}</span></div>
          ${slot.fuehrung.map(p=>renderOccupant(p,'Führung','main',MAIN_ID)).join('')}
          ${slot.mainGuards.map(p=>renderOccupant(p,viewOnly?'Hauptwache':(p.experienced?'Erfahren · HW':'Unerf. · HW'),'main',MAIN_ID)).join('')}
          ${slot.base.map(p=>renderOccupant(p,viewOnly?'Hauptwache':(p.experienced?'Erfahren · HW':'Unerf. · HW'),'main',MAIN_ID)).join('')}
          ${slot.bootsfLeft.map(p=>renderOccupant(p,'Bootsführer · HW','main',MAIN_ID)).join('')}
          ${renderInlineBoat(boatsByTower['HW'])}
          ${slot.sick.map(p=>`<div class="occupant" style="opacity:.55"><i class="role-dot rd-${viewOnly?roleDotSafe(p):roleDot(p)}"></i><span style="text-decoration:line-through">${escapeHtml(p.name)}</span><span class="o-role" style="color:var(--coral)">außer Dienst</span></div>`).join('')}
        </div>`;
      }
      // ─ Turm (inkl. inline Boot, falls vorhanden) ─
      else if(slot.kind === 'tower'){
        html += `<div class="tower-card" id="card-tower-${di}-${slot.towerId}" data-drop-kind="tower" data-drop-slot="${slot.towerId}" data-panel-name="Turm: ${escapeHtml(slot.tower)}" data-card-type="tower" data-tower-id="${slot.towerId}">
          <div class="tc-head" draggable="true" style="cursor:grab" data-card-kind="tower" data-card-slot="${slot.towerId}" title="Zum Sortieren ziehen"><span class="tc-name">🗼 ${escapeHtml(slot.tower)}</span><span class="tc-type normal">${slot.mainBeach?'🏖️ ':''}Turm · ${escapeHtml(slot.code||'?')} · P${slot.prio}</span></div>
          ${slot.occupants.map(p=>renderOccupant(p, null, 'tower', slot.towerId)).join('')}
          ${(!viewOnly && slot.warn)?`<div class="warn-pair">⚠ ${slot.warn}</div>`:''}
          ${renderInlineBoat(boatsByTower[slot.towerId])}
        </div>`;
      }
    });

    // Geschlossene Türme & Boote (mit data-drop für Override)
    // personnelClosed kommt bereits nach Prio sortiert aus generate.js
    [...d.manualClosed,...d.personnelClosed].forEach(t => {
      const reason = d.manualClosed.includes(t)?'manuell geschlossen':'Personalmangel';
      html += `<div class="tower-card closed" id="card-tower-closed-${di}-${t.id}" data-drop-kind="tower" data-drop-slot="${t.id}" data-closed-override="true" data-panel-name="Turm: ${escapeHtml(t.name)} (geschlossen)" data-card-type="tower-closed" data-tower-id="${t.id}"><div class="tc-head" draggable="true" style="cursor:grab" data-card-kind="tower" data-card-slot="${t.id}" title="Zum Sortieren ziehen"><span class="tc-name">🗼 ${escapeHtml(t.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });
    [...d.boatsManualClosed,...d.boatsClosedTower,...d.boatsNoBootsf].forEach(b => {
      const reason = d.boatsManualClosed.includes(b)?'manuell außer Dienst':d.boatsClosedTower.includes(b)?'Turm zu':'kein Bootsführer';
      html += `<div class="tower-card closed boot" id="card-boat-closed-${di}-${b.id}" data-panel-name="Boot: ${escapeHtml(b.name)} (außer Dienst)" data-card-type="boat-closed" data-boat-id="${b.id}"><div class="tc-head" draggable="true" style="cursor:grab" data-card-kind="boat" data-card-slot="${b.id}" title="Zum Sortieren ziehen"><span class="tc-name">🚤 ${escapeHtml(b.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });

    html += `</div></div>`;
  });

  // Zusatz-Auswertungen (im Druck ausgeblendet via .out-extras; im Beobachter-Modus weggelassen)
  if(!viewOnly)
    html += `<div class="out-extras">${renderFairnessCharts()}${renderTowerStatsPerPerson()}${renderBoatStatsPerPerson()}${renderMatrix()}</div>`;
  panel.innerHTML = html;

  // ── Event-Listener ─────────────────────────────────────────────
  panel.querySelectorAll('.day-tab').forEach(t =>
    t.onclick = e => { activeDay = +e.currentTarget.dataset.day; renderOutput(); });

  // Beobachter-Modus: nur Plan-Wechsel + Abmelden, keine Editier-/Drag&Drop-Listener.
  if(viewOnly){
    const vp = document.getElementById('vo-plans');
    if(vp) vp.onclick = () => { if(typeof openPlansModal === 'function') openPlansModal(); };
    const vl = document.getElementById('vo-logout');
    if(vl) vl.onclick = () => { if(typeof logout === 'function') logout(); };
    return;
  }

  // Auf-/Zuklapp-Zustand der Tages-Steuerungs-Sektionen merken (überdauert Re-Renders)
  panel.querySelectorAll('details[data-dc-section]').forEach(dt =>
    dt.addEventListener('toggle', () => { dcSectionOpen[dt.dataset.dcSection] = dt.open; }));

  const togSets = [
    // exclusive: beim Aktivieren wird die jeweils andere Personen-Markierung entfernt
    //   (eine Person ist entweder "außer Dienst" ODER "komplett abwesend", nicht beides).
    { sel: '[data-sick]',    key: 'sick',        getter: d => dayState[d].sick,        exclusive: d => dayState[d].absent },
    { sel: '[data-absent]',  key: 'absent',      getter: d => dayState[d].absent,      exclusive: d => dayState[d].sick },
    { sel: '[data-closet]',  key: 'closet',      getter: d => dayState[d].closed },
    { sel: '[data-closeb]',  key: 'closeb',      getter: d => dayState[d].closedBoats },
  ];
  togSets.forEach(({ sel, key, getter, exclusive }) => {
    panel.querySelectorAll(sel).forEach(el =>
      el.onclick = e => {
        const id = +e.currentTarget.dataset[key], day = +e.currentTarget.dataset.day;
        const s = getter(day);
        if(s.has(id)){
          s.delete(id);
        } else {
          s.add(id);
          if(exclusive) exclusive(day).delete(id);
        }
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
  // Wichtig: AKTIVES Panel-Grid nehmen, nicht das erste im DOM (das wäre Tag 1)
  const grid = panel.querySelector(`.day-panel[data-panel="${activeDay}"] .towers-grid`);
  let dragSrc = null;
  let dragCardSrc = null;  // Für Card-zu-Card Sortierung
  let cardDragMode = null; // 'insert' | 'swap' (vorher impliziter Global)

  grid.addEventListener('dragstart', e => {
    // Option 1: Person drag
    const occ = e.target.closest('.occupant');
    if(occ) {
      dragSrc = {
        personId: +occ.dataset.personId,
        kind: occ.dataset.sourceKind,
        slot: +occ.dataset.sourceSlot || 0
      };
      occ.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', dragSrc.personId);
      return;
    }

    // Option 2: Boot drag (inline Boot-Divider)
    const boatLink = e.target.closest('.boat-inline');
    if(boatLink && boatLink.dataset.boatId) {
      dragSrc = {
        boatId: +boatLink.dataset.boatId,
        boatName: boatLink.dataset.boatName,
        boatCode: boatLink.dataset.boatCode,
        isBoat: true
      };
      boatLink.style.opacity = '0.4';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `boat-${dragSrc.boatId}`);
      return;
    }

    // Option 3: Card-Head drag (für Sortierung)
    const head = e.target.closest('.tc-head');
    if(head && head.dataset.cardKind) {
      dragCardSrc = {
        kind: head.dataset.cardKind,
        slot: head.dataset.cardSlot
      };
      head.style.opacity = '0.5';
      e.dataTransfer.effectAllowed = 'move';
      e.dataTransfer.setData('text/plain', `card-${dragCardSrc.kind}-${dragCardSrc.slot}`);
    }
  });

  grid.addEventListener('dragover', e => {
    e.preventDefault();
    e.dataTransfer.dropEffect = 'move';
    const card = e.target.closest('.tower-card');
    if(!card) return;

    // Wenn Boot-Drag: gelbe Highlight
    if(dragSrc && dragSrc.isBoat && !dragCardSrc) {
      if(!card.classList.contains('closed')) {
        card.style.backgroundColor = 'rgba(255,179,71,0.15)';
        card.style.borderColor = 'var(--warn)';
      }
      return;
    }

    // Wenn Personen-Drag: einfach Highlight (closedOverride oder normal)
    if(dragSrc && !dragSrc.isBoat && !dragCardSrc) {
      if(card.dataset.closedOverride) {
        card.style.backgroundColor = 'rgba(255,165,0,0.15)';
        card.style.borderColor = 'var(--warn)';
      } else if(!card.classList.contains('closed')) {
        card.style.backgroundColor = 'rgba(24,168,216,0.15)';
        card.style.borderColor = 'var(--sea-bright)';
      }
      return;
    }

    // Wenn Card-Drag: Y-Position prüfen für Insert vs Swap
    if(dragCardSrc && dragCardSrc.kind) {
      const rect = card.getBoundingClientRect();
      const midpoint = rect.top + rect.height / 2;
      const isInsertZone = e.clientY < midpoint;

      if(isInsertZone) {
        cardDragMode = 'insert';
        card.style.borderTop = '3px solid var(--green)';
        card.style.backgroundColor = '';
        card.style.borderColor = '';
      } else {
        cardDragMode = 'swap';
        card.style.borderTop = '';
        card.style.backgroundColor = 'rgba(24,168,216,0.15)';
        card.style.borderColor = 'var(--sea-bright)';
      }
    }
  });

  grid.addEventListener('dragleave', e => {
    const card = e.target.closest('.tower-card');
    if(card) {
      card.style.backgroundColor = '';
      card.style.borderColor = '';
      card.style.borderTop = '';
    }
  });

  grid.addEventListener('drop', e => {
    e.preventDefault();
    const card = e.target.closest('.tower-card');
    if(!card) return;

    // Prüfe ob Card-Sortierung (nur wenn dragCardSrc gesetzt, nicht dragSrc)
    // Jeder Karten-Typ kann mit jedem anderen getauscht werden
    if(dragCardSrc && dragCardSrc.kind) {
      // Card-Sortierung: DOM-Reordering mit Insert/Swap
      const srcCard = grid.querySelector(`[data-card-slot="${dragCardSrc.slot}"]`)?.closest('.tower-card');
      if(srcCard && srcCard !== card) {
        if(cardDragMode === 'swap') {
          // Tauschen: card und srcCard ihren Platz tauschen
          const temp = document.createElement('div');
          srcCard.parentNode.insertBefore(temp, srcCard);
          card.parentNode.insertBefore(srcCard, card);
          temp.parentNode.insertBefore(card, temp);
          temp.remove();
        } else {
          // Insert: srcCard vor card einfügen
          srcCard.remove();
          card.parentNode.insertBefore(srcCard, card);
        }
      }
      dragCardSrc = null;
      cardDragMode = null;
      grid.querySelectorAll('.tower-card').forEach(c => {
        c.style.backgroundColor = '';
        c.style.borderColor = '';
        c.style.borderTop = '';
      });
      return;
    }

    if(!dragSrc) return;

    // Boot-Drop: Reassign Boot zu Turm/HW für heute
    if(dragSrc.isBoat) {
      const boatId = dragSrc.boatId;
      const boat = boats.find(b => b.id === boatId);
      const clearCard = () => { card.style.backgroundColor = ''; card.style.borderColor = ''; };
      if(!boat) {
        clearCard();
        dragSrc = null;
        return;
      }

      const targetKind = card.dataset.dropKind;
      const targetSlot = +card.dataset.dropSlot;

      // Validierung
      if(!['tower', 'main', 'hwboat'].includes(targetKind)) {
        clearCard();
        dragSrc = null;
        return;
      }

      // Effektiven aktuellen Turm bestimmen (inkl. bestehender Reassignments)
      const dayData = lastResult.schedule[activeDay];
      const existingReassign = (forcedPlacements[activeDay] || []).find(f => f.kind === 'boat-reassign' && f.boatId === boatId);
      let currentTowerId, currentTowerName;
      if(existingReassign){
        currentTowerId = existingReassign.targetKind === 'tower' ? existingReassign.targetSlotId : 'HW';
        currentTowerName = currentTowerId === 'HW' ? 'Hauptwache' : (getT(currentTowerId)?.name || '?');
      } else {
        const boatSlot = dayData.assign.find(s => s.kind === 'boat' && s.boatId === boatId);
        if(boatSlot){
          currentTowerId = boatSlot.towerId;
          currentTowerName = boatSlot.towerName || '?';
        }
      }

      // Same-Target-Guard: Boot ist bereits auf Zielstation
      const targetIsHW = (targetKind === 'main' || targetKind === 'hwboat');
      if((targetKind === 'tower' && currentTowerId === targetSlot) ||
         (targetIsHW && currentTowerId === 'HW')) {
        clearCard();
        dragSrc = null;
        return;
      }

      // Zielname bestimmen
      let targetName = '';
      if(targetKind === 'tower') {
        const tower = getT(targetSlot);
        targetName = tower?.name || '?';
      } else if(targetIsHW) {
        targetName = 'Hauptwache';
      }

      showConfirmation(
        `🚤 ${boat.name} (${boat.code || '?'}) von ${currentTowerName} zu ${targetName} verschieben? (nur heute)`,
        () => {
          _applyBoatReassignment(boatId, activeDay, targetKind, targetSlot);
          renderOutput();
          showToast(`✅ 🚤 ${boat.name} → ${targetName}`);
        },
        clearCard,
        false
      );

      dragSrc = null;
      clearCard();
      return;
    }

    const targetKind = card.dataset.dropKind;
    const targetSlot = +card.dataset.dropSlot;

    // dragSrc VOR dem Modal-Aufruf sichern!
    // dragend feuert (async) sobald die Maus losgelassen wird → setzt dragSrc = null.
    // Da showConfirmation ein Modal öffnet, ist dragSrc beim Bestätigen bereits null.
    const srcPersonId = dragSrc.personId;
    const srcKind     = dragSrc.kind;
    const srcSlot     = dragSrc.slot;

    const clearCard = () => { card.style.backgroundColor = ''; card.style.borderColor = ''; };

    // Geschlossener Turm: Direkte Modifikation + optional Neuberechnung
    if(card.dataset.closedOverride) {
      const towerId = +card.dataset.dropSlot;
      const tower = getT(towerId);
      const person = getP(srcPersonId);

      const confirmMsg = `🔒 Turm "${tower?.name || '?'}" ist geschlossen. Für heute öffnen und ${person?.name || 'Person'} dorthin verschieben?`;

      showConfirmation(
        confirmMsg,
        (recalcFuture) => {
          const oldBefore = lastResult.schedule.slice(0, activeDay).map(d => JSON.parse(JSON.stringify(d)));
          const dayData = lastResult.schedule[activeDay];

          // 1. Turm öffnen (aus closed entfernen)
          dayState[activeDay].closed.delete(towerId);

          // 2. Wenn Turm KEINEN Slot in assign hat (weil er geschlossen war), einen erstellen
          const existingSlot = dayData.assign.find(s => s.kind === 'tower' && s.towerId === towerId);
          if(!existingSlot) {
            const towerObj = getT(towerId);
            dayData.assign.push({
              kind: 'tower',
              towerId: towerId,
              tower: towerObj?.name || `Turm ${towerId}`,
              code: towerObj?.code || '?',
              prio: towerObj?.prio || 99,
              occupants: [],
              warn: null
            });
          }

          // 3. Person direkt ins Schedule einfügen
          _applyMoveToSchedule(srcPersonId, activeDay, 'tower', towerId);

          if(recalcFuture) {
            // Case 2: Folgetage neu berechnen
            _applyMove(srcPersonId, activeDay, 'tower', towerId, true);
            const newFuture = lastResult.schedule.slice(activeDay + 1);
            generate(activeDay + 1);
            // Falls generate() die bereits geöffneten Türme vergessen hat, vorher sichern
          } else {
            // Case 1: Nur transparent, kein generate
            _applyMove(srcPersonId, activeDay, 'tower', towerId, false);
          }

          renderOutput();
          clearCard();
        },
        clearCard,
        true  // Checkbox: "Folgetage neu berechnen"
      );
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
      ? `${p.name} ist ${roleLabel(p)}, nicht Bootsführer. Trotzdem zum Boot verschieben?`
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

    const boatLink = e.target.closest('.boat-inline');
    if(boatLink) boatLink.style.opacity = '';

    const head = e.target.closest('.tc-head');
    if(head) head.style.opacity = '';

    dragSrc = null;
    dragCardSrc = null;
  });

  document.getElementById('btn-csv').onclick   = exportCSV;
  document.getElementById('btn-export-stats-csv').onclick = exportStatsCSV;

  // Print button handlers - two modes: all days vs. single day
  const btnPrintAll = document.getElementById('btn-print-all');
  const btnPrintDay = document.getElementById('btn-print-day');

  if(btnPrintAll) {
    btnPrintAll.onclick = () => {
      document.body.classList.remove('print-single-day');
      window.print();
    };
  }

  if(btnPrintDay) {
    btnPrintDay.onclick = () => {
      document.body.classList.add('print-single-day');
      window.print();
      // Remove class after print dialog closes (user may cancel)
      setTimeout(() => document.body.classList.remove('print-single-day'), 100);
    };
  }

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

/** Boat & BF Fairness Distribution */
function renderBoatStatsPerPerson(){
  if(!lastResult?.stats) return '';
  const bMap = {}; boats.forEach(b => bMap[b.id] = b);
  const bfOnlyStats = Object.entries(lastResult.stats)
    .filter(([pid, stat]) => Object.values(stat.boatVisits||{}).reduce((a,b)=>a+b,0) > 0)
    .map(([pid, stat]) => ({ pid: +pid, stat }));

  if(bfOnlyStats.length === 0) return '';

  let html = '<div class="section-label" style="margin-top:30px;">Boot & Bootsführer-Fairness</div>';
  html += '<div style="font-size:.85rem;overflow-x:auto"><table style="width:100%;border-collapse:collapse">';
  html += '<tr style="border-bottom:1px solid var(--line)"><th style="text-align:left;padding:6px;font-weight:bold">Bootsführer</th>';
  html += '<th style="text-align:center;padding:6px;font-weight:bold">Boot-Tage</th><th style="text-align:center;padding:6px;font-weight:bold">Verschiedene Boote</th>';
  html += '<th style="text-align:left;padding:6px;font-weight:bold">Boot-Details</th></tr>';

  const threshold = boats.length * 0.5;
  bfOnlyStats.forEach(({ pid, stat }) => {
    const person = people.find(p => p.id === pid);
    if(!person) return;
    const cnt = Object.keys(stat.boatVisits||{}).length;
    const total = Object.values(stat.boatVisits||{}).reduce((a,b)=>a+b,0);
    const deets = Object.entries(stat.boatVisits||{}).sort(([a],[b])=>bMap[b]?.prio-bMap[a]?.prio)
      .map(([bid,c])=>(bMap[bid]?.name||`B${bid}`)+'('+c+')').join(', ');
    html += `<tr style="border-bottom:1px solid var(--line-strong)"><td style="padding:6px">${escapeHtml(person.name)}</td>`;
    html += `<td style="text-align:center;padding:6px">${total}</td><td style="text-align:center;padding:6px;color:${cnt>=threshold?'var(--green)':'var(--warn)'};font-weight:bold">${cnt}</td>`;
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

/** Wendet Boot-Reassignment an (für D&D im Schedule). */
function _applyBoatReassignment(boatId, dayIdx, kind, slotId){
  if(!forcedPlacements[dayIdx]) forcedPlacements[dayIdx] = [];

  // Entferne bestehende Boot-Reassignment für dieses Boot
  forcedPlacements[dayIdx] = forcedPlacements[dayIdx].filter(f => f.boatId !== boatId);

  // Füge neue Boot-Reassignment hinzu (immer transparent für D&D)
  forcedPlacements[dayIdx].push({
    boatId,
    kind: 'boat-reassign',
    targetKind: kind,
    targetSlotId: slotId,
    transparent: true
  });
}

/** Erstellt gestapeltes SVG-Balkendiagramm für Hauptstrand / Nebenstrand pro Person */
function renderAssignmentsChart(){
  if(!lastResult?.stats) return '';

  const stats = Object.entries(lastResult.stats)
    .filter(([id]) => people.find(p => p.id === parseInt(id)))
    .map(([id, s]) => ({
      person: people.find(p => p.id === parseInt(id)),
      main: s.mainBeachDays || 0,
      outer: s.outerBeachDays || 0
    }))
    .sort((a, b) => (b.main + b.outer) - (a.main + a.outer));

  if(stats.length === 0) return '';

  const maxVal = Math.max(...stats.map(s => s.main + s.outer), 1);
  const width = 800, height = Math.max(180, stats.length * 20 + 40);
  const margin = { left: 140, right: 60, top: 20, bottom: 10 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const barHeight = Math.max(14, chartHeight / stats.length);

  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  stats.forEach((s, idx) => {
    const y = margin.top + idx * barHeight;
    const outerW = (s.outer / maxVal) * chartWidth;
    const mainW = (s.main / maxVal) * chartWidth;
    svg += `<rect x="${margin.left}" y="${y + 2}" width="${outerW}" height="${barHeight - 4}" class="chart-bar"/>`;
    svg += `<rect x="${margin.left + outerW}" y="${y + 2}" width="${mainW}" height="${barHeight - 4}" class="chart-bar balanced"/>`;
    svg += `<text x="${margin.left - 8}" y="${y + barHeight / 2 + 3}" class="chart-label-y">${escapeHtml(s.person.name.slice(0, 16))}</text>`;
    svg += `<text x="${margin.left + outerW + mainW + 5}" y="${y + barHeight / 2 + 3}" class="chart-text">H:${s.main} N:${s.outer}</text>`;
  });

  svg += '</svg>';
  const legend = `<div class="chart-legend">
    <div class="chart-legend-item"><div class="chart-legend-box" style="background:var(--green)"></div>Hauptstrand</div>
    <div class="chart-legend-item"><div class="chart-legend-box" style="background:var(--sea-bright)"></div>Nebenstrand</div>
  </div>`;
  return `<div class="chart-section"><div class="chart-title">🏖️ Hauptstrand / Nebenstrand pro Person</div><div class="chart-wrapper">${svg}${legend}</div></div>`;
}

/** Erstellt SVG-Balkendiagramm für HW-Tage pro Person */
function renderHWDaysChart(){
  if(!lastResult?.stats) return '';
  const stats = Object.entries(lastResult.stats)
    .filter(([id, s]) => people.find(p => p.id === parseInt(id)))
    .map(([id, s]) => ({ personId: parseInt(id), person: people.find(p => p.id === parseInt(id)), hwVisits: s.hwVisits }))
    .sort((a, b) => b.hwVisits - a.hwVisits);

  if(stats.length === 0) return '';

  const maxVal = Math.max(...stats.map(s => s.hwVisits), 1);
  const avgVal = stats.reduce((sum, s) => sum + s.hwVisits, 0) / stats.length;
  const width = 800, height = Math.max(180, stats.length * 20 + 40);
  const margin = { left: 140, right: 20, top: 20, bottom: 30 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const barHeight = Math.max(14, chartHeight / stats.length);

  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  stats.forEach((s, idx) => {
    const y = margin.top + idx * barHeight;
    const barWidth = (s.hwVisits / maxVal) * chartWidth;
    const isSkewed = Math.abs(s.hwVisits - avgVal) > avgVal * 0.4;
    const barClass = isSkewed ? 'chart-bar skewed' : 'chart-bar balanced';
    svg += `<rect x="${margin.left}" y="${y + 2}" width="${barWidth}" height="${barHeight - 4}" class="${barClass}"/>`;
    svg += `<text x="${margin.left - 8}" y="${y + barHeight / 2 + 3}" class="chart-label-y">${escapeHtml(s.person.name.slice(0, 16))}</text>`;
    svg += `<text x="${margin.left + barWidth + 5}" y="${y + barHeight / 2 + 3}" class="chart-text">${s.hwVisits}</text>`;
  });

  const avgX = margin.left + (avgVal / maxVal) * chartWidth;
  svg += `<line x1="${avgX}" y1="${margin.top}" x2="${avgX}" y2="${height - margin.bottom}" class="chart-avg-line"/>`;
  svg += `<text x="${avgX}" y="${height - 8}" class="chart-label-x" text-anchor="middle">Ø ${Math.round(avgVal * 10) / 10}</text>`;

  svg += '</svg>';
  return `<div class="chart-section"><div class="chart-title">🏠 HW-Tage pro Person</div><div class="chart-wrapper">${svg}</div></div>`;
}

/** Erstellt SVG-Balkendiagramm für Turmauslastung */
function renderTowerUtilizationChart(){
  if(!lastResult?.stats || towers.length === 0) return '';

  const towerStats = {};
  towers.forEach(t => {
    towerStats[t.id] = { name: t.name, visits: 0, prio: t.prio };
  });

  Object.values(lastResult.stats).forEach(s => {
    Object.entries(s.towerVisits || {}).forEach(([towerId, count]) => {
      if(towerStats[towerId]) towerStats[towerId].visits += count;
    });
  });

  const stats = Object.entries(towerStats)
    .map(([id, t]) => ({ towerId: parseInt(id), ...t }))
    .sort((a, b) => a.prio - b.prio);

  const maxVal = Math.max(...stats.map(s => s.visits), 1);
  const avgVal = stats.reduce((sum, s) => sum + s.visits, 0) / stats.length;
  const width = 800, height = Math.max(180, stats.length * 24 + 40);
  const margin = { left: 140, right: 20, top: 20, bottom: 30 };
  const chartWidth = width - margin.left - margin.right;
  const chartHeight = height - margin.top - margin.bottom;
  const barHeight = Math.max(16, chartHeight / stats.length);

  let svg = `<svg class="chart-svg" viewBox="0 0 ${width} ${height}" xmlns="http://www.w3.org/2000/svg">`;

  stats.forEach((s, idx) => {
    const y = margin.top + idx * barHeight;
    const barWidth = (s.visits / maxVal) * chartWidth;
    const isSkewed = Math.abs(s.visits - avgVal) > avgVal * 0.35;
    const barClass = isSkewed ? 'chart-bar skewed' : 'chart-bar balanced';
    svg += `<rect x="${margin.left}" y="${y + 2}" width="${barWidth}" height="${barHeight - 4}" class="${barClass}"/>`;
    svg += `<text x="${margin.left - 8}" y="${y + barHeight / 2 + 3}" class="chart-label-y">${escapeHtml(s.name.slice(0, 14))}</text>`;
    svg += `<text x="${margin.left + barWidth + 5}" y="${y + barHeight / 2 + 3}" class="chart-text">${s.visits}</text>`;
  });

  const avgX = margin.left + (avgVal / maxVal) * chartWidth;
  svg += `<line x1="${avgX}" y1="${margin.top}" x2="${avgX}" y2="${height - margin.bottom}" class="chart-avg-line"/>`;
  svg += `<text x="${avgX}" y="${height - 8}" class="chart-label-x" text-anchor="middle">Ø ${Math.round(avgVal * 10) / 10}</text>`;

  svg += '</svg>';
  return `<div class="chart-section"><div class="chart-title">📍 Turmauslastung</div><div class="chart-wrapper">${svg}</div></div>`;
}

/** Rendert Fairness-Visualisierungen (Balkendiagramme) */
function renderFairnessCharts(){
  if(!fairnessChartsDisplay) return '';
  let html = '<div class="charts-container">';

  if(fairnessChartsDisplay.assignmentsPerPerson) {
    html += renderAssignmentsChart();
  }
  if(fairnessChartsDisplay.hwDaysPerPerson) {
    html += renderHWDaysChart();
  }
  if(fairnessChartsDisplay.towerUtilization) {
    html += renderTowerUtilizationChart();
  }

  html += '</div>';
  return html;
}
