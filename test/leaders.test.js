/**
 * test/leaders.test.js – Tests für Feature 12 (Führungskräfte auf leaderCount-Türme, Issue #91)
 *
 * Kernanforderungen der korrigierten Fassung (vs. PR #99, der die HW leerzog):
 * 1. Ohne leaderCount-Türme bleibt die Führung an der Hauptwache (keine F auf Türmen).
 * 2. Mit leaderCount>0 steht eine Führungskraft auf dem Turm – aber die HW behält
 *    Führung, solange genug F vorhanden sind.
 * 3. Reichen die F nicht für alle Leader-Slots, werden die übrigen Slots regulär
 *    besetzt (Turm bleibt voll); kein Crash.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 4, mainK = 2 }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generate();
    lastResult;
  `;
  return vm.runInContext(code, ctx);
}

const PEOPLE = [
  { id: 1, name: 'F1', role: 'F' }, { id: 2, name: 'F2', role: 'F' },
  { id: 3, name: 'E1', role: 'E' }, { id: 4, name: 'E2', role: 'E' },
  { id: 5, name: 'E3', role: 'E' }, { id: 6, name: 'E4', role: 'E' },
  { id: 7, name: 'U1', role: 'U' }, { id: 8, name: 'U2', role: 'U' },
  { id: 9, name: 'U3', role: 'U' }, { id: 10, name: 'U4', role: 'U' },
];

const fOnTowers = day =>
  day.assign.filter(s => s.kind === 'tower')
    .flatMap(s => s.occupants.filter(o => o.role === 'F'));
const hwFuehrung = day => (day.assign.find(s => s.kind === 'main').fuehrung || []);

test('Feature 12: ohne leaderCount bleibt die Führung an der HW', () => {
  const res = run({
    people: PEOPLE,
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
      { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
      { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
    ],
  });
  res.schedule.forEach((day, i) => {
    assert.equal(fOnTowers(day).length, 0, `Tag ${i + 1}: keine Führungskraft auf Türmen`);
    assert.ok(hwFuehrung(day).length >= 1, `Tag ${i + 1}: HW hat Führung`);
  });
});

test('Feature 12: leaderCount>0 → F steht auf dem Turm, HW behält Führung', () => {
  const res = run({
    people: PEOPLE,
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 1 },
      { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
      { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
    ],
  });
  res.schedule.forEach((day, i) => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    assert.ok(t1, `Tag ${i + 1}: T1 offen`);
    assert.equal(t1.occupants.filter(o => o.role === 'F').length, 1,
      `Tag ${i + 1}: genau eine Führungskraft auf T1`);
    // 2 F vorhanden, 1 Leader-Slot → 1 F bleibt an der HW
    assert.ok(hwFuehrung(day).length >= 1, `Tag ${i + 1}: HW behält Führung`);
  });
  // Rotation: über 4 Tage sollten beide F mal auf T1 gestanden haben
  const onT1 = new Set();
  res.schedule.forEach(day => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    t1.occupants.filter(o => o.role === 'F').forEach(o => onT1.add(o.id));
  });
  assert.equal(onT1.size, 2, 'beide Führungskräfte rotieren über die Tage auf T1');
});

test('Feature 12: zu wenige F → Leader-Slot regulär gefüllt, Turm voll, kein Crash', () => {
  const res = run({
    people: [
      { id: 1, name: 'F1', role: 'F' },  // nur 1 F
      { id: 3, name: 'E1', role: 'E' }, { id: 4, name: 'E2', role: 'E' },
      { id: 5, name: 'E3', role: 'E' }, { id: 6, name: 'E4', role: 'E' },
      { id: 7, name: 'U1', role: 'U' }, { id: 8, name: 'U2', role: 'U' },
    ],
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 2 }, // 2 Leader-Slots, nur 1 F
    ],
    mainK: 0,
    days: 2,
  });
  res.schedule.forEach((day, i) => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    assert.ok(t1, `Tag ${i + 1}: T1 offen`);
    // slotCount(2)+leaderCount(2)=4 Slots; mit 7 Personen voll besetzbar
    assert.equal(t1.occupants.length, 4, `Tag ${i + 1}: T1 voll besetzt (4)`);
    assert.equal(t1.occupants.filter(o => o.role === 'F').length, 1,
      `Tag ${i + 1}: die eine vorhandene F steht auf T1`);
  });
});
