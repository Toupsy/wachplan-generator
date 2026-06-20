# 🚨 DLRG Wachplan-Generator

Automatische Wachplan-Generierung für DLRG-Wasserrettungsdienste mit fairer Rotation,
Admin-Panel und verschlüsselter Speicherung.

**Status:** ✅ Production-ready – Multi-User Authentication, AES-256-GCM at rest, Realtime-Kollaboration

> Versionierung erfolgt automatisch via **Semantic Release** nach jedem Merge auf `main`.
> Source of Truth ist `package.json:version`. Eine separate `VERSION`-Datei gibt es nicht mehr.

---

## 📑 Inhaltsverzeichnis

- [🎯 Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [📖 Dokumentation](#-dokumentation)
- [🔐 Sicherheit](#-sicherheit)
- [💾 Speicherung & API](#-speicherung--api)
- [📦 Tech Stack](#-tech-stack)
- [🛠️ Entwicklung](#️-entwicklung)
- [❓ FAQ & Troubleshooting](#-faq--troubleshooting)
- [🤝 Beitragen](#-beitragen)
- [📋 Lizenz](#-lizenz)

---

## 🎯 Features

### 📅 Automatische Wachplangenerierung
- Automatische Einteilung für **1–14 Tage** auf **Türme, Boote und Hauptwache (HW)**
- Faire, sequenzielle Rotation über alle Tage via gewichtetem **Fairness-Scoring**
- Intelligente **Bootsführer-Verteilung** (BF-Schutz, Min-Cost-Matching, Lookback-Rotation)
- **Erfahrungslevel** pro Person (`experienced`) → jeder Turm bekommt einen Erfahrenen
- **Hauptstrand/Außenstrand-Ausgleich** (`mainBeach`) und Konsekutiv-Tag-Regeln gegen Monotonie
- **BF-HW-Wunsch** (`wantsHW`): Bootsführer erhalten bei Überzahl mindestens einen HW-Dienst
- Optionaler **Seed** (0–999) für deterministische Start-Konstellationen

### 📊 Übersichtliche Pläne
- Visuelle **Tages-Karten** mit Turm- und Bootsbesetzung
- **Echtzeit-Statistiken** (Fairness-Metriken, Paarungs-Diversität)
- **Fairness-Visualisierung** als CSS/SVG-Balkendiagramme (Einsätze/Person, HW-Tage, Turmauslastung)
- Pro-Person-Statistik und Paarungs-Kreuztabelle (Zusammenarbeitshäufigkeit)
- Farbige Fairness-Anzeige (Grün = ausgeglichen, Orange = Schieflage)

### 💾 Flexibler Export & Import
- **XLSX-Export** als offizielles DLRG-Formular (Styles/Bilder/Schutz bleiben erhalten, XML-Patch via JSZip)
- **CSV-Export** für Weiterverarbeitung
- Import alter localStorage-/JSON-Pläne mit automatischer Verschlüsselung (Bulk-Import möglich)

### 🎮 Benutzerfreundliche Steuerung
- **Drag-and-Drop** und Modal zum manuellen Verschieben von Personen/Booten
- **Daten-Konfiguration** (Personen, Türme, Boote, Positionen, Export-Spalten) in der Sidebar
- **Zwangszuweisungen** transparent (nur visuell) oder effektiv (mit Neuberechnung der Folgetage)
- Tageweise **Kranke** (an HW geführt) und **Abwesende** (komplett ausgeplant) mit sofortiger Neuberechnung
- Konfigurierbare **Dienstzeiten** (`serviceStartHour`/`EndHour`)

### 🔒 Sicherheit & Multi-User
- **AES-256-GCM-Verschlüsselung** der Plandaten (at rest)
- **Per-User Encryption Keys** via PBKDF2 (100k Iterationen, pro User gecacht)
- **Session-basiertes Login** (HTTPOnly-Cookies, „Merke mich" 7/30 Tage, Rate-Limiting)
- Optionale **Selbstregistrierung** (`disabled` | `open` | `code`)
- **Admin-Panel** (separater Prozess, Port 3001) inkl. Audit-Log-Ansicht & DSGVO-Export
- **Plan-Sharing** mit Zugriffsrollen (`edit`/`view`) ohne Re-Encryption

### 🔄 Live-Updates
- **WebSocket-basierte Echtzeit-Synchronisation** bei Plan-Änderungen durch andere Nutzer
- Echo-Schutz (keine Duplikate beim eigenen Speichern) und automatisches Reconnect

### 🔔 Update-Benachrichtigung
- `GET /api/version` vergleicht die laufende Version mit dem neuesten GitHub-Release (6 h-Cache)
- Frontend-Badge wird gold + Toast, sobald ein neueres Release verfügbar ist

---

## 🚀 Quick Start

### Option 1: Docker (empfohlen für Production)

```bash
# Repository klonen
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator

# Umgebung konfigurieren
cp .env.example .env
# → .env mit eigenen Secrets befüllen (siehe docs/DEPLOYMENT.md)

# Services starten (App :3000 + Admin :3001)
docker compose up -d

# Health Check
curl http://localhost:3000/health

# Erst-Admin anlegen (falls nicht via ADMIN_* in .env gesetzt)
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SICHERES_PASSWORT"}'

# http://localhost:3000 im Browser öffnen
```

> Das Compose-Setup erwartet ein externes Docker-Netzwerk `proxy` (TLS-Reverse-Proxy).
> Details und Portainer-Integration: **docs/DEPLOYMENT.md** / **docs/PORTAINER.md**.

### Option 2: Lokal (Development)

```bash
# Dependencies installieren
npm install

# .env anlegen (auch lokal Pflicht: MASTER_SECRET, SALT, SESSION_SECRET)
cp .env.example .env

# Server starten
npm start            # → http://localhost:3000
npm run start:admin  # optional: Admin-Panel auf :3001
```

> Auch lokal werden Pläne serverseitig in SQLite verschlüsselt gespeichert. Ohne erreichbares
> Backend fällt das Frontend auf `localStorage` zurück.

---

## 📖 Dokumentation

| Dokument | Zweck |
|----------|-------|
| **[CLAUDE.md](CLAUDE.md)** | Technische Architektur, Datenmodell, Algorithmus-Kern, Codebase-Map, Konventionen |
| **[HANDOFF.md](HANDOFF.md)** | Schnelleinstieg + aktueller Arbeits-/Review-Stand |
| **[docs/FEATURES.md](docs/FEATURES.md)** | Ausführliche Feature-/Bugfix-Historie |
| **[docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)** | Production-Setup, Docker, Portainer, TLS-Termination |
| **[docs/DATENSCHUTZ.md](docs/DATENSCHUTZ.md)** | DSGVO: VVT (Art. 30), TOMs (Art. 32), Betroffenenrechte |
| **[docs/PREVIEW_WORKFLOW.md](docs/PREVIEW_WORKFLOW.md)** | Cloudflare-Worker-Preview für Pull Requests |
| **[server/db/schema.sql](server/db/schema.sql)** | SQLite-Datenbankschema |

### 🏠 Projektstruktur

```
.
├── public/                       # Frontend (statisch serviert, Vanilla JS)
│   ├── Wachplan-Generator.html   # Haupt-UI
│   ├── admin.html                # Admin-Panel
│   ├── js/                       # Frontend-Logik (State, Render, Generate, Export …)
│   └── Wachplan Template.xlsx    # DLRG-Vorlage für den XLSX-Export
├── server/                       # Backend (Node.js + Express)
│   ├── server.js                 # Haupt-Server (Port 3000)
│   ├── admin-server.js           # Admin-Server (Port 3001)
│   ├── realtime.js               # WebSocket-Server
│   ├── config.json               # Template-Config (Türme/Boote/Export-Spalten)
│   ├── db/                       # SQLite, Verschlüsselung, Schema, Sessions
│   └── api/                      # REST-Endpoints (auth, plans, admin, import)
├── test/                         # Node --test (Algorithmus-Invarianten + Fuzz)
├── docs/                         # Deployment, Datenschutz, Preview-Workflow …
├── data/                         # SQLite-Datenbank (gitignored)
├── .env.example                  # Secrets-Vorlage
├── docker-compose.yml            # App + Admin (gleiches Image)
├── Dockerfile
└── wrangler.toml                 # Cloudflare-Worker-Preview (PR-Deployments)
```

---

## 🔐 Sicherheit

### ✅ Implementierte Maßnahmen

| Maßnahme | Standard | Details |
|----------|----------|---------|
| **Datenverschlüsselung** | AES-256-GCM | Authenticated Encryption, Plandaten at rest |
| **Passwort-Hashing** | bcryptjs | 10 Rounds, Passwort ≥ 10 Zeichen |
| **Key Derivation** | PBKDF2 | 100.000 Iterationen, SHA-256, pro User gecacht |
| **Session Management** | HTTPOnly-Cookies | sameSite:lax, 7/30 Tage, Session-Fixation-Schutz |
| **Rate Limiting** | IP + Account | 10 Versuche / 15 min bei Login/Init/Register |
| **SQL Injection** | Parametrisierte Queries | durchgehend (sqlite3 mit Bindings) |
| **XSS-Schutz** | escapeHtml() / textContent | alle User-Inputs sanitized |
| **Security-Header** | CSP, HSTS, sameSite | CSRF-Schutz über sameSite-Cookies |

### 🔑 Geheimnisverwaltung

Alle Secrets gehören in eine `.env` (gitignored), geprüft von `validateEnv()` beim Start:

```bash
openssl rand -base64 32    # MASTER_SECRET (≥ 32 Zeichen)
openssl rand -base64 16    # SALT (≥ 16 Zeichen)
openssl rand -base64 32    # SESSION_SECRET (≥ 16 Zeichen)
```

> ⚠️ **`MASTER_SECRET` und `SALT` gehen in die Plan-Verschlüsselung ein** (`db/crypto.js`).
> Werden sie geändert, sind bereits gespeicherte Pläne nicht mehr entschlüsselbar – vor einer
> Rotation ent- und neu verschlüsseln. `SESSION_SECRET` lässt sich gefahrlos rotieren (loggt nur aus).

### ⚙️ Wichtige Umgebungsvariablen

| Variable | Default | Zweck |
|----------|---------|-------|
| `MASTER_SECRET` / `SALT` / `SESSION_SECRET` | – | **Pflicht** (Verschlüsselung & Sessions) |
| `COOKIE_SECURE` | `true` in Production | Cookies nur über HTTPS senden |
| `ADMIN_USERNAME` / `ADMIN_PASSWORD` | – | Erst-Admin beim ersten Start anlegen |
| `REGISTRATION_MODE` | `disabled` | Selbstregistrierung: `disabled` \| `open` \| `code` |
| `REGISTRATION_CODE` | – | nötig bei `REGISTRATION_MODE=code` |
| `PLAN_RETENTION_DAYS` | `90` (deaktiviert bei ≤ 0) | Auto-Löschung inaktiver Pläne (DSGVO Art. 5) |
| `AUDIT_PLAN_UPDATE_WINDOW_MIN` | `10` (0 = aus) | Coalescing-Fenster: wiederholte `plan_update` (Autosave) je Nutzer+Plan zu einer Audit-Zeile zusammenfassen |
| `AUDIT_PLAN_UPDATE_RETENTION_DAYS` | `30` (0 = aus) | Auto-Löschung alter `plan_update`-Audit-Einträge |
| `DATABASE_PATH` | `./data/wachplan.db` | Pfad zur SQLite-Datenbank |

Vollständige Beschreibung mit Hinweisen: **[.env.example](.env.example)**.

### ⚠️ Sicherheits-Checkliste für Production

- [ ] `.env` mit starken Secrets generiert (`validateEnv()` erzwingt Mindestlängen)
- [ ] TLS/HTTPS über Reverse-Proxy aktiviert
- [ ] `COOKIE_SECURE=true` gesetzt
- [ ] `MASTER_SECRET` & `SALT` gesichert/gebackupt (sonst Datenverlust bei Verlust)
- [ ] Regelmäßige DB-Backups eingerichtet
- [ ] Erst-Admin-Passwort geändert
- [ ] `REGISTRATION_MODE` bewusst gesetzt (Default `disabled`)

---

## 💾 Speicherung & API

### 📊 Datenspeicher

| Speicherort | Format | Verschlüsselt |
|-------------|--------|---------------|
| `data/wachplan.db` (Plandaten) | BLOB | **AES-256-GCM** ✅ |
| User-Passwörter | Hash | **bcryptjs** ✅ |
| Sessions | connect-sqlite3 | HTTPOnly-Cookie |

### 🔌 REST API

**Authentication**
```
GET    /api/auth/me                  Aktueller User
GET    /api/auth/needs-setup         Ist noch kein Admin vorhanden?
GET    /api/auth/registration-status Selbstregistrierung aktiv?
POST   /api/auth/login               { username, password, rememberMe? }
POST   /api/auth/logout              Session beenden
POST   /api/auth/init                { username, password }  (Erst-Admin)
POST   /api/auth/register            { username, password, code? }
PUT    /api/auth/password            { currentPassword, newPassword }
```

**Plans (authentifiziert)**
```
GET    /api/plans                    Eigene + geteilte Pläne
POST   /api/plans                    { name, state } → anlegen
GET    /api/plans/:id                Laden (entschlüsselt)
PUT    /api/plans/:id                { name, state } → speichern (verschlüsselt)
DELETE /api/plans/:id                Löschen (nur Owner)
GET    /api/plans/:id/shares         Freigaben auflisten
POST   /api/plans/:id/share          { username, role:'edit'|'view' }
DELETE /api/plans/:id/share/:userId  Freigabe entfernen
```

**Admin (Admin-only)**
```
GET    /api/admin/users              Alle User
POST   /api/admin/users              { username, password }
DELETE /api/admin/users/:id          User löschen (Pläne kaskadieren)
PUT    /api/admin/users/:id/password { password }
GET    /api/admin/users/:id/export   DSGVO-Datenexport
GET    /api/admin/audit-log          Audit-Log (gefiltert)
POST   /api/admin/reload-config      Template-Config neu laden
POST   /api/admin/purge-orphans      Verwaiste Daten bereinigen
```

**Sonstiges**
```
GET    /health                       Health Check
GET    /api/version                  { version, latest, updateAvailable, releaseUrl }
GET    /api/config                   Template-Config (Türme/Boote/Export-Spalten)
POST   /api/import/plans             { plans: [{ name, state }] }
```

---

## 📦 Tech Stack

### Frontend
- **Vanilla JavaScript** (kein Framework, Re-Render via `innerHTML`-Replace)
- Dark Theme mit CSS-Variablen, responsives Layout, native HTML5 Drag-and-Drop
- Export: XLSX (JSZip von cdnjs), CSV

### Backend
- **Node.js (≥ 20)** + **Express.js**
- **SQLite3** (eingebettet) + **connect-sqlite3** (Session-Store)
- **bcryptjs** (Passwort-Hashing), Node `crypto` (AES-256-GCM)
- **express-session**, **ws** (WebSocket-Realtime)

### DevOps
- **Docker & Docker Compose** (App + Admin, GHCR-Image `ghcr.io/toupsy/wachplan-generator`)
- **GitHub Actions** (CI: `npm ci` + `npm test`; Cloudflare-Worker-Preview für PRs)
- **Semantic Release** (automatische Versionierung nach Merge auf `main`)

---

## 🛠️ Entwicklung

### Setup

```bash
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator
npm install
cp .env.example .env   # Secrets eintragen
npm start              # → http://localhost:3000
```

### Frontend-Ladereihenfolge (wichtig!)

Die `<script>`-Reihenfolge in `public/Wachplan-Generator.html` muss eingehalten werden:

```
state → utils → dates → autoCodes → config → seed → render-sidebar →
generate → render-output → export → move → state-io → user-info → share →
realtime → plans-ui → login-modal → init
```

`public/js/generate.js` ist der **Kern-Algorithmus** (Scoring, Rotation, Fairness).
Detaillierte Modul-Übersicht: **CLAUDE.md → „Codebase-Map"**.

### Commit- & Release-Konvention

Versionierung läuft automatisch über **Semantic Release** anhand der Commit-Prefixe
([Conventional Commits](https://www.conventionalcommits.org/)):

| Prefix | Wirkung |
|--------|---------|
| `fix:` | Patch-Release (x.y.**z**) |
| `feat:` | Minor-Release (x.**y**.0) |
| `feat!:` / `BREAKING CHANGE:` | Major-Release (**x**.0.0) |
| `chore:`, `docs:`, `refactor:` … | kein Versions-Bump |

**Workflow:** Niemals direkt auf `main`. Feature-Branch (`feature/<name>` / `fix/<name>`) →
PR gegen `main`. Nach dem Merge bumpt Semantic Release `package.json` und committet den
Release zurück (`chore(release): x.y.z [skip ci]`).

### Testing

```bash
npm test   # Node --test über test/*.test.js
```

- **Algorithmus-Invarianten** sind die eigentliche Absicherung (9 Szenarien + 100 Fuzz-Läufe):
  keine Person doppelt/Tag, keine Kranken in aktiven Slots, kein geschlossener Turm/Boot belegt,
  `slotCount`/`leaderCount` eingehalten.
- **Performance-Baseline:** ~20 ms für 28 Personen × 14 Tage.
- **CI** (`.github/workflows/test.yml`) führt `npm ci` + `npm test` bei jedem Push/PR aus (Node 20);
  ein roter Test blockt den Merge.
- Hinweis: `session-user-deletion.test.js` ist gelegentlich flaky (IPC) → Suite erneut laufen lassen.
  Backend-Änderungen mindestens mit `node -c` + manuell prüfen (Backend wenig automatisiert).

---

## ❓ FAQ & Troubleshooting

### 🔴 Häufige Probleme

**„Cannot find module 'sqlite3'" beim Test**
→ `npm install` im frischen Container ausführen.

**`validateEnv` bricht den Start ab**
→ `MASTER_SECRET` (≥ 32), `SALT` (≥ 16) und `SESSION_SECRET` (≥ 16) in `.env` setzen.

**Login schlägt fehl (401)**
→ Erst-Admin via `POST /api/auth/init` oder `ADMIN_*` in `.env` angelegt? Passwort korrekt?
DB unter `data/wachplan.db` vorhanden? Bei Docker `docker compose restart`.

**Plan wird nicht gespeichert (500)**
→ Server-Logs prüfen (`docker logs dlrg-wachplan`); `curl /health`; Plan-State im Browser-Console kontrollieren.

**XLSX-Export bricht / Template fehlt**
→ `public/Wachplan Template.xlsx` muss existieren; die CSP des öffentlichen Servers erlaubt
`cdnjs.cloudflare.com` (JSZip) – bei eigenem Reverse-Proxy nicht blockieren.

### ❓ Häufige Fragen

**Wie viele Personen/Tage sind möglich?**
Max. 28 Personen (XLSX-Limit), 1–14 Tage, 16 Stationsspalten. Türme `slotCount` 1–10, Boote 1–3.

**Wie funktioniert die Echtzeit-Kollaboration?**
WebSocket verbindet beim Login; jeder Save wird an andere Nutzer gebroadcastet (Konflikt: letzter Save gewinnt).

**Was bewirkt der Seed?**
`0` = keiner. `1–999` = deterministische Permutation an Tag 1; die Gesamtfairness pendelt sich über die Tage ein.

**Kann ich alte Pläne importieren?**
Ja – über die UI (📋 Meine Pläne → Importieren) oder `POST /api/import/plans`. Auto-Verschlüsselung beim Import.

**Wie funktioniert die Update-Anzeige?**
`GET /api/version` vergleicht die laufende Version mit dem neuesten GitHub-Release (6 h gecacht);
das Frontend zeigt Badge + Toast bei einem Update.

---

## 🤝 Beitragen

1. **Fork** das Repository
2. **Feature-Branch:** `git checkout -b feature/deine-feature`
3. **Commit** mit Conventional-Commit-Prefix: `git commit -m "feat: XYZ"`
4. **Push:** `git push origin feature/deine-feature`
5. **Pull Request** gegen `main` öffnen

### 📋 Contribution Checklist
- [ ] `npm test` lokal grün
- [ ] Conventional-Commit-Prefix gesetzt (steuert das Release)
- [ ] Passende Doku aktualisiert (FEATURES.md / CLAUDE.md / HANDOFF.md – s. Wartungsvertrag in CLAUDE.md)
- [ ] PR gegen `main`

---

## 📋 Lizenz

MIT License – siehe [LICENSE](LICENSE).

---

## 📞 Support

- **Issues & Bugs:** [GitHub Issues](https://github.com/Toupsy/Wachplan-Generator/issues)
- **Technische Details:** [CLAUDE.md](CLAUDE.md)
- **Deployment-Guide:** [docs/DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

**Made with ❤️ for DLRG Wasserrettungsdienste**
