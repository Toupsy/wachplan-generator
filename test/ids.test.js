/**
 * test/ids.test.js – Tests für den zentralen Route-ID-Parser (server/db/ids.js)
 *
 * parsePositiveInt akzeptiert ausschließlich positive Ganzzahlen. Teilgeparste
 * Eingaben wie '5abc' (parseInt → 5) oder Float-Strings müssen null ergeben,
 * damit keine ungültigen Werte in DB-Queries fließen. Dieser Parser wird sowohl
 * von api/admin.js als auch (seit der Vereinheitlichung) von api/plans.js genutzt.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const { parsePositiveInt } = require('../server/db/ids');

test('gültige positive Ganzzahlen werden geparst', () => {
  assert.equal(parsePositiveInt('1'), 1);
  assert.equal(parsePositiveInt('42'), 42);
  assert.equal(parsePositiveInt('1000000'), 1000000);
  assert.equal(parsePositiveInt(7), 7);          // numerische Eingabe
  assert.equal(parsePositiveInt(' 5 '), 5);      // umschließende Leerzeichen erlaubt (trim)
});

test('teilgeparste / ungültige Eingaben ergeben null', () => {
  assert.equal(parsePositiveInt('5abc'), null);  // Kern-Regression: parseInt('5abc')===5
  assert.equal(parsePositiveInt('abc'), null);
  assert.equal(parsePositiveInt(''), null);
  assert.equal(parsePositiveInt('  '), null);
  assert.equal(parsePositiveInt(undefined), null);
  assert.equal(parsePositiveInt(null), null);
  assert.equal(parsePositiveInt('1.5'), null);
  assert.equal(parsePositiveInt('0x10'), null);
  assert.equal(parsePositiveInt('1e3'), null);
});

test('Null und negative Werte ergeben null', () => {
  assert.equal(parsePositiveInt('0'), null);
  assert.equal(parsePositiveInt('-1'), null);
  assert.equal(parsePositiveInt('-42'), null);
});
