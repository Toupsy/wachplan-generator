# Feature- & Bugfix-Historie – DLRG Wachplan-Generator

> **On-demand-Doku.** Wird NICHT automatisch in jede Session geladen. Hier steht die
> ausführliche Historie aller Features und Bugfixes. Überblick/Architektur → `CLAUDE.md`,
> aktueller Arbeitsstand → `HANDOFF.md`.
>
> **Pflege:** Bei jeder funktionalen Änderung hier einen Eintrag ergänzen (neues Feature
> oder Bugfix), mit Issue-Nr. + VERSION. CLAUDE.md nur anfassen, wenn sich Architektur,
> Datenmodell, Algorithmus-Verhalten oder eine Konvention/Falle ändert.

---

## Features

### Feature 5: BF-Schutz (surplusBF-Penalty)
Übrige Bootsführer (nicht auf Booten) sollen nicht an Türmen mit aktivem Boot stehen.
- +800 Penalty auf aktive-Boot-Türmen; -350 auf deaktivierten-Boot-Türmen → 1150 Swing.

### Feature 6 (deprecated): HW-Boot
Ehemals dediziertes Feature mit separater `hwBoatId`. Seit v0.4.13 obsolet: Boote werden
der HW uniform über `towerId='HW'` zugeordnet (wie jedem Turm). Mehrere HW-Boote möglich,
jedes bekommt einen eigenen BF.

### Feature 7: Erweiterte Fairness-Metriken
Stats-Bar zeigt `avgHwVisits | avgTowerWithBoatDays` + Boot-Paarungen-Diversität %.
Grün = ausgeglichen, Orange = Schieflage.

### Feature 8: Konsekutive-Tage-Regel
`checkConsecutiveTowerPenalty(personA, personB, towerId, currentDay)` in `generate.js`:
+200 Punkte pro Person wenn Vortag auf selbem Turm → Personen verteilen sich über Türme.
Soft-Constraint (weicht bei knapper Besetzung).

### Feature 9: Metriken-Toggle
`fairnessMetricsDisplay`-Flags in `state.js` (`hwBoatBalance` / `towerDistribution` /
`boatPairingDiversity`) steuern, welche Metriken sichtbar sind. Checkboxes
`#metric-hw-balance`, `#metric-tower-dist`, `#metric-boat-pairing`; `syncMetricCheckboxes()`
synchronisiert nach State-Import.

### Feature 10: Pro-Person Tower-Statistik
`renderTowerStatsPerPerson()` in `render-output.js`: Tabelle Person | Gesamt-Tage |
Unique Türme | Details. Farb-Coding: Grün wenn ≥50% der Türme besucht.

### Feature 11: Seed-basierte Start-Konstellationen
`applySeedConstraints(seed)` in `init.js` (0–999): `0`=Standard, `1–999`=deterministische
Fisher-Yates-Permutation der E/U + BF auf Tag 1. Alle Seeds → identische Gesamtfairness
(Balancierung über Scoring ab Tag 2). LCG: `rng = (rng*1664525 + 1013904223) & 0x7fffffff`.

### Feature 12: Pro-Turm Führungskräfte-Einstellung
`leaderCount` pro Tower (0–3, Default 0), additiv zu `slotCount`. Führungskräfte liegen in
separatem `poolF` (nicht im `getGuardPool`); pro offenem Turm werden `leaderCount`-Slots
gezielt mit F vorbesetzt (faire Auswahl: wenig `total`, dann wenig `towerVisits[t]`). Übrige
F bleiben `fuehrung:poolF` an HW (zählt als aktiver Dienst: `total++ + hwVisits++`). UI:
Spinner mit Label 👔.

