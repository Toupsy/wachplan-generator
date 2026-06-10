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
        s.lastBoatId = slot.boatId;  // Track for rotation penalty on next day
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
      boatCaptainPairings: {},
      lastBoatId: null  // Track BF's previous boat for rotation penalty
    };
    return stats[id];
  };
  const pairKey   = (a,b) => a < b ? a + '|' + b : b + '|' + a;

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
    const ds     = dayState[d] || { sick: new Set(), closed: new Set(), closedBoats: new Set() };
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
    // availE/availU werden aus den Wachgängern (role 'W') über das experienced-Flag
    // abgeleitet → die tiefe Pool-Logik (poolE/poolU, getGuardPool) bleibt unverändert.
    const availF = byRole['F'] || [], availB = byRole['B'] || [];
    const guardsW = byRole['W'] || [];
    const availE  = guardsW.filter(p =>  p.experienced);
    const availU  = guardsW.filter(p => !p.experienced);
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
        const tower = towers.find(t => t.id === f.slotId);
        const maxSlots = tower ? (tower.slotCount || 2) + (tower.leaderCount || 0) : 2;
        if(forcedByTower[f.slotId].length < maxSlots) forcedByTower[f.slotId].push(p);
      } else if(f.kind === 'boat'){
        if(!forcedByBoat[f.slotId]) forcedByBoat[f.slotId] = [];
        forcedByBoat[f.slotId].push(p);  // Boot kann auch mehrere Plätze haben (slotCount)
      } else if(f.kind === 'main'){
        forcedForMain.push(p);
      }
    });

    // ── Vorab-Schätzung der BF-Aufteilung ────────────────────────
    // Sortierung ASC nach prio: Prio 1 = wichtigster Turm → wird ZUERST geöffnet
    // (bleibt offen) → schließt ZULETZT bei Personalmangel. Höhere Prio-Nummern
    // (z.B. 7) sind unwichtiger → werden zuerst geschlossen.
    const openTowersSorted = towers
      .filter(t => !ds.closed.has(t.id))
      .slice().sort((a,b) => (a.prio-b.prio)||(a.id-b.id));

    let usedGpre = k;
    const tempOpen = [];
    // Verfügbare Turm-"Körper" für die Schätzung: E + U + alle BF. surplusBF ist
    // hier noch nicht bekannt (es wird erst aus dieser Schätzung abgeleitet) →
    // availB als Obergrenze, da überzählige BF real ebenfalls Turmplätze besetzen.
    const availBodiesPre = availE.length + availU.length + availB.length;
    for(const t of openTowersSorted){
      const totalSlots = (t.slotCount || 2) + (t.leaderCount || 0);
      if(usedGpre + totalSlots <= availBodiesPre){ tempOpen.push(t); usedGpre += totalSlots; }
    }
    // Boote, für die BF benötigt werden
    const towersWithPreOpen = new Set(tempOpen.map(t => t.id));
    const boatsPre = boats.filter(b =>
      !ds.closedBoats.has(b.id) &&
      b.towerId &&
      towersWithPreOpen.has(b.towerId)
    );

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
    const neededBF  = Math.min(boatsPre.length, availB.length);
    const activeBF  = availB.slice(0, neededBF);
    const surplusBF = availB.slice(neededBF);

    // ── Kandidaten-Türme für echte Öffnungsentscheidung ──────────
    const candidateTowers = openTowersSorted;

    let poolE   = [...availE];
    let poolU   = [...availU];
    let poolSBF = [...surplusBF];
    let poolB   = [...activeBF];
    // Feature 12: Führungskräfte. BEWUSST NICHT im allgemeinen Guard-Pool
    // (getGuardPool), sondern separat – sie besetzen gezielt nur leaderCount-Slots.
    // Übrige F bleiben Führung an der HW (siehe HW-finalize: fuehrung:poolF).
    let poolF   = [...availF];
    // O(1)-Lookup für surplusBF (Hot-Loop in bestPair); wird in removeAll synchron gehalten
    const poolSBFIds = new Set(poolSBF.map(p => p.id));

    const getGuardPool  = () => [...poolE, ...poolU, ...poolSBF];
    const guardPoolSize = () => poolE.length + poolU.length + poolSBF.length;
    const removeAll    = p  => {
      poolE   = poolE.filter(x   => x.id !== p.id);
      poolU   = poolU.filter(x   => x.id !== p.id);
      poolSBF = poolSBF.filter(x => x.id !== p.id);
      poolSBFIds.delete(p.id);
    };

    // Wenn forcedForMain bereits k Guard-Slots füllt, müssen wir weniger aus dem
    // Guard-Pool reservieren (z.B. wenn _freezeDay alle Personen einfriert)
    const guardRoles = new Set(['W','B']);
    const preForcedGuards = forcedForMain.filter(p => guardRoles.has(p.role)).length;
    let openTowers = [], usedG = Math.max(0, k - preForcedGuards);
    // Vorabbelegte Türme brauchen ggf. weniger Pool-Personen
    for(const t of candidateTowers){
      const preCount = (forcedByTower[t.id] || []).length;
      const need     = Math.max(0, (t.slotCount || 2) + (t.leaderCount || 0) - preCount);
      // need===0: Turm ist voll vorbelegt → immer öffnen (kein Pool nötig)
      if(need === 0 || usedG + need <= guardPoolSize()){ openTowers.push(t); usedG += need; }
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
      if(!poolSBFIds.has(candidate.id)) return 0;
      if(!tower || tower.id === MAIN_ID) return 0;
      return towerHasActiveBoat(tower.id) ? 800 : 0;
    }

    /**
     * Boat rotation penalty: avoid assigning same BF to same boat on consecutive days
     * @param {object} candidate  – BF candidate
     * @param {object} boat       – Target boat
     * @returns {number} Penalty score (higher = worse)
     */
    function boatRotationPenalty(candidate, boat){
      const s = ensure(candidate.id);
      // If this BF was on this exact boat yesterday, add penalty
      if(d > 0 && schedule[d-1] && s.lastBoatId === boat.id){
        return 300;  // Strong penalty to encourage rotation
      }
      return 0;
    }

    function bestPair(t, requireMix, currentDay){
      const cand   = getGuardPool();
      const isMain = t.id === MAIN_ID;
      let best = null, bestScore = Infinity;
      // Feature 13: B/W werden über experienced als E/U behandelt (nur für Turm-Zuweisung)
      const getEffectiveRole = effLevel;
      // Feature 8: Personen die GESTERN auf diesem Turm waren einmalig vorberechnen
      // (statt pro Paar erneut den Vortag zu durchsuchen → O(n²·m) ⇒ O(m + n²))
      let prevTowerSet = null;
      if(!isMain && currentDay > 0 && schedule[currentDay-1]){
        const slot = schedule[currentDay-1].assign.find(s => s.kind==='tower' && s.towerId===t.id);
        if(slot) prevTowerSet = new Set(slot.occupants.map(p => p.id));
      }
      for(let i = 0; i < cand.length; i++){
        for(let j = i + 1; j < cand.length; j++){
          const A = cand[i], B = cand[j], roles = getEffectiveRole(A) + getEffectiveRole(B);
          const sA = ensure(A.id), sB = ensure(B.id);
          let score = 0;
          if(requireMix){
            if(roles === 'UU'){
              // For HW: prefer 3 inexperienced over towers with 2 inexperienced
              // Reduced penalty for HW (isMain=true) to make it more attractive
              score += isMain ? 300 : 1000;
            }
            // EE-Paar normalerweise nur leicht gebremst; sind Erfahrene aber knapp
            // (reserveExpAtHW), zwei Erfahrene NICHT zusammenlegen → jeder Turm bekommt
            // genau einen Erfahrenen, statt einen Turm doppelt und einen leer zu lassen.
            else if(roles === 'EE') score += reserveExpAtHW ? 1500 : 40;
          }
          score += (pairCount[pairKey(A.id, B.id)] || 0) * 250;  // partner-repeat penalty (raised with tower/fairness weights, Issue #253)
          const vA = sA.towerVisits[t.id] || 0;
          const vB = sB.towerVisits[t.id] || 0;
          score += vA * 200;  // 200 pts per visit: 1st=200, 2nd=400, 3rd=600 (stronger penalty)
          score += vB * 200;
          score += (sA.total + sB.total) * 10;  // Stronger fairness weight (was 5)
          score += surplusBFPenalty(A, t) + surplusBFPenalty(B, t);
          // Feature 12: Bevorzuge Führungskräfte auf Türmen mit leaderCount > 0
          const needsLeader = t.leaderCount && t.leaderCount > 0;
          if(!isMain && needsLeader){
            if(A.role === 'F') score -= 100;
            if(B.role === 'F') score -= 100;
          }
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
              if(poolSBFIds.has(A.id)) score -= 350;
              if(poolSBFIds.has(B.id)) score -= 350;
            }
          } else {
            // HW k-Slot-Auswahl: Personen mit vielen HW-Tagen NICHT nochmal auf HW
            score += sA.hwVisits * 60;
            score += sB.hwVisits * 60;
            // Experience-Reservierung: Sind Erfahrene knapp (≤ offene Türme), dürfen
            // sie nicht an der HW „verbraucht" werden – jeder Turm braucht ≥1 Erfahrenen.
            // Großer, aber endlicher Penalty → Unerfahrene zuerst, Erfahrene nur als Notnagel.
            if(reserveExpAtHW){
              if(getEffectiveRole(A) === 'E') score += 5000;
              if(getEffectiveRole(B) === 'E') score += 5000;
            }
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
    // Experience-Abdeckung: Wie viele Erfahrene brauchen die Türme zwingend?
    // Türme mit Leader-Slot (leaderCount>0) werden durch eine Führungskraft (poolF)
    // erfahren abgedeckt; alle anderen offenen Türme brauchen je 1 Erfahrenen aus dem
    // Guard-Pool. Sind nicht mehr Erfahrene als diese Nachfrage verfügbar → reservieren,
    // d. h. an der HW bevorzugt Unerfahrene einsetzen (bis zu 3 U an der HW sind ok).
    const expDemand = openTowers.filter(t => !(((t.leaderCount || 0) > 0) && poolF.length > 0)).length;
    const reserveExpAtHW = availE.length <= expDemand;

    const mainPseudo = { id: MAIN_ID };
    const mainGuards = [];

    // Zwangsweise HW-Zuweisungen zuerst
    forcedForMain.forEach(p => {
      commitPerson(p, mainPseudo);
      mainGuards.push(p);
    });

    while(mainGuards.length < k && guardPoolSize() > 0){
      const remaining = k - mainGuards.length;
      if(remaining >= 2 && guardPoolSize() >= 2){
        const pair = bestPair(mainPseudo, false, d);
        if(!pair) break;
        const [A, B] = pair;
        removeAll(A); removeAll(B);
        pairCount[pairKey(A.id, B.id)] = (pairCount[pairKey(A.id, B.id)] || 0) + 1;
        commitPerson(A, mainPseudo); commitPerson(B, mainPseudo);
        mainGuards.push(A, B);
      } else {
        const cand = getGuardPool().sort((a,b) => {
          // Experience-Reservierung (s. o.): Unerfahrene zuerst an die HW
          if(reserveExpAtHW){
            const ae = effLevel(a) === 'E' ? 1 : 0, be = effLevel(b) === 'E' ? 1 : 0;
            if(ae !== be) return ae - be;
          }
          return (ensure(a.id).total - ensure(b.id).total) ||
                 ((ensure(a.id).hwVisits||0) - (ensure(b.id).hwVisits||0)); // weniger HW → bevorzugt
        });
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
      // Feature 12: leaderCount ZUSÄTZLICH zu slotCount
      const totalSlots = (t.slotCount || 2) + (t.leaderCount || 0);
      let need = totalSlots - slot.occupants.length;
      const wasEmpty = slot.occupants.length === 0;

      // Feature 12: leaderCount-Slots bevorzugt mit Führungskräften besetzen.
      // Es verlassen nur so viele F die Hauptwache wie es Leader-Slots gibt –
      // die übrigen F bleiben Führung an der HW (kein Leerziehen wie in PR #99).
      // Faire Rotation: F mit wenig Gesamteinsätzen / wenig Besuchen dieses Turms zuerst.
      let leadersToPlace = Math.min(t.leaderCount || 0, need, poolF.length);
      for(let li = 0; li < leadersToPlace; li++){
        poolF.sort((a,b) => {
          const sa = ensure(a.id), sb = ensure(b.id);
          return (sa.total - sb.total)
              || ((sa.towerVisits[t.id] || 0) - (sb.towerVisits[t.id] || 0))
              || (a.id - b.id);
        });
        const leader = poolF.shift();
        slot.occupants.push(leader);
        commitPerson(leader, t);
        need--;
      }

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
          if((effLevel(A)+effLevel(B))==='UU') slot.warn='Zwei Unerfahrene – kein Erfahrener frei';
          need -= 2;
          pairsAdded++;
        } else {
          const cand = getGuardPool().sort((a,b) => {
            const getEffectiveRole = effLevel;
            let scoreA = ensure(a.id).total + surplusBFPenalty(a, t);
            let scoreB = ensure(b.id).total + surplusBFPenalty(b, t);
            // Feature 13a: Wenn bereits zwei Unerfahrene auf Turm → BF-U Penalty, BF-E Bonus
            const occupantRoles = slot.occupants.map(occ => getEffectiveRole(occ)).join('');
            if(occupantRoles === 'UU'){
              const aEffRole = getEffectiveRole(a);
              const bEffRole = getEffectiveRole(b);
              if(aEffRole === 'U') scoreA += 500;  // BF-U mit zwei U = 500 Penalty
              if(aEffRole === 'E') scoreA -= 200; // BF-E mit zwei U = 200 Bonus (gleicht aus)
              if(bEffRole === 'U') scoreB += 500;
              if(bEffRole === 'E') scoreB -= 200;
            }
            return scoreA - scoreB;
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
      .filter(b => !ds.closedBoats.has(b.id))
      .filter(b => b.towerId && openTowers.some(t => t.id === b.towerId))
      .sort((a,b) => (b.prio-a.prio)||(a.id-b.id));

    const boatsNoBootsf     = [];
    const boatsClosedTower  = [];
    const boatsManualClosed = [];

    boats.forEach(b => {
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
        scoreA += boatRotationPenalty(a, bo);  // Rotation penalty
        scoreB += boatRotationPenalty(b, bo);
        // Feature 13: bfLevel hat KEINE Auswirkung auf Boot-Rotation (nur auf Turm-Zuweisen)
        return scoreA - scoreB || (a.id - b.id);
      });

      let assigned = 0;
      while(assigned < neededSlots && poolB.length > 0){
        // Find best BF for this boat considering rotation penalty
        let bestBFIdx = 0;
        let bestBFScore = Infinity;
        for(let i = 0; i < poolB.length; i++){
          const bf = poolB[i];
          const s = ensure(bf.id);
          let score = s.total;
          score += (s.boatVisits[bo.id] || 0) * 50;
          score -= (s.hwVisits || 0) * 10;
          score += boatRotationPenalty(bf, bo);  // Penalty for same boat consecutive days
          if(score < bestBFScore){
            bestBFScore = score;
            bestBFIdx = i;
          }
        }
        const bf = poolB.splice(bestBFIdx, 1)[0];
        if(bf){
          slot.occupants.push(bf);
          if(assigned === 0) slot.bootsf = bf;  // Erste Person als Bootsführer
          const s = ensure(bf.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id]||0)+1;
          s.lastBoatId = bo.id;  // Update for next day's rotation penalty
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
            if(occupant.id === captainId) return;
            const s = ensure(occupant.id);
            s.boatCaptainPairings[captainId] = (s.boatCaptainPairings[captainId] || 0) + 1;
          });
        }
      }
    }

    // ── 4) HAUPTWACHE finalize ──────────────────────────────────────
    const leftovers = [...poolE, ...poolU, ...poolSBF];
    dayAssign.push({
      kind:'main', main:true, tower:'Hauptwache',
      fuehrung:poolF, mainGuards, base:leftovers,
      bootsfLeft:poolB,
      sick:sickToday, k,
    });

    // HW-Besuche für ALLE passiven HW-Personen (Overflow + übrige BF + übrige Führung) tracken.
    // mainGuards bekommen hwVisits bereits via commitPerson.
    // Ohne dieses Tracking denkt der Algorithmus, Overflow-Personen waren nie an HW
    // → sie häufen sich immer in der Overflow-Liste an statt zu rotieren.
    leftovers.forEach(p => ensure(p.id).hwVisits++);
    poolB.forEach(p => ensure(p.id).hwVisits++);
    // Führung an der HW gilt als aktiver Dienst (wie mainGuards) → total++ + hwVisits++.
    // Konsistent mit _reAccumulateDayStats (zählt slot.fuehrung ebenso) → faire
    // Leader-Rotation auch nach Teil-Neuberechnung (generate(startDay>0)).
    poolF.forEach(p => { const s = ensure(p.id); s.total++; s.hwVisits++; });

    // ── 5) TRANSPARENTE Zuweisungen: visueller Tausch NACH dem Algorithmus ──
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
        }
      } else if(f.kind === 'main'){
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

  // Boat distribution: count unique boats per person
  const boatDistribution = {};
  const boatCounts = {};
  people.forEach(p => {
    const stat = stats[p.id];
    if(stat && stat.boatVisits) {
      boatDistribution[p.id] = Object.keys(stat.boatVisits).length;
      boatCounts[p.id] = Object.values(stat.boatVisits).reduce((a,b) => a+b, 0);
    } else {
      boatDistribution[p.id] = 0;
      boatCounts[p.id] = 0;
    }
  });

  const avgUniqueTowers = allStats.length > 0
    ? (Object.values(towerDistribution).reduce((a,b) => a+b, 0) / allStats.length).toFixed(1)
    : 0;
  const towerDistVals = Object.values(towerDistribution);
  const minUniqueTowers = towerDistVals.length > 0 ? Math.min(...towerDistVals) : 0;

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

  // Boat fairness: distribution of boat visits across BFs
  const boatDistVals = Object.values(boatDistribution);
  const avgUniqueBoats = boatDistVals.length > 0
    ? (boatDistVals.reduce((a,b) => a+b, 0) / boatDistVals.length).toFixed(1)
    : 0;
  const minUniqueBoats = boatDistVals.length > 0 ? Math.min(...boatDistVals) : 0;
  const maxBoatVisits = Math.max(...allStats.map(s => Object.values(s.boatVisits || {}).reduce((a,b) => a+b, 0)), 0);
  const avgBoatVisits = allStats.length > 0
    ? (allStats.reduce((sum, s) => sum + Object.values(s.boatVisits || {}).reduce((a,b) => a+b, 0), 0) / allStats.length).toFixed(1)
    : 0;

  lastResult = {
    schedule, pairCount, stats,
    peopleGuards: people.filter(p => p.role==='W'),
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
      },
      boatDistribution: {
        avgUniqueBoats: parseFloat(avgUniqueBoats),
        minUniqueBoats,
        avgBoatVisits: parseFloat(avgBoatVisits),
        maxBoatVisits,
        distribution: boatDistribution
      }
    }
  };
  if(activeDay >= DAYS) activeDay = 0;
  renderOutput();
  autoSave();
}
