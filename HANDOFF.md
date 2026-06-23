# HANDOFF – DLRG Wachplan-Generator

> **Einstieg für die nächste Session / den nächsten Agenten.** Diese Datei zuerst lesen,
> dann nur bei Bedarf tiefer gehen:
> - **CLAUDE.md** (wird automatisch geladen): Architektur, Datenmodell, Algorithmus-Kern,
>   Codebase-Map, Konventionen & Fallen.
> - **docs/FEATURES.md**: ausführliche Feature-/Bugfix-Historie (nur bei Bedarf).
>
> So muss **nicht die ganze Codebase** gelesen werden, um produktiv zu starten.
> **Pflege:** Diese Datei nach jeder Aufgabe auf den aktuellen Stand bringen (Abschnitt 4/5);
> Doku-Wartungsvertrag s. CLAUDE.md.

**Stand:** Version automatisch via Semantic Release (`package.json` Source of Truth).
`main` ist sauber: Tests grün, alle Server parsen (`node -c`).

**Letzter Lauf (2026-06-23, Bugfix Feature 47: Sperre überlebt Reload – Branch `claude/plan-lock-function-fuj6du`):**
- **Bug:** Gesperrte Tage veränderten sich „im Nachhinein doch". Ursache: `lastResult` wird nicht
  mitserialisiert → nach einem Reload löst jeder Load (autoLoad/loadPlan/Realtime) ein `generate()`
  mit `lastResult==null` aus, der Schutz `lastResult?.schedule?.[d]` greift nicht, der gesperrte Tag
  wird neu berechnet (sichtbar v.a. bei `randomSeed=0` oder nach manuellem Verschieben).
- **Fix (`STATE_VERSION` 11→12):** `_buildLockedSchedules()` friert die Schedules der gesperrten Tage
  als JSON-Snapshots ein (`lockedSchedules` im State); `importStateJSON()` hebt sie in ein sparse
  `lastResult`, bevor das nachgelagerte `generate()` läuft → der Tag wird bit-genau übernommen.
  `lastResult` wird nur überschrieben, wenn es gesperrte Tage MIT Schedule gibt (sonst rendert der
  manuelle Datei-Import wie gehabt). Details: docs/FEATURES.md „Feature 47" (Reload-Fix).
- **Tests:** `test/locked-days.test.js` jetzt 4 Checks (neu: Reload-Überlebens-/Bug-Reproduktion).
  Vor-/Nachher unverändert 12 pre-existing Failures (flaky DB/Session-Tests in Sandbox-FS), mein
  Test bringt +1 Pass, keine Regression. `node -c public/js/state-io.js` grün.

**Letzter Lauf (2026-06-21, Feature 47: Tag sperren – Branch `claude/festive-johnson-j2cwag`):**
- **Feature 47 (Tag sperren):** Neuer Pro-Tag-Knopf „🔓 Tag sperren" in der Tages-Steuerung. Ein
  gesperrter Tag wird bei `generate()` nicht mehr neu berechnet, sondern aus `lastResult` übernommen
  (Prefix-Behalten-Loop in den Haupt-Loop integriert: `d < startDay || lockedDays.has(d)`). Use-Case:
  fertig geplanten Tag sichern, damit Änderungen an anderen Tagen ihn nicht mehr verändern. UI:
  🔒-Flag im Day-Tab, Editier-Sektionen ausgeblendet, Personen/Boote nicht verschiebbar, grüner
  Rahmen. Neues State-Set `lockedDays` (serialisiert in `_buildStateObject`/`importStateJSON`,
  `STATE_VERSION` 10→11). Details: docs/FEATURES.md „Feature 47", CLAUDE.md (State + Algorithmus).
- **Tests:** `test/locked-days.test.js` (3 Checks: Schutz, Plausibilität, Entsperren) + voller
  `npm test` **114/114 grün** (nach `npm install` für sqlite3-Natives).

