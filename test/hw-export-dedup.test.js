/**
 * test/hw-export-dedup.test.js
 *
 * Regression tests for the HW-Duplikation bug in _patchSheetXml (export.js).
 *
 * Bug: When 'HW' is in exportColumns the main loop already writes ALL HW persons
 * (including overflow in pairs). The dedicated HW fallback block additionally wrote
 * allHWNrs.slice(4) → persons 5+ appeared twice (in two different columns) in the
 * XLSX output.
 *
 * Fix: fallback only runs when 'HW' is NOT in exportColumns; in that case it writes
 * allHWNrs.slice(0) (all HW persons, not just 5+).
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAlgoContext, setupScenario } = require('./harness');

function loadExportContext() {
  const ctx = loadAlgoContext();
  const code = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'export.js'),
    'utf8'
  );
  vm.runInContext(code, ctx, { filename: 'export.js' });
  return ctx;
}

// Minimal XML with all rows that _patchSheetXml writes into:
//   row 3  → date (EE3)
//   rows 7,9,11,13,15,17,19 → name block + position descriptions
//   row 21 → station codes
//   rows 25-42 → hour data (09:00-17:00, 9 hours × 2 rows each)
const MINIMAL_XML = (function () {
  const rows = [
    3, 7, 9, 11, 13, 15, 17, 19, 21,
    25, 26, 27, 28, 29, 30, 31, 32, 33, 34,
    35, 36, 37, 38, 39, 40, 41, 42,
  ];
  return (
    '<?xml version="1.0" encoding="UTF-8" standalone="yes"?>' +
    '<worksheet xmlns="http://schemas.openxmlformats.org/spreadsheetml/2006/main">' +
    '<sheetData>' +
    rows.map(r => `<row r="${r}"></row>`).join('') +
    '</sheetData></worksheet>'
  );
}());

/**
 * Returns a Map: personNr → Set of column-letter strings they appear in.
 * Parses <c r="COLrow"...><v>N</v></c> entries for 1 ≤ N ≤ maxPerson.
 * A person appearing in multiple columns = they were written by more than one
 * export path (i.e. the bug: main loop + fallback block both wrote them).
 */
function extractPersonCols(xml, maxPerson) {
  const colMap = new Map();
  const re = /<c r="([A-Z]+)\d+"[^>]*><v>(\d+)<\/v><\/c>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const col = m[1];
    const v = parseInt(m[2], 10);
    if (v >= 1 && v <= maxPerson) {
      if (!colMap.has(v)) colMap.set(v, new Set());
      colMap.get(v).add(col);
    }
  }
  return colMap;
}

/** Returns a sorted host-realm array of all person numbers (1..maxPerson) present. */
function presentPersonNums(xml, maxPerson) {
  const seen = new Set();
  const re = /<c r="[A-Z]+\d+"[^>]*><v>(\d+)<\/v><\/c>/g;
  let m;
  while ((m = re.exec(xml)) !== null) {
    const v = parseInt(m[1], 10);
    if (v >= 1 && v <= maxPerson) seen.add(v);
  }
  return [...seen].sort((a, b) => a - b);
}

const ctx = loadExportContext();

test('HW in exportColumns: no HW person appears in more than one column', () => {
  // 24 people, 3 towers (6 slots), 3 boats (3 slots) → HW gets well over 4 persons
  setupScenario(ctx, { numPeople: 24, numTowers: 3, numBoats: 3, days: 1, mainK: 2 });

  // Standard config: 'HW' is first in exportColumns (as in seed.js / config.json)
  vm.runInContext(
    "exportColumns = ['HW','T1','T2','T3','B1','B2','B3'].concat(Array(9).fill(''));",
    ctx
  );

  const result = vm.runInContext(
    `_patchSheetXml(${JSON.stringify(MINIMAL_XML)}, 0)`,
    ctx
  );

  const colMap = extractPersonCols(result.xml, 24);
  // Any person appearing in more than 1 column was written by two competing paths
  const inMultipleCols = [];
  for (const [n, cols] of colMap) {
    if (cols.size > 1) inMultipleCols.push(n);
  }
  inMultipleCols.sort((a, b) => a - b);

  assert.deepEqual(
    inMultipleCols,
    [],
    `Person(s) appear in multiple XLSX columns (duplicated by fallback block): ${inMultipleCols.join(', ')}`
  );
});

test('HW not in exportColumns (fallback path): all HW persons written, not only persons 5+', () => {
  setupScenario(ctx, { numPeople: 24, numTowers: 3, numBoats: 3, days: 1, mainK: 2 });

  // Fallback path: HW is NOT in exportColumns
  vm.runInContext(
    "exportColumns = ['T1','T2','T3','B1','B2','B3'].concat(Array(10).fill(''));",
    ctx
  );

  // Collect expected HW person numbers from the vm context as a plain JSON string
  // to avoid cross-realm Array issues with assert.deepEqual.
  const hwNrsJson = vm.runInContext(`
    JSON.stringify((function() {
      var main = lastResult.schedule[0].assign.find(function(s){ return s.kind === 'main'; });
      if (!main) return [];
      return [].concat(main.mainGuards, main.base, main.bootsfLeft, main.sick || [])
        .map(function(p){ return personNr(p.id); })
        .filter(function(n){ return n != null; });
    }()))
  `, ctx);
  const hwNrs = JSON.parse(hwNrsJson); // host-realm array of numbers

  assert.ok(
    hwNrs.length >= 5,
    `Expected at least 5 HW persons for a meaningful test, got ${hwNrs.length}`
  );

  const result = vm.runInContext(
    `_patchSheetXml(${JSON.stringify(MINIMAL_XML)}, 0)`,
    ctx
  );

  const present = new Set(presentPersonNums(result.xml, 24));
  const missing = hwNrs.filter(n => !present.has(n)); // host-realm filter → host-realm array

  assert.deepEqual(
    missing,
    [],
    `HW persons missing from XLSX fallback export (slice(4) bug): ${missing.join(', ')}`
  );
});
