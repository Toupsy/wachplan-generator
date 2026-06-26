// test/roster.test.js – Wachlisten-Import & dynamische Namensliste (Feature 31)
//
// Testet die reinen Parser-/Ableitungs-Funktionen aus public/js/roster.js
// (DOM-frei). PDF-Parsing (pdf.js/Browser) ist hier nicht abgedeckt.

const test = require('node:test');
const assert = require('node:assert');
const fs = require('node:fs');
const path = require('node:path');
const vm = require('node:vm');

// roster.js in eine isolierte vm-Context laden und die Funktionen herausziehen.
const ctx = vm.createContext({ console, Math, Date, Set, Map, Object, Array, JSON });
const src = fs.readFileSync(path.join(__dirname, '..', 'public', 'js', 'roster.js'), 'utf8');
vm.runInContext(src, ctx, { filename: 'roster.js' });
const { rosterDateToISO, rosterJobToRole, parseRosterCSV, normalizeRoster, deriveRosterPeople,
  mergeRosterOverrides, _pdfParseLine, _pdfGroupLines } = ctx;

// Kleine, repräsentative CSV-Probe (Semikolon-getrennt wie die echte DLRG-Liste).
const SAMPLE_CSV = [
  'Wachliste;Dahme;;Von: 07.08.2026;Bis: 17.08.2026',
  '',
  'Name;Vorname;Job;Zusatzqualifikationen;von;bis;Alter*;PLZ;Ort;E-Mailadresse;Telefonnummer;Telefonnummer Sorgeberechtigte;Status',
  'Freytag;Vanessa Marie;RS;DRSA Silber;25.07.2026;15.08.2026;23;31275;Lehrte;a@b.de;+49;;zugesagt;',
  'Wolf;Linus;BF;DRSA Gold;08.08.2026;15.08.2026;23;76698;Ubstadt;c@d.de;+49;;zugesagt;',
  'Kuhlmann;Leon;WF;Wachführer;08.08.2026;13.08.2026;28;38442;Fallersleben;e@f.de;+49;;zugesagt;',
  'Maas;Martin;RS;DRSA Gold;08.08.2026;15.08.2026;19;47652;Weeze;g@h.de;+49;;abgesagt;',
  'Toups;Yannis;BF;DLRG Bootsführerschein A;15.08.2026;22.08.2026;31;50259;Pulheim;i@j.de;+49;;zugesagt;',
  '',
  ';*zum Zeitpunkt des Dienstbeginns',
].join('\n');

// 11-Tage-Fenster 07.08.–17.08.2026 (wie die Liste).
const window11 = [];
for(let i = 0; i < 11; i++){
  const d = new Date(2026, 7, 7 + i);   // lokal, August = Monat 7
  window11.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
}

test('rosterDateToISO konvertiert DD.MM.YYYY → ISO', () => {
  assert.strictEqual(rosterDateToISO('07.08.2026'), '2026-08-07');
  assert.strictEqual(rosterDateToISO('7.8.2026'), '2026-08-07');
  assert.strictEqual(rosterDateToISO('quatsch'), '');
  assert.strictEqual(rosterDateToISO(''), '');
});

test('rosterJobToRole mappt Job-Kürzel auf Rollen', () => {
  assert.strictEqual(rosterJobToRole('WF'), 'F');
  assert.strictEqual(rosterJobToRole('BF'), 'B');
  assert.strictEqual(rosterJobToRole('RS'), 'W');
  assert.strictEqual(rosterJobToRole('xx'), 'W');
});

test('parseRosterCSV liest nur echte Datenzeilen (zugesagt + abgesagt)', () => {
  const raw = parseRosterCSV(SAMPLE_CSV);
  assert.strictEqual(raw.length, 5);   // 5 Personen-Zeilen, Meta-/Fußzeilen ignoriert
  assert.strictEqual(raw[0].nachname, 'Freytag');
  assert.strictEqual(raw[0].vorname, 'Vanessa Marie');
  assert.strictEqual(raw[0].job, 'RS');
  assert.strictEqual(raw[0].von, '25.07.2026');
});

