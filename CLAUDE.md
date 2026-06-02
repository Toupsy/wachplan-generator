# DLRG Wachplan-Generator – Projektkontext

> **Wichtig für Claude:** Diese Datei nach jeder Änderung am Projekt aktualisieren
> (neue Features, geänderte Funktionen, neue Dateien, Bugfixes).
> **Versioning:** Nach jedem Commit die VERSION Datei um 1 erhöhen (z.B. 0.1002 → 0.1003)

## Git-Workflow

- **Niemals direkt auf `main` committen oder pushen**
- Zu Beginn jeder Aufgabe Branch erstellen: `git checkout -b feature/<kurzname>` oder `git checkout -b fix/<kurzname>`
- Am Ende: `git push origin <branch>` → `gh pr create` gegen `main`
- Remote: `https://github.com/Toupsy/Wachplan-Generator`

---

## Was ist das?

Single-Page-Application (reines Vanilla-JS, kein Framework) für die **DLRG (Deutsche Lebens-Rettungs-Gesellschaft)**. Sie erstellt automatisch Wachpläne für Wasserrettungsdienste über **1–14 Tage**. Der Plan weist Personen fair rotierend auf Türme, Boote und die Hauptwache zu und kann als offizielles **DLRG-XLSX-Formular** exportiert werden.

Einstiegspunkt: `Wachplan-Generator.html` (früher `index.html`).
Template-Datei: `Wachplan Template.xlsx` (DLRG-Formular, wird gepatcht).

---

## Dateistruktur

### Frontend (Client-seitig)
```
Wachplan-Generator.html   – Layout, CSS (dark theme, CSS-Variables), Script-Ladereihenfolge
admin.html                – Admin-Panel für User-Verwaltung

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
js/state-io.js            – Server-Sync statt localStorage (autoSave via PUT /api/plans/:id)
js/login-modal.js         – Login-Modal UI & Authentication Flow
js/user-info.js           – User-Info Header, Admin-Panel Link, Plan-Import, Logout
js/init.js                – Event-Listener + Startsequenz (autoLoad → seed fallback)
```

### Backend (Server-seitig)
```
server.js                 – Express.js Server, Session-Setup, Route-Registration
db/init.js                – SQLite Initialisierung, Schema Migration
db/schema.sql             – Datenbank Schema (users, plans, sessions)

api/auth.js               – Authentication Endpoints (login/logout/init/me)
api/plans.js              – Plan CRUD API mit AES-256-GCM Verschlüsselung
api/admin.js              – Admin-Endpoints für User-Verwaltung (Admin-only)
api/import.js             – Plan-Import API für alte .json-Dateien
```

### Configuration
```
.env                      – Environment-Variablen (MASTER_SECRET, SALT, SESSION_SECRET)
.env.example              – Template für .env
.gitignore                – Git-Ignore (node_modules, .env, /data)
Dockerfile                – Multi-stage Build für Production
docker-compose.yml        – Production-Ready Docker Compose Config
DEPLOYMENT.md             – Deployment-Anleitung für Docker
```

**Script-Ladereihenfolge beachten:** state → utils → dates → autoCodes → seed → render-sidebar → generate → render-output → export → move → state-io → user-info → login-modal → init

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

### `bestPair(tower, requireMix, currentDay)` – Scoring (Feature 8: Consecutive Day Prevention + Session Fixes)
```
+ 1000  beide Unerfahren (UU) + requireMix=true  → Notlösung
+ 40    beide Erfahren (EE) + requireMix=true
+ 120×  bisherige gemeinsame Turmdienste (Paar-Wiederholung vermeiden)
+ 30×v  Turmbesuche Person A (v≥2 → +300)
+ 30×v  Turmbesuche Person B (v≥2 → +300)
+ 5×    Gesamteinsätze (Fairness: wer wenig hatte, kommt zuerst)
+ 800   surplusBF-Strafe (Turm mit aktivem Boot)
+ 200×2 konsekutive Tage auf gleichen Turm (Feature 8)
+ 150   beide haben viele Boot-Tage (Tower+Boat balance)
- 60×   Person hat viele HW-Tage (proportionaler Bonus für Tower-Zuweisung) ← FIX: statt -50, jetzt proportional
- 350   surplusBF zu Turm dessen Boot außer Dienst (1150 Swing gg. aktives Boot) ← FIX: NEW
+ 60×   (HW-k-Slots) Person hat viele HW-Tage (Strafe für erneute HW) ← FIX: NEW
+ Tiebreaker (deterministisch oder seededRand() für Tag 1)
```
**Niedrigster Score gewinnt.**

