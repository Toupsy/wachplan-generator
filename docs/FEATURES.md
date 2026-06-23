# Feature- & Bugfix-Historie – DLRG Wachplan-Generator

> **On-demand-Doku.** Wird NICHT automatisch in jede Session geladen. Hier steht die Historie
> aller Features/Bugfixes; Überblick/Architektur → `CLAUDE.md`, aktueller Stand → `HANDOFF.md`.
>
> **Pflege:** Bei jeder funktionalen Änderung hier **einen knappen Eintrag** ergänzen
> (Issue-Nr. + VERSION). Was/Wo/warum genügt – tiefe Mechanik gehört in `CLAUDE.md`/Code, nicht
> als Essay hierher. CLAUDE.md nur bei Architektur/Datenmodell/Algorithmus/Konvention/Falle.

---

## Features

### Feature 46: Audit-Log-Coalescing + Retention für `plan_update`
Das Admin-Audit-Log wurde von „Wachplan-Änderungen" geflutet: `autoSave()` schreibt nach **jeder**
`generate()` ein `plan_update` (`PUT /api/plans/:id`) → pro Bearbeitungs-Session zig identische
Zeilen. Zwei Maßnahmen:
- **Coalescing (A):** Neue Helper-Funktion `auditLogCoalesced()` (`db/init.js`). Innerhalb von
  `AUDIT_PLAN_UPDATE_WINDOW_MIN` Minuten (Default **10**, 0 = aus) wird pro User+Plan KEINE neue
  Zeile geschrieben, sondern der Zeitstempel des vorhandenen `plan_update` gebumpt → genau **eine**
  Spur je Session. `plans.js` nutzt das im Autosave-Zweig; **Umbenennungen** (`name` im Body) gehen
  weiterhin über `auditLog()` als eigene Zeile (seltenes, bedeutsames Ereignis).
- **Retention (D):** `startAuditLogCleanup()` (`db/init.js`, aufgerufen in `server.js`) löscht
  `plan_update`-Einträge älter als `AUDIT_PLAN_UPDATE_RETENTION_DAYS` (Default **30**, 0 = aus) –
  einmal beim Start (verdichtet Altbestand sofort) + alle 24 h. Unabhängig von `PLAN_RETENTION_DAYS`.
  Sicherheitsrelevante Aktionen (login, plan_share, plan_delete, admin_*) bleiben unberührt.
- Test: `test/audit-coalesce.test.js`.

