# DLRG Wachplan-Generator – Projektkontext

> **Wichtig für Claude:** Diese Datei nach jeder Änderung am Projekt aktualisieren
> (neue Features, geänderte Funktionen, neue Dateien, Bugfixes).

---

## Was ist das?

Single-Page-Application (reines Vanilla-JS, kein Framework) für die **DLRG (Deutsche Lebens-Rettungs-Gesellschaft)**. Sie erstellt automatisch Wachpläne für Wasserrettungsdienste über **1–14 Tage**. Der Plan weist Personen fair rotierend auf Türme, Boote und die Hauptwache zu und kann als offizielles **DLRG-XLSX-Formular** exportiert werden.

Einstiegspunkt: `Wachplan-Generator.html` (früher `index.html`).
Template-Datei: `Wachplan Template.xlsx` (DLRG-Formular, wird gepatcht).

---

## Dateistruktur

```
Wachplan-Generator.html   – Layout, CSS (dark theme, CSS-Variables), Script-Ladereihenfolge
js/state.js               – Globale Variablen & Datenstrukturen
js/utils.js               – escapeHtml, showToast, seededRand, Lookup-Helfer (getP/getT/getBoat)
js/dates.js               – Datumsberechnung (lokale Arithmetik, kein UTC-Shift)
js/autoCodes.js           – Automatische Stationscodes für Türme/Boote + freshDayState()
js/seed.js                – Beispieldatensatz (wird beim ersten Start ohne Autosave geladen)
js/render-sidebar.js      – Sidebar-UI: Personen, Türme, Boote, HW-Boot, XLSX-Spalten-Konfig
js/generate.js            – KERN-ALGORITHMUS: Wachplan berechnen (Scoring, Rotation)
js/render-output.js       – Ausgabe-Panel: Tages-Karten, Steuerung, Paarungs-Matrix
js/export.js              – XLSX- (XML-Patch via JSZip) und CSV-Export
js/move.js                – Modal zum manuellen Verschieben von Personen (↕-Button)
js/state-io.js            – JSON-Import/Export + localStorage Autosave
js/init.js                – Event-Listener + Startsequenz (autoLoad → seed fallback)
```

**Script-Ladereihenfolge beachten:** state → utils → dates → autoCodes → seed → render-sidebar → generate → render-output → export → move → state-io → init

---

## Globaler Zustand (state.js)

```js
people[]           // { id, name, role:'F'|'B'|'E'|'U' }
towers[]           // { id, name, prio:number, code:string }
boats[]            // { id, name, code, towerId:number|'HW'|null, prio }
dayState[]         // Array[DAYS]: { sick:Set, closed:Set, closedBoats:Set }
forcedPlacements[] // Array[DAYS]: [{ personId, kind:'tower'|'boat'|'main'|'hwboat', slotId, transparent:bool }]
positionDescriptions // { 3:'', 4:'', 5:'', 6:'', 7:'' } → XLSX-Zellen C11,C13,C15,C17,C19
exportColumns[]    // 16 Stationscodes → Template-Spalten (TEMPLATE_STATION_COLS)
lastResult         // letztes Berechnungsergebnis { schedule, pairCount, stats, peopleGuards }
activeDay          // aktuell sichtbarer Tab (0-basiert)
DAYS               // 1–14 (veränderbar zur Laufzeit)
uid                // monoton steigender ID-Counter
randomSeed         // 0 = kein Seed; >0 = deterministischer Tiebreaker für Tag 1
hwBoatId           // Boot-ID das der Hauptwache zugeordnet ist (null = keins)
mainK              // Anzahl Guard-Slots neben der Führung an der Hauptwache
```

**Rollen:** F = Führung, B = Bootsführer, E = Erfahren, U = Unerfahren  
**MAIN_ID = 0** (Pseudo-ID der Hauptwache)

---

## Kern-Algorithmus (generate.js)

Läuft **sequenziell** über alle Tage. Akkumulierte Statistiken (`stats`) übertragen sich auf Folgetage → faire Rotation.

### Zwangszuweisungen (forcedPlacements)
- `transparent: false` (effektiv) → Person aus Pool entfernen, fest vorab platzieren, Statistik zählt mit → Folgetage berücksichtigen den Wechsel
- `transparent: true` → Person bleibt im Pool, Algorithmus läuft normal, danach visuell in Zielslot verschoben → Folgetage identisch zum Originalplan

