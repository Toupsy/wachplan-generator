# 🚨 DLRG Wachplan-Generator

Automatische Wachplan-Generierung für DLRG-Wasserrettungsdienste mit fairer Rotation, Admin-Panel und verschlüsselter Speicherung.

**Status:** ✅ Production-ready mit Multi-User Authentication & Encryption

---

## 📑 Inhaltsverzeichnis

- [🎯 Features](#-features)
- [🚀 Quick Start](#-quick-start)
- [📖 Dokumentation](#-dokumentation)
- [🔐 Sicherheit](#-sicherheit)
- [💾 Speicherung & API](#-speicherung--api)
- [📦 Tech Stack](#-tech-stack)
- [🛠️ Entwicklung](#-entwicklung)
- [❓ FAQ & Troubleshooting](#-faq--troubleshooting)
- [🤝 Beitragen](#-beitragen)
- [📋 Lizenz](#-lizenz)

---

## 🎯 Features

### 📅 Automatische Wachplanenerierung
- Automatische Einteilung für **1–14 Tage**
- Faire Rotation basierend auf fortgeschrittenem **Fairness-Scoring**
- Intelligente Bootsführer-Verteilung (BF-Schutz, Erfahrungslevel)
- Konsekutiv-Tag-Regeln zur Vermeidung von Monotonie
- Seed-basierte Szenarien für deterministische Start-Konstellationen

### 📊 Übersichtliche Pläne
- Visuelle **Tages-Karten** mit Turm- und Bootsbesetzung
- **Echtzeit-Statistiken** (Fairness-Metriken, Paarungs-Diversität)
- Pro-Person Tower-Statistik mit Unique-Turm-Tracking
- Paarungs-Kreuztabelle zur Einsicht in Zusammenarbeitshäufigkeit
- Farbige Fairness-Anzeige (Grün = ausgeglichen, Orange = Schieflage)

### 💾 Flexible Export & Import
- **XLSX-Export** als offizielles DLRG-Formular (Styles/Bilder erhalten)
- **CSV-Export** für Datenverarbeitung
- **JSON-Export** zur lokalen Speicherung
- Import alter localStorage-Pläne mit automatischer Verschlüsselung
- Bulk-Import mehrerer Dateien

### 🎮 Benutzerfreundliche Steuerung
- **Drag-and-Drop** zum manuellen Verschieben von Personen
- **Daten-Konfiguration** (Personen, Türme, Boote) in der Sidebar
- **Zwangszuweisungen** transparent (visuell) oder effektiv (mit Neuberechnung)
- Automatische Sick/Closed-Markierung mit sofortiger Neuberechnung
- Seed-Input (0–999) für verschiedene deterministische Start-Szenarien

### 🔒 Sicherheit & Multi-User
- **AES-256-GCM Verschlüsselung** für Plandaten (at rest)
- **Per-User Encryption Keys** basierend auf PBKDF2 (100k Iterationen)
- **Session-basiertes Login** mit HTTPOnly Cookies
- **Admin-Panel** für User-Management (Port 3001)
- **Plan-Sharing** mit unterschiedlichen Zugriffsrollen (edit/view)
- **Echtzeit-Kollaboration** via WebSocket

### 🔄 Live-Updates
- Automatische Aktualisierung bei Plan-Änderungen durch andere Nutzer
- WebSocket-basierte Echtzeit-Synchronisation
- Echo-Schutz (keine Duplikate bei eigenem Speichern)
- Automatisches Reconnect bei Verbindungsverlust

---

## 🚀 Quick Start

### Option 1: Docker (Empfohlen für Production)

```bash
# Repository klonen
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator

# Umgebung konfigurieren
cp .env.example .env
# → Bearbeite .env mit eigenen Secrets (siehe DEPLOYMENT.md)

# Service starten
docker-compose up -d

# Health Check
curl http://localhost:3000/health

# Admin-User erstellen (einmalig)
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SICHERES_PASSWORT"}'

# Öffne http://localhost:3000 im Browser
```

### Option 2: Lokal (Development)

```bash
# Dependencies installieren
npm install

# Server starten
NODE_ENV=development PORT=3000 npm start

# Öffne http://localhost:3000 im Browser
```

**Hinweis:** Im Development-Mode werden Pläne lokal in `localStorage` gespeichert (kein DB-Encryption).

### Option 3: Docker (Development)

```bash
# Development-Image mit lokaler .env
docker-compose -f docker-compose.dev.yml up

# oder mit npm-Scripts
npm run dev
```

---

## 📖 Dokumentation

### 🎓 Hauptdokumentation

| Dokument | Zweck |
|----------|-------|
| **[DEPLOYMENT.md](docs/DEPLOYMENT.md)** | Production-Setup, Docker-Konfiguration, Portainer-Integration, TLS-Termination |
| **[CLAUDE.md](CLAUDE.md)** | Technische Architektur, Algorithmus-Details, Dateistruktur, API-Übersicht |
| **[db/schema.sql](server/db/schema.sql)** | SQLite-Datenbankschema |

### 🏠 Project Structure

```
.
├── public/                       # Frontend (statisch serviert)
│   ├── Wachplan-Generator.html  # Main UI
│   ├── admin.html               # Admin-Panel
│   ├── js/                      # Frontend-Logik (State, Render, Generate)
│   └── Wachplan Template.xlsx   # DLRG-Vorlage für Export
├── server/                       # Backend (Node.js + Express)
│   ├── server.js                # Main Server
│   ├── admin-server.js          # Admin Server (Port 3001)
│   ├── db/                      # SQLite & Encryption
│   └── api/                     # REST Endpoints
├── data/                         # SQLite Database (gitignored)
├── .env.example                 # Secrets-Vorlage
├── docker-compose.yml           # Production Compose
└── package.json                 # Dependencies & Scripts
```

---

## 🔐 Sicherheit

### ✅ Implementierte Maßnahmen

| Maßnahme | Standard | Details |
|----------|----------|---------|
| **Datenverschlüsselung** | AES-256-GCM | NIST-Standard, Authenticated Encryption |
| **Passwort-Hashing** | bcryptjs | 10 Rounds, 2^10 Iterationen |
| **Key Derivation** | PBKDF2 | 100.000 Iterationen, SHA-256, pro User gecacht |
| **Session Management** | HTTPOnly Cookies | 7-Tage TTL, sameSite:lax, Session-Fixation-Schutz |
| **SQL Injection** | Parametrisierte Queries | 100% durchgehend (sqlite3 mit Bindings) |
| **XSS-Schutz** | escapeHtml() + textContent | Alle User-Inputs sanitized |
| **CSRF-Schutz** | sameSite Cookies | Ausreichend für einfache Formulare |

### 🔑 Geheimnisverwaltung

Alle Secrets müssen in `.env` (gitignored) konfiguriert werden:

```bash
# Generiere neue Secrets für Production:
openssl rand -base64 32    # MASTER_SECRET (≥32 Bytes)
openssl rand -base64 16    # SALT (≥16 Bytes)
openssl rand -base64 32    # SESSION_SECRET (≥16 Bytes)
```

**Wichtig:** Diese Secrets sind in Encryption Keys eingebunden. Rotation erfordert Daten-Re-Encryption.

### ⚠️ Sicherheits-Checkliste für Production

- [ ] `.env` mit starken Secrets generiert
- [ ] TLS/HTTPS aktiviert (TLS-Terminating Proxy)
- [ ] `cookie.secure: true` in `db/session.js` aktiviert
- [ ] `MASTER_SECRET`, `SALT` gesichert & gebackupt
- [ ] Regelmäßige DB-Backups durchgeführt
- [ ] Admin-Passwort geändert
- [ ] Docker Images von privatem Registry gezogen (optional)

---

## 💾 Speicherung & API

### 📊 Datenspeicher

| Speicherort | Format | Verschlüsselt | Persistent |
|-------------|--------|---------------|-----------|
| `/app/data/wachplan.db` | SQLite | Nein | Ja |
| Plandaten | BLOB | **AES-256-GCM** ✅ | Ja |
| User-Passwörter | Hash | **bcryptjs** ✅ | Ja |
| Sessions | JSON | ❌ (HTTPOnly Cookie) | Ja |

### 🔌 REST API

**Authentication:**
```
POST   /api/auth/login              { username, password }
POST   /api/auth/logout             (Clear Session)
GET    /api/auth/me                 (Current User)
POST   /api/auth/init               { username, password } (First Admin only)
PUT    /api/auth/password           { currentPassword, newPassword }
```

**Plans (Authenticated):**
```
GET    /api/plans                   List all plans (owned + shared)
POST   /api/plans                   { name, state } → Create
GET    /api/plans/:id               Load (Decrypted)
PUT    /api/plans/:id               { state, name } → Save (Encrypted)
DELETE /api/plans/:id               Delete (Owner only)
POST   /api/plans/:id/share         { username, role:'edit'|'view' }
DELETE /api/plans/:id/share/:userId Remove Share
GET    /api/plans/:id/shares        List Shares
```

**Admin (Admin-Only):**
```
GET    /api/admin/users             List all users
POST   /api/admin/users             { username, password }
DELETE /api/admin/users/:id         Delete user (cascade plans)
PUT    /api/admin/users/:id/password { password } → Set password
```

**Other:**
```
GET    /health                      Health Check
POST   /api/import/plans            { plans: [{ name, state }] }
```

---

## 📦 Tech Stack

### 🖼️ Frontend
- **Vanilla JavaScript** (0 Dependencies, kein Framework)
- **Dark Theme** mit CSS-Variablen
- **Responsive Design** (Mobile, Tablet, Desktop)
- **Drag-and-Drop** (native HTML5 API)
- **Export-Formate:** XLSX (via JSZip), CSV, JSON

### 🖥️ Backend
- **Node.js** + **Express.js** (REST API)
- **SQLite3** (Lightweight, embedded DB)
- **bcryptjs** (Passwort-Hashing, 10 Rounds)
- **crypto** (Node.js built-in, AES-256-GCM)
- **express-session** (Session Management)
- **ws** (WebSocket für Echtzeit-Sync)

### 🐳 DevOps
- **Docker & Docker Compose** (Multi-Container)
- **GitHub Container Registry** (ghcr.io)
- **GitHub Actions** (CI/CD)
- **Health Checks** & Monitoring
- **Volume-Persistent** Data Storage

---

## 🛠️ Entwicklung

### Setup

```bash
# Repo klonen
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator

# Dependencies
npm install

# Development-Server
npm start
# → http://localhost:3000
```

### Dateistruktur für Entwickler

**Frontend-Ladereihenfolge** (wichtig!):
```
public/js/state.js          # Globale Variablen
public/js/utils.js          # Hilfsfunktionen
public/js/dates.js          # Datumsberechnung
public/js/autoCodes.js      # Auto-Codes + freshDayState()
public/js/seed.js           # Beispieldaten (Fallback)
public/js/render-sidebar.js # Konfiguration UI
public/js/generate.js       # KERN-Algorithmus
public/js/render-output.js  # Ausgabe-Panel
public/js/export.js         # XLSX/CSV/JSON Export
public/js/move.js           # Modal zum Verschieben
public/js/state-io.js       # Server-Sync & Plan-Manager
public/js/login-modal.js    # Login UI
public/js/user-info.js      # User-Info Header
public/js/share.js          # Plan-Teilen
public/js/realtime.js       # WebSocket Client
public/js/plans-ui.js       # Plan-Manager UI
public/js/init.js           # Event-Listener + Start
```

**Backend-Einstiegspunkte:**
- `server/server.js` – Main Server (Port 3000)
- `server/admin-server.js` – Admin Server (Port 3001, separate Prozess)

### Commit-Konvention

Nach jeder Änderung:
1. **VERSION** Datei um 0.0001 erhöhen (z.B. 0.3.4 → 0.3.5)
2. **CLAUDE.md** mit neuen Features/Änderungen aktualisieren
3. Git-Commit erstellen (keine Co-authored-by)
4. Feature-Branch → Pull Request gegen `main`

**Beispiel:**
```bash
# Änderungen testen
npm start

# VERSION erhöhen + CLAUDE.md aktualisieren
# ...dann:
git add .
git commit -m "Add feature: XYZ description"
git push origin feature/xyz
# → Create PR gegen main
```

### Testing & Performance

**Invarianten** (automatisch geprüft):
- Keine Doppel-Besetzung am selben Tag
- Keine kranken Personen eingeteilt
- Keine geschlossenen Türme/Boote belegt
- `slotCount` Einhaltung

**Bewährte Test-Szenarien:**
- Baseline: 6 Personen, 14 Tage
- Kranke Personen
- Geschlossene Türme/Boote
- Zwangszuweisungen (effektiv/transparent)
- Extremlast: alle krank / alle Türme zu

**Performance-Baseline:** ~20ms für 28 Pers. × 14 Tage

---

## ❓ FAQ & Troubleshooting

### 🔴 Häufige Probleme

#### "Cannot find template XLSX"
```
Error: fetch('Wachplan Template.xlsx') failed
```
**Lösung:**
- Datei `public/Wachplan Template.xlsx` existiert nicht
- Manuell kopieren oder neu erstellen
- Im Browser: F12 → Network → XLSX-Fetch prüfen

#### "Login funktioniert nicht"
```
POST /api/auth/login → 401 Unauthorized
```
**Lösungen:**
1. Admin-User erstellt? → `/api/auth/init` aufrufen
2. Passwort korrekt?
3. DB vorhanden? → `/data/wachplan.db` prüfen
4. SERVER neugstartet? → `docker-compose restart`

#### "Plan wird nicht gespeichert"
```
PUT /api/plans/:id → 500 Error
```
**Lösungen:**
1. Server läuft? → `curl http://localhost:3000/health`
2. DB-Fehler? → Server-Logs prüfen: `docker logs wachplan`
3. Vollständig der Plan-State? → Browser Console prüfen

#### "Boote werden nicht angezeigt"
```
Turm wird angezeigt, aber keine Boote darunter
```
**Lösungen:**
1. Boot zur Tower hinzugefügt? → Sidebar prüfen
2. Boot-slotCount > 0?
3. Seite neuladen (F5)?

### ❓ Häufige Fragen

**F: Kann ich Pläne ohne Login verwenden?**  
A: Ja, im Development-Mode. Production erfordert Login (Encryption-Keys brauchen userId).

**F: Wie viele Personen/Tage sind möglich?**  
A: Max. 28 Personen (XLSX-Limit), 1–14 Tage, ∞ Türme/Boote. Performance ~20ms bei max. Auslastung.

**F: Wie funktioniert Echtzeit-Kollaboration?**  
A: WebSocket verbindet sich beim Login. Jeder Save wird an andere Users gebroadcasted. Konflikt-Auflösung: letzter Save gewinnt.

**F: Kann ich alte Plans importieren?**  
A: Ja, via `POST /api/import/plans` oder UI (Menü: 📋 Meine Pläne → Importieren). Auto-Encryption beim Import.

**F: Was passiert bei Seed-Input?**  
A: 0 = Standard, 1–999 = deterministische Fisher-Yates Permutation auf Tag 1. Alle Seeds → identische Gesamtfairness nach Ausbalancierung.

**F: Wie rückgängig machen bei Fehlern?**  
A: Transparent-Verschiebung (Folgetage unverändert) oder manuell einzelne Personen neu ziehen. Keine Undo-Funktion (müsste Vollversion + Diff speichern).

---

## 🤝 Beitragen

Contributions sind **sehr willkommen**! Bitte:

1. **Fork** das Repository
2. Erstelle einen **Feature-Branch:** `git checkout -b feature/deine-feature`
3. **Commit** mit beschreibendem Message: `git commit -m "Add feature: XYZ"`
4. **Push** zum Repository: `git push origin feature/deine-feature`
5. Öffne einen **Pull Request** mit Beschreibung

### 📋 Contribution Checklist
- [ ] Feature/Fix lokal getestet
- [ ] VERSION Datei erhöht (CLAUDE.md Konvention)
- [ ] CLAUDE.md aktualisiert (neue Features dokumentiert)
- [ ] Keine Co-authored-by Zeilen in Commits
- [ ] PR gegen `main` (nicht gegen Production-Branches)

---

## 📋 Lizenz

MIT License – siehe [LICENSE](LICENSE) für vollständigen Text.

---

## 📞 Support & Community

- **Issues & Bugs:** [GitHub Issues](https://github.com/Toupsy/Wachplan-Generator/issues)
- **Diskussionen:** [GitHub Discussions](https://github.com/Toupsy/Wachplan-Generator/discussions)
- **Technische Details:** [CLAUDE.md](CLAUDE.md)
- **Deployment-Guide:** [DEPLOYMENT.md](docs/DEPLOYMENT.md)

---

**Made with ❤️ for DLRG Wasserrettungsdienste**

```
Version: 2.1.0 (Production Ready)
Last Updated: 2026-06-04
Status: ✅ Multi-User, Encrypted, Real-Time
```
