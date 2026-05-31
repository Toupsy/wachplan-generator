// ============================================================
// move.js – Modal zum manuellen Verschieben von Personen (Feature 3 & 4)
// ============================================================

/**
 * Öffnet das Verschiebe-Modal für eine Person.
 *
 * @param {number} personId  – ID der zu verschiebenden Person
 * @param {number} dayIdx    – Aktueller Tag
 * @param {string} fromKind  – 'tower'|'boat'|'main'|'hwboat'
 * @param {number|null} fromSlotId – towerId / boatId / null für HW
 */
function openMoveModal(personId, dayIdx, fromKind, fromSlotId){
  const person = getP(personId);
  if(!person) return;

  const overlay = document.getElementById('move-modal');
  const title   = document.getElementById('move-modal-title');
  const sub     = document.getElementById('move-modal-sub');
  const slotList= document.getElementById('move-slot-list');
  const scopeDiv= document.getElementById('move-scope');
  const confirm = document.getElementById('move-modal-confirm');

  title.textContent = `${person.name} verschieben`;
  sub.textContent   = `Von: ${_slotLabel(fromKind, fromSlotId)}`;

  let selectedTarget = null;
  let selectedScope  = 'today'; // 'today' | 'forward'

  // ── Slot-Auswahl ─────────────────────────────────────────────
  slotList.innerHTML = '';
  const addSlot = (kind, slotId, label, sublabel) => {
    const btn = document.createElement('button');
    btn.className   = 'move-slot-btn';
    btn.innerHTML   = `<div>${escapeHtml(label)}</div><div class="move-slot-label">${escapeHtml(sublabel)}</div>`;
    btn.onclick = () => {
      slotList.querySelectorAll('.move-slot-btn').forEach(b => b.classList.remove('selected'));
      btn.classList.add('selected');
      selectedTarget = { kind, slotId };
      confirm.disabled = false;
    };
    slotList.appendChild(btn);
  };

  // Türme (für alle Rollen)
  const d = lastResult.schedule[dayIdx];
  d.openTowers.forEach(t => {
    if(fromKind === 'tower' && fromSlotId === t.id) return; // Herkunft überspringen
    addSlot('tower', t.id, `🗼 ${t.name}`, `${t.code||'?'} · Prio ${t.prio}`);
  });
  // Boote + HW-Boot: nur für Bootsführer
  if(person.role === 'B'){
    // Aktiv besetzte Boote
    d.assign.filter(s => s.kind === 'boat').forEach(s => {
      if(fromKind === 'boat' && fromSlotId === s.boatId) return;
      addSlot('boat', s.boatId, `🚤 ${s.name}`, `BF-Slot · ${s.code||'?'}`);
    });
    // Boote ohne Bootsführer (z.B. weil BF manuell woanders zugewiesen wurde)
    d.boatsNoBootsf.forEach(b => {
      addSlot('boat', b.id, `🚤 ${b.name}`, `BF-Slot · ${b.code||'?'} · kein BF`);
    });
    // HW-Boot
    const mainSlot = d.assign.find(s => s.kind === 'main');
    if(mainSlot?.hwBoatSlot && fromKind !== 'hwboat'){
      addSlot('boat', mainSlot.hwBoatSlot.boatId, `🚤 HW-Boot: ${mainSlot.hwBoatSlot.name}`, 'BF-Slot');
    }
  }
  // Hauptwache
  if(fromKind !== 'main'){
    addSlot('main', MAIN_ID, '⛱ Hauptwache', 'Guard-/Reserve-Slot');
  }

  // ── Scope-Auswahl ─────────────────────────────────────────────
  scopeDiv.querySelectorAll('.scope-btn').forEach(b => {
    b.classList.toggle('selected', b.dataset.scope === 'today');
    b.onclick = () => {
      scopeDiv.querySelectorAll('.scope-btn').forEach(x => x.classList.remove('selected'));
      b.classList.add('selected');
      selectedScope = b.dataset.scope;
    };
  });

  confirm.disabled = true;
  confirm.onclick = () => {
    if(!selectedTarget) return;
    _applyMove(personId, dayIdx, selectedTarget.kind, selectedTarget.slotId, selectedScope);
    closeMoveModal();
    generate();
  };

  overlay.style.display = 'flex';
}

function closeMoveModal(){
  document.getElementById('move-modal').style.display = 'none';
}

// ── Interne Helfer ────────────────────────────────────────────────

function _slotLabel(kind, slotId){
  if(kind === 'tower'){
    const t = getT(slotId);
    return t ? `🗼 ${t.name}` : 'Turm';
  }
  if(kind === 'boat' || kind === 'hwboat'){
    const b = getBoat(slotId);
    return b ? `🚤 ${b.name}` : 'Boot';
  }
  return '⛱ Hauptwache';
}

/**
 * Schreibt die Zwangszuweisung in forcedPlacements.
 * Scope 'today': nur Tag dayIdx.
 * Scope 'forward': Tag dayIdx bis DAYS-1.
 */
function _applyMove(personId, dayIdx, kind, slotId, scope){
  const entry = { personId, kind, slotId };
  const days  = scope === 'forward'
    ? Array.from({ length: DAYS - dayIdx }, (_, i) => dayIdx + i)
    : [dayIdx];

  days.forEach(d => {
    if(!forcedPlacements[d]) forcedPlacements[d] = [];
    // Alte Einträge für diese Person entfernen
    forcedPlacements[d] = forcedPlacements[d].filter(f => f.personId !== personId);
    // Neue Zuweisung hinzufügen
    forcedPlacements[d].push({ ...entry });
  });
}

// ── Zwangszuweisung entfernen ─────────────────────────────────────

/**
 * Entfernt alle Zwangszuweisungen für eine Person ab einem bestimmten Tag.
 */
function clearForced(personId, fromDay, scope){
  const days = scope === 'forward'
    ? Array.from({ length: DAYS - fromDay }, (_, i) => fromDay + i)
    : [fromDay];
  days.forEach(d => {
    if(forcedPlacements[d])
      forcedPlacements[d] = forcedPlacements[d].filter(f => f.personId !== personId);
  });
  generate();
}
