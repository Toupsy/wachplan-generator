# 🚀 Docker Quick Start (5 Min)

## TL;DR für die NAS

### 1. Dateien auf NAS kopieren
```bash
# Alle Dateien vom Projekt kopieren zu:
/mnt/nas/docker/wachplan/   # oder ~/docker/wachplan
```

### 2. Docker-Container starten
```bash
cd /mnt/nas/docker/wachplan
docker-compose up -d
```

### 3. Im Browser öffnen
```
http://nas-ip:3000
```

**Fertig!** ✅

---

## Wichtige Befehle

| Befehl | Was es tut |
|--------|-----------|
| `docker-compose up -d` | Starten (Hintergrund) |
| `docker-compose logs -f` | Logs anschauen (Live) |
| `docker-compose restart` | Neustarten |
| `docker-compose stop` | Stoppen |
| `docker-compose down` | Komplett runterfahren |
| `docker-compose ps` | Status prüfen |

---

## Falls es nicht funktioniert

### 1. Docker installiert?
```bash
docker --version
docker-compose --version
```

### 2. Logs anschauen
```bash
docker-compose logs -f wachplan
```

### 3. Port belegt?
Falls Port 3000 busy: In `docker-compose.yml` anpassen:
```yaml
ports:
  - "8080:3000"   # 3000 → 8080 (extern)
```

### 4. Container nochmal neu bauen
```bash
docker-compose down
docker-compose up -d --build
```

---

## Port-Weiterleitungen (falls hinter Firewall)

### Nginx Reverse Proxy
```nginx
server {
    listen 80;
    server_name wachplan.mynas.de;
    
    location / {
        proxy_pass http://localhost:3000;
        proxy_set_header Host $host;
        proxy_set_header X-Real-IP $remote_addr;
    }
}
```

---

## Daten sichern

```bash
# Backup erstellen
docker run --rm -v wachplan_wachplan-data:/data -v $(pwd):/backup \
  alpine tar czf /backup/wachplan-backup.tar.gz -C /data .

# Backup restoren
docker run --rm -v wachplan_wachplan-data:/data -v $(pwd):/backup \
  alpine tar xzf /backup/wachplan-backup.tar.gz -C /data
```

---

## Weitere Docs

- **Vollständiges Setup-Guide:** [DOCKER.md](./DOCKER.md)
- **Projekt-Info:** [README.md](./README.md)
- **Code-Doku:** [CLAUDE.md](./CLAUDE.md)

---

**Noch Fragen?** → [DOCKER.md](./DOCKER.md) hat Troubleshooting Section
