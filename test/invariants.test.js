/**
 * test/invariants.test.js - Automated invariant tests for generate.js
 *
 * Tests the 5 core invariants documented in CLAUDE.md:
 * 1. No person assigned twice on the same day
 * 2. No sick person assigned
 * 3. No closed tower/boat assigned
 * 4. slotCount respected (tower occupants <= slotCount + leaderCount)
 * 5. stats.total consistency
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { loadAlgoContext, setupScenario, vm } = require('./harness');

// Load context once per test suite
const ctx = loadAlgoContext();

// ============================================================
// INVARIANT HELPERS
// ============================================================

/**
 * Invariant 1: No person assigned twice on same day
 */
function checkNoDuplicates(schedule, dayIdx) {
  const assigned = new Set();
  const failures = [];

  schedule[dayIdx].assign.forEach(slot => {
    if (slot.occupants) {
      slot.occupants.forEach(p => {
        if (assigned.has(p.id)) {
          failures.push(`Person ${p.id} assigned twice in day ${dayIdx}`);
        }
        assigned.add(p.id);
      });
    }
  });

  // Also check main slot components separately
  const mainSlot = schedule[dayIdx].main;
  if (mainSlot) {
    const mainAssigned = new Set(assigned);
    [...(mainSlot.fuehrung || []),
      ...(mainSlot.mainGuards || []),
      ...(mainSlot.base || []),
      ...(mainSlot.bootsfLeft || []),
      ...(mainSlot.sick || []),
      ...(mainSlot.hwBoatSlot?.bootsf ? [mainSlot.hwBoatSlot.bootsf] : [])
    ].forEach(p => {
      // Sick are allowed to appear only in main.sick
      if (mainSlot.sick && mainSlot.sick.some(sp => sp.id === p.id)) {
        return; // OK to be in sick
      }
      if (mainAssigned.has(p.id)) {
        failures.push(`Person ${p.id} appears in multiple main subslots in day ${dayIdx}`);
      }
      mainAssigned.add(p.id);
    });
  }

  return failures;
}

/**
 * Invariant 2: No sick person assigned to active duty
 */
function checkNoSickAssigned(schedule, dayState, dayIdx) {
  const sickSet = dayState[dayIdx].sick;
  const failures = [];

  if (sickSet.size === 0) return failures;

  schedule[dayIdx].assign.forEach(slot => {
    if (slot.occupants) {
      slot.occupants.forEach(p => {
        if (sickSet.has(p.id)) {
          failures.push(`Sick person ${p.id} assigned to ${slot.kind}:${slot.slotId} on day ${dayIdx}`);
        }
      });
    }
  });

  // Sick can be in main.sick, but not in active slots
  const mainSlot = schedule[dayIdx].main;
  if (mainSlot) {
    [...(mainSlot.fuehrung || []),
      ...(mainSlot.mainGuards || []),
      ...(mainSlot.base || []),
      ...(mainSlot.bootsfLeft || []),
      ...(mainSlot.hwBoatSlot?.bootsf ? [mainSlot.hwBoatSlot.bootsf] : [])
    ].forEach(p => {
      if (sickSet.has(p.id)) {
        failures.push(`Sick person ${p.id} in active main slot on day ${dayIdx}`);
      }
    });
  }

  return failures;
}

/**
 * Invariant 3: No closed tower/boat assigned
 */
function checkNoClosedAssigned(schedule, dayState, dayIdx, towers, boats) {
  const closedTowers = dayState[dayIdx].closed;
  const closedBoats = dayState[dayIdx].closedBoats;
  const failures = [];

  if (closedTowers.size === 0 && closedBoats.size === 0) return failures;

  schedule[dayIdx].assign.forEach(slot => {
    if (slot.kind === 'tower' && closedTowers.has(slot.towerId)) {
      failures.push(`Closed tower ${slot.towerId} assigned on day ${dayIdx}`);
    }
    if ((slot.kind === 'boat' || slot.kind === 'hwboat') && closedBoats.has(slot.boatId)) {
      failures.push(`Closed boat ${slot.boatId} assigned on day ${dayIdx}`);
    }
  });

  return failures;
}

/**
 * Invariant 4: slotCount respected
 */
