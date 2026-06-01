// ============================================================
// move.js – Modal zum manuellen Verschieben von Personen
// ============================================================

function openMoveModal(personId, dayIdx, fromKind, fromSlotId){
  const person = getP(personId);
  if(!person) return;

  const overlay  = document.getElementById('move-modal');
  const title    = document.getElementById('move-modal-title');
  const sub      = document.getElementById('move-modal-sub');
  const slotSel  = document.getElementById('move-slot-select');
  const scopeDiv = document.getElementById('move-scope');
  const confirm  = document.getElementById('move-modal-confirm');

  title.textContent = `${person.name} verschieben`;
  sub.textContent   = `Von: ${_slotLabel(fromKind, fromSlotId)}`;

  // ── Dropdown befüllen ─────────────────────────────────────────
  slotSel.innerHTML = '<option value="">— Ziel auswählen —</option>';

  const addOpt = (kind, slotId, label) => {
    const opt = document.createElement('option');
    opt.value = JSON.stringify({ kind, slotId });
    opt.textContent = label;
    slotSel.appendChild(opt);
  };

  const d = lastResult.schedule[dayIdx];

  // Türme (für alle Rollen)
  d.openTowers.forEach(t => {
    if(fromKind === 'tower' && fromSlotId === t.id) return;
    addOpt('tower', t.id, `🗼 ${t.name}  (${t.code||'?'} · Prio ${t.prio})`);
  });

  // Boote + HW-Boot: nur für Bootsführer
  if(person.role === 'B'){
    d.assign.filter(s => s.kind === 'boat').forEach(s => {
      if(fromKind === 'boat' && fromSlotId === s.boatId) return;
      addOpt('boat', s.boatId, `🚤 ${s.name}  (${s.code||'?'})`);
    });
    d.boatsNoBootsf.forEach(b => {
      addOpt('boat', b.id, `🚤 ${b.name}  (${b.code||'?'} · kein BF)`);
    });
    const mainSlot = d.assign.find(s => s.kind === 'main');
    if(mainSlot?.hwBoatSlot && fromKind !== 'hwboat')
      addOpt('boat', mainSlot.hwBoatSlot.boatId, `🚤 HW-Boot: ${mainSlot.hwBoatSlot.name}`);
  }

  // Hauptwache
  if(fromKind !== 'main')
    addOpt('main', MAIN_ID, '⛱ Hauptwache');

  slotSel.value = '';
  confirm.disabled = true;
  slotSel.onchange = () => { confirm.disabled = !slotSel.value; };

  // ── Checkbox zurücksetzen ─────────────────────────────────────
  const scopeChk = document.getElementById('scope-forward-chk');
  if(scopeChk) scopeChk.checked = false;

  confirm.onclick = () => {
    if(!slotSel.value) return;
    const target       = JSON.parse(slotSel.value);
    const forwardScope = scopeChk?.checked ?? false;
    _applyMove(personId, dayIdx, target.kind, target.slotId, forwardScope);
    closeMoveModal();
    generate();
  };

  overlay.style.display = 'flex';
}

function closeMoveModal(){
  document.getElementById('move-modal').style.display = 'none';
}

// ── Hilfsfunktion: lesbares Herkunfts-Label ──────────────────────
function _slotLabel(kind, slotId){
  if(kind === 'tower')  { const t = getT(slotId);    return t ? `🗼 ${t.name}` : 'Turm'; }
  if(kind === 'boat' || kind === 'hwboat') { const b = getBoat(slotId);  return b ? `🚤 ${b.name}` : 'Boot'; }
  return '⛱ Hauptwache';
}

/**
 * Schreibt eine Zwangszuweisung NUR für den heutigen Tag.
 *
 * @param {boolean} recalcFuture
 *   false (Standard / "transparent") → Folgetage laufen so als wäre der
 *     heutige Wechsel nie passiert. Jonas bleibt Dienstag auf T12 wie
 *     laut Originalplanung vorgesehen.
 *   true → commitPerson zählt heute; Folgetage-Algorithmus berücksichtigt
 *     den heutigen Wechsel und kann Jonas woanders einteilen.
 */
function _applyMove(personId, dayIdx, kind, slotId, recalcFuture){
  if(!forcedPlacements[dayIdx]) forcedPlacements[dayIdx] = [];
  forcedPlacements[dayIdx] = forcedPlacements[dayIdx].filter(f => f.personId !== personId);
  forcedPlacements[dayIdx].push({
    personId, kind, slotId,
    transparent: !recalcFuture,   // Standard: transparent → Folgetage unverändert
  });
}

/**
 * Entfernt Zwangszuweisungen für eine Person ab einem bestimmten Tag.
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
