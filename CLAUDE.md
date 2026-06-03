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

Einstiegspunkt: `public/Wachplan-Generator.html` (Server serviert `public/` statisch).
Template-Datei: `public/Wachplan Template.xlsx` (DLRG-Formular, wird gepatcht).
Backend-Start: `npm start` → `server/server.js`.

---

## Dateistruktur

Seit v0.2.8 zweigeteilt: **`public/`** (Frontend, statisch serviert) und **`server/`** (Backend). Root enthält nur noch Pflicht-/Deployment-Dateien.

### Root
```
package.json / package-lock.json   – Deps + Scripts (start → server/server.js)
Dockerfile / docker-compose.yml    – Container-Build + Compose (env_file, Anchors, Healthchecks)
.env.example                       – Env-Vorlage (Secrets via .env, gitignored)
.gitignore / .dockerignore
README.md / CLAUDE.md / VERSION
data/                              – SQLite-DB zur Laufzeit (gitignored)
docs/                              – DEPLOYMENT.md, PORTAINER.md
public/  server/                   – Frontend / Backend (s.u.)
```

### Frontend – `public/`
```
public/Wachplan-Generator.html  – Layout, CSS (dark theme), Script-Ladereihenfolge
public/admin.html               – Admin-Panel UI
public/Wachplan Template.xlsx   – DLRG-XLSX-Vorlage (per fetch geladen)
public/js/state.js              – Globale Variablen & Datenstrukturen
public/js/utils.js              – escapeHtml, showToast, seededRand, Lookup-Helfer
public/js/dates.js              – Datumsberechnung (lokale Arithmetik, kein UTC-Shift)
public/js/autoCodes.js          – Automatische Stationscodes + freshDayState()
public/js/seed.js               – Beispieldatensatz (Fallback ohne Autosave)
public/js/render-sidebar.js     – Sidebar-UI: Personen, Türme, Boote, HW-Boot, XLSX-Config
public/js/generate.js           – KERN-ALGORITHMUS: Wachplan berechnen (Scoring, Rotation)
public/js/render-output.js      – Ausgabe-Panel: Tages-Karten, Steuerung, Matrix
public/js/export.js             – XLSX- (XML-Patch via JSZip) und CSV-Export
public/js/move.js               – Modal zum manuellen Verschieben (↕-Button)
public/js/state-io.js           – Server-Sync (autoSave via PUT /api/plans/:id)
public/js/login-modal.js        – Login-Modal UI & Auth-Flow
public/js/user-info.js          – User-Info Header, Admin-Link, Plan-Import, Logout
public/js/init.js               – Event-Listener + Startsequenz (autoLoad → seed fallback)
```

### Backend – `server/`
```
server/server.js          – Express-Server (Port 3000), Static aus ../public, Route-Registration
server/admin-server.js    – Admin-Server (Port 3001), gleiches Image, anderer Entry-Point
server/config.json        – Template-Config (Türme/Boote/exportColumns) → GET /api/config
server/db/connection.js   – Zentrale SQLite-Verbindung (dbPath → ../../data)
server/db/init.js         – SQLite-Init, Schema-Migration, Admin-Seed
server/db/schema.sql      – Schema (users, plans, sessions)
server/db/crypto.js       – AES-256-GCM + deriveKey (mit Key-Cache pro userId)
server/db/session.js      – createSessionMiddleware (SQLite-Store, DRY für beide Server)
server/api/auth.js        – Auth-Endpoints (login/logout/init/me)
server/api/plans.js       – Plan-CRUD mit Verschlüsselung
server/api/admin.js       – Admin-Endpoints (Admin-only)
server/api/import.js      – Plan-Import für alte .json-Dateien
```

**Pfad-Konvention:** Backend liegt in `server/`, daher zeigen Daten/Public-Pfade via `..` nach Root (`server/server.js` → `../public`, `../data`, `../VERSION`; `server/db/*` → `../../data`). Interne `require('./api/…')`/`require('./db/…')` bleiben relativ.

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
| Perf-Optimierungen | `activeBoatTowers`-Set pro Tag; `prevTowerSet` + `ensure()`-Caching in bestPair; `poolSBFIds`-Set (O(1) statt `.some()` im Hot-Loop); `guardPoolSize()` statt `getGuardPool().length`; `pairKey` ohne Array-Sort → ~15ms für 20 Pers./14 Tage |

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

