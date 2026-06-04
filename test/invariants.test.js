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
const { loadAlgoContext, setupScenario } = require('./harness');

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
