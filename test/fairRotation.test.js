/**
 * test/fairRotation.test.js - Tests for the "Strenge faire Rotation" generator.
 *
 * Verifies on the real seed roster (7 towers, 3 boats, 2 F, 3 BF, 7 exp + 10 inexp WG):
 *   - core invariants (no double-booking, no sick/closed assigned, slotCount respected)
 *   - EVERY open tower has at least one experienced person each day
 *   - tower- and partner-repeats stay minimal (no repeat possible before the
 *     number of stations allows it)
 *   - boat captains follow a clean cyclic rotation
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const { loadAlgoContext, vm } = require('./harness');

// Load core algorithm context, then inject the fair-rotation module on top.
const ctx = loadAlgoContext();
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'fairRotation.js'), 'utf8'),
  ctx,
  { filename: 'fairRotation.js' }
);

/** Seed the real example roster and run the fair-rotation generator for `days`. */
function runFair(days) {
  const setup = `
    {
    resetGlobalState();
    people = []; towers = []; boats = []; uid = 0;
    const t = [];
    for(let i = 12; i <= 18; i++) t.push({ id: ++uid, name: 'Turm 9/'+i, prio: i-11, code:'', slotCount: 2, leaderCount: 0 });
    towers.push(...t);
    boats.push({ id: ++uid, name: 'Boot 78/1', code:'78/1', towerId: t[0].id, prio: 1, slotCount: 1 });
    boats.push({ id: ++uid, name: 'Boot 78/2', code:'78/2', towerId: t[2].id, prio: 2, slotCount: 1 });
    boats.push({ id: ++uid, name: 'Boot 78/3', code:'78/3', towerId: t[5].id, prio: 3, slotCount: 1 });
    people.push({ id: ++uid, name: 'Führung 1', role:'F', experienced: true });
    people.push({ id: ++uid, name: 'Führung 2', role:'F', experienced: true });
    people.push({ id: ++uid, name: 'BF 1', role:'B', experienced: true });
    people.push({ id: ++uid, name: 'BF 2', role:'B', experienced: true });
    people.push({ id: ++uid, name: 'BF 3', role:'B', experienced: false });
    for(let i=1;i<=7;i++)  people.push({ id: ++uid, name:'WG E'+i, role:'W', experienced: true });
    for(let i=1;i<=10;i++) people.push({ id: ++uid, name:'WG U'+i, role:'W', experienced: false });
    DAYS = ${days}; mainK = 2; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    generateFairRotation();
    }
  `;
  vm.runInContext(setup, ctx);
  return {
    schedule: vm.runInContext('lastResult.schedule', ctx),
    result: vm.runInContext('lastResult', ctx),
    people: vm.runInContext('people', ctx)
  };
}

test('lastResult has the full generate() shape', () => {
  const { result } = runFair(6);
  assert.ok(Array.isArray(result.schedule));
  assert.ok(result.stats && typeof result.stats === 'object');
  assert.ok(result.pairCount && typeof result.pairCount === 'object');
  assert.ok(Array.isArray(result.peopleGuards));
  assert.ok(result.fairnessMetrics && result.fairnessMetrics.towerDistribution);
});

test('core invariants: no double-booking, slotCount respected', () => {
  const { schedule } = runFair(6);
  schedule.forEach((day, d) => {
    const seen = new Set();
    day.assign.forEach(slot => {
      const occ = [
        ...(slot.occupants || []),
        ...(slot.fuehrung || []), ...(slot.mainGuards || []),
        ...(slot.base || []), ...(slot.bootsfLeft || [])
      ];
      occ.forEach(p => {
        assert.ok(!seen.has(p.id), `Person ${p.id} doppelt an Tag ${d}`);
        seen.add(p.id);
      });
      if (slot.kind === 'tower') {
        assert.ok(slot.occupants.length <= 2, `Turm überbelegt an Tag ${d}`);
      }
    });
  });
});

test('every open tower has at least one experienced person every day', () => {
  const { schedule, people } = runFair(6);
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  schedule.forEach((day, d) => {
    day.assign.filter(s => s.kind === 'tower' && s.occupants.length > 0).forEach(t => {
      const hasExp = t.occupants.some(p => byId[p.id].role === 'F' || byId[p.id].experienced);
      assert.ok(hasExp, `Turm ${t.tower} ohne Erfahrenen an Tag ${d + 1}`);
    });
  });
});