test('normalizeRoster filtert abgesagt heraus und mappt Felder', () => {
  const norm = normalizeRoster(parseRosterCSV(SAMPLE_CSV));
  // 4 zugesagte (Maas ist abgesagt → raus)
  assert.strictEqual(norm.length, 4);
  assert.ok(!norm.some(p => p.name.includes('Martin')), 'abgesagte Person darf nicht erscheinen');
  const wolf = norm.find(p => p.name === 'Linus Wolf');
  assert.strictEqual(wolf.role, 'B');
  assert.strictEqual(wolf.from, '2026-08-08');
  assert.strictEqual(wolf.to, '2026-08-15');
});

test('deriveRosterPeople: Namensliste + Rollen für das Fenster', () => {
  const norm = normalizeRoster(parseRosterCSV(SAMPLE_CSV));
  const derived = deriveRosterPeople(norm, window11);
  const names = [...derived].map(p => p.name).sort();
  // Alle 4 zugesagten überlappen das Fenster 07.–17.08.
  assert.deepStrictEqual(names, ['Leon Kuhlmann', 'Linus Wolf', 'Vanessa Marie Freytag', 'Yannis Toups']);
  assert.strictEqual(derived.find(p => p.name === 'Leon Kuhlmann').role, 'F');
  assert.strictEqual(derived.find(p => p.name === 'Yannis Toups').role, 'B');
  // Vorgabe: importierte Personen sind unerfahren
  assert.ok(derived.every(p => p.experienced === false));
});

test('deriveRosterPeople: Tage außerhalb der Verfügbarkeit werden abwesend', () => {
  const norm = normalizeRoster(parseRosterCSV(SAMPLE_CSV));
  const derived = deriveRosterPeople(norm, window11);

  // Freytag verfügbar 25.07.–15.08. → im Fenster nur Tag 0..8 (07.–15.08.),
  // abwesend an Tag 9,10 (16.,17.08.)
  // Halb-offen: bis (Abreisetag) ist kein aktiver Tag.
  // Freytag verfügbar 25.07.–15.08. → aktiv nur Tag 0..7 (07.–14.08.); 15.08. = Abreise,
  // abwesend an Tag 8,9,10 (15.,16.,17.08.)
  const frey = derived.find(p => p.name === 'Vanessa Marie Freytag');
  assert.deepStrictEqual([...frey.absentDays], [8, 9, 10]);

  // Toups verfügbar 15.08.–22.08. → aktiv Tag 8,9,10 (15.–17.08., 22.08. außerhalb Fenster),
  // abwesend Tag 0..7
  const toups = derived.find(p => p.name === 'Yannis Toups');
  assert.deepStrictEqual([...toups.absentDays], [0, 1, 2, 3, 4, 5, 6, 7]);

  // Kuhlmann 08.–13.08. → aktiv Tag 1..5 (08.–12.08.); 13.08. = Abreise,
  // abwesend 0 und 6..10
  const kuhl = derived.find(p => p.name === 'Leon Kuhlmann');
  assert.deepStrictEqual([...kuhl.absentDays], [0, 6, 7, 8, 9, 10]);
});

test('deriveRosterPeople: Person außerhalb des Fensters fällt raus', () => {
  const norm = normalizeRoster(parseRosterCSV(SAMPLE_CSV));
  // Fenster komplett VOR allen Verfügbarkeiten
  const earlyWindow = ['2026-07-01', '2026-07-02', '2026-07-03'];
  const derived = deriveRosterPeople(norm, earlyWindow);
  // Nur Freytag (ab 25.07.) ... liegt auch nach 03.07. → niemand
  assert.strictEqual(derived.length, 0);
});

test('deriveRosterPeople: gleicher Name in mehreren Blöcken wird zusammengeführt', () => {
  const norm = [
    { name: 'Yannis Toups', role: 'F', from: '2026-08-08', to: '2026-08-15' },
    { name: 'Yannis Toups', role: 'B', from: '2026-08-15', to: '2026-08-22' },
  ];
  // Fenster, in dem der F-Block mehr Überlappung hat (08.–14.08., 7 Tage F vs. 0 B)
  const win = [];
  for(let i = 0; i < 7; i++){
    const d = new Date(2026, 7, 8 + i);
    win.push(`${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`);
  }
  const derived = deriveRosterPeople(norm, win);
  assert.strictEqual(derived.length, 1, 'eine zusammengeführte Person');
  assert.strictEqual(derived[0].role, 'F', 'Rolle mit größter Überlappung gewinnt');
});