### BF-Aufteilung
- `activeBF` = Bootsführer die für Boote/HW-Boot gebraucht werden
- `surplusBF` = übrige BF, landen an Türmen/HW
- **Feature 5:** surplusBF bekommen +800 Punkte Strafe wenn sie in Turm mit aktivem Boot landen würden

### `bestPair(tower, requireMix)` – Scoring
```
+ 1000  beide Unerfahren (UU) + requireMix=true  → Notlösung
+ 40    beide Erfahren (EE) + requireMix=true
+ 120×  bisherige gemeinsame Turmdienste (Paar-Wiederholung vermeiden)
+ 30×v  Turmbesuche Person A (v≥2 → +300)
+ 30×v  Turmbesuche Person B (v≥2 → +300)
+ 5×    Gesamteinsätze (Fairness: wer wenig hatte, kommt zuerst)
+ 800   surplusBF-Strafe (Turm mit aktivem Boot)
+ Tiebreaker (deterministisch oder seededRand() für Tag 1)
```
**Niedrigster Score gewinnt.**

### Zuweisung pro Tag (Reihenfolge)
1. **Hauptwache** – Zwangszuweisungen → Paare via bestPair → Einzelpersonen
2. **Türme** – je 2 Wachgänger via bestPair(t, true), Türme nach prio absteigend
3. **Boote** – je 1 BF, sortiert nach wenigsten Einsätzen + Boot-Besuchen
4. **HW-Boot** (Feature 6) – dedizierter BF wenn hwBoatId aktiv
5. **HW finalize** – alle übrigen Personen kommen zur Hauptwache
6. **Transparente Zuweisungen** anwenden (visueller Tausch nach dem Algorithmus)

---

## Manuelles Verschieben (move.js)

- Jeder Wachgänger hat einen **↕-Button** (erscheint bei hover auf `.occupant`)
- `openMoveModal(personId, dayIdx, fromKind, fromSlotId)` – öffnet Modal
- Dropdown: alle validen Zielslots; Bootsführer sehen auch Boot-Optionen
- Checkbox **"Folgetage neu berechnen"** → steuert `transparent`-Flag
- `_applyMove()` → schreibt in `forcedPlacements[dayIdx]`, ruft `generate()` auf
- `clearForced(personId, fromDay, scope)` → entfernt Fixierungen ('today' | 'forward')

---

## XLSX-Export (export.js)

**Strategie:** Template als ZIP laden (JSZip), nur `xl/worksheets/sheet1.xml` per Regex patchen → Styles/Farben/Bilder bleiben erhalten.

### Wichtige Konstanten
```js
SLOT_ROWS_X = [7,9,11,13,15,17,19]        // Zeilen der Namens-Slots
SLOT_NAMECOL = [43,76,109,142]             // Spalten der 4 Namens-Blöcke (à 7 Personen)
TEMPLATE_STATION_COLS = [21,27,33,39,45,51,57,63,69,75,81,87,93,99,117,123]  // 16 Stationsspalten
FILL_HOURS = ['09:00',...,'17:00']         // Stundenraster das befüllt wird
HOUR_ROWS_X = { '09:00':[25,26], ... }     // Zeilen-Paare pro Stunde (oben/unten)
```

### Was wird gepatcht?
- `EE3` → Datum (Excel-Seriennummer via `excelSerial()`)
- `slotNameRef(n)` → Personennamen 1–28
- `C11,C13,C15,C17,C19` → Positionsbeschriftungen
- Zeile 21 der Stationsspalten → Stationscodes (aus `exportColumns`)
- Stundenraster → Personennummern (1-basiert) für jede Station
- HW-Overflow → Überzählige HW-Personen (>4) in leere exportColumns-Slots

### Template-Caching
- Primär: `fetch('Wachplan Template.xlsx')` (aus Projektordner)
- Fallback: `localStorage` (Base64, Key: `dlrg_wachplan_template_b64`)
- Chunks à 9000 Bytes (Vielfaches von 3 → kein btoa-Padding-Problem)

### `buildAssignments(dayIdx)` → `{ code: [Nr, Nr] }`
Baut Map: WF, WF2, HW, HW2, Turm-Codes, Boot-Codes → Personennummern

---

## Autosave & State-IO (state-io.js)

