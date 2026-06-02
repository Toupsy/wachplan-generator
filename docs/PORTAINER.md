# DLRG Wachplan-Generator – Portainer Deployment Guide

## 🚀 Quick Start mit Portainer

### Schritt 1: Docker Compose Stack erstellen

1. Öffne Portainer: `https://dein-server:9443`
2. Gehe zu **Stacks** → **Add Stack**
3. Wähle **Git Repository** oder **Web Editor**
4. Gib diese URL ein (Git Repository):
   ```
   https://github.com/Toupsy/Wachplan-Generator.git
   ```
5. Nutze Branch: `main`
6. Compose file path: `docker-compose.yml`

### Schritt 2: Umgebungsvariablen (Secrets) setzen

⚠️ **WICHTIG:** Du musst die Secrets setzen BEVOR du den Stack deployest!

#### Methode A: Environment Variables in Portainer UI

1. Im Stack-Editor, scrollen Sie zu **Environment variables**
2. Klick **Add environment variable** für jede Variable:

   ```
   MASTER_SECRET    = <your-random-base64-32>
   SALT             = <your-random-base64-16>
   SESSION_SECRET   = <your-random-base64-32>
   ```

#### Methode B: .env Datei hochladen

1. Erstelle eine `.env` Datei lokal:
   ```bash
   cp .env.example .env
   # Fülle die Werte aus (siehe unten)
   ```

2. In Portainer: **Stacks** → **Upload .env file**
3. Wähle deine `.env` Datei

### Schritt 3: Secrets generieren

Falls du noch keine Secrets hast, generiere sie:

```bash
# MASTER_SECRET (32 bytes base64)
openssl rand -base64 32

# SALT (16 bytes base64)
openssl rand -base64 16

# SESSION_SECRET (32 bytes base64)
openssl rand -base64 32
```

Beispiel `.env` Datei:
```env
NODE_ENV=production
PORT=3000
ADMIN_PORT=3001
HOST=0.0.0.0

MASTER_SECRET=xw41LPAHcjYtbrsGCtFAmXnNPsB6khaVAVSWiTZC+iM=
SALT=D1pW2yiSDarYqLvTdx6lJA==
SESSION_SECRET=672V4yvt/7wfDVntuoAUfD8VUezCu2T/ReO9i+iOYm0=

DATABASE_PATH=/app/data/wachplan.db
```

### Schritt 4: Stack deployen

1. Klick **Deploy the stack**
2. Warte bis beide Services `running` sind:
   - `dlrg-wachplan-generator` (Port 3000)
   - `dlrg-wachplan-admin` (Port 3001)

### Schritt 5: Admin-User erstellen

```bash
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourSecurePassword"}'
```

Oder über Portainer Exec:
```bash
docker exec dlrg-wachplan-generator \
  curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"YourSecurePassword"}'
```

---

## 📍 Zugriff nach Deployment

```
Hauptanwendung:   http://dein-server:3000
Admin Panel:      http://dein-server:3001
```

## 🔍 Logs anschauen

In Portainer:
1. **Containers** → wachplan oder wachplan-admin
2. **Logs** Tab
3. Oder: `docker logs dlrg-wachplan-generator -f`

## ⚠️ Troubleshooting

### "env file not found"
✅ **Gelöst:** Wir nutzen jetzt Environment Variables statt `env_file`

Stelle sicher dass die Secrets in den Environment Variables gesetzt sind!

### Containers starten nicht

1. Überprüfe Logs:
   ```bash
   docker logs dlrg-wachplan-generator
   ```

2. Häufige Fehler:
   - **"MASTER_SECRET required"** → Secrets nicht gesetzt
   - **"port 3000 already in use"** → Port ist belegt
   - **"permission denied"** → Docker-Berechtigungen

### Admin-Panel unerreichbar

1. Überprüfe ob Service läuft:
   ```bash
   docker ps | grep wachplan-admin
   ```

2. Teste Konnektivität:
   ```bash
   curl http://localhost:3001/health
   ```

---

## 🔐 Sicherheit

### Production Best Practices

1. **Firewall Rules:**
   - Port 3000: Öffentlich (Benutzer)
   - Port 3001: Restricted (nur Admin-Netzwerk)
   - Port 3443 (Portainer): Restricted (nur Admin)

2. **Secrets Management:**
   - Nutze Portainer **Secrets** statt Environment Variables
   - Oder: Docker Swarm Secrets
   - NIEMALS Secrets in Git committen

3. **Backups:**
   ```bash
   # Volume backup
   docker run --rm -v wachplan-data:/data -v $(pwd):/backup \
     alpine tar czf /backup/wachplan-data.tar.gz /data
   ```

4. **SSL/TLS:**
   - Nutze Reverse Proxy (Nginx, Traefik)
   - Let's Encrypt Zertifikate
   - Nur HTTPS Zugriff

---

## 📊 Monitoring

### Health Checks

Portainer zeigt Health-Status automatisch:
- 🟢 Green: Container läuft und ist healthy
- 🟡 Yellow: Startet gerade
- 🔴 Red: Health-Check failure

Manuell überprüfen:
```bash
# Main app
curl http://localhost:3000/health

# Admin panel
curl http://localhost:3001/health
```

### Performance

In Portainer Containers:
- **CPU Usage**
- **Memory Usage**
- **Network I/O**
- **Restart Count**

---

## 🚀 Updates

```bash
# Neue Version deployen
1. Portainer: Stacks → wachplan
2. Click "Pull latest image"
3. Click "Re-deploy"

# Oder via CLI:
docker pull ghcr.io/toupsy/wachplan-generator:latest
docker-compose up -d
```

---

## 📞 Support

- **Logs:** `docker logs dlrg-wachplan-generator`
- **Status:** `docker ps`
- **Volumes:** `docker volume ls`
- **Networking:** `docker network ls`

---

**Viel Erfolg beim Deployment! 🎉**