### Zuweisung pro Tag (Reihenfolge)
0. **BF-Rotation Fairness** (neu Session Bugfix) – `availB` nach boatDays*50 - hwVisits*10 sortieren VOR activeBF/surplusBF-Split → faire Verteilung statt immer gleiche Person
1. **Hauptwache** – Zwangszuweisungen → Paare via bestPair → Einzelpersonen
2. **Türme** – je `slotCount` Wachgänger via bestPair(t, true), Türme nach prio absteigend
3. **Boote** – je 1 BF (aus `poolB.slice(0, neededBF)`), sortiert nach:
   - Gesamteinsätze (primary)
   - Boot-Besuche × 50 Penalty (Rotation fairness)
   - HW-Besuche × -10 Bonus (BF mit mehr HW-Tagen bevorzugt für Boot)
4. **HW-Boot** (Feature 6) – dedizierter BF wenn hwBoatId aktiv (gleiche Sortierung)
5. **Boot-Captain-Paarungen tracking** – Nach Boot-Zuweisung: registriere Turm-Personen × Captain
6. **HW finalize** – Zwangszuweisungen → verbleibende Personen + alle Overflow
   - **HW-Tracking (neu Session Bugfix):** `mainGuards` + alle in `base` / `poolB` (Overflow) bekommen `hwVisits++`
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

**Drag-and-Drop**:
- Personen können direkt per D&D zwischen Slots verschoben werden
- Visuelles Feedback: Opacity bei drag, Highlighting beim hover
- Rollenvalidierung: Nicht-Bootsführer zu Boot → Confirmation-Dialog
- **Confirmation mit Checkbox**: "Folgetage neu berechnen" Option im Dialog
- `showConfirmation(message, onConfirm, onCancel, showRecalcCheckbox)` – erweiterbar
- `recalcFuture` wird durch Checkbox-Status bestimmt und an `_applyMove()` übergeben
- **Session Bugfix 3**: dragSrc vor Modal sichern (srcPersonId/srcKind/srcSlot local vars) → dragend nullt nicht mehr die Closure-Refs

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

## Session Bugfixes & Improvements

### Bugfix 1: HW-Fairness (Person 3 Tage in Folge an der Hauptwache)
**Problem:** Overflow-Personen (`main.base` / `main.bootsfLeft`) bekamen nie `hwVisits++`, daher dachte der Algorithmus, sie waren nie an der HW. → Personen häuften sich immer in der Overflow-Liste an.

**Root Causes:**
1. Overflow-Tracking fehlte
2. `availB` wurde ohne Fairness-Sortierung in activeBF/surplusBF aufgeteilt (immer erste Person aufs Boot)
3. Boot-Sort-Faktor für `hwVisits` war falsch herum (`+5` statt `-10`)

**Fixes in `generate.js`:**
- Nach HW-finalize: `leftovers.forEach(p => ensure(p.id).hwVisits++)` + `poolB.forEach(p => ensure(p.id).hwVisits++)`
- BF-Sortierung VOR Split: `availB.sort((a,b) => (boatA*50 - hwA*10) - (boatB*50 - hwB*10))`
- Boot-Scoring: `- hwVisits * 10` (war `+5`), HW-k-Slots: `+ hwVisits * 60`
- bestPair Tower-Scoring: `- hwVisits * 60` (proportional, nicht Threshold)

**Result:** HW-Spread E/U 6-Tage: **1** (war 4+), 14-Tage: **2** (war 4+), BF-Rotation: **3/3** (war 6/0).

### Bugfix 2: Boot außer Dienst → BF automatisch zum Turm
**Problem:** Wenn ein Boot außer Dienst gesetzt wird, der zugewiesene BF ging nicht automatisch zum Turm des Boots, sondern zur HW.

**Fix in `generate.js`:**
- Compute `closedBoatTowers`-Set pro Tag neben `activeBoatTowers`
- surplusBF Scoring: `-350 Bonus` für Türme deren Boot außer Dienst
- Kombiniert mit `+800` Penalty für aktive-Boot-Türme: **1150 Punkte Swing** → BF geht garantiert zum richtigen Turm

