/**
 * test/partial-regen-equivalence.test.js
 *
 * Invariante: Die Teil-Neuberechnung generate(startDay > 0) muss exakt dasselbe Ergebnis
 * liefern wie ein voller Lauf generate(0). Der Teil-Lauf akkumuliert die behaltenen Tage
 * über _reAccumulateDayStats und generiert nur den Rest neu – die rekonstruierten Stats
 * MÜSSEN mit dem Voll-Lauf übereinstimmen, sonst driftet die Fairness im regenerierten Rest
 * (Bug #305-Begleitfund: pairCount der HW-Paare, hwGuardDays der Führung und
 * towerWithBoatDays bei BF-Knappheit wurden im Re-Accumulate-Pfad falsch berechnet).
 *
 * Zwei Checks:
 *  1) "No-op"-Re-Accumulate: generate(DAYS) (alle Tage behalten, nichts neu) erzeugt
 *     dieselben akkumulierten Stats wie generate(0).
 *  2) Tail-Äquivalenz: generate(cut) reproduziert den Schedule des Voll-Laufs exakt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext, setupScenario } = require('./harness');

const STAT_KEYS = ['total', 'hwVisits', 'hwGuardDays', 'towerWithBoatDays', 'mainBeachDays', 'outerBeachDays'];

function scheduleFingerprint(ctx) {
  return vm.runInContext(
    'JSON.stringify(lastResult.schedule.map(d => d.assign.map(sl => ({' +
    'k: sl.kind, t: sl.towerId, b: sl.boatId,' +
    'occ: (sl.occupants||[]).map(p=>p.id).sort((a,b)=>a-b),' +
    'mg: (sl.mainGuards||[]).map(p=>p.id).sort((a,b)=>a-b),' +
    'f: (sl.fuehrung||[]).map(p=>p.id).sort((a,b)=>a-b)' +
    '}))))',
    ctx
  );
}

function statsSnapshot(ctx) {
  return vm.runInContext('JSON.parse(JSON.stringify(lastResult.stats))', ctx);
}

test('No-op Re-Accumulate (generate(DAYS)) liefert identische Stats wie der Voll-Lauf', () => {
  let diffs = 0;
  for (let s = 1; s <= 25; s++) {
    const ctx = loadAlgoContext();
    const opts = {
      numPeople: 14 + (s % 12), numTowers: 4 + (s % 4), numBoats: 1 + (s % 4),
      days: 8, mainK: 1 + (s % 3), randomSeed: s,
      sickPersonIds: new Set(s % 2 ? [2, 5] : []),
      absentPersonIds: new Set(s % 3 === 0 ? [3] : []),
    };
    setupScenario(ctx, opts);
    const full = statsSnapshot(ctx);
    vm.runInContext('generate(DAYS);', ctx);   // alle Tage behalten, nichts neu generieren
    const reacc = statsSnapshot(ctx);

    for (const id of Object.keys(full)) {
      const a = full[id], b = reacc[id] || {};
      for (const k of STAT_KEYS) {
        if ((a[k] || 0) !== (b[k] || 0)) {
          diffs++;
          if (diffs <= 5) console.error(`seed ${s} person ${id} ${k}: full=${a[k]} reacc=${b[k]}`);
        }
      }
      // boatCaptainPairings (Objekt) ebenfalls vergleichen
      if (JSON.stringify(a.boatCaptainPairings || {}) !== JSON.stringify(b.boatCaptainPairings || {})) {
        diffs++;
      }
    }
  }
  assert.equal(diffs, 0, `Re-Accumulate weicht in ${diffs} Stat-Feldern vom Voll-Lauf ab`);
});

test('Tail-Äquivalenz: generate(cut) reproduziert den Voll-Lauf-Schedule exakt', () => {
  let mismatches = 0;
  for (let s = 1; s <= 25; s++) {
    const opts = {
      numPeople: 16 + (s % 10), numTowers: 5 + (s % 3), numBoats: 2 + (s % 3),
      days: 9, mainK: 2, randomSeed: s,
      sickPersonIds: new Set(s % 2 ? [4] : []),
    };
    for (const cut of [3, 5, 7]) {
      const ctx = loadAlgoContext();
      setupScenario(ctx, opts);
      const fullFp = scheduleFingerprint(ctx);
      // gleiche Ausgangslage, dann nur die Tage ab `cut` neu berechnen
      setupScenario(ctx, opts);
      vm.runInContext(`generate(${cut});`, ctx);
      const partFp = scheduleFingerprint(ctx);
      if (fullFp !== partFp) {
        mismatches++;
        if (mismatches <= 3) console.error(`seed ${s} cut ${cut}: Tail weicht ab`);
      }
    }
  }
  assert.equal(mismatches, 0, `${mismatches} Tail-Abweichungen zwischen Teil- und Voll-Lauf`);
});
