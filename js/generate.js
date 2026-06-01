// ============================================================
// generate.js – Kern-Algorithmus: Wachplan-Berechnung
// ============================================================

/**
 * Berechnet den 6-tägigen Wachplan.
 *
 * Neu gegenüber der Ursprungsversion:
 *  - Zwangszuweisungen (forcedPlacements) werden vor dem Algorithmus
 *    herausgelöst und vorbefüllt (Feature 3 & 4).
 *  - Überzählige Bootsführer werden mit einer hohen Strafe aus Türmen
 *    herausgehalten, an denen ein aktives Boot stationiert ist (Feature 5).
 *  - Wenn hwBoatId gesetzt ist, wird ein Bootsführer für das HW-Boot
 *    reserviert (Feature 6).
 */
function generate(){
  autoCodes();

  const pairCount = {};
  const stats     = {};
  const ensure    = id => {
    if(!stats[id]) stats[id] = {
      total: 0,
      towerVisits: {},
      boatVisits: {},
      hwVisits: 0,
      towerWithBoatDays: 0,
      boatCaptainPairings: {}
    };
    return stats[id];
  };
  const pairKey   = (a,b) => [a,b].sort((x,y)=>x-y).join('|');

  const schedule = [];
  const k = Math.max(0, mainK | 0);

  // Türme, an denen (für einen bestimmten Tag) ein aktives Boot liegt
  function towerHasActiveBoat(towerId, ds){
    return boats.some(b => b.towerId === towerId && !ds.closedBoats.has(b.id));
  }

  for(let d = 0; d < DAYS; d++){
    const ds     = dayState[d];
    const isSick = id => ds.sick.has(id);

    // ── Zwangszuweisungen für diesen Tag vorbereiten ──────────────
    const dayForced = (forcedPlacements[d] || []).filter(f => {
      const p = people.find(x => x.id === f.personId);
      return p && !isSick(p.id);
    });

    // transparent=true → Person bleibt im Pool; wird erst NACH dem Algorithmus
    //   visuell in den Zielslot verschoben; Statistik läuft unverändert durch
    //   → Folgetage sind identisch mit dem Originalplan
    // transparent=false → Person wird aus dem Pool entfernt, vor dem
    //   Algorithmus platziert, Statistik zählt mit
    const effectiveDayForced   = dayForced.filter(f => !f.transparent);
    const transparentDayForced = dayForced.filter(f =>  f.transparent);
    const effectiveForcedIds   = new Set(effectiveDayForced.map(f => f.personId));

    const isForced = p => effectiveForcedIds.has(p.id);  // nur effektive aus Pool entfernen

    // Verfügbare Personen OHNE effektiv-zwangsweise zugewiesene
    const byRole = {};
    people.forEach(p => {
      if(isSick(p.id) || isForced(p)) return;
      (byRole[p.role] || (byRole[p.role] = [])).push(p);
    });
    const availF = byRole['F'] || [], availB = byRole['B'] || [],
          availE = byRole['E'] || [], availU = byRole['U'] || [];
    const sickToday = people.filter(p => isSick(p.id));

    // Effektive Zwangszuweisungen nach Ziel gruppieren
    const forcedByTower = {};
    const forcedByBoat  = {};
    const forcedForMain = [];

    effectiveDayForced.forEach(f => {
      const p = people.find(x => x.id === f.personId);
      if(!p) return;
      if(f.kind === 'tower'){
        if(!forcedByTower[f.slotId]) forcedByTower[f.slotId] = [];
        if(forcedByTower[f.slotId].length < 2) forcedByTower[f.slotId].push(p);
      } else if(f.kind === 'boat'){
        if(!forcedByBoat[f.slotId]) forcedByBoat[f.slotId] = p;
      } else if(f.kind === 'main'){
        forcedForMain.push(p);
      }
    });

    // ── Feature 6: HW-Boot ────────────────────────────────────────
    // Falls ein Boot der HW zugewiesen ist und heute nicht außer Dienst
    const hwBoatActive = hwBoatId
      && !ds.closedBoats.has(hwBoatId)
      && boats.some(b => b.id === hwBoatId);

    // ── Vorab-Schätzung der BF-Aufteilung ────────────────────────
    const openTowersSorted = towers
      .filter(t => !ds.closed.has(t.id))
      .slice().sort((a,b) => (b.prio-a.prio)||(a.id-b.id));

    let usedGpre = k;
    const tempOpen = [];
    for(const t of openTowersSorted){
      if(usedGpre + 2 <= availE.length + availU.length){ tempOpen.push(t); usedGpre += 2; }
    }
    // Boote, für die BF benötigt werden (ohne HW-Boot)
    const towersWithPreOpen = new Set(tempOpen.map(t => t.id));
    const boatsPre = boats.filter(b =>
      !ds.closedBoats.has(b.id) &&
      b.towerId &&
      towersWithPreOpen.has(b.towerId) &&
      b.id !== hwBoatId
    );
    // HW-Boot zählt ebenfalls als BF-Bedarf
    const hwBoatBFNeeded = hwBoatActive ? 1 : 0;

    const neededBF  = Math.min(boatsPre.length + hwBoatBFNeeded, availB.length);
    const activeBF  = availB.slice(0, neededBF);
    const surplusBF = availB.slice(neededBF);

    // ── Kandidaten-Türme für echte Öffnungsentscheidung ──────────
    const candidateTowers = openTowersSorted;

    let poolE   = [...availE];
    let poolU   = [...availU];
    let poolSBF = [...surplusBF];
    let poolB   = [...activeBF];

    const getGuardPool = () => [...poolE, ...poolU, ...poolSBF];
    const removeAll    = p  => {
      poolE   = poolE.filter(x   => x.id !== p.id);
      poolU   = poolU.filter(x   => x.id !== p.id);
      poolSBF = poolSBF.filter(x => x.id !== p.id);
    };

    let openTowers = [], usedG = k;
    // Vorabbelegte Türme brauchen ggf. weniger Pool-Personen
    for(const t of candidateTowers){
      const preCount = (forcedByTower[t.id] || []).length;
      const need     = Math.max(0, 2 - preCount);
      if(usedG + need <= getGuardPool().length){ openTowers.push(t); usedG += need; }
    }
    const personnelClosed = candidateTowers
      .filter(t => !openTowers.includes(t))
      .sort((a,b) => (a.prio-b.prio)||(a.id-b.id));
    const manualClosed = towers.filter(t => ds.closed.has(t.id));

    const dayAssign = [];

    // ── Scoring ──────────────────────────────────────────────────
    /**
     * Feature 5: Surplus-BFs meiden Türme mit aktivem Boot.
     * @param {object} candidate  – Person aus dem Pool
     * @param {object} tower      – Zielturm (für MAIN_ID: keine Einschränkung)
     * @returns {number} Zusatzstrafe
     */
    function surplusBFPenalty(candidate, tower){
      if(!poolSBF.some(x => x.id === candidate.id)) return 0;
      if(!tower || tower.id === MAIN_ID) return 0;
      return towerHasActiveBoat(tower.id, ds) ? 800 : 0;
    }

    // Feature: Consecutive day penalty – prevent same person on same tower on consecutive days
    function checkConsecutiveTowerPenalty(personA, personB, towerId, currentDay){
      if(currentDay === 0 || !schedule[currentDay-1]) return 0;
      const slot = schedule[currentDay-1].assign.find(s => s.kind==='tower' && s.towerId===towerId);
      if(!slot) return 0;
      let p = 0;
      if(slot.occupants.some(x => x.id === personA.id)) p += 200;
      if(slot.occupants.some(x => x.id === personB.id)) p += 200;
      return p;
    }

    function bestPair(t, requireMix, currentDay){
      const cand = getGuardPool();
      let best = null, bestScore = Infinity;
      for(let i = 0; i < cand.length; i++){
        for(let j = i + 1; j < cand.length; j++){
          const A = cand[i], B = cand[j], roles = A.role + B.role;
          let score = 0;
          if(requireMix){
            if(roles === 'UU') score += 1000;
            else if(roles === 'EE') score += 40;
          }
          score += (pairCount[pairKey(A.id, B.id)] || 0) * 120;
          const vA = ensure(A.id).towerVisits[t.id] || 0;
          const vB = ensure(B.id).towerVisits[t.id] || 0;
          score += vA >= 2 ? 300 : vA * 30;
          score += vB >= 2 ? 300 : vB * 30;
          score += (stats[A.id].total + stats[B.id].total) * 5;
          score += surplusBFPenalty(A, t) + surplusBFPenalty(B, t);
          // Feature: Consecutive day penalty – prevent same person on same tower
          if(t.id !== MAIN_ID){
            score += checkConsecutiveTowerPenalty(A, B, t.id, currentDay);
          }
          // NEW: Tower+Boat balance penalty – prefer variety
          const hiBothBoat = (ensure(A.id).towerWithBoatDays > 2 && ensure(B.id).towerWithBoatDays > 2);
          score += hiBothBoat ? 150 : 0;
          // NEW: HW balance bonus – if assigning to tower and people have many HW days, prefer this
          if(t.id !== MAIN_ID){
            const hiHwA = (ensure(A.id).hwVisits > 2), hiHwB = (ensure(B.id).hwVisits > 2);
            if(hiHwA || hiHwB) score -= 50;  // Bonus (negative penalty) for people with high HW days
          }
          score += (d === 0 && randomSeed !== 0)
            ? seededRand(randomSeed, A.id*31 + B.id*97 + t.id*13) * 30
            : (i*7 + j*13 + d*17) % 11;
          if(score < bestScore){ bestScore = score; best = [A, B]; }
        }
      }
      return best;
    }
    function commitPerson(p, t){
      const s = ensure(p.id);
      s.total++;
      if(t.id === MAIN_ID){
        s.hwVisits++;
      } else {
        s.towerVisits[t.id] = (s.towerVisits[t.id] || 0) + 1;
        if(towerHasActiveBoat(t.id, ds)){
          s.towerWithBoatDays++;
        }
      }
    }

    // ── 1) HAUPTWACHE ──────────────────────────────────────────────
    const mainPseudo = { id: MAIN_ID };
    const mainGuards = [];

    // Zwangsweise HW-Zuweisungen zuerst
    forcedForMain.forEach(p => {
      commitPerson(p, mainPseudo);
      mainGuards.push(p);
    });

    while(mainGuards.length < k && getGuardPool().length > 0){
      const remaining = k - mainGuards.length;
      if(remaining >= 2 && getGuardPool().length >= 2){
        const pair = bestPair(mainPseudo, false, d);
        if(!pair) break;
        const [A, B] = pair;
        removeAll(A); removeAll(B);
        pairCount[pairKey(A.id, B.id)] = (pairCount[pairKey(A.id, B.id)] || 0) + 1;
        commitPerson(A, mainPseudo); commitPerson(B, mainPseudo);
        mainGuards.push(A, B);
      } else {
        const cand = getGuardPool().sort((a,b) =>
          (ensure(a.id).total - ensure(b.id).total) ||
          ((ensure(a.id).towerVisits[MAIN_ID]||0) - (ensure(b.id).towerVisits[MAIN_ID]||0)));
        const P = cand[0]; if(!P) break;
        removeAll(P); commitPerson(P, mainPseudo); mainGuards.push(P);
      }
    }

    // ── 2) TÜRME (je 2 Wachgänger) ────────────────────────────────
    for(const t of openTowers){
      const slot = { kind:'tower', towerId:t.id, tower:t.name, code:t.code, prio:t.prio, occupants:[], warn:null };

      // Zwangsbelegte Plätze bereits vorab eintragen
      const pre = (forcedByTower[t.id] || []);
      pre.forEach(p => { commitPerson(p, t); slot.occupants.push(p); });

      // Algorithmus füllt verbleibende Plätze (variable Slot-Anzahl)
      const totalSlots = t.slotCount || 2;
      let need = totalSlots - slot.occupants.length;
      const wasEmpty = slot.occupants.length === 0;
      let pairsAdded = 0;
      while(need > 0){
        if(need >= 2){
          // requireMix=true nur beim ersten Paar, falls Slot ursprünglich leer war
          const best = bestPair(t, wasEmpty && pairsAdded === 0, d);
          if(!best) break;
          const [A,B] = best;
          slot.occupants.push(A, B);
          removeAll(A); removeAll(B);
          pairCount[pairKey(A.id,B.id)] = (pairCount[pairKey(A.id,B.id)]||0)+1;
          commitPerson(A,t); commitPerson(B,t);
          if((A.role+B.role)==='UU') slot.warn='Zwei Unerfahrene – kein Erfahrener frei';
          need -= 2;
          pairsAdded++;
        } else {
          const cand = getGuardPool().sort((a,b) => {
            let s = (ensure(a.id).total - ensure(b.id).total);
            s += surplusBFPenalty(a, t) - surplusBFPenalty(b, t);
            return s;
          });
          if(!cand[0]) break;
          slot.occupants.push(cand[0]);
          removeAll(cand[0]);
          commitPerson(cand[0], t);
          need--;
        }
      }
      dayAssign.push(slot);
    }

    // ── 3) BOOTE (je 1 Bootsführer) ───────────────────────────────
    const boatCandidates = boats.slice()
      .filter(b => !ds.closedBoats.has(b.id) && b.id !== hwBoatId)
      .filter(b => b.towerId && openTowers.some(t => t.id === b.towerId))
      .sort((a,b) => (b.prio-a.prio)||(a.id-b.id));

    const boatsNoBootsf     = [];
    const boatsClosedTower  = [];
    const boatsManualClosed = [];

    boats.forEach(b => {
      if(b.id === hwBoatId) return;   // HW-Boot separat
      if(ds.closedBoats.has(b.id))                                   boatsManualClosed.push(b);
      else if(b.towerId && !openTowers.some(t => t.id === b.towerId)) boatsClosedTower.push(b);
    });

    for(const bo of boatCandidates){
      const slot = {
        kind:'boat', boatId:bo.id, name:bo.name, code:bo.code, prio:bo.prio,
        towerId:bo.towerId, towerName:towers.find(t=>t.id===bo.towerId)?.name||'',
        bootsf:null,
      };
      // Zwangszuweisung für dieses Boot?
      const forceForThisBoat = forcedByBoat[bo.id];
      if(forceForThisBoat){
        slot.bootsf = forceForThisBoat;
        const s = ensure(forceForThisBoat.id);
        s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
        dayAssign.push(slot);
        continue;
      }
      poolB.sort((a,b) => {
        const sa = ensure(a.id), sb = ensure(b.id);
        // Primary: balance total workload
        let scoreA = sa.total;
        let scoreB = sb.total;
        // Secondary: penalize repeated boat assignments (boat rotation fairness)
        scoreA += (sa.boatVisits[bo.id] || 0) * 50;
        scoreB += (sb.boatVisits[bo.id] || 0) * 50;
        // Tertiary: balance HW visits (prefer those with fewer HW visits for boat duty)
        scoreA += (sa.hwVisits || 0) * 5;
        scoreB += (sb.hwVisits || 0) * 5;
        return scoreA - scoreB || (a.id - b.id);
      });
      const bf = poolB.shift();
      if(bf){
        slot.bootsf = bf;
        const s = ensure(bf.id);
        s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
        dayAssign.push(slot);
      } else {
        boatsNoBootsf.push(bo);
      }
    }

    // NEW: Track boat captain + tower person pairings for fairness
    // After boats are assigned, identify which captain works with which tower people
    for(const boatSlot of dayAssign.filter(s => s.kind === 'boat')){
      if(boatSlot.bootsf){
        const towerSlot = dayAssign.find(s => s.kind === 'tower' && s.towerId === boatSlot.towerId);
        if(towerSlot){
          const captainId = boatSlot.bootsf.id;
          towerSlot.occupants.forEach(occupant => {
            const s = ensure(occupant.id);
            s.boatCaptainPairings[captainId] = (s.boatCaptainPairings[captainId] || 0) + 1;
          });
        }
      }
    }

    // ── 4) HW-Boot (Feature 6) ─────────────────────────────────────
    let hwBoatSlot = null;
    if(hwBoatActive){
      const bo = boats.find(b => b.id === hwBoatId);
      if(bo){
        hwBoatSlot = {
          kind:'hwboat', boatId:bo.id, name:bo.name, code:bo.code, bootsf:null,
        };
        const forceHW = forcedByBoat[bo.id];
        if(forceHW){
          hwBoatSlot.bootsf = forceHW;
          const s = ensure(forceHW.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
        } else {
          poolB.sort((a,b) => {
            const sa=ensure(a.id),sb=ensure(b.id);
            let scoreA = sa.total + (sa.boatVisits[bo.id]||0)*50 + (sa.hwVisits||0)*5;
            let scoreB = sb.total + (sb.boatVisits[bo.id]||0)*50 + (sb.hwVisits||0)*5;
            return scoreA - scoreB || (a.id - b.id);
          });
          const bf = poolB.shift();
          if(bf){
            hwBoatSlot.bootsf = bf;
            const s = ensure(bf.id);
            s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
          }
        }
      }
    }

    // ── 5) HAUPTWACHE finalize ──────────────────────────────────────
    const leftovers = [...poolE, ...poolU, ...poolSBF];
    dayAssign.push({
      kind:'main', main:true, tower:'Hauptwache',
      fuehrung:availF, mainGuards, base:leftovers,
      bootsfLeft:poolB, hwBoatSlot,
      sick:sickToday, k,
    });

    // ── 6) TRANSPARENTE Zuweisungen: visueller Tausch NACH dem Algorithmus ──
    // Person bleibt im Pool → Statistik identisch zum Originalplan.
    // Nur die Anzeige für diesen Tag wird überschrieben.
    transparentDayForced.forEach(f => {
      const person = people.find(x => x.id === f.personId);
      if(!person) return;
      // Aus natürlichem Slot entfernen
      dayAssign.forEach(slot => {
        if(slot.kind === 'tower')
          slot.occupants = slot.occupants.filter(p => p.id !== f.personId);
        else if(slot.kind === 'boat' && slot.bootsf?.id === f.personId)
          slot.bootsf = null;
        else if(slot.kind === 'main'){
          slot.fuehrung   = slot.fuehrung.filter(p => p.id !== f.personId);
          slot.mainGuards = slot.mainGuards.filter(p => p.id !== f.personId);
          slot.base       = slot.base.filter(p => p.id !== f.personId);
          slot.bootsfLeft = slot.bootsfLeft.filter(p => p.id !== f.personId);
          if(slot.hwBoatSlot?.bootsf?.id === f.personId) slot.hwBoatSlot.bootsf = null;
        }
      });
      // In Zielslot einfügen
      if(f.kind === 'tower'){
        const s = dayAssign.find(s => s.kind === 'tower' && s.towerId === f.slotId);
        if(s) s.occupants.push(person);
      } else if(f.kind === 'boat'){
        const s = dayAssign.find(s => s.kind === 'boat' && s.boatId === f.slotId);
        if(s) s.bootsf = person;
        else {
          const m = dayAssign.find(s => s.kind === 'main');
          if(m?.hwBoatSlot?.boatId === f.slotId) m.hwBoatSlot.bootsf = person;
        }
      } else if(f.kind === 'main' || f.kind === 'hwboat'){
        const m = dayAssign.find(s => s.kind === 'main');
        if(m) m.mainGuards.push(person);
      }
    });

    schedule.push({
      day:d, assign:dayAssign, openTowers, personnelClosed, manualClosed,
      boatsNoBootsf, boatsClosedTower, boatsManualClosed,
      availB, sickCount:sickToday.length,
    });
  }

  // Calculate fairness metrics
  const allStats = Object.values(stats);

  // Tower distribution: count unique towers per person
  const towerDistribution = {};
  people.forEach(p => {
    const stat = stats[p.id];
    if(stat && stat.towerVisits) {
      towerDistribution[p.id] = Object.keys(stat.towerVisits).length;
    } else {
      towerDistribution[p.id] = 0;
    }
  });

  const avgUniqueTowers = allStats.length > 0
    ? (Object.values(towerDistribution).reduce((a,b) => a+b, 0) / allStats.length).toFixed(1)
    : 0;
  const minUniqueTowers = Math.min(...Object.values(towerDistribution), 0);

  const avgHwVisits = allStats.length > 0
    ? (allStats.reduce((sum, s) => sum + (s.hwVisits || 0), 0) / allStats.length).toFixed(1)
    : 0;
  const avgTowerWithBoatDays = allStats.length > 0
    ? (allStats.reduce((sum, s) => sum + (s.towerWithBoatDays || 0), 0) / allStats.length).toFixed(1)
    : 0;
  const maxHwVisits = Math.max(...allStats.map(s => s.hwVisits || 0), 0);
  const maxTowerWithBoatDays = Math.max(...allStats.map(s => s.towerWithBoatDays || 0), 0);

  const boatPairingDiversity = (() => {
    let maxRepeats = 0;
    let totalPairings = 0;
    let diversePairings = 0;
    Object.values(stats).forEach(s => {
      Object.values(s.boatCaptainPairings || {}).forEach(count => {
        totalPairings++;
        if(count === 1) diversePairings++;
        if(count > maxRepeats) maxRepeats = count;
      });
    });
    return {
      maxRepeats,
      totalPairings,
      diversePairings,
      diversePercent: totalPairings > 0 ? ((diversePairings / totalPairings) * 100).toFixed(0) : 0
    };
  })();

  lastResult = {
    schedule, pairCount, stats,
    peopleGuards: people.filter(p => p.role==='E' || p.role==='U'),
    fairnessMetrics: {
      hwBalance: {
        avgHwVisits: parseFloat(avgHwVisits),
        avgTowerWithBoatDays: parseFloat(avgTowerWithBoatDays),
        maxHwVisits,
        maxTowerWithBoatDays,
        isBalanced: Math.abs(parseFloat(avgHwVisits) - parseFloat(avgTowerWithBoatDays)) < 1.5
      },
      boatPairingDiversity,
      towerDistribution: {
        avgUniqueTowers: parseFloat(avgUniqueTowers),
        minUniqueTowers,
        distribution: towerDistribution
      }
    }
  };
  if(activeDay >= DAYS) activeDay = 0;
  renderOutput();
  autoSave();
}
