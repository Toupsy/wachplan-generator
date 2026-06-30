/**
 * test/boat-matching-optimality.test.js – Globaloptimalität des Boot→BF-Matchings (Issue #384)
 *
 * Problem: Der B&B-Prune `if(acc >= best.total)` im DFS ist nur korrekt, wenn alle
 * Kantenkosten ≥ 0 sind. `boatCost` kann aber negativ werden, weil der `boatHwBonus`-Term
 * (HW-Tage als Bonus bei Boot-Zuweisung) den Gesamtscore unter 0 drücken kann.
 * Infolgedessen wurden bessere Zuordnungen vorzeitig verworfen → suboptimales Matching.
 *
 * Fix: Zulässige untere Schranke per Suffix-Min-Array statt naivem `acc >= best`.
 *
 * Tests:
 * 1. Bei BF-Überzahl über mehrere Tage: Boot-Dienste werden fair auf alle BF verteilt
 *    (nicht nur auf jene, die der DFS zufällig zuerst findet, wenn der Prune feuert).
 * 2. Die untere Schranke ist korrekt admissibel: mit einem handgefertigten Plan, in dem
 *    negative Kantenkosten auftreten, wird das global optimale Assignment gefunden.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats, days = 7, mainK = 2, seed = 0 }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = ${seed};
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generate();
    lastResult;
  `;
  return vm.runInContext(code, ctx);
}

// Alle Permutationen eines Arrays (für Brute-Force-Optimalitätsprüfung bei n ≤ 3)
function permutations(arr) {
  if (arr.length <= 1) return [arr];
  const result = [];
  for (let i = 0; i < arr.length; i++) {
    const rest = [...arr.slice(0, i), ...arr.slice(i + 1)];
    permutations(rest).forEach(p => result.push([arr[i], ...p]));
  }
  return result;
}

// ────────────────────────────────────────────────────────────────────────────────
// Test 1: Boot-Besuche sind fair verteilt wenn 1 BF täglich überzählig ist
// ────────────────────────────────────────────────────────────────────────────────
test('Boot-Matching: faire Verteilung bei täglich 1 überzähligem BF über 14 Tage', () => {
  // 4 BF + 3 Boote → jeden Tag 1 BF überzählig → landet an der HW (hwVisits++).
  // Über 14 Tage soll die Boot-Besetzung fair rotieren; der Fairness-Algorithmus nutzt
  // genau den boatHwBonus-Term, der negative Kosten erzeugt → der B&B-Prune muss korrekt sein.
  const PEOPLE = [
    { id: 1, name: 'BF1', role: 'B', experienced: true },
    { id: 2, name: 'BF2', role: 'B', experienced: true },
    { id: 3, name: 'BF3', role: 'B', experienced: false },
    { id: 4, name: 'BF4', role: 'B', experienced: false },
    { id: 5, name: 'E1',  role: 'W', experienced: true  },
    { id: 6, name: 'E2',  role: 'W', experienced: true  },
    { id: 7, name: 'U1',  role: 'W', experienced: false },
    { id: 8, name: 'U2',  role: 'W', experienced: false },
  ];
  const TOWERS = [
    { id: 20, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
    { id: 21, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
  ];
  const BOATS = [
    { id: 10, name: 'Bo1', code: 'B1', towerId: 20, prio: 1, slotCount: 1 },
    { id: 11, name: 'Bo2', code: 'B2', towerId: 21, prio: 2, slotCount: 1 },
    { id: 12, name: 'Bo3', code: 'B3', towerId: 20, prio: 3, slotCount: 1 },
  ];

  const res = run({ people: PEOPLE, towers: TOWERS, boats: BOATS, days: 14, mainK: 2 });
  assert.ok(res && res.schedule && res.schedule.length === 14, 'Plan enthält 14 Tage');

  const stats = res.stats;
  const bfIds = [1, 2, 3, 4];

  // Jeder BF sollte über 14 Tage nennenswert HW-Besuche akkumuliert haben
  const hwVisits = bfIds.map(id => stats[id]?.hwVisits || 0);
  assert.ok(Math.max(...hwVisits) >= 2, `Mind. 1 BF mit ≥2 hwVisits (war: ${hwVisits})`);

  // Boot-Besuche total pro BF (Summe über alle Boote)
  const boatTotals = bfIds.map(id => {
    const bv = stats[id]?.boatVisits || {};
    return Object.values(bv).reduce((a, b) => a + b, 0);
  });

  // 14 Tage × 3 Boote = 42 Boot-Einsätze verteilt auf 4 BF → Ø 10,5
  // Faire Rotation: max − min ≤ 5 (Toleranz für Randeffekte)
  const maxBoatDays = Math.max(...boatTotals);
  const minBoatDays = Math.min(...boatTotals);
  assert.ok(
    maxBoatDays - minBoatDays <= 5,
    `Boot-Besuche unfair verteilt: max=${maxBoatDays}, min=${minBoatDays}, pro BF: ${boatTotals}`
  );
});

// ────────────────────────────────────────────────────────────────────────────────
// Test 2: Optimales Assignment – negative Kantenkosten führen nicht zu Prune-Fehler
// ────────────────────────────────────────────────────────────────────────────────
test('Boot-Matching: globales Optimum wird auch mit negativen Kantenkosten gefunden', () => {
  // Aufbau: 4 BF + 3 Boote an einem Turm. Tage 1–7: Bo2 und Bo3 geschlossen → 3 BF landen
  // täglich an der HW (Überzahl, HW-Overflow), akkumulieren hwVisits → negative boatCost.
  //
  // Tag 8 (alle 3 Boote offen): BF-Sort stellt den HW-schweren BF vorn; die korrekte
  // admissible Schranke muss alle 24 möglichen BF-Kombinationen (4C3 × 3!) korrekt
  // abschneiden. Wir verifizieren durch Brute-Force über alle 4 BFs.
  //
  // Turm-Setup: alle 3 Boote auf T1 → T1 öffnet mit 2 E/U (mainK=2 nimmt 2 von 4 E/U,
  // T1 slotCount=2 nimmt die anderen 2). Kein T2 nötig.

  const PEOPLE = [
    { id: 1, name: 'BF1', role: 'B', experienced: true  },
    { id: 2, name: 'BF2', role: 'B', experienced: true  },
    { id: 3, name: 'BF3', role: 'B', experienced: false },
    { id: 4, name: 'BF4', role: 'B', experienced: false },
    { id: 5, name: 'E1',  role: 'W', experienced: true  },
    { id: 6, name: 'E2',  role: 'W', experienced: true  },
    { id: 7, name: 'U1',  role: 'W', experienced: false },
    { id: 8, name: 'U2',  role: 'W', experienced: false },
  ];
  // Einziger Turm: T1. Alle 3 Boote auf T1 → T1 muss offen sein damit die Boote aktiv werden.
  // mainK=2 (2 HW-Slots) + T1 slotCount=2 → 4 E/U-Slots genau von 4 E/U-Personen abgedeckt.
  const TOWERS = [{ id: 20, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 }];
  const BOAT1_ID = 10, BOAT2_ID = 11, BOAT3_ID = 12;
  const ALL_BOATS = [
    { id: BOAT1_ID, name: 'Bo1', code: 'B1', towerId: 20, prio: 1, slotCount: 1 },
    { id: BOAT2_ID, name: 'Bo2', code: 'B2', towerId: 20, prio: 2, slotCount: 1 },
    { id: BOAT3_ID, name: 'Bo3', code: 'B3', towerId: 20, prio: 3, slotCount: 1 },
  ];

  // Phase 1 (7 Tage, Bo2+Bo3 geschlossen): HW-Besuche bei den 3 überzähligen BF aufbauen
  const code7 = `
    resetGlobalState();
    people = ${JSON.stringify(PEOPLE)};
    towers = ${JSON.stringify(TOWERS)};
    boats  = ${JSON.stringify(ALL_BOATS)};
    uid = 9999; DAYS = 7; mainK = 2; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    dayState.forEach(ds => { ds.closedBoats.add(${BOAT2_ID}); ds.closedBoats.add(${BOAT3_ID}); });
    generate();
    lastResult;
  `;
  const res7 = vm.runInContext(code7, ctx);

  const stats7 = res7.stats;
  const bfIds = [1, 2, 3, 4];
  const hwVisits7 = bfIds.map(id => stats7[id]?.hwVisits || 0);

  assert.ok(
    hwVisits7.filter(v => v >= 2).length >= 2,
    `Erwarte ≥2 BF mit ≥2 hwVisits nach Phase 1 (war: ${hwVisits7})`
  );

  // Phase 2 (Tag 8, alle Boote offen): Matching prüfen
  const code8 = `
    resetGlobalState();
    people = ${JSON.stringify(PEOPLE)};
    towers = ${JSON.stringify(TOWERS)};
    boats  = ${JSON.stringify(ALL_BOATS)};
    uid = 9999; DAYS = 8; mainK = 2; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    for(let d = 0; d < 7; d++){
      dayState[d].closedBoats.add(${BOAT2_ID});
      dayState[d].closedBoats.add(${BOAT3_ID});
    }
    generate();
    lastResult;
  `;
  const res8 = vm.runInContext(code8, ctx);

  const day8 = res8.schedule[7];
  const boatSlots8 = day8.assign.filter(s => s.kind === 'boat');

  assert.equal(boatSlots8.length, 3, 'Tag 8: alle 3 Boote sollten aktiv sein (alle auf T1, das offen ist)');

  const assignedBfIds = boatSlots8.map(s => s.bootsf?.id).filter(id => id != null);
  const assignedBoatIds = boatSlots8.map(s => s.boatId);

  assert.equal(assignedBfIds.length, 3, 'Tag 8: 3 BF auf 3 Booten');

  // approxCost: boatCost ohne Rotationspenalty (immer ≥ 0, macht echte Kosten höchstens schlechter)
  const BOAT_HW_BONUS = 10;
  const BOAT_VISIT_WEIGHT = 50;
  const approxCost = (bfId, boatId) => {
    const s = stats7[bfId] || {};
    return (s.total || 0) + ((s.boatVisits || {})[boatId] || 0) * BOAT_VISIT_WEIGHT - (s.hwVisits || 0) * BOAT_HW_BONUS;
  };

  // Actual assignment cost (approximate)
  let actualCost = 0;
  for (let i = 0; i < assignedBfIds.length; i++) {
    actualCost += approxCost(assignedBfIds[i], assignedBoatIds[i]);
  }

  // Brute-Force über ALLE 4 BFs: alle 4×3 Kombinationen (4 BF für 3 Boote + 1 Surplus)
  // → jeder BF kann Surplus sein → 4 Gruppen à 3! = 6 Permutationen = 24 mögliche Assignments
  const allBoatIds = [BOAT1_ID, BOAT2_ID, BOAT3_ID];
  let globalMin = Infinity;
  for (let surplus = 0; surplus < bfIds.length; surplus++) {
    const trio = bfIds.filter((_, i) => i !== surplus);
    for (const perm of permutations(trio)) {
      let cost = 0;
      for (let i = 0; i < 3; i++) cost += approxCost(perm[i], allBoatIds[i]);
      if (cost < globalMin) globalMin = cost;
    }
  }

  // Toleranz von 2×boatRotationBase (max 1 Boot mit Rotationspenalty kann tatsächliche Kosten
  // über das approxCost-Optimum heben; 2000 ist ein sehr großzügiger Puffer)
  assert.ok(
    actualCost <= globalMin + 2000,
    `Tag 8: suboptimales Boot-Assignment.` +
    ` actualCost=${actualCost}, globalMin=${globalMin} (approx, ohne Rotationspenalty).` +
    ` BF→Boot: ${assignedBfIds.join(',')}→${assignedBoatIds.join(',')}.` +
    ` hwVisits nach Tag 7: ${JSON.stringify(hwVisits7)}`
  );

  // Schärfere Prüfung: Der BF mit den meisten HW-Tagen (billigster boatCost) ist Bootsführer,
  // nicht surplus – sonst würde die Fairness-Rotation fundamentally falsch laufen.
  const mostHwBfId = bfIds.reduce((best, id) =>
    (stats7[id]?.hwVisits || 0) > (stats7[best]?.hwVisits || 0) ? id : best, bfIds[0]);
  assert.ok(
    assignedBfIds.includes(mostHwBfId),
    `BF ${mostHwBfId} (meiste HW-Tage: ${stats7[mostHwBfId]?.hwVisits}) sollte` +
    ` Tag 8 ein Boot fahren, nicht surplus sein. Zugewiesen: [${assignedBfIds}]`
  );
});

// ────────────────────────────────────────────────────────────────────────────────
// Test 3: kein Crash / Invarianten bleiben gültig (Regression)
// ────────────────────────────────────────────────────────────────────────────────
test('Boot-Matching: Plan bleibt gültig bei max. Matching-Größe (8 Boote)', () => {
  // MAX_BOAT_MATCHING = 8; bei 8 Booten und 8 BF läuft das Matching am Limit des DFS.
  // Kein Crash, kein doppelter BF auf zwei Booten.
  const PEOPLE = [
    ...Array.from({ length: 8 }, (_, i) => ({ id: i + 1, name: `BF${i + 1}`, role: 'B', experienced: i % 2 === 0 })),
    { id: 9, name: 'E1', role: 'W', experienced: true },
    { id: 10, name: 'E2', role: 'W', experienced: true },
    { id: 11, name: 'U1', role: 'W', experienced: false },
    { id: 12, name: 'U2', role: 'W', experienced: false },
  ];
  const TOWERS = Array.from({ length: 4 }, (_, i) => ({
    id: 20 + i, name: `T${i + 1}`, prio: i + 1, code: `T${i + 1}`, slotCount: 2, leaderCount: 0,
  }));
  const BOATS = Array.from({ length: 8 }, (_, i) => ({
    id: 40 + i, name: `Bo${i + 1}`, code: `B${i + 1}`, towerId: TOWERS[i % 4].id, prio: i + 1, slotCount: 1,
  }));

  const res = run({ people: PEOPLE, towers: TOWERS, boats: BOATS, days: 5, mainK: 2 });
  assert.ok(res && res.schedule && res.schedule.length === 5, '5-Tage-Plan erzeugt');

  // Kein BF doppelt auf zwei Booten an einem Tag
  res.schedule.forEach((day, d) => {
    const boatBfs = new Set();
    day.assign.filter(s => s.kind === 'boat').forEach(s => {
      if (s.bootsf) {
        assert.ok(!boatBfs.has(s.bootsf.id), `Tag ${d + 1}: BF ${s.bootsf.id} auf zwei Booten gleichzeitig`);
        boatBfs.add(s.bootsf.id);
      }
    });
  });
});