- `autoSave()` – nach jeder `generate()`-Ausführung → `localStorage` (Key: `dlrg_wachplan_autosave`)
- `autoLoad()` – beim Seitenstart; bei Erfolg: silent import + generate + Toast
- `exportStateJSON()` / `importStateJSON()` – vollständiger Status als `.json`-Datei
- Sets werden als Arrays serialisiert, beim Import rekonstruiert
- `STATE_VERSION = 3` – fehlende Felder in alten Exports werden mit Defaults gefüllt

---

## Sidebar-Rendering (render-sidebar.js)

| Funktion | Was sie tut |
|---|---|
| `renderPeople()` | Personenliste neu zeichnen; beim Löschen: aus dayState.sick + forcedPlacements bereinigen |
| `renderTowerCfg()` | Turm-Zeilen (Name / CODE / PRIO / ×); beim Löschen: verknüpfte Boote trennen |
| `renderBoatCfg()` | Boot-Zeilen (Name / CODE / Turm-Dropdown / ×) |
| `renderHWBoatSelector()` | Dropdown: welches Boot ist HW-Boot? |
| `autoFillExportColumns()` | Füllt exportColumns: Boote → Türme (Prio↓) → WF → WF2 → HW → HW2 |
| `renderExportColumnUI()` | 16 Felder für manuelles Stationscode-Mapping |
| `renderPositionDescUI()` | 5 Felder für XLSX-Positionsbeschriftungen (Pos. 3–7) |

---

## Ausgabe-Rendering (render-output.js)

- `renderOutput()` – zeichnet gesamten Output-Bereich neu (innerHTML-Replace)
- Tags: Tabs pro Tag (🤒/⛔ Flags), Stats-Bar, day-controls, Karten-Grid, Matrix
- Karten-Typen: `main` (gold, span-2), `tower` (normal), `boat` (blau), `closed` (ausgegraut)
- `renderMatrix()` – Paarungs-Kreuztabelle aller E+U-Personen (grün=1×, rot≥2×)
- Event-Listener direkt in renderOutput() verdrahtet (Tabs, Chips, Move-Buttons)

---

## Startsequenz (init.js)

```
autoLoad()
  ├─ Erfolg → importStateJSON(silent) → generate() → Toast "wiederhergestellt"
  └─ Kein Speicherstand → seed() → freshDayState() → freshForcedPlacements()
                          → render* → autoFillExportColumns()
_updateSaveIndicator() + _updateTemplateStatus()
```

---

## Design-Entscheidungen & Besonderheiten

| Aspekt | Lösung |
|---|---|
| Faire Rotation | Akkumulierte stats (total, towerVisits, boatVisits) über alle Tage |
| Reproduzierbarkeit | `seededRand()` – LCG-Zufallsgenerator, nur für Tag-1-Tiebreaker |
| UU-Warnung | score +1000 wenn beide Unerfahren → nur als Notlösung |
| BF-Schutz | surplusBFPenalty() +800 wenn BF an Turm mit aktivem Boot |
| Kein Framework | Vanilla-JS; Re-Renders via komplettem innerHTML-Replace |
| XLSX-Integrität | XML-Patch statt SheetJS-Write → Styles/Bilder/Schutz erhalten |
| Transparenter Swap | Person im Statistik-Pool belassen, nur Darstellung überschreiben |
| Timezone-Bug | Lokale Datumsarithmetik statt toISOString() → kein UTC-Off-by-one |
| Template-Fallback | fetch() → localStorage → Nutzer-Upload (pending export queue) |

---

## CSS-Design

Dark-Theme mit CSS-Variables:
- `--navy`, `--navy-2`, `--deep`, `--sea`, `--sea-bright`, `--foam` (Blautöne)
- `--coral`, `--coral-deep` (Rot/Fehler), `--warn` (Orange), `--green` (Erfolg)
- `--sand`, `--text`, `--text-dim`, `--line`, `--line-strong`, `--paper`
- Fonts: Archivo Black (Überschriften), Spline Sans (Text), Spline Sans Mono (Code/Labels)

---

## Bekannte Constraints

- Max. 28 Personen im XLSX-Namensblock (4 Blöcke × 7 Zeilen)
- Max. 16 Stationsspalten im Template (`TEMPLATE_STATION_COLS`)
- Paarungs-Matrix nur angezeigt wenn 2–18 Erfahren/Unerfahren-Personen
- DAYS max 14, min 1
