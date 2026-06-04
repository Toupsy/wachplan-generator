/**
 * test/harness.js - Test harness for loading algorithm files in Node.js
 *
 * Loads DOM-free browser globals (state.js, utils.js, dates.js, autoCodes.js, generate.js)
 * into a shared vm.Context so they can reference each other without modification.
 */

const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

/**
 * Creates a vm.Context with all algorithm files loaded.
 * Returns the context object which contains all globals.
 */
function loadAlgoContext() {
  // Create sandbox with essential Node globals and DOM stubs
  const sandbox = {
    console,
    Math,
    Date,
    Set,
    Map,
    Object,
    Array,
    JSON,
    // Stub for DOM/UI functions that generate.js calls
    renderOutput: () => {},
    autoSave: () => {},
    document: {
      getElementById: () => null,
      createElement: () => null,
      body: { appendChild: () => null }
    },
    window: {}
  };

  const ctx = vm.createContext(sandbox);
  const base = path.join(__dirname, '..', 'public', 'js');

  // Load files in order: state → utils → dates → autoCodes → generate
  // This matches the order in public/Wachplan-Generator.html
  const files = [
    'state.js',
    'utils.js',
    'dates.js',
    'autoCodes.js',
    'generate.js'
  ];

  files.forEach(filename => {
    const filepath = path.join(base, filename);
    const code = fs.readFileSync(filepath, 'utf8');
    try {
      vm.runInContext(code, ctx, { filename });
    } catch (err) {
      throw new Error(`Failed to load ${filename}: ${err.message}`);
    }
  });

  return ctx;
}

/**
 * Helper: Set up a test scenario with minimal configuration.
 * Creates people, towers, boats, and initializes state.
 *
 * @param {Object} ctx - The vm.Context from loadAlgoContext()
 * @param {Object} opts - Configuration options:
 *   - numPeople: number of people (default 20)
 *   - numTowers: number of towers (default 7)
 *   - numBoats: number of boats (default 3)
 *   - days: number of days (default 6)
 *   - mainK: number of main guard slots (default 2)
 *   - sickPersonIds: Set of person IDs to mark sick
 *   - closedTowerIds: Set of tower IDs to mark closed
 *   - closedBoatIds: Set of boat IDs to mark closed
 *   - forcedAssignments: array of { personId, kind, slotId, day, transparent }
 *   - randomSeed: seed for determinism (default 0 = no seed)
 *
 * @returns {Object} { schedule, stats, result } from generate()
 */
function setupScenario(ctx, opts = {}) {
  // Defaults
  const numPeople = opts.numPeople || 20;
  const numTowers = opts.numTowers || 7;
  const numBoats = opts.numBoats || 3;
  const days = opts.days || 6;
  const mainK = opts.mainK || 2;
  const randomSeed = opts.randomSeed || 0;

  // Build all data in Node context, then inject into vm via runInContext
  const numLeaders = Math.floor(numPeople * 0.1); // 10% leaders
  const numBoatMasters = Math.floor(numPeople * 0.15); // 15% boat masters
  const numExperienced = Math.floor(numPeople * 0.35); // 35% experienced
  const numInexperienced = numPeople - numLeaders - numBoatMasters - numExperienced;

  // Build people array
  const peopleData = [];
  let uid = 1;

  for (let i = 0; i < numLeaders; i++) {
    peopleData.push({
      id: uid++,
      name: `Leader ${i + 1}`,
      role: 'F'
    });
  }

  for (let i = 0; i < numBoatMasters; i++) {
    peopleData.push({
      id: uid++,
      name: `BoatMaster ${i + 1}`,
      role: 'B',
      bfLevel: i % 2 === 0 ? 'E' : 'U'
    });
  }

  for (let i = 0; i < numExperienced; i++) {
    peopleData.push({
      id: uid++,
      name: `Experienced ${i + 1}`,
      role: 'E'
    });
  }

  for (let i = 0; i < numInexperienced; i++) {
    peopleData.push({
      id: uid++,
      name: `Inexperienced ${i + 1}`,
      role: 'U'
    });
  }

  // Build towers array
  const towersData = [];
  for (let i = 0; i < numTowers; i++) {
    towersData.push({
      id: uid++,
      name: `Tower ${i + 1}`,
      prio: i + 1,
      code: `T${i + 1}`,
      slotCount: 2,
      leaderCount: 0
    });
  }

  // Build boats array
  const boatsData = [];
  for (let i = 0; i < numBoats && i < numTowers; i++) {
    boatsData.push({
      id: uid++,
      name: `Boat ${i + 1}`,
      code: `B${i + 1}`,
      towerId: towersData[i].id,
      prio: i + 1,
      slotCount: 1
    });
  }

  // Convert options to injectable code
  const sickPersonIds = opts.sickPersonIds || new Set();
  const closedTowerIds = opts.closedTowerIds || new Set();
  const closedBoatIds = opts.closedBoatIds || new Set();

  const sickArray = Array.from(sickPersonIds);
  const closedTowerArray = Array.from(closedTowerIds);
  const closedBoatArray = Array.from(closedBoatIds);

  // Inject into vm: reset state, populate data, run generate
  const setupCode = `
    resetGlobalState();

    people = ${JSON.stringify(peopleData)};
    towers = ${JSON.stringify(towersData)};
    boats = ${JSON.stringify(boatsData)};
    uid = ${uid};
    DAYS = ${days};
    mainK = ${mainK};
    randomSeed = ${randomSeed};

    dayState = freshDayState();
    forcedPlacements = freshForcedPlacements();
    exportColumns = Array(16).fill('');

    // Mark sick persons
    ${sickArray.map(pid => `dayState.forEach(ds => ds.sick.add(${pid}));`).join('\n    ')}

    // Mark closed towers
    ${closedTowerArray.map(tid => `dayState.forEach(ds => ds.closed.add(${tid}));`).join('\n    ')}

    // Mark closed boats
    ${closedBoatArray.map(bid => `dayState.forEach(ds => ds.closedBoats.add(${bid}));`).join('\n    ')}

    generate();
  `;

  try {
    vm.runInContext(setupCode, ctx);
  } catch (err) {
    throw new Error(`Setup scenario failed: ${err.message}`);
  }

  // Verify lastResult was set by checking it directly in the context
  let lastResultValue;
  try {
    lastResultValue = vm.runInContext('lastResult', ctx);
  } catch (e) {
    throw new Error(`Failed to access lastResult from context: ${e.message}`);
  }

  if (!lastResultValue) {
    throw new Error(`generate() did not set lastResult (value: ${lastResultValue})`);
  }

  // Retrieve other necessary data from context
  const dayStateValue = vm.runInContext('dayState', ctx);
  const towersValue = vm.runInContext('towers', ctx);
  const boatsValue = vm.runInContext('boats', ctx);

  // Retrieve results from context
  return {
    schedule: lastResultValue.schedule,
    stats: lastResultValue.stats,
    result: lastResultValue,
    dayState: dayStateValue,
    towers: towersValue,
    boats: boatsValue
  };
}

module.exports = { loadAlgoContext, setupScenario };
