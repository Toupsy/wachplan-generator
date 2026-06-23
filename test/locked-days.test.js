/**
 * test/locked-days.test.js
 *
 * Feature „Tag sperren": Ein gesperrter Tag (lockedDays) wird bei einer Neuberechnung NICHT
 * neu generiert, sondern aus lastResult übernommen – egal welcher andere Tag sich ändert.
 *
 * Checks:
 *  1) Sperre schützt: nach Sperren eines Tages + Änderung an einem ANDEREN Tag + generate()
 *     ist der Schedule des gesperrten Tages bit-genau unverändert.
 *  2) Ohne Sperre würde sich derselbe Tag bei derselben Änderung sehr wohl verändern können
 *     (Plausibilität – die Änderung ist wirksam, der Schutz also nicht trivial).
 *  3) Entsperren stellt die normale Neuberechnung wieder her (Voll-Lauf-Äquivalenz).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const { loadAlgoContext, setupScenario } = require('./harness');

function dayFingerprint(ctx, dayIdx) {
  return vm.runInContext(
    `JSON.stringify(lastResult.schedule[${dayIdx}].assign.map(sl => ({` +
    'k: sl.kind, t: sl.towerId, b: sl.boatId,' +
    'occ: (sl.occupants||[]).map(p=>p.id).sort((a,b)=>a-b),' +
    'mg: (sl.mainGuards||[]).map(p=>p.id).sort((a,b)=>a-b),' +
    'f: (sl.fuehrung||[]).map(p=>p.id).sort((a,b)=>a-b)' +
    '})))',
    ctx
  );
}

test('Gesperrter Tag bleibt bei Änderung an anderem Tag unverändert', () => {
  const opts = { numPeople: 18, numTowers: 5, numBoats: 2, days: 7, mainK: 2, randomSeed: 7 };
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);

  const lockedDay = 2;
  const before = dayFingerprint(ctx, lockedDay);

  // Tag 2 sperren, danach an einem ANDEREN Tag (Tag 4) eine Person krankmelden + Voll-Lauf.
  vm.runInContext(`
    lockedDays.add(${lockedDay});
    dayState[4].sick.add(people[10].id);
    generate();
  `, ctx);

  const after = dayFingerprint(ctx, lockedDay);
  assert.equal(after, before, 'Gesperrter Tag darf sich nicht verändern');
});

test('Plausibilität: ohne Sperre kann dieselbe Änderung den Tag verändern', () => {
  // Die Änderung (eine zentrale Person über ALLE Tage krank) verschiebt die Rotation –
  // ohne Sperre ist mindestens ein Tag betroffen. Bestätigt, dass der Schutz aus Test 1
  // nicht trivial „nichts ändert sich ohnehin" ist.
  const opts = { numPeople: 14, numTowers: 5, numBoats: 2, days: 6, mainK: 2, randomSeed: 3 };
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);

  const fps = [];
  for (let d = 0; d < 6; d++) fps.push(dayFingerprint(ctx, d));

  vm.runInContext(`
    dayState.forEach(ds => ds.sick.add(people[8].id));
    generate();
  `, ctx);

  let changed = 0;
  for (let d = 0; d < 6; d++) if (dayFingerprint(ctx, d) !== fps[d]) changed++;
  assert.ok(changed > 0, 'Erwartet: ohne Sperre verändert die Krankmeldung mindestens einen Tag');
});

test('Gesperrter Tag überlebt einen Reload bit-genau (sparse lastResult aus persistiertem Schedule)', () => {
  // Regression: `lastResult` wird NICHT mitserialisiert. Nach einem Reload löst jeder Load
  // (autoLoad/loadPlan/Realtime) ein generate() mit lastResult==null aus → ohne den gesicherten
  // Schedule würde der gesperrte Tag neu berechnet und sich „im Nachhinein doch" verändern.
  // state-io.js friert daher die gesperrten Tage ein und hebt sie beim Import in ein sparse
  // lastResult, das genau hier nachgestellt wird.
  const opts = { numPeople: 18, numTowers: 5, numBoats: 2, days: 7, mainK: 2, randomSeed: 7 };
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);
  const lockedDay = 2;

  // Den Tag manuell „verbiegen", sodass er NICHT mehr dem Voll-Lauf entspricht (wie nach einem
  // manuellen Verschieben). Erst dann ist die Sperre nicht-trivial: ein Voll-Lauf würde abweichen.
  vm.runInContext(`
    const day = lastResult.schedule[${lockedDay}];
    const tslot = day.assign.find(s => s.kind === 'tower' && s.occupants.length >= 1);
    tslot.occupants.pop();
    lockedDays.add(${lockedDay});
  `, ctx);
  const before = dayFingerprint(ctx, lockedDay);

  // Reload simulieren: gesperrten Tag sichern (wie _buildLockedSchedules), lastResult verwerfen
  // (Schedule ist nach einem echten Reload weg), dann sparse NUR mit dem gesperrten Tag
  // wiederherstellen (wie importStateJSON) und neu generieren.
  vm.runInContext(`
    const frozen = JSON.parse(JSON.stringify(lastResult.schedule[${lockedDay}]));
    lastResult = { schedule: [] };
    lastResult.schedule[${lockedDay}] = frozen;
    generate();
  `, ctx);
  assert.equal(dayFingerprint(ctx, lockedDay), before,
    'Gesperrter, vom Voll-Lauf abweichender Tag muss den Reload bit-genau überleben');

  // Plausibilität: OHNE Wiederherstellung (kein gesicherter Schedule) berechnet der Voll-Lauf den
  // Tag neu und verwirft die Abweichung – genau der ursprüngliche Bug.
  vm.runInContext(`lastResult = { schedule: [] }; generate();`, ctx);
  assert.notEqual(dayFingerprint(ctx, lockedDay), before,
    'Ohne gesicherten Schedule berechnet der Voll-Lauf den gesperrten Tag neu (Bug-Reproduktion)');
});

test('Entsperren stellt normale Neuberechnung wieder her', () => {
  const opts = { numPeople: 16, numTowers: 5, numBoats: 2, days: 6, mainK: 2, randomSeed: 11 };

  // Referenz: Voll-Lauf mit krankgemeldeter Person, OHNE jede Sperre.
  const ref = loadAlgoContext();
  setupScenario(ref, opts);
  vm.runInContext('dayState[3].sick.add(people[9].id); generate();', ref);
  const refDay3 = dayFingerprint(ref, 3);

  // Gleiche Lage, aber Tag 3 zwischenzeitlich gesperrt → krankmelden → wieder entsperren →
  // generate(). Ergebnis muss dem ungesperrten Referenzlauf entsprechen.
  const ctx = loadAlgoContext();
  setupScenario(ctx, opts);
  vm.runInContext(`
    lockedDays.add(3);
    dayState[3].sick.add(people[9].id);
    generate();              // Tag 3 noch geschützt
    lockedDays.delete(3);
    generate();              // jetzt normal neu berechnen
  `, ctx);

  assert.equal(dayFingerprint(ctx, 3), refDay3,
    'Nach Entsperren muss der Tag wieder regulär (wie ohne Sperre) berechnet werden');
});
