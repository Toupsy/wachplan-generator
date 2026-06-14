# DLRG Wachplan-Generator – Projektkontext

> **Doku-Landkarte (Token-sparend lesen!):**
> - **CLAUDE.md** (diese Datei, immer geladen): Architektur, Datenmodell, Algorithmus-Kern,
>   Konventionen & Fallen. Schlank halten.
> - **HANDOFF.md**: Schnelleinstieg + aktueller Arbeits-/Review-Stand. **Zuerst lesen.**
> - **docs/FEATURES.md**: ausführliche Feature- & Bugfix-Historie (nur bei Bedarf öffnen).
> - **README.md / docs/**: Deployment, Datenschutz, Preview-Workflow.
>
> **Wartungsvertrag (jede Session/jeder Agent):** s. Abschnitt „Doku aktuell halten" unten.

## Git-Workflow
- **Niemals direkt auf `main` committen/pushen.** Branch: `feature/<name>` oder `fix/<name>`.
- Ende: `git push origin <branch>` → `gh pr create` gegen `main`. PRs nur auf ausdrücklichen Wunsch.
- Remote: `https://github.com/Toupsy/Wachplan-Generator`
- **Versioning:** automatisch via Semantic Release nach Merge auf `main` (Commit-Prefix
  `fix:` → patch, `feat:` → minor, `feat!:`/`BREAKING CHANGE:` → major, `chore:` → kein Bump).
  Source of Truth: `package.json:version` (aktuell **0.9.1**); `@semantic-release/git`
  committet den Bump nach jedem Release zurück nach `main` (`chore(release): x.y.z [skip ci]`).
  `GET /api/version` → `{ version, latest, updateAvailable, releaseUrl }`; `latest` holt der
  Server gecacht (6 h) vom GitHub-Releases-API, Frontend-Badge + Toast melden neuere Releases
  (Feature 29).

---

## Was ist das?
Single-Page-App (reines **Vanilla-JS**, kein Framework) für die DLRG. Erstellt faire,
rotierende Wachpläne für **1–14 Tage** und verteilt Personen auf **Türme, Boote, Hauptwache (HW)**.
Export als offizielles **DLRG-XLSX-Formular** (XML-Patch der Vorlage via JSZip) + CSV.
Backend: **Express + SQLite**, Multi-User mit **AES-256-GCM at rest**, Sessions, Sharing,
Realtime-Kollaboration (WebSocket), Admin-Panel.

- Frontend-Einstieg: `public/Wachplan-Generator.html` (statisch serviert), Template `public/Wachplan Template.xlsx`
- Backend: `npm start` → `server/server.js` (Port 3000); Admin: `server/admin-server.js` (Port 3001)
- Tests: `npm test` (Node `--test`)

---

## Codebase-Map (1 Zeile pro Modul)

**Frontend `public/js/`** — Ladereihenfolge in der HTML beachten (s.u.):
```
state.js          Globale Variablen & Datenmodell (s. „Globaler Zustand")
utils.js          escapeHtml, showToast, seededRand, personNr, showConfirmation, downloadBlob, Lookups
dates.js          Datumsberechnung (lokale Arithmetik, kein UTC-Shift)
autoCodes.js      Automatische Stationscodes + freshDayState()
config.js         seedFromConfig() (Template-Config laden)
seed.js           Beispieldatensatz (Fallback ohne Autosave)
render-sidebar.js Sidebar-UI: Personen, Türme, Boote, Export-Spalten, Positionen
generate.js       *** KERN-ALGORITHMUS *** Scoring, Rotation, Fairness
render-output.js  Ausgabe: Tageskarten, Stats-Bar, Pro-Person-/Matrix-Statistiken
export.js         XLSX (XML-Patch via JSZip) + CSV-Export
move.js           Modal „Person verschieben" (↕) + D&D-Logik
state-io.js       Server-Sync (autoSave/autoLoad), Plan-Manager, State-Serialisierung
roster.js         Wachlisten-Upload (CSV/PDF) → dynamische Namensliste aus startDate+DAYS (Feature 31)
user-info.js      User-Header, Admin-Link, Logout, Passwort
share.js          Plan-Teilen-Modal (👥)
realtime.js       WebSocket-Client (deaktiviert in .workers.dev Preview)
plans-ui.js       Plan-Manager (📋 Meine Pläne)
login-modal.js    Login/Setup/Register-Modal
sidebar-layout.js Master-Detail-Drill-Down der Sidebar (Home-Menü + Detail-Views, localStorage `dlrg_sidebar_view`)
layout-chrome.js  Top-Bar-Info-Kästchen (#header-info, localStorage `dlrg_header_info_open`) + Sidebar ein-/ausklappen (localStorage `dlrg_sidebar_collapsed`, nur Desktop ≥901px)
init.js           Event-Listener + Startsequenz (autoLoad → seed fallback)
```
**Ladereihenfolge:** state → utils → dates → autoCodes → config → seed → render-sidebar →
generate → render-output → export → move → state-io → roster → user-info → share → realtime →
plans-ui → login-modal → sidebar-layout → layout-chrome → init

**Backend `server/`:**
```
server.js          Express (Port 3000), Static aus ../public, Route-Registration, Scheduler
admin-server.js    Admin-Server (Port 3001), gleiches Image, anderer Entry-Point
realtime.js        WebSocket-Server (setupRealtime, broadcastPlanUpdate)
config.json        Template-Config (Türme/Boote/exportColumns) → GET /api/config
db/connection.js   Zentrale SQLite-Verbindung
db/init.js         Init, Schema-Migration (idempotente ALTER TABLE), Admin-Seed, validateEnv()
db/schema.sql      Schema (users, plans, plan_shares, audit_log; sessions via connect-sqlite3)
db/crypto.js       AES-256-GCM + deriveKey (PBKDF2 100k, Key-Cache pro userId)
db/session.js      createSessionMiddleware (SQLite-Store, DRY für beide Server)
db/access.js       getPlanAccess() zentral (Owner/Share-Prüfung, kein IDOR)
api/auth.js        login/logout/init/me/register/password + Rate-Limiting
api/plans.js       Plan-CRUD mit Verschlüsselung + Sharing
api/admin.js       Admin-Endpoints (Admin-only) inkl. audit-log, DSGVO-Export
api/import.js      Bulk-Import alter .json-Pläne
```
**Pfad-Konvention:** `server/server.js` → `../public`/`../data`; `server/db/*` → `../../data`.

UI-Panel-IDs (`#sidebar-panel`, `#output-panel`, `#section-people/-towers/-boats/...`,
Modals `#login-modal`/`#move-modal`/`#share-modal`/`#plans-modal` …) sind eindeutig benannt
(Issue #61) → in Issues/Code präzise referenzierbar.

---

## Globaler Zustand (state.js)
```js
people[]    // { id, name, role:'F'|'B'|'W', experienced:bool, wantsHW:bool } (experienced gilt für B & W; wantsHW nur für B: ≥1 aktiver HW-Dienst bei BF-Überzahl)
roster[]    // hochgeladene Wachliste: { name, role:'F'|'B'|'W', from:'YYYY-MM-DD', to:'YYYY-MM-DD' } (Feature 31). applyRosterToWindow() leitet people[]+absent dynamisch aus startDate+DAYS ab (roster.js)
rosterOverrides // { normName → { role?, experienced?, wantsHW?, labels?, enableLabels? } } – manuelle Korrekturen, die das Neu-Ableiten überleben (mergeRosterOverrides, Feature 31)
towers[]    // { id, name, prio, code, slotCount(1–10,Def2), leaderCount(0–3,Def0), mainBeach(bool,Def false) }
boats[]     // { id, name, code, towerId:number|'HW'|null, prio, slotCount(1–3,Def1) }
dayState[]      // Array[DAYS]: { sick:Set, absent:Set, closed:Set, closedBoats:Set }
                //   sick   = außer Dienst → wird an der HW geführt (zählt im Plan/Export)
                //   absent = komplett abwesend → NICHT eingeplant, nicht im XLSX/Druck (Feature 27)
forcedPlacements[] // Array[DAYS]: [{ personId, kind, slotId, transparent:bool }]
positionDescriptions   // { 3..7 } → XLSX C11,C13,C15,C17,C19
fairnessMetricsDisplay // { hwBoatBalance, towerDistribution, boatPairingDiversity }
exportColumns[] // 16 Stationscodes → Template-Spalten
lastResult      // { schedule, pairCount, stats, peopleGuards, fairnessMetrics }
activeDay, DAYS(1–14), uid, randomSeed(0=keiner), mainK
serviceStartHour/EndHour // Def 9/17, clamp 8–19
```
**Rollen:** F=Führung, B=Bootsführer, W=Wachgänger · **MAIN_ID = 0** (HW-Pseudo-ID).
**Helfer:** `effLevel(p)` (F→'E', B/W via experienced→'E'/'U'), `roleDot(p)`, `roleLabel(p)`.

`lastResult.stats[personId]` (über alle Tage akkumuliert): `{ total, towerVisits{tId→n},
boatVisits{bId→n}, hwVisits, towerWithBoatDays, boatCaptainPairings{capId→n},
mainBeachDays, outerBeachDays, hwGuardDays }`.
(`hwGuardDays` = aktive HW-Dienste, für BF-HW-Wunsch; `mainBeachDays`/`outerBeachDays` für Strandausgleich).
**Wichtig:** HW-Overflow (`main.base`) erhöht `total` NICHT (nur aktive Dienste zählen) →
„nur an HW gesessen" gilt als unterbeschäftigt → Folgetage bevorzugt aktiv eingeplant.

---

## Kern-Algorithmus (generate.js)
Läuft **sequenziell** über alle Tage; akkumulierte `stats` übertragen sich auf Folgetage → faire Rotation.

**Zuweisung pro Tag (Reihenfolge):**
0. **BF-Fairness-Sort** – `availB` nach `(boatDays*50 - hwVisits*10)` VOR activeBF/surplusBF-Split
1. **Hauptwache** – forced → Paare via `bestPair` → Einzelpersonen
2. **Türme** – je `slotCount + leaderCount` via `bestPair(t, true)`, Türme nach prio **ASC** (Prio 1 = wichtigster, öffnet zuerst). `leaderCount`-Slots vorab aus separatem `poolF`.
3. **Boote** – je 1 BF pro aktivem Boot (inkl. HW-Boote `towerId==='HW'`); im Standardfall **Min-Cost-Matching** (global optimal) statt gieriger Vergabe + Lookback-Rotation (`boatRotationPenalty` meidet die letzten `Boote−1` Tage → frühestens nach #Boote Tagen wieder)
4. Boot-Captain-Paarungen-Tracking
5. **HW finalize** – forced → Rest + Overflow; alle in `main.base`/`poolB` bekommen `hwVisits++`
6. **Transparente Zuweisungen** (visueller Swap nach dem Algorithmus)

**`bestPair(tower, requireMix, currentDay)` – niedrigster Score gewinnt** (Gewichte empirisch getunt, Issue #253):
```
+1000  UU + requireMix (Notlösung; an HW nur +300)      +40/1500 EE + requireMix (1500 bei E-Knappheit)
+250×  bisherige gemeinsame Turmdienste (Paar-Wdh.)     +200×v Turmbesuche A/B (linear)
+10×   (totalA+totalB) Fairness                         +800/-350 surplusBF aktiv/inaktiv-Boot
+200×  konsekutive Tage gleicher Turm (Feature 8)       +150 beide viele Boot-Tage
-60×   hwVisits (Bonus für Turm)  / +60× an HW-k-Slots  -100 F wenn Tower leaderCount>0
+5000  E an HW wenn reserveExpAtHW (Experience-Reservierung, s. u.)
+60×   Außen-/Hauptstrand-Überhang (Feature 25, nur wenn beide Turm-Sorten existieren)
+ Tiebreaker (deterministisch bzw. seededRand() für Tag 1)
```
**Hauptstrand-Türme (Feature 25):** Türme mit `mainBeach:true` bilden den „Hauptstrand".
`beachBalancePenalty` hält pro Person `outerBeachDays`/`mainBeachDays` im Gleichgewicht
(Strafe `overhang*60`), nur aktiv wenn Hauptstrand- UND Außentürme existieren → niemand
sitzt mehrere Tage in Folge nur auf Außentürmen.
**Experience-Reservierung (v0.4.24):** Vor der HW-Befüllung wird `reserveExpAtHW =
availE.length ≤ expDemand` gesetzt (`expDemand` = offene Türme ohne Leader-Deckung). Ist es
`true`, dürfen Erfahrene nicht an der HW „verbraucht" werden (+5000 in `bestPair`, U-zuerst in
der HW-Einzelbefüllung) und zwei Erfahrene werden nicht gepaart (EE-Penalty 1500) → jeder Turm
bekommt einen Erfahrenen, überzählige Unerfahrene gehen an die HW (bis zu 3 sind gewollt).

**BF-HW-Wunsch (Feature 26):** BF mit `wantsHW:true` sollen bei BF-Überzahl ≥1 aktiven
HW-Dienst (`mainGuards`) bekommen. `hwWishBonus` gibt noch unerfüllten Wünschen einen zum
Wochenende eskalierenden HW-Bonus (600→6000→100000), eingebaut in `bestPair` (HW-Zweig) +
HW-Einzelbefüllung. Sicherheitsnetz im `availB`-Sort drückt unerfüllte Wunsch-BF bei echter
Überzahl in den letzten 2 Tagen in die surplus-Hälfte. `hwGuardDays==0` = noch offen.

**Zwangszuweisungen (forcedPlacements):** `transparent:false` → Person aus Pool, fest
vorab platziert, zählt in Statistik (Folgetage berücksichtigen Wechsel). `transparent:true`
→ bleibt im Pool, Algorithmus normal, danach **nur visuell** in Zielslot verschoben.

**BF-Schutz:** surplusBF +800 auf Turm mit aktivem Boot, -350 wenn Boot außer Dienst
(1150 Swing). **Vorab-Schätzung** `tempOpen` über `(slotCount||2)+(leaderCount||0)` Plätze.

Detail-Historie aller Features/Bugfixes → **docs/FEATURES.md**.

---

## Wichtige Subsysteme (Kurzreferenz)

**XLSX-Export (export.js):** Template als ZIP (JSZip) laden, nur `xl/worksheets/sheet1.xml`
per Regex patchen → Styles/Bilder/Schutz bleiben. Konstanten: `SLOT_ROWS_X`, `SLOT_NAMECOL`
(4 Blöcke à 7 Personen = max 28), `TEMPLATE_STATION_COLS` (16 Spalten), `HOUR_ROWS_X`.
`effectiveCols[]` regelt Overflow: >2 Personen/Station → nächste Template-Spalte rechts;
Rest = HW-Overflow (Personen 5+, inkl. Kranke). Template auto-geladen via `fetch` +
localStorage-Cache (`dlrg_wachplan_template_b64`).

**Manuelles Verschieben (move.js + render-output.js):** ↕-Button öffnet `openMoveModal()`;
Checkbox „Folgetage neu berechnen" steuert `transparent`. D&D: `dragSrc` VOR
`showConfirmation()` in lokale Vars sichern (`dragend` nullt async). Boote inline unter Turm
via `renderInlineBoat()`; per D&D auf anderen Turm/HW ziehbar (`kind:'boat-reassign'`, immer transparent).

**Autosave/State-IO (state-io.js):** `autoSave()` nach jeder `generate()` → `PUT /api/plans/:id`
(localStorage-Fallback). `autoLoad()` beim Start. `_buildStateObject()` zentrale Serialisierung;
Sets als Arrays. `STATE_VERSION = 8`; `migratePerson()` für Altpläne.

**Wachlisten-Import (roster.js, Feature 31):** Upload (CSV/PDF) → `roster[]` (Roh-Verfügbarkeiten).
`applyRosterToWindow()` baut `people[]` + tageweise `absent` **dynamisch** aus `startDate`+`DAYS`
neu auf (auch bei jeder Datum-/Tage-Änderung in init.js). CSV-Parsing zuverlässig; PDF via pdf.js
(lazy von cdnjs, Spalten-Rekonstruktion über x-Positionen) best-effort. Job→Rolle WF/BF/RS→F/B/W,
importierte Personen starten unerfahren. Kernfunktionen DOM-frei + testbar (`test/roster.test.js`).

**Auth/Encryption:** Session-Cookies (HTTPOnly, sameSite:lax, 7d / 30d „Merke mich"), bcryptjs
(10 Rounds), Passwort ≥10 Zeichen, AES-256-GCM mit **Owner-Key** (kein Re-Encrypt beim Teilen),
PBKDF2 100k (gecacht pro userId), Rate-Limit IP+Account (10/15min), Session-Fixation-Schutz,
CSP/HSTS/Security-Header. **Secrets in `.env`** (Pflicht: `MASTER_SECRET`≥32, `SALT`≥16,
`SESSION_SECRET`≥16; geprüft von `validateEnv()`). API-Endpoints s. README/Code.

---

## Konventionen & Fallen (haben schon Bugs verursacht)
- **DB-Migrationen:** `schema.sql` nutzt `CREATE TABLE IF NOT EXISTS` → neue Spalten greifen
  NICHT auf Bestands-DBs. Für jede neue Spalte **idempotente `ALTER TABLE ... ADD COLUMN`** in
  `db/init.js` (Muster: `last_login`, `marked_for_deletion`).
- **DB-Verbindung:** `db/connection.js` exportiert **kein** `db`-Feld, nur `getDb()`/`dbRun`/
  `dbGet`/`dbAll`. Für eine rohe Verbindung **immer `getDb()`** nutzen – `require('./db/connection').db`
  ist `undefined` (verursachte den toten Plan-Retention-Cleanup, #272).
- **CSP divergiert je Server:** public-Server erlaubt `script-src 'self' 'unsafe-inline'
  https://cdnjs.cloudflare.com` (JSZip von cdnjs!); admin-Server nur `script-src 'self'`. Beim
  Zentralisieren der Header diese Differenz erhalten, sonst **bricht der XLSX-Export**.
  Zusätzlich: public-Server hat `worker-src 'self' blob: https://cdnjs.cloudflare.com` für den
  **pdf.js-Worker** (Wachlisten-PDF-Import, Feature 31) – beim Zentralisieren NICHT auf `'self'`
  zwingen, sonst bricht der PDF-Upload. Admin-Server braucht das nicht.
- **Index-HTML wird Cache-gebustet serviert (nicht plain static):** `server.js` fängt `/` und
  `/Wachplan-Generator.html` VOR `express.static` ab (`sendIndexHtml`), hängt an jede lokale
  `js/*.js`-/`*.css`-URL `?v=<Datei-mtime>` an und setzt `Cache-Control: no-cache`. So laden
  Browser/CDN nach jedem Deploy die passenden Assets (kein „neues HTML, alte JS"-Mismatch).
  **Neue `<script src="js/…">`/CSS-Tags werden automatisch versioniert** – cdnjs-URLs bleiben
  unberührt. Reihenfolge beachten: der Route-Handler muss vor `express.static` registriert sein.
- **Neue State-Felder** an 3 Stellen pflegen: `state.js` (Default + `resetGlobalState`),
  `state-io.js` `_buildStateObject()` (serialisieren) + `importStateJSON()` (deserialisieren mit
  Default für Altpläne); ggf. `STATE_VERSION` erhöhen.
- **Timezone:** lokale Datumsarithmetik, nie `toISOString()` für Tagesdaten (UTC-Off-by-one).
- `personNr()` / `showConfirmation()` NUR in `utils.js` (lädt früh) – nicht duplizieren.
- **Kein Framework:** Re-Renders via komplettem `innerHTML`-Replace; alle User-Inputs via
  `escapeHtml()`/`textContent` (XSS).
- **Constraints:** max 28 Personen (XLSX), 16 Stationsspalten, Paarungs-Matrix nur bei 2–18 E/U,
  DAYS 1–14, Turm slotCount 1–10, Boot 1–3.
- **Beobachter-Modus (Feature 30):** Nur-Lese-Pläne (Share-Rolle `view`, `currentPlanCanEdit=false`)
  schalten `body.view-only` (via `_updateSaveIndicator()`) → Sidebar + alle Editier-Bedienelemente
  weg, schlanke Turmbesetzungs-Ansicht. Neue Editier-UI in `render-output.js` daher IMMER hinter
  `if(!viewOnly)` (sonst sehen/triggern Beobachter sie); Schreiben ist serverseitig ohnehin 403.

---

## Testing
`npm test` → Node `--test`, Algorithmus-Invarianten sind die eigentliche Absicherung
(`test/harness.js` lädt Browser-Globals via vm.Context; `test/invariants.test.js`: Checks über
9 Szenarien + 100 Fuzz). Invarianten: keine Person doppelt/Tag, keine Kranken in aktiven Slots,
kein geschlossener Turm/Boot belegt, `slotCount`+`leaderCount` eingehalten. Perf-Baseline
~20ms für 28 Pers. × 14 Tage. **Backend kaum automatisiert** → bei Server-Änderungen mind.
`node -c` + manuell. `npm install` im frischen Container nötig (sonst `sqlite3`-Fehler in
`session-user-deletion.test.js`); dieser Test ist gelegentlich flaky (IPC-Serialisierung) →
erneut laufen lassen, grün = alle.
**CI:** `.github/workflows/test.yml` führt `npm ci` + `npm test` bei jedem `push`/`pull_request`
aus (Node 20) → roter Test blockt den Merge. (GDPR-Art.-17-Löschung ist über
`session-user-deletion.test.js` Teil von `npm test`; das alte Standalone-Skript
`test/gdpr-deletion-verification.js` ist veraltet/kaputt und nicht in CI eingebunden.)

---

## Doku aktuell halten (Wartungsvertrag – gilt für JEDE Session/JEDEN Agenten)
Nach Abschluss einer Aufgabe die **passende** Datei aktualisieren (so wenig wie möglich,
damit die immer-geladene CLAUDE.md schlank bleibt):

| Was hat sich geändert? | Datei |
|---|---|
| Neues Feature / Bugfix (funktional) | **docs/FEATURES.md** (Eintrag mit Issue-Nr. + VERSION) |
| Architektur, Datenmodell, Algorithmus-Verhalten, neue Konvention/Falle, neue/umbenannte Moduldatei | **CLAUDE.md** (entspr. Abschnitt + Codebase-Map) |
| Arbeitsstand, PR-Review, offene ToDos | **HANDOFF.md** |
| Deployment / Datenschutz / Preview | `docs/*` |

Faustregel: **CLAUDE.md = stabiles Wissen**, **FEATURES.md = Historie**, **HANDOFF.md = aktueller
Stand**. Keine Feature-Changelogs in CLAUDE.md anhäufen.
