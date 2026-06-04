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
public/js/share.js              – Plan-Teilen-Modal (👥)
public/js/realtime.js           – Live-Update-Client (WebSocket)
public/js/plans-ui.js           – Plan-Manager (📋 Meine Pläne)
public/js/init.js               – Event-Listener + Startsequenz (autoLoad → seed fallback)
```

### Backend – `server/`
```
server/server.js          – Express-Server (Port 3000), Static aus ../public, Route-Registration
server/admin-server.js    – Admin-Server (Port 3001), gleiches Image, anderer Entry-Point
server/realtime.js        – WebSocket-Server (setupRealtime, broadcastPlanUpdate)
server/config.json        – Template-Config (Türme/Boote/exportColumns) → GET /api/config
server/db/connection.js   – Zentrale SQLite-Verbindung (dbPath → ../../data)
server/db/init.js         – SQLite-Init, Schema-Migration, Admin-Seed
server/db/schema.sql      – Schema (users, plans, plan_shares, sessions)
server/db/crypto.js       – AES-256-GCM + deriveKey (mit Key-Cache pro userId)
server/db/session.js      – createSessionMiddleware (SQLite-Store, DRY für beide Server)
server/db/access.js       – getPlanAccess() zentral (Owner/Share-Prüfung)
server/api/auth.js        – Auth-Endpoints (login/logout/init/me/password)
server/api/plans.js       – Plan-CRUD mit Verschlüsselung + Sharing
server/api/admin.js       – Admin-Endpoints (Admin-only)
server/api/import.js      – Plan-Import für alte .json-Dateien
```

**Pfad-Konvention:** Backend liegt in `server/`, daher zeigen Daten/Public-Pfade via `..` nach Root (`server/server.js` → `../public`, `../data`, `../VERSION`; `server/db/*` → `../../data`). Interne `require('./api/…')`/`require('./db/…')` bleiben relativ.

**Script-Ladereihenfolge beachten:** state → utils → dates → autoCodes → seed → render-sidebar → generate → render-output → export → move → state-io → user-info → share → realtime → plans-ui → login-modal → init

---

## Globaler Zustand (state.js)

```js
people[]           // { id, name, role:'F'|'B'|'E'|'U', bfLevel?:'E'|'U' } (bfLevel nur wenn role='B')
towers[]           // { id, name, prio:number, code:string, slotCount:number (Default 2, 1–10), leaderCount:number (Default 0, 0–3) }
boats[]            // { id, name, code, towerId:number|'HW'|null, prio, slotCount:number (Default 1, 1–3) }
dayState[]         // Array[DAYS]: { sick:Set, closed:Set, closedBoats:Set }
forcedPlacements[] // Array[DAYS]: [{ personId, kind:'tower'|'boat'|'main'|'hwboat'|'boat-reassign', slotId, transparent:bool }]
positionDescriptions // { 3:'', 4:'', 5:'', 6:'', 7:'' } → XLSX-Zellen C11,C13,C15,C17,C19
fairnessMetricsDisplay // { hwBoatBalance:bool, towerDistribution:bool, boatPairingDiversity:bool }
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

### Fairness-Tracking pro Person
- `total` – Gesamteinsätze (Türme + Boot + aktive HW-Slots)
- `towerVisits` – Turmbesuche pro Turm-ID
- `boatVisits` – Bootseinsätze pro Boot-ID
- `hwVisits` – Tage an der Hauptwache (inkl. Overflow; HW-Overflow-Personen zählen mit!)
- `towerWithBoatDays` – Tage auf Turm mit aktivem Boot
- `boatCaptainPairings` – Häufigkeit (Captain-ID → Count) mit bestimmtem Bootsführer zusammen

### BF-Aufteilung
- `activeBF` = Bootsführer die für Boote/HW-Boot gebraucht werden
- `surplusBF` = übrige BF, landen an Türmen/HW
- `availB` wird VOR dem activeBF/surplusBF-Split nach `(boatDays*50 - hwVisits*10)` sortiert → faire BF-Rotation
- surplusBF bekommen +800 Penalty wenn sie in Turm mit **aktivem** Boot landen würden
- surplusBF bekommen -350 Bonus wenn Turm-Boot **außer Dienst** → 1150 Punkte Swing stellt sicher, dass BF bei deaktiviertem Boot zum richtigen Turm geht

### Zwangszuweisungen (forcedPlacements)
- `transparent: false` (effektiv) → Person aus Pool entfernen, fest vorab platzieren, Statistik zählt mit → Folgetage berücksichtigen den Wechsel
- `transparent: true` → Person bleibt im Pool, Algorithmus läuft normal, danach **nur visuell** in Zielslot verschoben → Folgetage identisch zum Originalplan

### `bestPair(tower, requireMix, currentDay)` – Scoring
```
+ 1000  beide Unerfahren (UU) + requireMix=true  → Notlösung
+ 40    beide Erfahren (EE) + requireMix=true
+ 120×  bisherige gemeinsame Turmdienste (Paar-Wiederholung vermeiden)
+ 30×v  Turmbesuche Person A (v≥2 → +300)
+ 30×v  Turmbesuche Person B (v≥2 → +300)
+ 5×    Gesamteinsätze (Fairness: wer wenig hatte, kommt zuerst)
+ 800   surplusBF-Strafe (Turm mit aktivem Boot)
- 350   surplusBF-Bonus (Turm mit deaktiviertem Boot)
+ 200×  konsekutive Tage auf gleichen Turm (+200/Person wenn Vortag selber Turm)
+ 150   beide haben viele Boot-Tage (Tower+Boat balance)
- 60×   hwVisits (proportionaler Bonus für Tower-Zuweisung)
- 100   Führungskraft (role='F') wenn Tower leaderCount > 0
+ 60×   hwVisits (HW-k-Slots: Strafe für erneute HW-Zuweisung)
+ Tiebreaker (deterministisch oder seededRand() für Tag 1)
```
**Niedrigster Score gewinnt.**

### Zuweisung pro Tag (Reihenfolge)
0. **BF-Fairness-Sort** – `availB` nach `(boatDays*50 - hwVisits*10)` sortieren VOR activeBF/surplusBF-Split
1. **Hauptwache** – Zwangszuweisungen → Paare via bestPair → Einzelpersonen
2. **Türme** – je `slotCount + leaderCount` Wachgänger via bestPair(t, true), Türme nach prio **ASC** sortiert (Prio 1 = wichtigster, öffnet zuerst)
3. **Boote** – je 1 BF pro aktives Boot, sortiert nach Gesamteinsätzen + Boot-Rotation
4. **HW-Boot** – dedizierter BF wenn `hwBoatId` aktiv (gleiche Sortierung)
5. **Boot-Captain-Paarungen-Tracking** – registriere Turm-Personen × Captain
6. **HW finalize** – Zwangszuweisungen → verbleibende Personen + alle Overflow; alle in `main.base`/`poolB` bekommen `hwVisits++`
7. **Transparente Zuweisungen** anwenden (visueller Tausch nach dem Algorithmus)

**Prioritäts-Semantik:** Prio 1 = wichtigster Turm → öffnet zuerst, schließt zuletzt. Niedrig besetzte Tage → höhere Prio-Nummern schließen zuerst.

---

## Features

### Feature 5: BF-Schutz (surplusBF-Penalty)
Übrige Bootsführer (nicht auf Booten) sollen nicht an Türmen mit aktivem Boot stehen.
- +800 Penalty auf aktive-Boot-Türmen; -350 auf deaktivierten-Boot-Türmen → 1150 Swing sichert korrekte Zuweisung.

### Feature 6: HW-Boot
Dedizierter BF für das HW-Boot (`hwBoatId`). Wird separat von den regulären Boot-Zuweisungen vergeben.

### Feature 7: Erweiterte Fairness-Metriken
Stats-Bar zeigt `avgHwVisits | avgTowerWithBoatDays` (z.B. `0.9 | 0.9`) + Boot-Paarungen-Diversität %.
- Grün = ausgeglichen, Orange = Schieflage

### Feature 8: Konsekutive-Tage-Regel
`checkConsecutiveTowerPenalty(personA, personB, towerId, currentDay)` in `generate.js`:
- +200 Punkte pro Person wenn Vortag auf selben Turm → Personen verteilen sich über Türme
- Soft-Constraint: weicht bei knapper Besetzung (normal 0% Verstöße, Extremdruck ~2,4%)

### Feature 9: Metriken-Toggle
`fairnessMetricsDisplay`-Flags in `state.js` steuern, welche Metriken in der Stats-Bar sichtbar sind:
- `hwBoatBalance` / `towerDistribution` / `boatPairingDiversity`
- Checkboxes in Sidebar: `#metric-hw-balance`, `#metric-tower-dist`, `#metric-boat-pairing`
- `syncMetricCheckboxes()` synchronisiert Checkbox-Zustände nach State-Import

### Feature 10: Pro-Person Tower-Statistik
`renderTowerStatsPerPerson()` in `render-output.js`: Tabelle Person | Gesamt-Tage | Unique Türme | Details.
- Details: Turm-Namen + Besuchsanzahl, sortiert nach Prio
- Farb-Coding: Grün wenn ≥50% der Türme besucht, Orange sonst

### Feature 11: Seed-basierte Start-Konstellationen
`applySeedConstraints(seed)` in `init.js` (Seed-Input 0–999):
- `0` = Standard (kein Seed), `1–999` = deterministische Fisher-Yates Permutation der E/U + BF auf Tag 1
- Alle Seeds erzeugen identische Gesamtfairness über alle Tage (Balancierung durch Scoring auf Tag 2+)
- LCG: `rng = (rng * 1664525 + 1013904223) & 0x7fffffff`; EU mit `seed*1`, BF mit `seed*2`

### Feature 12: Pro-Turm Führungskräfte-Einstellung
- `leaderCount` pro Tower (0–3, Default 0) – zusätzlich zu `slotCount`
- Tower mit `slotCount=2, leaderCount=1` → 3 Personen total (1 F + 2 andere)
- Scoring: Führungskräfte bekommen -100 Bonus wenn Turm `leaderCount > 0` (soft scoring)
- UI: Spinner in Sidebar neben slotCount (Label 👔); Export/Import via `state-io.js`

### Feature 13: Bootsführer-Erfahrungslevel (BF-E vs BF-U)
- `bfLevel: 'E'|'U'` bei `people` mit `role='B'` (Default: `'E'`)
- **Turm-Pairing:** `getEffectiveRole()` in `bestPair()` → BF-E wie 'E', BF-U wie 'U' behandelt; verhindert zwei BF-U zusammen auf Turm (UU-Penalty)
- **Boot-Rotation:** bfLevel hat **keine** Auswirkung (faire Rotation für alle BF)
- UI: Conditional Dropdown (BF-E / BF-U) erscheint nur bei `role='B'`

### Feature 14: Konsolidiertes Single-Page Layout (Einstellungen & Wachplan)
Sidebar (Einstellungen) und Output-Panel (Wachplan) auf einer Seite nebeneinander.
- **Desktop (>1040px):** Sidebar 380px fest | Output-Panel flex-grow mit Grid-Layout
- **Tablet/Mobile (<1040px):** Gestapelte Anordnung (Sidebar über Output) mit je unabhängigem Scrolling
- Beide Panels scrollen unabhängig (kein synchronisiertes Scrolling)
- Print-Modus (`@media print`): Nur Output-Panel angezeigt, Sidebar ausgeblendet

---

## Manuelles Verschieben & Drag-and-Drop (move.js, render-output.js)

### Move-Modal (↕-Button)
- Erscheint bei hover auf `.occupant`
- `openMoveModal(personId, dayIdx, fromKind, fromSlotId)` → Dropdown aller validen Zielslots
- Checkbox **"Folgetage neu berechnen"** steuert `transparent`-Flag
- `_applyMove()` → schreibt in `forcedPlacements[dayIdx]`, ruft ggf. `generate()` auf
- `clearForced(personId, fromDay, scope)` → entfernt Fixierungen ('today' | 'forward')

### Personen-D&D
Personen direkt per Drag-and-Drop zwischen Slots verschieben:
- Rollenvalidierung: Nicht-Bootsführer zu Boot → Confirmation-Dialog
- Checkbox "Folgetage neu berechnen" im Confirmation-Dialog
- `showConfirmation(message, onConfirm, onCancel, showRecalcCheckbox)`
- **Wichtig:** `dragSrc` wird vor `showConfirmation()` in lokale Variablen gesichert (`srcPersonId`, `srcKind`, `srcSlot`), da `dragend` asynchron `dragSrc = null` setzt

### Boot-D&D (Inline-Darstellung)
Boote erscheinen **inline** unter ihrem Turm (nicht als separate Karten):
- `boatsByTower`-Map (towerId → [Boot-Slots]) vor der Render-Schleife
- `renderInlineBoat()` zeichnet Boot als `.hq-divider.boat-inline` + Bootsführer-Occupant in der Turm-Card
- Boote sind per D&D auf anderen Turm oder die HW ziehbar (nur aktueller Tag, transparent)
- `_applyBoatReassignment(boatId, dayIdx, kind, slotId)` → `forcedPlacements` mit `kind:'boat-reassign'`, immer `transparent:true`
- HW-Boot wird als `towerId='HW'` normalisiert und via `renderInlineBoat()` in der Main-Card angezeigt → mehrere HW-Boote möglich, keins überschreibt das andere

### Transparentes vs. effektives Verschieben
- **transparent=true (Case 1):** `generate()` wird NICHT aufgerufen; `renderOutput()` klont Schedule und wendet visuellen Swap an → Folgetage komplett unverändert
- **transparent=false (Case 2):** `generate()` aufgerufen; Tage VOR dem Änderungstag werden aus dem alten Schedule wiederhergestellt

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
- Zeile 21 + Stundendaten → via `effectiveCols`
- HW-Overflow → Personen 5+ (inkl. Kranke) in verbleibende Template-Spalten

### Overflow-Strategie & effektives Layout (`_patchSheetXml`)
`effectiveCols[]` wird beim Export berechnet, `exportColumns` bleibt unberührt:
1. Iteriere `exportColumns` der Reihe nach; leere Slots überspringen
2. Jede Station belegt eine Template-Spalte (primär: Personen 1–2)
3. Hat die Station >2 Personen → Überlauf-Paare belegen die **nächste** Template-Spalte direkt rechts (adjacent)
4. Nachfolgende Stationen rücken entsprechend nach rechts
5. Verbleibende Template-Spalten → HW-Overflow (Personen 5+, inkl. Kranke)

### `autoFillExportColumns()` – Reihenfolge
Pro Turm (Prio absteigend): erst zugeordnete Boote, dann Turm → Boot steht immer links von seinem Turm. Dann freie Boote, WF (→ WF2 nur wenn >2 Führungspersonen), HW (→ HW2 nur manuell hinzufügen falls nötig).

### `buildAssignments(dayIdx)` → `{ code: [Nr, ...] }`
- Türme: **alle** Besatzer (kein slice); Überlauf >2 → adjacent via `effectiveCols`
- HW: `mainGuards + base + bootsfLeft + sick` → WF/WF2 (Führung), HW (Rest inkl. Kranke), optional HW2

### Template-Caching
- **Auto-Load:** `fetch('Wachplan Template.xlsx')` beim Seitenstart
- **Caching:** Base64 in `localStorage` (Key: `dlrg_wachplan_template_b64`) für Offline-Verfügbarkeit
- Chunks: 9000 Bytes (Vielfaches von 3 → kein btoa-Padding-Problem)

---

## Autosave & State-IO (state-io.js)

- `autoSave()` – nach jeder `generate()`-Ausführung → Server-Sync (`PUT /api/plans/:id`); localStorage als Fallback
- `autoLoad()` – beim Seitenstart; bei Erfolg: silent import + generate + Toast
- `exportStateJSON()` / `importStateJSON()` – vollständiger Status als `.json`-Datei
- `_buildStateObject()` – zentrale Serialisierung (von autoSave UND exportStateJSON genutzt)
- Sets (sick/closed/closedBoats) werden als Arrays serialisiert, beim Import rekonstruiert
- `STATE_VERSION = 3` – fehlende Felder in alten Exports werden mit Defaults gefüllt
- `fetchPlansList` / `loadPlanById` / `createNewPlan` / `renameCurrentPlan` / `deletePlanById` – Plan-Manager-Funktionen

---

## Sidebar-Rendering (render-sidebar.js)

| Funktion | Was sie tut |
|---|---|
| `renderPeople()` | Personenliste neu zeichnen; beim Löschen: aus dayState.sick + forcedPlacements bereinigen |
| `renderTowerCfg()` | Turm-Zeilen (Name / CODE / PRIO / Slot-Spinner / Leader-Spinner / ×); Spinner ändert slotCount/leaderCount + generate(); beim Löschen: verknüpfte Boote trennen |
| `renderBoatCfg()` | Boot-Zeilen (Name / CODE / Turm-Dropdown / Slot-Spinner / ×); Spinner ändert slotCount (1–3) |
| `renderHWBoatSelector()` | Dropdown: welches Boot ist HW-Boot? |
| `autoFillExportColumns()` | Füllt exportColumns: Boote → Türme (Prio↓) → WF → WF2 → HW |
| `renderExportColumnUI()` | 16 Felder für manuelles Stationscode-Mapping (Drag & Drop per ⠿-Handle) |
| `renderPositionDescUI()` | 5 Felder für XLSX-Positionsbeschriftungen (Pos. 3–7) |

---

## Ausgabe-Rendering (render-output.js)

- `renderOutput()` – zeichnet gesamten Output-Bereich neu (innerHTML-Replace)
- Karten-Typen: `main` (gold, span-2), `tower` (normal, mit inline Booten), `closed` (ausgegraut)
- **Stats-Bar:** 4 feste Metriken (Paare, Wiederholungen, U+U, Turm>2×) + 3 optionale (via `fairnessMetricsDisplay`): 🏠 HW|Boot-Turm, 📍 Ø Türme, 👥 Boot-Paare-unique
- `renderTowerStatsPerPerson()` – Tabelle Person | Gesamt | Unique-Türme | Details
- `renderMatrix()` – Paarungs-Kreuztabelle aller E+U-Personen (grün=1×, rot≥2×); nur bei 2–18 E/U
- `renderOccupant(p, label, kind, slotId)` – dedupliziertes Occupant-Markup für main/tower/boat
- Event-Listener direkt in renderOutput() verdrahtet (Tabs, Chips, Move-Buttons, D&D)

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
| Faire Rotation | Akkumulierte stats (total, towerVisits, boatVisits, hwVisits) über alle Tage |
| BF-Fairness | `availB` vor activeBF/surplusBF-Split nach `(boatDays*50 - hwVisits*10)` sortieren |
| HW-Overflow-Tracking | `leftovers` + `poolB` bekommen nach HW-finalize `hwVisits++` |
| Konsekutiv-Regel | +200/Person Penalty wenn Vortag selber Turm; soft → weicht bei knapper Besetzung |
| BF-Schutz | +800 Penalty aktiver Boot-Turm; -350 deaktivierter Boot-Turm (1150 Swing) |
| Turm-Prio-Semantik | Prio 1 = wichtigster → ASC-Sort → öffnet zuerst, schließt zuletzt |
| Variable Slots | `slotCount` pro Turm (1–10) / Boot (1–3); `leaderCount` pro Turm (0–3) additiv |
| Seed-Konstellationen | Fisher-Yates LCG; alle Seeds → identische Gesamtfairness nach Ausbalancierung |
| UU-Warnung | +1000 wenn beide Unerfahren → nur als Notlösung |
| Transparenter Swap | Nur Darstellung überschreiben; kein generate() → Folgetage unverändert. **Achtung:** transparentes Verschieben auf vollen Turm zeigt `slotCount+1` Belegung (visueller Overlay) – Absicht |
| D&D dragSrc capture | srcPersonId/srcKind/srcSlot in lokale Vars VOR showConfirmation sichern (dragend nullt async) |
| Boot inline | Boote in Turm-Card via renderInlineBoat(); HW-Boot als towerId='HW' normalisiert |
| Kein Framework | Vanilla-JS; Re-Renders via komplettem innerHTML-Replace |
| XLSX-Integrität | XML-Patch statt SheetJS-Write → Styles/Bilder/Schutz erhalten |
| Timezone-Bug | Lokale Datumsarithmetik statt toISOString() → kein UTC-Off-by-one |
| Template-Auto-Load | fetch('Wachplan Template.xlsx') → localStorage cache (kein Nutzer-Upload) |
| `personNr()` | NUR in utils.js definiert (utils lädt vor export) – nicht duplizieren |
| Crypto Key-Caching | PBKDF2 100k Iterationen werden pro userId gecacht (~109.000× schneller ab 2. Aufruf) |
| Session-Setup DRY | `createSessionMiddleware()` in db/session.js für beide Server-Entry-Points |
| Perf-Optimierungen | `poolSBFIds`-Set (O(1)); `guardPoolSize()`; `pairKey` ohne Array-Sort → ~15ms für 20 Pers./14 Tage |

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
- Transparentes Verschieben auf vollen Turm → Overflow-Darstellung (Export verarbeitet zu Nachbarspalte)
- Max. ~1000 concurrent users (SQLite limit)

---

## Testing & Performance

**Test-Strategie:** Browser-Preview + `preview_eval`-Harness statt Unit-Tests (kein Build-Setup nötig).

**Invarianten-Validator** (via eval im Page-Context) prüft nach jedem `generate()`:
- Keine Person doppelt eingeteilt am selben Tag
- Keine kranke Person eingeteilt
- Kein geschlossener Turm / außer-Dienst-Boot belegt
- `slotCount` eingehalten (Ausnahme: transparenter Overlay)

**Bewährte Test-Szenarien:** baseline 6d · 14d · 1d · kranke Personen · geschlossener Turm/Boot · Boot außer Dienst · 0/1 Personen · alle krank · alle Türme zu · Zwangszuweisung effektiv/transparent · Fuzz-Test (100× zufällige sick/closed/forced-Muster).

**Konsekutiv-Regel-Messung:** Verstöße/Gelegenheiten zählen → normal 0%, unter Extremdruck ~2,4%.

**Performance-Baseline:** ~20 ms für 28 Personen × 14 Tage. Bei Regressionen >100 ms: Hot-Loop in `bestPair` (O(n²) über Guard-Pool pro Turm) prüfen.

**Preview starten:** `.claude/launch.json` Server „wachplan" (Port 3000), dann `/Wachplan-Generator.html`. localStorage-Key `dlrg_wachplan_autosave` vor Tests löschen für sauberen Seed.

---

## Authentication & Encryption

### Übersicht

**Multi-User System mit Encryption-at-Rest:**
- Session-basierte Authentifizierung (HTTPOnly Cookies, 7 Tage TTL, `sameSite:lax`)
- Pro-User verschlüsselte Plandaten (AES-256-GCM)
- Admin-Panel für User-Management (`/admin.html`, Port 3001)
- Fallback-Import für alte localStorage-Pläne

### Sicherheitsmaßnahmen (implementiert)
- ✅ bcryptjs Passwort-Hashing (10 Rounds)
- ✅ AES-256-GCM Encryption at rest (NIST-Standard, Authenticated Encryption)
- ✅ PBKDF2 Key Derivation (100k iterations, SHA-256, pro userId gecacht)
- ✅ HTTPOnly Cookies (CSRF-Grundschutz via `sameSite:lax`)
- ✅ Per-User Encryption Keys
- ✅ In-Memory Rate-Limit Login (10 Versuche / 15 min → 429, `auth.js`)
- ✅ Session-Fixation-Schutz (`req.session.regenerate()` nach Login)
- ✅ Security-Header: `X-Content-Type-Options:nosniff`, `X-Frame-Options:SAMEORIGIN`, `Referrer-Policy:same-origin`
- ✅ SQL durchgehend parametrisiert (keine Injection)
- ✅ `getPlanAccess()` zentralisiert in `db/access.js` (Owner/Share, kein IDOR)
- ✅ Non-root Docker User
- ✅ XSS-Schutz: alle User-Inputs via `escapeHtml()` oder `textContent`

**Empfehlungen (Infra):**
- Cookie `secure:true` + `trust proxy` in Produktion aktivieren (bei TLS-terminierendem Proxy)
- `MASTER_SECRET` + `SALT` nur mit Re-Encryption-Migration rotieren (gehen in `deriveKey` ein → Änderung macht bestehende Pläne unlesbar)
- Optional: CSP-Header (derzeit fehlt wegen Inline-Styles in admin.html)

### Konfiguration & Secrets

Alle Secrets in `.env` (gitignored). Vorlage: `.env.example`.

**Pflicht-Variablen** (von `db/init.js` `validateEnv()` geprüft):
- `MASTER_SECRET` (≥32), `SALT` (≥16), `SESSION_SECRET` (≥16)

**Optional:** `ADMIN_USERNAME`/`ADMIN_PASSWORD`, `ADMIN_PORT`, `NODE_ENV`/`PORT`/`HOST`, `DATABASE_PATH`

`docker-compose.yml`: beide Services teilen Konfig per YAML-Anchor (`x-wachplan-base`) + `env_file: .env`.

### Database Schema (SQLite)

**users:** `id, username (UNIQUE), password_hash, email, is_admin, created_at, updated_at`

**plans:** `id, user_id (FK CASCADE), name, encrypted_state (BLOB), iv (BLOB), auth_tag (BLOB), created_at, updated_at`

**plan_shares:** `plan_id, user_id, role ('edit'|'view')`

**sessions:** `sid, sess, expire`

### Encryption Details

**Key Derivation (PBKDF2):**
```javascript
key = PBKDF2(password: userId + MASTER_SECRET, salt: SALT, iterations: 100000, keyLen: 32, digest: 'sha256')
```

Verschlüsselung immer mit dem **Owner-Key** (`plans.user_id`), auch bei geteilten Plänen → kein Re-Encrypt beim Teilen.

### API Endpoints

#### Authentication
```
POST /api/auth/login     – { username, password } → { userId, username, isAdmin }
POST /api/auth/logout    – Session zerstören
GET  /api/auth/me        – Aktueller User oder 401
POST /api/auth/init      – Ersten Admin anlegen (einmalig, public)
PUT  /api/auth/password  – { currentPassword, newPassword } (≥8 Zeichen)
```

#### Plans (Authenticated)
```
GET    /api/plans                    – Eigene + geteilte Pläne (isOwner, ownerName, canEdit)
POST   /api/plans                    – { name, state } → verschlüsselter Plan
GET    /api/plans/:id                – Entschlüsselt zurückgeben
PUT    /api/plans/:id                – { state, name } → Update (view-only → 403)
DELETE /api/plans/:id                – Löschen (nur Owner)
GET    /api/plans/:id/shares         – Mitbearbeiter auflisten
POST   /api/plans/:id/share          – { username, role:'edit'|'view' } → teilen (nur Owner)
DELETE /api/plans/:id/share/:userId  – Mitbearbeiter entfernen (nur Owner)
```

#### Import & Admin
```
POST   /api/import/plans             – { plans: [{ name, state }] } → Bulk-Import alter .json
GET    /api/admin/users              – Alle User auflisten
POST   /api/admin/users              – User erstellen
DELETE /api/admin/users/:id          – User löschen (cascade plans)
PUT    /api/admin/users/:id/password – Fremdes Passwort setzen (≥8)
```

### Plan-Sharing & Live-Kollaboration

**Plan-Sharing (plan_shares):** Zugriff = Owner ODER `plan_shares`-Eintrag. Rollen: `edit` (Default) / `view`. UI: `public/js/share.js` + `#share-modal`.

**Plan-Manager:** `public/js/plans-ui.js` + `#plans-modal` (📋 Meine Pläne): umbenennen, neuer Plan, Liste eigener + geteilter Pläne.

**Echtzeit-Kollaboration (WebSocket `/ws`):**
- Backend: `server/realtime.js` – Räume pro planId, Auth beim Upgrade via Session, `broadcastPlanUpdate()` nach jedem PUT
- Frontend: `public/js/realtime.js` – `realtimeConnect` nach Login, `realtimeJoin` bei Plan-Wechsel; bei `{type:'plan-updated'}` → Re-Fetch + `importStateJSON` + `generate`
- Echo-Schutz: Speichernder User bekommt kein Broadcast; Auto-Reconnect (3 s)

**Druckansicht:** `@media print` (A4 landscape) – jeder Tag = eine Seite; Sidebar/Tabs/Stats/Matrix ausgeblendet.

### Deployment

```bash
docker-compose up -d
# Secrets generieren:
openssl rand -base64 32  # MASTER_SECRET
openssl rand -base64 16  # SALT
openssl rand -base64 32  # SESSION_SECRET
```

Volume: `wachplan-data:/app/data` (SQLite DB + Sessions persistent)

Health Check: `GET /health → { status: "ok", timestamp: "..." }`