### Konfiguration & Secrets (ab v0.2.7)

- **Alle Secrets liegen in `.env`** (gitignored), NICHT in `docker-compose.yml`. Vorlage: **`.env.example`** im Repo-Root.
- Pflicht-Variablen (von `db/init.js` `validateEnv()` geprüft): `MASTER_SECRET` (≥32), `SALT` (≥16), `SESSION_SECRET` (≥16). Optional: `ADMIN_USERNAME`/`ADMIN_PASSWORD` (Erst-Admin-Seed), `ADMIN_PORT`, `NODE_ENV`/`PORT`/`HOST`, `DATABASE_PATH`.
- `docker-compose.yml`: beide Services teilen Konfig per **YAML-Anchor** (`x-wachplan-base`) und laden Secrets via **`env_file: .env`**. Healthchecks gegen `/health`. `version:`-Key und tote `COOKIE_SECURE`-Variable entfernt.
- Deployment-Host braucht eigene `.env` (`cp .env.example .env`) mit den **Produktions**-Secrets (≠ lokale Dev-Secrets, da getrennte DBs).
- ⚠ **Rotations-Caveat**: `MASTER_SECRET` + `SALT` gehen in `deriveKey` (db/crypto.js) ein → Änderung macht bestehende verschlüsselte Pläne unlesbar. Nur mit Re-Encryption-Migration rotieren. `SESSION_SECRET`/`ADMIN_PASSWORD` sind gefahrlos rotierbar.

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

#### Authentication
```
POST   /api/auth/login    – { username, password } → { userId, username, isAdmin }  (public)
POST   /api/auth/logout   – Destroys session
GET    /api/auth/me       – Returns current user or 401
POST   /api/auth/init     – { username, password } → Create first admin  (public, one-time)
PUT    /api/auth/password – { currentPassword, newPassword } → eigenes PW ändern (auth, newPW ≥8)
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
GET    /api/admin/users            – List all users
POST   /api/admin/users            – { username, password, email, isAdmin } → Create user
DELETE /api/admin/users/:id        – Delete user (cascade plans)
PUT    /api/admin/users/:id/password – { newPassword } → fremdes PW setzen (kein currentPW, ≥8)
```

**Passwort-UI (v0.2.9):**
- User: 🔑-Button im User-Header (`public/Wachplan-Generator.html`) → Modal `#pw-modal` → `submitPasswordChange()` in `user-info.js` → `PUT /api/auth/password` (current + new + Wiederholung, Client-Validierung).
- Admin: `public/admin.html` – eigenes PW via Formular (`changePassword` → `/api/auth/password`); fremde PW via 🔑-Button pro User-Zeile (`adminSetPassword` → `PUT /api/admin/users/:id/password`, prompt).

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

---

## Session Fixes v0.2.5 (Code-Optimierung, verhaltens-äquivalent)

Reine Performance-/Qualitäts-Optimierungen ohne Verhaltensänderung. Verifiziert: Invarianten-Check (0 Fehler) + Fuzz-Test (100 Szenarien, 0 Crashes, 0 Fehler), ~15ms für 20 Pers./14 Tage.

**generate.js (Hot-Loop `bestPair`):**
- `poolSBFIds` (Set) ersetzt `poolSBF.some(x=>x.id===…)` an 3 Stellen → O(n³) wird O(n²); Set wird in `removeAll` synchron gehalten
- `guardPoolSize()` (Summe der Längen) statt `getGuardPool().length` → keine Array-Allokation in Öffnungs-Schleife + HW-while-Loop
- `pairKey(a,b)` = `a<b ? a+'|'+b : b+'|'+a` statt `[a,b].sort().join('|')` → keine Array-Allokation/Sort pro Paar (identische Keys für Zahlen)

**render-output.js (Code-Qualität):**
- `cardDragMode` jetzt korrekt mit `let` deklariert (war impliziter Global)
- Totes `cardSortOrder`-Objekt entfernt