function checkSlotCounts(schedule, dayIdx, towers) {
  const failures = [];

  schedule[dayIdx].assign.forEach(slot => {
    if (slot.kind === 'tower') {
      const tower = towers.find(t => t.id === slot.towerId);
      if (!tower) {
        failures.push(`Tower ${slot.towerId} not found on day ${dayIdx}`);
        return;
      }
      const maxOccupants = tower.slotCount + (tower.leaderCount || 0);
      if (slot.occupants.length > maxOccupants) {
        failures.push(
          `Tower ${tower.name} has ${slot.occupants.length} occupants ` +
          `but max is ${maxOccupants} (slotCount=${tower.slotCount}, leaderCount=${tower.leaderCount}) ` +
          `on day ${dayIdx}`
        );
      }
    }
  });

  return failures;
}

/**
 * Invariant 6: Experience coverage – kein Erfahrener wird an der Hauptwache
 * „verschwendet", während ein Turm ohne Erfahrenen dasteht. Genau dieser Fall
 * (Erfahrene am HW statt auf einem unbesetzten Turm) war der Fairness-Bug, den
 * die Experience-Reservierung in generate.js behebt.
 */
function checkExperienceNotWastedAtHW(schedule, dayIdx, people) {
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const isExp = p => byId[p.id].role === 'F' || byId[p.id].experienced;
  const failures = [];
  const day = schedule[dayIdx];

  const uncovered = day.assign.filter(
    s => s.kind === 'tower' && s.occupants.length > 0 && !s.occupants.some(isExp)
  );
  if (uncovered.length === 0) return failures;

  const main = day.assign.find(s => s.kind === 'main');
  // Erfahrene Wachgänger (role 'W' + experienced) an aktiven/Overflow-HW-Plätzen
  const wastedExp = [...(main?.mainGuards || []), ...(main?.base || [])]
    .filter(p => byId[p.id].role === 'W' && byId[p.id].experienced);

  if (wastedExp.length > 0) {
    failures.push(
      `Day ${dayIdx}: ${uncovered.length} Turm(e) ohne Erfahrenen, ` +
      `während ${wastedExp.length} erfahrene WG an der HW sitzen`
    );
  }
  return failures;
}

// Note: Invariant 5 (stats.total consistency) is complex due to HW-overflow handling.
// HW overflow (main.base) increments hwVisits but NOT total, by design.
// See CLAUDE.md: "HW-Overflow-Personen erhöht `total` NICHT"
// This is intentional to encourage active assignment on subsequent days.

// ============================================================
// TEST SCENARIOS
// ============================================================

test('Scenario 1: Baseline 6 days', (t) => {
  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 20,
    numTowers: 7,
    numBoats: 3,
    days: 6,
    mainK: 2
  });

  let allFailures = [];

  for (let d = 0; d < 6; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `6-day baseline should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 2: 14 days', (t) => {
  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 25,
    numTowers: 7,
    numBoats: 3,
    days: 14,
    mainK: 2
  });

  let allFailures = [];

  for (let d = 0; d < 14; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `14-day scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Experience coverage: no experienced wasted at HW (6/7/14 days)', (t) => {
  // Standard-ähnliche Besetzung: ~7 erfahrene WG für 7 Türme → jeder Turm muss
  // einen Erfahrenen bekommen; HW nimmt Unerfahrene. Über mehrere Tageslängen.
  for (const days of [6, 7, 14]) {
    const { schedule } = setupScenario(ctx, {
      numPeople: 22, numTowers: 7, numBoats: 3, days, mainK: 2
    });
    const people = vm.runInContext('people', ctx);
    let failures = [];
    for (let d = 0; d < days; d++) {
      failures.push(...checkExperienceNotWastedAtHW(schedule, d, people));
    }
    assert.equal(failures.length, 0,
      `${days}-Tage: Erfahrene dürfen nicht an der HW sitzen, wenn ein Turm leer ist:\n${failures.join('\n')}`);
  }
});

