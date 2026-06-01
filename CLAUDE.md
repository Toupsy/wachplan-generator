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
towers[]           // { id, name, prio:number, code:string, slotCount:number (Default 2, 1–10) }
boats[]            // { id, name, code, towerId:number|'HW'|null, prio, slotCount:number (Default 1, 1–3) }
dayState[]         // Array[DAYS]: { sick:Set, closed:Set, closedBoats:Set }
forcedPlacements[] // Array[DAYS]: [{ personId, kind:'tower'|'boat'|'main'|'hwboat', slotId, transparent:bool }]
positionDescriptions // { 3:'', 4:'', 5:'', 6:'', 7:'' } → XLSX-Zellen C11,C13,C15,C17,C19
fairnessMetricsDisplay // { hwBoatBalance:bool, towerDistribution:bool, boatPairingDiversity:bool } – welche Stats-Bar-Metriken sichtbar sind
exportColumns[]    // 16 Stationscodes → Template-Spalten (TEMPLATE_STATION_COLS)
lastResult         // { schedule, pairCount, stats, peopleGuards, fairnessMetrics }
activeDay          // aktuell sichtbarer Tab (0-basiert)
DAYS               // 1–14 (veränderbar zur Laufzeit)
uid                // monoton steigender ID-Counter
randomSeed         // 0 = kein Seed; >0 = deterministischer Tiebreaker für Tag 1
hwBoatId           // Boot-ID das der Hauptwache zugeordnet ist (null = keins)
mainK              // Anzahl Guard-Slots neben der Führung an der Hauptwache
```

**Rollen:** F = Führung, B = Bootsführer, E = Erfahren, U = Unerfahren  
**MAIN_ID = 0** (Pseudo-ID der Hauptwache)

**`lastResult.stats[personId]`** (pro Person akkumuliert über alle Tage):
`{ total, towerVisits:{towerId→count}, boatVisits:{boatId→count}, hwVisits, towerWithBoatDays, boatCaptainPairings:{captainId→count} }`.
Hinweis: HW-Overflow (Personen in `main.base`) erhöht `total` NICHT – nur aktive Dienste (Turm, Boot, k-Guard-Slots an HW) zählen. Das ist Absicht: wer „nur" an der HW saß, gilt als unterbeschäftigt und wird für Folgetage bevorzugt aktiv eingeplant.

---

## Kern-Algorithmus (generate.js)

Läuft **sequenziell** über alle Tage. Akkumulierte Statistiken (`stats`) übertragen sich auf Folgetage → faire Rotation.

### Erweiterte Fairness-Metriken (Feature 7)

**Tracking pro Person:**
- `hwVisits` – Anzahl Tage an der Hauptwache
- `towerWithBoatDays` – Anzahl Tage auf Turm mit aktivem Boot
- `boatCaptainPairings` – Häufigkeit (Captain-ID → Count) wie oft mit bestimmtem Bootsführer zusammen

**Scoring-Verbesserungen:**
- bestPair() bestraft Turm-Paare wenn beide viele Boot-Tage haben (+150 Penalty)
- bestPair() bonusiert Turm-Paare wenn eine Person viele HW-Tage hat (-50 Bonus)
- Boot-Sortierung: 50× Penalty für wiederholte Zuweisungen + 5× HW-Balance

**Darstellung (render-output.js):**
- Stats-Bar zeigt `avgHwVisits | avgTowerWithBoatDays` (z.B. 0.9 | 0.9) mit Farbe (grün=ausgeglichen, orange=skew)
- Stats-Bar zeigt Boot-Paarungen-Diversität % (z.B. 80% einzigartig)

### Zwangszuweisungen (forcedPlacements)
- `transparent: false` (effektiv) → Person aus Pool entfernen, fest vorab platzieren, Statistik zählt mit → Folgetage berücksichtigen den Wechsel
- `transparent: true` → Person bleibt im Pool, Algorithmus läuft normal, danach visuell in Zielslot verschoben → Folgetage identisch zum Originalplan

### BF-Aufteilung
- `activeBF` = Bootsführer die für Boote/HW-Boot gebraucht werden
- `surplusBF` = übrige BF, landen an Türmen/HW
- **Feature 5:** surplusBF bekommen +800 Punkte Strafe wenn sie in Turm mit aktivem Boot landen würden

### `bestPair(tower, requireMix, currentDay)` – Scoring (Feature 8: Consecutive Day Prevention)
```
+ 1000  beide Unerfahren (UU) + requireMix=true  → Notlösung
+ 40    beide Erfahren (EE) + requireMix=true
+ 120×  bisherige gemeinsame Turmdienste (Paar-Wiederholung vermeiden)
+ 30×v  Turmbesuche Person A (v≥2 → +300)
+ 30×v  Turmbesuche Person B (v≥2 → +300)
+ 5×    Gesamteinsätze (Fairness: wer wenig hatte, kommt zuerst)
+ 800   surplusBF-Strafe (Turm mit aktivem Boot)
+ 200×2 konsekutive Tage auf gleichen Turm (Feature 8) ← NEW: 200 Punkte pro Person wenn Vortag auf selben Turm
+ 150   beide haben viele Boot-Tage (Tower+Boat balance)
- 50    Person hat viele HW-Tage (Bonus für Tower-Zuweisung)
+ Tiebreaker (deterministisch oder seededRand() für Tag 1)
```
**Niedrigster Score gewinnt.**

### Zuweisung pro Tag (Reihenfolge)
1. **Hauptwache** – Zwangszuweisungen → Paare via bestPair → Einzelpersonen
2. **Türme** – je 2 Wachgänger via bestPair(t, true), Türme nach prio absteigend
3. **Boote** – je 1 BF, sortiert nach:
   - Gesamteinsätze (primary)
   - Boot-Besuche × 50 Penalty (Rotation fairness) ← NEW Feature 7
   - HW-Besuche × 5 (balance HW-heavy people) ← NEW Feature 7
4. **HW-Boot** (Feature 6) – dedizierter BF wenn hwBoatId aktiv (gleiche Sortierung)
5. **Boot-Captain-Paarungen tracking** ← NEW Feature 7 – Nach Boot-Zuweisung: registriere Turm-Personen × Captain
6. **HW finalize** – alle übrigen Personen kommen zur Hauptwache
7. **Transparente Zuweisungen** anwenden (visueller Tausch nach dem Algorithmus)

---

## Manuelles Verschieben & Drag-and-Drop (move.js, render-output.js)

**Move-Modal** (↕-Button):
- Jeder Wachgänger hat einen **↕-Button** (erscheint bei hover auf `.occupant`)
- `openMoveModal(personId, dayIdx, fromKind, fromSlotId)` – öffnet Modal
- Dropdown: alle validen Zielslots; Bootsführer sehen auch Boot-Optionen
- Checkbox **"Folgetage neu berechnen"** → steuert `transparent`-Flag
- `_applyMove()` → schreibt in `forcedPlacements[dayIdx]`, ruft `generate()` auf
- `clearForced(personId, fromDay, scope)` → entfernt Fixierungen ('today' | 'forward')

**Drag-and-Drop** (NEW):
- Personen können direkt per D&D zwischen Slots verschoben werden
- Visuelles Feedback: Opacity bei drag, Highlighting beim hover
- Rollenvalidierung: Nicht-Bootsführer zu Boot → Confirmation-Dialog
- **Confirmation mit Checkbox**: "Folgetage neu berechnen" Option im Dialog
- `showConfirmation(message, onConfirm, onCancel, showRecalcCheckbox)` – erweiterbar
- `recalcFuture` wird durch Checkbox-Status bestimmt und an `_applyMove()` übergeben

---

## Fairness-Features (Feature 8, 9, 10)

### Feature 8: "2 Tage in Folge"-Regel (Consecutive Day Prevention)
**Problem:** Personen wurden zu oft auf aufeinanderfolgenden Tagen auf dem gleichen Turm eingeplant.  
**Lösung:** 
- `checkConsecutiveTowerPenalty(personA, personB, towerId, currentDay)` in `generate.js`
- Sucht im Vortag-Plan, ob Person A/B bereits auf `towerId` waren
- Penalty: +200 Punkte pro Person wenn Vortag auf selben Turm
- Wird in `bestPair()` eingerechnet (nur für Tower, nicht Hauptwache)
- `bestPair()` erhält neuen Parameter `currentDay` zur Bestrafung

**Effekt:** Personen verteilen sich auf verschiedene Türme über mehrere Tage

### Feature 9: Metriken-Toggle (UI-Schalter für Fairness-Metriken)
**Problem:** Zu viele Metriken in der Stats-Bar, die nicht alle relevant sind.  
**Lösung:**
- Globales `fairnessMetricsDisplay` Objekt in `state.js` mit drei Flags:
  - `hwBoatBalance` – zeige HW-Tage vs Boot-Turm Balance
  - `towerDistribution` – zeige durchschnitt verschiedene Türme
  - `boatPairingDiversity` – zeige Boot-Paarungen Vielfalt
- HTML-Checkboxes in Sidebar: `#metric-hw-balance`, `#metric-tower-dist`, `#metric-boat-pairing`
- Event-Listener in `init.js` (optimiert mit Schleife)
- `renderOutput()` in `render-output.js` bedingt zeigt Metriken basierend auf Flags