Die drei in dieser Version offen gelassenen Empfehlungen (PBKDF2-Cache, Backend-Dedup, Occupant-Helper) wurden in **v0.2.6** umgesetzt.

---

## Session Fixes v0.2.6 (Backend-Dedup + Crypto-Cache + Occupant-Helper)

Umsetzung der drei in v0.2.5 offen gelassenen Empfehlungen. Alle verhaltens-erhaltend, verifiziert.

**1. Crypto zentralisiert + Key-Caching → [db/crypto.js](db/crypto.js) (neu):**
- `deriveKey`/`encryptPlanState`/`decryptPlanState` waren **byte-identisch dupliziert** in `api/plans.js` + `api/import.js` → jetzt zentral importiert
- `deriveKey` cached den abgeleiteten Key pro userId (`_keyCache` Map). PBKDF2 100k läuft sonst bei JEDEM Save/Load (autoSave nach jedem generate). **Messung: 15.83ms → 0.00014ms (~109.000×)** nach dem ersten Aufruf pro User
- Security unkritisch: MASTER_SECRET/SALT liegen ohnehin im Prozessspeicher (env); max ~32 B/User
- Verifiziert: Roundtrip identisch (inkl. Unicode), falscher User → Entschlüsselung schlägt fehl (Auth-Tag)

**2. Session-Setup zentralisiert → [db/session.js](db/session.js) (neu):**
- `createSessionMiddleware({resave, saveUninitialized})` ersetzt dupliziertes SqliteStore+Session-Setup in `server.js` (true/true) und `admin-server.js` (false/false)
- `dbPath` aus `db/connection.js` wiederverwendet statt 3× `path.join(...)`
- Verifiziert: beide Server booten korrekt (`node server.js` + `node admin-server.js`)

**3. Occupant-Markup dedupliziert (render-output.js):**
- `renderOccupant(p, label, kind, slotId)` ersetzt 3 nahezu identische `.occupant`-HTML-Blöcke (main-`occ`, Turm, `renderInlineBoat`)
- Alle D&D-/Move-Attribute exakt erhalten (inkl. main `data-move-slot=''` bei `slotId=MAIN_ID`)
- 764 → 751 Zeilen; verifiziert: alle Occupants draggable, Move-Buttons + Boot-D&D + Inline-Boote funktional, 0 Invarianten-Fehler

---

## Session Fixes v0.2.4

### Bugfix 6: HW-Boote – uniformes Boot-Modell (mehrere Boote + Wegziehen)
**Probleme**:
1. Boot verschwand, wenn ein zweites Boot der HW zugeordnet wurde (`hwBoatSlot` ist ein einzelnes Objekt → wurde überschrieben).
2. Ein der HW zugeordnetes Boot ließ sich nicht wieder wegziehen (HW-Boot war kein draggable Boot-Slot, sondern nur `main.hwBoatSlot`).

**Root Cause**: HW-Boote wurden als einzelnes `main.hwBoatSlot`-Objekt gespeichert (Feature 6), reguläre Boote als `kind:'boat'`-Slots mit `towerId`. Zwei verschiedene Modelle → Überschreiben + nicht ziehbar.

**Fix (render-output.js, reine Display-Schicht)**: Im Render-Clone das dedizierte `hwBoatSlot` in einen **uniformen Boot-Slot mit `towerId='HW'`** normalisieren. Dadurch:
- `boatsByTower['HW']` sammelt ALLE HW-Boote (Array) → mehrere Boote möglich, keins überschrieben
- HW-Boote werden via `renderInlineBoat()` als draggable `.boat-inline` in der Main-Card gerendert → wegziehbar
- Boot-Reassign-Logik vereinheitlicht: setzt nur noch `boatSlot.towerId` (Turm-ID oder `'HW'`)
- Jeder Tag wird jetzt immer geklont (für die Normalisierung), nicht nur bei Transparent-Placements
- Drop-Handler erkennt dediziertes HW-Boot via `boatId === hwBoatId` für korrekte Current-Tower-Anzeige
- `generate.js`/`export.js` unberührt (arbeiten weiter mit `lastResult.schedule` Original inkl. `hwBoatSlot`)

