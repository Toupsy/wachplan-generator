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

---

## Bugfixes

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