**Effekt:** Nutzer kann relevant Metriken anzeigen/verstecken

### Feature 10: Pro-Person Tower-Statistik
**Problem:** Keine Übersicht, welche Türme eine Person besucht hat (nur Paarungs-Matrix).  
**Lösung:**
- Neue Funktion `renderTowerStatsPerPerson()` in `render-output.js`
- Tabelle mit Spalten: Person | Gesamt-Tage | Unique Türme | Details
- Details zeigen Turm-Namen + Besuchsanzahl, sortiert nach Turm-Priorität
- Farb-Coding: Grün wenn ≥50% der Türme besucht, Orange sonst
- Wird nach der Paarungs-Matrix angezeigt

**Effekt:** Transparenz über Tower-Verteilung pro Person

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
- Zeile 21 + Stundendaten → via `slotMap` (s. Slot-Map-Strategie unten)
- HW-Overflow → Personen 5+ (inkl. Kranke) in verbleibende leere Slots

### Slot-Map-Strategie (`_patchSheetXml`)
`slotMap[0..15]` wird beim Export berechnet; `exportColumns` bleibt unberührt:
1. **Sequenz-Aufbau**: `exportColumns` von links nach rechts; leere Einträge → `null`; belegte Einträge → primärer Slot + Overflow-Paare direkt dahinter (alle Folgeeinträge incl. nulls rücken nach rechts)
2. **Overflow-Beispiel**: `[78/1, 9/12, '', WF, HW, '', '']` + 9/12-Overflow + WF-Overflow + HW-Overflow → seq = `[78/1,9/12,9/12,null,WF,WF,HW,HW,null,null]` → 3 nulls von rechts entfernen → `[78/1,9/12,9/12,WF,WF,HW,HW]`
3. **Null-Entfernung von rechts**: Ist seq länger als 16, werden null-Slots von rechts entfernt bis seq passt. Nur wenn keine nulls mehr übrig: hart kürzen (letzter Ausweg)
4. **HW-Overflow-Splice** (nur wenn `HW2` in exportColumns): Personen 5+ per `splice` nach HW2. Wenn HW2 NICHT konfiguriert → alle allHW in `A['HW']` inline
5. `null`-Slots → nicht in XML geschrieben → Template-Felder bleiben leer