**Result:** Boot außer Dienst → BF zu Turm **100%**.

### Bugfix 3: Drag-and-Drop TypeError (dragSrc = null vor Modal-Bestätigung)
**Problem:** `dragend` feuert asynchron kurz nach `drop` und setzt `dragSrc = null`. Die `showConfirmation()`-Closure referenziert `dragSrc.personId` beim Klick → `TypeError: Cannot read property 'personId' of null`.

**Fix in `render-output.js` (drop-Handler):**
- `dragSrc` vor `showConfirmation()` in lokale Vars sichern: `const srcPersonId = dragSrc.personId; const srcKind = dragSrc.kind; const srcSlot = dragSrc.slot;`
- dragstart: `dragSrc.slot` normalisieren auf `0` (nicht `null`) für MAIN_ID, damit Same-Slot-Check funktioniert

**Result:** D&D funktioniert zuverlässig, keine TypeError mehr.

### Bugfix 4: Move ohne Folgetage-Neuberechnung – CORRECT IMPLEMENTATION
**Original Problem:** Case 1 (transparent move) sollte nur Tag heute ändern und Folgetage unverändert lassen.

**Root Cause:** `generate()` berechnet IMMER alle Tage neu. Auch wenn transparent placements am ENDE angewendet werden, die Folgetage werden mit möglichem Zufall neu berechnet → unterschiedliche Ergebnisse.

**Failed Attempts:**
1. Storing/restoring stats: Insufficient, entire schedule was recalculated
2. Plan restoration: Complex, didn't account for randomization in generate()

**CORRECT Fix (Current Implementation):**
- **Case 1 (transparent=true):** Do NOT call `generate()` at all
- **Case 2 (transparent=false):** Call `generate()`, but only keep days AFTER the change

**Implementation in js/move.js and js/render-output.js:**
```js
if(forwardScope){
  // Case 2: Effective change, partial recalculation
  const oldSchedule = lastResult.schedule.map(d => JSON.parse(JSON.stringify(d)));

  _applyMove(personId, dayIdx, target.kind, target.slotId, true);
  generate();

  // Restore days BEFORE the change from old schedule
  // Keep day of change and all following days NEW
  for(let d = 0; d < dayIdx; d++){
    lastResult.schedule[d] = oldSchedule[d];
  }
  renderOutput();
} else {
  // Case 1: Visual-only, NO generate()
  _applyMove(personId, dayIdx, target.kind, target.slotId, false);
  renderOutput();
}
```

**Implementation in js/render-output.js:**
- At start of `renderOutput()`: Clone schedule and apply transparent placements visually
- Only affects display layer, `lastResult` remains completely untouched
```js
// Wende transparent placements visuell an (ohne generate())
schedule = schedule.map((day, dayIdx) => {
  const dayForcedTransparent = (forcedPlacements[dayIdx] || []).filter(f => f.transparent);
  if(dayForcedTransparent.length === 0) return day;
  
  const dayClone = JSON.parse(JSON.stringify(day));
  // Manipuliere dayClone Occupants, original bleibt unverändert
  dayForcedTransparent.forEach(f => { /* move logic */ });
  return dayClone;
});
```

**Why This Works:**
- **Case 1:** No `generate()` call = Folgetage completely untouched
  - renderOutput() clones schedule, applies visual move to display only
  - `lastResult.schedule` and `lastResult.stats` identical to original
  - Days before, day of change, and days after all UNCHANGED
  
- **Case 2:** `generate()` called, but only keep days after change
  - Days 0..dayIdx-1: **Restored from old plan** (untouched by change)
  - Day dayIdx: **New from generate()** (with manual change applied)
  - Days dayIdx+1+: **New from generate()** (calculated with updated fairness from day of change)
  - `lastResult.stats` accumulated up to day of change, then used for future planning
  - This ensures: previous schedule stability + change takes effect + fair future planning

**Result:** ✅ Case 1 und Case 2 funktionieren korrekt separiert.

---

## Feature 11: Seed-basierte Start-Konstellationen

### Zweck
Benutzer können verschiedene, aber **gleichmäßig faire** Wachpläne generieren, indem sie nur die **Day 1-Konstellation** variieren. Die Fairness-Algorithmus auf Days 2+ balanciert automatisch alle Varianten auf identische Gesamtfairness aus.

### Implementierung (js/init.js)

