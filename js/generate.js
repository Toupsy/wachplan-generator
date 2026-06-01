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
/**
 * Akkumuliert Stats + pairCount aus einem bereits berechneten Tages-Schedule.
 * Wird von generate(startDay > 0) genutzt, um Stats aus bestehenden Tagen
 * wiederherzustellen, bevor Folgetage neu generiert werden.
 */
function _reAccumulateDayStats(daySchedule, dayIdx, stats, pairCount, ensure, pairKey){
  // Welche Türme hatten an diesem Tag ein aktives Boot?
  const activeTowerBoats = {};
  daySchedule.assign.forEach(slot => {
    if(slot.kind === 'boat' && slot.towerId && slot.occupants?.length > 0){
      activeTowerBoats[slot.towerId] = slot.boatId;
    }
  });

  daySchedule.assign.forEach(slot => {
    if(slot.kind === 'tower'){
      const tId = slot.towerId;
      const hasBoat = tId in activeTowerBoats;
      slot.occupants.forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.towerVisits[tId] = (s.towerVisits[tId] || 0) + 1;
        if(hasBoat) s.towerWithBoatDays++;
      });
      // Paar-Zähler
      for(let i = 0; i < slot.occupants.length - 1; i++){
        for(let j = i+1; j < slot.occupants.length; j++){
          const key = pairKey(slot.occupants[i].id, slot.occupants[j].id);
          pairCount[key] = (pairCount[key] || 0) + 1;
        }
      }
      // boatCaptainPairings: Turm-Personen × Boot-Kapitän
      const boatId = activeTowerBoats[tId];
      if(boatId){
        const boatSlot = daySchedule.assign.find(bs => bs.kind === 'boat' && bs.boatId === boatId);
        const captain = boatSlot?.occupants?.[0];
        if(captain){
          slot.occupants.forEach(tp => {
            if(tp.id !== captain.id){
              const s = ensure(tp.id);
              s.boatCaptainPairings[captain.id] = (s.boatCaptainPairings[captain.id] || 0) + 1;
            }
          });
        }
      }
    } else if(slot.kind === 'boat'){
      slot.occupants.forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.boatVisits[slot.boatId] = (s.boatVisits[slot.boatId] || 0) + 1;
      });
    } else if(slot.kind === 'main'){
      // Aktive HW-Personen (Führung + mainGuards): total++ + hwVisits++
      [...(slot.fuehrung || []), ...(slot.mainGuards || [])].forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.hwVisits++;
      });
      // Overflow (base + bootsfLeft): nur hwVisits++
      [...(slot.base || []), ...(slot.bootsfLeft || [])].forEach(p => {
        ensure(p.id).hwVisits++;
      });
      // HW-Boot Kapitän
      if(slot.hwBoatSlot?.bootsf){
        const p = slot.hwBoatSlot.bootsf;
        const s = ensure(p.id);
        s.total++;
        s.boatVisits[slot.hwBoatSlot.boatId] = (s.boatVisits[slot.hwBoatSlot.boatId] || 0) + 1;
      }
    }
  });
}

/**
 * Berechnet den Wachplan.
 * @param {number} startDay  Erster Tag der NEU berechnet wird (Standard: 0).
 *   Wenn > 0: lastResult.schedule[0..startDay-1] bleibt erhalten,
 *   Stats werden aus diesen Tagen akkumuliert, danach werden
 *   Tage startDay..DAYS-1 frisch generiert.
 */
