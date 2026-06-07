# HANDOFF – DLRG Wachplan-Generator

> Schnelleinstieg für den nächsten AI-Agenten. **Tiefe Details stehen in `CLAUDE.md`** –
> diese Datei ist die Landkarte + der aktuelle Arbeits-/Review-Stand. CLAUDE.md nach
> jeder Änderung aktualisieren; VERSION nach jedem Commit um 1 erhöhen.

Stand: VERSION **0.4.21**, Branch `main`. Letzte Aufgabe: **Review aller offenen Pull Requests** + **Fairness-Bugfixes #251/#253 gemergt**.

---

## 1. Was ist das Projekt? (30-Sekunden-Überblick)

Vanilla-JS Single-Page-App (kein Framework) für die DLRG. Erstellt **faire Wachpläne**
(1–14 Tage) und verteilt Personen rotierend auf **Türme, Boote, Hauptwache (HW)**.
Export als offizielles **DLRG-XLSX-Formular** (XML-Patch der Vorlage via JSZip) + CSV + ICS.
Backend: Express + SQLite, Multi-User mit **AES-256-GCM-Verschlüsselung at rest**,
Sessions, Sharing, Realtime-Kollaboration (WebSocket), Admin-Panel.

- Frontend-Einstieg: `public/Wachplan-Generator.html` (statisch serviert)
- Backend-Start: `npm start` → `server/server.js` (Port 3000); Admin: `server/admin-server.js` (Port 3001)
- Tests: `npm test` (Node `--test`, `test/*.test.js`)

## 2. Wo liegt was? (siehe CLAUDE.md „Dateistruktur" für Details)

| Bereich | Datei(en) |
|---|---|
| **Kern-Algorithmus** (Scoring, Rotation, Fairness) | `public/js/generate.js` |
| Globaler Zustand / Datenmodell | `public/js/state.js` |
| Sidebar-UI (Personen/Türme/Boote/Export) | `public/js/render-sidebar.js` |
| Ausgabe-UI (Tageskarten, Stats, Matrix) | `public/js/render-output.js` |
| XLSX/CSV-Export | `public/js/export.js` |
| State-Sync / Plan-Manager / Import-Export | `public/js/state-io.js` |
| Server + Routen | `server/server.js`, `server/api/*.js` |
| DB (Schema, Init/Migration, Crypto) | `server/db/*.js`, `server/db/schema.sql` |

**Wichtig:** Script-Ladereihenfolge in der HTML beachten (state → utils → dates → autoCodes
→ config → seed → render-sidebar → generate → render-output → export → move → state-io →
user-info → share → realtime → plans-ui → login-modal → init).

## 3. Test- & Umgebungs-Hinweise (wichtig!)

- `npm install` ist im frischen Container nötig, sonst schlägt `test/session-user-deletion.test.js`
  mit `Cannot find module 'sqlite3'` fehl (kein echter Test-Fehler).
- `test/session-user-deletion.test.js` ist **gelegentlich flaky** beim Node-Test-Runner
  (`Unable to deserialize cloned data ...` – IPC-Serialisierung, kein echter Fehler).
  Bei Verdacht Suite erneut laufen lassen; grün = 22/22.
- Algorithmus-Invarianten (16 Checks über 9 Szenarien + 100 Fuzz) sind die eigentliche
  Absicherung. Backend hat kaum automatisierte Abdeckung → bei Server-Änderungen mind.
  `node -c` + manuell verifizieren.

## 4. Architektur-Fallen, die schon Bugs verursacht haben

- **DB-Migrationen:** `schema.sql` nutzt `CREATE TABLE IF NOT EXISTS` → neue Spalten greifen
  NICHT auf Bestands-DBs. Für jede neue Spalte eine **idempotente `ALTER TABLE ... ADD COLUMN`**
  in `server/db/init.js` ergänzen (Muster: `last_login`, `marked_for_deletion`).
- **CSP divergiert je Server:** Der **public-Server** erlaubt `script-src 'self' 'unsafe-inline'
  https://cdnjs.cloudflare.com` (JSZip/XLSX werden von cdnjs geladen – Zeilen ~869/870 der HTML!).
  Der **admin-Server** nutzt nur `script-src 'self'`. Beim Zentralisieren der Security-Header
  diese Differenz erhalten, sonst bricht der XLSX-Export.
- **Neue State-Felder** immer an 3 Stellen pflegen: `state.js` (Default + `resetGlobalState`),
  `state-io.js` `_buildStateObject()` (serialisieren) und `importStateJSON()` (deserialisieren
  mit Default für Altpläne); ggf. `STATE_VERSION` erhöhen (aktuell **6**).
- **Timezone:** lokale Datumsarithmetik, nie `toISOString()` für Tagesdaten (UTC-Off-by-one).
- Helfer wie `personNr()`/`showConfirmation()` NUR in `utils.js` (lädt früh) – nicht duplizieren.

---