**Seed-Input-Feld** (Wachplan-Generator.html, vor Generate-Button):
```html
<input id="seed-input" type="number" min="0" max="999" value="0">
```
- `0` = Standard-Plan ohne Seed-Zwangszuweisungen (normaler Algorithmus)
- `1-999` = Deterministische Permutation der E/U-Personen und Bootsführer auf Day 1

**Seed-Logik** (`applySeedConstraints(seed)`):
1. Fisher-Yates Shuffle (LCG-basiert, nicht globales `seededRand`) auf EU-Liste mit `seed` als Startwert
2. Shuffle auf BF-Liste mit `seed * 2` (unterschiedliche Permutation)
3. Shuffelte EU-Personen sequenziell auf verfügbare Tower-Slots
4. Shuffelte BF sequenziell auf verfügbare Boot-Slots
5. Remaining persons → Hauptwache
6. Alle als `transparent: false` (effektive Zwangszuweisungen), damit Stats mitzählen
7. `generate()` wird aufgerufen → Days 2-6 laufen normal mit balanciertem Scoring

### Algorithmus-Details

**Fisher-Yates Shuffle (in applySeedConstraints):**
```js
const seedShuffle = (arr, seedVal) => {
  const result = arr.slice();
  let rng = seedVal;
  for(let i = result.length - 1; i > 0; i--){
    rng = (rng * 1664525 + 1013904223) & 0x7fffffff;  // LCG
    const j = rng % (i + 1);
    [result[i], result[j]] = [result[j], result[i]];
  }
  return result;
};
```
- **Deterministisch:** Gleiches `seedVal` → immer gleiche Permutation
- **Unterschiedlich pro Seed:** Verschiedene `seedVal` → verschiedene Permutationen
- **Unabhängig:** Verschiedene RNG-Initialisierung für EU vs BF (seed × 1 vs seed × 2)

### Fairness-Garantie

**Testresultate (6 Tage, 16 Personen):**

| Seed | Work Days | HW Visits | Total |
|------|-----------|-----------|-------|
| 0 (Standard) | 1-5 (avg 3.38) | 1-4 (avg 2.75) | 54 |
| 1 | 1-5 (avg 3.38) | 1-4 (avg 2.75) | 54 |
| 5 | 1-5 (avg 3.38) | 1-4 (avg 2.75) | 54 |

**Erkenntnis:** Alle Seeds erzeugen identische Fairness-Metriken, obwohl Day 1 völlig unterschiedlich ist. Das bedeutet:
- **Seed 1 Day 1:** Klara, Jonas, Ole, Lena, Hugo, Ida auf Türme
- **Seed 5 Day 1:** Frieda, Lena, Klara, Emil, Hugo, Greta auf Türme
- **Beides:** Days 2-6 balancieren zu gleicher Gesamtfairness

**Mechanismus:** Die akumulierten `stats` werden auf Days 2+ übertragen → der Scoring-Algorithmus sieht, dass (z.B.) Klara schon viel gearbeitet hat (weil sie auf Day 1 eingeplant war), und bevorzugt andere auf Day 2. Nach 6 Tagen konvergieren alle Seeds zu identischer Fairness-Spreizung.

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
- Zeile 21 + Stundendaten → via `effectiveCols` (s. Overflow-Strategie unten)
- HW-Overflow → Personen 5+ (inkl. Kranke) in verbleibende Template-Spalten

### Overflow-Strategie & effektives Layout (`_patchSheetXml`)
`effectiveCols[]` wird beim Export berechnet, `exportColumns` bleibt unberührt:
1. Iteriere `exportColumns` der Reihe nach; leere Slots überspringen
2. Jede Station belegt eine Template-Spalte (primär: Personen 1–2)
3. Hat die Station >2 Personen → Überlauf-Paare belegen die **nächste** Template-Spalte direkt rechts (adjacent, nicht am Ende)
4. Nachfolgende Stationen rücken entsprechend nach rechts
5. Verbleibende Template-Spalten → HW-Overflow (Personen 5+, inkl. Kranke)

### `autoFillExportColumns()` – Reihenfolge (ab v0.1002)
Pro Turm (Prio absteigend): erst zugeordnete Boote, dann Turm → Boot steht immer links von seinem Turm. Dann freie Boote, WF (→ WF2 nur wenn >2 Führungspersonen), HW (→ HW2 nur manuell hinzufügen falls nötig). HW-Overflow wird automatisch via _patchSheetXml zu benachbarten Spalten verteilt.