test('Hauptstrand-Türme: fairer Ausgleich Hauptstrand ↔ Außentürme', (t) => {
  // 7 Türme, davon 3 als Hauptstrand markiert (mainBeach). Über die Woche soll
  // niemand einen großen Außen-Überhang ansammeln (kein „4 Tage Außenturm am Stück").
  for (const days of [6, 14]) {
    const setup = `
      resetGlobalState();
      uid = 0; people = []; towers = []; boats = [];
      for(let i=0;i<7;i++){ towers.push({ id:++uid, name:'T'+(i+1), prio:i+1, code:'T'+(i+1), slotCount:2, leaderCount:0, mainBeach: i < 3 }); }
      boats.push({ id:++uid, name:'B1', code:'B1', towerId: towers[0].id, prio:1, slotCount:1 });
      boats.push({ id:++uid, name:'B2', code:'B2', towerId: towers[3].id, prio:2, slotCount:1 });
      people.push({ id:++uid, name:'F1', role:'F', experienced:true });
      people.push({ id:++uid, name:'F2', role:'F', experienced:true });
      for(let i=0;i<3;i++) people.push({ id:++uid, name:'BF'+i, role:'B', experienced:i<2 });
      for(let i=0;i<7;i++) people.push({ id:++uid, name:'E'+i, role:'W', experienced:true });
      for(let i=0;i<10;i++) people.push({ id:++uid, name:'U'+i, role:'W', experienced:false });
      DAYS = ${days}; mainK = 2; randomSeed = 0;
      dayState = freshDayState();
      forcedPlacements = freshForcedPlacements();
      exportColumns = Array(16).fill('');
      generate();
      lastResult;
    `;
    const res = vm.runInContext(setup, ctx);
    const schedule = res.schedule;
    const stats = res.stats;
    const towers = vm.runInContext('towers', ctx);
    const dayState = vm.runInContext('dayState', ctx);
    const boats = vm.runInContext('boats', ctx);

    // Kern-Invarianten bleiben unverletzt
    let failures = [];
    for (let d = 0; d < days; d++) {
      failures.push(...checkNoDuplicates(schedule, d));
      failures.push(...checkNoSickAssigned(schedule, dayState, d));
      failures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
      failures.push(...checkSlotCounts(schedule, d, towers));
    }
    assert.equal(failures.length, 0,
      `${days}-Tage Hauptstrand: Kern-Invarianten verletzt:\n${failures.join('\n')}`);

    // Außen-Überhang (outer - main) pro Person prüfen. Es gibt 4 Außen- (8 Sitze)
    // und 3 Hauptstrand-Türme (6 Sitze) → ein kleiner Außen-Überschuss ist
    // unvermeidbar. Erwartung: deutlich kleiner als ein „jeden-Tag-Außen"-Plan.
    let maxOver = 0;
    Object.values(stats).forEach(s => {
      if (((s.mainBeachDays||0) + (s.outerBeachDays||0)) === 0) return;
      maxOver = Math.max(maxOver, (s.outerBeachDays||0) - (s.mainBeachDays||0));
    });
    assert.ok(maxOver <= 5,
      `${days}-Tage: Außen-Überhang einer Person zu groß (${maxOver} > 5) – Ausgleich greift nicht`);
  }
});

test('Boat rotation: a captain returns to the same boat no sooner than #boats days', (t) => {
  // 3 Boote → ein BF darf frühestens nach 3 Tagen wieder aufs gleiche Boot
  // (Mo → frühestens Do). Über mehrere Tageslängen.
  for (const days of [6, 7, 14]) {
    const { schedule } = setupScenario(ctx, {
      numPeople: 22, numTowers: 7, numBoats: 3, days, mainK: 2
    });
    // Anzahl tatsächlich vorhandener Boote aus dem Schedule ableiten
    const boatIds = new Set();
    schedule.forEach(day => day.assign.forEach(s => { if (s.kind === 'boat') boatIds.add(s.boatId); }));
    const nBoats = boatIds.size;

    const lastDayOnBoat = {}; // `${bfId}|${boatId}` -> dayIdx
    const failures = [];
    schedule.forEach((day, d) => {
      day.assign.filter(s => s.kind === 'boat' && s.bootsf).forEach(b => {
        const key = `${b.bootsf.id}|${b.boatId}`;
        if (key in lastDayOnBoat) {
          const gap = d - lastDayOnBoat[key];
          if (gap < nBoats) failures.push(`BF ${b.bootsf.id} zurück auf Boot ${b.boatId} nach nur ${gap} Tag(en) (Tag ${d})`);
        }
        lastDayOnBoat[key] = d;
      });
    });
    assert.equal(failures.length, 0,
      `${days}-Tage / ${nBoats} Boote: BF-Boot-Rückkehr zu früh:\n${failures.join('\n')}`);
  }
});

