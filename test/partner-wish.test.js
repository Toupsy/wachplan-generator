/**
 * test/partner-wish.test.js – Tests für den Turmpartner-Wunsch (Feature 48)
 *
 * Person-Feld `partnerWishId`: eine Person wünscht sich eine andere als Turmpartner.
 *  - EINSEITIG genügt (A wünscht B → greift auch ohne Gegenwunsch); gegenseitig verstärkt.
 *  - Wird EINMAL pro Woche erfüllt (Bonus aus, sobald das Paar zusammen saß) → weiche
 *    Präferenz, die der E/U-Mischung und der Fairness weicht ("ohne Fairness zu beeinflussen").
 *
 * Kernanforderungen:
 * 1. Einseitiger Wunsch (E wünscht U) → im Laufe der Woche ≥1 gemeinsamer Turmtag.
 * 2. Gegenseitiger Wunsch → ebenfalls erfüllt.
 * 3. Einmal/Woche: das Paar wird NICHT jeden Tag zusammengeklebt (Fairness bleibt).
 * 4. Wunschpartner abwesend → kein Crash, Plan gültig, kein gemeinsamer Turmtag.
 * 5. Plan bleibt invariant (keine Person doppelt/Tag) mit aktivem Wunsch.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 6, mainK = 2, absentIds = [] }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    ${absentIds.map(id => `dayState.forEach(ds => ds.absent.add(${id}));`).join('\n    ')}
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

// A = id 2 (erfahren), B = id 3 (unerfahren) → als E+U-Paar frei kombinierbar (kein UU/EE-Konflikt).
function crew(partnerWishOnA = null, partnerWishOnB = null) {
  return [
    { id: 1, name: 'F1', role: 'F' },
    { id: 2, name: 'A',  role: 'W', experienced: true,  partnerWishId: partnerWishOnA },
    { id: 3, name: 'B',  role: 'W', experienced: false, partnerWishId: partnerWishOnB },
    { id: 4, name: 'E2', role: 'W', experienced: true },
    { id: 5, name: 'E3', role: 'W', experienced: true },
    { id: 6, name: 'E4', role: 'W', experienced: true },
    { id: 7, name: 'U2', role: 'W', experienced: false },
    { id: 8, name: 'U3', role: 'W', experienced: false },
    { id: 9, name: 'U4', role: 'W', experienced: false },
    { id: 10, name: 'U5', role: 'W', experienced: false },
  ];
}

const shareTower = (day, a, b) => day.assign.some(s =>
  s.kind === 'tower' &&
  s.occupants.some(o => o.id === a) &&
  s.occupants.some(o => o.id === b));

const sharedDays = (schedule, a, b) => schedule.filter(d => shareTower(d, a, b)).length;

test('Einseitiger Wunsch (A→B): im Laufe der Woche ≥1 gemeinsamer Turmtag', () => {
  const res = run({ people: crew(3, null), towers: TOWERS, days: 6 });
  assert.ok(sharedDays(res.schedule, 2, 3) >= 1,
    'A und B sollten mindestens einmal gemeinsam auf einem Turm sitzen');
});

test('Gegenseitiger Wunsch (A↔B): erfüllt', () => {
  const res = run({ people: crew(3, 2), towers: TOWERS, days: 6 });
  assert.ok(sharedDays(res.schedule, 2, 3) >= 1,
    'Gegenseitiger Wunsch sollte mindestens einmal erfüllt werden');
});

test('Einmal/Woche: das Wunschpaar wird NICHT jeden Tag zusammengeklebt (Fairness bleibt)', () => {
  const res = run({ people: crew(3, null), towers: TOWERS, days: 6 });
  const shared = sharedDays(res.schedule, 2, 3);
  assert.ok(shared >= 1, 'mindestens einmal erfüllt');
  assert.ok(shared < res.schedule.length,
    `nicht jeden Tag zusammen (war ${shared}/${res.schedule.length}) → Rotation/Fairness erhalten`);
});

test('Wunschpartner abwesend: kein Crash, Plan gültig, kein gemeinsamer Turmtag', () => {
  const res = run({ people: crew(3, null), towers: TOWERS, days: 6, absentIds: [3] });
  assert.equal(res.schedule.length, 6);
  assert.equal(sharedDays(res.schedule, 2, 3), 0,
    'abwesender Partner kann nicht gemeinsam eingeplant werden');
});

test('Plan bleibt invariant (keine Person doppelt pro Tag) mit aktivem Wunsch', () => {
  const res = run({ people: crew(3, 2), towers: TOWERS, days: 6 });
  res.schedule.forEach((day, i) => {
    const seen = new Set();
    day.assign.forEach(s => {
      const occ = s.kind === 'main'
        ? [...(s.mainGuards || []), ...(s.fuehrung || [])]
        : (s.occupants || []);
      occ.forEach(p => {
        assert.ok(!seen.has(p.id), `Tag ${i + 1}: Person ${p.id} doppelt eingeplant`);
        seen.add(p.id);
      });
    });
  });
});
