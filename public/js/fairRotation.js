// ============================================================
// fairRotation.js – Alternativer Generator: "Strenge faire Rotation"
// ============================================================
//
// Deterministische, rotationsbasierte Wachplan-Erzeugung als Alternative zum
// score-getriebenen Kern (generate.js). Ziel: maximale Fairness mit klaren,
// nachvollziehbaren Regeln, beliebig viele Tage, erweiterbar:
//
//   • Jeder offene Turm bekommt GARANTIERT mindestens eine erfahrene Person
//     (erfahrene Wachgänger zuerst, dann Führung als Reserve). Unerfahrene
//     wandern bei Bedarf auf die Hauptwache – wie vom Nutzer gewünscht.
//   • Türme & Partner werden so gewählt, dass sich Turm-Wiederholungen und
//     Partner-Wiederholungen über die Tage minimieren (greedy nach
//     towerVisits / pairCount – exakt die Größen, die der Kern bereits führt).
//   • Bootsführer rotieren ZYKLISCH durch die Boote (systematisches Muster,
//     z. B. BF A: 78/1 → 78/2 → 78/3 → …), Start-Offset pro Tag.
//   • Überzählige Personen (inkl. Führung ohne Leader-Slot) landen an der HW.
//
// Erzeugt exakt dieselbe lastResult-Struktur wie generate() und nutzt dazu die
// vorhandenen Helfer _reAccumulateDayStats() (Stats + pairCount) und
// computeFairnessMetrics() (Fairness-Kennzahlen) → DRY, identisches Rendering
// und identischer XLSX/CSV-Export.
//
// Bewusste Vereinfachung ggü. generate(): forcedPlacements (manuelle
// Zwangszuweisungen) werden in diesem Modus IGNORIERT – die strenge Rotation
// erzeugt einen sauberen Plan "from scratch". Krank-/Geschlossen-Markierungen
// pro Tag werden hingegen respektiert.

/**
 * Dispatcher für eine VOLLSTÄNDIGE Neuberechnung (alle Tage): wählt je nach
 * fairRotation-Flag den passenden Generator. Für Teil-Neuberechnungen
 * (generate(startDay) bei manuellem Verschieben) wird weiterhin direkt der
 * score-basierte Kern genutzt – die strenge Rotation kennt nur "alles neu".
 */
function runGenerate(){
  if(typeof fairRotation !== 'undefined' && fairRotation) generateFairRotation();
  else generate();
}

