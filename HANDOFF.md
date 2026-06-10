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

**Stand:** VERSION **0.4.23**, Branch `claude/happy-wozniak-d6la3r` (PR offen).
**Letzte Aufgabe:** Fairness-Optimierung im Kern-Algorithmus (`generate.js`):
(1) **Experience-Reservierung** – Erfahrene werden nicht mehr an der HW „verbraucht", wenn
ein Turm sonst ohne Erfahrenen bliebe (Türme ohne Erfahrenen 36→0 / 92→0).
(2) **Bootsführer-Rotation** – Lookback über das Rotationsfenster + Min-Cost-Matching →
BF kehrt frühestens nach #Boote Tagen aufs gleiche Boot zurück (Rückkehr <3 T.: 10→0).
Neue Invarianten `checkExperienceNotWastedAtHW` + Boot-Rotation (test/invariants.test.js,
24/24 grün). Details s. docs/FEATURES.md.

---

## 1. 30-Sekunden-Überblick
Vanilla-JS Single-Page-App (kein Framework) für die DLRG. Erstellt **faire Wachpläne**
(1–14 Tage), verteilt Personen rotierend auf **Türme, Boote, Hauptwache (HW)**. Export als
offizielles **DLRG-XLSX-Formular** (XML-Patch via JSZip) + CSV. Backend: Express + SQLite,
Multi-User mit **AES-256-GCM at rest**, Sessions, Sharing, Realtime (WebSocket), Admin-Panel.

- Frontend: `public/Wachplan-Generator.html` · Backend: `npm start` → `server/server.js` (:3000), Admin :3001
- Tests: `npm test` · **Kern-Algorithmus: `public/js/generate.js`**
- Vollständige Datei-/Modul-Übersicht → CLAUDE.md „Codebase-Map".

## 2. Test- & Umgebungs-Hinweise
- `npm install` im frischen Container nötig, sonst `Cannot find module 'sqlite3'` in
  `test/session-user-deletion.test.js` (kein echter Test-Fehler).
- Dieser Test ist **gelegentlich flaky** (`Unable to deserialize cloned data …`, IPC) →
  Suite erneut laufen lassen; grün = alle.
- Algorithmus-Invarianten (Checks über 9 Szenarien + 100 Fuzz) sind die eigentliche
  Absicherung. **Backend kaum automatisiert** → bei Server-Änderungen mind. `node -c` + manuell.

## 3. Architektur-Fallen (Kurzform – Details in CLAUDE.md „Konventionen & Fallen")
- Neue DB-Spalten brauchen **idempotente `ALTER TABLE`** in `db/init.js` (schema.sql greift nicht auf Bestands-DBs).
- **CSP** divergiert public vs. admin (public braucht `cdnjs` für JSZip) → beim Zentralisieren erhalten, sonst bricht XLSX-Export.
- Neue State-Felder an 3 Stellen pflegen (state.js / `_buildStateObject` / `importStateJSON`), ggf. `STATE_VERSION` (akt. 6).
- Lokale Datumsarithmetik, nie `toISOString()` (UTC-Off-by-one).

---

## 4. Aktueller PR-Review-Stand
13 offene PRs gegen veralteten `main` abgezweigt → fast alle haben VERSION/CLAUDE.md-Konflikte
+ „Feature 20"-Nummernkollision (`main` hat bereits Features bis **24**).

### ✅ Gemergt
- **#242** Plan-Retention/Cleanup → Feature 23 (Fixes beim Merge: `ALTER TABLE`-Migration, `module.exports`-Konflikt, Audit-Logging).
- **#241** ausführliche `datenschutz.html` → Feature 24 (add/add-Konflikt, lange Version übernommen).
- **#250** entfernt WF2+HW2 aus Export-Dropdown-Vorschlägen (Issue #249).
- **#252** (Issue #251) `effLevel('F')→'E'`, Führungskräfte zählen als erfahren. v0.4.20.
- **#254** (Issue #253) Fairness: lineare Turm-Penalty `v*200`, Fairness ×10, HW-UU 300, Boot-Rotation.
  Nachgebessert: Partner-Penalty ×120→×250 (sonst Paar-Wdh. 21→42). Endstand: Turm-Wiederholer
  267→188, Paar-Wdh. 21→14. v0.4.21. Messskript-Vorlage: `/tmp/measure.js` (nutzt `test/harness.js`).

### 🚫 Geschlossen
- **#248** (nur HW2) – superseded durch #250.

### 🔧 Änderungen angefordert
- **#228** Backend-DRY-Refactor. **Blocker:** zentrale `middleware/security.js` setzt
  `script-src 'self'` → **XLSX-Export bricht** (cdnjs blockiert). Lösung: Middleware als Factory
  mit `scriptSrc`-Param. Zusätzlich `saveUninitialized:false` (WS-Auth prüfen), Rebase nötig.

### 📋 Feature-Vorschläge – kommentiert, NICHT gemergt (Maintainer entscheidet)
| PR | Feature | Anmerkung |
|---|---|---|
| #231 | Fairness-Balkendiagramme (SVG) | Sauber, CSP-konform; nur Nummerierung/Rebase |
| #230 | Plan duplizieren | Sauber; `escapeHtml` doppelt mit `textContent` |
| #229 | Bulk-Import Personenliste | Delimiter-Heuristik; kein `generate()` nach Import |
| #227 | Mehrtägige Abwesenheiten (`absentDays`) | Saubere Algo-Integration; UI nur 1 Bereich/Person |
| #226 | Persönlicher ICS-Export | Scope-Creep; DTSTART besser `;TZID=`; Boot-Erfassung prüfen |

---

## 5. Offene ToDos
1. **#228 nachverfolgen:** nach CSP-Factory + Rebase erneut prüfen und mergen.
2. **Feature-PRs #226/#227/#229/#230/#231:** mergebar, brauchen Rebase + eindeutige Feature-Nr.
   (nächste frei: **25**) + VERSION-Bump. Reihenfolge koordinieren (CLAUDE.md/VERSION-Konflikte).
3. **Fairness:** Penalty-Gewichte in `bestPair` (Turm `*200`, Paar `*250`, Fairness `*10`)
   empirisch getunt → bei Änderungen gegen Turm-/Paar-Wiederholung messen, nicht nur Invarianten.
4. **Inline-Styles in `admin.html`** refactoren für strikte CSP (`style-src 'self'`).
5. **Branch-Workflow:** nie direkt auf `main`; PRs nur auf ausdrücklichen Wunsch.
