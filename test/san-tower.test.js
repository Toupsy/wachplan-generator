/**
 * test/san-tower.test.js – Tests für „Sanitäter auf San-Türmen"
 *
 * Personen-Flag `sanitaeter` (nur Wachgänger) + Turm-Flag `sanTower`. Ein als San-Turm
 * markierter Turm soll – wenn möglich – immer mindestens einen Sanitäter besetzen
 * (analog zur BF-Reservierung für Boote). Sind keine San-Türme vorhanden, verhalten sich
 * Sanitäter exakt wie normale Wachgänger.
 *
 * Kernanforderungen:
 * 1. San-Turm + Sanitäter verfügbar → jeden Tag ≥1 Sanitäter auf dem San-Turm.
 * 2. Mehrere Sanitäter → faire Rotation (nicht immer derselbe).
 * 3. Knappheit (1 Sanitäter, mehrere Türme) → Sanitäter landet auf dem San-Turm,
 *    nicht auf einem anderen Turm oder der HW.
 * 4. Mehr San-Türme als Sanitäter → der wichtigste (prio asc) San-Turm bekommt ihn.
 * 5. Kein San-Turm → Plan bleibt gültig, Sanitäter wie normale Wachgänger.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 5, mainK = 2, sanAtHw = false }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; sanAtHw = ${sanAtHw}; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generate();
    lastResult;
  `;
  return vm.runInContext(code, ctx);
}

const towerSlot = (day, towerId) => day.assign.find(s => s.kind === 'tower' && s.towerId === towerId);
const medicsOn  = (day, towerId) => (towerSlot(day, towerId)?.occupants || []).filter(p => p.sanitaeter);
const hwGuards  = day => (day.assign.find(s => s.kind === 'main').mainGuards || []);
const hwMedics  = day => hwGuards(day).filter(p => p.sanitaeter);

// Großzügiger Wachgänger-Pool, damit alle Türme + HW besetzt werden können.
const FILLERS = [
  { id: 1, name: 'F1', role: 'F' },
  { id: 10, name: 'E1', role: 'W', experienced: true },
  { id: 11, name: 'E2', role: 'W', experienced: true },
  { id: 12, name: 'E3', role: 'W', experienced: true },
  { id: 13, name: 'E4', role: 'W', experienced: true },
  { id: 14, name: 'E5', role: 'W', experienced: true },
  { id: 15, name: 'E6', role: 'W', experienced: true },
  { id: 16, name: 'U1', role: 'W', experienced: false },
  { id: 17, name: 'U2', role: 'W', experienced: false },
  { id: 18, name: 'U3', role: 'W', experienced: false },
];

test('San-Turm + Sanitäter verfügbar: jeden Tag genau 1 Sanitäter auf dem San-Turm', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0, sanTower: true },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
    { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 6 });
  res.schedule.forEach((day, i) => {
    assert.equal(medicsOn(day, 21).length, 1, `Tag ${i + 1}: genau 1 Sanitäter auf dem San-Turm`);
  });
});

test('Mehrere Sanitäter: faire Rotation auf dem San-Turm (nicht immer derselbe)', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0, sanTower: true },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
    { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 6 });
  const seen = new Set();
  res.schedule.forEach(day => medicsOn(day, 21).forEach(p => seen.add(p.id)));
  assert.ok(seen.size >= 2, `beide Sanitäter kommen auf dem San-Turm zum Einsatz (waren ${seen.size})`);
});

test('Knappheit: einziger Sanitäter landet auf dem San-Turm, nicht anderswo/HW', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
  ];
  // San-Turm ist NICHT der erste (prio 2) → testet die Reservierung gegen Turm 1.
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0, sanTower: true },
    { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 5 });
  res.schedule.forEach((day, i) => {
    assert.equal(medicsOn(day, 22).length, 1, `Tag ${i + 1}: Sanitäter auf dem San-Turm`);
    assert.equal(medicsOn(day, 21).length, 0, `Tag ${i + 1}: nicht auf T1 verbraucht`);
    assert.equal(medicsOn(day, 23).length, 0, `Tag ${i + 1}: nicht auf T3 verbraucht`);
    assert.ok(!hwGuards(day).some(p => p.sanitaeter), `Tag ${i + 1}: nicht an der HW verbraucht`);
  });
});

test('Mehr San-Türme als Sanitäter: wichtigster (prio asc) San-Turm bekommt ihn', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0, sanTower: true },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0, sanTower: true },
    { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 4 });
  res.schedule.forEach((day, i) => {
    assert.equal(medicsOn(day, 21).length, 1, `Tag ${i + 1}: Sanitäter auf wichtigstem San-Turm`);
    assert.equal(medicsOn(day, 22).length, 0, `Tag ${i + 1}: unwichtigerer San-Turm geht leer aus`);
  });
});

test('Kein San-Turm: Plan bleibt gültig, Sanitäter wie normale Wachgänger', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 5 });
  assert.equal(res.schedule.length, 5);
  // Keine Person doppelt pro Tag (Grundinvariante)
  res.schedule.forEach((day, i) => {
    const ids = [];
    day.assign.forEach(s => {
      if (s.kind === 'tower' || s.kind === 'boat') s.occupants.forEach(p => ids.push(p.id));
      else if (s.kind === 'main') [...(s.fuehrung || []), ...(s.mainGuards || [])].forEach(p => ids.push(p.id));
    });
    assert.equal(ids.length, new Set(ids).size, `Tag ${i + 1}: keine Person doppelt`);
  });
});

test('San-HW + Sanitäter verfügbar: jeden Tag genau 1 Sanitäter auf der Hauptwache', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
  ];
  const res = run({ people, towers, days: 5, mainK: 2, sanAtHw: true });
  res.schedule.forEach((day, i) => {
    assert.equal(hwMedics(day).length, 1, `Tag ${i + 1}: genau 1 Sanitäter auf der HW`);
  });
});

test('Auch Bootsführer können Sanitäter sein: überzähliger BF-Sanitäter deckt den San-Turm', () => {
  // Keine Boote → alle BF sind überzählig (im Guard-Pool). Einziger Sanitäter ist ein BF.
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 30, name: 'BF-San', role: 'B', experienced: true, sanitaeter: true },
    { id: 31, name: 'BF2', role: 'B', experienced: true },
    { id: 32, name: 'BF3', role: 'B', experienced: false },
    { id: 10, name: 'E1', role: 'W', experienced: true },
    { id: 11, name: 'E2', role: 'W', experienced: true },
    { id: 12, name: 'E3', role: 'W', experienced: true },
    { id: 13, name: 'E4', role: 'W', experienced: true },
    { id: 16, name: 'U1', role: 'W', experienced: false },
    { id: 17, name: 'U2', role: 'W', experienced: false },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, sanTower: true },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
    { id: 23, name: 'T3', prio: 3, code: 'T3', slotCount: 2 },
  ];
  const res = run({ people, towers, boats: [], days: 5 });
  res.schedule.forEach((day, i) => {
    const medics = medicsOn(day, 21);
    assert.equal(medics.length, 1, `Tag ${i + 1}: der BF-Sanitäter deckt den San-Turm`);
    assert.equal(medics[0].role, 'B', `Tag ${i + 1}: es ist der Bootsführer-Sanitäter`);
  });
});
