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
  // Welche Türme hatten an diesem Tag ein AKTIVES (zugewiesenes, nicht geschlossenes) Boot?
  // Wichtig: Der Voll-Lauf zählt towerWithBoatDays bereits dann, wenn dem Turm ein nicht
  // geschlossenes Boot zugeordnet ist – UNABHÄNGIG davon, ob ein BF zur Besetzung verfügbar
  // war (activeBoatTowers in generate.js). Wir rekonstruieren das faithful aus dem Schedule:
  // besetzte Boot-Slots PLUS unbesetzte-aber-aktive Boote (boatsNoBootsf). Sonst weicht
  // towerWithBoatDays bei BF-Knappheit ab → Fairness-Drift nach Teil-Neuberechnung.
  const activeBoatTowers = new Set();
  // Tatsächlich besetzte Boote je Turm (für boatCaptainPairings – braucht den realen Kapitän).
  const staffedTowerBoats = {};
  daySchedule.assign.forEach(slot => {
    if(slot.kind === 'boat' && slot.towerId && slot.towerId !== 'HW' && slot.occupants?.length > 0){
      staffedTowerBoats[slot.towerId] = slot.boatId;
      activeBoatTowers.add(slot.towerId);
    }
  });
  (daySchedule.boatsNoBootsf || []).forEach(b => {
    if(b && b.towerId && b.towerId !== 'HW') activeBoatTowers.add(b.towerId);
  });

  daySchedule.assign.forEach(slot => {
    if(slot.kind === 'tower'){
      const tId = slot.towerId;
      const hasBoat = activeBoatTowers.has(tId);
      const isMainBeach = !!(towers.find(t => t.id === tId)?.mainBeach);
      slot.occupants.forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.towerVisits[tId] = (s.towerVisits[tId] || 0) + 1;
        if(hasBoat) s.towerWithBoatDays++;
        if(isMainBeach) s.mainBeachDays++; else s.outerBeachDays++;
      });
      // Paar-Zähler
      for(let i = 0; i < slot.occupants.length - 1; i++){
        for(let j = i+1; j < slot.occupants.length; j++){
          const key = pairKey(slot.occupants[i].id, slot.occupants[j].id);
          pairCount[key] = (pairCount[key] || 0) + 1;
        }
      }
      // boatCaptainPairings: Turm-Personen × Boot-Kapitän
      const boatId = staffedTowerBoats[tId];
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
      // Aktive HW-Wachen (mainGuards): total++ + hwVisits++ + hwGuardDays++.
      // hwGuardDays zählt nur ECHTE HW-Wachdienste → identisch zum Voll-Lauf (commitPerson
      // an MAIN_ID, generate.js commitPerson).
      (slot.mainGuards || []).forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.hwVisits++;
        s.hwGuardDays++;
      });
      // HW-Führung (fuehrung): total++ + hwVisits++, aber KEIN hwGuardDays++ – konsistent
      // mit dem Voll-Lauf (poolF.forEach: nur total/hwVisits), sonst bekämen F fälschlich
      // HW-Wachdienste gutgeschrieben.
      (slot.fuehrung || []).forEach(p => {
        const s = ensure(p.id);
        s.total++;
        s.hwVisits++;
      });
      // Overflow (base + bootsfLeft): nur hwVisits++
      [...(slot.base || []), ...(slot.bootsfLeft || [])].forEach(p => {
        ensure(p.id).hwVisits++;
      });
      // HW-Paarungen exakt wie der Voll-Lauf nachziehen (pairCount). Ohne dies fehlen die
      // an der HW gebildeten Paare nach einer Teil-Neuberechnung → Fairness-Drift im
      // regenerierten Rest (pairRepeatWeight in bestPair).
      (slot.mainPairs || []).forEach(([a, b]) => {
        const key = pairKey(a, b);
        pairCount[key] = (pairCount[key] || 0) + 1;
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
  const stats     = new Map();
  const ensure    = id => {
    if(!stats.has(id)) stats.set(id, {
      total: 0,
      towerVisits: {},
      boatVisits: {},
      hwVisits: 0,
      towerWithBoatDays: 0,
      boatCaptainPairings: {},
      mainBeachDays: 0,  // Feature: Hauptstrand-Türme – Tage auf Hauptstrand-Türmen
      outerBeachDays: 0, // Feature: Hauptstrand-Türme – Tage auf Außen-Türmen
      hwGuardDays: 0     // Feature: BF-HW-Wunsch – Anzahl AKTIVER HW-Dienste (mainGuards/Führung)
    });
    return stats.get(id);
  };
  const pairKey   = (a,b) => a < b ? a + '|' + b : b + '|' + a;

  const schedule = [];
  const k = Math.max(0, mainK | 0);

  // Feature: Hauptstrand-Türme – fairer Ausgleich Hauptstrand ↔ Außentürme.
  // Nur aktiv, wenn es BEIDE Sorten gibt (sonst kein Ausgleich nötig/sinnvoll).
  const beachBalanceActive = towers.some(t => t.mainBeach) && towers.some(t => !t.mainBeach);

  // Behaltene Tage werden NICHT neu berechnet, sondern aus lastResult übernommen; ihre Stats
  // werden re-akkumuliert, damit die neu generierten Tage fair darauf aufbauen. Behalten wird:
  //   - der Prefix [0, startDay-1] (Teil-Neuberechnung nach manueller Verschiebung), und
  //   - jeder gesperrte Tag (Feature „Tag sperren") – unabhängig von startDay, damit er sich
  //     bei Änderungen an anderen Tagen nicht mehr verändert.
  const _isLockedDay = d => (typeof lockedDays !== 'undefined' && lockedDays && lockedDays.has(d));

  for(let d = 0; d < DAYS; d++){
    if((d < startDay || _isLockedDay(d)) && lastResult?.schedule?.[d]){
      schedule.push(lastResult.schedule[d]);
      _reAccumulateDayStats(lastResult.schedule[d], d, stats, pairCount, ensure, pairKey);
      continue;
    }
    const ds       = dayState[d] || freshDay();
    const isAbsent = id => (ds.absent || new Set()).has(id);
    // "außer Dienst" (HW-Anzeige) gilt nur für nicht komplett abwesende Personen.
    const isSick   = id => ds.sick.has(id) && !isAbsent(id);

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
      return p && !isSick(p.id) && !isAbsent(p.id);
    });

    // transparent=true → Person bleibt im Pool; wird erst NACH dem Algorithmus
    //   visuell in den Zielslot verschoben; Statistik läuft unverändert durch
    //   → Folgetage sind identisch mit dem Originalplan
    // transparent=false → Person wird aus dem Pool entfernt, vor dem
    //   Algorithmus platziert, Statistik zählt mit
    const effectiveDayForced   = dayForced.filter(f => !f.transparent);
    const transparentDayForced = dayForced.filter(f =>  f.transparent);
    const effectiveForcedIds   = new Set(effectiveDayForced.map(f => f.personId));

    // Verfügbare Personen OHNE effektiv-zwangsweise zugewiesene
    const byRole = {};
    people.forEach(p => {
      // Komplett abwesende Personen werden gar nicht eingeplant (auch nicht an der HW).
      if(isAbsent(p.id) || isSick(p.id) || effectiveForcedIds.has(p.id)) return;
      (byRole[p.role] || (byRole[p.role] = [])).push(p);
    });
    // availE/availU werden aus den Wachgängern (role 'W') über das experienced-Flag
    // abgeleitet → die tiefe Pool-Logik (poolE/poolU, getGuardPool) bleibt unverändert.
    const availF = byRole['F'] || [], availB = byRole['B'] || [];
    const guardsW = byRole['W'] || [];
    const availE  = guardsW.filter(p =>  p.experienced);
    const availU  = guardsW.filter(p => !p.experienced);
    const sickToday = people.filter(p => isSick(p.id));

    // Personen bereits in byRole gefiltert (effectiveForcedIds).
    // Kein manuelles removeFromPools() mehr nötig — O(n) statt O(n×m).

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
        const maxSlots = tower ? (tower.slotCount || 2) : 2;
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
      const totalSlots = (t.slotCount || 2);
      if(usedGpre + totalSlots <= availBodiesPre){ tempOpen.push(t); usedGpre += totalSlots; }
    }
    // Boote, für die BF benötigt werden
    const towersWithPreOpen = new Set(tempOpen.map(t => t.id));
    const boatsPre = boats.filter(b =>
      !ds.closedBoats.has(b.id) &&
      b.towerId &&
      towersWithPreOpen.has(b.towerId)
    );

    // BF-HW-Wunsch-Sicherheitsnetz: Gibt es echte BF-Überzahl und nähert sich die Woche
    // dem Ende, werden BF mit noch offenem HW-Wunsch in die surplus-Hälfte gedrückt (höherer
    // Sortwert = später = surplus), damit sie überhaupt für die HW verfügbar sind. Nur bei
    // Überzahl, sonst bliebe ein Boot unbesetzt.
    const hasSurplusBF = availB.length > boatsPre.length;
    const daysLeftBF   = DAYS - d;
    const hwWishSurplusBias = bf => (
      hasSurplusBF && daysLeftBF <= 2 && bf.wantsHW && (ensure(bf.id).hwGuardDays || 0) === 0
    ) ? 1e6 : 0;

    // BFs nach Fairness sortieren, BEVOR aktiveBF/surplusBF-Aufteilung:
    // Wer weniger Bootstage hat UND mehr HW-Tage, kommt zuerst in den Boot-Pool.
    // Ohne diese Sortierung bekäme immer die erste Person in der Liste den Boot-Slot.
    availB.sort((a,b) => {
      const sa = ensure(a.id), sb = ensure(b.id);
      const boatA = Object.values(sa.boatVisits||{}).reduce((s,v)=>s+v,0);
      const boatB = Object.values(sb.boatVisits||{}).reduce((s,v)=>s+v,0);
      return (boatA * 50 - (sa.hwVisits||0) * 10 + hwWishSurplusBias(a))
           - (boatB * 50 - (sb.hwVisits||0) * 10 + hwWishSurplusBias(b))
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
    // Führungskräfte. BEWUSST NICHT im allgemeinen Guard-Pool (getGuardPool), sondern
    // separat – sie besetzen gezielt einen Slot auf markierten Führungstürmen (Feature 34).
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
      const need     = Math.max(0, (t.slotCount || 2) - preCount);
      // need===0: Turm ist voll vorbelegt → immer öffnen (kein Pool nötig)
      if(need === 0 || usedG + need <= guardPoolSize()){ openTowers.push(t); usedG += need; }
    }
    const personnelClosed = candidateTowers
      .filter(t => !openTowers.includes(t))
      .sort((a,b) => (a.prio-b.prio)||(a.id-b.id));
    const manualClosed = towers.filter(t => ds.closed.has(t.id));

    // Boot-Rotation: Anzahl heute besetzbarer Boote bestimmt, wie viele Tage ein
    // Bootsführer dasselbe Boot meiden soll. Bei 3 Booten → die letzten 2 Tage meiden,
    // d. h. frühestens am 4. Tag wieder auf dem gleichen Boot (Mo → frühestens Do).
    const rotatableBoats = boats.filter(b =>
      !ds.closedBoats.has(b.id) &&
      (b.towerId === 'HW' || (b.towerId && openTowers.some(t => t.id === b.towerId))));
    const boatRotationLookback = Math.max(1, rotatableBoats.length - 1);

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
      return towerHasActiveBoat(tower.id) ? algoParams.surplusBfActivePenalty : 0;
    }

    /**
     * Feature: Hauptstrand-Türme. Hält pro Person das Verhältnis Hauptstrand- ↔
     * Außentürme im Gleichgewicht. imbalance = bisherige Außen- minus Hauptstrand-Tage:
     *  - Zielturm = Außenturm → wer ohnehin viel Außen hatte (imbalance>0) wird bestraft.
     *  - Zielturm = Hauptstrand → wer ohnehin viel Hauptstrand hatte (imbalance<0) wird bestraft.
     * Symmetrisch → niemand sammelt mehrere Tage in Folge nur Außentürme.
     * @returns {number} Zusatzstrafe (höher = schlechter)
     */
    function beachBalancePenalty(candidate, tower){
      if(!beachBalanceActive || !tower || tower.id === MAIN_ID) return 0;
      const s = ensure(candidate.id);
      const imbalance = (s.outerBeachDays || 0) - (s.mainBeachDays || 0);
      const overhang = tower.mainBeach ? Math.max(0, -imbalance) : Math.max(0, imbalance);
      // Gewicht mind. so stark wie die Turm-Wiederholungs-Rotation (towerVisitWeight): sonst zieht
      // diese einen „Blank-Slate"-Spät-Einsteiger (0 Besuche auf JEDEM Turm → überall am billigsten)
      // in die zuerst befüllten Türme – und da die Haupt-Türme i.d.R. die höchste Prio haben (zuerst
      // dran), landet er sonst Tag für Tag nur am Hauptstrand. Höherer User-Wert wird respektiert.
      const w = Math.max(algoParams.beachBalanceWeight, algoParams.towerVisitWeight);
      return overhang * w;
    }

    /**
     * Feature: BF-HW-Wunsch. Überzählige Bootsführer mit gesetztem Wunsch (wantsHW)
     * sollen in der Woche mindestens EINMAL aktiven HW-Dienst bekommen. Liefert einen
     * Bonus (positiver Rückgabewert, wird vom HW-Score ABGEZOGEN) für noch nicht
     * erfüllte Wünsche; eskaliert zum Wochenende, damit der Wunsch zuverlässig greift.
     * Nur überzählige BF stehen überhaupt im HW-Guard-Pool → automatisches Gating.
     * @returns {number} Bonus (0 = kein Wunsch / bereits erfüllt)
     */
    function hwWishBonus(candidate){
      if(!candidate.wantsHW) return 0;
      if((ensure(candidate.id).hwGuardDays || 0) > 0) return 0;  // Wunsch erfüllt
      const daysLeft = DAYS - d;  // inkl. heute
      if(daysLeft <= 1) return 100000;  // letzter Tag → erzwingen
      if(daysLeft <= 2) return algoParams.hwWishBonusNear;
      return algoParams.hwWishBonusEarly;
    }

    /**
     * Boat rotation penalty: hält einen Bootsführer über das ganze Rotationsfenster
     * (boatRotationLookback Tage) von einem zuletzt gefahrenen Boot fern. Bei 3 Booten
     * sind das die letzten 2 Tage → derselbe BF kehrt frühestens nach 3 Tagen aufs
     * gleiche Boot zurück. Gestern wiegt am schwersten, weiter zurück abnehmend.
     * Großer, aber endlicher Penalty → weicht nur, wenn keine Alternative existiert.
     * @param {object} candidate  – BF candidate
     * @param {object} boat       – Target boat
     * @returns {number} Penalty score (higher = worse)
     */
    function boatRotationPenalty(candidate, boat){
      let penalty = 0;
      for(let back = 1; back <= boatRotationLookback; back++){
        const prevDay = schedule[d - back];
        if(!prevDay) break;  // weniger Vortage als das Fenster → fertig
        const onSameBoat = prevDay.assign.some(sl =>
          sl.kind === 'boat' && sl.boatId === boat.id &&
          (sl.occupants || []).some(o => o.id === candidate.id));
        if(onSameBoat) penalty += algoParams.boatRotationBase * (boatRotationLookback - back + 1);
      }
      return penalty;
    }

    function bestPair(t, requireMix, currentDay, towerNeedsSan){
      const cand   = getGuardPool();
      const isMain = t.id === MAIN_ID;
      let best = null, bestScore = Infinity;
      // Feature 13: B/W werden über experienced als E/U behandelt (nur für Turm-Zuweisung)
      const getEffectiveRole = effLevel;
      // Sind noch Unerfahrene im Pool? Dann ist für JEDEN Turm ein E+U-Paar möglich → zwei
      // Erfahrene NICHT zusammenlegen (sonst landet anderswo ein U+U-Turm). Erst wenn keine
      // Unerfahrenen mehr übrig sind, ist EE unvermeidlich und wird nicht mehr bestraft.
      const uAvailable = cand.some(p => getEffectiveRole(p) === 'U');
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
              score += isMain ? algoParams.uuPenaltyHW : algoParams.uuPenaltyTower;
            }
            // EE-Paar stark bremsen, solange ein Erfahrener stattdessen mit einem Unerfahrenen
            // gepaart werden könnte (uAvailable) ODER Erfahrene knapp sind (reserveExpAtHW) →
            // jeder Turm bekommt genau EINEN Erfahrenen, statt einen Turm doppelt (EE) und einen
            // anderen leer (UU) zu lassen. Nur wenn keine Unerfahrenen mehr übrig sind, ist EE
            // unvermeidlich und wird lediglich leicht gebremst (eePenaltyNormal).
            else if(roles === 'EE') score += (reserveExpAtHW || uAvailable) ? algoParams.eePenaltyReserve : algoParams.eePenaltyNormal;
          }
          score += (pairCount[pairKey(A.id, B.id)] || 0) * algoParams.pairRepeatWeight;
          const vA = sA.towerVisits[t.id] || 0;
          const vB = sB.towerVisits[t.id] || 0;
          score += vA * algoParams.towerVisitWeight;
          score += vB * algoParams.towerVisitWeight;
          // Gesamteinsatz-Ausgleich gilt NUR für Türme (s. else-Zweig): ein Spät-Einsteiger mit
          // strukturell niedrigstem `total` (Tage abwesend, aber an jedem Anwesenheitstag aktiv)
          // soll seinen Rückstand auf echten Wachdiensten (Türmen) aufholen, nicht an der HW.
          // Sonst würde er, da die HW VOR den Türmen befüllt wird, dort „geparkt".
          score += surplusBFPenalty(A, t) + surplusBFPenalty(B, t);
          score += beachBalancePenalty(A, t) + beachBalancePenalty(B, t);  // Hauptstrand-Ausgleich
          if(!isMain){
            score += (sA.total + sB.total) * algoParams.totalFairnessWeight;
            // Feature 8: Konsekutive Tage auf gleichem Turm bestrafen
            if(prevTowerSet){
              if(prevTowerSet.has(A.id)) score += algoParams.consecutiveTowerPenalty;
              if(prevTowerSet.has(B.id)) score += algoParams.consecutiveTowerPenalty;
            }
            // Tower+Boat-Balance: zwei "Boot-lastige" Personen meiden
            if(sA.towerWithBoatDays > 2 && sB.towerWithBoatDays > 2) score += algoParams.towerBoatHeavyPenalty;
            // HW-Balance: proportionaler Bonus je mehr HW-Tage (inkl. Overflow-Tage)
            score -= sA.hwVisits * algoParams.hwVisitWeightTower;
            score -= sB.hwVisits * algoParams.hwVisitWeightTower;
            // Boot außer Dienst: surplusBF bevorzugt zum Turm des außer-Dienst-Boots
            if(closedBoatTowers.has(t.id)){
              if(poolSBFIds.has(A.id)) score -= algoParams.surplusBfClosedBonus;
              if(poolSBFIds.has(B.id)) score -= algoParams.surplusBfClosedBonus;
            }
            // Sanitäter: San-Turm zieht einen Sanitäter an (Bonus, sobald noch keiner sitzt),
            // Nicht-San-Türme halten Sanitäter als Reserve fern.
            if(sanActive){
              if(t.sanTower){
                if(towerNeedsSan && (A.sanitaeter || B.sanitaeter)) score -= algoParams.sanTowerBonus;
              } else {
                if(A.sanitaeter) score += algoParams.sanReservePenalty;
                if(B.sanitaeter) score += algoParams.sanReservePenalty;
              }
            }
          } else {
            // HW-Wiederholungsbesuch: Strafe pro bisherigem HW-Dienst (hwVisits) → faire
            // Rotation analog zum Turm-Wiederholungsbesuch (towerVisitWeight). Wer schon oft an
            // der HW war, wird für erneuten HW-Dienst proportional gebremst.
            score += sA.hwVisits * algoParams.hwVisitWeightHW;
            score += sB.hwVisits * algoParams.hwVisitWeightHW;
            // BF-HW-Wunsch: noch nicht erfüllte Wünsche bevorzugt an die HW holen
            score -= hwWishBonus(A);
            score -= hwWishBonus(B);
            // Experience-Reservierung: Sind Erfahrene knapp (≤ offene Türme), dürfen
            // sie nicht an der HW „verbraucht" werden – jeder Turm braucht ≥1 Erfahrenen.
            // Großer, aber endlicher Penalty → Unerfahrene zuerst, Erfahrene nur als Notnagel.
            if(reserveExpAtHW){
              if(getEffectiveRole(A) === 'E') score += algoParams.reserveExpPenalty;
              if(getEffectiveRole(B) === 'E') score += algoParams.reserveExpPenalty;
            }
            // Sanitäter an der HW nur als Reserve – auf San-Türmen besser aufgehoben.
            if(sanActive){
              if(A.sanitaeter) score += algoParams.sanReservePenalty;
              if(B.sanitaeter) score += algoParams.sanReservePenalty;
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
        s.hwGuardDays++;  // aktiver HW-Dienst (für BF-HW-Wunsch)
      } else {
        s.towerVisits[t.id] = (s.towerVisits[t.id] || 0) + 1;
        if(towerHasActiveBoat(t.id)){
          s.towerWithBoatDays++;
        }
        if(t.mainBeach) s.mainBeachDays++; else s.outerBeachDays++;
      }
    }

    // ── 1) HAUPTWACHE ──────────────────────────────────────────────
    // Experience-Abdeckung: Wie viele Erfahrene brauchen die Türme zwingend?
    // Führungstürme (leaderTower) werden durch eine Führungskraft (poolF) erfahren
    // abgedeckt; alle anderen offenen Türme brauchen je 1 Erfahrenen aus dem Guard-Pool.
    // Sind nicht mehr Erfahrene als diese Nachfrage verfügbar → reservieren, d. h. an der
    // HW bevorzugt Unerfahrene einsetzen (bis zu 3 U an der HW sind ok).
    const expDemand = openTowers.filter(t => !(t.leaderTower && poolF.length > 0)).length;
    const reserveExpAtHW = availE.length <= expDemand;

    // Feature: Sanitäter (San-Türme). Türme mit sanTower:true sollen – wenn möglich – immer
    // mindestens einen Sanitäter besetzen. Sanitäter können Wachgänger ODER (überzählige)
    // Bootsführer sein – maßgeblich ist, wer für einen Turmplatz verfügbar ist, also im
    // Guard-Pool steht (poolE/poolU = Wachgänger, poolSBF = überzählige Bootsführer; aktive
    // BF fahren ein Boot und kommen für den Turm ohnehin nicht in Frage). Analog zur
    // BF-Reservierung für Boote: Sanitäter werden über einen großen Bonus auf San-Türme
    // gezogen und über eine Reserve-Strafe von Nicht-San-Türmen/HW ferngehalten, damit sie
    // nicht „verbraucht" werden, bevor ein San-Turm an der Reihe ist. Faire Rotation unter
    // den Sanitätern ergibt sich aus den bestehenden towerVisit-/Konsekutiv-Strafen.
    // Gating: nur aktiv, wenn ein offener San-Turm UND ein Sanitäter im Guard-Pool existiert –
    // sonst verhalten sich Sanitäter exakt wie normale Pool-Personen.
    const sanActive = openTowers.some(t => t.sanTower)
      && getGuardPool().some(p => p.sanitaeter);

    // Feature 33: San-Türme – Sanitäter VORAB reservieren (analog Führungsturm, Feature 34).
    // Statt nur über Strafen wird – wenn sanActive – pro offenem San-Turm (prio asc) genau EIN
    // Sanitäter fest aus dem Guard-Pool gezogen, BEVOR die HW befüllt wird. Dadurch kann die HW
    // keinen Sanitäter „verbrauchen" (der dauer-aktive Sanitäter hat hwVisits=0 und wäre sonst ein
    // HW-Kandidat) und die HW-Auswahl muss nicht über `total` balancieren (s. bestPair/HW-Sort).
    // Nur reservieren, wenn der Turm einen freien (nicht zwangsbelegten) Slot hat und dort noch
    // kein Sanitäter sitzt. Faire Rotation: Sanitäter mit wenig Gesamteinsätzen / wenig Besuchen
    // dieses Turms zuerst. Die alten Strafen (sanTowerBonus/sanReservePenalty) bleiben als
    // Feinsteuerung für ÜBERZÄHLIGE Sanitäter erhalten – die reservierten sind nicht mehr im Pool.
    const reservedSanByTower = {};
    if(sanActive){
      for(const t of openTowers){
        if(!t.sanTower) continue;
        const preOcc = forcedByTower[t.id] || [];
        if((t.slotCount || 2) - preOcc.length < 1 || preOcc.some(p => p.sanitaeter)) continue;
        const avail = getGuardPool().filter(p => p.sanitaeter);
        if(avail.length === 0) break;
        avail.sort((a, b) => {
          const sa = ensure(a.id), sb = ensure(b.id);
          return (sa.total - sb.total)
              || ((sa.towerVisits[t.id] || 0) - (sb.towerVisits[t.id] || 0))
              || (a.id - b.id);
        });
        removeAll(avail[0]);
        reservedSanByTower[t.id] = avail[0];
      }
    }

    // Feature 43: HW als „San-Turm". Ist hwSanTower aktiv und – NACH den San-Türmen – noch ein
    // Sanitäter im Guard-Pool frei, wird (analog zur Turm-Reservierung) genau EINER vorab für die
    // HW reserviert und unten als fester mainGuard platziert. So ist die HW garantiert mit einem
    // Sanitäter besetzt; ohne die Reservierung würde die normale HW-Befüllung Sanitäter (für die
    // San-Türme) ans Ende sortieren (s. „Sanitäter zuletzt an die HW"). San-Türme haben Vorrang
    // (diese Reservierung läuft danach). Nur reservieren, wenn die HW dafür einen freien (nicht
    // zwangsbelegten) Slot hat und dort noch kein Sanitäter sitzt – sonst ginge der aus dem Pool
    // gezogene Sanitäter für den Tag verloren. Faire Rotation: wenigste aktiven HW-Dienste /
    // Gesamteinsätze zuerst (wie bei der BF-an-HW-Reservierung).
    let reservedSanForHW = null;
    if(hwSanTower && (k - forcedForMain.length) >= 1 && !forcedForMain.some(p => p.sanitaeter)){
      const avail = getGuardPool().filter(p => p.sanitaeter);
      if(avail.length > 0){
        avail.sort((a, b) => {
          const sa = ensure(a.id), sb = ensure(b.id);
          return (sa.hwGuardDays - sb.hwGuardDays)
              || (sa.total - sb.total)
              || ((sa.hwVisits || 0) - (sb.hwVisits || 0))
              || (a.id - b.id);
        });
        removeAll(avail[0]);
        reservedSanForHW = avail[0];
      }
    }

    const mainPseudo = { id: MAIN_ID };
    const mainGuards = [];
    // HW-Paarungen dieses Tages (nur die per bestPair gebildeten Paare). Werden auf dem
    // main-Slot gespeichert, damit _reAccumulateDayStats (Teil-Neuberechnung, generate(startDay>0))
    // den pairCount für HW-Paare exakt wie der Voll-Lauf reproduzieren kann (sonst Fairness-Drift).
    const mainPairs = [];

    // Zwangsweise HW-Zuweisungen zuerst
    forcedForMain.forEach(p => {
      commitPerson(p, mainPseudo);
      mainGuards.push(p);
    });

    // Feature 43: reservierten Sanitäter (HW-als-San-Turm) als festen Guard platzieren – VOR der
    // BF-an-HW-Pflicht (medizinische Abdeckung hat Vorrang vor dem BF-Wunschplatz). Bereits aus
    // dem Pool gezogen → commitPerson zählt den aktiven HW-Dienst (hwGuardDays für faire Rotation).
    // Die Reservierungsbedingung garantierte einen freien Slot → push ist sicher.
    if(reservedSanForHW){
      commitPerson(reservedSanForHW, mainPseudo);
      mainGuards.push(reservedSanForHW);
    }

    // Feature: BF-an-HW-Pflicht. Bei aktivierter Option und echter BF-Überzahl wird VOR
    // der normalen HW-Befüllung ein überzähliger Bootsführer als fester Guard platziert –
    // so bleibt z.B. bei k=3 Platz für 2 Wachgänger (→ 2 WG + 1 BF). Die übrigen Slots
    // füllt der Algorithmus regulär (E/U-Mix). Fairste Rotation: BF mit den wenigsten
    // aktiven HW-Diensten zuerst (dann Gesamteinsätze / HW-Tage). poolSBF enthält nur
    // überzählige BF → automatisches Gating (leer = keine Überzahl).
    if(requireBfAtHw && poolSBF.length > 0 && mainGuards.length < k
       && !mainGuards.some(p => p.role === 'B')){
      const bf = [...poolSBF].sort((a,b) => {
        const sa = ensure(a.id), sb = ensure(b.id);
        return (sa.hwGuardDays - sb.hwGuardDays)
            || (sa.total - sb.total)
            || ((sa.hwVisits||0) - (sb.hwVisits||0))
            || (a.id - b.id);
      })[0];
      removeAll(bf);
      commitPerson(bf, mainPseudo);
      mainGuards.push(bf);
    }

    while(mainGuards.length < k && guardPoolSize() > 0){
      const remaining = k - mainGuards.length;
      if(remaining >= 2 && guardPoolSize() >= 2){
        const pair = bestPair(mainPseudo, false, d);
        if(!pair) break;
        const [A, B] = pair;
        removeAll(A); removeAll(B);
        pairCount[pairKey(A.id, B.id)] = (pairCount[pairKey(A.id, B.id)] || 0) + 1;
        mainPairs.push([A.id, B.id]);
        commitPerson(A, mainPseudo); commitPerson(B, mainPseudo);
        mainGuards.push(A, B);
      } else {
        const cand = getGuardPool().sort((a,b) => {
          // BF-HW-Wunsch: noch offener Wunsch hat Vorrang vor allem anderen
          const wa = hwWishBonus(a), wb = hwWishBonus(b);
          if(wa !== wb) return wb - wa;  // höherer Bonus zuerst
          // Experience-Reservierung (s. o.): Unerfahrene zuerst an die HW
          if(reserveExpAtHW){
            const ae = effLevel(a) === 'E' ? 1 : 0, be = effLevel(b) === 'E' ? 1 : 0;
            if(ae !== be) return ae - be;
          }
          // Sanitäter zuletzt an die HW – sie werden auf San-Türmen gebraucht.
          if(sanActive){
            const am = a.sanitaeter ? 1 : 0, bm = b.sanitaeter ? 1 : 0;
            if(am !== bm) return am - bm;
          }
          // HW-Wiederholungsbesuch: rein nach bisherigen HW-Diensten (hwVisits), KEIN `total`-
          // Ausgleich an der HW – sonst würde ein Spät-Einsteiger mit dauerhaft niedrigstem `total`
          // jeden Tag wieder auf den HW-Einzelplatz gezogen. Sein Rückstand wird auf Türmen
          // aufgeholt (s. bestPair, !isMain). Gleichstand → deterministisch nach id.
          const scoreA = (ensure(a.id).hwVisits || 0) * algoParams.hwVisitWeightHW;
          const scoreB = (ensure(b.id).hwVisits || 0) * algoParams.hwVisitWeightHW;
          return (scoreA - scoreB) || (a.id - b.id);
        });
        const P = cand[0]; if(!P) break;
        removeAll(P); commitPerson(P, mainPseudo); mainGuards.push(P);
      }
    }

    // ── 2) TÜRME (je 2 Wachgänger) ────────────────────────────────
    for(const t of openTowers){
      const slot = { kind:'tower', towerId:t.id, tower:t.name, code:t.code, prio:t.prio, mainBeach:!!t.mainBeach, occupants:[], warn:null };

      // Zwangsbelegte Plätze bereits vorab eintragen
      const pre = (forcedByTower[t.id] || []);
      pre.forEach(p => { commitPerson(p, t); slot.occupants.push(p); });

      // Algorithmus füllt verbleibende Plätze (variable Slot-Anzahl)
      const totalSlots = (t.slotCount || 2);

      // San-Turm (Feature 33): vorab reservierten Sanitäter zuerst auf einen regulären Slot setzen
      // (analog Führungskraft). Er wurde bereits aus dem Guard-Pool gezogen → kein Doppel-Einsatz.
      const reservedSan = reservedSanByTower[t.id];
      if(reservedSan && (totalSlots - slot.occupants.length) > 0
         && !slot.occupants.some(o => o.id === reservedSan.id)){
        slot.occupants.push(reservedSan);
        commitPerson(reservedSan, t);
      }

      let need = totalSlots - slot.occupants.length;
      const wasEmpty = slot.occupants.length === 0;

      // Führungsturm (Feature 34): Wenn möglich genau EINE Führungskraft (aus dem separaten
      // poolF) auf einen regulären Slot setzen – analog zur San-Turm-Logik, aber ohne
      // Zusatz-Slot. Nur, wenn der Turm markiert ist, noch keine F im Slot sitzt (z.B. via
      // Zwangszuweisung) und Bedarf/poolF vorhanden sind. Es verlassen nur so viele F die HW
      // wie es Führungstürme gibt – die übrigen F bleiben Führung an der HW (kein Leerziehen).
      // Faire Rotation: F mit wenig Gesamteinsätzen / wenig Besuchen dieses Turms zuerst.
      const wantLeader = t.leaderTower && need > 0 && poolF.length > 0
        && !slot.occupants.some(o => o.role === 'F');
      if(wantLeader){
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
          const towerNeedsSan = sanActive && t.sanTower && !slot.occupants.some(o => o.sanitaeter);
          const best = bestPair(t, wasEmpty && pairsAdded === 0, d, towerNeedsSan);
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
          const towerNeedsSan = sanActive && t.sanTower && !slot.occupants.some(o => o.sanitaeter);
          const cand = getGuardPool().sort((a,b) => {
            const getEffectiveRole = effLevel;
            let scoreA = ensure(a.id).total + surplusBFPenalty(a, t) + beachBalancePenalty(a, t);
            let scoreB = ensure(b.id).total + surplusBFPenalty(b, t) + beachBalancePenalty(b, t);
            // Sanitäter: San-Turm zieht einen an (solange keiner sitzt), sonst Reserve fernhalten.
            if(sanActive){
              if(t.sanTower){
                if(towerNeedsSan){
                  if(a.sanitaeter) scoreA -= algoParams.sanTowerBonus;
                  if(b.sanitaeter) scoreB -= algoParams.sanTowerBonus;
                }
              } else {
                if(a.sanitaeter) scoreA += algoParams.sanReservePenalty;
                if(b.sanitaeter) scoreB += algoParams.sanReservePenalty;
              }
            }
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

    // ── Globale (optimale) Boot→BF-Zuordnung statt gieriger Einzelvergabe ──
    // Die gierige Vergabe ließ das zuletzt verarbeitete Boot den einzig übrigen
    // BF bekommen → Rotation verletzt (BF zwei Tage hintereinander am selben Boot).
    // Min-Cost-Matching über alle Boote+BF des Tages findet die fairste Gesamt-
    // Zuordnung; zusammen mit dem Lookback-Penalty ergibt das die saubere Rotation.
    // Nur im Standardfall: keine Zwangsboote, je 1 BF pro Boot, kleine Anzahl.
    // LIMIT: DFS ist O(n!) im Worst-Case; bei ≤8 Booten = 8! = 40320 Kombinationen
    // (in <50ms). Bei >8 Booten gierige Fallback — erhöhe MAX_BOAT_MATCHING
    // nur wenn du auch den DFS mit Branch-and-Bund erweiterst (s. boatRotationPenalty).
    const MAX_BOAT_MATCHING = 8;
    const useBoatMatching =
      boatsProcessed.length > 0 && poolB.length > 0 && boatsProcessed.length <= MAX_BOAT_MATCHING &&
      boatsProcessed.every(bo => !(forcedByBoat[bo.id]?.length) && (bo.slotCount || 1) === 1);
    const boatMatch = new Map();  // boatId → BF
    if(useBoatMatching){
      const boatCost = (bo, bf) => {
        const s = ensure(bf.id);
        return s.total + (s.boatVisits[bo.id] || 0) * algoParams.boatVisitWeight - (s.hwVisits || 0) * algoParams.boatHwBonus
             + boatRotationPenalty(bf, bo) + bf.id * 0.001;  // deterministischer Tiebreak
      };
      // Wichtige Boote (prio ASC) zuerst → bei BF-Mangel gehen die unwichtigsten leer aus
      const ordered = [...boatsProcessed].sort((a,b) => (a.prio - b.prio) || (a.id - b.id));
      const bfs = [...poolB];
      const usedBf = new Array(bfs.length).fill(false);
      let best = { total: Infinity, map: null };
      const cur = {};
      const dfs = (i, acc) => {
        if(acc >= best.total) return;  // Branch-and-Bound
        if(i === ordered.length){ best = { total: acc, map: { ...cur } }; return; }
        const bo = ordered[i];
        let anyFree = false;
        for(let j = 0; j < bfs.length; j++){
          if(usedBf[j]) continue;
          anyFree = true;
          usedBf[j] = true; cur[bo.id] = bfs[j];
          dfs(i + 1, acc + boatCost(bo, bfs[j]));
          usedBf[j] = false; delete cur[bo.id];
        }
        if(!anyFree) dfs(i + 1, acc);  // mehr Boote als BF → dieses Boot bleibt leer
      };
      dfs(0, 0);
      if(best.map) Object.entries(best.map).forEach(([bid, bf]) => boatMatch.set(+bid, bf));
    }

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
      // Optimale Zuordnung (Min-Cost-Matching) verwenden, falls aktiv
      if(useBoatMatching){
        const bf = boatMatch.get(bo.id);
        if(bf){
          const idx = poolB.findIndex(x => x.id === bf.id);
          if(idx >= 0) poolB.splice(idx, 1);
          slot.occupants.push(bf);
          slot.bootsf = bf;
          const s = ensure(bf.id);
          s.total++; s.boatVisits[bo.id] = (s.boatVisits[bo.id] || 0) + 1;
        }
        if(slot.occupants.length > 0) dayAssign.push(slot);
        else                         boatsNoBootsf.push(bo);
        continue;
      }
      // Fülle Boot bis slotCount mit fairness-Scoring
      const neededSlots = bo.slotCount || 1;
      poolB.sort((a,b) => {
        const sa = ensure(a.id), sb = ensure(b.id);
        let scoreA = sa.total;
        let scoreB = sb.total;
        scoreA += (sa.boatVisits[bo.id] || 0) * algoParams.boatVisitWeight;
        scoreB += (sb.boatVisits[bo.id] || 0) * algoParams.boatVisitWeight;
        scoreA -= (sa.hwVisits || 0) * algoParams.boatHwBonus;
        scoreB -= (sb.hwVisits || 0) * algoParams.boatHwBonus;
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
          score += (s.boatVisits[bo.id] || 0) * algoParams.boatVisitWeight;
          score -= (s.hwVisits || 0) * algoParams.boatHwBonus;
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
    // Bug #308: Effektive (transparent:false) Turm-Zwangszuweisungen auf einen an diesem Tag
    // GESCHLOSSENEN Turm (nicht in openTowers) werden im Turm-Loop nie konsumiert. Die Person
    // wurde aber bereits aus allen Pools entfernt (removeFromPools) → ohne Auffangen säße sie
    // auf keinem Slot und fehlte komplett in Plan + Tagesstatistik. Wir führen sie daher als
    // aktive HW-Wache (mainGuards): commitPerson an MAIN_ID zählt total++/hwVisits++/hwGuardDays++
    // (identisch zur Stat-Rekonstruktion in _reAccumulateDayStats über slot.mainGuards).
    const openTowerIds = new Set(openTowers.map(t => String(t.id)));
    Object.keys(forcedByTower).forEach(slotId => {
      if(openTowerIds.has(String(slotId))) return; // offener Turm → bereits im Turm-Loop platziert
      forcedByTower[slotId].forEach(p => {
        if(mainGuards.some(g => g.id === p.id)) return;
        commitPerson(p, mainPseudo);
        mainGuards.push(p);
      });
    });

    const leftovers = [...poolE, ...poolU, ...poolSBF];
    dayAssign.push({
      kind:'main', main:true, tower:'Hauptwache',
      fuehrung:poolF, mainGuards, base:leftovers,
      bootsfLeft:poolB,
      sick:sickToday, k, mainPairs,
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
      absentCount: people.filter(p => isAbsent(p.id)).length,
    });
  }

  // Calculate fairness metrics
  const allStats = [...stats.values()];

  // Tower distribution: count unique towers per person
  const towerDistribution = {};
  people.forEach(p => {
    const stat = stats.get(p.id);
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
    const stat = stats.get(p.id);
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
    stats.forEach(s => {
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
    schedule, pairCount, stats: Object.fromEntries(stats),
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
  // Defer rendering to next animation frame so the main thread isn't blocked
  // during heavy DOM rebuilds (14-day plans with many people). autoSave is
  // fired after renderOutput so the snapshot reflects the rendered state.
  requestAnimationFrame(() => {
    renderOutput();
    autoSave();
  });
}