### Feature 43: Hauptwache wie ein San-Turm (`hwSanTower`)
Neuer globaler Schalter „Hauptwache wie San-Turm (immer 1 Sanitäter)" neben der BF-an-HW-Option.
Ist er aktiv und gibt es einen Sanitäter im Guard-Pool, sitzt jeden Tag mindestens **ein
Sanitäter** aktiv an der HW – analog zu `sanTower`-Türmen (Feature 33), nur eben für die
Hauptwache.
- **`generate.js`:** Nach der San-Turm-Reservierung (`reservedSanByTower`) wird – wenn `hwSanTower`
  und ein freier HW-Slot vorhanden – genau EIN Sanitäter vorab aus dem Guard-Pool gezogen
  (`reservedSanForHW`) und vor der BF-an-HW-Pflicht als fester `mainGuard` platziert. So kann die
  normale HW-Befüllung (die Sanitäter sonst „zuletzt" sortiert) das nicht verhindern. **San-Türme
  haben Vorrang** (deren Reservierung läuft davor); faire Rotation über `hwGuardDays`/`total`.
- **Verdrahtung:** State `hwSanTower` (Def false) an den 3 üblichen Stellen (`state.js`,
  `state-io.js` `_buildStateObject`/`importStateJSON` + UI-Sync), Checkbox `#hw-san-tower` in
  der HW-Konfiguration, Handler in `init.js`. Test: `test/hw-san-tower.test.js`.

### Feature 42: HW rotiert pro Besuch (analog zum Turm-Wiederholungsbesuch)
Die HW-Zuweisung rotiert jetzt **pro bisherigem HW-Dienst** – analog zur Turm-Strafe
`towerVisitWeight` (200 pro Turmbesuch). Zuvor war die HW-Strafe schwächer (60) bzw. nur eine
pauschale „war gestern HW"-Strafe; Personen konnten dadurch zufällig mehrere Tage am Stück an der
HW sitzen.
- **`generate.js` (`bestPair`, HW-Zweig `isMain`):** Strafe `hwVisits × hwVisitWeightHW` – je mehr
  HW-Tage jemand schon hatte, desto teurer ein erneuter HW-Dienst. Dieselbe pro-Besuch-Ordnung
  greift in der HW-Einzelbefüllung (Sort-Tiebreaker nach `hwVisits`).
- **Parameter:** `hwVisitWeightHW` von 60 → **200** angehoben (Turm-Niveau). Die zwischenzeitlich
  eingeführte pauschale `consecutiveHwPenalty` (+ `prevHwSet`/`prevHwGuardSet`-Logik) wurde wieder
  **entfernt** – rein pro-Besuch ist gewünscht, ohne Gestern-Bezug.
- **UI:** Regler „HW-Wiederholungsbesuch" in der Gruppe „Hauptwache (HW)" (`render-sidebar.js`), 0–1000.

### Feature 41: Druck „1 Tag = 1 Seite" + Admin-Audit-Log-Pagination
- **Druck (`Wachplan-Generator.html` @media print):** `break-inside:avoid` auf `.day-panel`/
  `.towers-grid` entfernt – es schob ganze Blöcke (bei Warn-Notices durch geschlossenen Turm/
  Abwesende) auf die nächste Seite und hinterließ leere bzw. Nur-Warnmeldung-Seiten. Jetzt
  erzwingt nur `page-break-after` je Tag die Regel; einzelne Karten bleiben via
  `break-inside:avoid` auf `.tower-card` intakt, dichteres Raster (`minmax(185px)`, `gap:3mm`)
  hält den Inhalt kompakt.
- **Audit-Log (`admin.html` + `api/admin.js`):** Seitengröße 10/25/50/100/Alle + klassische
  Seiten-Navigation (1, 2, 3, … mit Ellipsen, ‹/›). Endpoint liefert zusätzlich `total`
  (gefiltert), `limit=all` = ohne Limit; sonst server-seitiges `LIMIT/OFFSET`.

### Feature 38: Öffentliche Beobachter-Links (Nur-Ansicht ohne Login)
Eingeloggte Nutzer erstellen pro Plan einen **Beobachter-Link** (7 Tage gültig), mit dem
Wachgänger den Plan **ohne Account nur ansehen**.
- **Backend:** Tabelle `plan_public_links` (nur SHA-256-Hash des 256-Bit-Tokens, `expires_at`,
  `revoked_at`, CASCADE). `plans.js` (Owner): `POST/GET/DELETE …/public-link[s]` (Token einmalig
  im Klartext). `api/public.js` (**kein Auth**): `GET /api/public/plan/:token` → entschlüsselt mit
  Owner-Key, liefert nur `{name,state}`, `no-store`; ungültig → 404 (keine Enumeration). Audit
  `plan_public_link_create/_revoke`.
- **Frontend:** Bereich „👁 Beobachter-Link" im Teilen-Modal (`share.js`, URL `…/?view=TOKEN`).
  `login-modal.js` `initPublicView(token)` erkennt `?view=TOKEN` vor allen Auth-Checks, erzwingt
  `currentPlanCanEdit=false` (→ `body.view-only`, Feature 30), überspringt Login/Autoload/Realtime.
  Flag `isPublicView` blendet Konto-/Plan-Knöpfe der `vo-bar` aus. Fix
  `body.view-only .panel-output{grid-column:1}` (sonst gestaucht).

### Feature 36: Vollständiges Audit-Log für Benutzer-Aktionen (Issue #293)
Alle schreibenden Aktionen geloggt: `login`/`logout` (`auth.js`), `plan_create/_update/_delete/
_share/_share_revoke` (`plans.js`), `plan_import` (`import.js`). Nur Metadaten, nie Plan-Inhalt;
fire-and-forget (`.catch()`). `login`/`logout` bewusst geloggt (DSGVO Art. 5 Abs. 2).

### Feature 40: Plan duplizieren („Als Vorlage verwenden") (Issue #223)
„⧉"-Button je Plan im Manager dupliziert ihn als neuen, unabhängigen Plan des aktuellen Nutzers
(dessen Owner-Key): `GET /api/plans/:id` → State klonen → `POST /api/plans`. Checkbox „manuelle
Zuweisungen übernehmen" (Default an); `dayState` stets kopiert. `duplicatePlanById` (`state-io.js`)
+ `plans-ui.js`. Nicht im Browser verifiziert (reiner Netzwerk-Flow über getesteten POST-Pfad).

### Feature 5: BF-Schutz (surplusBF-Penalty)
Übrige BF nicht an Türmen mit aktivem Boot: +800 auf aktiv-Boot-Turm, -350 auf deaktiviert (1150 Swing).

### Feature 6 (deprecated): HW-Boot
Ehem. dediziert (`hwBoatId`); seit v0.4.13 obsolet – Boote der HW uniform via `towerId='HW'`.

### Feature 7: Erweiterte Fairness-Metriken
Stats-Bar: `avgHwVisits | avgTowerWithBoatDays` + Boot-Paarungs-Diversität %. Grün=ok, Orange=Schieflage.

### Feature 8: Konsekutive-Tage-Regel
`checkConsecutiveTowerPenalty` (+200/Person, wenn Vortag selber Turm) → Verteilung über Türme. Soft.

### Feature 9: Metriken-Toggle
`fairnessMetricsDisplay`-Flags (hwBoatBalance/towerDistribution/boatPairingDiversity) + Checkboxen;
`syncMetricCheckboxes()` nach Import.

### Feature 10: Pro-Person Tower-Statistik
`renderTowerStatsPerPerson()`: Person | Gesamt | Unique Türme | Details; grün ≥50% Türme.

### Feature 11: Seed-basierte Start-Konstellationen
`applySeedConstraints(seed)` (0–999): 0=Standard, sonst deterministische Permutation der E/U+BF auf
Tag 1; gleiche Gesamtfairness (Balancierung ab Tag 2).

### Feature 12: Pro-Turm Führungskräfte (`leaderCount`) — ersetzt durch Feature 34
`leaderCount` (0–3, additiv zu slotCount), F aus separatem `poolF`. **Seit Feature 34 durch
`leaderTower`-Haken ersetzt.**

### Feature 13: Vereinheitlichtes Erfahrungs-Flag (`experienced`)
`role:'F'|'B'|'W'` + `experienced` ersetzt E/U-Modell + `bfLevel`. Helfer `effLevel/roleDot/
roleLabel`; Migration `migratePerson()`, STATE_VERSION 4→5.

### Feature 14: Single-Page Layout + mobile Tab-Umschaltung
Sidebar+Output side-by-side (Desktop), 1 Panel via Segment-Leiste (Mobile). `setupMobileSwitch()`.

### Feature 15: Konfigurierbare Dienstzeiten
`serviceStartHour/EndHour` (Def 9/17, clamp 8–19); `fillHours()` erzwingt end≥start. STATE_VERSION 3→4.

### Feature 16: CSV-Export Pro-Person Fairness
`exportStatsCSV()`: Nr|Person|Rolle|Einsätze|HW-Tage|Türme|Turmbesuche|Boot-Tage|Turm+Boot. UTF-8+BOM.

### Feature 17: Reset aller manuellen Zuweisungen
Button „↺ … (n)"; `countForced()`/`clearAllForced()`.

### Feature 18: Letzter Login im Admin-Panel
`users.last_login` (NULL=nie), nur bei echtem Login; `GET /api/admin/users` → `lastLogin`.

### Feature 19: DSGVO-Datenminimierungs-Hinweis im Labels-Feld
Infobox + `maxlength=200`. v0.4.13.

### Feature 20: Login „Merke mich" (30 Tage)
Checkbox → Session-Cookie 30 statt 7 Tage (`rememberMe` → `cookie.maxAge`). v0.4.14.

### Feature 21: Audit-Logging (DSGVO Art. 5 Abs. 1 f)
`audit_log`-Tabelle + Indizes; `GET /api/admin/audit-log` (Filter action/user_id, Paginierung
1–500). Keine Auto-Löschung. Admin-UI read-only Tabelle (`loadAuditLog`, `AUDIT_ACTION_LABELS`),
nur Metadaten via textContent (Issue #154). v0.4.15.

### Feature 22: Selbstregistrierung
`REGISTRATION_MODE` (disabled|open|code). `POST /api/auth/register` + `…/registration-status`;
neuer User `is_admin=0`, Rate-Limit 10/15min, non-enumerable Fehler, Auto-Login. Register-View mit
Datenschutz-Checkbox + optionalem Code. v0.4.16.

### Feature 23: Plan-Retention & Auto-Löschung (DSGVO Art. 5 Abs. 1 e)
Pläne > `PLAN_RETENTION_DAYS` (Def 90, off ≤0) → `marked_for_deletion=1`, 7 Tage Gnadenfrist.
Täglicher Scheduler; CASCADE auf plan_shares; Cleanup als System-Event (`plan_cleanup`,
user_id=NULL). v0.4.17.

### Feature 24: Datenschutzerklärung (DSGVO Art. 13/14)
`public/datenschutz.html` (standalone, Dark). Verlinkt aus Register-View. v0.4.18.

### Feature 25: Hauptstrand-Türme (Strand-Ausgleich)
Turm-Flag `mainBeach`. `beachBalancePenalty` (overhang*60) hält pro Person Hauptstrand-↔Außen-
Verhältnis im Gleichgewicht; nur aktiv, wenn beide Turm-Sorten existieren. Stats `mainBeachDays`/
`outerBeachDays`. UI-Toggle + Badge 🏖️. Test in `invariants.test.js`.

### Feature 26: Bootsführer mit HW-Wunsch
Flag `wantsHW` (nur B): bei BF-Überzahl ≥1 aktiver HW-Dienst/Woche. Stat `hwGuardDays`;
`hwWishBonus` eskaliert (600→6000→100000); Sicherheitsnetz im `availB`-Sort bei `daysLeft≤2`. Nur
bei echter Überzahl. Test in `invariants.test.js`.

### Feature 27: Komplett-Abwesenheit (zusätzlich zu „außer Dienst")
Pro Tag `dayState[d].absent`: Person wird gar nicht eingeplant, zählt nicht (total/hwVisits=0),
nicht in XLSX/Druck. `isAbsent()` schließt aus Pools/forced/sick aus; `absentCount`. UI-Sektion
„👋 Komplett abwesend", exklusiv zu `sick`, Tab-Flag 👋. Status-Sektionen sind jetzt einklappbare
`<details>` (`dcSection()`, zu by default, Count-Badge). STATE_VERSION 6→7. Tests: `absentPersonIds`,
`checkAbsentNotAssigned`.

### Feature 28: Fairness-Balkendiagramme (Issue #225)
3 togglebare SVG-Diagramme (Einsätze/Person, HW-Tage/Person, Turmauslastung) mit Ø-Linie,
grün/orange. Reines SVG/CSS (CSP-konform). `renderAssignmentsChart/HWDaysChart/TowerUtilizationChart`
+ `renderFairnessCharts`. State `fairnessChartsDisplay`. Im Druck aus.

### Feature 30: Beobachter-Modus (Nur-Ansicht)
Pläne mit Share-Rolle `view` (`currentPlanCanEdit===false`) öffnen minimalistisch.
`_updateSaveIndicator()` schaltet `body.view-only` → blendet Sidebar/Steuerungen/Export/Stats/
↕-Buttons aus, einspaltig. `render-output.js`: schlanke `.vo-bar` + Tag-Nav, kompakte `.vo-day-head`,
Occupants nicht draggable, early-return vor Editier-Listenern. Erfahrung verborgen
(`roleLabelSafe`/`roleDotSafe`, UU-Warnungen unterdrückt).

### Feature 29: Version-Badge an GitHub-Releases + Update-Hinweis
`@semantic-release/git` committet den Bump zurück nach `main` (package.json war stehengeblieben).
`GET /api/version` → `{version, latest, releaseUrl, updateAvailable}`; `latest` serverseitig von
GitHub (Cache 6h). Badge grün/gold + Toast (`checkForUpdate`, einmal/Version). Caveat:
Branch-Protection braucht Actions-Ausnahme für den Release-Commit.

### Feature 37: E-Mail-Verifizierung, reCAPTCHA v3 & Passwort-Reset
Env-gesteuert, einzeln optional (Setup: docs/REGISTRATION.md).
- **Mail (`mailer.js`):** `SMTP_*`+`APP_BASE_URL`; `MAIL_TRANSPORT=outbox` für Tests.
- **Verifizierung:** mit SMTP E-Mail Pflicht, `pending_verification=1`, Login vorher 403
  `email_unverified`; `GET /verify-email?token`.
- **Reset:** `POST /request-password-reset` → Link (60min) → `POST /reset-password` (alle Sessions
  invalidiert, gilt als Bestätigung). Plan-Key unberührt.
- **Tokens (`auth_tokens`):** nur SHA-256-Hash, Einmal-Nutzung, Epoch-ms-Ablauf.
- **reCAPTCHA (`captcha.js`):** bei `RECAPTCHA_*`, Action-Bindung + Score, fail-closed; CSP nur
  dann um Google erweitert.
- Tests: `auth-flow.test.js` (17 Subtests).

### Feature 30: Kompaktere Top-Bar + einklappbare Sidebar (`layout-chrome.js`)
Titel kompakt; „ℹ Info"-Button klappt `#header-info` (Badge+Beschreibung,
`localStorage['dlrg_header_info_open']`). Sidebar (Desktop ≥901px) ein-/ausklappbar
(`dlrg_sidebar_collapsed`); Mobile via Tab-Switch.

### Feature 31: Wachliste hochladen → dynamische Namensliste (CSV/PDF) (`roster.js`)
Upload der DLRG-Wachliste; `people[]`+tageweise `absent` dynamisch aus Startdatum+DAYS abgeleitet.
- **Parsing:** `parseRosterCSV` (Semikolon, Header-Mapping); `parseRosterPDF` via pdf.js (lazy von
  cdnjs, Main-Thread-Fake-Worker), inhaltsbasiert (`_pdfParseLine`).
- **Normalisierung:** Status „zugesagt", Job→Rolle (WF→F/BF→B/RS→W), Datum→ISO → `roster[]`.
  STATE_VERSION 7→8.
- **Ableitung:** `deriveRosterPeople`/`applyRosterToWindow` über `[startDate … +DAYS-1]`; Tage
  außerhalb Verfügbarkeit → `absent`; importierte starten unerfahren; neu bei Datum/Tage-Änderung.
- **Overrides:** Hand-Korrekturen (Rolle/Erf./HW/Labels/Sani) in `rosterOverrides` (norm. Name),
  via `mergeRosterOverrides` nach jedem Ableiten wieder aufgelegt.
- **Wechseltag:** Verfügbarkeit halb-offen `[von, bis)` (Abreisetag kein Dienst); `von==bis` → 1 Tag.
- **CSP:** `worker-src … cdnjs` (pdf.js).

### Feature 32: Bei BF-Überschuss immer 1 BF auf der HW (`requireBfAtHw`)
Globaler Schalter: bei echter BF-Überzahl (`poolSBF` nicht leer) täglich ≥1 überzähliger BF als
fester `mainGuard` (fairste Rotation: wenig `hwGuardDays`), Rest regulär. Komplementär zu Feature
26 (per-Person-Wunsch). State default false. Tests: `require-bf-hw.test.js`.

### Feature 33: Sanitäter & San-Türme
Person-Flag `sanitaeter` + Turm-Flag `sanTower`. Pro Tag `sanActive` = offener San-Turm UND
Sanitäter im Pool – nur dann: `sanTowerBonus` (5000, einmal/Paar) zieht einen Sanitäter an,
solange der San-Turm noch keinen hat; `sanReservePenalty` (350) hält Sanitäter von Nicht-San/HW
frei (hebt sich unter Sanitätern auf → Fairness bleibt). Rotation aus bestehenden Strafen;
wichtigster Turm (prio asc) zuerst. STATE_VERSION 8→9. Tests: `san-tower.test.js`.

### Feature 34: Führungstürme (`leaderTower`-Haken, ersetzt `leaderCount`)
Markierter Turm bekommt wenn möglich genau 1 F auf einen **regulären** Slot (kein Zusatz-Slot).
F aus separatem `poolF`, vor regulärer Befüllung gesetzt (fairste Rotation). `expDemand` zählt
gedeckte Führungstürme nicht. Migration `leaderCount>0`→`leaderTower:true` (Zusatz-Slots in
`slotCount`, max 10), STATE_VERSION 9→10. Tests: `leaders.test.js`.

### Feature 35: Auch Bootsführer können Sanitäter sein
San-Haken jetzt auch für B. Überzählige BF (`poolSBF`, im Guard-Pool) decken San-Türme ab; aktive
BF fahren Boot. `sanActive`-Gating prüft den ganzen `getGuardPool()`. Tests: `san-tower.test.js` (+1).

### Feature 47: Tag sperren (`lockedDays`)
Pro-Tag-Knopf **„🔓 Tag sperren"** in der Tages-Steuerung (`render-output.js`, `dc-head`). Use-Case:
Ist die Planung eines Tages fertig, sichert man ihn – Änderungen an anderen Tagen (Krankmeldung,
Turm/Boot schließen, Person-/Konfig-Änderungen, manuelles Verschieben) berechnen ihn dann **nicht
mehr neu**. Mechanik: neues State-Set `lockedDays` (Tag-Indizes). `generate()` behandelt einen
gesperrten Tag wie den behaltenen Prefix bei der Teil-Neuberechnung – statt ihn neu zu generieren,
wird `lastResult.schedule[d]` übernommen und seine Stats via `_reAccumulateDayStats` re-akkumuliert
(faire Folgetage). Der frühere separate Prefix-Loop wurde dafür in den Haupt-Loop integriert
(`d < startDay || lockedDays.has(d)` ⇒ behalten). UI: gesperrte Tage zeigen ein 🔒 im Day-Tab,
blenden die Editier-Sektionen aus, machen Personen/Boote nicht verschiebbar (`draggable=false`,
keine ↕-Buttons) und heben die `.day-controls` grün hervor; der Knopf wechselt zu „🔒 Gesperrt".
Sperren löst KEIN `generate()` aus (bestehender Plan bleibt) – nur Re-Render + Autosave. Persistenz:
`lockedDays` als Array in `_buildStateObject()`/`importStateJSON()` (Indizes ≥ DAYS werden verworfen),
`STATE_VERSION` 10 → 11.

**Reload-Fix (`STATE_VERSION` 11 → 12):** `lastResult` (der berechnete Plan) wird NICHT
mitserialisiert – nach einem Reload ist es `null`. Da jeder Load (autoLoad/loadPlan/Realtime) ein
`generate()` auslöst, griff der Schutz `lastResult?.schedule?.[d]` nach einem Reload nicht mehr → der
gesperrte Tag wurde neu berechnet und veränderte sich „im Nachhinein doch" (besonders bei `randomSeed=0`
oder nach manuellem Verschieben, wo der Tag vom Voll-Lauf abweicht). Fix: `_buildLockedSchedules()`
friert die Schedule-Einträge der gesperrten Tage als JSON-Snapshots ein (`lockedSchedules` im State,
Personen als Plain-Objekt-Kopien). `importStateJSON()` hebt sie in ein **sparse `lastResult`** (nur die
gesperrten Indizes belegt), bevor das nachgelagerte `generate()` läuft – so übernimmt es den gesperrten
Tag bit-genau statt ihn neu zu rechnen. `lastResult` wird dabei nur überschrieben, wenn es gesperrte
Tage MIT gesichertem Schedule gibt (sonst unangetastet → manueller Datei-Import rendert wie gehabt).
Altpläne ohne `lockedSchedules` verhalten sich wie zuvor (Default leer). Tests: `test/locked-days.test.js`
(jetzt 4 Checks inkl. Reload-Überlebens-/Bug-Reproduktions-Test).