### `renderExportColumnUI()` – Drag & Drop
Jede Zeile hat `draggable="true"` + ⠿-Handle. dragstart speichert Quell-Index; drop tauscht `exportColumns[src]` ↔ `exportColumns[dst]` und re-rendert. Input hat `draggable="false"`.

### `buildAssignments(dayIdx)` → `{ code: [Nr, ...] }` (ab v0.1002)
- Türme: **alle** Besatzer (kein slice); Überlauf >2 → adjacent via `effectiveCols`
- HW: `mainGuards + base + bootsfLeft + sick` → WF/WF2 (Führung), HW (Rest inkl. Kranke), optional HW2 falls in exportColumns
- **hasHW2-Logik:** Prüft zur Export-Zeit, ob 'HW2' in exportColumns vorhanden ist; wenn nein, wird HW-Overflow inline via adjacent columns gehandelt

### Template-Caching (ab v0.1001)
- **Auto-Load:** `fetch('Wachplan Template.xlsx')` (aus Projektordner) – kein manueller Upload nötig
- **Caching:** Geladenes Template wird in `localStorage` (Base64, Key: `dlrg_wachplan_template_b64`) gespeichert für Offline-Verfügbarkeit
- **Chunks:** 9000 Bytes (Vielfaches von 3 → kein btoa-Padding-Problem)
- **Fehlerbehandlung:** Wenn Fetch fehlschlägt, wird Exception geworfen (kein Fallback zu Benutzer-Upload)

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
| `autoFillExportColumns()` | Füllt exportColumns: Boote → Türme (Prio↓) → WF → WF2 → HW (nur wenn nötig HW2) – nur HW2 wenn Nutzer es manuell hinzufügt (Overflow sonst via _patchSheetXml) |
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
_updateSaveIndicator()
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
| Seed-basierte Konstellationen (Feature 11) | `applySeedConstraints(seed)` mit Fisher-Yates Shuffle; alle Seeds → identische Gesamtfairness über alle Tage |
| Variable Slot-Kapazität | `slotCount` pro Turm (1–10) / Boot (1–3) via Spinner; Algorithmus füllt `slotCount - vorbelegte` Plätze |
| Reproduzierbarkeit | `seededRand()` – LCG-Zufallsgenerator, nur für Tag-1-Tiebreaker |
| UU-Warnung | score +1000 wenn beide Unerfahren → nur als Notlösung |
| BF-Schutz | surplusBFPenalty() +800 wenn BF an Turm mit aktivem Boot; -350 wenn Boot außer Dienst (1150 Swing) |
| BF-Fairness | `availB` vor activeBF/surplusBF-Split nach `(boatDays*50 - hwVisits*10)` sortieren (Session Bugfix 1) |
| HW-Overflow-Tracking | `leftovers` + `poolB` bekommen nach HW-finalize `hwVisits++` (Session Bugfix 1) |
| HW-Fairness-Scoring | bestPair Tower: `- hwVisits*60`; HW-k-Slots: `+ hwVisits*60` (proportional, nicht Threshold) (Session Bugfix 1) |
| Kein Framework | Vanilla-JS; Re-Renders via komplettem innerHTML-Replace |
| XLSX-Integrität | XML-Patch statt SheetJS-Write → Styles/Bilder/Schutz erhalten |
| Transparenter Swap | Person im Statistik-Pool belassen, nur Darstellung überschreiben. **Achtung:** transparentes Verschieben auf vollen Turm zeigt `slotCount+1` Belegung (visueller Overlay, kein Verdrängen) – Absicht; Export verarbeitet Overflow zu Nachbarspalte |
| D&D Validation | Rollenvalidierung + Confirmation-Dialog (× = Abbrechen) + optional Zukunfts-Neuberechnung; dragSrc vor Modal sichern (Session Bugfix 3) |
| dragSrc capture | D&D drop-Handler: srcPersonId/srcKind/srcSlot in lokale Vars VOR showConfirmation, um dragend-Nulling zu vermeiden (Session Bugfix 3) |
| Timezone-Bug | Lokale Datumsarithmetik statt toISOString() → kein UTC-Off-by-one |
| Template-Auto-Load | fetch('Wachplan Template.xlsx') → localStorage cache (kein Nutzer-Upload) – ab v0.1001 |
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