### `buildAssignments(dayIdx)` – WF/HW-Splitting
- Wenn `WF2` in exportColumns: `A['WF'] = f.slice(0,2)`, `A['WF2'] = f.slice(2,4)` (klassisch)
- Wenn `WF2` NICHT in exportColumns: `A['WF'] = f` (alle Führung → Overflow inline)
- Identisch für `HW`/`HW2` mit `allHW`

### `autoFillExportColumns()` – Reihenfolge
Pro Turm (Prio absteigend): erst zugeordnete Boote, dann Turm → Boot steht immer links von seinem Turm. Dann freie Boote, WF, WF2, HW, HW2.

### `renderExportColumnUI()` – Drag & Drop
Jede Zeile hat `draggable="true"` + ⠿-Handle. dragstart speichert Quell-Index; drop tauscht `exportColumns[src]` ↔ `exportColumns[dst]` und re-rendert. Input hat `draggable="false"`.

### `buildAssignments(dayIdx)` → `{ code: [Nr, ...] }`
- Türme: **alle** Besatzer (kein slice); Überlauf >2 → adjacent via `effectiveCols`
- HW: `mainGuards + base + bootsfLeft + sick` → WF/WF2 (Führung), HW/HW2 (Rest inkl. Kranke)

### Template-Caching
- Primär: `fetch('Wachplan Template.xlsx')` (aus Projektordner)
- Fallback: `localStorage` (Base64, Key: `dlrg_wachplan_template_b64`)
- Chunks à 9000 Bytes (Vielfaches von 3 → kein btoa-Padding-Problem)

