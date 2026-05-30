// ============================================================
// generate.js – Kern-Algorithmus: Wachplan-Berechnung
// ============================================================

/**
 * Berechnet den 6-tägigen Wachplan und speichert das Ergebnis in lastResult.
 * Danach wird renderOutput() aufgerufen.
 *
 * Ablauf je Tag:
 *  1. Vorab-Schätzung der BF-Aufteilung (bricht Zirkularabhängigkeit).
 *  2. Offene Türme anhand des vollständigen Guard-Pools bestimmen.
 *  3. Hauptwache besetzen (Führung + k Wachgänger).
 *  4. Türme mit je 2 Wachgängern besetzen (Paar-Score minimieren).
 *  5. Boote mit je 1 Bootsführer besetzen.
 */
function generate(){
  autoCodes();

  // Paar-Häufigkeiten und Einsatz-Statistiken werden tagesübergreifend
  // akkumuliert, damit die Rotation über alle 6 Tage fair bleibt.
  const pairCount = {};
  const stats     = {};

  const ensure  = id => { if(!stats[id]) stats[id] = { total:0, towerVisits:{}, boatVisits:{} }; return stats[id]; };
  const pairKey = (a, b) => [a, b].sort((x, y) => x - y).join('|');

  const schedule = [];
  const k = Math.max(0, mainK | 0);

  for(let d = 0; d < DAYS; d++){
    const ds = dayState[d];
    const isSick = id => ds.sick.has(id);

    const availF    = people.filter(p => p.role === 'F' && !isSick(p.id));
    const availB    = people.filter(p => p.role === 'B' && !isSick(p.id));
    const availE    = people.filter(p => p.role === 'E' && !isSick(p.id));
    const availU    = people.filter(p => p.role === 'U' && !isSick(p.id));
    const sickToday = people.filter(p => isSick(p.id));

    // ── Vorab-Schätzung der BF-Aufteilung ──────────────────────────
    // Welche Türme würden nur mit E+U (ohne überzählige BF) öffnen?
    // Das liefert eine Annäherung, wie viele Boote Bootsführer brauchen.
    const preCandTowers = towers
      .filter(t => !ds.closed.has(t.id))
      .slice()
      .sort((a, b) => (b.prio - a.prio) || (a.id - b.id));

    let usedGpre = k;
    const tempOpen = [];
    for(const t of preCandTowers){
      if(usedGpre + 2 <= availE.length + availU.length){ tempOpen.push(t); usedGpre += 2; }
    }
    const boatsPre = boats.filter(b =>
      !ds.closedBoats.has(b.id) && b.towerId && tempOpen.some(t => t.id === b.towerId));
    const neededBF  = Math.min(boatsPre.length, availB.length);
    const activeBF  = availB.slice(0, neededBF);
    const surplusBF = availB.slice(neededBF);

    // ── Echte Entscheidung: offene Türme mit vollem Guard-Pool ──────
    const candidateTowers = towers
      .filter(t => !ds.closed.has(t.id))
      .slice()
      .sort((a, b) => (b.prio - a.prio) || (a.id - b.id));

    let poolE   = [...availE];
    let poolU   = [...availU];
    let poolSBF = [...surplusBF];  // überzählige Bootsführer im Guard-Pool
    let poolB   = [...activeBF];   // Bootsführer für Boote

    const getGuardPool = () => [...poolE, ...poolU, ...poolSBF];
    const removeAll    = p  => {
      poolE   = poolE.filter(x   => x.id !== p.id);
      poolU   = poolU.filter(x   => x.id !== p.id);
      poolSBF = poolSBF.filter(x => x.id !== p.id);
    };

    let openTowers = [], usedG = k;
    for(const t of candidateTowers){
      if(usedG + 2 <= getGuardPool().length){ openTowers.push(t); usedG += 2; }
    }
    const personnelClosed = candidateTowers
      .filter(t => !openTowers.includes(t))
      .sort((a, b) => (a.prio - b.prio) || (a.id - b.id));
    const manualClosed = towers.filter(t => ds.closed.has(t.id));

    const dayAssign = [];

    // ── Scoring-Helfer ──────────────────────────────────────────────
    /** Bestes Paar für Turm t aus dem aktuellen Guard-Pool auswählen. */
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
          // Tag 1 mit Seed: echter Zufall; sonst deterministisches Tiebreaker-Muster
          score += (d === 0 && randomSeed !== 0)
            ? seededRand(randomSeed, A.id * 31 + B.id * 97 + t.id * 13) * 30
            : (i * 7 + j * 13 + d * 17) % 11;
          if(score < bestScore){ bestScore = score; best = [A, B]; }
        }
      }
      return best;
    }

    /** Einsatz einer Person an Turm t in den Stats festhalten. */
    function commitPerson(p, t){
      const s = ensure(p.id);
      s.total++;
      s.towerVisits[t.id] = (s.towerVisits[t.id] || 0) + 1;
    }

    // ── 1) HAUPTWACHE ───────────────────────────────────────────────
    const mainPseudo  = { id: MAIN_ID };
    const mainGuards  = [];
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
        const cand = getGuardPool().sort((a, b) =>
          (ensure(a.id).total - ensure(b.id).total) ||
          ((ensure(a.id).towerVisits[MAIN_ID] || 0) - (ensure(b.id).towerVisits[MAIN_ID] || 0)));
        const P = cand[0];
        if(!P) break;
        removeAll(P); commitPerson(P, mainPseudo); mainGuards.push(P);
      }
    }

    // ── 2) TÜRME (je 2 Wachgänger) ─────────────────────────────────
    for(const t of openTowers){
      const slot = { kind:'tower', towerId:t.id, tower:t.name, code:t.code, prio:t.prio, occupants:[], warn:null };
      const best = bestPair(t, true);
      if(best){
        const [A, B] = best;
        slot.occupants = [A, B];
        removeAll(A); removeAll(B);
        pairCount[pairKey(A.id, B.id)] = (pairCount[pairKey(A.id, B.id)] || 0) + 1;
        commitPerson(A, t); commitPerson(B, t);
        if((A.role + B.role) === 'UU') slot.warn = 'Zwei Unerfahrene – kein Erfahrener frei';
      }
      dayAssign.push(slot);
    }

    // ── 3) BOOTE (je 1 Bootsführer) ────────────────────────────────
    const boatCandidates = boats.slice()
      .filter(b => !ds.closedBoats.has(b.id))
      .filter(b => b.towerId && openTowers.some(t => t.id === b.towerId))
      .sort((a, b) => (b.prio - a.prio) || (a.id - b.id));

    const boatsNoBootsf    = [];
    const boatsClosedTower = [];
    const boatsManualClosed = [];

    boats.forEach(b => {
      if(ds.closedBoats.has(b.id))                               boatsManualClosed.push(b);
      else if(b.towerId && !openTowers.some(t => t.id === b.towerId)) boatsClosedTower.push(b);
    });

    for(const bo of boatCandidates){
      const slot = {
        kind: 'boat', boatId: bo.id, name: bo.name, code: bo.code, prio: bo.prio,
        towerId: bo.towerId, towerName: towers.find(t => t.id === bo.towerId)?.name || '',
        bootsf: null,
      };
      poolB.sort((a, b) => {
        const sa = ensure(a.id), sb = ensure(b.id);
        return (sa.total - sb.total)
          || ((sa.boatVisits[bo.id] || 0) - (sb.boatVisits[bo.id] || 0))
          || (a.id - b.id);
      });
      const bf = poolB.shift();
      if(bf){
        slot.bootsf = bf;
        const s = ensure(bf.id);
        s.total++;
        s.boatVisits[bo.id] = (s.boatVisits[bo.id] || 0) + 1;
        dayAssign.push(slot);
      } else {
        boatsNoBootsf.push(bo);
      }
    }

    // ── 4) HAUPTWACHE – abschließende Reste ────────────────────────
    const leftovers = [...poolE, ...poolU, ...poolSBF];
    dayAssign.push({
      kind: 'main', main: true, tower: 'Hauptwache',
      fuehrung: availF, mainGuards, base: leftovers, bootsfLeft: poolB,
      sick: sickToday, k,
    });

    schedule.push({
      day: d, assign: dayAssign, openTowers, personnelClosed, manualClosed,
      boatsNoBootsf, boatsClosedTower, boatsManualClosed,
      availB, sickCount: sickToday.length,
    });
  }

  lastResult = {
    schedule,
    pairCount,
    stats,
    peopleGuards: people.filter(p => p.role === 'E' || p.role === 'U'),
  };
  if(activeDay >= DAYS) activeDay = 0;
  renderOutput();
}
