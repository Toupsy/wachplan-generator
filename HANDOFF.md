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
`main` ist sauber: **34/34 Tests grün**, alle Server parsen (`node -c`).

**Letzter Lauf (2026-06-13, Optimierungs-Audit #3 – Branch `claude/kind-allen-1f0abd`):**
- **Audit-Log-Lücke geschlossen (Nachtrag zu #154, Medium):** #154 war als „completed/released"
  geschlossen, das Akzeptanzkriterium „Create/Delete/SetPassword/Export/Purge erzeugen
  Audit-Einträge" war aber **nur für Purge** (`plan_cleanup`) erfüllt – die schreibenden
  Admin-Aktionen schrieben **nie** ins `audit_log` (Admin-Ansicht faktisch leer, obwohl
  `AUDIT_ACTION_LABELS` im Frontend die Codes bereits kannte). Fix: fire-and-forget-Helfer
  `recordAdminAudit()` in `server/api/admin.js`, verdrahtet in Create/Delete/SetPassword/Export
  (`admin_user_create/_delete/_password_reset/_user_export`); neues Label in `admin.html`.
  Nur Metadaten, keine Secrets. 34/34 Tests grün, `node -c` ok, End-to-End-Insert/Read via
  `node -e` verifiziert. → docs/FEATURES.md aktualisiert.
- **Geprüft, bewusst NICHT umgesetzt:** Login/Logout/`plan_*`-Events haben zwar ebenfalls
  Frontend-Labels, werden aber nie geschrieben → eigener, größerer Scope (auth.js + plans.js +
  Datenschutz-Abwägung „jeden Login loggen?"). Als Issue gemeldet (s. u.), nicht implementiert.
- **Geprüft, kein Befund:** Session-Cascade-Delete (`json_extract($.userId)`) ist über
  `session-user-deletion.test.js` (CI) abgesichert; Login-Brute-Force-Maps werden pro
  Request via `_cleanupExpiredEntries()` beschnitten; `dates.js` guardet malformed Startdatum;
  Frontend-`renderOutput`/`renderMatrix`-Crash ist über PR #277 (#276) abgedeckt.

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
- Dieser Test ist **gelegentlich flaky** (`Unable to deserialize cloned data …`, IPC) →
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
| #221 | Mehrtägige Abwesenheiten (von–bis) pro Person | **nicht** durch Feature 27 abgedeckt (das ist tageweise `absent`). Hier: Bereichserfassung + Ableitung beim `generate()` |
| #220 | Wachgänger-Bulk-Import (CSV/Text) | robustes Parsing, `escapeHtml`, `generate()`/Autosave nach Import |

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