function generate(startDay = 0){
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

  // Wenn startDay > 0: bestehende Tage übernehmen + Stats daraus akkumulieren
  if(startDay > 0 && lastResult?.schedule){
    for(let d = 0; d < Math.min(startDay, lastResult.schedule.length); d++){
      schedule.push(lastResult.schedule[d]);
      _reAccumulateDayStats(lastResult.schedule[d], d, stats, pairCount, ensure, pairKey);
    }
  }

  for(let d = startDay; d < DAYS; d++){
    const ds     = dayState[d];
    const isSick = id => ds.sick.has(id);

    // Türme mit aktivem Boot / außer-Dienst-Boot für DIESEN Tag vorberechnen
    const activeBoatTowers = new Set();
    const closedBoatTowers = new Set();
    boats.forEach(b => {
      if(!b.towerId || b.towerId === 'HW') return;
      if(ds.closedBoats.has(b.id)) closedBoatTowers.add(b.towerId);
      else activeBoatTowers.add(b.towerId);
    });
    const towerHasActiveBoat = towerId => activeBoatTowers.has(towerId);

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

    // Zusätzlich: nur EFFEKTIV forcierte Personen aus Pools entfernen
    // Transparent forcierte Personen bleiben im Pool, werden normal eingeplant,
    // dann visuell verschoben (am Ende des Tags)
    const removeFromPools = (id) => {
      const person = people.find(x => x.id === id);
      if(!person) return;
      // Remove from all pools
      const idx_f = availF.findIndex(x => x.id === id);
      if(idx_f >= 0) availF.splice(idx_f, 1);
      const idx_b = availB.findIndex(x => x.id === id);
      if(idx_b >= 0) availB.splice(idx_b, 1);
      const idx_e = availE.findIndex(x => x.id === id);
      if(idx_e >= 0) availE.splice(idx_e, 1);
      const idx_u = availU.findIndex(x => x.id === id);
      if(idx_u >= 0) availU.splice(idx_u, 1);
    };
    // Remove only EFFECTIVE forced persons (transparent stay in pools)
    effectiveDayForced.forEach(f => removeFromPools(f.personId));

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
        if(!forcedByBoat[f.slotId]) forcedByBoat[f.slotId] = [];
        forcedByBoat[f.slotId].push(p);  // Boot kann auch mehrere Plätze haben (slotCount)
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

    // BFs nach Fairness sortieren, BEVOR aktiveBF/surplusBF-Aufteilung:
    // Wer weniger Bootstage hat UND mehr HW-Tage, kommt zuerst in den Boot-Pool.
    // Ohne diese Sortierung bekäme immer die erste Person in der Liste den Boot-Slot.
    availB.sort((a,b) => {
      const sa = ensure(a.id), sb = ensure(b.id);
      const boatA = Object.values(sa.boatVisits||{}).reduce((s,v)=>s+v,0);
      const boatB = Object.values(sb.boatVisits||{}).reduce((s,v)=>s+v,0);
      return (boatA * 50 - (sa.hwVisits||0) * 10) - (boatB * 50 - (sb.hwVisits||0) * 10)
          || (a.id - b.id);
    });
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

    // Wenn forcedForMain bereits k Guard-Slots füllt, müssen wir weniger aus dem
    // Guard-Pool reservieren (z.B. wenn _freezeDay alle Personen einfriert)
    const guardRoles = new Set(['E','U','B']);
    const preForcedGuards = forcedForMain.filter(p => guardRoles.has(p.role)).length;
    let openTowers = [], usedG = Math.max(0, k - preForcedGuards);
    // Vorabbelegte Türme brauchen ggf. weniger Pool-Personen
    for(const t of candidateTowers){
      const preCount = (forcedByTower[t.id] || []).length;
      const need     = Math.max(0, (t.slotCount || 2) - preCount);
      // need===0: Turm ist voll vorbelegt → immer öffnen (kein Pool nötig)
      if(need === 0 || usedG + need <= getGuardPool().length){ openTowers.push(t); usedG += need; }
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
      return towerHasActiveBoat(tower.id) ? 800 : 0;
    }

    function bestPair(t, requireMix, currentDay){
      const cand   = getGuardPool();
      const isMain = t.id === MAIN_ID;
      let best = null, bestScore = Infinity;
      // Feature 8: Personen die GESTERN auf diesem Turm waren einmalig vorberechnen
      // (statt pro Paar erneut den Vortag zu durchsuchen → O(n²·m) ⇒ O(m + n²))
      let prevTowerSet = null;
      if(!isMain && currentDay > 0 && schedule[currentDay-1]){
        const slot = schedule[currentDay-1].assign.find(s => s.kind==='tower' && s.towerId===t.id);
        if(slot) prevTowerSet = new Set(slot.occupants.map(p => p.id));
      }
      for(let i = 0; i < cand.length; i++){
        for(let j = i + 1; j < cand.length; j++){
          const A = cand[i], B = cand[j], roles = A.role + B.role;
          const sA = ensure(A.id), sB = ensure(B.id);
          let score = 0;
          if(requireMix){
            if(roles === 'UU') score += 1000;
            else if(roles === 'EE') score += 40;
          }
          score += (pairCount[pairKey(A.id, B.id)] || 0) * 120;
          const vA = sA.towerVisits[t.id] || 0;
          const vB = sB.towerVisits[t.id] || 0;
          score += vA >= 2 ? 300 : vA * 30;
          score += vB >= 2 ? 300 : vB * 30;
          score += (sA.total + sB.total) * 5;
          score += surplusBFPenalty(A, t) + surplusBFPenalty(B, t);
          if(!isMain){
            // Feature 8: Konsekutive Tage auf gleichem Turm bestrafen (+200 pro Person)
            if(prevTowerSet){
              if(prevTowerSet.has(A.id)) score += 200;
              if(prevTowerSet.has(B.id)) score += 200;
            }
            // Tower+Boat-Balance: zwei "Boot-lastige" Personen meiden
            if(sA.towerWithBoatDays > 2 && sB.towerWithBoatDays > 2) score += 150;
            // HW-Balance: proportionaler Bonus je mehr HW-Tage (inkl. Overflow-Tage)
            score -= sA.hwVisits * 60;
            score -= sB.hwVisits * 60;
            // Boot außer Dienst: surplusBF bevorzugt zum Turm des außer-Dienst-Boots
            if(closedBoatTowers.has(t.id)){
              if(poolSBF.some(x => x.id === A.id)) score -= 350;
              if(poolSBF.some(x => x.id === B.id)) score -= 350;
            }
          } else {
            // HW k-Slot-Auswahl: Personen mit vielen HW-Tagen NICHT nochmal auf HW
            score += sA.hwVisits * 60;
            score += sB.hwVisits * 60;
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
        if(towerHasActiveBoat(t.id)){
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
          ((ensure(a.id).hwVisits||0) - (ensure(b.id).hwVisits||0))); // weniger HW → bevorzugt
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
        // Wenn bereits 1 forcierte Person vorhanden: NUR einzelne Person hinzufügen (nicht Paar)
        // um mit der forcierten Person zu paaren
        // WICHTIG: Neu berechnen bei jedem Loop-Durchgang, da slot.occupants wächst
        const hasForcedSingle = pre.length === 1 && slot.occupants.length === 1;

        if(need >= 2 && !hasForcedSingle){
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

    // WICHTIG: Verarbeite ZUERST forcierte Boote (auch wenn ihr Turm nicht offen ist)
    // Dann normale Boote von boatCandidates
    const allBoatsToProcess = [
      ...Object.keys(forcedByBoat).map(boatId => boats.find(b => b.id === +boatId)).filter(Boolean),
      ...boatCandidates
    ];
    // Duplikate entfernen (forcierte Boote die auch in boatCandidates sind)
    const seenBoatIds = new Set();
    const boatsProcessed = [];
    allBoatsToProcess.forEach(bo => {
      if(!seenBoatIds.has(bo.id)) {
        seenBoatIds.add(bo.id);
        boatsProcessed.push(bo);
      }
    });

    for(const bo of boatsProcessed){
      const slot = {
        kind:'boat', boatId:bo.id, name:bo.name, code:bo.code, prio:bo.prio,
        towerId:bo.towerId, towerName:towers.find(t=>t.id===bo.towerId)?.name||'',
        occupants:[], bootsf:null,  // occupants für alle Personen, bootsf für Anzeige-Kompatibilität
      };
      // Zwangszuweisung für dieses Boot?
      const forcedArray = forcedByBoat[bo.id];
      if(forcedArray && forcedArray.length > 0){
        // Alle erzwungenen Personen hinzufügen (bis slotCount)
        for(let i = 0; i < Math.min(forcedArray.length, bo.slotCount||1); i++){
          const person = forcedArray[i];
          slot.occupants.push(person);
          if(i === 0) slot.bootsf = person;  // Erste Person als Bootsführer für Anzeige
          const s = ensure(person.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
        }
        dayAssign.push(slot);
        continue;
      }
      // Fülle Boot bis slotCount mit fairness-Scoring
      const neededSlots = bo.slotCount || 1;
      poolB.sort((a,b) => {
        const sa = ensure(a.id), sb = ensure(b.id);
        let scoreA = sa.total;
        let scoreB = sb.total;
        scoreA += (sa.boatVisits[bo.id] || 0) * 50;
        scoreB += (sb.boatVisits[bo.id] || 0) * 50;
        scoreA -= (sa.hwVisits || 0) * 10;
        scoreB -= (sb.hwVisits || 0) * 10;
        return scoreA - scoreB || (a.id - b.id);
      });

      let assigned = 0;
      while(assigned < neededSlots && poolB.length > 0){
        const bf = poolB.shift();
        if(bf){
          slot.occupants.push(bf);
          if(assigned === 0) slot.bootsf = bf;  // Erste Person als Bootsführer
          const s = ensure(bf.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
          assigned++;
        } else {
          break;
        }
      }

      if(slot.occupants.length > 0){
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
        const forcedArray = forcedByBoat[bo.id];
        if(forcedArray && forcedArray.length > 0){
          // Letzte forcierte Person für HW-Boot
          const forceHW = forcedArray[forcedArray.length - 1];
          hwBoatSlot.bootsf = forceHW;
          const s = ensure(forceHW.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
        } else {
          poolB.sort((a,b) => {
            const sa=ensure(a.id),sb=ensure(b.id);
            // HW-Besuche negativ: BF mit mehr HW-Tagen bevorzugt fürs HW-Boot
            let scoreA = sa.total + (sa.boatVisits[bo.id]||0)*50 - (sa.hwVisits||0)*10;
            let scoreB = sb.total + (sb.boatVisits[bo.id]||0)*50 - (sb.hwVisits||0)*10;
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

    // HW-Besuche für ALLE passiven HW-Personen (Overflow + übrige BF) tracken.
    // mainGuards bekommen hwVisits bereits via commitPerson.
    // Ohne dieses Tracking denkt der Algorithmus, Overflow-Personen waren nie an HW
    // → sie häufen sich immer in der Overflow-Liste an statt zu rotieren.
    leftovers.forEach(p => ensure(p.id).hwVisits++);
    poolB.forEach(p => ensure(p.id).hwVisits++);

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
        else if(slot.kind === 'boat'){
          slot.occupants = slot.occupants.filter(p => p.id !== f.personId);
          if(slot.occupants.length > 0) slot.bootsf = slot.occupants[0];
          else slot.bootsf = null;
        }
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
        if(s){
          s.occupants.push(person);
          if(!s.bootsf) s.bootsf = person;  // Erste Person als bootsf für Display-Kompatibilität
        } else {
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
