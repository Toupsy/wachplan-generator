// ============================================================
// plans-ui.js – Plan-Manager (mehrere benannte Pläne)
// Nutzt fetchPlansList/loadPlanById/createNewPlan/renameCurrentPlan/
// deletePlanById/currentPlanId/currentPlanName aus state-io.js.
// ============================================================

async function openPlansModal(){
  const modal = document.getElementById('plans-modal');
  if(!modal) return;
  const nameInput = document.getElementById('plan-name-input');
  if(nameInput) nameInput.value = (typeof currentPlanName !== 'undefined' ? currentPlanName : '') || '';
  modal.style.display = 'flex';
  await renderPlansList();
}

function closePlansModal(){
  const m = document.getElementById('plans-modal');
  if(m) m.style.display = 'none';
}

function openCombinedStatsModal(planIds){
  const modal = document.getElementById('combined-stats-modal');
  if(!modal) return;
  renderCombinedStatsTable(planIds);
  modal.style.display = 'flex';
}

function closeCombinedStatsModal(){
  const m = document.getElementById('combined-stats-modal');
  if(m) m.style.display = 'none';
}

async function renderCombinedStatsTable(planIds){
  const contentEl = document.getElementById('combined-stats-content');
  if(!contentEl) return;
  contentEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Lädt…</div>';
  try {
    const { combined, personMap } = await aggregateStatsFromPlans(planIds);
    if(Object.keys(combined).length === 0){
      contentEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Keine Statistiken gefunden.</div>';
      return;
    }
    const tMap = {}; towers.forEach(t => tMap[t.id] = t);
    const threshold = towers.length * 0.5;
    let html = '<table style="width:100%;border-collapse:collapse;margin-bottom:20px">';
    html += '<tr style="border-bottom:1px solid var(--line)"><th style="text-align:left;padding:6px;font-weight:bold">Person</th>';
    html += '<th style="text-align:center;padding:6px;font-weight:bold">Gesamt</th><th style="text-align:center;padding:6px;font-weight:bold">Türme</th>';
    html += '<th style="text-align:left;padding:6px;font-weight:bold">Details</th></tr>';
    Object.entries(combined).forEach(([personId, stat]) => {
      const person = personMap[personId];
      if(!person) return;
      const cnt = Object.keys(stat.towerVisits||{}).length;
      const deets = Object.entries(stat.towerVisits||{}).sort(([a],[b])=>(tMap[b]?.prio||0)-(tMap[a]?.prio||0))
        .map(([tid,c])=>(tMap[tid]?.name||`T${tid}`)+'('+c+')').join(', ');
      html += `<tr style="border-bottom:1px solid var(--line-strong)"><td style="padding:6px">${escapeHtml(person.name)}</td>`;
      html += `<td style="text-align:center;padding:6px">${stat.total}</td><td style="text-align:center;padding:6px;color:${cnt>=threshold?'var(--green)':'var(--warn)'};font-weight:bold">${cnt}</td>`;
      html += `<td style="padding:6px;font-size:.75rem;color:var(--text-dim)">${escapeHtml(deets)}</td></tr>`;
    });
    html += '</table>';
    contentEl.innerHTML = html;
  } catch(e){
    console.error('renderCombinedStatsTable', e);
    contentEl.innerHTML = '<div style="color:var(--coral)">Fehler beim Laden</div>';
  }
}