test('inexperienced at HW never exceeds 3 on the standard roster', () => {
  const { schedule, people } = runFair(6);
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  schedule.forEach((day, d) => {
    const main = day.assign.find(s => s.kind === 'main');
    const hw = [...main.mainGuards, ...main.base];
    const inexp = hw.filter(p => !byId[p.id].experienced && byId[p.id].role !== 'F');
    assert.ok(inexp.length <= 3, `>${3} Unerfahrene an HW an Tag ${d + 1}`);
  });
});

test('no tower or partner repeats within the first 6 days', () => {
  const { schedule } = runFair(6);
  const towerOf = {}, partnerOf = {};
  schedule.forEach(day => {
    day.assign.filter(s => s.kind === 'tower').forEach(t => {
      t.occupants.forEach(p => {
        (towerOf[p.id] = towerOf[p.id] || []).push(t.towerId);
        const partner = t.occupants.find(o => o.id !== p.id);
        if (partner) (partnerOf[p.id] = partnerOf[p.id] || []).push(partner.id);
      });
    });
  });
  const dup = a => a.length - new Set(a).size;
  Object.entries(towerOf).forEach(([pid, seq]) =>
    assert.equal(dup(seq), 0, `Person ${pid} wiederholt einen Turm`));
  Object.entries(partnerOf).forEach(([pid, seq]) =>
    assert.equal(dup(seq), 0, `Person ${pid} wiederholt einen Partner`));
});

test('boat captains rotate cleanly (each captain cycles through all boats)', () => {
  const { schedule, people } = runFair(6);
  const byId = Object.fromEntries(people.map(p => [p.id, p]));
  const seq = {};
  schedule.forEach(day => {
    day.assign.filter(s => s.kind === 'boat' && s.bootsf).forEach(b => {
      (seq[b.bootsf.id] = seq[b.bootsf.id] || []).push(b.boatId);
    });
  });
  // 3 captains, 3 boats: over 6 days each visits every boat exactly twice.
  Object.entries(seq).forEach(([pid, boatIds]) => {
    assert.equal(boatIds.length, 6, `BF ${byId[pid].name} fährt nicht jeden Tag`);
    assert.equal(new Set(boatIds).size, 3, `BF ${byId[pid].name} rotiert nicht durch alle Boote`);
  });
});

test('respects sick + closed marks without crashing', () => {
  // mark Turm with id 1 closed on day 0, and one person sick on day 0
  const setup = `
    {
    resetGlobalState();
    people = []; towers = []; boats = []; uid = 0;
    const t = [];
    for(let i = 12; i <= 18; i++) t.push({ id: ++uid, name: 'Turm 9/'+i, prio: i-11, code:'', slotCount: 2, leaderCount: 0 });
    towers.push(...t);
    boats.push({ id: ++uid, name: 'Boot 78/1', code:'78/1', towerId: t[0].id, prio: 1, slotCount: 1 });
    people.push({ id: ++uid, name: 'Führung 1', role:'F', experienced: true });
    for(let i=1;i<=7;i++)  people.push({ id: ++uid, name:'WG E'+i, role:'W', experienced: true });
    for(let i=1;i<=10;i++) people.push({ id: ++uid, name:'WG U'+i, role:'W', experienced: false });
    DAYS = 3; mainK = 2; randomSeed = 0;
    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');
    const sickId = people[1].id;       // an experienced WG
    dayState[0].sick.add(sickId);
    dayState[0].closed.add(t[6].id);   // Turm 9/18 closed on day 0
    generateFairRotation();
    }
  `;
  vm.runInContext(setup, ctx);
  const schedule = vm.runInContext('lastResult.schedule', ctx);
  const sickId = vm.runInContext('people[1].id', ctx);
  const closedTowerId = vm.runInContext('towers[6].id', ctx);
  // closed tower not staffed; sick person not on any active slot, on day 0
  const day0 = schedule[0];
  const closedSlot = day0.assign.find(s => s.kind === 'tower' && s.towerId === closedTowerId);
  assert.ok(!closedSlot || closedSlot.occupants.length === 0, 'geschlossener Turm belegt');
  day0.assign.forEach(slot => {
    (slot.occupants || []).forEach(p => assert.notEqual(p.id, sickId, 'Kranke Person aktiv eingeplant'));
  });
});
