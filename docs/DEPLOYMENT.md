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

Die Services laufen jetzt auf:
- **Hauptanwendung:** `http://localhost:3000`
- **Admin-Panel:** `http://localhost:3001` (separate Instance)

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

### Basis-Sicherheitsmaßnahmen
- ✅ AES-256-GCM Verschlüsselung für Plandaten (at-rest)
- ✅ bcryptjs Passwort-Hashing (10 Rounds)
- ✅ Session-basierte Authentifizierung (HTTPOnly Cookies)
- ✅ Per-User Encryption Keys (PBKDF2-derived)
- ✅ Non-root Docker User (nodejs:nodejs)

### HTTPS/TLS für Production (DSGVO Art. 32)
Die Anwendung läuft standardmäßig auf Port 3000 **ohne TLS**. Bei Production-Deployments sollte TLS **vor der Anwendung** terminiert werden:

#### Empfohlene Konfiguration: TLS am Reverse-Proxy
```
Client (HTTPS)
    ↓
Reverse-Proxy / NAS (Synology/QNAP, TLS-Terminierung)
    ↓ HTTP (intern)
Wachplan-Generator (Port 3000)
```

**Aktiviere Secure Cookies:**
```bash
# .env
NODE_ENV=production
COOKIE_SECURE=true
```

Oder setze in Deinem Reverse-Proxy die Header:
```
X-Forwarded-Proto: https
```

Die Anwendung nutzt `trust proxy` automatisch (erkennt `X-Forwarded-Proto`). Mit `COOKIE_SECURE=true` wird das Session-Cookie mit dem `Secure`-Flag übertragen → Session-ID wird nie unverschlüsselt gesendet (GDPR-Compliance Art. 32).

#### Beispiel: Synology/QNAP NAS mit Reverse-Proxy
1. NAS-Admin-Panel öffnen → Reverse-Proxy Regel anlegen
2. Source: `https://your-nas.com`
3. Destination: `http://localhost:3000` (Container)
4. Enable: `Use HSTS`, `Trust WebSocket`
5. In der App: `.env` → `COOKIE_SECURE=true`

**Lokale HTTP-Entwicklung:** `COOKIE_SECURE` nicht setzen oder explizit `false` → erlaubt HTTP ohne Secure-Flag

## Echte Client-IP hinter Reverse-Proxy / Cloudflare

Das **Audit-Log** (Admin-Panel) und alle Stellen, die `req.ip` nutzen, zeigen die IP, die der
Server auf der Verbindung sieht. Steht ein Reverse-Proxy (NGINX) und/oder Cloudflare davor und
ist dieser **nicht** korrekt konfiguriert, erscheint dort die **interne Container-/Proxy-IP**
(z. B. `172.23.0.6`) statt der echten Besucher-IP – und die Standort-Spalte bleibt leer
(private IPs haben keinen Geo-Standort).

### Standard (kein Umbau nötig): App liest die IP aus den Headern

Die App ermittelt die echte Client-IP **automatisch aus den Proxy-Headern** und überschreibt damit
`req.ip` – ohne dass NGINX oder Cloudflare angepasst werden müssen. Reihenfolge:
`CF-Connecting-IP` (von Cloudflare) → `X-Real-IP` → erste Adresse aus `X-Forwarded-For`. Davon
profitieren **Audit-Log und Rate-Limiting** gleichermaßen. Cloudflare sendet `CF-Connecting-IP`
bei aktiviertem Proxy (orange Wolke) immer; NGINX reicht eingehende Header standardmäßig durch →
in den meisten Setups erscheint die echte IP + Standort sofort.

> ⚠️ **Sicherheits-Trade-off:** Diese Header sind **vom Client fälschbar**, falls jemand den
> Origin direkt – an Cloudflare/NGINX vorbei – erreicht. Für eine fälschungssichere Ermittlung
> sollte der Origin nur aus Cloudflare-Netzen erreichbar sein (Firewall/Origin-Zertifikat) und/oder
> die proxy-seitige **Variante A** (unten) genutzt werden. Letztere ist robuster, erfordert aber
> NGINX-Anpassung.

### Variante A (robust, proxy-seitig): Cloudflare → NGINX → App

Cloudflare liefert die **echte, nicht fälschbare** Besucher-IP im Header `CF-Connecting-IP`.
NGINX stellt sie wieder her (validiert gegen die Cloudflare-IP-Ranges) und reicht **genau diese
eine IP** als `X-Forwarded-For` an die App weiter – `trust proxy = 1` passt dann unverändert.

Vollständige Beispiel-Config: **[`docs/nginx.cloudflare.conf.example`](nginx.cloudflare.conf.example)**.
Kern:

```nginx
set_real_ip_from 173.245.48.0/20;   # … alle Cloudflare-Ranges (s. Beispieldatei)
real_ip_header CF-Connecting-IP;     # echte Besucher-IP → $remote_addr

location / {
    proxy_pass http://wachplan:3000;
    proxy_set_header Host            $host;
    proxy_set_header X-Real-IP       $remote_addr;
    proxy_set_header X-Forwarded-For $remote_addr;   # nur die echte IP, keine Kette
    proxy_set_header X-Forwarded-Proto $scheme;
    proxy_http_version 1.1;
    proxy_set_header Upgrade    $http_upgrade;        # WebSocket (Realtime)
    proxy_set_header Connection "upgrade";
}
```

**Wichtig (Sicherheit):** NGINX darf nicht direkt aus dem Internet erreichbar sein, sonst kann
jemand Cloudflare umgehen und `CF-Connecting-IP` fälschen. Origin per Firewall/Cloudflare-Origin-
Zertifikat so absichern, dass nur Cloudflare den Server erreicht. Die Cloudflare-IP-Ranges
gelegentlich gegen <https://www.cloudflare.com/ips/> aktualisieren.

### Alternative: ohne `CF-Connecting-IP` (Forwarded-Kette)

Reicht NGINX stattdessen `proxy_set_header X-Forwarded-For $proxy_add_x_forwarded_for;` weiter,
kommt bei der App die Kette `<client>, <cloudflare-edge>` an. Bei **zwei** Hops (Cloudflare +
NGINX) würde `trust proxy = 1` fälschlich die **Cloudflare-Edge-IP** als Client werten. Dann muss
der Hop-Count erhöht werden:

```bash
# .env
TRUST_PROXY=2
```

Die Variante mit `CF-Connecting-IP` (oben) ist robuster gegen Spoofing und unabhängig von der
Anzahl der Hops – daher bevorzugt.

## Selbstregistrierung (Feature 22)

Neue Nutzer können sich selbstständig einen Account erstellen — mit drei konfigurierbaren Sicherheitsmodi.

### Konfiguration

In `.env`:
```bash
# Selbstregistrierungsmodus: disabled (default) | open | code
REGISTRATION_MODE=disabled

# Wenn REGISTRATION_MODE=code, eine Registrierungs-Code setzen
# REGISTRATION_CODE=xyz123abc
```

### Modi erklärt

#### 1. Disabled (Standard)
```bash
REGISTRATION_MODE=disabled
```
- ✅ **Sicher für öffentliches Internet** – Keine Selbstregistrierung
- Neue User werden nur von Admin über `/admin.html` erstellt (`POST /api/admin/users`)
- Registrierungs-Link versteckt, Endpoint antwortet 403

#### 2. Open
```bash
REGISTRATION_MODE=open
```
- ⚠️ **Nur für vertrauenswürdige Umgebungen** (LAN mit Firewall, VPN)
- Jeder, der Zugriff auf die App hat, kann einen Account erstellen
- **Nicht geeignet für** produktive Instanzen im öffentlichen Internet

#### 3. Code (Empfohlen für gemeinsame Nutzung)
```bash
REGISTRATION_MODE=code
REGISTRATION_CODE=XyZ987mNaBc123
```
- ✅ **Kontrolliert + sicher** – Nur mit gültigem Code registrierbar
- Admin teilt Code mit vertrauenswürdigen Personen
- Code kann statisch sein oder regelmäßig rotiert werden
- **Ideal für:** DLRG-Ortsgruppen, Sportvereine, kleine Teams

### Beim Registrieren (Frontend)
- **Formular:** Username, Passwort, Passwort-Wiederholen, E-Mail (optional), Code (nur wenn Mode=code erforderlich)
- **Datenschutz-Checkbox:** Link zu `datenschutz.html`, **Pflichtfeld**
- **Auto-Login:** Nach erfolgreicher Registrierung wird der User automatisch eingeloggt
- **Fehlerbehandlung:** Non-enumerable Meldung ("Registrierung nicht möglich"), verhindert User-Enumeration

### Rate-Limiting
- 10 Registrierungs-Versuche pro IP / 15 Minuten
- 10 Versuche pro Account / 15 Minuten (Account-Lockout)
- Brute-Force-Schutz identisch mit Login

### Passwort-Anforderung
- Mindestens **10 Zeichen** (zentral erzwungen)
- Keine Komplexitäts-Anforderung
- Backend validiert auch, wenn Frontend validiert

### Beispiel-Workflow

**Szenario:** Ausbildungswoche mit 8 neuen Personen

1. **Admin deaktiviert vorübergehend Disable, setzt Code:**
   ```bash
   REGISTRATION_MODE=code
   REGISTRATION_CODE=Ausbildung2024
   ```

2. **Admin gibt Code an Personen weiter** (mündlich, Signal, etc.)

3. **Personen registrieren sich selbst:**
   - Browser: `http://your-app.local`
   - Klick "Neuen Account erstellen"
   - Eingabe: Username, Passwort, Code `Ausbildung2024`
   - Datenschutz akzeptiert
   - ✅ Account sofort aktiv, Auto-Login

4. **Nach Event: Code ändern/zurücksetzen**
   ```bash
   REGISTRATION_MODE=disabled  # Oder neuer Code
   ```

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