function iso(d){ return `${d.getFullYear()}-${String(d.getMonth()+1).padStart(2,'0')}-${String(d.getDate()).padStart(2,'0')}`; }

test('An-/Abreisetag: abreisende Vorwochen-Crew (bis = Fensterstart) wird ausgeschlossen', () => {
  // In der Wachliste ist bis(Woche A) == von(Woche B) == 08.08. (gemeinsamer Wechseltag).
  const norm = [
    { name: 'Alte Crew', role: 'W', from: '2026-08-01', to: '2026-08-08' },  // Abreise 08.08.
    { name: 'Neue Crew', role: 'W', from: '2026-08-08', to: '2026-08-15' },  // Anreise 08.08.
  ];
  // Aktive Woche ab 08.08. (7 Tage)
  const win = [];
  for(let i = 0; i < 7; i++) win.push(iso(new Date(2026, 7, 8 + i)));

  const derived = deriveRosterPeople(norm, win);
  assert.strictEqual(derived.length, 1, 'nur die aktive (anreisende) Woche zählt');
  assert.strictEqual(derived[0].name, 'Neue Crew');
  // Neue Crew aktiv 08.–14.08.; 15.08. liegt außerhalb des 7-Tage-Fensters → keine Abwesenheit
  assert.deepStrictEqual([...derived[0].absentDays], []);
});

// ── Manuelle Overrides (überleben Neu-Ableiten) ──────────────────────────────

test('mergeRosterOverrides: manuelle Rolle/Erfahrung überschreiben die Ableitung', () => {
  const derived = [
    { name: 'Linus Wolf', role: 'B', experienced: false, absentDays: [] },
    { name: 'Vanessa Marie Freytag', role: 'W', experienced: false, absentDays: [] },
  ];
  const overrides = {
    'linus wolf': { role: 'F' },                       // Rolle von Hand geändert
    'vanessa marie freytag': { experienced: true },    // als erfahren markiert
  };
  const merged = mergeRosterOverrides(derived, overrides);
  assert.strictEqual(merged.find(p => p.name === 'Linus Wolf').role, 'F');
  assert.strictEqual(merged.find(p => p.name === 'Vanessa Marie Freytag').experienced, true);
  // Unveränderte Felder behalten den Ableitungswert
  assert.strictEqual(merged.find(p => p.name === 'Linus Wolf').experienced, false);
  assert.strictEqual(merged.find(p => p.name === 'Vanessa Marie Freytag').role, 'W');
});

test('mergeRosterOverrides: ohne Override bleibt alles bei der Ableitung', () => {
  const derived = [{ name: 'A B', role: 'W', experienced: false, absentDays: [] }];
  const merged = mergeRosterOverrides(derived, {});
  assert.strictEqual(merged[0].role, 'W');
  assert.strictEqual(merged[0].experienced, false);
  assert.strictEqual(merged[0].wantsHW, false);
  assert.strictEqual(merged[0].enableLabels, true);
  assert.deepStrictEqual([...merged[0].partnerWishNames], []);
});

test('mergeRosterOverrides: Turmpartner-Wünsche (name-basiert) überstehen das Neu-Ableiten', () => {
  // Feature 48: Wünsche werden name-basiert gehalten und in applyRosterToWindow() wieder auf
  // frische ids aufgelöst → Wachliste hochladen, Wünsche setzen, Datum/Tage ändern bleibt erhalten.
  // Mehrfachauswahl: eine Person kann mehrere Wunschpartner haben.
  const derived = [
    { name: 'Max Mustermann', role: 'W', experienced: true,  absentDays: [] },
    { name: 'Erika Beispiel', role: 'W', experienced: false, absentDays: [] },
    { name: 'Tom Tester',     role: 'W', experienced: false, absentDays: [] },
  ];
  const overrides = { 'max mustermann': { partnerWishNames: ['Erika Beispiel', 'Tom Tester'] } };
  const merged = mergeRosterOverrides(derived, overrides);
  assert.deepStrictEqual([...merged.find(p => p.name === 'Max Mustermann').partnerWishNames], ['Erika Beispiel', 'Tom Tester']);
  assert.deepStrictEqual([...merged.find(p => p.name === 'Erika Beispiel').partnerWishNames], []);
});

