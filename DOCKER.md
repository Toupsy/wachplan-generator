# Docker-Setup für DLRG Wachplan-Generator

Diese Datei erklärt, wie du die App auf deiner NAS mit Docker hostest.

---

## Voraussetzungen

- Docker installiert (oder Docker Desktop)
- Docker Compose installiert
- ~500 MB freier Speicherplatz
- Port 3000 verfügbar (oder anpassen in `docker-compose.yml`)

---

## Quick Start (3 Schritte)

### 1. Projekt auf die NAS kopieren

```bash
# Alle Dateien kopieren (inkl. Dockerfile, docker-compose.yml, etc.)
# Zielordner: /mnt/nas/wachplan oder ~/docker/wachplan
```

### 2. Docker Image bauen & Container starten

```bash
cd /pfad/zur/wachplan-generator

# Einmalig: Image bauen + Container hochfahren
docker-compose up -d

# Logs prüfen (optional)
docker-compose logs -f wachplan
```

### 3. Im Browser öffnen

```
http://nas-ip:3000
```

Fertig! ✅

---

## Befehle

### Container verwalten

```bash
# Status prüfen
docker-compose ps

# Logs ansehen
docker-compose logs -f wachplan

# Container neustarten
docker-compose restart wachplan

# Container stoppen
docker-compose stop wachplan

# Komplett herunterfahren
docker-compose down

# Neubau (wenn Code geändert wurde)
docker-compose up -d --build
```

### Persistente Daten

```bash
# Volume inspect (wo Daten gespeichert werden)
docker volume inspect $(docker volume ls -q | grep wachplan)

# Daten sichern
docker run --rm -v wachplan_wachplan-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/wachplan-backup.tar.gz -C /data .

# Daten zurückstellen
docker run --rm -v wachplan_wachplan-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/wachplan-backup.tar.gz -C /data
```

---

## Konfiguration

### Port ändern (falls 3000 belegt)

Bearbeite `docker-compose.yml`:
```yaml
ports:
  - "8080:3000"  # Extern:3000 → 8080
```

Dann neustarten:
```bash
docker-compose down && docker-compose up -d
```

### Environment-Variablen

`docker-compose.yml` setzt bereits:
- `PORT=3000` — innerer Port
- `HOST=0.0.0.0` — höre auf allen Interfaces
- `NODE_ENV=production` — Performance-Mode

Du kannst weitere Variablen hinzufügen unter `environment:`.

---

## Health-Check

Docker prüft alle 30s, ob die App noch läuft:

```bash
# Manuell testen
curl http://localhost:3000/health

# Response:
# {"status":"ok","timestamp":"2026-06-01T..."}
```

Falls die App crasht, startet Docker sie automatisch neu.

---

## Backup & Restore

### Automatisches Backup (Cron)

Erstelle `backup.sh`:
```bash
#!/bin/bash
BACKUP_DIR="/mnt/nas/backups/wachplan"
mkdir -p $BACKUP_DIR
TIMESTAMP=$(date +%Y%m%d_%H%M%S)

docker run --rm -v wachplan_wachplan-data:/data -v $BACKUP_DIR:/backup \
  alpine tar czf /backup/wachplan_$TIMESTAMP.tar.gz -C /data .

# Alte Backups löschen (älter als 30 Tage)
find $BACKUP_DIR -name "wachplan_*.tar.gz" -mtime +30 -delete

echo "Backup erstellt: $BACKUP_DIR/wachplan_$TIMESTAMP.tar.gz"
```

In Crontab eintragen:
```bash
crontab -e
# Täglich um 2:00 Uhr:
0 2 * * * /path/to/backup.sh
```

---

## Troubleshooting

### Container startet nicht

```bash
# Logs prüfen
docker-compose logs wachplan

# Häufige Fehler:
# - Port 3000 belegt? → Port ändern
# - npm install fehlgeschlagen? → Cache löschen:
docker-compose down
docker system prune -a
docker-compose up -d --build
```

### App antwortet nicht (aber Container läuft)

```bash
# In den Container gehen
docker-compose exec wachplan sh

# Server-Logs prüfen
cat /app/server.js  # Code kontrollieren
ps aux | grep node  # Prozess läuft?
```

### Daten weg nach Neustart

Das sollte nicht passieren (Volume ist persistent). Falls doch:
```bash
# Volume-Liste anzeigen
docker volume ls

# Spezifisches Volume prüfen
docker volume inspect wachplan_wachplan-data
```

### Sehr langsam / Memory-Leak

```bash
# Docker Ressourcen limitieren (optional, docker-compose.yml)
services:
  wachplan:
    ...
    deploy:
      resources:
        limits:
          cpus: '1'
          memory: 512M
        reservations:
          cpus: '0.5'
          memory: 256M
```

---

## Updates

Wenn du den Code änderst:

```bash
# Neue Version bauen
docker-compose up -d --build

# Alte Images aufräumen (optional)
docker image prune -a
```

---

## Production-Tipps

### Reverse Proxy (Nginx/Traefik)

Falls mehrere Services auf der NAS laufen:

```nginx
# /etc/nginx/sites-available/wachplan
server {
    listen 80;
    server_name wachplan.nas.local;

    location / {
        proxy_pass http://localhost:3000;
        proxy_http_version 1.1;
        proxy_set_header Upgrade $http_upgrade;
        proxy_set_header Connection 'upgrade';
        proxy_set_header Host $host;
        proxy_cache_bypass $http_upgrade;
    }
}
```

### SSL/HTTPS

```yaml
# docker-compose.yml
services:
  wachplan:
    ...
    environment:
      - HTTPS=true
      - CERT_PATH=/app/certs/cert.pem
      - KEY_PATH=/app/certs/key.pem
    volumes:
      - ./certs:/app/certs:ro
```

(Zertifikate z.B. von Let's Encrypt)

---

## Support

- Docker Docs: https://docs.docker.com/
- Docker Compose Docs: https://docs.docker.com/compose/
- Problem? Logs prüfen: `docker-compose logs -f`

Happy scheduling! 🎯
