/**
 * test/ics-export.test.js – Feature 38 (#222): persönlicher iCal/.ics-Export
 *
 * Testet die DOM-freie Kernfunktion buildPersonICS(): ein VEVENT je Diensttag,
 * lokale (floating) Start-/Endzeiten ohne UTC-Shift, korrekte SUMMARY/LOCATION,
 * kein Event für dienstfreie/„außer Dienst"-Tage, RFC-5545-Escaping.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const vm = require('node:vm');
const fs = require('node:fs');
const path = require('node:path');
const { loadAlgoContext } = require('./harness');

const ctx = loadAlgoContext();
// export.js zusätzlich in denselben Kontext laden (Harness lädt es nicht).
vm.runInContext(
  fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'export.js'), 'utf8'),
  ctx, { filename: 'export.js' }
);

function buildICS(schedule, personId, name, dayDates, sH, eH) {
  ctx.__schedule = schedule; ctx.__pid = personId; ctx.__name = name;
  ctx.__dates = dayDates; ctx.__sH = sH; ctx.__eH = eH;
  return vm.runInContext(
    'buildPersonICS(__schedule, __pid, __name, __dates, __sH, __eH)', ctx);
}

const DATES = ['2026-07-01', '2026-07-02', '2026-07-03', '2026-07-04'];

// Tag 0: Turm, Tag 1: Boot, Tag 2: HW (mainGuards), Tag 3: außer Dienst (sick) → kein Event
const SCHEDULE = [
  { assign: [{ kind: 'tower', tower: 'Nordturm', code: 'NT', occupants: [{ id: 6 }, { id: 7 }] }] },
  { assign: [{ kind: 'boat', name: 'Boot 1', code: 'BO1', occupants: [{ id: 6 }], bootsf: { id: 6 } }] },
  { assign: [{ kind: 'main', mainGuards: [{ id: 6 }], fuehrung: [], base: [], sick: [] }] },
  { assign: [{ kind: 'main', mainGuards: [], fuehrung: [], base: [], sick: [{ id: 6 }] }] },
];

test('#222: ein VEVENT je Diensttag, kein Event für „außer Dienst"', () => {
  const ics = buildICS(SCHEDULE, 6, 'Max Mustermann', DATES, 9, 17);
  const events = (ics.match(/BEGIN:VEVENT/g) || []).length;
  assert.equal(events, 3, 'Tag 0–2 sind Diensttage, Tag 3 (außer Dienst) erzeugt kein Event');
  assert.ok(ics.startsWith('BEGIN:VCALENDAR'), 'gültiger Kalenderkopf');
  assert.ok(ics.includes('END:VCALENDAR'));
  assert.ok(ics.includes('VERSION:2.0'));
});

test('#222: lokale Start-/Endzeiten (kein UTC/Z), korrekte Station + Code', () => {
  const ics = buildICS(SCHEDULE, 6, 'Max', DATES, 9, 17);
  // Tag 0 Turm
  assert.ok(ics.includes('DTSTART:20260701T090000'), 'lokaler Start 09:00 ohne Z');
  assert.ok(ics.includes('DTEND:20260701T170000'), 'lokales Ende 17:00 ohne Z');
  assert.ok(!/DTSTART:\d{8}T\d{6}Z/.test(ics), 'keine UTC-Zeiten (kein Z-Suffix)');
  assert.ok(ics.includes('SUMMARY:Nordturm'));
  assert.ok(ics.includes('LOCATION:NT'));
  // Tag 1 Boot
  assert.ok(ics.includes('DTSTART:20260702T090000'));
  assert.ok(ics.includes('SUMMARY:Boot 1'));
  // Tag 2 HW
  assert.ok(ics.includes('DTSTART:20260703T090000'));
  assert.ok(ics.includes('SUMMARY:Hauptwache'));
});

test('#222: end <= start wird auf start+1h korrigiert; Stunden werden geclamped', () => {
  const ics = buildICS([SCHEDULE[0]], 6, 'X', DATES, 17, 17);
  assert.ok(ics.includes('DTSTART:20260701T170000'));
  assert.ok(ics.includes('DTEND:20260701T180000'), 'end==start → +1h');
});

test('#222: RFC-5545-Escaping von Sonderzeichen in SUMMARY', () => {
  const sched = [{ assign: [{ kind: 'tower', tower: 'Turm A, Süd; Strand', code: 'T,A', occupants: [{ id: 6 }] }] }];
  const ics = buildICS(sched, 6, 'X', DATES, 9, 17);
  assert.ok(ics.includes('SUMMARY:Turm A\\, Süd\\; Strand'), 'Komma/Semikolon escaped');
  assert.ok(ics.includes('LOCATION:T\\,A'));
});

test('#222: Person ohne jeden Dienst → leerer Kalender (keine Events)', () => {
  const ics = buildICS(SCHEDULE, 999, 'Niemand', DATES, 9, 17);
  assert.equal((ics.match(/BEGIN:VEVENT/g) || []).length, 0);
});
