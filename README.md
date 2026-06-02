# 🚨 DLRG Wachplan-Generator

Automatische Wachplan-Generierung für DLRG-Wasserrettungsdienste mit fairer Rotation, Admin-Panel und verschlüsselter Speicherung.

**Status:** ✅ Production-ready mit Multi-User Authentication & Encryption

---

## 🎯 Features

### Core
- ✅ Automatische Wachplan-Generierung (1–14 Tage)
- ✅ Faire Rotation mit fortgeschrittenem Fairness-Scoring
- ✅ XLSX-Export als offizielles DLRG-Formular
- ✅ Drag-and-Drop Wach-Verschiebung
- ✅ Echtzeit-Statistiken & Verteilungsmetriken

### Authentifizierung & Multi-User
- ✅ Session-basiertes Login (HTTPOnly Cookies)
- ✅ Admin-Panel für User-Management
- ✅ Passwort-Hashing mit bcryptjs (10 Rounds)
- ✅ Automatische Admin-User-Erstellung

### Verschlüsselung
- ✅ AES-256-GCM Verschlüsselung für Plandaten
- ✅ Per-User Encryption Keys (PBKDF2)
- ✅ Sichere Schlüsselverwaltung
- ✅ Authenticated Encryption (verhindert Tampering)

### Migration & Import
- ✅ Import alter localStorage-Pläne
- ✅ Automatische Verschlüsselung beim Import
- ✅ Bulk-Import mehrerer Dateien

---

## 🚀 Quick Start

### 1. Docker (Empfohlen)
```bash
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator

# Konfiguriere Umgebung
cp .env.example .env
# Bearbeite .env mit eigenen Secrets (siehe DEPLOYMENT.md)

# Starte Service
docker-compose up -d

# Admin-User erstellen
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"PASSWORT"}'
```

### 2. Lokal (Development)
```bash
npm install
NODE_ENV=development PORT=3000 npm start

# Öffne http://localhost:3000
```

---

## 📖 Dokumentation

| Datei | Inhalt |
|-------|--------|
| [DEPLOYMENT.md](DEPLOYMENT.md) | Docker-Deployment & Production-Setup |
| [CLAUDE.md](CLAUDE.md) | Technische Architektur & Algorithmus-Details |
| [db/schema.sql](db/schema.sql) | Datenbankschema |

---

## 🔐 Sicherheit

### Implementiert
- ✅ AES-256-GCM Verschlüsselung (at rest)
- ✅ bcryptjs Passwort-Hashing
- ✅ HTTPOnly Session Cookies
- ✅ PBKDF2 Key Derivation (100k iterations)
- ✅ Non-root Docker User
- ✅ Per-User Encryption Keys

### Best Practices
```bash
# Generiere neue Secrets für Production:
openssl rand -base64 32    # MASTER_SECRET
openssl rand -base64 16    # SALT
openssl rand -base64 32    # SESSION_SECRET
```

---

## 📊 API Endpoints

### Public
```
POST   /api/auth/login              Login
POST   /api/auth/logout             Logout
GET    /api/auth/me                 Current User
POST   /api/auth/init               Create First Admin
GET    /health                      Health Check
```

### Authenticated
```
GET    /api/plans                   List Plans
POST   /api/plans                   Create Plan
GET    /api/plans/:id               Load Plan (Decrypted)
PUT    /api/plans/:id               Save Plan (Encrypted)
DELETE /api/plans/:id               Delete Plan

POST   /api/import/plans            Import Legacy Plans
```

### Admin-Only
```
GET    /api/admin/users             List Users
POST   /api/admin/users             Create User
DELETE /api/admin/users/:id         Delete User
```

---

## 💾 Datenspeicher

| Speicherort | Format | Verschlüsselt | Persistent |
|-------------|--------|--------------|-----------|
| `/app/data/wachplan.db` | SQLite | Ja (Plandaten) | Ja (Volume) |
| Plandaten | BLOB (AES-256-GCM) | ✅ Ja | ✅ Ja |
| User-Passwörter | Hash (bcryptjs) | ✅ Ja | ✅ Ja |
| Sessions | Text | ❌ Nein* | ✅ Ja |

\* Sessions sind HTTPOnly und können nicht via JavaScript zugegriffen werden

---

## 📦 Tech Stack

### Frontend
- Vanilla JavaScript (kein Framework)
- Dark Theme (CSS Variables)
- Responsive Design
- Drag-and-Drop

### Backend
- Node.js + Express.js
- SQLite3 + sqlite3
- bcryptjs (Passwort-Hashing)
- crypto (Node.js built-in, AES-256-GCM)
- express-session (Authentifizierung)

### DevOps
- Docker & Docker Compose
- GitHub Container Registry (ghcr.io)
- GitHub Actions CI/CD
- Health Checks & Monitoring

---

## 🤝 Beitragen

Contributions sind willkommen! Bitte:
1. Forken Sie das Repository
2. Erstellen Sie einen Feature-Branch: `git checkout -b feature/xyz`
3. Committen Sie Ihre Änderungen
4. Pushen Sie zum Repository
5. Öffnen Sie einen Pull Request

---

## 📋 Lizenz

MIT License - siehe [LICENSE](LICENSE) für Details.

---

## 📞 Support

- **Issues:** https://github.com/Toupsy/Wachplan-Generator/issues
- **Discussions:** https://github.com/Toupsy/Wachplan-Generator/discussions
- **Docs:** Siehe [CLAUDE.md](CLAUDE.md) für technische Details

---

**Made with ❤️ for DLRG Wasserrettungsdienste**

```
Version: 2.0.0 (Production Ready)
Last Updated: 2026-06-02
Status: ✅ Complete with Auth & Encryption
```
