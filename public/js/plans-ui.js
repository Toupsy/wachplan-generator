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
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--deep);border:1px solid ${isCurrent?'var(--green)':'var(--line)'};border-radius:6px;padding:8px 10px">
      <div style="min-width:0">
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

async function renderTemplatesList(){
  const listEl = document.getElementById('templates-list');
  if(!listEl) return;
  const templates = loadTemplatesList();
  if(!templates.length){ listEl.innerHTML = '<div style="color:var(--text-dim);font-size:.82rem">Noch keine Vorlagen.</div>'; return; }

  listEl.innerHTML = templates.map(t => {
    return `<div style="display:flex;align-items:center;justify-content:space-between;gap:8px;background:var(--deep);border:1px solid var(--line);border-radius:6px;padding:8px 10px">
      <div style="min-width:0">
        <div style="font-size:.88rem;color:var(--text);overflow:hidden;text-overflow:ellipsis;white-space:nowrap">${escapeHtml(t.name||'Vorlage')}</div>
        <div style="font-size:.62rem;color:var(--text-dim)">${new Date(t.createdAt).toLocaleDateString('de-DE')}</div>
      </div>
      <div style="display:flex;align-items:center;gap:6px;flex-shrink:0">
        <button class="ghost-btn tpl-load" data-id="${t.id}" data-name="${escapeHtml(t.name||'')}" style="border-color:var(--sea-bright);color:var(--sea-bright);font-size:.72rem;padding:4px 8px">Laden</button>
        <button class="ghost-btn tpl-del" data-id="${t.id}" data-name="${escapeHtml(t.name||'')}" style="border-color:var(--coral);color:var(--coral);font-size:.72rem;padding:4px 8px" title="Löschen">🗑️</button>
      </div>
    </div>`;
  }).join('');

  listEl.querySelectorAll('.tpl-load').forEach(b => b.onclick = async () => {
    loadTemplateAsNewPlan(+b.dataset.id, b.dataset.name);
    closePlansModal();
  });
  listEl.querySelectorAll('.tpl-del').forEach(b => b.onclick = async () => {
    if(!confirm(`Vorlage „${b.dataset.name}" wirklich löschen?`)) return;
    deleteTemplate(+b.dataset.id);
    await renderTemplatesList();
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

  // Template Tab Buttons
  const plansTabBtn = document.getElementById('plans-tab-btn');
  const templatesTabBtn = document.getElementById('templates-tab-btn');
  const plansTab = document.getElementById('plans-tab');
  const templatesTab = document.getElementById('templates-tab');

  if(plansTabBtn) plansTabBtn.onclick = () => {
    if(plansTab) plansTab.style.display = 'block';
    if(templatesTab) templatesTab.style.display = 'none';
    if(plansTabBtn) { plansTabBtn.style.borderBottomColor = 'var(--green)'; plansTabBtn.style.color = 'var(--text)'; }
    if(templatesTabBtn) { templatesTabBtn.style.borderBottomColor = 'transparent'; templatesTabBtn.style.color = 'var(--text-dim)'; }
  };

  if(templatesTabBtn) templatesTabBtn.onclick = async () => {
    if(plansTab) plansTab.style.display = 'none';
    if(templatesTab) templatesTab.style.display = 'block';
    if(plansTabBtn) { plansTabBtn.style.borderBottomColor = 'transparent'; plansTabBtn.style.color = 'var(--text-dim)'; }
    if(templatesTabBtn) { templatesTabBtn.style.borderBottomColor = 'var(--green)'; templatesTabBtn.style.color = 'var(--text)'; }
    await renderTemplatesList();
  };

  // Save as Template Button
  const saveTemplateBtn = document.getElementById('save-template-btn');
  if(saveTemplateBtn) saveTemplateBtn.onclick = () => {
    const name = prompt('Name für die Vorlage:', currentPlanName || 'Vorlage');
    if(name === null) return;
    createTemplate(name);
    renderTemplatesList();
  };
});