**Session Bugfix Test-Suite (✅ 8/8 bestanden):**
1. HW-Spread E/U ≤ 1 (6-Tage) → ✅
2. BF-Rotation Diff ≤ 2 (6-Tage) → ✅
3. Keine 2-in-Folge Verstöße → ✅
4. Boot außer Dienst → BF zu Turm → ✅
5. D&D dragSrc.slot = 0 (nicht null) → ✅
6. Keine Doppel-Einteilungen → ✅
7. HW-Spread ≤ 2 (14-Tage) → ✅
8. Fuzz-Test 10/10 Szenarien → ✅

**Bewährte Test-Szenarien:** baseline 6d · 14d · 1d · kranke Personen · geschlossener Turm/Boot · Boot außer Dienst · 0 Personen · 1 Person · alle krank · alle Türme zu · Zwangszuweisung effektiv/transparent · **Fuzz-Test** (100× zufällige sick/closed/forced-Muster).

**Konsekutiv-Regel-Messung:** Verstöße/Gelegenheiten zählen → normal 0%, unter Extremdruck ~2,4%.

**Performance-Baseline:** ~20 ms für 28 Personen × 14 Tage (Maximalszenario). Bei Regressionen >100 ms: Hot-Loop in `bestPair` (O(n²) über Guard-Pool pro Turm) prüfen.

**Preview starten:** `.claude/launch.json` Server „wachplan" (Port 3000), dann `/Wachplan-Generator.html`. localStorage-Key `dlrg_wachplan_autosave` vor Tests löschen für sauberen Seed.

---

## Authentication & Encryption (Phase 2-4: New)

### Architecture Overview

**Multi-User System mit Encryption-at-Rest:**
- Session-basierte Authentifizierung (HTTPOnly Cookies, 7 Tage TTL)
- Pro-User verschlüsselte Plandaten (AES-256-GCM)
- Admin-Panel für User-Management
- Fallback-Import für alte localStorage-Pläne

### Database Schema (SQLite)

**users** – User-Accounts
```sql
id INTEGER PRIMARY KEY
username TEXT UNIQUE NOT NULL      -- Login-Name
password_hash TEXT NOT NULL        -- bcryptjs (10 Rounds)
email TEXT                         -- Optional
is_admin BOOLEAN DEFAULT 0         -- Admin-Rechte
created_at DATETIME DEFAULT NOW
updated_at DATETIME DEFAULT NOW
```

**plans** – Verschlüsselte Wachpläne
```sql
id INTEGER PRIMARY KEY
user_id INTEGER NOT NULL           -- FK: users.id (CASCADE)
name TEXT DEFAULT 'Wachplan'       -- Plan-Name
encrypted_state BLOB NOT NULL      -- AES-256-GCM cipher
iv BLOB NOT NULL                   -- Initialization Vector (16 Bytes)
auth_tag BLOB NOT NULL             -- Authentication Tag (16 Bytes)
created_at DATETIME DEFAULT NOW
updated_at DATETIME DEFAULT NOW
```

**sessions** – Express-Session Store
```sql
sid TEXT PRIMARY KEY               -- Session ID
sess TEXT NOT NULL                 -- Serialized session data
expire DATETIME NOT NULL           -- Session expiration
```

### Encryption Details

**Key Derivation (PBKDF2):**
```javascript
key = PBKDF2(
  password: userId + MASTER_SECRET,
  salt: SALT,
  iterations: 100000,
  keyLen: 32 bytes,
  digest: sha256
)
```

**Cipher (AES-256-GCM):**
```
- Algorithm: AES-256-GCM (Authenticated Encryption)
- IV: 16 random bytes (generated per plan)
- Auth Tag: 16 bytes (prevents tampering)
- Ciphertext: Encrypted JSON state
```

**Why AES-256-GCM:**
- ✅ Authenticated Encryption (prevents MITM)
- ✅ Industry standard (NIST recommended)
- ✅ No padding oracle attacks (built-in auth)
- ✅ Fast on modern CPUs

### API Endpoints

#### Authentication (Public)
```
POST   /api/auth/login    – { username, password } → { userId, username, isAdmin }
POST   /api/auth/logout   – Destroys session
GET    /api/auth/me       – Returns current user or 401
POST   /api/auth/init     – { username, password } → Create first admin
```

