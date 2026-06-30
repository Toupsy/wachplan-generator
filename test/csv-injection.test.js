/**
 * test/csv-injection.test.js
 *
 * Regression-Test gegen CSV-Formel-Injection im CSV-Export (export.js).
 *
 * Tabellenkalkulationen werten beim Öffnen einer CSV jede Zelle, die mit
 * = + - @ (oder Tab/CR) beginnt, als Formel. Da Namen/Turm-/Bootnamen/Labels
 * frei (und in der Sharing-App auch von fremden Bearbeitern) befüllbar sind,
 * würde ein Name wie =HYPERLINK("http://evil") beim Öffnen ausgeführt.
 *
 * Erwartung: csvCell() stellt solchen Werten ein ' voran (neutralisiert die
 * Formel) und maskiert " weiterhin korrekt; harmlose Werte bleiben unverändert.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCsvCell() {
  const ctx = vm.createContext({});
  const exportCode = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'export.js'), 'utf8');
  // export.js ist Browser-Code; csvCell + Konstanten am Anfang laufen aber
  // ohne DOM. Wir kapseln den Datei-Inhalt und geben csvCell heraus.
  vm.runInContext(exportCode + '\n;globalThis.__csvCell = csvCell;', ctx, { filename: 'export.js' });
  return ctx.__csvCell;
}

test('csvCell neutralisiert Formel-Trigger und maskiert Quotes', () => {
  const csvCell = loadCsvCell();

  // Gefährliche Präfixe → führendes ' davor
  for (const payload of ['=HYPERLINK("http://evil","x")', '+1+1', '-2+3', '@SUM(A1)', '\tcmd', '\rfoo']) {
    const out = csvCell(payload);
    assert.equal(out[0], '"', 'Zelle muss in Quotes stehen');
    assert.equal(out[1], "'", `Formel-Trigger muss mit ' neutralisiert werden: ${JSON.stringify(payload)}`);
  }

  // Harmlose Werte bleiben unverändert (kein zusätzliches ')
  assert.equal(csvCell('Max Mustermann'), '"Max Mustermann"');
  assert.equal(csvCell('Turm 3'), '"Turm 3"');
  assert.equal(csvCell(5), '"5"');
  assert.equal(csvCell(0), '"0"');

  // Quotes werden weiterhin verdoppelt
  assert.equal(csvCell('Say "hi"'), '"Say ""hi"""');

  // null/undefined → leere Zelle, kein Crash
  assert.equal(csvCell(null), '""');
  assert.equal(csvCell(undefined), '""');

  // Formel-Trigger MIT Quote: beides korrekt
  assert.equal(csvCell('=1+"2"'), '"\'=1+""2"""');
});
