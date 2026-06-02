# DLRG Wachplan-Generator – Deployment-Anleitung

## Docker Deployment (Empfohlen)

### Voraussetzungen
- Docker & Docker Compose installiert
- Git installiert

### Schritt 1: Repository klonen
```bash
git clone https://github.com/Toupsy/Wachplan-Generator.git
cd Wachplan-Generator
```

### Schritt 2: Environment-Variablen konfigurieren
```bash
cp .env.example .env
```

**Wichtig:** Bearbeite `.env` und generiere neue Secrets:
```bash
openssl rand -base64 32    # MASTER_SECRET
openssl rand -base64 16    # SALT
openssl rand -base64 32    # SESSION_SECRET
```

Ersetze die Placeholder in `.env` mit den generierten Werten.

### Schritt 3: Docker Image bauen (Optional, wenn nicht von ghcr.io verfügbar)
```bash
docker build -t dlrg-wachplan-generator:latest .
```

### Schritt 4: Container starten
```bash
docker-compose up -d
```

Der Service läuft jetzt auf `http://localhost:3000`

### Schritt 5: Admin-User erstellen
```bash
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SICHERES_PASSWORT_EINGEBEN"}'
```

**Response:**
```json
{"success":true,"message":"Admin user created"}
```

## Datenbank
- SQLite-Datei: `/app/data/wachplan.db`
- Automatisch initialisiert beim ersten Start
- In Docker-Volume `wachplan-data` persistent gespeichert

## Sicherheit
- ✅ AES-256-GCM Verschlüsselung für Plandaten (at-rest)
- ✅ bcryptjs Passwort-Hashing (10 Rounds)
- ✅ Session-basierte Authentifizierung (HTTPOnly Cookies)
- ✅ Per-User Encryption Keys (PBKDF2-derived)
- ✅ Non-root Docker User (nodejs:nodejs)

## Features nach Deployment

### Login
- Adresse: `http://localhost:3000`
- Username/Passwort eingeben
- Cookie-basierte Session (7 Tage max)

### Admin-Panel
- Adresse: `http://localhost:3000/admin.html`
- Nur für Admin-User zugänglich
- User-Verwaltung (erstellen/löschen)
- Admin-Rechte vergeben

### Plan-Import
- Alte `.json`-Pläne hochladen
- Automatisch verschlüsselt gespeichert
- Im Hauptmenü: "📁 Alte Pläne importieren"

### API Endpoints
```
POST   /api/auth/login              – Login
POST   /api/auth/logout             – Logout
GET    /api/auth/me                 – Session-Info

GET    /api/plans                   – Alle Pläne auflisten
POST   /api/plans                   – Plan erstellen
GET    /api/plans/:id               – Plan laden
PUT    /api/plans/:id               – Plan speichern
DELETE /api/plans/:id               – Plan löschen

POST   /api/import/plans            – Alte Pläne importieren

GET    /api/admin/users             – User auflisten (Admin only)
POST   /api/admin/users             – User erstellen (Admin only)
DELETE /api/admin/users/:id         – User löschen (Admin only)

GET    /health                      – Health-Check
```

## Logs anschauen
```bash
docker-compose logs -f wachplan
```

## Container stoppen
```bash
docker-compose down
```

## Datenbank backup
```bash
docker-compose exec wachplan tar czf - /app/data > wachplan-backup-$(date +%Y%m%d).tar.gz
```

## Troubleshooting

### "address already in use"
```bash
docker ps | grep wachplan
docker stop CONTAINER_ID
docker-compose up -d
```

### Database Fehler
```bash
# Database zurücksetzen
docker-compose exec wachplan rm /app/data/wachplan.db
docker-compose restart wachplan
```

### Admin-User vergessen
```bash
# Neue Seite öffnen wenn kein Admin existiert (wird angezeigt beim Start)
# Oder Container neu starten und POST /api/auth/init aufrufen
```

## Production-Checkliste

- [ ] Neue Secrets mit `openssl rand` generiert
- [ ] `.env` nicht in Git committed
- [ ] SSL/TLS Reverse-Proxy eingerichtet (z.B. Nginx)
- [ ] Backups der `wachplan-data` Volume konfiguriert
- [ ] Firewall nur Port 80/443 erlaubt (nicht 3000)
- [ ] Docker Auto-Restart konfiguriert
- [ ] Monitoring für Container-Health eingerichtet

## Support
- GitHub Issues: https://github.com/Toupsy/Wachplan-Generator/issues
- Dokumentation: siehe CLAUDE.md
