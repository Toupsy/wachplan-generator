/**
 * test/forced-closed-tower.test.js – Regression für Bug #308
 *
 * Eine effektive (transparent:false) Turm-Zwangszuweisung auf einen an diesem Tag
 * GESCHLOSSENEN Turm darf die Person nicht verschwinden lassen: Sie wird aus allen
 * Pools entfernt, der geschlossene Turm wird aber nie befüllt → ohne Auffangen säße
 * sie auf keinem Slot und fehlte komplett in Plan + Tagesstatistik.
 *
 * Erwartung nach Fix: Die Person taucht an dem Tag an der Hauptwache (mainGuards) auf
 * und zählt als aktiver Dienst (stats[id] für den Tag definiert, total ≥ 1).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();

function run({ people, towers, boats = [], days = 2, mainK = 2, closedTowerDay0, forcedDay0 }) {
  const code = `
    resetGlobalState();
    people = ${JSON.stringify(people)};
    towers = ${JSON.stringify(towers)};
    boats  = ${JSON.stringify(boats)};
    uid = 9999; DAYS = ${days}; mainK = ${mainK}; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    dayState[0].closed = new Set(${JSON.stringify(closedTowerDay0)});
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
  { id: 3, name: 'E1', role: 'W', experienced: true },
  { id: 4, name: 'E2', role: 'W', experienced: true },
  { id: 5, name: 'U1', role: 'W', experienced: false },
  { id: 6, name: 'U2', role: 'W', experienced: false },
  { id: 7, name: 'U3', role: 'W', experienced: false },
  { id: 8, name: 'U4', role: 'W', experienced: false },
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

test('#308: Zwangszuweisung auf geschlossenen Turm → Person bleibt erhalten (an der HW)', () => {
  const res = run({
    people: PEOPLE, towers: TOWERS, days: 2, mainK: 2,
    closedTowerDay0: [22],
    forcedDay0: [{ personId: 6, kind: 'tower', slotId: 22, transparent: false }],
  });

  const day0 = res.schedule[0];
  const where = findPersonInDay(day0, 6);
  assert.ok(where !== null, 'Person 6 darf an Tag 1 nicht verschwinden (war nirgends im Plan)');
  assert.equal(where, 'main', 'Person 6 wird als HW-Wache aufgefangen (mainGuards)');

  // Statistik dieses Tages ist definiert und zählt einen aktiven Dienst.
  const s = res.stats[6];
  assert.ok(s && s.total >= 1, 'stats[6] ist definiert und total ≥ 1 (aktiver HW-Dienst)');
});

test('#308: kein Doppel-Eintrag, Plan bleibt invariant (keine Person doppelt/Tag)', () => {
  const res = run({
    people: PEOPLE, towers: TOWERS, days: 2, mainK: 2,
    closedTowerDay0: [22],
    forcedDay0: [{ personId: 6, kind: 'tower', slotId: 22, transparent: false }],
  });
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
});
