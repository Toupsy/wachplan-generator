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
  const ensure    = id => { if(!stats[id]) stats[id] = { total:0, towerVisits:{}, boatVisits:{} }; return stats[id]; };
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
    const dayForced   = (forcedPlacements[d] || []).filter(f => {
      const p = people.find(x => x.id === f.personId);
      return p && !isSick(p.id);   // kranke Personen ignorieren
    });
    const forcedIds   = new Set(dayForced.map(f => f.personId));

    const isForced = p => forcedIds.has(p.id);

    // Verfügbare Personen OHNE zwangsweise zugewiesene
    const availF    = people.filter(p => p.role==='F' && !isSick(p.id) && !isForced(p));
    const availB    = people.filter(p => p.role==='B' && !isSick(p.id) && !isForced(p));
    const availE    = people.filter(p => p.role==='E' && !isSick(p.id) && !isForced(p));
    const availU    = people.filter(p => p.role==='U' && !isSick(p.id) && !isForced(p));
    const sickToday = people.filter(p => isSick(p.id));

    // Erzwungene Personen nach Ziel gruppieren
    const forcedByTower = {};   // towerId -> [person, ...]  (max 2)
    const forcedByBoat  = {};   // boatId  -> person         (1 BF)
    const forcedForMain = [];   // für HW

    dayForced.forEach(f => {
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
    const preCandTowers = towers
      .filter(t => !ds.closed.has(t.id))
      .slice().sort((a,b) => (b.prio-a.prio)||(a.id-b.id));

    let usedGpre = k;
    const tempOpen = [];
    for(const t of preCandTowers){
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
    const candidateTowers = towers
      .filter(t => !ds.closed.has(t.id))
      .slice().sort((a,b) => (b.prio-a.prio)||(a.id-b.id));

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

    function bestPair(t, requireMix){
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
      s.towerVisits[t.id] = (s.towerVisits[t.id] || 0) + 1;
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
        const pair = bestPair(mainPseudo, false);
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

      // Algorithmus füllt verbleibende Plätze
      const need = 2 - slot.occupants.length;
      if(need === 2){
        const best = bestPair(t, true);
        if(best){
          const [A,B] = best;
          slot.occupants = [A,B];
          removeAll(A); removeAll(B);
          pairCount[pairKey(A.id,B.id)] = (pairCount[pairKey(A.id,B.id)]||0)+1;
          commitPerson(A,t); commitPerson(B,t);
          if((A.role+B.role)==='UU') slot.warn='Zwei Unerfahrene – kein Erfahrener frei';
        }
      } else if(need === 1){
        // 1 Platz noch offen – besten Einzelkandidaten wählen
        const cand = getGuardPool().sort((a,b) => {
          let s = (ensure(a.id).total - ensure(b.id).total);
          s += surplusBFPenalty(a, t) - surplusBFPenalty(b, t);
          return s;
        });
        const P = cand[0];
        if(P){
          slot.occupants.push(P);
          removeAll(P);
          commitPerson(P, t);
          // Paar mit dem vorabbelegten bilden – nur wenn Vorabbelegter nicht transparent
          if(slot.occupants.length === 2){
            const [A,B] = slot.occupants;
            pairCount[pairKey(A.id,B.id)] = (pairCount[pairKey(A.id,B.id)]||0)+1;
          }
          const roles = slot.occupants.map(x=>x.role).join('');
          if(roles==='UU') slot.warn='Zwei Unerfahrene – kein Erfahrener frei';
        }
      }
      // need === 0: beide Plätze zwangsbelegt, kein Algorithmus nötig
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
        return (sa.total-sb.total)||((sa.boatVisits[bo.id]||0)-(sb.boatVisits[bo.id]||0))||(a.id-b.id);
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
            return (sa.total-sb.total)||((sa.boatVisits[bo.id]||0)-(sb.boatVisits[bo.id]||0))||(a.id-b.id);
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

    schedule.push({
      day:d, assign:dayAssign, openTowers, personnelClosed, manualClosed,
      boatsNoBootsf, boatsClosedTower, boatsManualClosed,
      availB, sickCount:sickToday.length,
    });
  }

  lastResult = {
    schedule, pairCount, stats,
    peopleGuards: people.filter(p => p.role==='E' || p.role==='U'),
  };
  if(activeDay >= DAYS) activeDay = 0;
  renderOutput();
  autoSave();
}