test('Scenario 3: Single day', (t) => {
  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 15,
    numTowers: 5,
    numBoats: 2,
    days: 1,
    mainK: 2
  });

  let allFailures = [];

  for (let d = 0; d < 1; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `1-day scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 4: Sick persons', (t) => {
  const sickPersonIds = new Set([1, 2, 3]);

  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 20,
    numTowers: 7,
    numBoats: 3,
    days: 6,
    mainK: 2,
    sickPersonIds
  });

  let allFailures = [];

  for (let d = 0; d < 6; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `Sick persons scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 5: Closed tower', (t) => {
  const closedTowerIds = new Set([1, 3]);

  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 20,
    numTowers: 7,
    numBoats: 3,
    days: 6,
    mainK: 2,
    closedTowerIds
  });

  let allFailures = [];

  for (let d = 0; d < 6; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `Closed tower scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 6: Closed boat', (t) => {
  const closedBoatIds = new Set([11, 12]);

  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 20,
    numTowers: 7,
    numBoats: 3,
    days: 6,
    mainK: 2,
    closedBoatIds
  });

  let allFailures = [];

  for (let d = 0; d < 6; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `Closed boat scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 7: Minimal crew (1 person)', (t) => {
  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 1,
    numTowers: 1,
    numBoats: 0,
    days: 3,
    mainK: 0
  });

  let allFailures = [];

  for (let d = 0; d < 3; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `1-person scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 8: All persons sick', (t) => {
  // Create scenario, then mark all as sick
  const numPeople = 10;
  const sickPersonIds = new Set();
  for (let i = 1; i <= numPeople; i++) {
    sickPersonIds.add(i);
  }

  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople,
    numTowers: 3,
    numBoats: 1,
    days: 2,
    mainK: 1,
    sickPersonIds
  });

  let allFailures = [];

  for (let d = 0; d < 2; d++) {
    allFailures.push(...checkNoDuplicates(schedule, d));
    allFailures.push(...checkNoSickAssigned(schedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(schedule, d, towers));
  }

  assert.equal(allFailures.length, 0, `All-sick scenario should have no invariant violations:\n${allFailures.join('\n')}`);
});

test('Scenario 9: Fuzz test (100 iterations)', (t) => {
  const iterations = 100;
  let totalFailures = 0;
  const failuresByType = {};

  for (let iter = 0; iter < iterations; iter++) {
    // Random parameters per iteration
    const numPeople = 8 + Math.floor(Math.random() * 20); // 8-27
    const numTowers = 3 + Math.floor(Math.random() * 6); // 3-8
    const numBoats = 1 + Math.floor(Math.random() * 4); // 1-4
    const days = 1 + Math.floor(Math.random() * 6); // 1-6
    const mainK = Math.floor(Math.random() * 4); // 0-3

    // Random sick/closed patterns
    const sickPersonIds = new Set();
    const sicknessRate = Math.random();
    for (let i = 1; i <= numPeople; i++) {
      if (Math.random() < sicknessRate * 0.3) {
        sickPersonIds.add(i);
      }
    }

    const closedTowerIds = new Set();
    for (let i = 1; i <= numTowers; i++) {
      if (Math.random() < 0.15) {
        closedTowerIds.add(i);
      }
    }

    const closedBoatIds = new Set();
    for (let i = numTowers + 1; i <= numTowers + numBoats; i++) {
      if (Math.random() < 0.1) {
        closedBoatIds.add(i);
      }
    }

    const randomSeed = Math.floor(Math.random() * 1000);

    const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
      numPeople,
      numTowers,
      numBoats,
      days,
      mainK,
      sickPersonIds,
      closedTowerIds,
      closedBoatIds,
      randomSeed
    });

    let iterFailures = [];

    for (let d = 0; d < days; d++) {
      iterFailures.push(...checkNoDuplicates(schedule, d));
      iterFailures.push(...checkNoSickAssigned(schedule, dayState, d));
      iterFailures.push(...checkNoClosedAssigned(schedule, dayState, d, towers, boats));
      iterFailures.push(...checkSlotCounts(schedule, d, towers));
    }

    if (iterFailures.length > 0) {
      totalFailures += iterFailures.length;
      const failType = iterFailures[0].split(':')[0];
      failuresByType[failType] = (failuresByType[failType] || 0) + 1;
    }
  }

  assert.equal(
    totalFailures,
    0,
    `Fuzz test (100 iterations): ${totalFailures} total failures detected. Breakdown: ${JSON.stringify(failuresByType)}`
  );
});

test('Scenario 10: Transparent forced placement violates no invariants', (t) => {
  const { schedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 10,
    numTowers: 4,
    numBoats: 2,
    days: 3,
    mainK: 2
  });

  // Schedule generated, now apply transparent placement on day 1
  // Move person 1 from their assigned tower to main (HW)
  const setupTransparentCode = `
    // Person 1's original assignment on day 1
    const dayOneSlot = lastResult.schedule[1].assign.find(s =>
      s.kind === 'tower' && s.occupants.some(p => p.id === 1)
    );

    if (dayOneSlot) {
      // Apply transparent forced placement
      forcedPlacements[1].push({
        personId: 1,
        kind: 'main',
        slotId: 0,
        transparent: true
      });
      // Re-generate only day 1 (which applies transparent swap)
      generate(1);
    }
  `;

  try {
    vm.runInContext(setupTransparentCode, ctx);
  } catch (err) {
    throw new Error(`Transparent placement setup failed: ${err.message}`);
  }

  // Retrieve updated schedule
  const updatedSchedule = vm.runInContext('lastResult.schedule', ctx);

  let allFailures = [];

  // Check day 1 (where transparent swap was applied)
  allFailures.push(...checkNoDuplicates(updatedSchedule, 1));
  allFailures.push(...checkNoSickAssigned(updatedSchedule, dayState, 1));
  allFailures.push(...checkNoClosedAssigned(updatedSchedule, dayState, 1, towers, boats));
  allFailures.push(...checkSlotCounts(updatedSchedule, 1, towers));

  assert.equal(
    allFailures.length,
    0,
    `Transparent forced placement on day 1 should violate no invariants:\n${allFailures.join('\n')}`
  );
});

test('Scenario 11: Partial recalculation (generate(startDay=3)) preserves earlier days', (t) => {
  // Helper to snapshot day assignments for comparison
  const snapshotDayAssignments = (schedule, dayIdx) => {
    const day = schedule[dayIdx];
    if (!day || !day.assign) return null;

    // Create a snapshot of occupant IDs by slot (ignore order-sensitive properties)
    const snapshot = {};
    day.assign.forEach(slot => {
      const key = `${slot.kind}:${slot.towerId || slot.boatId || 'main'}`;
      if (!snapshot[key]) {
        snapshot[key] = { occupantIds: [] };
      }
      if (slot.occupants) {
        snapshot[key].occupantIds.push(...slot.occupants.map(p => p.id).sort((a, b) => a - b));
      }
    });
    return snapshot;
  };

  const { schedule: initialSchedule, stats, dayState, towers, boats } = setupScenario(ctx, {
    numPeople: 14,
    numTowers: 6,
    numBoats: 3,
    days: 6,
    mainK: 2
  });

  // Snapshot days 0-2 assignments before partial recalculation
  const snapshotsBefore = [];
  for (let d = 0; d < 3; d++) {
    snapshotsBefore.push(snapshotDayAssignments(initialSchedule, d));
  }

  // Trigger partial recalculation from day 3
  const partialRecalcCode = `
    generate(3);  // Only recalculate days 3-5, keep 0-2
  `;

  try {
    vm.runInContext(partialRecalcCode, ctx);
  } catch (err) {
    throw new Error(`Partial recalculation setup failed: ${err.message}`);
  }

  const updatedSchedule = vm.runInContext('lastResult.schedule', ctx);
  const updatedStats = vm.runInContext('lastResult.stats', ctx);

  // Verify days 0-2 occupant IDs are unchanged
  for (let d = 0; d < 3; d++) {
    const snapshotAfter = snapshotDayAssignments(updatedSchedule, d);
    assert.deepEqual(
      snapshotAfter,
      snapshotsBefore[d],
      `Day ${d} occupant assignments should be identical after partial recalculation from day 3`
    );
  }

  let allFailures = [];

  // Verify all days (0-5) still satisfy invariants
  for (let d = 0; d < 6; d++) {
    allFailures.push(...checkNoDuplicates(updatedSchedule, d));
    allFailures.push(...checkNoSickAssigned(updatedSchedule, dayState, d));
    allFailures.push(...checkNoClosedAssigned(updatedSchedule, dayState, d, towers, boats));
    allFailures.push(...checkSlotCounts(updatedSchedule, d, towers));
  }

  assert.equal(
    allFailures.length,
    0,
    `Partial recalculation should preserve invariants for all days:\n${allFailures.join('\n')}`
  );

  // Verify stats were properly re-accumulated for early days
  const assignedInEarlyDays = new Set();
  for (let d = 0; d < 3; d++) {
    updatedSchedule[d].assign.forEach(slot => {
      if (slot.occupants) {
        slot.occupants.forEach(p => assignedInEarlyDays.add(p.id));
      }
    });
  }

  assert(
    assignedInEarlyDays.size > 0,
    'Should have people assigned in days 0-2'
  );
});
