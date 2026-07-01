/**
 * test/csv-injection.test.js
 *
 * Sicherheitstest: CSV-Injection-Schutz in export.js.
 * Werte mit führendem = + - @ Tab CR werden mit einem vorangestellten '
 * neutralisiert, damit Excel/LibreOffice sie nicht als Formeln auswerten.
 */

const { test } = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

function loadCsvCell() {
  const ctx = vm.createContext({ console });
  const exportCode = fs.readFileSync(
    path.join(__dirname, '..', 'public', 'js', 'export.js'),
    'utf8'
  );
  vm.runInContext(exportCode, ctx, { filename: 'export.js' });
  return vm.runInContext('csvCell', ctx);
}

const csvCell = loadCsvCell();

test('csvCell: harmloser String bleibt unverändert (außer Quotes)', () => {
  assert.strictEqual(csvCell('Hallo Welt'), '"Hallo Welt"');
  assert.strictEqual(csvCell('Max Mustermann'), '"Max Mustermann"');
  assert.strictEqual(csvCell(42), '"42"');
  assert.strictEqual(csvCell(''), '""');
  assert.strictEqual(csvCell(null), '""');
});

test('csvCell: doppelte Anführungszeichen werden maskiert', () => {
  assert.strictEqual(csvCell('say "hello"'), '"say ""hello"""');
});

test('csvCell: Formel-Trigger = wird neutralisiert', () => {
  const result = csvCell('=HYPERLINK("http://evil","klick")');
  assert.ok(result.startsWith("\"'="), `Erwarte führendes ' nach öffnendem " – erhalten: ${result}`);
  assert.ok(!result.startsWith('"='), 'Darf nicht mit "= beginnen (Formel-Injection)');
});

test('csvCell: Formel-Trigger + wird neutralisiert', () => {
  const result = csvCell('+1234');
  assert.ok(result.startsWith("\"'+"), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: Formel-Trigger - wird neutralisiert', () => {
  const result = csvCell('-1234');
  assert.ok(result.startsWith("\"'-"), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: Formel-Trigger @ wird neutralisiert', () => {
  const result = csvCell('@SUM(A1:A10)');
  assert.ok(result.startsWith("\"'@"), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: Tab am Anfang wird neutralisiert', () => {
  const result = csvCell('\t=Formel');
  assert.ok(result.startsWith(`"'\t`), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: CR am Anfang wird neutralisiert', () => {
  const result = csvCell('\r=Formel');
  assert.ok(result.startsWith(`"'\r`), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: DDE-Payload-ähnliche Zeichenkette wird neutralisiert', () => {
  const result = csvCell("=cmd|'/c calc'!A1");
  assert.ok(result.startsWith("\"'="), `Erwarte führendes ' – erhalten: ${result}`);
});

test('csvCell: = in der Mitte wird NICHT neutralisiert', () => {
  const result = csvCell('Name=Wert');
  assert.strictEqual(result, '"Name=Wert"');
});

test('csvCell: Leerzeichen vor = wird NICHT neutralisiert', () => {
  const result = csvCell(' =Formel');
  assert.strictEqual(result, '" =Formel"');
});
