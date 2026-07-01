/**
 * test/boat-prio.test.js – Boot-Priorität im Greedy-Fallback (Bugfix)
 *
 * Boote werden wie Türme mit prio ASC priorisiert (1 = wichtigstes Boot).
 * Der Min-Cost-Matching-Pfad tat das bereits; der Greedy-Fallback (aktiv bei
 * Zwangsbooten, >8 Booten oder slotCount > 1) sortierte aber prio DESC –
 * bei BF-Mangel bekamen die UNWICHTIGSTEN Boote den Bootsführer und das
 * wichtigste Boot blieb leer. Dieser Test fixiert das korrekte Verhalten.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const { loadAlgoContext, vm } = require('./harness');

/**
 * Szenario, das den Greedy-Fallback erzwingt (ein Boot mit slotCount 2 →
 * useBoatMatching = false) und nur EINEN Bootsführer bereitstellt.
 */
function runScarceBfScenario() {
  const ctx = loadAlgoContext();

  const people = [];
  let uid = 1;
  people.push({ id: uid++, name: 'F1', role: 'F' });
  people.push({ id: uid++, name: 'BF1', role: 'B', experienced: true });
  for (let i = 0; i < 4; i++) people.push({ id: uid++, name: `E${i + 1}`, role: 'W', experienced: true });
  for (let i = 0; i < 4; i++) people.push({ id: uid++, name: `U${i + 1}`, role: 'W', experienced: false });

  const towers = [];
  for (let i = 0; i < 3; i++) {
    towers.push({ id: uid++, name: `Tower ${i + 1}`, prio: i + 1, code: `T${i + 1}`, slotCount: 2 });
  }

  // Boot 1 (prio 1) hat slotCount 2 → deaktiviert das Min-Cost-Matching,
  // der Greedy-Fallback muss die Prio-Reihenfolge selbst respektieren.
  const boats = [
    { id: uid++, name: 'Boat 1', code: 'B1', towerId: towers[0].id, prio: 1, slotCount: 2 },
    { id: uid++, name: 'Boat 2', code: 'B2', towerId: towers[1].id, prio: 2, slotCount: 1 },
    { id: uid++, name: 'Boat 3', code: 'B3', towerId: towers[2].id, prio: 3, slotCount: 1 },
  ];

  vm.runInContext(`
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats = ${JSON.stringify(boats)};
    uid = ${uid};
    DAYS = 1;
    mainK = 2;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generate();
  `, ctx);

  const lastResult = vm.runInContext('lastResult', ctx);
  return { day: lastResult.schedule[0], boats };
}

test('Greedy-Fallback: bei BF-Mangel bekommt das WICHTIGSTE Boot (prio 1) den Bootsführer', () => {
  const { day, boats } = runScarceBfScenario();

  // Array.from: vm-Realm-Arrays in lokale Arrays heben (deepStrictEqual prüft Prototypen)
  const boatSlots = Array.from(day.assign).filter(s => s.kind === 'boat');
  const staffedIds = boatSlots.filter(s => s.occupants.length > 0).map(s => s.boatId);

  // Genau ein BF verfügbar → genau ein Boot besetzt, und zwar das mit prio 1.
  assert.strictEqual(staffedIds.length, 1, 'genau ein Boot besetzt');
  assert.strictEqual(staffedIds[0], boats[0].id,
    'das prio-1-Boot muss den einzigen Bootsführer bekommen');

  // Die unwichtigeren Boote (prio 2/3) bleiben ohne BF.
  const emptyIds = Array.from(day.boatsNoBootsf).map(b => b.id).sort((a, b) => a - b);
  assert.deepStrictEqual(emptyIds, [boats[1].id, boats[2].id].sort((a, b) => a - b),
    'prio-2- und prio-3-Boot bleiben leer');
});
