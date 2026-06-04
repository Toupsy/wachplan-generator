/**
 * test/bf-estimation.test.js – Regression-Tests für die BF-Vorab-Schätzung (Issue #93)
 *
 * 1. generate() darf nicht abstürzen (kein TDZ-Zugriff auf surplusBF).
 * 2. Bei nicht-Standard-slotCount wird der Turm-Bedarf korrekt geschätzt, sodass
 *    Boote offener Türme einen Bootsführer reserviert bekommen (auch wenn E/U knapp,
 *    aber genug BF vorhanden sind).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

/** Baut einen Tag-Plan mit frei wählbaren people/towers/boats und liefert lastResult. */
function run({ people, towers, boats, days = 1, mainK = 0 }) {
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

test('BF-Schätzung: kein Crash bei nicht-Standard slotCount', () => {
  const res = run({
    people: [
      { id: 1, name: 'E1', role: 'E' }, { id: 2, name: 'E2', role: 'E' },
      { id: 3, name: 'B1', role: 'B', bfLevel: 'E' }, { id: 4, name: 'B2', role: 'B', bfLevel: 'E' },
      { id: 5, name: 'B3', role: 'B', bfLevel: 'E' }, { id: 6, name: 'B4', role: 'B', bfLevel: 'E' },
    ],
    towers: [
      { id: 20, name: 'T1', prio: 1, code: 'T1', slotCount: 4, leaderCount: 0 },
      { id: 21, name: 'T2', prio: 2, code: 'T2', slotCount: 5, leaderCount: 0 },
    ],
    boats: [
      { id: 30, name: 'Boot1', code: 'B1', towerId: 20, prio: 1, slotCount: 1 },
    ],
  });
  assert.ok(res && res.schedule && res.schedule.length === 1, 'generate() liefert ein Ergebnis');
});

test('BF-Schätzung: Boot offener Türme bekommt einen Bootsführer (E/U knapp, BF genug)', () => {
  // Nur 2 E, aber 6 BF. Bei reiner E/U-Schätzung würde der Turm als "nicht öffenbar"
  // eingeschätzt → kein Boot-BF reserviert. Mit BF-Zählung öffnet der Turm und sein
  // Boot bekommt korrekt einen Bootsführer.
  const res = run({
    people: [
      { id: 1, name: 'E1', role: 'E' }, { id: 2, name: 'E2', role: 'E' },
      { id: 3, name: 'B1', role: 'B', bfLevel: 'E' }, { id: 4, name: 'B2', role: 'B', bfLevel: 'E' },
      { id: 5, name: 'B3', role: 'B', bfLevel: 'E' }, { id: 6, name: 'B4', role: 'B', bfLevel: 'E' },
      { id: 7, name: 'B5', role: 'B', bfLevel: 'E' }, { id: 8, name: 'B6', role: 'B', bfLevel: 'E' },
    ],
    towers: [
      { id: 20, name: 'T1', prio: 1, code: 'T1', slotCount: 2, leaderCount: 0 },
    ],
    boats: [
      { id: 30, name: 'Boot1', code: 'B1', towerId: 20, prio: 1, slotCount: 1 },
    ],
  });
  const towerOpen = res.schedule[0].assign.some(s => s.kind === 'tower' && s.towerId === 20);
  assert.ok(towerOpen, 'Turm T1 ist geöffnet');
  const boatSlot = res.schedule[0].assign.find(s => s.kind === 'boat' && s.boatId === 30);
  assert.ok(boatSlot, 'Boot-Slot existiert');
  assert.ok(boatSlot.occupants.length >= 1, 'Boot hat einen Bootsführer zugewiesen');
});