---

## Autosave & State-IO (state-io.js)

- `autoSave()` – nach jeder `generate()`-Ausführung → `localStorage` (Key: `dlrg_wachplan_autosave`)
- `autoLoad()` – beim Seitenstart; bei Erfolg: silent import + generate + Toast
- `exportStateJSON()` / `importStateJSON()` – vollständiger Status als `.json`-Datei
- `_buildStateObject()` – zentrale Serialisierung (von autoSave UND exportStateJSON genutzt). Enthält u.a. `slotCount`, `fairnessMetricsDisplay`, `positionDescriptions`, `exportColumns`
- Sets (sick/closed/closedBoats) werden als Arrays serialisiert, beim Import rekonstruiert
- Beim Import: `syncMetricCheckboxes()` setzt die Checkbox-Zustände passend zu `fairnessMetricsDisplay`
- `STATE_VERSION = 3` – fehlende Felder in alten Exports werden mit Defaults gefüllt (`fairnessMetricsDisplay` → alle true, `slotCount` → 2/1)

---

## Sidebar-Rendering (render-sidebar.js)

| Funktion | Was sie tut |
|---|---|
| `renderPeople()` | Personenliste neu zeichnen; beim Löschen: aus dayState.sick + forcedPlacements bereinigen |
| `renderTowerCfg()` | Turm-Zeilen (Name / CODE / PRIO / **Slot-Spinner ±** / ×); Spinner ändert `slotCount` (1–10) + generate(); beim Löschen: verknüpfte Boote trennen |
| `renderBoatCfg()` | Boot-Zeilen (Name / CODE / Turm-Dropdown / **Slot-Spinner ±** / ×); Spinner ändert `slotCount` (1–3) |
| `renderHWBoatSelector()` | Dropdown: welches Boot ist HW-Boot? |
| `autoFillExportColumns()` | Füllt exportColumns: Boote → Türme (Prio↓) → WF → WF2 → HW → HW2 |
| `renderExportColumnUI()` | 16 Felder für manuelles Stationscode-Mapping |
| `renderPositionDescUI()` | 5 Felder für XLSX-Positionsbeschriftungen (Pos. 3–7) mit aussagekräftigen Placeholders (z.B. „Wachführer", „Bootsführer", „Sanitäter") |

---

## Ausgabe-Rendering (render-output.js)

- `renderOutput()` – zeichnet gesamten Output-Bereich neu (innerHTML-Replace)
- Tags: Tabs pro Tag (🤒/⛔ Flags), Stats-Bar, day-controls, Karten-Grid, Tower-Stats-Tabelle, Matrix
- Karten-Typen: `main` (gold, span-2), `tower` (normal), `boat` (blau), `closed` (ausgegraut)
- **Stats-Bar:** 4 feste Metriken (Paare, Wiederholungen, U+U, Turm>2×) + 3 optionale (via `fairnessMetricsDisplay` ein-/ausblendbar): 🏠 HW|Boot-Turm, 📍 Ø Türme, 👥 Boot-Paare-unique
- `renderTowerStatsPerPerson()` – Tabelle Person | Gesamt | Unique-Türme | Details (Türme nach Prio sortiert, farbcodiert ≥50%)
- `renderMatrix()` – Paarungs-Kreuztabelle aller E+U-Personen (grün=1×, rot≥2×); nur bei 2–18 E/U
- Event-Listener direkt in renderOutput() verdrahtet (Tabs, Chips, Move-Buttons, D&D auf `.towers-grid`)

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
| Fairness Metrics (Feature 7) | hwVisits, towerWithBoatDays, boatCaptainPairings für Balance-Scoring |
| Konsekutiv-Regel (Feature 8) | `prevTowerSet` (Set der gestrigen Turm-Personen) 1× pro bestPair vorberechnet → +200/Person Penalty. Soft → weicht bei knapper Besetzung |
| Metrik-Toggle (Feature 9) | `fairnessMetricsDisplay` Flags; Checkboxes in Sidebar; `syncMetricCheckboxes()` nach Import |
| Tower-Stats (Feature 10) | `renderTowerStatsPerPerson()` Tabelle |
| Variable Slot-Kapazität | `slotCount` pro Turm (1–10) / Boot (1–3) via Spinner; Algorithmus füllt `slotCount - vorbelegte` Plätze |
| Reproduzierbarkeit | `seededRand()` – LCG-Zufallsgenerator, nur für Tag-1-Tiebreaker |
| UU-Warnung | score +1000 wenn beide Unerfahren → nur als Notlösung |
| BF-Schutz | surplusBFPenalty() +800 wenn BF an Turm mit aktivem Boot |
| Kein Framework | Vanilla-JS; Re-Renders via komplettem innerHTML-Replace |
| XLSX-Integrität | XML-Patch statt SheetJS-Write → Styles/Bilder/Schutz erhalten |
| Transparenter Swap | Person im Statistik-Pool belassen, nur Darstellung überschreiben. **Achtung:** transparentes Verschieben auf vollen Turm zeigt `slotCount+1` Belegung (visueller Overlay, kein Verdrängen) – Absicht; Export verarbeitet Overflow zu Nachbarspalte |
| D&D Validation | Rollenvalidierung mit Confirmation-Dialog (× = Abbrechen) + optional Zukunfts-Neuberechnung |
| Timezone-Bug | Lokale Datumsarithmetik statt toISOString() → kein UTC-Off-by-one |
| Template-Fallback | fetch() → localStorage → Nutzer-Upload (pending export queue) |
| `personNr()` | NUR in utils.js definiert (utils lädt vor export) – nicht duplizieren |
| Perf-Optimierungen | `activeBoatTowers`-Set pro Tag; `prevTowerSet` + `ensure()`-Caching in bestPair → ~20ms für 28 Pers./14 Tage |

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
- Turm `slotCount` 1–10, Boot `slotCount` 1–3
- Transparentes Verschieben auf vollen Turm → Overflow-Darstellung (siehe Design-Tabelle)

---

## Testing & Performance

**Test-Strategie (bewährt):** Browser-Preview + `preview_eval`-Harness statt Unit-Tests (kein Build-Setup nötig).

**Invarianten-Validator** (im Page-Context via eval injizieren) prüft nach jedem `generate()`:
- Keine Person doppelt eingeteilt (double-booking) am selben Tag
- Keine kranke Person irgendwo eingeteilt
- Kein geschlossener Turm / außer-Dienst-Boot belegt
- `slotCount` eingehalten (Ausnahme: transparenter Overlay – siehe oben)

**Bewährte Test-Szenarien:** baseline 6d · 14d · 1d · kranke Personen · geschlossener Turm/Boot · 0 Personen · 1 Person · alle krank · alle Türme zu · Zwangszuweisung effektiv/transparent · **Fuzz-Test** (100× zufällige sick/closed/forced-Muster).

**Konsekutiv-Regel-Messung:** Verstöße/Gelegenheiten zählen → normal 0%, unter Extremdruck ~2,4%.

**Performance-Baseline:** ~20 ms für 28 Personen × 14 Tage (Maximalszenario). Bei Regressionen >100 ms: Hot-Loop in `bestPair` (O(n²) über Guard-Pool pro Turm) prüfen.

**Preview starten:** `.claude/launch.json` Server „wachplan" (Port 3000), dann `/Wachplan-Generator.html`. localStorage-Key `dlrg_wachplan_autosave` vor Tests löschen für sauberen Seed.
