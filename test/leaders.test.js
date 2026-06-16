/**
 * test/leaders.test.js – Tests für Führungstürme (Feature 34, ersetzt den leaderCount-Spinner)
 *
 * Turm-Haken `leaderTower`: ein als Führungsturm markierter Turm bekommt – wenn möglich –
 * immer mindestens eine Führungskraft (auf einem REGULÄREN Slot, kein Zusatz-Slot; analog
 * zur San-Turm-Logik). Führungskräfte stehen sonst an der Hauptwache.
 *
 * Kernanforderungen:
 * 1. Ohne Führungsturm bleibt die Führung an der Hauptwache (keine F auf Türmen).
 * 2. Mit leaderTower steht genau eine Führungskraft auf dem Turm – innerhalb von slotCount
 *    (kein Zusatz-Slot) – und die HW behält Führung, solange genug F vorhanden sind.
 * 3. Reicht die Führung nicht, wird der Turm regulär gefüllt (kein Crash).
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
  { id: 3, name: 'E1', role: 'W', experienced: true }, { id: 4, name: 'E2', role: 'W', experienced: true },
  { id: 5, name: 'E3', role: 'W', experienced: true }, { id: 6, name: 'E4', role: 'W', experienced: true },
  { id: 7, name: 'U1', role: 'W', experienced: false }, { id: 8, name: 'U2', role: 'W', experienced: false },
  { id: 9, name: 'U3', role: 'W', experienced: false }, { id: 10, name: 'U4', role: 'W', experienced: false },
];

const fOnTowers = day =>
  day.assign.filter(s => s.kind === 'tower')
    .flatMap(s => s.occupants.filter(o => o.role === 'F'));
const hwFuehrung = day => (day.assign.find(s => s.kind === 'main').fuehrung || []);

test('Feature 34: ohne Führungsturm bleibt die Führung an der HW', () => {
  const res = run({
    people: PEOPLE,
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2 },
      { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
      { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2 },
    ],
  });
  res.schedule.forEach((day, i) => {
    assert.equal(fOnTowers(day).length, 0, `Tag ${i + 1}: keine Führungskraft auf Türmen`);
    assert.ok(hwFuehrung(day).length >= 1, `Tag ${i + 1}: HW hat Führung`);
  });
});

test('Feature 34: leaderTower → genau eine F auf dem Turm, kein Zusatz-Slot, HW behält Führung', () => {
  const res = run({
    people: PEOPLE,
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderTower: true },
      { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
      { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2 },
    ],
  });
  res.schedule.forEach((day, i) => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    assert.ok(t1, `Tag ${i + 1}: T1 offen`);
    assert.equal(t1.occupants.length, 2, `Tag ${i + 1}: kein Zusatz-Slot (slotCount=2)`);
    assert.equal(t1.occupants.filter(o => o.role === 'F').length, 1,
      `Tag ${i + 1}: genau eine Führungskraft auf T1`);
    // 2 F vorhanden, 1 steht auf dem Turm → 1 F bleibt an der HW
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

test('Feature 34: mehr Führungstürme als F → wichtigster (prio asc) bekommt die F', () => {
  const res = run({
    people: [
      { id: 1, name: 'F1', role: 'F' },  // nur 1 F
      { id: 3, name: 'E1', role: 'W', experienced: true }, { id: 4, name: 'E2', role: 'W', experienced: true },
      { id: 5, name: 'E3', role: 'W', experienced: true }, { id: 6, name: 'E4', role: 'W', experienced: true },
      { id: 7, name: 'U1', role: 'W', experienced: false }, { id: 8, name: 'U2', role: 'W', experienced: false },
    ],
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderTower: true },
      { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderTower: true },
    ],
    mainK: 0,
    days: 2,
  });
  res.schedule.forEach((day, i) => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    const t2 = day.assign.find(s => s.kind === 'tower' && s.towerId === 22);
    assert.equal(t1.occupants.length, 2, `Tag ${i + 1}: T1 voll (slotCount=2)`);
    assert.equal(t1.occupants.filter(o => o.role === 'F').length, 1,
      `Tag ${i + 1}: die eine F steht auf dem wichtigsten Führungsturm`);
    assert.equal(t2.occupants.filter(o => o.role === 'F').length, 0,
      `Tag ${i + 1}: unwichtigerer Führungsturm geht leer aus (keine F übrig)`);
  });
});

test('Feature 34: zu wenige F → Turm regulär gefüllt, kein Crash', () => {
  const res = run({
    people: [
      { id: 3, name: 'E1', role: 'W', experienced: true }, { id: 4, name: 'E2', role: 'W', experienced: true },
      { id: 5, name: 'E3', role: 'W', experienced: true }, { id: 6, name: 'E4', role: 'W', experienced: true },
      { id: 7, name: 'U1', role: 'W', experienced: false }, { id: 8, name: 'U2', role: 'W', experienced: false },
    ],  // gar keine F
    towers: [
      { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderTower: true },
    ],
    mainK: 0,
    days: 2,
  });
  res.schedule.forEach((day, i) => {
    const t1 = day.assign.find(s => s.kind === 'tower' && s.towerId === 21);
    assert.ok(t1, `Tag ${i + 1}: T1 offen`);
    assert.equal(t1.occupants.length, 2, `Tag ${i + 1}: T1 voll besetzt (2), trotz fehlender F`);
    assert.equal(t1.occupants.filter(o => o.role === 'F').length, 0, `Tag ${i + 1}: keine F vorhanden`);
  });
});