## 5. Aktueller PR-Review-Stand (letzte Aufgabe)

Bei Review wurden 13 offene PRs bearbeitet (Repo war auf Branches gegen veralteten `main`
abgezweigt → fast alle haben VERSION/CLAUDE.md-Konflikte + „Feature 20"-Nummernkollision,
da `main` bereits Features bis **24** hat).

### ✅ Gemergt
- **#242** Plan-Retention/Cleanup (DSGVO Art. 5 e). Bei Merge gefixt: fehlende `ALTER TABLE`-
  Migration für `marked_for_deletion(_at)`, `module.exports`-Konflikt (`auditLog` + neue Fn),
  echtes Audit-Logging im Cleanup ergänzt, Feature 22→**23** umnummeriert. → Feature 23
- **#241** Umfassende `datenschutz.html` (DSGVO Art. 13/14). `main` hatte bereits eine
  Kurzfassung (add/add-Konflikt) → die ausführliche 293-Zeilen-Version übernommen,
  Feature 21→**24** umnummeriert.
- **#250** Entfernt WF2+HW2 aus den Export-Dropdown-Vorschlägen (Issue #249) + CLAUDE.md-Doku.
- **#252** (Issue #251, Bugfix) `effLevel(p)` gibt für `role:'F'` jetzt `'E'` zurück →
  Führungskräfte zählen als erfahren. VERSION 0.4.20.
- **#254** (Issue #253, Bugfix) Fairness: lineare Turm-Wiederholungs-Penalty (`v*200`),
  Fairness ×10, HW-UU-Penalty 300, Boot-Rotation. **Beim Merge nachgebessert:** #254 allein
  verdoppelte die Paar-Wiederholungen (21→42), daher Partner-Penalty `×120→×250` gesetzt.
  Endstand (5 Szenarien × 5 Seeds): Turm-Wiederholer 267→188, Paar-Wiederh. 21→14. VERSION 0.4.21.
  Mit #252 zusammen gemergt (gemeinsames Ziel: 3 Unerfahrene + 2 WF an HW, Issue #251).
  Messskript-Vorlage: `/tmp/measure.js` (nutzt `test/harness.js`).

### 🚫 Geschlossen
- **#248** (nur HW2 entfernen) – **superseded durch #250** (das WF2+HW2 abdeckt).

### 🔧 Änderungen angefordert (REQUEST_CHANGES)
- **#228** Backend-DRY-Refactor. **Blocker:** zentrale `middleware/security.js` setzt
  `script-src 'self'` und würde damit die public-CSP verschärfen → **XLSX-Export bricht**
  (cdnjs blockiert). Lösung im PR vorgeschlagen: Middleware als Factory mit `scriptSrc`-Param.
  Zusätzlich: `saveUninitialized:false` ist eine Verhaltensänderung (WS-Auth prüfen), Rebase nötig.

### 📋 Feature-Vorschläge – kommentiert, NICHT gemergt (Entscheidung beim Maintainer)
| PR | Feature | Wichtigste Anmerkung |
|---|---|---|
| #231 | Fairness-Balkendiagramme (SVG) | Sauber, CSP-konform; nur Nummerierung/Rebase |
| #230 | Plan duplizieren | Sauber; `escapeHtml` doppelt mit `textContent` |
| #229 | Bulk-Import Personenliste | Delimiter-Heuristik (Komma in Namen); kein `generate()` nach Import |
| #227 | Mehrtägige Abwesenheiten (`absentDays`) | Sehr saubere Algo-Integration; UI nur 1 Bereich/Person |
| #226 | Persönlicher ICS-Export | Scope-Creep (hwBoatSlot-Removal); DTSTART „floating time" → besser `;TZID=`; Boot-Erfassung prüfen |

---

## 6. Offene ToDos / Empfehlungen für den nächsten Agenten

1. **#228 nachverfolgen:** Sobald der Autor die CSP-Factory umgesetzt + rebased hat → erneut
   prüfen und mergen (DRY ist grundsätzlich erwünscht).
2. **Feature-PRs #226/#227/#229/#230/#231** sind alle mergebar, brauchen aber: Rebase auf `main`,
   eindeutige Feature-Nummer (nächste frei: **25**) und VERSION-Bump. Reihenfolge koordinieren,
   da sie sich in CLAUDE.md/VERSION gegenseitig blockieren.
3. **Fairness weiter beobachten:** Penalty-Gewichte in `bestPair` (Turm `*200`, Paar `*250`,
   Fairness `*10`) sind empirisch getunt (`/tmp/measure.js`). Bei künftigen Änderungen erneut
   gegen die Metriken Turm-/Paar-Wiederholung messen, nicht nur Invarianten.
4. **Inline-Styles in `admin.html`** mittelfristig refactoren für strikte CSP (`style-src 'self'`).
5. **Branch-Workflow:** Niemals direkt auf `main`. Feature-/Fix-Branch → PR. PRs nur auf
   ausdrücklichen Wunsch erstellen.
