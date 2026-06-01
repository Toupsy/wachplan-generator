# 🐳 Docker Hub Push (optional)

Falls du das Image auf **Docker Hub** pushen möchtest, um es von überall zu pullen (schneller als lokal bauen):

---

## Schritt 1: Docker Hub Account

1. Gehe zu **https://hub.docker.com/signup**
2. Account erstellen (kostenlos)
3. Notiere deinen **Username** (z.B. `yannis`)

---

## Schritt 2: Lokal bauen & pushen

```bash
cd "C:\Users\Yanni\Wachplan Generator"

# 1. Anmelden
docker login
# → Gibst Username + Passwort ein

# 2. Image mit korrektem Tag bauen
docker build -t yannis/dlrg-wachplan:latest .

# 3. Zu Docker Hub pushen
docker push yannis/dlrg-wachplan:latest

# Fertig! ✅ Image ist jetzt auf Docker Hub
```

---

## Schritt 3: Von Docker Hub pullen

### Auf der NAS:

```bash
cd /mnt/nas/docker/wachplan

# 1. docker-compose.yml anpassen
# Zeile 4-7 ersetzen mit:
# image: yannis/dlrg-wachplan:latest

# 2. Container starten (pullt automatisch von Hub)
docker-compose up -d
```

Oder direkt CLI:

```bash
docker run -d \
  -p 3000:3000 \
  -v wachplan-data:/app/data \
  --name wachplan \
  --restart unless-stopped \
  yannis/dlrg-wachplan:latest
```

---

## Schritt 4: In Portainer nutzen

1. **Stacks** → **Add Stack**
2. **Web Editor**, paste:

```yaml
version: '3.8'
services:
  wachplan:
    image: yannis/dlrg-wachplan:latest
    ports:
      - "3000:3000"
    volumes:
      - wachplan-data:/app/data
    restart: unless-stopped

volumes:
  wachplan-data:
```

3. Deploy → Image wird von Docker Hub gepullt

---

## Vorteil Docker Hub

| Feature | Local Build | Docker Hub |
|---------|-------------|-----------|
| **Speed** | 5-10 min (baut) | 30 sec (pullt) |
| **Bandwidth** | Hoch (baut lokal) | Niedrig (just download) |
| **Sharing** | Nur privat | Mit anderen teilbar |
| **Updates** | `docker-compose up --build` | Nur neu pullen |

---

## Image Updates pushen

```bash
# Code ändern lokal
git commit -m "..."

# Neues Image bauen & pushen
docker build -t yannis/dlrg-wachplan:v2.1 .
docker push yannis/dlrg-wachplan:v2.1

# Auf NAS: docker-compose.yml Tag ändern
# image: yannis/dlrg-wachplan:v2.1
docker-compose pull && docker-compose up -d
```

---

## Tagging Strategy

```bash
# Latest (Standard)
docker build -t yannis/dlrg-wachplan:latest .

# Versioniert
docker build -t yannis/dlrg-wachplan:v2.0 .
docker build -t yannis/dlrg-wachplan:v2.0-alpine .

# Tag als both
docker tag yannis/dlrg-wachplan:latest yannis/dlrg-wachplan:v2.0
docker push yannis/dlrg-wachplan:latest
docker push yannis/dlrg-wachplan:v2.0
```

---

## Private Image (nur du siehst es)

```bash
# Hub-Repo auf "Private" stellen
# (in Docker Hub Web UI: Settings → Repository Visibility)

# Oder: Lokales Registry verwenden
# docker run -d -p 5000:5000 registry:2
```

---

## Troubleshooting

### "Unauthorized" beim Push?
```bash
docker logout
docker login
# Gibst Credentials richtig ein
```

### Image zu groß?
```bash
# .dockerignore bearbeiten (am besten schon gemacht)
cat .dockerignore  # Sollte node_modules, .git, etc. haben
```

### Zu langsam?
```bash
# Multi-stage Dockerfile nutzen (schon implementiert)
# Oder: nur kleinere Teile pushen
docker push yannis/dlrg-wachplan:latest --compression=gzip
```

---

## Öffentlich teilen

Falls du das Image teilen möchtest (z.B. andere DLRG-Gruppen):

```bash
# Docker Hub URL:
https://hub.docker.com/r/yannis/dlrg-wachplan

# Deploy für andere:
docker run -d -p 3000:3000 yannis/dlrg-wachplan:latest
```

---

**Weitere Infos:** https://docs.docker.com/docker-hub/