### Feature 13: Vereinheitlichtes Erfahrungs-Flag (`experienced`)
`role:'F'|'B'|'W'` + `experienced:boolean` ersetzt das frühere E/U-Modell + `bfLevel`; gilt
für B und W (bei F irrelevant). Helfer in `state.js`: `effLevel(p)` (F→'E', s. Issue #251),
`roleDot(p)`, `roleLabel(p)`. Migration via `migratePerson()` in `state-io.js`,
`STATE_VERSION` 4→5.

### Feature 14: Single-Page Layout mit mobiler Tab-Umschaltung
Sidebar + Output side-by-side (Desktop ≥768px) bzw. ein Panel via sticky Segment-Leiste
(Mobile). `setupMobileSwitch()` in `init.js`, `.mobile-switch`/`.ms-btn`. `@media print`
blendet Sidebar/Switch aus.

### Feature 15: Konfigurierbare Dienstzeiten
`serviceStartHour`/`serviceEndHour` (Default 9/17) ersetzen hardcoded 09:00–17:00. Zwei
Number-Inputs (min 8, max 19) in `#section-schedule`; `fillHours()` in `export.js` clampt +
erzwingt `end >= start`. `STATE_VERSION` 3→4.

### Feature 16: CSV-Export Pro-Person Fairness-Statistik
`exportStatsCSV()` in `export.js`: Nr | Person | Rolle | Einsätze | HW-Tage | Türme (unique)
| Turmbesuche | Boot-Tage | Tage Turm+Boot. Button `#btn-export-stats-csv`. UTF-8 mit BOM.

### Feature 17: Reset aller manuellen Zuweisungen
Button „↺ Manuelle Zuweisungen zurücksetzen (n)" in der Export-Row. `countForced()` /
`clearAllForced()` (leert `forcedPlacements`, generiert neu). Disabled wenn leer.

### Feature 18: Letzter Login im Admin-Panel
`users.last_login DATETIME` (NULL = nie). Nur bei erfolgreichem Login aktualisiert (nicht
Session-Resume). `GET /api/admin/users` → `lastLogin`. Idempotente `ALTER TABLE`-Migration.

### Feature 19: DSGVO – Datenminimierungs-Hinweis im Labels-Feld
Warnhinweis in `#section-people`-Infobox („Nur dienstrelevante Qualifikationen") +
`maxlength="200"` auf Labels-Input. Keine Logikänderung. v0.4.13.

### Feature 20: Login-Modal „Merke mich" (persistenter Login)
Checkbox „Merke mich (30 Tage)" → Session-Cookie 30 statt 7 Tage. Backend liest `rememberMe`
aus Login-Body und setzt `req.session.cookie.maxAge`. HTTPOnly + SameSite:lax bleiben. v0.4.14.

### Feature 21: Audit-Logging (DSGVO Art. 5 Abs. 1 f)
`audit_log`-Tabelle (`id, user_id, action, entity_type, entity_id, details, ip_address,
timestamp`); Indizes auf `user_id`/`action`/`timestamp`. `GET /api/admin/audit-log` mit
Filter (action, user_id) + Paginierung (limit 1–500, offset). Einträge werden nicht
automatisch gelöscht. v0.4.15.

**Audit-Log-Ansicht im Admin-Panel (Issue #154):** Ergänzend zum Logging-Backend zeigt
`public/admin.html` jetzt eine read-only Audit-Log-Tabelle (neueste zuerst) mit Aktions-Filter
und Aktualisieren-Button (`loadAuditLog()`, `AUDIT_ACTION_LABELS`). Nur Metadaten, alle Werte
via `textContent` (XSS-sicher). Damit ist Akzeptanzkriterium „Admin kann Log einsehen" erfüllt.

### Feature 22: Selbstregistrierung
`REGISTRATION_MODE` (disabled|open|code, Default disabled). `POST /api/auth/register` +
`GET /api/auth/registration-status`. Neuer User immer `is_admin=0`; Rate-Limit 10/15min;
non-enumerable Fehler; Auto-Login via `session.regenerate()`. Register-View in `#login-modal`
mit Datenschutz-Checkbox (`acceptedPrivacy`) + optionalem Code-Feld. v0.4.16.

### Feature 23: Plan-Retention & Automatische Löschung (DSGVO Art. 5 Abs. 1 e)
Pläne > `PLAN_RETENTION_DAYS` (Default 90, off bei ≤0) inaktiv → `marked_for_deletion=1`,
7 Tage Gnadenfrist bis finaler Löschung. Täglicher Scheduler (24h) ab `server.js` nach
`initDatabase()`. CASCADE auf plan_shares. Cleanup als System-Event im audit_log
(action='plan_cleanup', user_id=NULL). Idempotente Migration für `marked_for_deletion(_at)`.
v0.4.17.

### Feature 24: Umfassende Datenschutzerklärung (DSGVO Art. 13/14)
`public/datenschutz.html` – standalone, Dark Theme. Verantwortlicher, Datenverarbeitung,
Rechtsgrundlagen, Speicherdauer, Betroffenenrechte (Art. 15–21), Sicherheit, Cookies,
Art. 22, Kontakt/Beschwerde. URL `/datenschutz.html`, verlinkt aus Register-View. v0.4.18.

### Feature 25: Hauptstrand-Türme (fairer Hauptstrand-/Außen-Ausgleich)
Türme lassen sich per Checkbox „🏖️ Hauptstrand" (`towers[].mainBeach`) markieren. Praxis-
Feedback: Wachgänger sitzen sonst mehrere Tage in Folge auf Außentürmen. Der Algorithmus
hält pro Person das Verhältnis Hauptstrand- ↔ Außentürme im Gleichgewicht.
- Neue Stats `mainBeachDays` / `outerBeachDays` (in `ensure()`, `commitPerson()`,
  `_reAccumulateDayStats()`).
- `beachBalancePenalty(candidate, tower)` in `generate.js`: symmetrische Strafe
  `overhang * 60` (Außenturm → bestraft, wer schon viel außen war; Hauptstrandturm
  umgekehrt). Eingebaut in `bestPair` (Turm-Zweig) und die Turm-Einzelbefüllung.
- Nur aktiv, wenn BEIDE Turm-Sorten existieren (`beachBalanceActive`).
- UI: Toggle in der Turmzeile (`render-sidebar.js`), Badge „🏖️" auf der Turmkarte
  (`render-output.js`). Persistenz in `state-io.js` + `config.js`.
- Effekt (Messung, 7 Türme/3 Hauptstrand): avg|Überhang| 6 T. ~4.9→~0.9, 14 T. ~11.5→~1.7,
  ohne Verschlechterung von Turm-/Partner-Wiederholung oder Experience-Abdeckung.
- Test: `test/invariants.test.js` „Hauptstrand-Türme: fairer Ausgleich …".

### Feature 26: Bootsführer mit HW-Wunsch
Pro Bootsführer aktivierbarer Haken „🏠 HW-Wunsch" (`people[].wantsHW`). Praxis: Bei
BF-Überzahl (mehr Bootsführer als Boote) möchten einige BF in der Woche mindestens **einmal
aktiven Hauptwache-Dienst** leisten. „Erfüllt" = echter `mainGuards`-Slot; reines Sitzen im
HW-Overflow zählt nicht.
- Neue Stat `hwGuardDays` = Anzahl aktiver HW-Dienste (`ensure()`, `commitPerson(MAIN)`,
  `_reAccumulateDayStats()`).
- `hwWishBonus(candidate)`: eskalierender Bonus für noch offene Wünsche (Restwoche
  `daysLeft<=1 → 100000`, `<=2 → 6000`, sonst `600`), eingebaut in `bestPair` (HW-Zweig) und
  die HW-Einzelbefüllung. Nur überzählige BF stehen im HW-Guard-Pool → automatisches Gating.
- Sicherheitsnetz im `availB`-Sort: bei echter BF-Überzahl UND `daysLeft<=2` werden noch
  unerfüllte Wunsch-BF in die surplus-Hälfte gedrückt (damit überhaupt HW-fähig). Nur bei
  Überzahl, sonst bliebe ein Boot unbesetzt.
- UI: Checkbox in der Personenzeile (nur Rolle B), `render-sidebar.js`. Persistenz in
  `state-io.js` (Default false für Altpläne).
- Test: `test/invariants.test.js` „BF-HW-Wunsch: … ≥1 aktiven HW-Dienst" (inkl. Edge:
  kein Surplus → nicht erzwungen, kein Boot bleibt leer).

### Feature 27: Komplett-Abwesenheit (zusätzlich zu „außer Dienst")
Bislang wurden Personen mit „außer Dienst" (`dayState[d].sick`) immer an der Hauptwache
geführt (durchgestrichen, im XLSX/Druck sichtbar). Neu: pro Tag lässt sich eine Person als
**komplett abwesend** (`dayState[d].absent`) markieren – sie wird **gar nicht** eingeplant,
zählt nicht in der Statistik (`total`/`hwVisits` bleiben 0) und taucht **weder im XLSX-Export
noch in der Druckvariante** auf.
- **Datenmodell:** neues `absent:Set` in `dayState` (state.js/autoCodes.js `freshDayState`,
  init.js, render-output.js Fallbacks). Serialisierung in state-io.js + `STATE_VERSION 6→7`
  (Altpläne: `absent` defaultet auf leer).
- **Algorithmus (generate.js):** `isAbsent(id)` schließt Personen aus allen Pools, aus
  forced placements und aus `sickToday` aus (`isSick` gilt nur noch für nicht-Abwesende).
  Neues `absentCount` pro Schedule-Tag.
- **UI (render-output.js):** eigene Sektion „👋 Komplett abwesend" in der Tages-Steuerung;
  `sick`/`absent` sind **gegenseitig exklusiv** (Aktivieren der einen löscht die andere).
  Day-Tab-Flag `👋`. Chip-Style `.toggle-chip.absent`.
- **Einklappbare Steuerung:** alle Status-Sektionen (außer Dienst / abwesend / Turm zu /
  Boot zu / manuelle Zuweisungen) sind jetzt `<details>`-Sektionen (`dcSection()`-Helper),
  **standardmäßig zugeklappt** mit Count-Badge der aktiven Einträge → weniger Überfrachtung,
  v. a. da „außer Dienst" und „abwesend" beide die volle Personenliste zeigen. Auf-/Zu-Zustand
  überdauert Re-Renders (`dcSectionOpen` pro Sektionstyp).
- **Export/Druck:** keine Änderung nötig – Abwesende landen in keinem Slot und nicht in
  `main.sick`, daher automatisch ausgeschlossen.
- **Tests:** Harness-Option `absentPersonIds`, Invariante `checkAbsentNotAssigned`
  (Abwesende nirgends im Plan), Szenario 4b + Fuzz-Abdeckung.

### Feature 28: Fairness-Visualisierung – Balkendiagramme für Einsatzverteilung (Issue #225)
Visuelle SVG-Balkendiagramme zur schnellen Kontrolle der Schichtverteilung über den
Planungszeitraum – ergänzend zu den vorhandenen Zahlen-Metriken und der Pro-Person-Tabelle.
- **3 Diagramme** (jeweils einzeln togglebar):
  1. **Einsätze gesamt pro Person** – horizontale Balken, absteigend sortiert, mit Ø-Linie.
  2. **HW-Tage pro Person** – macht „Dauer-HW"-Schieflagen sichtbar.
  3. **Turmauslastung** – nach Turm-Prio sortiert, Über-/Unterauslastung erkennbar.
- **Farbcoding:** grün = ausgeglichen (innerhalb Schwelle um den Ø), orange = Schieflage;
  rote gestrichelte Ø-Linie als Referenz.
- **Implementierung:** reines SVG/CSS, keine externen Libs (CSP-konform `default-src 'self'`).
  `renderAssignmentsChart()`, `renderHWDaysChart()`, `renderTowerUtilizationChart()` +
  `renderFairnessCharts()` in `render-output.js`; alle Namen via `escapeHtml`.
- **State:** neues `fairnessChartsDisplay` in `state.js` (Default alle `true`), Serialisierung
  in `state-io.js` (`_buildStateObject`/`importStateJSON` mit Default für Altpläne),
  Reset in `resetGlobalState`.
- **UI:** 3 Checkboxen im Bereich „Visualisierungen" der Fairness-Metriken; Event-Listener in
  `init.js` (`CHARTS_MAP`), Sync nach State-Import via `syncMetricCheckboxes()`.
- **Druck:** `@media print { .charts-container { display:none } }` – Charts im Ausdruck aus.

### Feature 30: Beobachter-Modus (Nur-Ansicht) – minimalistische Plan-Ansicht
Pläne, die mit Leserechten (Share-Rolle `view`) geteilt werden, öffneten sich bisher in der
vollen Editier-UI (Sidebar, ↕-Verschieben, Drag&Drop, Steuerungen). Schreiben war zwar
serverseitig blockiert (PUT 403 für `view`, autoSave durch `currentPlanCanEdit=false`
unterdrückt), aber der Beobachter konnte den Plan lokal „bearbeiten" und sah die ganze
Konfigurations-Sidebar. Gedacht ist die Rolle aber für Wachgänger, die nur sehen wollen,
mit wem sie am nächsten Tag auf dem Turm sind.
- **Auslöser:** `currentPlanCanEdit === false` (aus `GET /api/plans/:id` → `canEdit`).
  `_updateSaveIndicator()` schaltet `document.body.classList.toggle('view-only', …)` – greift
  zentral bei autoLoad, loadPlanById, createNewPlan, renameCurrentPlan, autoSave und
  `applyRemotePlanState` (Live-Update). `resetGlobalState()` setzt `currentPlanCanEdit=true`.
- **CSS (`Wachplan-Generator.html`):** `body.view-only` blendet `#sidebar-panel`,
  `.mobile-switch`, Header-Subtitle, `.export-row`, `.stats-bar`, `.out-extras`,
  `.day-controls` und `.move-btn` aus; `.main-panels` wird einspaltig; auf <900px wird das
  Output-Panel sichtbar erzwungen. Neue `.vo-bar`/`.vo-day-head`-Styles.
- **Render (`render-output.js`):** lokales `viewOnly`. Schlanke Kopfzeile (`.vo-bar`:
  Plan-Name, „Nur Ansicht"-Badge, Buttons 📋 Pläne / 🚪 Abmelden) + Tag-Navigation; pro Tag
  ein kompakter `.vo-day-head` (Datum) statt der Editier-Steuerung; Occupants ohne ↕-Button
  und `draggable=false`; `out-extras`/Statistiken weggelassen. `early return` nach den
  Tag-Tab-Listenern verhindert das Anhängen aller Editier-/Drag&Drop-/Export-Listener; nur
  `#vo-plans`→`openPlansModal()` und `#vo-logout`→`logout()` werden verdrahtet.
- **Plan-Wechsel/Abmelden** bleiben möglich (Top-Level-`#plans-modal` ist sidebar-unabhängig).

### Feature 29: Version-Badge an GitHub-Releases gekoppelt + Update-Hinweis
Das Header-Badge zeigte dauerhaft „v 0.5.1", weil Semantic Release den Versions-Bump nie
zurück ins Repo committete (`package.json` blieb stehen, GitHub war schon bei v0.9.1).
- **Root-Cause-Fix:** `@semantic-release/git`-Plugin in `.releaserc.json` (Assets
  `package.json`/`package-lock.json`, Commit `chore(release): x.y.z [skip ci]`) +
  `extra_plugins` in `release.yml` + devDependency. `package.json` einmalig manuell auf
  0.9.1 synchronisiert.
- **Server (`server.js`):** `GET /api/version` liefert jetzt `{ version, latest, releaseUrl,
  updateAvailable }`. `latest` kommt serverseitig von
  `api.github.com/repos/Toupsy/Wachplan-Generator/releases/latest` (In-Memory-Cache 6 h,
  Fehler-Cache 15 min, Timeout 5 s, Fehler → `latest:null`). Kein CSP-Update nötig
  (Browser ruft GitHub nie direkt). Semver-Vergleich via `compareVersions()`.
- **Frontend:** Badge (`#version-badge`) grün = aktuell, gold/orange + Tooltip wenn auf
  GitHub eine neuere Version existiert (Inline-Script in `Wachplan-Generator.html`).
  Zusätzlich `showToast()`-Meldung in `checkForUpdate()` (init.js), einmal pro neuer
  Version (`localStorage['gh-update-notified']`).
- **Caveat:** Falls Branch-Protection auf `main` Pushes des `GITHUB_TOKEN` blockt, schlägt
  der Release-Commit fehl → Actions-Ausnahme in der Branch-Protection nötig.

---

## Bugfixes

### Plan-Retention-Cleanup lief nie – `db` undefined (#272)
**Problem:** `server.js` startete die DSGVO-Plan-Retention mit
`const db = require('./db/connection').db;` – `connection.js` exportiert aber **kein**
`db`-Feld (nur `getDb`/`dbRun`/…). `startPlanRetentionCleanup(undefined, …)` rief intern
`db.run(...)` auf → bei `PLAN_RETENTION_DAYS > 0` warf das 24h-Intervall `TypeError`, der
vom `catch` verschluckt wurde. Die Retention (Feature 22/23, DSGVO Art. 5) tat nie etwas.
- **Ort:** `server/server.js`, `server/db/init.js` (`startPlanRetentionCleanup`).
- **Lösung:** `getDb()` (Singleton, nach `initDatabase()` live) statt `.db` übergeben.
  Zusätzlich `cleanupRunning`-Guard gegen überlappende Cleanup-Läufe.
- **Verifikation:** Reproduziert (`require(...).db === undefined`); mit `getDb()` läuft die
  exakte Retention-`UPDATE`-Query fehlerfrei.

### Robustheit/Wartbarkeit – Export-Leak, WebSocket-Fehler, Audit-JSON, ID-Parser (#273)
- **Export-Memory-Leak:** `URL.createObjectURL()` wurde in `export.js` (XLSX/CSV/Stats) und
  `state-io.js` nie freigegeben. Neuer Helfer `downloadBlob(blob, filename)` in `utils.js`
  (zentral + `revokeObjectURL`).
- **WebSocket-Join (`realtime.js`):** stummer `catch(e){}` loggt jetzt; `msg.planId` wird via
  `parsePositiveInt` validiert; `ws.send` nur bei `readyState===OPEN`.
- **Audit-Log (`admin.js`):** `JSON.parse(details)` pro Datensatz mit `try/catch` – ein
  korrupter Datensatz kippt nicht mehr den ganzen Compliance-Endpoint (500); Fallback
  `{ _parseError:true, raw }`.
- **ID-Parsing (`plans.js`/`realtime.js`):** lokale `parsePlanId`/`parseUserId` durch den
  zentralen, strikteren `parsePositiveInt` (`db/ids.js`) ersetzt (`'5abc'` → `null` statt `5`).
- **Dead Code:** veraltetes/kaputtes `test/gdpr-deletion-verification.js` entfernt (nicht in
  CI, Löschung ist über `session-user-deletion.test.js` abgedeckt).

### Fairness – Bootsführer-Rotation zu eng (Lookback + Matching, v0.4.24)
**Problem:** Ein Bootsführer stand teils zwei Tage hintereinander am selben Boot; der
Rotations-Penalty prüfte nur den Vortag (`lastBoatId`). Gewünscht: bei 3 Booten frühestens
nach 3 Tagen wieder aufs gleiche Boot (Mo → frühestens Do).
- **Ort:** `generate.js`, `boatRotationPenalty()` + Boot-Zuweisung.
- **Ursachen:** (1) Penalty nur 1 Tag Rückblick; (2) gierige Boot-für-Boot-Vergabe – das
  zuletzt verarbeitete Boot bekam den einzig übrigen BF, auch wenn das die Rotation verletzte.
- **Lösung:** (1) `boatRotationPenalty` blickt über das **Rotationsfenster** zurück
  (`boatRotationLookback = offene Boote − 1`, bei 3 Booten also 2 Tage), gestern am stärksten
  bestraft. (2) **Min-Cost-Matching** (Branch-and-Bound) ordnet alle Boote+BF eines Tages
  global optimal zu statt gierig – nur im Standardfall (keine Zwangsboote, je 1 BF/Boot, ≤8
  Boote), sonst Fallback auf die bisherige Vergabe.
- **Verifikation (5 Seeds):** Boot-Rückkehr in <3 Tagen **10→0**, kleinster Gap **1→3**;
  jeder BF läuft einen sauberen 3er-Zyklus. Neue Invariante in `test/invariants.test.js`
  (24/24 grün, schlägt ohne Fix fehl). Messskript `/tmp/measure_boats.js`.

### Fairness – Türme ohne Erfahrenen (Experience-Reservierung, v0.4.24)
**Problem:** Auf der Standard-Besetzung (7 erfahrene WG, 7 Türme, 2 Führung an HW) blieb
regelmäßig ein Turm (meist der Turm mit niedrigster Prio) **ohne Erfahrenen** – obwohl genug
Erfahrene da waren. Messung: 36 unbesetzte Turm-Tage / 5 Läufe × 6 Tage.
- **Ort:** `generate.js`, HW-Befüllung + `bestPair()`.
- **Ursache:** Die Hauptwache wird VOR den Türmen befüllt und zog dabei erfahrene
  Wachgänger aus dem Guard-Pool → für die 7 Türme blieben nur 6 Erfahrene → ein Turm UU.
- **Lösung – Experience-Reservierung:** Sind Erfahrene knapp (`availE ≤ offene Türme,
  abzgl. Leader-gedeckter Türme`), werden sie an der HW **nicht verbraucht**: großer
  endlicher Penalty (+5000) für E an HW in `bestPair` + U-zuerst-Sortierung in der
  HW-Einzelbefüllung. Zusätzlich EE-Paar-Penalty bei Knappheit `40→1500`, damit nicht zwei
  Erfahrene auf einem Turm landen und ein anderer leer bleibt. „Bis zu 3 Unerfahrene an der
  HW" ist dabei explizit gewollt.
- **Verifikation (5 Seeds):** Türme ohne Erfahrenen **36→0** (6 T.) und **92→0** (14 T.);
  Turm-Wiederholungen 38→16 (6 T.). Fuzz 80 Läufe (4 Tageslängen × 20 Seeds) = 0 Verstöße.
  Neue Invariante `checkExperienceNotWastedAtHW` in `test/invariants.test.js` (23/23 grün,
  schlägt ohne Fix fehl). Messskript `/tmp/measure.js`.

### Fairness – zu häufige Turm-/Partner-Wiederholungen (Issue #253, v0.4.21)
**Problem:** Personen besuchten denselben Turm 2–3× in 6 Tagen; Paare wiederholten sich.
- **Ort:** `generate.js`, `bestPair()` + Boot-Zuweisung.
- **Ursache:** Schwache „Klippe" beim Turm-Wiederholungs-Penalty (`v≥2?300:v*30`) →
  Clustering. BF konnten am Folgetag aufs selbe Boot.
- **Lösung:** Turm-Wiederholung **linear** `v*200`; Fairness-Gewicht `(totalA+totalB)`
  ×5→×10; HW-UU-Penalty bei `isMain` auf 300 (greift mit #251 ineinander);
  Partner-Wiederholungs-Penalty ×120→**×250** (sonst stieg `pairRepeat` 21→42);
  Boot-Rotation via `lastBoatId` + 300-Penalty, Boot-Auswahl per Min-Score statt `shift()`.
- **Verifikation (5 Szen. × 5 Seeds):** Turm-Wiederholer 267→188, Wiederholungs-Besuche
  336→216, Paar-Wiederholungen 21→14. 11/11 Invarianten grün. Messskript `/tmp/measure.js`.

### Führungskräfte zählen als erfahren (Issue #251, v0.4.20)
- **Ort:** `state.js`, `effLevel(p)`. **Lösung:** `effLevel` gibt für `role:'F'` jetzt `'E'`
  zurück → an HW sind 3 Unerfahrene mit 2 WF möglich, solange jeder andere Turm ≥1 Erfahrene
  hat. Betrifft nur Scoring/UU-Bewertung. 11/11 Invarianten grün.

### Passwortlängen-Validierung inkonsistent (Issue #234, v0.4.14)
Frontend validierte ≥8, Backend ≥10. Frontend (`login-modal.js`, `user-info.js`) +
HTML-Placeholder auf ≥10 angehoben.

### openTowers-Bedarfsrechnung ignoriert leaderCount (Issue #117, v0.4.1)
`generate.js`: `need = max(0, (slotCount||2) + (leaderCount||0) - preCount)` (vorher ohne
`leaderCount`) → keine Turm-Öffnung mehr ohne genug Personal bei `leaderCount>0`.

### `renderHWBoatSelector()` undefined ReferenceError (Issue #233, v0.4.14)
`state-io.js` Z.376: Aufruf einer nicht existierenden Funktion (Überbleibsel Feature 6,
deprecated). Zeile entfernt → kein ReferenceError mehr in `createNewPlan()`/`loadPlanById()`/
`applyRemotePlanState()`.

### Neue Pläne erben Türme/Boote vom aktuellen Plan (Issue #204, v0.4.14)
`createNewPlan()` rief `seedFromConfig()` ohne vorheriges `resetGlobalState()`; `seed()` /
`seedFromConfig()` reseteten `towers`/`boats` nicht vor `.push()`. **Lösung:**
`resetGlobalState()` vor `seedFromConfig()`; zusätzlich `towers=[]`/`boats=[]` defensiv.
Neue Pläne starten leer mit Default-Parametern (DAYS=6, mainK=2, 9/17).

### Mobile/Touch: ↕-Verschieben-Button war hover-only (Issue #181)
`.move-btn` war nur per `:hover` sichtbar (`opacity:0`) → auf Touch-Geräten unbenutzbar.
**Lösung:** `@media (hover:none),(pointer:coarse)` zeigt den Button dort dauerhaft und
vergrößert das Touch-Target; zusätzlich `:focus-visible` für Tastatur-Zugänglichkeit.

### Header-Subtitle: Abkürzung „a. D." entfernt (Issue #194)
Untertitel ausgeschrieben und auf Wachgänger/Turm bezogen statt „jeder Tag"; verunglücktes
„außer Dienst.- und Schließstatus" korrigiert. Reine Text-Änderung.

### XLSX-Export: stille Truncation jenseits der 16 Template-Spalten (Issue #215)
`_patchSheetXml` brach beim Erreichen von `TEMPLATE_STATION_COLS.length` still ab → überzählige
Stationen/Personen fielen kommentarlos aus dem amtlichen Formular. **Lösung:** `truncated`-Flag
an allen drei Abbruchpfaden; `_patchSheetXml` gibt `{ xml, truncated }` zurück; `exportOfficial`
zeigt bei Truncation eine `confirm()`-Warnung (analog zur >28-Personen-Warnung).

### Security: Plan-Name/State-Größe unbeschränkt + nacktes parseInt in Admin-Routen (Issue #218)
`POST/PUT /api/plans` validieren jetzt `name` (String, max. 200 → 400) und serialisierte
State-Größe (max. 1 MB → 413) gegen Storage-Exhaustion (`validatePlanInput`). Neuer gemeinsamer
Helfer `server/db/ids.js` (`parsePositiveInt`) ersetzt `parseInt(req.params.id)` in `admin.js`
(DELETE/PUT-password/GET-export) → `'5abc'`/`NaN`/`≤0` fließen nicht mehr in Queries.

### Security: Bulk-Import umging die Eingabe-Limits aus #218 + leakte Fehlerdetails (Issue #279)
`POST /api/import/plans` fügte Pläne ohne jede Validierung ein – beliebig lange Namen,
States bis zum 10-MB-Body-Limit, `plan.name` ohne Typprüfung; rohe `planError.message`
(Crypto/DB-Details) ging an den Client. **Lösung:** `validatePlanInput` aus `plans.js`
exportiert und pro importiertem Plan angewandt (gleiche Limits wie POST/PUT: Name ≤ 200,
State ≤ 1 MB; ungültige Pläne werden mit klarer Meldung übersprungen, Teilimport bleibt
möglich). Fehlermeldungen an den Client sind jetzt generisch („Import fehlgeschlagen“),
Details nur noch via `console.error`; Namen in Fehler-Strings String-koerziert + gekürzt.
