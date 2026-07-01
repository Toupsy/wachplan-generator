/**
 * test/transparent-forced-stats.test.js
 *
 * Regression: Transparent forced placements applied after the algorithm mutate dayAssign
 * (post-swap), but stats were committed from pre-swap positions. When such a day is retained
 * (locked or as a startDay prefix), _reAccumulateDayStats must reproduce the original stats
 * from pre-swap positions, not the visual post-swap positions (Issue #385).
 *
 * Uses generate(DAYS) for re-accumulation tests (no-op: all days retained, none regenerated)
 * so the comparison is purely about _reAccumulateDayStats, not about changed assignments on
 * other days.
 *
 * Checks:
 *  1) Stats after generate(DAYS) match the original full run — even with transparent placements.
 *  2) towerVisits reflect the natural (pre-swap) position, not the visual target slot.
 *  3) hwGuardDays is NOT inflated by a transparent move to the HW (main).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext, setupScenario } = require('./harness');

function statsSnapshot(ctx) {
  return vm.runInContext('JSON.parse(JSON.stringify(lastResult.stats))', ctx);
}

const STAT_KEYS = ['total', 'hwVisits', 'hwGuardDays', 'towerWithBoatDays', 'mainBeachDays', 'outerBeachDays'];

test('No-op Re-Akkumulation liefert identische Stats bei transparenten Zuweisungen', () => {
  // Tests that _reAccumulateDayStats reproduces correct stats when every day is retained
  // and transparent placements exist. Mirrors partial-regen-equivalence.test.js but adds
  // transparent forced placements before measuring.
  let diffs = 0;

  for(let s = 1; s <= 15; s++){
    const ctx = loadAlgoContext();
    const opts = {
      numPeople: 14 + (s % 10), numTowers: 4 + (s % 3), numBoats: 1 + (s % 3),
      days: 6, mainK: 1 + (s % 3), randomSeed: s,
    };
    setupScenario(ctx, opts);

    // Add transparent forced placements on days 0 and 2 (tower-to-tower swap).
    vm.runInContext(`
      (() => {
        const day0 = lastResult.schedule[0];
        const ts0 = day0.assign.filter(s => s.kind === 'tower' && s.occupants.length > 0);
        if(ts0.length >= 2){
          forcedPlacements[0].push({
            personId: ts0[0].occupants[0].id, kind: 'tower', slotId: ts0[1].towerId, transparent: true
          });
        }
        const day2 = lastResult.schedule[2];
        const ts2 = day2.assign.filter(s => s.kind === 'tower' && s.occupants.length > 0);
        if(ts2.length >= 2){
          forcedPlacements[2].push({
            personId: ts2[0].occupants[0].id, kind: 'tower', slotId: ts2[1].towerId, transparent: true
          });
        }
        generate();
      })()
    `, ctx);

    const full = statsSnapshot(ctx);
    // No-op: retain all days, just re-accumulate.
    vm.runInContext('generate(DAYS);', ctx);
    const reacc = statsSnapshot(ctx);

    for(const id of Object.keys(full)){
      const a = full[id], b = reacc[id] || {};
      for(const k of STAT_KEYS){
        if((a[k] || 0) !== (b[k] || 0)){
          diffs++;
          if(diffs <= 5) console.error(`seed ${s} person ${id} ${k}: full=${a[k]} reacc=${b[k]}`);
        }
      }
      if(JSON.stringify(a.towerVisits || {}) !== JSON.stringify(b.towerVisits || {})){
        diffs++;
        if(diffs <= 5) console.error(`seed ${s} person ${id} towerVisits diverge`);
      }
    }
  }
  assert.equal(diffs, 0, `Re-Akkumulation weicht in ${diffs} Stat-Feldern vom Voll-Lauf ab`);
});

test('towerVisits reflektiert natürliche (pre-swap) Position, nicht visuellen Zielslot', () => {
  const opts = { numPeople: 14, numTowers: 4, numBoats: 2, days: 4, mainK: 2, randomSeed: 7 };
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);

  const setup = vm.runInContext(`
    (() => {
      const day0 = lastResult.schedule[0];
      const tSlots = day0.assign.filter(s => s.kind === 'tower' && s.occupants.length > 0);
      if(tSlots.length < 2) return null;
      const fromSlot = tSlots[0];
      const toSlot   = tSlots[1];
      const person   = fromSlot.occupants[0];
      return { personId: person.id, fromTowerId: fromSlot.towerId, toTowerId: toSlot.towerId };
    })()
  `, ctx);

  if(!setup) return;

  // Apply transparent placement (fromTower → toTower) on day 0 and re-run.
  vm.runInContext(`
    forcedPlacements[0].push({ personId: ${setup.personId}, kind: 'tower', slotId: ${setup.toTowerId}, transparent: true });
    generate();
  `, ctx);

  // Record how many visits each tower got from the person in the full run.
  const fullVisitsFrom = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.towerVisits?.[${setup.fromTowerId}] || 0`, ctx
  );
  const fullVisitsTo = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.towerVisits?.[${setup.toTowerId}] || 0`, ctx
  );

  // No-op re-accumulate: all days retained.
  vm.runInContext('generate(DAYS);', ctx);

  const reaccVisitsFrom = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.towerVisits?.[${setup.fromTowerId}] || 0`, ctx
  );
  const reaccVisitsTo = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.towerVisits?.[${setup.toTowerId}] || 0`, ctx
  );

  assert.equal(reaccVisitsFrom, fullVisitsFrom,
    'towerVisits[fromTower] must be stable after no-op re-accumulation');
  assert.equal(reaccVisitsTo, fullVisitsTo,
    'towerVisits[toTower] must be stable after no-op re-accumulation');
});

test('hwGuardDays wird durch transparente HW-Zuweisung nicht erhöht', () => {
  const opts = { numPeople: 16, numTowers: 4, numBoats: 2, days: 5, mainK: 2, randomSeed: 13 };
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);

  // Find a person on a tower on day 2.
  const setup = vm.runInContext(`
    (() => {
      const day2 = lastResult.schedule[2];
      const tSlot = day2.assign.find(s => s.kind === 'tower' && s.occupants.length > 0);
      if(!tSlot) return null;
      const person = tSlot.occupants[0];
      return { personId: person.id };
    })()
  `, ctx);

  if(!setup) return;

  // Add a transparent move to HW (main) on day 2 and re-run.
  vm.runInContext(`
    forcedPlacements[2].push({ personId: ${setup.personId}, kind: 'main', slotId: 0, transparent: true });
    generate();
  `, ctx);

  const hwGuardDaysFull = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.hwGuardDays || 0`, ctx
  );

  // No-op re-accumulate: all days retained.
  vm.runInContext('generate(DAYS);', ctx);

  const hwGuardDaysReacc = vm.runInContext(
    `lastResult.stats[${setup.personId}]?.hwGuardDays || 0`, ctx
  );

  assert.equal(
    hwGuardDaysReacc,
    hwGuardDaysFull,
    'hwGuardDays must be stable after no-op re-accumulation of a day with transparent HW move'
  );
});
