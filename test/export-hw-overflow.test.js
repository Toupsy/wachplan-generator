/**
 * test/export-hw-overflow.test.js
 *
 * Regression-Test für den XLSX-Export der Hauptwache (HW).
 *
 * Bug (vor dem Fix): _patchSheetXml schrieb HW-Personen ab Index 4 DOPPELT in
 * verschiedene Template-Spalten, sobald 'HW' in exportColumns stand (Standard-Config):
 * Die exportColumns-Hauptschleife verteilte ALLE A['HW']-Personen inkl. Überlauf,
 * UND ein zweiter „HW-Überlauf"-Block schrieb die Personen 5+ erneut → stille
 * Korruption des offiziellen DLRG-Formulars.
 *
 * Erwartung: jede HW-Person erscheint im Export GENAU EINMAL – sowohl mit 'HW' in
 * exportColumns (Hauptschleife) als auch ohne (Fallback-Block).
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');
const { loadAlgoContext, setupScenario } = require('./harness.js');

// Lädt export.js zusätzlich in den Algorithmus-Kontext und gibt für ein Szenario
// zurück, welche Personennummern unter 'HW'-überschriebenen Spalten landen.
function exportHwAssignment(exportColumnsArr) {
  const ctx = loadAlgoContext();
  // Browser-/DOM-Stubs, die export.js erwartet (DOM-frei testbar).
  vm.runInContext(`
    positionDescriptions = positionDescriptions || {};
    serviceStartHour = 9; serviceEndHour = 10;
    var localStorage = { getItem(){ return null; }, setItem(){}, removeItem(){} };
    var atob = s => Buffer.from(s, 'base64').toString('binary');
    var btoa = s => Buffer.from(s, 'binary').toString('base64');
    if (typeof getBoat === 'undefined') { getBoat = id => boats.find(b => b.id === id); }
  `, ctx);
  const exportCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'export.js'), 'utf8');
  vm.runInContext(exportCode, ctx, { filename: 'export.js' });

  // Viele Personen, wenige Türme, kleines k → großer HW-Überlauf (≥5 Personen).
  setupScenario(ctx, { numPeople: 24, numTowers: 3, numBoats: 1, days: 1, mainK: 2, randomSeed: 42 });

  vm.runInContext(`exportColumns = ${JSON.stringify(exportColumnsArr)};`, ctx);

  // Patch-Map abgreifen, statt das XML tatsächlich zu schreiben.
  vm.runInContext(`
    var __captured = null;
    _applyPatches = function(xml, patchMap){ __captured = patchMap; return xml; };
    _patchSheetXml('<sheetData></sheetData>', 0);
  `, ctx);

  const captured = vm.runInContext('Array.from(__captured.entries())', ctx);
  const A = vm.runInContext('buildAssignments(0)', ctx);

  // Spalten-Header (Zeile 21) + geschriebene Personennummern (Stunden-Datenzeilen 23–46).
  const colHeader = {};
  const colNrs = {};
  for (const [ref, patch] of captured) {
    const m = ref.match(/^([A-Z]+)(\d+)$/);
    if (!m) continue;
    const colL = m[1];
    const row = +m[2];
    if (row === 21) colHeader[colL] = patch.value;
    if (row >= 23 && row <= 46 && patch.type === 'n') {
      (colNrs[colL] = colNrs[colL] || new Set()).add(patch.value);
    }
  }
  const hwCols = Object.keys(colHeader).filter(c => colHeader[c] === 'HW');
  const counts = new Map();
  for (const c of hwCols) {
    for (const nr of (colNrs[c] || [])) counts.set(nr, (counts.get(nr) || 0) + 1);
  }
  return { expected: new Set(A.HW || []), counts, hwColCount: hwCols.length };
}

test('XLSX-Export: HW-Personen erscheinen genau einmal (HW in exportColumns)', () => {
  const cols = ['78/1', '9/12', '9/13', '', 'WF', 'HW', '', '', '', '', '', '', '', '', '', ''];
  const { expected, counts } = exportHwAssignment(cols);

  assert.ok(expected.size >= 5, `Test braucht HW-Überlauf (≥5 Personen), hat ${expected.size}`);

  const duplicates = [...counts].filter(([, n]) => n > 1);
  assert.deepStrictEqual(duplicates, [], `HW-Personen doppelt geschrieben: ${duplicates.map(([nr, n]) => `${nr}×${n}`).join(', ')}`);

  const missing = [...expected].filter(nr => !counts.has(nr));
  assert.deepStrictEqual(missing, [], `HW-Personen fehlen im Export: ${missing.join(', ')}`);
});

test('XLSX-Export: HW-Fallback schreibt alle HW-Personen, wenn HW keine Export-Spalte ist', () => {
  const cols = ['78/1', '9/12', '9/13', '', 'WF', '', '', '', '', '', '', '', '', '', '', ''];
  const { expected, counts } = exportHwAssignment(cols);

  assert.ok(expected.size >= 5, `Test braucht HW-Überlauf (≥5 Personen), hat ${expected.size}`);

  const duplicates = [...counts].filter(([, n]) => n > 1);
  assert.deepStrictEqual(duplicates, [], `HW-Personen doppelt geschrieben: ${duplicates.map(([nr, n]) => `${nr}×${n}`).join(', ')}`);

  // Ohne HW-Spalte muss der Fallback ALLE HW-Personen schreiben (vorher gingen die
  // ersten 4 verloren, weil der Block nur slice(4) ausgab).
  const missing = [...expected].filter(nr => !counts.has(nr));
  assert.deepStrictEqual(missing, [], `HW-Personen fehlen im Fallback-Export: ${missing.join(', ')}`);
});