// ── PDF-Parsing (inhaltsbasiert) ─────────────────────────────────────────────

test('_pdfParseLine extrahiert Felder aus einer rekonstruierten Tabellenzeile', () => {
  const line = 'Freytag Vanessa Marie RS DRSA Silber | Erste Hilfe-Lehrgang (9 UE) '
    + '25.07.2026 15.08.2026 23 31275 Lehrte a@b.de +4917653386039 zugesagt';
  const r = _pdfParseLine(line);
  assert.ok(r, 'Datenzeile erkannt');
  assert.strictEqual(r.nachname, 'Freytag');
  assert.strictEqual(r.vorname, 'Vanessa Marie');
  assert.strictEqual(r.job, 'RS');
  assert.strictEqual(r.von, '25.07.2026');
  assert.strictEqual(r.bis, '15.08.2026');
  assert.strictEqual(r.status, 'zugesagt');
});

test('_pdfParseLine: Kopfzeile / Quals-Umbruch liefern null', () => {
  // Kopfzeile (keine Datumsangaben)
  assert.strictEqual(_pdfParseLine('Name Vorname Job Zusatzqualifikationen von bis Alter* PLZ Ort Status'), null);
  // Umgebrochene Qualifikationszeile (kein Status, keine 2 Daten)
  assert.strictEqual(_pdfParseLine('Sanitätslehrgang A | Sanitätslehrgang B | Notfallsanitäter'), null);
});

test('_pdfParseLine: BF/WF, abgesagt, mehrteiliger Vorname', () => {
  const wolf = _pdfParseLine('Wolf Linus BF DRSA Gold 01.08.2026 08.08.2026 23 76698 Ubstadt c@d.de +49 zugesagt');
  assert.strictEqual(wolf.job, 'BF');
  assert.strictEqual(wolf.vorname, 'Linus');
  const ab = _pdfParseLine('Maas Martin RS DRSA Gold 15.08.2026 22.08.2026 19 47652 Weeze g@h.de +49 abgesagt');
  assert.strictEqual(ab.status, 'abgesagt');
});

test('_pdfParseLine → normalizeRoster ergibt dieselbe Struktur wie der CSV-Pfad', () => {
  const raw = [
    _pdfParseLine('Wolf Linus BF DRSA Gold 08.08.2026 15.08.2026 23 76698 Ubstadt c@d.de +49 zugesagt'),
    _pdfParseLine('Maas Martin RS DRSA Gold 08.08.2026 15.08.2026 19 47652 Weeze g@h.de +49 abgesagt'),
  ];
  const norm = normalizeRoster(raw);
  assert.strictEqual(norm.length, 1);   // abgesagt gefiltert
  assert.deepStrictEqual({ ...norm[0] }, { name: 'Linus Wolf', role: 'B', from: '2026-08-08', to: '2026-08-15' });
});

test('_pdfGroupLines gruppiert Tokens nach y und sortiert nach x', () => {
  const it = (str, x, y) => ({ str, transform: [1, 0, 0, 1, x, y] });
  const lines = _pdfGroupLines([ it('B', 50, 700), it('A', 10, 700), it('C', 10, 680) ]);
  assert.strictEqual(lines.length, 2);
  assert.deepStrictEqual([...lines[0]].map(t => t.str), ['A', 'B']);   // gleiche y, nach x sortiert
  assert.deepStrictEqual([...lines[1]].map(t => t.str), ['C']);
});

test('Eintägiger Eintrag (von == bis) bleibt aktiv', () => {
  const norm = normalizeRoster([
    { vorname: 'Ein', nachname: 'Tag', job: 'RS', von: '10.08.2026', bis: '10.08.2026', status: 'zugesagt' },
  ]);
  assert.strictEqual(norm.length, 1);
  assert.strictEqual(norm[0].to, '2026-08-11', 'to wird auf Folgetag gesetzt');
  const win = [];
  for(let i = 0; i < 3; i++) win.push(iso(new Date(2026, 7, 9 + i)));   // 09.,10.,11.08.
  const derived = deriveRosterPeople(norm, win);
  assert.strictEqual(derived.length, 1);
  assert.deepStrictEqual([...derived[0].absentDays], [0, 2], 'nur 10.08. aktiv');
});