**Letzter Lauf (2026-06-20, Impressum + editierbare Datenschutz-Angaben + „Letzter Login"-Fix – Branch `claude/sharp-babbage-a3q719`):**
- **Bugfix „Letzter Login":** Bei „Angemeldet bleiben" wurde `last_login` nie aktualisiert
  (nur `/login` schrieb es, nicht der Session-Resume via `/me`). `GET /api/auth/me` aktualisiert
  `last_login` jetzt gedrosselt (max 1×/10 min). Details: docs/FEATURES.md „Bugfixes".
- **Feature 44 (Impressum & Betreiberangaben):** Neue Seite `public/impressum.html` (Pflicht § 5 DDG),
  Datenschutz-Verantwortlicher/Kontakt jetzt dynamisch. Pflege im Admin-Panel (Karte
  „📄 Impressum & Datenschutz") via `GET`/`PUT /api/admin/site-settings`; Anzeige auth-frei über
  `GET /api/public/site-info`. Neue Tabelle `site_settings` + Modul `server/db/site-settings.js`
  (Feld-Whitelist). Login-Modal-Footer verlinkt beide Seiten. Details: docs/FEATURES.md „Feature 44".
- **Tests:** voller `npm test` grün bis auf das bekannt-flaky `auth-flow.test.js`
  (IPC-„Unable to deserialize cloned data" → isoliert 18/18 grün). E2E der neuen Endpoints
  (Login/`/me`-Drosselung, site-settings GET/PUT inkl. Whitelist & Auth-Schutz, public site-info,
  statische Seiten) manuell verifiziert: 14/14 PASS.
- **Hinweis für Betreiber:** Nach dem Update im Admin-Panel die Betreiberangaben (Name, Anschrift,
  Kontakt) eintragen – ohne sie zeigen Impressum/Datenschutz einen neutralen Platzhaltertext.

**Letzter Lauf (2026-06-19, SQLITE_CORRUPT-Wurzelfix – Branch `claude/hopeful-keller-y73g6l`):**
- **Symptom:** Trotz aller vorherigen DB-Fixes (#323–#329: DELETE-Journal, Integritäts-Check,
  Auto-Heilung, busy_timeout, Retries) weiterhin **transiente** `SQLITE_CORRUPT`-Fehler im Betrieb
  (`Save/Create plan error`, `Session save error`), während der Start-`integrity_check` stets „ok"
  meldete. **Wurzelursache:** ZWEI Container (`wachplan` + `wachplan-admin`) öffneten dieselbe
  SQLite-Datei auf dem geteilten (NAS-)Volume. SQLite ist nur **intra-Prozess** sicher; cross-process
  auf NAS/NFS sind Locks/Page-Cache nicht kohärent → transiente Korruption. **Auslöser** = Audit-Log
  (#294), das erstmals beide Prozesse gleichzeitig schreiben ließ → bestätigt die Vermutung „seit dem
  Audit".
- **Fix:** `admin-server.js` → `createAdminApp({sessionMiddleware})` (Auto-Start nur via `require.main`);
  `server.js` bettet das Panel bei gesetztem `ADMIN_PORT` als zweiten Listener im **selben Prozess**
  ein (geteilte Session-Middleware/DB-Verbindung); `docker-compose.yml` läuft als **EIN** Container
  (Ports 3000+3001). `RUN_EMBEDDED_ADMIN=0` = alter Zwei-Prozess-Modus (dann eigene DB nötig).
  Details: docs/FEATURES.md „Bugfixes", CLAUDE.md „EIN Prozess öffnet die DB".
- **Tests: 98/98 grün**; Smoke-Test: ein Prozess bedient `/health` auf 3000 **und** 3001.
- **Deployment-Hinweis:** Nach Update den separaten `wachplan-admin`-Container entfernen
  (`docker compose up -d` mit neuer compose-Datei tut das); Port 3001 ggf. weiterhin per Proxy/Firewall absichern.

**Letzter Lauf (2026-06-16, Feature 37: Registrierung mit E-Mail-Verifizierung – Branch `claude/inspiring-faraday-4ngftk`, gemergt als PR #292):**
- **Feature 37 implementiert** (s. docs/FEATURES.md + **docs/REGISTRATION.md** Setup-Guide):
  Registrierung mit E-Mail-Verifizierung (Pflicht-E-Mail + Bestätigungslink, Login-Sperre
  via `users.pending_verification`), Passwort-Reset per Einmal-Token-Mail (60 min,
  Session-Invalidierung), reCAPTCHA v3 (fail-closed, env-gesteuert, CSP nur bei Keys
  erweitert). Neue Module `server/mailer.js` (nodemailer, neue Dependency) +
  `server/captcha.js`; neue Tabelle `auth_tokens`; `.env.example` erweitert.
- **Bugfix (Beifang, wichtig):** Session-Store lag wegen `mode: 0o666` (= sqlite3-Flags
  inkl. `OPEN_MEMORY`) in einer **In-Memory-DB** → Merke-mich überlebte keinen Neustart,
  GDPR-Session-Löschung in admin.js war No-op. Fix in `db/session.js` (+ konditionaler
  `DROP sessions` in init.js, WAL-Race-Guard + headersSent-Guard in server.js).
  Details: FEATURES.md „Bugfixes". **Folge fürs Deployment:** Sessions sind jetzt
  persistent; nach Update einmalig prüfen, dass `wachplan.db` die `sessions`-Tabelle füllt.
- `db/connection.js` respektiert jetzt `DATABASE_PATH` (war inkonsistent zu init.js;
  Tests nutzen darüber Wegwerf-DBs).
- **Tests: 52/52 grün** (`test/auth-flow.test.js` neu, 17 Subtests; voller Flow inkl.
  CAPTCHA-Mock). Smoke-Test des echten Servers (Register/Login/Resend/Reset) fehlerfrei.
- **Offen/prüfen:** reCAPTCHA-Hinweis ggf. in datenschutz.html/DATENSCHUTZ.md ergänzen,
  wenn CAPTCHA produktiv aktiviert wird; E-Mail-Eindeutigkeit gilt nur für Neuregistrierungen
  (Bestands-Duplikate erhalten beim Reset je eine Mail pro Account).

**Letzter Lauf (2026-06-16, Audit-Log Benutzer-Aktionen #293 – Branch `claude/issue-293-20260613-0112`):**
- **Feature 36 (#293):** `login`, `logout`, `plan_create/_update/_delete/_share/_share_revoke/_import`
  erzeugen jetzt Audit-Einträge. Pattern: fire-and-forget (`.catch()`), nur Metadaten (kein Plan-Inhalt).
  `login`/`logout` werden geloggt (Datenschutz-Abwägung: DSGVO Art. 5 Abs. 2 überwiegt Datenminimierung
  bei personenbezogenen Plan-Daten). Infrastruktur (Tabelle, `auditLog()`-Helfer, Admin-Filter) war bereits vorhanden.
  Betroffene Dateien: `server/api/auth.js`, `server/api/plans.js`, `server/api/import.js`.

**Letzter Lauf (2026-06-16, Feature 35: Auch Bootsführer können Sanitäter sein – Branch `claude/bf-can-be-sanitaeter`, basiert auf `main` mit Feature 33/34):**
- **Erweiterung von Feature 33 (s. docs/FEATURES.md Feature 35):** Der Sanitäter-Haken (🚑) gilt
  jetzt für Wachgänger **und** Bootsführer. Ein BF-Sanitäter deckt einen San-Turm ab, wenn er
  überzählig ist (im Guard-Pool `poolSBF` steht); aktive BF fahren ein Boot.
- **Änderung:** UI-Checkbox für `W`+`B` (`render-sidebar.js`); `sanActive`-Gating prüft den
  Sanitäter im gesamten `getGuardPool()` statt nur unter den Wachgängern (`generate.js`). Bonus/
  Reserve wirkten schon zuvor auf alle Guard-Pool-Personen → keine weitere Algorithmus-Änderung.
- **Layout-Fix:** BF-Zeile trägt nun 3 Toggles (Erf./🏠/🚑) – Toggle-Spalte der Personen-Zeile
  fest auf 140px, Sidebar verbreitert auf `clamp(440px,36vw,600px)` (einklappbar, daher unkritisch).
  Per CSS-Maß geprüft (BF-Toggle-Inhalt ≈124px passt in die 140px-Spalte); Playwright-Browser nicht
  installierbar (Netzwerk blockiert) → nicht visuell verifiziert.
- **Tests:** `test/san-tower.test.js` um 1 Test erweitert. Volle Suite grün. Auf `main` (mit
  Feature 33/34) rebased; Doku-Konflikte (HANDOFF/FEATURES) zugunsten beider Features aufgelöst.

**Letzter Lauf (2026-06-16, Feature 34: Führungstürme statt leaderCount-Spinner – Branch `claude/leader-tower-checkbox`):**
- **Neues Feature (s. docs/FEATURES.md Feature 34):** Der Pro-Turm-Spinner „Führungsslots"
  (`leaderCount`, 0–3 Zusatz-Slots) wird durch einen einfachen Haken „Führungsturm" (👔) ersetzt
  – gleiche Logik wie der San-Turm: wenn möglich ≥1 Führungskraft auf einem **regulären** Slot
  (kein Zusatz-Slot). Keine Pro-Turm-Anzahl mehr nötig.
- **Modell:** Turm `leaderTower:bool` ersetzt `leaderCount`. Algorithmus platziert vorab 1 F aus
  separatem `poolF` auf Führungstürme (fair rotierend); `slotCount+leaderCount`-Rechnungen → nur
  `slotCount`; toter Algo-Param `leaderBonus` entfernt. Migration alter Pläne: `leaderCount>0` →
  `leaderTower:true`, Zusatz-Slots in `slotCount` integriert (max 10); `STATE_VERSION` 9→10.
- **Tests:** `test/leaders.test.js` neu gefasst (4 Tests). Gemergt als PR #311 (v1.0.0, breaking).

**Letzter Lauf (2026-06-16, Feature 33: Sanitäter & San-Türme – Branch `claude/sanitaeter-hook-tower-2o54dy`):**
- **Neues Feature (s. docs/FEATURES.md Feature 33):** Personen-Flag „Sanitäter" (🚑, nur Wachgänger)
  + Turm-Haken „San-Turm" (🚑, neben Hauptstrand). Ein San-Turm bekommt – wenn möglich – immer
  ≥1 Sanitäter; sonst sind Sanitäter normale Wachgänger. Analog zur BF-Reservierung (Bonus zieht
  Sanitäter auf San-Türme, Reserve-Strafe hält sie von Nicht-San-Türmen/HW fern). Faire Rotation
  aus bestehenden towerVisit-/Konsekutiv-Strafen; wichtigster San-Turm (prio asc) zuerst.
- **State:** Person `sanitaeter:bool`, Turm `sanTower:bool` (beide Default false). Serialisiert in
  `state-io.js` (Build + Import, Default für Altpläne), `STATE_VERSION` 8→9; Roster-Override
  `sanitaeter` (`roster.js`). UI + Handler in `render-sidebar.js`, CSS `.san-toggle` in der HTML,
  Defaults beim Anlegen in `init.js`. Algorithmus in `generate.js` (`sanActive`, `sanTowerBonus`/
  `sanReservePenalty` in `state.js` `defaultAlgoParams`, neuer `bestPair`-Param `towerNeedsSan`).
- **Tests:** neuer `test/san-tower.test.js` (5 Tests, alle grün). Volle Suite grün (58 Tests; nach
  `npm install` im frischen Container, sonst `sqlite3`-Fehler; `session-user-deletion.test.js` einmal
  flaky → Rerun grün, dokumentiert). `node -c` für alle geänderten Frontend-Dateien OK.
- **Nicht im Browser verifiziert** (kein Browser im Container) – UI/Checkboxen/Handler per
  Code-Review geprüft, Algorithmus per Test abgesichert.

**Letzter Lauf (2026-06-15, Feature 32: BF-an-HW-Pflicht bei BF-Überschuss – Branch `claude/bf-surplus-staffing-fld551`):**
- **Neues Feature (s. docs/FEATURES.md Feature 32):** Globaler Schalter „Bei BF-Überschuss immer
  1 BF auf der Hauptwache" (Checkbox `#require-bf-hw` im HW-Konfig-Block). Bei echter BF-Überzahl
  (mehr BF als Boote) sitzt täglich mind. 1 überzähliger BF aktiv auf der HW (z.B. 3 HW-Slots →
  2 WG + 1 BF). Neues State-Feld `requireBfAtHw` (Default false), an 3 Stellen gepflegt + UI-Sync.
  Algorithmus: Vorab-Platzierung eines surplus-BF im HW-Abschnitt (`generate.js`), fair rotierend
  (`hwGuardDays` asc). Komplementär zu Feature 26 (per-Person-Wunsch).
- **Tests:** neuer `test/require-bf-hw.test.js` (4 Tests, alle grün). Volle Suite **55 Tests grün**.
  `node -c` für alle geänderten Frontend-Dateien OK. **Nicht im Browser verifiziert** (kein Browser
  im Container) – Checkbox/Handler per Code-Review geprüft, Algorithmus per Test abgesichert.

**Letzter Lauf (2026-06-14, Feature 31: Wachliste hochladen → dynamische Namensliste – Branch `claude/dynamic-name-list-dates-sfyz4u`):**
- **Neues Feature (s. docs/FEATURES.md Feature 31):** Upload der DLRG-Wachliste (CSV **und** PDF);
  die Namensliste wird dynamisch aus **Startdatum + Anzahl Wachtage** abgeleitet (nur „zugesagt",
  Verfügbarkeits-Überlappung; Tage außerhalb der persönlichen `von/bis` werden tageweise `absent`).
  Neues Modul `public/js/roster.js`, State-Feld `roster[]`, `STATE_VERSION` 7→8.
- **CSV** zuverlässig (Header-Mapping); **PDF** via pdf.js (lazy von cdnjs, Spalten-Rekonstruktion
  über x-Positionen) best-effort. Job→Rolle WF/BF/RS→F/B/W, Importe starten **unerfahren**.
- **CSP:** public-Server um `worker-src 'self' blob: https://cdnjs.cloudflare.com` ergänzt (pdf.js-Worker).
- **Tests:** neuer `test/roster.test.js` (8 Tests, alle grün). Reale Beispiel-CSV verifiziert
  (71 Zeilen → 63 zugesagt → 56 Personen im 11-Tage-Fenster). Volle Suite grün
  (`session-user-deletion.test.js` einmal flaky → Rerun grün, dokumentiert). `node -c` für beide Server OK.
- **Nicht im Browser verifiziert:** Kein Browser im Container; PDF-Pfad per Code-Review/Struktur
  geprüft, nicht visuell. CSV-Pfad end-to-end per Node-Skript gegen die echte Datei getestet.

**Letzter Lauf (2026-06-13, Layout: Top-Bar + Sidebar – Branch `claude/sidebar-topbar-layout-71mf2i`):**
- **Feature 30 (s. docs/FEATURES.md):** Top-Bar zeigt nur den Titel, Beschreibung/Badges in
  einem einklappbaren Info-Kästchen (ℹ-Button); Sidebar einklappbar.
  Neues Frontend-Modul `public/js/layout-chrome.js` (in Ladereihenfolge nach `sidebar-layout`).
  Reine UI-Schicht, kein Eingriff in State/Plan/Serialisierung. 34/34 Tests grün
  (`npm install` im frischen Container nötig, sonst `sqlite3`-Fehler – dokumentierte Falle).
- **Nicht visuell verifiziert:** Kein Browser/Netzwerk im Container für Playwright-Screenshot;
  Änderungen sind reines CSS/JS, per Code-Review geprüft. → PR offen.

**Vorheriger Lauf (2026-06-11, Optimierungs-Audit #2 – Branch `claude/confident-shannon-jq07g7`):**
- **Security-Fix (#279, Medium):** `POST /api/import/plans` umging die Eingabe-Limits aus
  #218/#270 komplett (kein Name-/Größen-/Typ-Check, rohe `planError.message` an den Client).
  Fix: `validatePlanInput` aus `plans.js` exportiert + im Import-Loop angewandt, generische
  Client-Fehlermeldungen, Namen in Fehler-Strings koerziert/gekürzt. 34/34 Tests grün,
  Export-/Limit-Verhalten via `node -e` verifiziert. → PR offen.
- **Housekeeping:** Issues #272/#273 geschlossen (Fixes waren via PR #275 bereits auf `main`
  gemergt, Issues standen noch offen).
- **Geprüft, bewusst NICHT gemeldet:** `compareVersions` in `server.js` behandelt NaN korrekt
  (malformed → 0/gleich, gewollt defensiv); getP/getT-Null-Derefs in `render-sidebar.js` sind
  theoretisch (data-ids stammen aus dem synchron gerenderten DOM); restliche Audit-Befunde
  (SQLi, AuthZ, Crypto, Sessions) ohne Befund. #276-Crash hat bereits offenen PR #277.

**Vorheriger Lauf (2026-06-11, Feature 29 – Branch `claude/brave-brahmagupta-1awb0w`):**
- **Version-Badge an GitHub-Releases gekoppelt** (s. docs/FEATURES.md Feature 29): Root-Cause
  war fehlendes `@semantic-release/git` – `package.json` blieb auf 0.5.1, GitHub war bei 0.9.1.
  Plugin ergänzt (`.releaserc.json` + `release.yml` `extra_plugins` + devDep), Version einmalig
  auf 0.9.1 synchronisiert. `/api/version` liefert jetzt zusätzlich `latest`/`updateAvailable`
  (serverseitiger GitHub-Check, 6 h-Cache); Badge wird gold + Toast bei neuerem Release.
- **Offen/prüfen nach Merge:** Erster Release-Lauf muss zeigen, dass der `chore(release)`-Commit
  auf `main` durchkommt (Branch-Protection könnte `GITHUB_TOKEN`-Push blocken → dann Ausnahme
  für Actions einrichten). 34/34 Tests grün, `/api/version` lokal verifiziert.

**Vorheriger Lauf (2026-06-10, Optimierungs-Audit – Branch `claude/codebase-optimization-audit-5dmrrb`):**
- **Bug gefunden & gefixt (#272, High):** Plan-Retention-Cleanup lief nie – `server.js` übergab
  `require('./db/connection').db` (= `undefined`, kein solches Export) an
  `startPlanRetentionCleanup` → `db.run` warf bei `PLAN_RETENTION_DAYS>0` einen vom catch
  verschluckten `TypeError`. Fix: `getDb()` übergeben + `cleanupRunning`-Guard. Verifiziert.
- **Reliability/Wartbarkeit (#273):** (a) Export-Memory-Leak behoben – neuer `downloadBlob()`-
  Helfer in `utils.js` mit `revokeObjectURL` (export.js ×3 + state-io.js). (b) `realtime.js`:
  stummer `catch` loggt jetzt, `planId` via `parsePositiveInt` validiert, `ws.send` nur bei
  `readyState===OPEN`. (c) `admin.js` Audit-Log: `JSON.parse` pro Zeile abgesichert (kein 500
  mehr bei einer korrupten Zeile). (d) `plans.js`/`realtime.js`: doppelte ID-Parser → zentraler
  `parsePositiveInt`. (e) totes/kaputtes `test/gdpr-deletion-verification.js` entfernt.
- **Tracking-Issue (#274, Low–Med, NICHT umgesetzt):** `admin-server.js` Error-Handler exiten
  nicht & sind erst in `start()` registriert (inkonsistent mit `server.js`) – Verhaltensänderung,
  daher bewusst nur als Issue (Überschneidung mit #217).
- Diese Änderungen liegen auf Branch `claude/codebase-optimization-audit-5dmrrb` (PR offen).

**Vorheriger Lauf (2026-06-10, Maintainer-Review):**
- **PR #231 gemergt** → Feature 28 **Fairness-Visualisierung** (SVG-Balkendiagramme: Einsätze/
  Person, HW-Tage/Person, Turmauslastung; rein CSS/SVG, CSP-konform, im Druck aus,
  `fairnessChartsDisplay`). War gegen veralteten `main` → Konflikte (VERSION/CLAUDE.md) gelöst,
  Doku korrekt nach docs/FEATURES.md verschoben. Schließt #225.
- **#154 DSGVO** (Audit-Log-Ansicht, PR #266 gemergt): Backend-Logging (Feature 21) hatte keine
  Admin-Ansicht → read-only Tabelle + Filter in `public/admin.html` (`loadAuditLog()`).
- **#181/#194** (PR #267): Mobile-`.move-btn` via `@media(hover:none)` sichtbar; Header-Subtitle
  ausgeschrieben.
- **#215** (PR #268): XLSX-Export warnt jetzt (`confirm()`) bei Truncation >16 Template-Spalten
  statt stillem Datenverlust (`_patchSheetXml` → `{xml, truncated}`).
- **#213** (PR #269): **CI-Workflow** `.github/workflows/test.yml` (`npm ci` + `npm test`,
  Node 20, push/PR). GDPR-Art.-17-Löschung ist über `session-user-deletion.test.js` Teil der
  Suite. Das alte Standalone-Skript `test/gdpr-deletion-verification.js` ist kaputt (fehlende
  `sessions`-Tabelle) → bewusst nicht in CI; Aufräumen offen (s. ToDos).
- **#218 Security** (PR #270): `POST/PUT /api/plans` begrenzen `name` (≤200 → 400) und
  State-Größe (≤1 MB → 413); neuer gemeinsamer Helfer `server/db/ids.js` (`parsePositiveInt`)
  ersetzt nacktes `parseInt(req.params.id)` in `admin.js`.

**Issues geschlossen (bereits in `main` gelöst):** #232 (seedFromConfig), #247 (HW2-Dropdown),
#153 (Plan-Retention/Feature 23), #155 (Datenschutz/Feature 24), #206 + #235 (Merke-mich/
Feature 20; #235 als Duplikat von #206). #225 via PR-Merge (released).

---

## 1. 30-Sekunden-Überblick
Vanilla-JS Single-Page-App (kein Framework) für die DLRG. Erstellt **faire Wachpläne**
(1–14 Tage), verteilt Personen rotierend auf **Türme, Boote, Hauptwache (HW)**. Export als
offizielles **DLRG-XLSX-Formular** (XML-Patch via JSZip) + CSV. Backend: Express + SQLite,
Multi-User mit **AES-256-GCM at rest**, Sessions, Sharing, Realtime (WebSocket), Admin-Panel.

- Frontend: `public/Wachplan-Generator.html` · Backend: `npm start` → `server/server.js` (:3000), Admin :3001
- Tests: `npm test` (jetzt auch in CI) · **Kern-Algorithmus: `public/js/generate.js`**
- Vollständige Datei-/Modul-Übersicht → CLAUDE.md „Codebase-Map".

## 2. Test- & Umgebungs-Hinweise
- `npm install` im frischen Container nötig, sonst `Cannot find module 'sqlite3'` in
  `test/session-user-deletion.test.js` (kein echter Test-Fehler).
- `session-user-deletion` und `auth-flow` sind **gelegentlich flaky** (Sandbox-FS:
  `Unable to deserialize cloned data …` (IPC) bzw. sporadisch `SQLITE_CORRUPT` bei
  zwei Connections auf einer Datei; auf echten Dateisystemen/CI nicht reproduzierbar) →
  Suite erneut laufen lassen; grün = alle.
- **CI:** `.github/workflows/test.yml` läuft bei push/PR (Node 20). Roter Test blockt Merge.
- Algorithmus-Invarianten (9 Szenarien + 100 Fuzz) sind die eigentliche Absicherung.
  **Backend kaum automatisiert** → bei Server-Änderungen mind. `node -c` + manuell.

## 3. Architektur-Fallen (Kurzform – Details in CLAUDE.md „Konventionen & Fallen")
- Neue DB-Spalten brauchen **idempotente `ALTER TABLE`** in `db/init.js` (schema.sql greift nicht auf Bestands-DBs).
- **CSP** divergiert public vs. admin (public braucht `cdnjs` für JSZip) → beim Zentralisieren erhalten, sonst bricht XLSX-Export. (Relevanter Blocker für #217, s. u.)
- Neue State-Felder an 3 Stellen pflegen (state.js / `_buildStateObject` / `importStateJSON`), ggf. `STATE_VERSION` (akt. 7).
- Lokale Datumsarithmetik, nie `toISOString()` (UTC-Off-by-one).

---

## 4. Offene Issues (Stand nach Review-Lauf)

**Feature-Wünsche (vom Owner gefiltert, @claude) – Proposal-PRs wurden geschlossen, Implementierung offen:**
| Issue | Feature | Anmerkung |
|---|---|---|
| #223 | Plan duplizieren („Als Vorlage verwenden") | reiner Frontend-Flow über `_buildStateObject()` + `POST /api/plans` |
| #222 | Persönlicher ICS-Export pro Wachgänger | Zeiten via `serviceStartHour/EndHour`, strikt lokal (kein UTC-Shift); Scope im Blick behalten |
| #221 | Mehrtägige Abwesenheiten (von–bis) pro Person | **nicht** durch Feature 27 abgedeckt (das ist tageweise `absent`). Hier: Bereichserfassung + Ableitung beim `generate()`. **Teilweise abgedeckt durch Feature 31** (von/bis aus Wachliste → tageweise `absent`), aber noch keine manuelle Bereichserfassung pro Person. |
| #220 | Wachgänger-Bulk-Import (CSV/Text) | robustes Parsing, `escapeHtml`, `generate()`/Autosave nach Import. **Weitgehend abgedeckt durch Feature 31** (CSV/PDF-Upload der Wachliste). |

**Refactor:**
| Issue | Thema | Anmerkung |
|---|---|---|
| #217 | Backend-DRY (Security-Header/Body-Parser zusammenführen, `saveUninitialized:false`) | **Blocker beachten:** zentrale Header-Middleware darf `script-src` NICHT auf `'self'` zwingen (public-Server braucht `cdnjs` für JSZip) → als Factory mit `scriptSrc`-Param bauen. Vormals PR #228 (geschlossen). |

## 5. Offene ToDos
1. **Feature-PRs #220–#223:** mergebar machbar; pro Issue Branch + PR. #221 sauber vom
   tageweisen `absent` (Feature 27) abgrenzen.
2. **#217 Backend-DRY:** CSP-Factory-Ansatz (s. o.), sonst bricht XLSX-Export.
3. ~~`test/gdpr-deletion-verification.js` veraltet/kaputt~~ → **erledigt** (entfernt, #273).
   Löschung ist über `session-user-deletion.test.js` in CI abgedeckt.
4. **Fairness:** Penalty-Gewichte in `bestPair` empirisch getunt → bei Änderungen gegen
   Turm-/Paar-Wiederholung messen (`/tmp/measure.js`-Muster), nicht nur Invarianten.
5. **Branch-Workflow:** nie direkt auf `main`; PRs nur auf ausdrücklichen Wunsch.
