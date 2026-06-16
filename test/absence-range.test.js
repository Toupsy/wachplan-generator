/**
 * test/absence-range.test.js – Feature (#221): mehrtägige Abwesenheit pro Person
 *
 * people[i].absentDays (0-basierte Tagesindizes) markiert eine vorab definierte
 * Abwesenheit (Urlaub/Lehrgang). generate() darf die Person an diesen Tagen NICHT
 * einplanen; die Statistik zählt keine inaktiven Tage als Dienst.
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

const TOWERS = [
  { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2 },
  { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
];

function personIdsInDay(day) {
  const ids = new Set();
  for (const slot of day.assign) {
    for (const b of [slot.occupants, slot.mainGuards, slot.fuehrung, slot.base, slot.bootsfLeft, slot.sick]) {
      if (Array.isArray(b)) b.forEach(p => p && ids.add(p.id));
    }
  }
  return ids;
}

test('#221: Person mit absentDays wird an diesen Tagen nicht eingeplant', () => {
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 2, name: 'B1', role: 'B', experienced: true },
    { id: 3, name: 'E1', role: 'W', experienced: true },
    { id: 4, name: 'E2', role: 'W', experienced: true },
    { id: 5, name: 'U1', role: 'W', experienced: false },
    { id: 6, name: 'Urlauber', role: 'W', experienced: true, absentDays: [0, 1] }, // Tag 1+2 weg
    { id: 7, name: 'U2', role: 'W', experienced: false },
    { id: 8, name: 'U3', role: 'W', experienced: false },
  ];
  const res = run({ people, towers: TOWERS, days: 4, mainK: 2 });

  // Tag 1 (idx 0) und Tag 2 (idx 1): Person 6 darf NICHT vorkommen
  assert.ok(!personIdsInDay(res.schedule[0]).has(6), 'Tag 1: Urlauber nicht eingeplant');
  assert.ok(!personIdsInDay(res.schedule[1]).has(6), 'Tag 2: Urlauber nicht eingeplant');

  // Tag 3/4: verfügbar → sollte mindestens einmal eingeplant sein
  const laterDays = personIdsInDay(res.schedule[2]).has(6) || personIdsInDay(res.schedule[3]).has(6);
  assert.ok(laterDays, 'Urlauber wird an verfügbaren Tagen wieder eingeplant');
});

test('#221: durchgehend abwesende Person bekommt keinen Dienst (Statistik fair)', () => {
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 2, name: 'B1', role: 'B', experienced: true },
    { id: 3, name: 'E1', role: 'W', experienced: true },
    { id: 4, name: 'E2', role: 'W', experienced: true },
    { id: 5, name: 'U1', role: 'W', experienced: false },
    { id: 6, name: 'GanzWeg', role: 'W', experienced: true, absentDays: [0, 1, 2, 3] },
    { id: 7, name: 'U2', role: 'W', experienced: false },
  ];
  const res = run({ people, towers: TOWERS, days: 4, mainK: 2 });
  res.schedule.forEach((day, i) =>
    assert.ok(!personIdsInDay(day).has(6), `Tag ${i + 1}: durchgehend Abwesender nicht eingeplant`));
  const s = res.stats[6];
  assert.ok(!s || s.total === 0, 'kein aktiver Dienst (total 0 bzw. keine Stats)');
});

test('#221: leeres/fehlendes absentDays ändert nichts (Default-Verhalten)', () => {
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 2, name: 'B1', role: 'B', experienced: true },
    { id: 3, name: 'E1', role: 'W', experienced: true, absentDays: [] },
    { id: 4, name: 'E2', role: 'W', experienced: true },
    { id: 5, name: 'U1', role: 'W', experienced: false },
  ];
  const res = run({ people, towers: TOWERS, days: 3, mainK: 2 });
  // Plan ist gültig und Person 3 wird normal eingeplant
  const appears = res.schedule.some(day => personIdsInDay(day).has(3));
  assert.ok(appears, 'Person mit leerem absentDays wird normal eingeplant');
});
