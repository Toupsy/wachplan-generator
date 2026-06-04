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

    closeMoveModal();

    if(forwardScope){
      // ✓ Case 2: MIT Haken
      // Tag heute: direkt im Schedule modifizieren (kein generate für diesen Tag!)
      // → 9/12=[Lena], 9/13=[Hugo,Klara,Ida] genau wie der Nutzer will
      _applyMoveToSchedule(personId, dayIdx, target.kind, target.slotId);
      // forcedPlacement speichern (für Display-Badge + zukünftige Re-Generates)
      _applyMove(personId, dayIdx, target.kind, target.slotId, true);
      // Folgetage neu berechnen: re-akkumuliert Stats aus Tagen 0..dayIdx,
      // dann generiert Tage dayIdx+1..DAYS-1 frisch
      generate(dayIdx + 1);
      renderOutput();
    } else {
      // ✓ Case 1: OHNE Haken = Nur visuell (kein generate!)
      _applyMove(personId, dayIdx, target.kind, target.slotId, false);
      renderOutput();
    }
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
 * Wendet eine Verschiebung DIREKT auf lastResult.schedule[dayIdx] an —
 * ohne generate(). Entfernt die Person aus ihrem alten Slot und fügt sie
 * in den Zielslot ein. Wird für Case 2 genutzt, damit der Tag sofort
 * korrekt aussieht, bevor generate(dayIdx+1) die Folgetage neu berechnet.
 */
function _applyMoveToSchedule(personId, dayIdx, kind, slotId){
  const person  = people.find(p => p.id === personId);
  const dayData = lastResult.schedule[dayIdx];
  if(!person || !dayData) return;

  // Person aus altem Slot entfernen
  dayData.assign.forEach(slot => {
    if(slot.kind === 'tower')
      slot.occupants = slot.occupants.filter(p => p.id !== personId);
    else if(slot.kind === 'boat'){
      slot.occupants = slot.occupants.filter(p => p.id !== personId);
      slot.bootsf = slot.occupants[0] || null;
    }
    else if(slot.kind === 'main'){
      slot.fuehrung   = slot.fuehrung.filter(p => p.id !== personId);
      slot.mainGuards = slot.mainGuards.filter(p => p.id !== personId);
      slot.base       = slot.base.filter(p => p.id !== personId);
      slot.bootsfLeft = slot.bootsfLeft.filter(p => p.id !== personId);
      if(slot.hwBoatSlot?.bootsf?.id === personId) slot.hwBoatSlot.bootsf = null;
    }
  });

  // Person in Zielslot einfügen
  if(kind === 'tower'){
    const s = dayData.assign.find(s => s.kind === 'tower' && s.towerId === slotId);
    if(s) s.occupants.push(person);
  } else if(kind === 'boat'){
    const s = dayData.assign.find(s => s.kind === 'boat' && s.boatId === slotId);
    if(s){ s.occupants.push(person); if(!s.bootsf) s.bootsf = person; }
  } else if(kind === 'hwboat'){
    const m = dayData.assign.find(s => s.kind === 'main');
    if(m?.hwBoatSlot?.boatId === slotId) m.hwBoatSlot.bootsf = person;
  } else if(kind === 'main'){
    const m = dayData.assign.find(s => s.kind === 'main');
    if(m) m.base.push(person);
  }
}

/**
 * Schreibt eine Zwangszuweisung für den heutigen Tag.
 *
 * @param {boolean} recalcFuture
 *   false (transparent) → Person wird NUR VISUELL verschoben (renderOutput-Layer).
 *     Plan und Stats bleiben unverändert. Folgetage identisch mit Original.
 *   true (effektiv) → Wird NICHT mehr für generate() genutzt! Stattdessen
 *     modifiziert move.js für Case 2 das Schedule direkt + ruft generate(dayIdx+1).
 *     Hier wird nur der forcedPlacement-Eintrag für zukünftige Re-Generates gesetzt.
 */
function _applyMove(personId, dayIdx, kind, slotId, recalcFuture){
  if(!forcedPlacements[dayIdx]) forcedPlacements[dayIdx] = [];
  forcedPlacements[dayIdx] = forcedPlacements[dayIdx].filter(f => f.personId !== personId);
  // Transparent=true für beide Cases: bei Case 2 ist die echte Änderung schon im Schedule
  // und der forcedPlacement dient nur dem Display-Badge (🔒) + zukünftigen Re-Generates
  forcedPlacements[dayIdx].push({ personId, kind, slotId, transparent: !recalcFuture });
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

/**
 * Zählt alle aktiven manuellen Zwangszuweisungen über alle Tage.
 */
function countForced(){
  return (forcedPlacements || []).reduce((n, day) => n + (day?.length || 0), 0);
}

/**
 * Entfernt ALLE manuellen Zwangszuweisungen und generiert den Plan neu.
 */
function clearAllForced(){
  forcedPlacements = freshForcedPlacements();
  generate();
  showToast('Alle manuellen Zuweisungen zurückgesetzt');
}

/**
 * Bestätigungs-Modal für D&D-Tausch (Drag-and-Drop).
 * Öffnet Modal mit optionaler Checkbox für "Folgetage neu berechnen".
 *
 * @param {string} message - Bestätigungs-Nachricht
 * @param {function} onConfirm - Callback wenn bestätigt, erhält (recalcFuture: boolean)
 * @param {function} onCancel - Callback wenn abgebrochen
 * @param {boolean} showRecalcCheckbox - Soll Checkbox angezeigt werden?
 */
function showConfirmation(message, onConfirm, onCancel, showRecalcCheckbox) {
  const modal = document.getElementById('confirm-modal');
  const msgDiv = document.getElementById('confirm-modal-message');
  const scopeDiv = document.getElementById('confirm-modal-scope');
  const checkbox = document.getElementById('confirm-scope-forward-chk');
  const proceedBtn = document.getElementById('confirm-modal-proceed');
  const cancelBtn = document.getElementById('confirm-modal-cancel');

  msgDiv.textContent = message;
  if(showRecalcCheckbox){
    scopeDiv.style.display = 'block';
    checkbox.checked = false;  // Standard: keine Neuberechnung
  } else {
    scopeDiv.style.display = 'none';
  }

  // Alte Handler entfernen um keine Duplikate
  proceedBtn.onclick = null;
  cancelBtn.onclick = null;
  const closeBtn = document.getElementById('confirm-modal-close-btn');
  if(closeBtn) closeBtn.onclick = null;

  proceedBtn.onclick = () => {
    const recalcFuture = checkbox?.checked ?? false;
    modal.style.display = 'none';
    if(onConfirm) onConfirm(recalcFuture);
  };

  const closeFn = () => {
    modal.style.display = 'none';
    if(onCancel) onCancel();
  };
  cancelBtn.onclick = closeFn;
  if(closeBtn) closeBtn.onclick = closeFn;

  modal.style.display = 'flex';
}
