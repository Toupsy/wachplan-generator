// ============================================================
// render-output.js – Hauptbereich: Tages-Ansicht + Matrix
// ============================================================

/** Rendert den kompletten Ausgabe-Bereich neu. */
function renderOutput(){
  const panel = document.getElementById('output-panel');
  const { schedule } = lastResult;

  // ── Globale Statistiken ────────────────────────────────────────
  const allPairs     = Object.entries(lastResult.pairCount);
  const distinctPairs  = allPairs.filter(([, v]) => v > 0).length;
  const repeatedPairs  = allPairs.filter(([, v]) => v > 1).length;
  let uuTotal = 0, repeatTowers = 0;
  schedule.forEach(day => day.assign.forEach(s => {
    if(s.occupants?.length === 2 && (s.occupants[0].role + s.occupants[1].role) === 'UU') uuTotal++;
  }));
  Object.values(lastResult.stats).forEach(s =>
    Object.values(s.towerVisits).forEach(v => { if(v > 2) repeatTowers++; }));

  // ── HTML aufbauen ──────────────────────────────────────────────
  let html = `
    <div class="out-header">
      <div>
        <div class="section-label" style="margin-bottom:8px;">Wachplan · ${DAYS} Tage · sukzessiv</div>
        <div class="day-tabs">
          ${schedule.map((d, i) => {
            const flags = [];
            if(d.sickCount > 0)         flags.push('🤒');
            if(d.manualClosed.length > 0) flags.push('⛔');
            return `<button class="day-tab ${i === activeDay ? 'active' : ''}" data-day="${i}">${dayLabel(i)}${flags.length ? `<span class="flag">${flags.join('')}</span>` : ''}</button>`;
          }).join('')}
        </div>
      </div>
      <div class="export-row">
        <button class="ghost-btn" id="btn-official" style="border-color:var(--warn);color:var(--warn)">📋 Offizielle XLSX (${dayLabel(activeDay)})</button>
        <button class="ghost-btn" id="btn-csv">↓ CSV</button>
        <button class="ghost-btn" id="btn-print">⎙ Drucken</button>
      </div>
    </div>
    <div class="stats-bar">
      <div class="stat"><div class="num">${distinctPairs}</div><div class="lbl">verschiedene Paare</div></div>
      <div class="stat"><div class="num" style="color:${repeatedPairs ? 'var(--warn)' : 'var(--green)'}">${repeatedPairs}</div><div class="lbl">Paar-Wiederholungen</div></div>
      <div class="stat"><div class="num" style="color:${uuTotal ? 'var(--coral)' : 'var(--green)'}">${uuTotal}</div><div class="lbl">U+U Besetzungen</div></div>
      <div class="stat"><div class="num" style="color:${repeatTowers ? 'var(--coral)' : 'var(--green)'}">${repeatTowers}</div><div class="lbl">Turm &gt;2× gleich</div></div>
    </div>`;

  // ── Tages-Panels ──────────────────────────────────────────────
  schedule.forEach((d, di) => {
    html += `<div class="day-panel" style="display:${di === activeDay ? 'block' : 'none'}" data-panel="${di}">`;

    // Tages-Steuerung (Krank / Turm zu / Boot zu)
    html += `<div class="day-controls">
      <div class="dc-head">
        <div><span class="dc-title">${dayLabel(di)}</span> <span class="dc-sub">— Status nur für diesen Tag</span></div>
        <div class="date-pick"><label>📅 Datum</label>
          <input type="date" value="${computeDayDates()[di] || ''}" readonly title="Wird automatisch aus dem Startdatum berechnet"></div>
      </div>
      <div class="dc-section">
        <div class="lbl">🤒 Krank melden (heute)</div>
        <div class="toggle-grid">
          ${people.map(p => `<span class="toggle-chip ${dayState[di].sick.has(p.id) ? 'sick' : ''}" data-sick="${p.id}" data-day="${di}">
            <i class="role-dot rd-${p.role.toLowerCase()}"></i><span class="nm">${escapeHtml(p.name)}</span>
            ${dayState[di].sick.has(p.id) ? '<span class="x">KRANK</span>' : ''}</span>`).join('')}
        </div>
      </div>
      <div class="dc-section">
        <div class="lbl">⛔ Turm schließen (heute)</div>
        <div class="toggle-grid">
          ${towers.map(t => `<span class="toggle-chip ${dayState[di].closed.has(t.id) ? 'closed-t' : ''}" data-closet="${t.id}" data-day="${di}">
            🗼 <span class="nm">${escapeHtml(t.name)}</span>
            ${dayState[di].closed.has(t.id) ? '<span class="x">ZU</span>' : ''}</span>`).join('')}
        </div>
      </div>
      ${boats.length ? `<div class="dc-section">
        <div class="lbl">🚤 Boot heute außer Dienst</div>
        <div class="toggle-grid">
          ${boats.map(b => `<span class="toggle-chip ${dayState[di].closedBoats.has(b.id) ? 'closed-t' : ''}" data-closeb="${b.id}" data-day="${di}">
            🚤 <span class="nm">${escapeHtml(b.name)}</span>
            ${dayState[di].closedBoats.has(b.id) ? '<span class="x">ZU</span>' : ''}</span>`).join('')}
        </div>
      </div>` : ''}
    </div>`;

    // Warn-Notices
    if(d.manualClosed.length)
      html += `<div class="notice bad">⛔ <div>Türme heute manuell geschlossen: <strong>${d.manualClosed.map(t => escapeHtml(t.name)).join(', ')}</strong>. Personal verstärkt die Hauptwache.</div></div>`;
    if(d.personnelClosed.length)
      html += `<div class="notice bad">⚠️ <div>Zu wenig Personal. Türme geschlossen (niedrigste Priorität zuerst): <strong>${d.personnelClosed.map(t => escapeHtml(t.name)).join(', ')}</strong>.</div></div>`;
    if(d.boatsManualClosed.length)
      html += `<div class="notice bad">🚤 <div>Boote außer Dienst: <strong>${d.boatsManualClosed.map(b => escapeHtml(b.name)).join(', ')}</strong>.</div></div>`;
    if(d.boatsClosedTower.length)
      html += `<div class="notice warn-n">🚤 <div>Boot(e) zu, weil Turm zu: <strong>${d.boatsClosedTower.map(b => escapeHtml(b.name)).join(', ')}</strong>.</div></div>`;
    if(d.boatsNoBootsf.length)
      html += `<div class="notice warn-n">🚤 <div>Boot(e) zu wegen fehlendem Bootsführer: <strong>${d.boatsNoBootsf.map(b => escapeHtml(b.name)).join(', ')}</strong>.</div></div>`;
    const uuToday = d.assign.filter(s =>
      s.kind === 'tower' && s.occupants.length === 2 &&
      (s.occupants[0].role + s.occupants[1].role) === 'UU').length;
    if(uuToday > 0)
      html += `<div class="notice warn-n">⚠️ <div>${uuToday}× zwei Unerfahrene auf einem Turm.</div></div>`;

    // Karten-Grid
    html += `<div class="towers-grid">`;
    d.assign.forEach(slot => {
      if(slot.kind === 'main'){
        const occ = (p, lbl) =>
          `<div class="occupant"><i class="role-dot rd-${p.role.toLowerCase()}"></i>${escapeHtml(p.name)}<span class="o-role">${lbl || ROLE[p.role]}</span></div>`;
        html += `<div class="tower-card main" style="grid-column:span 2;">
          <div class="tc-head"><span class="tc-name">⛱ ${slot.tower}</span><span class="tc-type main">Zentrale · k=${slot.k}</span></div>
          ${slot.fuehrung.map(p => occ(p, 'Führung')).join('')}
          ${slot.mainGuards.map(p => occ(p, p.role === 'E' ? 'Erfahren · Wache' : 'Unerf. · Wache')).join('')}
          ${slot.base.length ? '<div class="hq-divider">Zusätzlich (nicht verteilbar)</div>' : ''}
          ${slot.base.map(p => occ(p, p.role === 'E' ? 'Erfahren · Reserve' : 'Unerf. · Reserve')).join('')}
          ${slot.bootsfLeft.map(p => occ(p, 'Bootsf. · frei')).join('')}
          ${slot.sick.map(p => `<div class="occupant" style="opacity:.55"><i class="role-dot rd-${p.role.toLowerCase()}"></i><span style="text-decoration:line-through">${escapeHtml(p.name)}</span><span class="o-role" style="color:var(--coral)">krank</span></div>`).join('')}
        </div>`;
      } else if(slot.kind === 'tower'){
        html += `<div class="tower-card">
          <div class="tc-head"><span class="tc-name">🗼 ${escapeHtml(slot.tower)}</span><span class="tc-type normal">Turm · ${escapeHtml(slot.code || '?')} · P${slot.prio}</span></div>
          ${slot.occupants.map(p => `<div class="occupant"><i class="role-dot rd-${p.role.toLowerCase()}"></i>${escapeHtml(p.name)}<span class="o-role">${ROLE[p.role]}</span></div>`).join('')}
          ${slot.warn ? `<div class="warn-pair">⚠ ${slot.warn}</div>` : ''}
        </div>`;
      } else if(slot.kind === 'boat'){
        html += `<div class="tower-card boot">
          <div class="tc-head"><span class="tc-name">🚤 ${escapeHtml(slot.name)}</span><span class="tc-type boot">Boot · ${escapeHtml(slot.code || '?')}</span></div>
          <div class="boat-link">→ ${escapeHtml(slot.towerName)}</div>
          ${slot.bootsf ? `<div class="occupant"><i class="role-dot rd-b"></i>${escapeHtml(slot.bootsf.name)}<span class="o-role">Bootsführer</span></div>` : ''}
        </div>`;
      }
    });

    // Geschlossene Türme und Boote
    [...d.manualClosed, ...d.personnelClosed].forEach(t => {
      const reason = d.manualClosed.includes(t) ? 'manuell geschlossen' : 'Personalmangel';
      html += `<div class="tower-card closed"><div class="tc-head"><span class="tc-name">🗼 ${escapeHtml(t.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });
    [...d.boatsManualClosed, ...d.boatsClosedTower, ...d.boatsNoBootsf].forEach(b => {
      const reason = d.boatsManualClosed.includes(b) ? 'manuell außer Dienst'
        : d.boatsClosedTower.includes(b) ? 'Turm zu' : 'kein Bootsführer';
      html += `<div class="tower-card closed boot"><div class="tc-head"><span class="tc-name">🚤 ${escapeHtml(b.name)}</span><span class="tc-type closed">zu</span></div><div style="color:var(--text-dim);font-size:.82rem;padding:8px 0">${reason}</div></div>`;
    });

    html += `</div></div>`;
  });

  html += renderMatrix();
  panel.innerHTML = html;

  // ── Event-Listener an dynamisch eingefügte Elemente ────────────
  panel.querySelectorAll('.day-tab').forEach(t =>
    t.onclick = e => { activeDay = +e.currentTarget.dataset.day; renderOutput(); });

  panel.querySelectorAll('[data-sick]').forEach(el =>
    el.onclick = e => {
      const id = +e.currentTarget.dataset.sick, day = +e.currentTarget.dataset.day;
      const s = dayState[day].sick; s.has(id) ? s.delete(id) : s.add(id); generate();
    });

  panel.querySelectorAll('[data-closet]').forEach(el =>
    el.onclick = e => {
      const id = +e.currentTarget.dataset.closet, day = +e.currentTarget.dataset.day;
      const s = dayState[day].closed; s.has(id) ? s.delete(id) : s.add(id); generate();
    });

  panel.querySelectorAll('[data-closeb]').forEach(el =>
    el.onclick = e => {
      const id = +e.currentTarget.dataset.closeb, day = +e.currentTarget.dataset.day;
      const s = dayState[day].closedBoats; s.has(id) ? s.delete(id) : s.add(id); generate();
    });

  document.getElementById('btn-csv').onclick   = exportCSV;
  document.getElementById('btn-print').onclick = () => window.print();
  const bo = document.getElementById('btn-official');
  if(bo) bo.onclick = () => exportOfficial(activeDay);
}

/**
 * Rendert die Paarungs-Matrix am Ende des Ausgabe-Bereichs.
 * Nur sichtbar wenn 2–18 Erfahrene/Unerfahrene vorhanden sind.
 */
function renderMatrix(){
  const g = lastResult.peopleGuards;
  if(g.length < 2 || g.length > 18) return '';

  let h = `<div class="section-label" style="margin-top:30px;">Paarungs-Matrix
    <span style="font-weight:400;text-transform:none;letter-spacing:0;color:var(--text-dim);font-size:11px">
      (wie oft zwei Personen über alle Tage zusammen am Turm)
    </span></div>
    <div class="matrix-wrap"><table class="matrix"><tr><th></th>`;
  g.forEach(p => h += `<th>${escapeHtml(p.name.slice(0, 6))}</th>`);
  h += '</tr>';
  g.forEach(a => {
    h += `<tr><th class="rowh">${escapeHtml(a.name.slice(0, 8))}</th>`;
    g.forEach(b => {
      if(a.id === b.id){ h += `<td class="self">—</td>`; return; }
      const v = lastResult.pairCount[[a.id, b.id].sort((x, y) => x - y).join('|')] || 0;
      h += `<td class="${v === 0 ? 'zero' : v === 1 ? 'one' : 'multi'}">${v}</td>`;
    });
    h += '</tr>';
  });
  return h + '</table></div>';
}
