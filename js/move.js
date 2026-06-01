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
      // ✓ Case 2: MIT Haken = Effektive Änderung, ganze Woche neu berechnen
      _applyMove(personId, dayIdx, target.kind, target.slotId, true);
      generate();
      renderOutput();
    } else {
      // ✓ Case 1: OHNE Haken = Visual-Only (kein generate!)
      // Verschiebe Person NUR VISUELL in renderOutput, plan bleibt unverändert
      _applyMove(personId, dayIdx, target.kind, target.slotId, false);
      // generate() NICHT aufrufen! Nur renderOutput mit visual move
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
 * Schreibt eine Zwangszuweisung für den heutigen Tag und optional Folgetage.
 *
 * @param {boolean} recalcFuture
 *   false (Standard / "transparent") → Nur dieser Tag wird visuell geändert, transparent flag.
 *     Person bleibt im Pool, Algorithmus läuft normal, danach visuell verschoben.
 *     Folgetage sind identisch mit Original.
 *   true ("effective") → Dieser Tag wird wirksam geändert, transparent=false.
 *     Alte Zuweisung aus Folgetagen entfernt, Algorithmus neu arrangiert Folgetage.
 */
function _applyMove(personId, dayIdx, kind, slotId, recalcFuture){
  if(!forcedPlacements[dayIdx]) forcedPlacements[dayIdx] = [];

  // Entferne alte Zuweisung für diese Person an diesem Tag
  forcedPlacements[dayIdx] = forcedPlacements[dayIdx].filter(f => f.personId !== personId);

  // Neue Zuweisung hinzufügen mit transparent flag
  forcedPlacements[dayIdx].push({
    personId, kind, slotId,
    transparent: !recalcFuture,  // Case 1: !true=true (transparent), Case 2: !false=false (effective)
  });

  // CASE 2: transparent=false → Alte Zuweisungen aus Folgetagen entfernen
  // für Case 1 (transparent=true) bleiben die Folgetage unverändert
  if(recalcFuture){
    for(let d = dayIdx + 1; d < DAYS; d++){
      if(!forcedPlacements[d]) forcedPlacements[d] = [];
      // Entferne ALLE forcedPlacements dieser Person von den Folgetagen
      // damit der Algorithmus neu arrangieren kann
      forcedPlacements[d] = forcedPlacements[d].filter(f => f.personId !== personId);
    }
  }
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

  proceedBtn.onclick = () => {
    const recalcFuture = checkbox?.checked ?? false;
    modal.style.display = 'none';
    if(onConfirm) onConfirm(recalcFuture);
  };

  cancelBtn.onclick = () => {
    modal.style.display = 'none';
    if(onCancel) onCancel();
  };

  modal.style.display = 'flex';
}