#### Plans (Authenticated)
```
GET    /api/plans         – List user's plans
POST   /api/plans         – { name, state } → Create encrypted plan
GET    /api/plans/:id     – Decrypt & return plan
PUT    /api/plans/:id     – { state, name } → Update & re-encrypt
DELETE /api/plans/:id     – Delete plan
```

#### Import (Authenticated)
```
POST   /api/import/plans  – { plans: [ { name, state } ] } → Bulk import
```

#### Admin (Admin-only, Authenticated)
```
GET    /api/admin/users   – List all users
POST   /api/admin/users   – { username, password, email, isAdmin } → Create user
DELETE /api/admin/users/:id – Delete user (cascade plans)
```

### Frontend Integration

**state-io.js – Server Sync statt localStorage**
```javascript
// OLD: autoSave() → localStorage.setItem()
// NEW: autoSave() → PUT /api/plans/:id (with retry fallback)

async autoSave() {
  if (!currentPlanId) {
    // Create new plan: POST /api/plans
    const { id } = await fetch('/api/plans', { method: 'POST', body: state });
    currentPlanId = id;
  } else {
    // Update existing: PUT /api/plans/:id
    await fetch(`/api/plans/${currentPlanId}`, { method: 'PUT', body: state });
  }
  // Fallback: localStorage wenn Server unreachable
}
```

**login-modal.js – Authentication UI**
- Prüft Authentifizierung bei Page-Load via GET /api/auth/me
- Zeigt Login-Modal wenn nicht authentifiziert
- POST /api/auth/login mit Username/Passwort
- Ruft initAfterAuth() nach erfolgreichem Login

**user-info.js – User-Management UI**
- User-Info Header mit Benutzernamen & Logout Button
- Admin-Panel Link (nur für Admins sichtbar)
- Plan-Import Button für alte .json-Dateien
- Logout Handler

**admin.html – Admin-Panel**
- User-Liste (Name, Email, Rolle, Erstellt-am)
- Create Form (Username, Passwort, Email, Admin-Flag)
- Delete Button pro User (mit Cascade auf Plans)
- Nur für Admin-User zugänglich (403 sonst)

### Security Considerations

**In Scope (Implementiert):**
- ✅ bcryptjs Passwort-Hashing (10 Rounds)
- ✅ AES-256-GCM Encryption at rest
- ✅ PBKDF2 Key Derivation (100k iterations)
- ✅ HTTPOnly Cookies (CSRF-proof)
- ✅ Per-User Encryption Keys
- ✅ Session TTL (7 days)
- ✅ Non-root Docker User

**Out of Scope (Später):**
- Rate Limiting (add later with `express-ratelimit`)
- CSRF Tokens (HTTPOnly cookies ausreichend)
- 2FA (optional, use TOTP library)
- Password Reset (email integration needed)

### Deployment

**Docker:**
```bash
docker-compose up -d
# Generiere Secrets:
openssl rand -base64 32  # MASTER_SECRET
openssl rand -base64 16  # SALT
openssl rand -base64 32  # SESSION_SECRET
# Ersetze in .env
```

**Environment-Variablen:**
```
NODE_ENV=production
PORT=3000
HOST=0.0.0.0
MASTER_SECRET=<random-base64-32>
SALT=<random-base64-16>
SESSION_SECRET=<random-base64-32>
```

**Volumes:**
- `wachplan-data:/app/data` – Persistent SQLite DB + Sessions

**Health Check:**
```
GET /health → { status: "ok", timestamp: "..." }
```

### Testing Checklist

- [ ] Login mit falschen Credentials → 401
- [ ] Login mit korrekten Credentials → Session erstellt
- [ ] Plan erstellen → Verschlüsselt in DB
- [ ] Plan laden → Dekryptiert korrekt
- [ ] Plan bearbeiten → Re-encrypted mit neuem IV/Tag
- [ ] Admin-Panel → Nur für Admins zugänglich (403)
- [ ] User erstellen → Passwort gehasht
- [ ] User löschen → Cascade auf Plans
- [ ] Plan-Import → Alte .json geladen & verschlüsselt
- [ ] Logout → Session zerstört, /api/auth/me → 401

### Known Limitations

- Max. 1000 concurrent users (SQLite limit)
- Keine Cloud-Storage Integration (lokal nur)
- Keine End-to-End Encryption (Client↔Client unencrypted)
- Sessions nicht cluster-repliziert (single-instance only)