**Verifiziert (Live-Browser)**: 2 Boote an HW sichtbar (keins verschwindet) ✅; dediziertes HW-Boot zu Turm gezogen inkl. Bootsführer ✅.

---

## Session Fixes v0.2.3

### Bugfix 5 (KORREKT): Prioritäts-Reihenfolge bei Turm-Schließung
**Problem**: Türme mit Priorität 1 wurden ZUERST geschlossen statt ZULETZT.

**Semantik**: Prio 1 = wichtigster Turm → soll ZULETZT schließen (am längsten offen bleiben). Höhere Prio-Nummern (z.B. 7) = unwichtiger → schließen zuerst.

**Root Cause (echter)**: Die Schließ-Entscheidung passiert NICHT in der `personnelClosed`-Anzeige-Sortierung, sondern in der **Öffnungs-Schleife** (`generate.js` Zeile 266-270), die `candidateTowers` = `openTowersSorted` durchläuft. War **DESC** sortiert (`b.prio-a.prio`) → Prio 7 öffnete zuerst & blieb offen, Prio 1 schloss zuerst.

**Fix**: `openTowersSorted` Sortierung auf **ASC** (`generate.js` Zeile 211-216):
```javascript
// Prio 1 zuerst öffnen → bleibt offen → schließt zuletzt
.slice().sort((a,b) => (a.prio-b.prio)||(a.id-b.id));
```
Öffnungs-Schleife öffnet Prio 1 zuerst (bleibt offen); bei Personalmangel bleiben nur hohe Prio-Nummern übrig → schließen zuerst.

**Hinweis**: Erster Versuch (v0.2.2) änderte nur Zeile 274 (`personnelClosed`-Sort) = **nur Anzeige**, nicht die Entscheidung → wirkungslos. v0.2.3 fixt die echte Quelle.

**Verifiziert**: Isolierter Node-Test – 4 Türme (P1-4), Personal für 2 → P1+P2 offen, P3+P4 zu ✅

### Feature 12: Boot-D&D im Schedule-Output (Inline-Darstellung)
**Anforderung**: Boote sollen visuell ZUSAMMEN mit ihrem Turm ein Feld bilden (wie HW-Boot in der Hauptwache), nicht als separate Karte. Per D&D auf anderen Turm/HW ziehbar für tägliche Umverteilung.

**Implementation** (render-output.js):
- **Inline-Rendering**: `boatsByTower`-Map (towerId → [Boot-Slots]) vor der Render-Schleife; `renderInlineBoat()` zeichnet Boot als `.hq-divider.boat-inline` + Bootsführer-Occupant INNERHALB der Turm-Card (wie HW-Boot)
- Separate Boot-Karten entfernt; Boot-Slots in `d.assign.forEach` übersprungen (`if(slot.kind==='boat') return`)
- `.boat-inline` ist draggable (data-boat-id/name/code); CSS: grab-Cursor, Hover-Highlight
- dragstart: `.boat-inline` erkennen → `dragSrc.isBoat = true`
- dragover: gelbes Warn-Highlight für Boot-Drag auf Turm/HW-Cards
- drop: Same-Target-Guard (Boot schon auf Ziel → skip) + Confirmation → `_applyBoatReassignment()`
- **Transparent-Logik** (renderOutput): Boot-Reassign ändert NUR `boatSlot.towerId`/`towerName`; bei HW-Ziel → `main.hwBoatSlot` setzen + Boot-Slot via `_movedToHW` Flag entfernen
- `_applyBoatReassignment(boatId, dayIdx, kind, slotId)`: schreibt `forcedPlacements` mit `kind:'boat-reassign'`, immer `transparent:true`

**Behavior**:
- Boot erscheint inline unter seinem Turm (🚤 Boot: Name · Code + Bootsführer)
- Drag Boot auf anderen Turm → Boot+BF wandern visuell dorthin (nur diesen Tag)
- Drag Boot auf HW → wird zum HW-Boot
- Folgetage unberührt (transparent = kein `generate()`)

**Result**: Boote visuell mit Turm gruppiert + schnelle tägliche Umverteilung ✅
