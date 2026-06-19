/**
 * test/hw-san-tower.test.js – Tests für „Hauptwache wie ein San-Turm" (Feature 43, hwSanTower)
 *
 * Globaler Schalter `hwSanTower`: Ist er aktiv und gibt es einen Sanitäter im Guard-Pool, soll
 * an jedem Tag mindestens EIN Sanitäter einen aktiven HW-Dienst bekommen – analog zu sanTower-
 * Türmen, nur eben für die Hauptwache. San-Türme haben Vorrang (werden zuerst reserviert).
 *
 * Kernanforderungen:
 * 1. hwSanTower + Sanitäter verfügbar (keine San-Türme) → jeden Tag ≥1 Sanitäter aktiv an der HW.
 * 2. Mehrere Sanitäter → faire Rotation an der HW (nicht immer derselbe).
 * 3. San-Türme haben Vorrang: bei nur 1 Sanitäter deckt er den San-Turm, die HW geht leer aus.
 * 4. hwSanTower aus → kein Sanitäter wird an der HW erzwungen (Baseline, Plan bleibt gültig).
 * 5. Auch ein (überzähliger) Bootsführer-Sanitäter kann die HW decken.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 5, mainK = 2, hwSanTower = false }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    hwSanTower = ${hwSanTower};
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

const PLAIN_TOWERS = [
  { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2 },
  { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
];

test('hwSanTower + Sanitäter verfügbar (keine San-Türme): jeden Tag ≥1 Sanitäter aktiv an der HW', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const res = run({ people, towers: PLAIN_TOWERS, days: 6, hwSanTower: true });
  res.schedule.forEach((day, i) => {
    assert.ok(hwMedics(day).length >= 1, `Tag ${i + 1}: mind. 1 Sanitäter aktiv an der HW`);
  });
});

test('Mehrere Sanitäter: faire Rotation an der HW (nicht immer derselbe)', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const res = run({ people, towers: PLAIN_TOWERS, days: 6, hwSanTower: true });
  const seen = new Set();
  res.schedule.forEach(day => hwMedics(day).forEach(p => seen.add(p.id)));
  assert.ok(seen.size >= 2, `beide Sanitäter kommen an der HW zum Einsatz (waren ${seen.size})`);
});

test('San-Türme haben Vorrang: einziger Sanitäter deckt den San-Turm, HW geht leer aus', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
  ];
  const towers = [
    { id: 21, name: 'T1', prio: 1, code: 'T1', slotCount: 2, sanTower: true },
    { id: 22, name: 'T2', prio: 2, code: 'T2', slotCount: 2 },
  ];
  const res = run({ people, towers, days: 5, hwSanTower: true });
  res.schedule.forEach((day, i) => {
    assert.equal(medicsOn(day, 21).length, 1, `Tag ${i + 1}: Sanitäter deckt den San-Turm (Vorrang)`);
    assert.equal(hwMedics(day).length, 0, `Tag ${i + 1}: HW geht leer aus (kein zweiter Sanitäter da)`);
  });
});

test('hwSanTower aus: kein Sanitäter an der HW erzwungen, Plan bleibt gültig', () => {
  const people = [
    ...FILLERS,
    { id: 2, name: 'San1', role: 'W', experienced: true, sanitaeter: true },
    { id: 3, name: 'San2', role: 'W', experienced: true, sanitaeter: true },
  ];
  const res = run({ people, towers: PLAIN_TOWERS, days: 5, hwSanTower: false });
  assert.equal(res.schedule.length, 5);
  res.schedule.forEach((day, i) => {
    const ids = [];
    day.assign.forEach(s => {
      if (s.kind === 'tower' || s.kind === 'boat') s.occupants.forEach(p => ids.push(p.id));
      else if (s.kind === 'main') [...(s.fuehrung || []), ...(s.mainGuards || [])].forEach(p => ids.push(p.id));
    });
    assert.equal(ids.length, new Set(ids).size, `Tag ${i + 1}: keine Person doppelt`);
  });
});

test('Auch ein überzähliger Bootsführer-Sanitäter kann die HW decken', () => {
  // Keine Boote → alle BF sind überzählig (im Guard-Pool). Einziger Sanitäter ist ein BF.
  const people = [
    { id: 1, name: 'F1', role: 'F' },
    { id: 30, name: 'BF-San', role: 'B', experienced: true, sanitaeter: true },
    { id: 31, name: 'BF2', role: 'B', experienced: true },
    { id: 10, name: 'E1', role: 'W', experienced: true },
    { id: 11, name: 'E2', role: 'W', experienced: true },
    { id: 12, name: 'E3', role: 'W', experienced: true },
    { id: 16, name: 'U1', role: 'W', experienced: false },
    { id: 17, name: 'U2', role: 'W', experienced: false },
  ];
  const res = run({ people, towers: PLAIN_TOWERS, boats: [], days: 5, hwSanTower: true });
  res.schedule.forEach((day, i) => {
    const medics = hwMedics(day);
    assert.equal(medics.length, 1, `Tag ${i + 1}: der Sanitäter deckt die HW`);
    assert.equal(medics[0].id, 30, `Tag ${i + 1}: es ist der Bootsführer-Sanitäter`);
  });
});
