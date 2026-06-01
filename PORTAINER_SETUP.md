# 🐳 Portainer Setup für DLRG Wachplan-Generator

Diese Anleitung erklärt, wie du die App über **Portainer** auf deiner NAS deployst.

---

## Was ist Portainer?

Portainer ist eine **Web-GUI für Docker** — statt Kommandozeile kannst du Container grafisch verwalten:
- Container starten/stoppen
- Logs anschauen
- Volumes verwalten
- docker-compose.yml deployen

---

## Schritt 1: Portainer auf der NAS installieren

Falls noch nicht vorhanden:

```bash
# Portainer-Container starten (einmalig)
docker run -d \
  -p 8000:8000 \
  -p 9000:9000 \
  -v /var/run/docker.sock:/var/run/docker.sock \
  -v portainer_data:/data \
  --name portainer \
  --restart always \
  portainer/portainer-ce:latest
```

Dann öffnen: **http://nas-ip:9000**

---

## Schritt 2: Projekt-Dateien vorbereiten

### Option A: Git Clone (empfohlen)

```bash
cd /mnt/nas/docker  # oder ~/docker
git clone https://github.com/Toupsy/Wachplan-Generator.git wachplan
cd wachplan
```

### Option B: Dateien manuell kopieren

```bash
# Alle Dateien vom Projekt zu NAS kopieren:
# - Wachplan-Generator.html
# - js/ (ganzer Ordner)
# - Wachplan Template.xlsx
# - Dockerfile
# - docker-compose.yml
# - server.js
# - package.json
# - etc.
```

---

## Schritt 3: Stack in Portainer erstellen

### 3a) Portainer öffnen
1. Browser: **http://nas-ip:9000**
2. Login mit Admin-Passwort
3. Linke Sidebar: **Stacks** klicken

### 3b) New Stack
1. Klick: **"Add Stack"**
2. Name eingeben: `wachplan` (oder `dlrg-wachplan-generator`)
3. **Web Editor** auswählen (nicht "Upload file")

### 3c) docker-compose.yml einfügen
Kopiere den Inhalt von `docker-compose.yml` ins Textfeld:

```yaml
version: '3.8'

services:
  wachplan:
    build:
      context: .
      dockerfile: Dockerfile
    container_name: dlrg-wachplan-generator
    ports:
      - "3000:3000"
    environment:
      - PORT=3000
      - HOST=0.0.0.0
      - NODE_ENV=production
    volumes:
      - wachplan-data:/app/data
    restart: unless-stopped
    healthcheck:
      test: ["CMD", "wget", "--quiet", "--tries=1", "--spider", "http://localhost:3000/health"]
      interval: 30s
      timeout: 3s
      retries: 3
      start_period: 10s

volumes:
  wachplan-data:
    driver: local
```

### 3d) Deploy
1. Klick: **"Deploy the stack"**
2. **Warten** (5-10 Minuten beim ersten Mal, Image wird gebaut)
3. Unter **Containers** sollte `dlrg-wachplan-generator` **Running** sein

---

## Schritt 4: App öffnen

Browser: **http://nas-ip:3000**

Fertig! ✅

---

## Portainer Features

### Logs anschauen
```
Stacks → wachplan → Logs
```

### Container neu starten
```
Containers → dlrg-wachplan-generator → Restart
```

### Daten sichern
```
Volumes → wachplan_wachplan-data → Inspect
```

### Stack aktualisieren (neuer Code)
```
1. Docker Host: git pull origin main
2. Portainer: Stacks → wachplan → "Update the stack"
3. Wartet auf erneutes bauen
```

---

## Alternative: Stack aus Git-Repo

Falls du **Git Integration** nutzen möchtest (Auto-Update wenn Code ändert):

### In Portainer:
1. **Stacks** → **Add Stack** → **Repository** auswählen
2. GitHub URL: `https://github.com/Toupsy/Wachplan-Generator.git`
3. Reference: `main` (oder `feature/fairness-metrics`)
4. Compose Path: `docker-compose.yml`
5. **Deploy**

Dann kann Portainer automatisch auf Code-Änderungen reagieren:
```
Auto update: aktivieren
Pull & redeploy: bei Git-Push automatisch
```

---

## Multi-Node Swarm (für mehrere NAS)

Falls du mehrere Docker-Hosts hast:

1. Portainer → **Endpoints** → Docker Host hinzufügen
2. Stack deployen zu mehreren Nodes
3. Load-Balancing über nginx/Traefik möglich

---

## Troubleshooting in Portainer

### Container läuft nicht / "Restarting"
```
Containers → dlrg-wachplan-generator
→ Logs anschauen → Fehler suchen
```

### Image-Build-Fehler
```
Stacks → wachplan → "Update the stack"
→ Schaut Debug-Output → Fehler beheben lokal
→ git push
→ Portainer: Redeploy
```

### Volumes gelöscht?
```
Volumes → wachplan_wachplan-data
→ "Inspect" → Daten noch da? (sollten sein)
→ Falls nicht → Backup-Restore durchführen
```

---

## Performance-Tuning

### RAM/CPU Limits setzen

In Portainer: **Stacks → wachplan → Editor**

```yaml
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

### Reverse Proxy (Portainer UI)

1. **Settings** → **Proxy Settings**
2. Nginx/Traefik konfigurieren
3. URL: `https://wachplan.mynas.de` (statt `nas-ip:3000`)

---

## Backup via Portainer

### Manuell
```
Volumes → wachplan_wachplan-data → Export
```

### Automatisiert (Cron in Portainer)
```
Webhooks → Stack Backups
(gibt's in Enterprise, Community: script outside Portainer)
```

---

## Tipps & Tricks

### Port 3000 ist belegt?
Portainer UI → Stacks → wachplan → Edit:
```yaml
ports:
  - "8080:3000"  # Extern 8080, intern 3000
```

### Debug-Mode
```yaml
environment:
  - NODE_ENV=development  # Statt production
  - DEBUG=*
```

### Container-Shell öffnen
```
Containers → dlrg-wachplan-generator → Console
→ Shell kommandos eingeben
```

---

## Weitere Ressourcen

- **Portainer Doku**: https://docs.portainer.io/
- **Docker Compose Referenz**: https://docs.docker.com/compose/compose-file/
- **Projekt README**: [README.md](./README.md)
- **Docker Setup**: [DOCKER.md](./DOCKER.md)

---

**Happy Container Management! 🎯**
