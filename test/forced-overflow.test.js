/**
 * test/forced-overflow.test.js – Regression für Bug #397
 *
 * Effektive (transparent:false) Zwangszuweisungen, deren Zielslot sie nicht aufnehmen kann,
 * dürfen die Person NICHT verschwinden lassen. Drei Fälle:
 *   1. Mehr forcierte Personen auf einen Turm als slotCount → Überzählige an die HW.
 *   2. Zwei Personen auf ein 1-Platz-Boot → die zweite an die HW.
 *   3. Forcierte Person auf ein an diesem Tag geschlossenes Boot → an die HW (Boot bleibt leer).
 *
 * Vor dem Fix wurden die Überzähligen aus allen Pools entfernt (effectiveForcedIds), aber nie
 * platziert → sie fehlten komplett in Plan/Export/Statistik.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 2, mainK = 2, forcedDay0 = [], closedBoatsDay0 = [] }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    dayState[0].closedBoats = new Set(${JSON.stringify(closedBoatsDay0)});
    forcedPlacements[0] = ${JSON.stringify(forcedDay0)};
    exportColumns = Array(16).fill('');
    generate();
    lastResult;
  `;
  return vm.runInContext(code, ctx);
}

const TOWERS = [
  { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2 },
  { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
];

const PEOPLE = [
  { id: 1, name: 'F1', role: 'F' },
  { id: 2, name: 'B1', role: 'B', experienced: true },
  { id: 3, name: 'B2', role: 'B', experienced: true },
  { id: 4, name: 'E1', role: 'W', experienced: true },
  { id: 5, name: 'E2', role: 'W', experienced: true },
  { id: 6, name: 'U1', role: 'W', experienced: false },
  { id: 7, name: 'U2', role: 'W', experienced: false },
  { id: 8, name: 'U3', role: 'W', experienced: false },
];

function findPersonInDay(day, id) {
  for (const slot of day.assign) {
    const buckets = [slot.occupants, slot.mainGuards, slot.fuehrung, slot.base, slot.bootsfLeft];
    for (const b of buckets) {
      if (Array.isArray(b) && b.some(p => p && p.id === id)) return slot.kind;
    }
  }
  return null;
}

function assertNoDuplicates(res) {
  res.schedule.forEach((day, i) => {
    const seen = new Set();
    for (const slot of day.assign) {
      const buckets = [slot.occupants, slot.mainGuards, slot.fuehrung, slot.base, slot.bootsfLeft];
      for (const b of buckets) {
        if (!Array.isArray(b)) continue;
        for (const p of b) {
          if (!p) continue;
          assert.ok(!seen.has(p.id), `Tag ${i + 1}: Person ${p.id} doppelt eingeplant`);
          seen.add(p.id);
        }
      }
    }
  });
}

test('#397: Turm-Überzahl (3 forciert auf 2-Slot-Turm) → überzählige Person an der HW', () => {
  const res = run({
    people: PEOPLE, towers: TOWERS, days: 2, mainK: 2,
    forcedDay0: [
      { personId: 4, kind: 'tower', slotId: 21, transparent: false },
      { personId: 5, kind: 'tower', slotId: 21, transparent: false },
      { personId: 6, kind: 'tower', slotId: 21, transparent: false }, // überzählig
    ],
  });
  const day0 = res.schedule[0];
  // Alle drei müssen im Plan sein.
  [4, 5, 6].forEach(id => {
    assert.ok(findPersonInDay(day0, id) !== null, `Person ${id} darf nicht verschwinden`);
  });
  // Die überzählige (6) landet an der HW.
  assert.equal(findPersonInDay(day0, 6), 'main', 'überzählige Person 6 wird an der HW aufgefangen');
  assert.ok(res.stats[6] && res.stats[6].total >= 1, 'stats[6].total ≥ 1 (aktiver HW-Dienst)');
  assertNoDuplicates(res);
});

test('#397: Boot-Überzahl (2 forciert auf 1-Platz-Boot) → zweite Person an der HW', () => {
  const res = run({
    people: PEOPLE, towers: TOWERS,
    boats: [{ id: 31, name: 'Boot1', code: 'B1', towerId: 21, prio: 1, slotCount: 1 }],
    days: 2, mainK: 2,
    forcedDay0: [
      { personId: 2, kind: 'boat', slotId: 31, transparent: false },
      { personId: 3, kind: 'boat', slotId: 31, transparent: false }, // überzählig
    ],
  });
  const day0 = res.schedule[0];
  assert.equal(findPersonInDay(day0, 2), 'boat', 'Person 2 sitzt auf dem Boot');
  assert.equal(findPersonInDay(day0, 3), 'main', 'überzählige Person 3 wird an der HW aufgefangen');
  assert.ok(res.stats[3] && res.stats[3].total >= 1, 'stats[3].total ≥ 1 (aktiver HW-Dienst)');
  assertNoDuplicates(res);
});

test('#397: forciertes Boot ist geschlossen → Person an der HW, Boot bleibt unbesetzt', () => {
  const res = run({
    people: PEOPLE, towers: TOWERS,
    boats: [{ id: 31, name: 'Boot1', code: 'B1', towerId: 21, prio: 1, slotCount: 1 }],
    days: 2, mainK: 2,
    closedBoatsDay0: [31],
    forcedDay0: [
      { personId: 2, kind: 'boat', slotId: 31, transparent: false },
    ],
  });
  const day0 = res.schedule[0];
  assert.equal(findPersonInDay(day0, 2), 'main', 'Person 2 wird an der HW aufgefangen (Boot geschlossen)');
  // Kein Boot-Slot mit Person 2 besetzt.
  const boatSlotWithP2 = day0.assign.find(
    s => s.kind === 'boat' && s.boatId === 31 && Array.isArray(s.occupants) && s.occupants.some(p => p.id === 2)
  );
  assert.equal(boatSlotWithP2, undefined, 'geschlossenes Boot 31 darf nicht mit Person 2 belegt sein');
  assertNoDuplicates(res);
});