### Feature 44: Impressum + editierbare Betreiberangaben (Admin-Panel)
Neues, in Deutschland pflichtiges **Impressum** (`public/impressum.html`, § 5 DDG / § 18 Abs. 2 MStV)
plus dynamische **Datenschutz-Betreiberangaben** (Verantwortlicher/Kontakt). Beide Seiten ziehen die
Daten auth-frei via `GET /api/public/site-info`. Gepflegt werden sie im Admin-Panel
(Karte „📄 Impressum & Datenschutz") über `GET`/`PUT /api/admin/site-settings` (Admin-only,
Audit-Log `admin_site_settings_update`). Speicher: neue Tabelle `site_settings` (Key/Value), Felder
als Whitelist in `server/db/site-settings.js` (z. B. `org_name`, `org_street`, `org_zip`, `org_city`,
`represented_by`, `contact_email`, `register_court`, `dpo_name`, `supervisory_authority` …) – unbekannte
Keys werden ignoriert, Werte getrimmt/gekappt (1000 Zeichen). Fehlen Angaben, zeigen beide Seiten einen
neutralen Platzhaltertext. Footer im Login-Modal verlinkt Impressum + Datenschutz.

### Feature 45: Audit-Log – Benutzername + Standort, echte Client-IP
Drei Verbesserungen der Admin-Audit-Log-Ansicht (`public/admin.html`, `GET /api/admin/audit-log`):
- **Benutzername statt „#3":** Der Endpoint macht jetzt ein `LEFT JOIN users` und liefert `username`
  mit; das Frontend zeigt den Namen (Fallback `#id` für Altdaten, sonst „System"). LEFT JOIN, weil
  `user_id` für System-Events bzw. nach Nutzer-Löschung (`ON DELETE SET NULL`) NULL ist.
- **Standort aus IP (offline):** Neues Modul `server/geoip.js` (`lookupLocation`) leitet per
  **geoip-lite** (lokale MaxMind-GeoLite-DB, neue Dependency) Stadt/Land aus der IP ab (fehlt die
  Stadt, dient das Bundesland als grober Ort – DE-Codes ausgeschrieben) – **kein**
  externer Aufruf (DSGVO-konform). Berechnung beim Lesen (keine Schema-Änderung). Private/interne
  IPs (RFC 1918, CGNAT, Loopback, ULA) → kein Standort. geoip-lite ist optional `require`-t: fehlt
  das Paket/die DB, läuft der Log ohne Standortspalte weiter. DB-Update beim Maintainer:
  `node node_modules/geoip-lite/scripts/updatedb.js`.
- **Echte Client-IP hinter NGINX:** Zeigte das Log überall die Container-IP (`172.23.0.x`), lag das
  NICHT am App-Code (`trust proxy` ist gesetzt, `req.ip` korrekt), sondern an einem NGINX, der
  `X-Forwarded-For` nicht weiterreicht. Fix im Reverse-Proxy:
  `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` (+ `X-Forwarded-Proto $scheme;`).
  Bei mehreren Proxy-Hops (z. B. Cloudflare → NGINX) `app.set('trust proxy', <Hop-Anzahl>)` erhöhen.

### Echte Client-IP: konfigurierbar + code-seitige Auto-Ermittlung
Nachgereicht zu Feature 45, damit die echte IP ohne Reverse-Proxy-Umbau erscheint:
- **`TRUST_PROXY`-Env** (Default 1) macht den Trust-Proxy-Hop-Count konfigurierbar
  (`trustProxyValue()` in `server/http-common.js`; genutzt in `server.js` + `admin-server.js`) →
  Multi-Hop-Setups (Cloudflare → NGINX) ohne Code-Edit.
- **Code-seitige IP-Ermittlung (Default):** Middleware `overrideClientIp()` setzt `req.ip` aus den
  Proxy-Headern (`CF-Connecting-IP` → `X-Real-IP` → erstes `X-Forwarded-For`), Fallback = Express'
  `req.ip`. Dadurch sehen **Audit-Log und Rate-Limiting** die echte IP, ohne NGINX/Cloudflare zu
  ändern. **Trade-off:** diese Header sind fälschbar, wenn der Origin direkt erreichbar ist →
  für Robustheit Origin auf Cloudflare-Netze beschränken bzw. proxy-seitige „Variante A".
- **Proxy-seitige Variante A** (robust): `docs/nginx.cloudflare.conf.example` +
  `docs/DEPLOYMENT.md` (Abschnitt „Echte Client-IP hinter Reverse-Proxy / Cloudflare").

---

## Bugfixes

### Bootsführer per D&D aufs Boot ziehen landete fälschlich auf dem Turm
Zog man eine Person (z. B. einen Bootsführer) per Drag-and-Drop direkt auf ein inline unter einem
Turm gerendertes Boot, wurde sie immer **dem Turm** statt dem Boot zugeordnet. **Ursache:** Das
inline-Boot (`renderInlineBoat`) war ein nackter Kind-Knoten der `.tower-card` ohne eigenes
Drop-Ziel; der Drop-Handler löste über `e.target.closest('.tower-card')` auf → `dropKind:'tower'`.
(Der ↕-Modal-Weg funktionierte korrekt, weil `_applyMove`/`generate.js` `kind:'boat'` längst
kannten.) **Fix:** Jedes inline-Boot bekommt eine eigene Drop-Zone (`.boat-drop-zone`,
`data-drop-kind="boat"` / `data-drop-slot=boatId`). Dragover/Dragleave/Drop in `render-output.js`
prüfen jetzt zuerst `closest('.boat-drop-zone')` und nutzen dessen Ziel (Boot) statt der Turmkarte;
eigener Highlight + lesbarer Zielname (🚤 …) in der Bestätigung. Rollen-Warnung (Nicht-BF aufs Boot)
greift dadurch ebenfalls erstmals bei D&D.

### Spät-Einsteiger saß nur am Hauptstrand (Beach-Balance vs. Turm-Rotation)
Analog zum HW-Parking: Eine Person, die erst mitten in der Woche dazukam, landete an **jedem** ihrer
Tage nur auf Hauptstrand-Türmen (nie Außenturm). **Ursache:** `towerVisitWeight` (200) zieht einen
„Blank-Slate"-Spät-Einsteiger (0 Besuche auf **jedem** Turm → überall am billigsten) in die zuerst
befüllten Türme; da Haupt-Türme i. d. R. die höchste Prio haben (zuerst dran), bekam er Tag für Tag
nur Hauptstrand. Die Beach-Strafe (`beachBalanceWeight` 60) war zu schwach, um die 200 zu überbieten
– und ein reiner Default-Wechsel hätte gespeicherten Plänen (die `beachBalanceWeight:60` mitspeichern)
nicht geholfen. **Fix (strukturell):** `beachBalancePenalty` nutzt jetzt
`overhang × max(beachBalanceWeight, towerVisitWeight)` → die Strand-Balance ist nie schwächer als die
Turm-Wiederholungs-Rotation, unabhängig vom gespeicherten Knopf. Ein höherer User-Wert wird weiter
respektiert. Ergebnis: ausgewogenes Haupt/Neben-Verhältnis auch für Spät-Einsteiger; 107/107 Tests grün.

### „Letzter Login" blieb bei „Angemeldet bleiben" auf dem ersten Login stehen
Wer „Angemeldet bleiben" (rememberMe) wählte, durchlief `/api/auth/login` nur einmal; danach stellte
jeder Seitenaufruf die Session über `GET /api/auth/me` wieder her, **ohne** `last_login` zu aktualisieren.
Im Admin-Panel sah es dadurch so aus, als wäre der Nutzer seit Wochen nicht mehr aktiv gewesen.
**Fix:** `/api/auth/me` aktualisiert `last_login` jetzt auch bei wiederhergestellter Session – gedrosselt
auf höchstens 1× / 10 min (`WHERE last_login IS NULL OR last_login < datetime('now','-10 minutes')`),
damit nicht jeder Request schreibt. CURRENT_TIMESTAMP (UTC) bleibt konsistent mit `/login`.

### EE-Turm neben UU-Turm trotz genug Erfahrenen (Türme rein unerfahren besetzt)
Bei genügend Erfahrenen für alle Türme (z. B. 9 Erfahrene, 7 Türme) saßen trotzdem **zwei
Unerfahrene** auf einem Turm (UU), während ein anderer Turm **zwei Erfahrene** (EE) doppelte und
die HW zwei Erfahrene bekam. **Ursache:** Die EE-Paar-Strafe war nur stark (`eePenaltyReserve`
1500), wenn Erfahrene global *knapp* sind (`reserveExpAtHW = availE ≤ expDemand`). Bei Überschuss
griff nur `eePenaltyNormal` (40) – zu schwach, um zu verhindern, dass ein Turm zwei Erfahrene
„verbraucht" und ein späterer Turm (prio-letzter) ohne Erfahrenen UU wird.
**Fix:** Die EE-Strafe ist jetzt auch stark, solange überhaupt noch **Unerfahrene im Pool paarbar**
sind (`uAvailable` in `bestPair`) – dann ist für jeden Turm ein E+U-Paar möglich und wird dem
E+E-Paar vorgezogen. So bekommt jeder Turm genau **einen** Erfahrenen (alle EU), überzählige
Erfahrene gehen an die HW; ein EE-Turm entsteht nur noch, wenn keine Unerfahrenen mehr übrig sind
(voll erfahren = unbedenklich). Priorität: kein Turm rein unerfahren, solange Erfahrene reichen.

### Spät-Einsteiger klebten an der HW (HW von `total` entkoppelt + San-Vorab-Reservierung)
Eine Person, die erst mitten in der Woche dazukam (erste Tage abwesend), saß **jeden** ihrer Tage an
der HW (z. B. 4 Tage in Folge). **Ursache:** Die HW wird **vor** den Türmen befüllt und ihre Auswahl
nutzte den `total`-Ausgleich (Gesamteinsätze). Ein Spät-Einsteiger hat strukturell den niedrigsten
`total` – obwohl er an **jedem anwesenden Tag aktiv** (also voll ausgelastet) ist, lässt sich der
Rückstand im Fenster nie aufholen. Sowohl die HW-**Einzelbefüllung** (sortierte primär nach `total`)
als auch das HW-**Paar** in `bestPair` (am letzten Tag, wenn alle `hwVisits` gleich sind, entschied
der `total×10`-Tiebreak) zogen ihn so jeden Tag wieder auf die HW.
**Fix:** Die HW-Auswahl rotiert jetzt **rein nach `hwVisits`**; der `total`-Ausgleich gilt nur noch
für **Türme** (`bestPair`-Term `if(!isMain)`, HW-Einzelbefüllung ohne `total`). Sein Rückstand wird
damit auf echten Wachdiensten (Türmen) aufgeholt, nicht an der HW. **Voraussetzung dafür:**
Sanitäter werden jetzt **vorab reserviert** (analog Führungsturm, s. Feature 33): ohne den
`total`-Deterrent hätte die HW sonst den dauer-aktiven Sanitäter (`hwVisits=0`) verbraucht. Pro
offenem San-Turm wird ein Sanitäter **vor** der HW-Befüllung fest aus dem Guard-Pool gezogen
(`reservedSanByTower`) → robuste San-Besetzung statt nur penalty-basiert. Ergebnis: Der
Spät-Einsteiger ist nur noch an seinem **ersten** anwesenden Tag an der HW, danach auf Türmen.

### SQLITE_CORRUPT-Wurzelfix: Admin-Panel in den Hauptprozess eingebettet
Transiente `SQLITE_CORRUPT` im Betrieb = prozessübergreifender SQLite-Zugriff auf NAS/Netzwerk-
Volume (seit Audit-Log #294 schrieben **beide** Container in `audit_log`). **Lösung:** nur **ein**
Prozess öffnet die DB – `admin-server.js` exportiert `createAdminApp({sessionMiddleware})`,
`server.js` startet damit einen zweiten Listener (`ADMIN_PORT`) im selben Prozess (geteilte
Connection); `docker-compose.yml` nur noch 1 Container. `RUN_EMBEDDED_ADMIN=0` = klassisch (eigene DB).

### SQLITE_CORRUPT-Dauerfix: Rollback-Journal (DELETE) statt WAL
WAL-`-shm` ist prozessübergreifend nicht kohärent → frische DB korrumpierte beim ersten Write.
**Lösung:** `PRAGMA journal_mode=DELETE` an allen Writer-Connections (`connection.js`/`init.js`/
`session.js`; init konvertiert WAL zurück) + `busy_timeout=5000`. Test `db-journal-mode.test.js`.

### Auto-Heilung beschädigter `sessions`-Tabelle beim Start
Ist die Korruption **nur** auf `sessions`/Autoindex beschränkt (`isSessionsOnlyCorruption()`),
wird sie automatisch entfernt (DROP→VACUUM→Re-Check); Nutzer/Pläne unberührt.
`DB_NO_SESSION_AUTOHEAL=1` deaktiviert. Test `db-session-autoheal.test.js`.

### admin-server.js: globale Error-Handler auf Modulebene + Exit (#274)
Handler aus `start()` auf Modulebene gezogen, `process.exit(1)` bei DB-Fehlern – analog `server.js`.

### Zwangszuweisung auf geschlossenen Turm ließ Person verschwinden (#308)
Effektive Turm-Zwangszuweisung auf geschlossenen Turm → Person nirgends platziert. **Lösung
(`generate.js`):** `forcedByTower`-Einträge ohne offenen Turm vor HW-finalize als `mainGuards`
auffangen. Test `forced-closed-tower.test.js`.

### Session-Store lag in In-Memory-DB (Feature-30-Beifang)
`mode:0o666` = sqlite3-Flag `OPEN_MEMORY` → Sessions nicht persistent (Merke-mich/GDPR-Löschung
no-op). **Lösung:** `{dir, db: basename}` ohne `mode`; `DROP TABLE sessions`-Migration nur bei
altem Schema; vor Store-Erstellung `await dbRun('SELECT 1')`.

### Plan-Retention-Cleanup lief nie – `db` undefined (#272)
`require('./db/connection').db` ist undefined → `getDb()` übergeben + `cleanupRunning`-Guard.

### Plan-Retention: Speichern hob Lösch-Markierung nicht auf (#305)
`PUT /api/plans/:id` setzt jetzt `marked_for_deletion=0, …_at=NULL` → aktiv genutzter Plan nie
löschmarkiert.

### Teil-Neuberechnung driftete die Fairness (#307)
`_reAccumulateDayStats` ≠ Voll-Lauf: (1) HW-Paare in `pairCount` fehlten → `mainPairs` nachgezogen;
(2) `towerWithBoatDays` nur besetzte Boote → besetzte + aktive-unbesetzte rekonstruiert; (3)
`hwGuardDays` fälschlich an `fuehrung` → getrennt. Test `partial-regen-equivalence.test.js`.

### Robustheit/Wartbarkeit (#273)
Export-Memory-Leak → `downloadBlob()` (revoke) in `utils.js`; WebSocket-Join loggt + validiert
`planId`/`readyState`; Audit-`JSON.parse` pro Datensatz try/catch; `parsePositiveInt` (`db/ids.js`)
statt nacktem parseInt; totes `gdpr-deletion-verification.js` entfernt.

### Fairness – BF-Rotation zu eng (Lookback + Matching, v0.4.24)
`boatRotationPenalty` blickt übers Rotationsfenster (`offene Boote−1`) zurück; **Min-Cost-Matching**
(Branch-and-Bound) statt gieriger Vergabe (Standardfall ≤8 Boote, sonst Fallback). Boot-Rückkehr
<3 Tage 10→0. Invariante in `invariants.test.js`.

### Fairness – Türme ohne Erfahrenen (Experience-Reservierung, v0.4.24)
HW vor Türmen befüllt → zog Erfahrene weg. **Lösung:** bei Knappheit (`availE ≤ offene Türme`)
`reserveExpAtHW` → +5000 für E an HW, U-zuerst, EE-Paar-Penalty 40→1500. Türme ohne Erfahrenen
36→0. Invariante `checkExperienceNotWastedAtHW`.

### Fairness – zu häufige Turm-/Partner-Wiederholungen (#253, v0.4.21)
Turm-Wiederholung linear `v*200`; Fairness `(totalA+totalB)*10`; HW-UU 300; Partner-Wiederholung
×250; Boot-Rotation `lastBoatId`+300, Auswahl per Min-Score statt `shift()`.

### Führungskräfte zählen als erfahren (#251, v0.4.20)
`effLevel('F')='E'` → 3 Unerfahrene + 2 WF an HW möglich, solange jeder Turm ≥1 Erfahrene.

### Passwortlängen-Validierung inkonsistent (#234, v0.4.14)
Frontend ≥8 → ≥10 (Backend-konform; `login-modal.js`, `user-info.js`, HTML-Placeholder).

### openTowers-Bedarf ignorierte leaderCount (#117, v0.4.1)
`need = max(0,(slotCount||2)+(leaderCount||0)-preCount)`.

### `renderHWBoatSelector()` undefined (#233, v0.4.14)
Toter Aufruf (Überbleibsel Feature 6) in `state-io.js` entfernt.

### Neue Pläne erbten Türme/Boote (#204, v0.4.14)
`resetGlobalState()` vor `seedFromConfig()` + defensiv `towers=[]`/`boats=[]`. Start leer
(DAYS=6, mainK=2, 9/17).

### Mobile/Touch: ↕-Button war hover-only (#181)
`@media (hover:none),(pointer:coarse)` zeigt den Button dauerhaft + größeres Target; `:focus-visible`.

### Header-Subtitle „a. D." entfernt (#194)
Reine Text-Änderung.

### XLSX-Export: stille Truncation >16 Spalten (#215)
`truncated`-Flag an allen Abbruchpfaden; `_patchSheetXml`→`{xml,truncated}`; `exportOfficial`
warnt via `confirm()`.

### Security: Plan-Name/State-Größe + parseInt in Admin (#218)
`validatePlanInput` (Name ≤200→400, State ≤1MB→413 gegen Storage-Exhaustion); `parsePositiveInt`
(`db/ids.js`) statt nacktem parseInt in `admin.js`.

### renderOutput() crasht bei lastResult===null (#276, v0.5.2)
Defensiver `if(!lastResult) return;` in `renderOutput()` (vor dem Destructuring).

### Security: Bulk-Import umging Limits + leakte Fehler (#279)
`validatePlanInput` pro importiertem Plan (Name ≤200, State ≤1MB; ungültige übersprungen,
Teilimport bleibt möglich); Client-Fehler generisch, Details nur `console.error`.