async function renderPlansList(){
  const listEl = document.getElementById('plans-list');
  if(!listEl) return;
  listEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Lädt…</div>';
  let plans = [];
  try { plans = await fetchPlansList(); } catch(e){}
  if(!plans.length){ listEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Noch keine Pläne.</div>'; return; }

  listEl.innerHTML = plans.map(p => {
    const isCurrent = p.id === currentPlanId;
    const badge = p.isOwner
      ? '<span style="font-size:.62rem;color:var(--text-dim);text-transform:uppercase">Eigen</span>'
      : `<span style="font-size:.62rem;color:var(--warn);text-transform:uppercase">geteilt · ${escapeHtml(p.ownerName||'?')}</span>`;
    const del = p.isOwner
      ? `<button class="ghost-btn pl-del" data-id="${p.id}" data-name="${escapeHtml(p.name||'')}" style="border-color:var(--coral);color:var(--coral);font-size:.72rem;padding:4px 8px" title="Löschen">🗑️</button>`
      : '';
    const openBtn = isCurrent
      ? '<span style="font-size:.66rem;color:var(--green);text-transform:uppercase">● aktuell</span>'
      : `<button class="ghost-btn pl-open" data-id="${p.id}" style="border-color:var(--sea-bright);color:var(--sea-bright);font-size:.72rem;padding:4px 8px">Öffnen</button>`;
    const checkbox = `<input type="checkbox" class="plan-checkbox" data-id="${p.id}" style="cursor:pointer;width:16px;height:16px">`;
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--deep);border:1px solid ${isCurrent?'var(--green)':'var(--line)'};border-radius:6px;padding:8px 10px">
      <div style="flex-shrink:0">${checkbox}</div>
      <div style="min-width:0;flex:1">
        <div style="font-size:.88rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(p.name||'(ohne Name)')}</div>
        <div>${badge}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">${openBtn}${del}</div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.pl-open').forEach(b => b.onclick = async () => {
    await loadPlanById(+b.dataset.id);
    await renderPlansList();
    const ni = document.getElementById('plan-name-input'); if(ni) ni.value = currentPlanName || '';
  });
  listEl.querySelectorAll('.pl-del').forEach(b => b.onclick = async () => {
    if(!confirm(`Plan „${b.dataset.name}" wirklich löschen?`)) return;
    await deletePlanById(+b.dataset.id);
    await renderPlansList();
    const ni = document.getElementById('plan-name-input'); if(ni) ni.value = currentPlanName || '';
  });
}

document.addEventListener('DOMContentLoaded', () => {
  const openBtn = document.getElementById('btn-plans');
  if(openBtn) openBtn.onclick = openPlansModal;
  const closeBtn = document.getElementById('plans-modal-close-btn');
  if(closeBtn) closeBtn.onclick = closePlansModal;
  const modal = document.getElementById('plans-modal');
  if(modal) modal.addEventListener('click', e => { if(e.target === modal) closePlansModal(); });

  const renameBtn = document.getElementById('plan-rename-btn');
  if(renameBtn) renameBtn.onclick = () => {
    const v = document.getElementById('plan-name-input').value;
    renameCurrentPlan(v);
    showToast('✏️ Umbenannt in „' + (v||'Wachplan') + '"');
    renderPlansList();
  };
  const nameInput = document.getElementById('plan-name-input');
  if(nameInput) nameInput.addEventListener('keydown', e => { if(e.key === 'Enter') renameBtn && renameBtn.click(); });

  const newBtn = document.getElementById('plan-new-btn');
  if(newBtn) newBtn.onclick = async () => {
    const name = prompt('Name für den neuen Plan:', 'Neuer Wachplan');
    if(name === null) return;
    createNewPlan(name);
    const ni = document.getElementById('plan-name-input'); if(ni) ni.value = currentPlanName || '';
    await renderPlansList();
  };

  const statsBtn = document.getElementById('plan-combined-stats-btn');
  if(statsBtn) statsBtn.onclick = async () => {
    const selected = Array.from(document.querySelectorAll('.plan-checkbox:checked')).map(cb => +cb.dataset.id);
    if(selected.length < 2){ showToast('Mindestens 2 Pläne auswählen'); return; }
    const choice = confirm('CSV exportieren (OK) oder modal anzeigen (Abbrechen)?');
    if(choice) await exportCombinedStatsCSV(selected);
    else await openCombinedStatsModal(selected);
  };

  const combinedCloseBtn = document.getElementById('combined-stats-close-btn');
  if(combinedCloseBtn) combinedCloseBtn.onclick = closeCombinedStatsModal;
  const combinedModal = document.getElementById('combined-stats-modal');
  if(combinedModal) combinedModal.addEventListener('click', e => { if(e.target === combinedModal) closeCombinedStatsModal(); });
});