function generateFairRotation(){
  autoCodes();

  const stats = {};
  const pairCount = {};
  const ensure = id => {
    if(!stats[id]) stats[id] = {
      total: 0, towerVisits: {}, boatVisits: {}, hwVisits: 0,
      towerWithBoatDays: 0, boatCaptainPairings: {}, lastBoatId: null
    };
    return stats[id];
  };
  const pairKey = (a,b) => a < b ? a + '|' + b : b + '|' + a;
  const k = Math.max(0, mainK | 0);
  const schedule = [];

  for(let d = 0; d < DAYS; d++){
    const ds = dayState[d] || { sick: new Set(), closed: new Set(), closedBoats: new Set() };
    const isSick = id => ds.sick.has(id);
    const sickToday = people.filter(p => isSick(p.id));

    // Verfügbare Personen (nicht krank), nach Rollen getrennt
    const availF = people.filter(p => p.role === 'F' && !isSick(p.id));
    const availB = people.filter(p => p.role === 'B' && !isSick(p.id));
    const guardsW = people.filter(p => p.role === 'W' && !isSick(p.id));
    const expW   = guardsW.filter(p =>  p.experienced);
    const inexpW = guardsW.filter(p => !p.experienced);

    // Offene Türme (prio ASC) – nur so viele wie das Personal trägt
    const manualClosed = towers.filter(t => ds.closed.has(t.id));
    const candTowers = towers.filter(t => !ds.closed.has(t.id))
      .slice().sort((a,b) => (a.prio - b.prio) || (a.id - b.id));

    const bodyCount = expW.length + inexpW.length + availF.length; // mögliche Turm-Körper
    const openTowers = [];
    let usedBodies = k; // HW-Guards reservieren
    for(const t of candTowers){
      const need = (t.slotCount || 2) + (t.leaderCount || 0);
      if(usedBodies + need <= bodyCount){ openTowers.push(t); usedBodies += need; }
    }
    const personnelClosed = candTowers.filter(t => !openTowers.includes(t));

    // ── Auswahl-Pools (Kopien, werden geleert) ──
    const leadPool    = [...expW];   // erfahrene Wachgänger → Turm-Leads
    const fPool       = [...availF]; // Führung (Lead-Reserve + leaderCount)
    const partnerPool = [...inexpW]; // Partner / HW-Overflow
    const usedToday   = new Set();
    const take = (pool, idx) => { const p = pool.splice(idx, 1)[0]; usedToday.add(p.id); return p; };

    // Deterministischer Tiebreaker (streut Zuweisungen, bleibt reproduzierbar)
    const tie = (p, t) => (p.id * 7 + d * 13 + t.id * 3) % 11;
    // Lead: wenig Besuche dieses Turms, wenig Gesamteinsätze
    const pickLead = (pool, t) => {
      if(pool.length === 0) return -1;
      let best = 0, bestScore = Infinity;
      pool.forEach((p, i) => {
        const s = stats[p.id] || {};
        const score = (s.towerVisits?.[t.id] || 0) * 1000 + (s.total || 0) * 10 + tie(p, t);
        if(score < bestScore){ bestScore = score; best = i; }
      });
      return best;
    };
    // Partner: zusätzlich Partner-Wiederholungen mit bereits Platzierten meiden
    const pickPartner = (pool, t, occupants) => {
      if(pool.length === 0) return -1;
      let best = 0, bestScore = Infinity;
      pool.forEach((p, i) => {
        const s = stats[p.id] || {};
        let score = (s.towerVisits?.[t.id] || 0) * 1000 + (s.total || 0) * 10 + tie(p, t);
        occupants.forEach(o => { score += (pairCount[pairKey(p.id, o.id)] || 0) * 500; });
        if(score < bestScore){ bestScore = score; best = i; }
      });
      return best;
    };

    const dayAssign = [];

    // Lead-Kandidaten (stabile Reihenfolge) für die zyklische Turm-Rotation.
    // Erfahrene Wachgänger zuerst, Führung nur als Auffüllung, falls zu wenige.
    const removeById = (pool, id) => { const ix = pool.findIndex(x => x.id === id); if(ix >= 0) pool.splice(ix, 1); };
    const leadCandidates = [...leadPool].sort((a,b) => a.id - b.id);
    const fSorted = [...fPool].sort((a,b) => a.id - b.id);
    for(let fi = 0; leadCandidates.length < openTowers.length && fi < fSorted.length; fi++){
      leadCandidates.push(fSorted[fi]);
    }
    const nLead = leadCandidates.length;

    // ── 1) TÜRME ──────────────────────────────────────────────────
    openTowers.forEach((t, ti) => {
      const slot = { kind:'tower', towerId:t.id, tower:t.name, code:t.code, prio:t.prio, occupants:[], warn:null };
      const totalSlots = (t.slotCount || 2) + (t.leaderCount || 0);

      // Primärer erfahrener Lead per ZYKLISCHER Rotation (Latin-Square):
      // Kandidat (ti + d) mod nLead → jede Person wandert Tag für Tag einen Turm
      // weiter ⇒ keine Turm-Wiederholung, solange Tage ≤ Anzahl Türme.
      if(nLead > 0){
        const cand = leadCandidates[(ti + d) % nLead];
        if(cand && !usedToday.has(cand.id)){
          usedToday.add(cand.id);
          removeById(leadPool, cand.id);
          removeById(fPool, cand.id);
          slot.occupants.push(cand);
        }
      }
      // Fällt die Rotation aus (zu wenige Erfahrene): greedy einen Erfahrenen
      // ergänzen, damit die Experience-Garantie möglichst gehalten wird.
      if(slot.occupants.length === 0){
        let li = pickLead(leadPool, t);
        if(li >= 0) slot.occupants.push(take(leadPool, li));
        else { const ffi = pickLead(fPool, t); if(ffi >= 0) slot.occupants.push(take(fPool, ffi)); }
      }

      // leaderCount-Slots bevorzugt mit Führung
      let leadersLeft = t.leaderCount || 0;
      while(slot.occupants.length < totalSlots && leadersLeft > 0 && fPool.length > 0){
        slot.occupants.push(take(fPool, pickLead(fPool, t)));
        leadersLeft--;
      }

      // Restplätze: Partner (unerfahren zuerst, dann erfahrene Reserve, dann Führung)
      while(slot.occupants.length < totalSlots){
        let pi = pickPartner(partnerPool, t, slot.occupants);
        if(pi >= 0){ slot.occupants.push(take(partnerPool, pi)); continue; }
        let ri = pickPartner(leadPool, t, slot.occupants);
        if(ri >= 0){ slot.occupants.push(take(leadPool, ri)); continue; }
        let fi = pickPartner(fPool, t, slot.occupants);
        if(fi >= 0){ slot.occupants.push(take(fPool, fi)); continue; }
        break; // kein Personal mehr
      }

      if(!slot.occupants.some(p => p.role === 'F' || p.experienced))
        slot.warn = 'Kein Erfahrener verfügbar';
      else if(slot.occupants.length >= 2 && slot.occupants.every(p => effLevel(p) === 'U'))
        slot.warn = 'Zwei Unerfahrene – kein Erfahrener frei';

      dayAssign.push(slot);
    });

    // ── 2) BOOTE – zyklische Bootsführer-Rotation ─────────────────
    const openTowerIds = new Set(openTowers.map(t => t.id));
    const boatsManualClosed = boats.filter(b => ds.closedBoats.has(b.id));
    const boatsClosedTower  = boats.filter(b =>
      !ds.closedBoats.has(b.id) && b.towerId && b.towerId !== 'HW' && !openTowerIds.has(b.towerId));
    const openBoats = boats.filter(b =>
      !ds.closedBoats.has(b.id) &&
      (b.towerId === 'HW' || (b.towerId && openTowerIds.has(b.towerId))))
      .sort((a,b) => (a.prio - b.prio) || (a.id - b.id));

    const bfSorted = [...availB].sort((a,b) => a.id - b.id); // stabile Reihenfolge für Rotation
    const boatsNoBootsf = [];
    openBoats.forEach((bo, i) => {
      const slot = {
        kind:'boat', boatId:bo.id, name:bo.name, code:bo.code, prio:bo.prio,
        towerId:bo.towerId, towerName: towers.find(t => t.id === bo.towerId)?.name || '',
        occupants:[], bootsf:null
      };
      // Zyklische Wahl: Boot i bekommt BF (i + d) – schon verplante überspringen
      const n = bfSorted.length;
      let assigned = null;
      for(let off = 0; off < n; off++){
        const cand = bfSorted[(i + d + off) % n];
        if(cand && !usedToday.has(cand.id)){ assigned = cand; break; }
      }
      if(assigned){
        usedToday.add(assigned.id);
        slot.occupants.push(assigned);
        slot.bootsf = assigned;
        dayAssign.push(slot);
      } else {
        boatsNoBootsf.push(bo);
      }
    });

    // ── 3) HAUPTWACHE – alle übrigen ──────────────────────────────
    const fuehrung   = availF.filter(p => !usedToday.has(p.id));
    const bootsfLeft = availB.filter(p => !usedToday.has(p.id));
    const leftoverW  = [...partnerPool, ...leadPool].filter(p => !usedToday.has(p.id));
    leftoverW.sort((a,b) => ((stats[a.id]?.hwVisits || 0) - (stats[b.id]?.hwVisits || 0)) || (a.id - b.id));
    const mainGuards = leftoverW.slice(0, Math.min(k, leftoverW.length));
    const base       = leftoverW.slice(mainGuards.length);

    dayAssign.push({
      kind:'main', main:true, tower:'Hauptwache',
      fuehrung, mainGuards, base, bootsfLeft, sick:sickToday, k
    });

    const dayObj = {
      day:d, assign:dayAssign, openTowers, personnelClosed, manualClosed,
      boatsNoBootsf, boatsClosedTower, boatsManualClosed,
      availB, sickCount:sickToday.length
    };
    schedule.push(dayObj);

    // Stats + pairCount mit der bewährten Kern-Logik akkumulieren
    _reAccumulateDayStats(dayObj, d, stats, pairCount, ensure, pairKey);
  }

  lastResult = {
    schedule, pairCount, stats,
    peopleGuards: people.filter(p => p.role === 'W'),
    fairnessMetrics: computeFairnessMetrics(stats, people)
  };
  if(activeDay >= DAYS) activeDay = 0;
  renderOutput();
  autoSave();
}
