/**
 * test/require-bf-hw.test.js – Tests für „Bei BF-Überschuss immer 1 BF auf der HW"
 *
 * Globale Option requireBfAtHw: Gibt es echte Bootsführer-Überzahl (mehr BF als
 * besetzbare Boote), soll an JEDEM Tag mindestens ein überzähliger BF einen AKTIVEN
 * HW-Dienst (mainGuards) bekommen – z.B. bei mainK=3 → 2 Wachgänger + 1 BF.
 *
 * Kernanforderungen:
 * 1. Flag an + BF-Überzahl → jeden Tag ≥1 BF unter den aktiven HW-Guards.
 * 2. Es bleibt Platz für Wachgänger (BF belegt nur EINEN HW-Slot, nicht alle).
 * 3. Flag an, aber KEINE Überzahl (BF == Boote) → kein BF auf HW erzwungen.
 * 4. Flag aus → keine BF-Pflicht (Default-Verhalten unverändert).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 4, mainK = 2, requireBfAtHw = false }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    requireBfAtHw = ${requireBfAtHw};
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generate();
    lastResult;
  `;
  return vm.runInContext(code, ctx);
}

const TOWERS = [
  { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
  { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
  { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
];

// 4 BF (1 für das eine Boot, 3 überzählig) + reichlich Wachgänger
const PEOPLE_SURPLUS = [
  { id: 1, name: 'F1', role: 'F' },
  { id: 2, name: 'B1', role: 'B', experienced: true },
  { id: 3, name: 'B2', role: 'B', experienced: true },
  { id: 4, name: 'B3', role: 'B', experienced: false },
  { id: 5, name: 'B4', role: 'B', experienced: false },
  { id: 6, name: 'E1', role: 'W', experienced: true },
  { id: 7, name: 'E2', role: 'W', experienced: true },
  { id: 8, name: 'E3', role: 'W', experienced: true },
  { id: 9, name: 'E4', role: 'W', experienced: true },
  { id: 10, name: 'U1', role: 'W', experienced: false },
  { id: 11, name: 'U2', role: 'W', experienced: false },
  { id: 12, name: 'U3', role: 'W', experienced: false },
  { id: 13, name: 'U4', role: 'W', experienced: false },
];

const ONE_BOAT = [{ id: 31, name: 'Boot 1', code: 'BO1', towerId: 21, prio: 1, slotCount: 1 }];

const hwGuards = day => (day.assign.find(s => s.kind === 'main').mainGuards || []);

test('Flag an + BF-Überzahl: jeden Tag ≥1 BF aktiv auf der HW', () => {
  const res = run({
    people: PEOPLE_SURPLUS, towers: TOWERS, boats: ONE_BOAT,
    days: 6, mainK: 3, requireBfAtHw: true,
  });
  res.schedule.forEach((day, i) => {
    const guards = hwGuards(day);
    const bfCount = guards.filter(p => p.role === 'B').length;
    assert.ok(bfCount >= 1, `Tag ${i + 1}: mind. 1 BF unter den HW-Guards (war ${bfCount})`);
    // Platz für Wachgänger bleibt: bei mainK=3 sitzen 2 WG + 1 BF
    assert.equal(guards.length, 3, `Tag ${i + 1}: HW voll besetzt (k=3)`);
    assert.ok(guards.filter(p => p.role === 'W').length >= 1,
      `Tag ${i + 1}: noch Wachgänger auf der HW`);
  });
});

test('Flag an, aber keine Überzahl (BF == Boote): kein BF auf HW erzwungen', () => {
  // 1 BF, 1 Boot → BF fährt das Boot, keine Überzahl → poolSBF leer
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 2, name: 'B1', role: 'B', experienced: true },
    { id: 6, name: 'E1', role: 'W', experienced: true },
    { id: 7, name: 'E2', role: 'W', experienced: true },
    { id: 8, name: 'E3', role: 'W', experienced: true },
    { id: 9, name: 'E4', role: 'W', experienced: true },
    { id: 10, name: 'U1', role: 'W', experienced: false },
    { id: 11, name: 'U2', role: 'W', experienced: false },
    { id: 12, name: 'U3', role: 'W', experienced: false },
    { id: 13, name: 'U4', role: 'W', experienced: false },
  ];
  const res = run({ people, towers: TOWERS, boats: ONE_BOAT, days: 4, mainK: 2, requireBfAtHw: true });
  res.schedule.forEach((day, i) => {
    const bfCount = hwGuards(day).filter(p => p.role === 'B').length;
    assert.equal(bfCount, 0, `Tag ${i + 1}: kein BF auf HW (keine Überzahl)`);
  });
});

test('Flag an: kein Doppel-BF, ein BF reicht (HW nicht von BF überflutet)', () => {
  const res = run({
    people: PEOPLE_SURPLUS, towers: TOWERS, boats: ONE_BOAT,
    days: 6, mainK: 3, requireBfAtHw: true,
  });
  res.schedule.forEach((day, i) => {
    const bfCount = hwGuards(day).filter(p => p.role === 'B').length;
    assert.ok(bfCount <= 2, `Tag ${i + 1}: HW wird nicht mit BF überflutet (war ${bfCount})`);
  });
});

test('Flag aus (Default): keine BF-Pflicht – Plan bleibt gültig', () => {
  const res = run({
    people: PEOPLE_SURPLUS, towers: TOWERS, boats: ONE_BOAT,
    days: 6, mainK: 3, requireBfAtHw: false,
  });
  // Plan ist berechnet und HW ist voll besetzt; Feature ist deaktiviert (kein Crash/keine Pflicht).
  assert.equal(res.schedule.length, 6);
  res.schedule.forEach((day, i) => {
    assert.equal(hwGuards(day).length, 3, `Tag ${i + 1}: HW besetzt`);
  });
});
