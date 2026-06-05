# 🔐 DSGVO-Datenschutz für DLRG Wachplan-Generator

**Zielgruppe:** Organisationen, die den Wachplan-Generator Self-Hosted auf einer privaten NAS oder eigenem Server betreiben.

**Hinweis:** Diese Dokumentation behandelt die technischen und organisatorischen Maßnahmen (TOMs) gemäß DSGVO. Jede Organisation ist selbst verantwortlich für die Erfüllung ihrer Datenschutzverpflichtungen und sollte diese Dokumentation an ihre eigene Situation anpassen.

---

## 📑 Inhaltsverzeichnis

1. [Verzeichnis von Verarbeitungstätigkeiten (VVT)](#verzeichnis-von-verarbeitungstätigkeiten-vvt)
2. [Technische & Organisatorische Maßnahmen (TOMs)](#technische--organisatorische-maßnahmen-toms)
3. [NAS-Betrieb-Checkliste](#nas-betrieb-checkliste)
4. [Betroffenenrechte-Prozess](#betroffenenrechte-prozess)
5. [Datenschutz-Kontakt](#datenschutz-kontakt)

---

## Verzeichnis von Verarbeitungstätigkeiten (VVT)

### Kontext (Art. 30 DSGVO)

Diese Vorlage hilft der betreibenden Organisation, ihre Verarbeitungstätigkeit zu dokumentieren. Sie sollte als Vorlage betrachtet und an die konkrete Situation angepasst werden.

### VVT-Muster: Wachplanverwaltung

| Feld | Beispiel | Notiz |
|------|----------|-------|
| **Verantwortlicher** | [Organisation, Name, Kontakt] | Eintragen Sie die verantwortliche Organisation |
| **Betreiber (ggf.)** | [Server-Admin, Mail] | Falls externe IT-Unterstützung |
| **Verarbeitungszweck** | Automatische Einteilung von Rettungsschwimmern in Wachschichten für Wasserrettungseinsätze | |
| **Verarbeitete Datenarten** | - Name, Vornamen<br>- Rolle (Führung, Bootsführer, Wachgänger)<br>- Erfahrungslevel (erfahren/unerfahren)<br>- Einsatz-/Verfügbarkeitsdaten (krank, nicht verfügbar)<br>- Zeitstempel Logins (admin Panel) | Besonderheit: Sensible Daten? Nein (keine Gesundheitsdaten im eigentlichen Sinne; „krank" ist nur Verfügbarkeitsstatus) |
| **Verfügbarkeitsstatus** | Mindestspeicherdauer: Aktive Planungsdauer + 6 Monate (Kontrollfähigkeit)<br>Maximum: 3 Jahre | **Löschfrist:** Nach Planzweck + Aufbewahrungsfristen der Organisation |
| **Empfänger der Daten** | - Interne Nutzer der Organisation<br>- Evtl. externe Nutzer mit Zugriff via Share-Link (mit Zustimmung)<br>- ggf. externe Admins zur Wartung | Dokumentieren Sie ausdrücklich, wer Zugriff hat |
| **Drittländer-Übermittlung** | ❌ Keine (Self-Hosted auf eigenem Server/NAS) | Bei Cloud-Nutzung: Angemessenheitsbeschluss prüfen |
| **Verwendete Systeme** | DLRG Wachplan-Generator v2.1.0+<br>SQLite-Datenbank<br>Docker-Container (optional) | Versionierung für Nachverfolgung |
| **Sicherheitsmaßnahmen** | Siehe [TOMs](#technische--organisatorische-maßnahmen-toms) unten | |

---

## Technische & Organisatorische Maßnahmen (TOMs)

### ✅ **Bereits im Code implementiert**

#### Verschlüsselung & Authentifizierung
| Maßnahme | Standard | Beschreibung | Status |
|----------|----------|-------------|--------|
| **Datenverschlüsselung (at rest)** | AES-256-GCM | Alle Plandaten in der DB mit symmetrischer Verschlüsselung geschützt (NIST-Standard) | ✅ Implementiert |
| **Passwort-Hashing** | bcryptjs, 10 Rounds | Nutzer-Passwörter werden nicht im Klartext gespeichert | ✅ Implementiert |
| **Key Derivation (Pro-User Encryption)** | PBKDF2-SHA256, 100.000 Iterationen | Encryption-Keys werden pro Benutzer aus dem Passwort + Salz + Master-Secret abgeleitet → Benutzer können Plandaten gegenseitig nicht entschlüsseln | ✅ Implementiert |
| **Session Management** | HTTPOnly Cookies, 7-Tage TTL, `sameSite:lax` | Sessions sind in einer SQLite-Tabelle persistent gespeichert; Cookies sind vor JavaScript-Zugriff geschützt | ✅ Implementiert |

#### Input-Validierung & Injection-Schutz
| Maßnahme | Details | Status |
|----------|---------|--------|
| **SQL Injection-Schutz** | Alle Datenbankqueries verwenden parametrisierte Statements (sqlite3 mit Bindings) | ✅ 100% durchgehend |
| **XSS-Schutz** | Alle User-Inputs werden via `escapeHtml()` sanitized oder via `textContent` ausgegeben (kein `innerHTML` für UGC) | ✅ Implementiert |
| **CSRF-Schutz** | `sameSite:lax` Cookies; keine `GET`-Requests für State-Änderungen | ✅ Implementiert |

#### Infrastruktur
| Maßnahme | Details | Status |
|----------|---------|--------|
| **Non-root Container-User** | Docker-Image läuft als `nodejs:nodejs` (UID 1000), nicht als `root` | ✅ Implementiert |
| **Security-Header** | `X-Content-Type-Options: nosniff`, `X-Frame-Options: SAMEORIGIN`, `Referrer-Policy: same-origin` | ✅ Implementiert |
| **Secrets-Verwaltung** | `MASTER_SECRET`, `SALT`, `SESSION_SECRET` müssen in `.env` (gitignored) gespeichert werden, nicht im Code | ✅ Implementiert |

#### Admin-Panel & Nachverfolgung
| Maßnahme | Details | Status |
|----------|---------|--------|
| **Letzter Login-Timestamp** | Spalte `last_login` in users-Tabelle (NULL = noch nie eingeloggt) | ✅ Implementiert (v0.4.7+) |
| **Admin-Panel-Zugriff** | Separater Admin-Server (Port 3001), Login-erforderlich, Admin-only Endpoints | ✅ Implementiert |
| **Benutzer-Verwaltung** | Admins können Benutzer erstellen/löschen; Cascade-Delete entfernt Plandaten des Benutzers | ✅ Implementiert |

---

### ⚠️ **Durch den Betreiber zu implementieren / zu konfigurieren**

#### Network-Sicherheit

| TOM | Beschreibung | Priorität | Checkliste |
|-----|-------------|-----------|-----------|
| **TLS/HTTPS** | Container sollte NICHT direkt ins Internet exponiert werden. Stattdessen: Reverse-Proxy (nginx, Synology, QNAP) mit TLS-Termination vor dem Container. `cookie.secure: true` nur aktivieren, wenn TLS gesetzt ist. | ⚠️ Kritisch | - [ ] TLS-Zertifikat beschafft (Let's Encrypt, Self-Signed)<br>- [ ] Reverse-Proxy konfiguriert<br>- [ ] Cookie-Flag `secure:true` aktiviert |
| **Zugriffskontrolle (VPN/LAN)** | Der Wachplan-Generator sollte NUR über VPN oder internes LAN zugänglich sein, nicht direkt über öffentliches Internet exponiert werden. | ⚠️ Kritisch | - [ ] Firewall-Regeln konfiguriert<br>- [ ] VPN ggf. eingerichtet<br>- [ ] Port 3000/3001 nicht nach außen offen |
| **Netzwerk-Isolation** | Bei Docker: Container läuft in einem privaten Netzwerk; externe Kommunikation nur über Reverse-Proxy. | ℹ️ Standard | - [ ] docker-compose Netzwerk geprüft<br>- [ ] Host-Port-Exposition minimal |

#### Datensicherung & Schlüssel-Management

| TOM | Beschreibung | Priorität | Checkliste |
|-----|-------------|-----------|-----------|
| **Verschlüsselte Backups** | Datenbank `/app/data/wachplan.db` enthält `users` (Passwort-Hashes) und `plans` (verschlüsselte Plandaten). Backups sollten **verschlüsselt** ablegt werden (z.B. mit `gpg -c` oder Backup-Tool-Verschlüsselung). | ⚠️ Kritisch | - [ ] Backup-Lösung eingerichtet (z.B. NAS native, Rsync+GPG)<br>- [ ] Backup regelmäßig getestet (Restore-Test)<br>- [ ] Backup-Protokoll dokumentiert |
| **Getrennte Schlüsselverwaltung** | `MASTER_SECRET`, `SALT`, `SESSION_SECRET` (aus `.env`) sollten **GETRENNT** von der Datenbank-Sicherung gespeichert werden. Sind beide gleich verfügbar, kann die Verschlüsselung umgangen werden. | ⚠️ Kritisch | - [ ] Secrets in KeePass/Vault gespeichert<br>- [ ] Backup-Script: DB ≠ Secrets-Ablage<br>- [ ] Zugriff dokumentiert |
| **Secrets-Rotation** | Sollten Secrets kompromittiert sein, müssen alle Plandaten re-encrypted werden (technisch komplex). Deshalb: Secrets sicher lagern und Zugriff beschränken. | ℹ️ Standard | - [ ] Zugriffsbeschränkung definiert<br>- [ ] Notfall-Plan bei Kompromittierung |
| **Regelmäßige Updates** | Docker-Image sollte regelmäßig (monatlich oder nach Security-Patches) erneuert werden. | ⚠️ Wichtig | - [ ] Update-Frequenz definiert<br>- [ ] Update-Prozedur dokumentiert<br>- [ ] Test-Umgebung vorhanden |

#### Zugriff & Authentifizierung

| TOM | Beschreibung | Priorität | Checkliste |
|-----|-------------|-----------|-----------|
| **Admin-Passwort ändern** | Default Admin-User sollte bei Deployment mit sicherem Passwort erstellt und anschließend nicht mehr mit default Credentials genutzt werden. | ⚠️ Kritisch | - [ ] Admin-Passwort ≥8 Zeichen<br>- [ ] Passwort-Manager nutzen<br>- [ ] Passwort nicht im Code speichern |
| **Nutzer-Passwort-Richtlinie** | Organisation sollte eigene Passwort-Policy durchsetzen (z.B. mind. 8 Zeichen, Sonderzeichen). | ℹ️ Standard | - [ ] Policy dokumentiert<br>- [ ] Nutzer informiert<br>- [ ] Ggf. technisch erzwungen |
| **Limitierung fehlgeschlagener Logins** | Im Code implementiert: 10 Versuche pro 15 Minuten → HTTP 429. | ✅ Implementiert | - [ ] Monitoring: Sind Rate-Limits wirksam? |
| **Session-Timeouts** | Standard: 7 Tage. Bei Bedarf: In `db/session.js` anpassen. | ℹ️ Standard | - [ ] Timeout-Dauer festgelegt<br>- [ ] Nutzer informiert |

#### Monitoring & Incident Response

| TOM | Beschreibung | Priorität | Checkliste |
|-----|-------------|-----------|-----------|
| **Server-Logs monitoring** | `docker logs wachplan-server` regelmäßig prüfen auf: 401-Logins, Fehler, verdächtige Patterns. | ℹ️ Standard | - [ ] Log-Verfahren etabliert<br>- [ ] Alerting ggf. konfiguriert |
| **Datenbank-Integrität** | Regelmäßig prüfen: `sqlite3 data/wachplan.db "PRAGMA integrity_check;"` | ℹ️ Standard | - [ ] Check in Maintenance-Prozess |
| **Incident Response Plan** | Prozess für: Verdacht auf Datenpanne, Ransomware, Unbefugter Zugriff. | ⚠️ Wichtig | - [ ] Plan geschrieben<br>- [ ] Verantwortliche benannt<br>- [ ] Eskalation definiert |

---

## NAS-Betrieb-Checkliste

### Spezifische Hinweise für Synology, QNAP und ähnliche NAS-Systeme

#### 🔐 Sicherheitseinrichtung

```
✅ CHECKLIST AUSFÜHREN
```

**Phase 1: Netzwerk-Sicherung**
- [ ] **Port-Freigabe:** NAS-Admin (DiskStation Manager, QTS) prüfen:
  - Port 3000 und 3001 sind **NICHT nach außen freigegeben**
  - Zugriff nur von lokalen LAN-IPs oder via VPN-Tunnel
  - ℹ️ Tipp: Firewall-Regeln in Router setzen (UPnP deaktivieren)

- [ ] **TLS-Zertifikat beschaffen:**
  ```bash
  # Option A: Let's Encrypt (Synology/QNAP native möglich)
  # Option B: Self-Signed
  openssl req -x509 -newkey rsa:2048 -keyout key.pem -out cert.pem -days 365 -nodes
  ```

- [ ] **Reverse-Proxy konfigurieren** (für TLS-Termination):
  - Synology: `Reverse Proxy` in Control Panel → Application Portal
  - QNAP: `Reverse Proxy` im App Center
  - nginx manuell: Mapping von `:443/wachplan` → `:3000`

**Phase 2: Docker Setup (falls NAS-native Docker oder Portainer)**
- [ ] **Container-Netzwerk:** Private Bridge (nicht Host-Modus)
- [ ] **Image-Source:** Vertrauenswürdige Registry (z.B. GitHub Container Registry)
- [ ] **Health Check:** aktiviert (`GET /health` sollte `{"status":"ok"}` zurückgeben)
- [ ] **Restart-Policy:** `unless-stopped` (Auto-Recovery bei Crashes)
- [ ] **Resource-Limits:** optional aber empfohlen (z.B. 512MB RAM, 1 CPU)

**Phase 3: Secrets & Umgebung**
- [ ] **`.env` File eingespielt:**
  ```bash
  # NAS SSH/SCP:
  cp .env.example .env
  # Bearbeite mit nano oder Dateimanager:
  MASTER_SECRET=<openssl rand -base64 32>
  SALT=<openssl rand -base64 16>
  SESSION_SECRET=<openssl rand -base64 32>
  ```

- [ ] **Secrets nur lokal vorhanden:** `.env` ist nicht im Git-Repo, nicht im Backup zusammen mit der DB

**Phase 4: Datensicherung & Disaster Recovery**
- [ ] **Backup-Strategie definiert:**
  - Wann? (täglich, wöchentlich)
  - Wohin? (externe Festplatte, Cloud mit Encryption, zweite NAS)
  - Wie oft testen? (mind. monatlich Restore-Test)

- [ ] **Datenbank-Backup automatisiert** (z.B. via Cron):
  ```bash
  # Beispiel: Täglich um 02:00 Uhr
  # /app/data/wachplan.db sichern → /backup/wachplan.db.enc
  0 2 * * * docker exec wachplan-server \
    tar czf - /app/data/wachplan.db | \
    gpg -c --batch --passphrase "$(cat /secure/backup_key)" \
    > /mnt/backup/wachplan.db.tar.gz.gpg
  ```

- [ ] **Secrets separat sichern** (nicht in Auto-Backup!):
  - `.env` manuell in Passwort-Manager (KeePass, Bitwarden, LastPass)
  - Oder verschlüsselt in separater Sicherung
  - **NIEMALS** in Cloud-Backups zusammen mit DB

**Phase 5: Monitoring & Wartung**
- [ ] **Logs prüfen:** 
  ```bash
  docker logs wachplan-server | tail -50
  ```

- [ ] **Regelmäßige Updates:**
  - Monatlich: Docker-Image neu bauen (`docker pull ... && docker-compose up -d`)
  - Bei Security-Patches: So schnell wie möglich updaten

- [ ] **Datenbank-Integrität prüfen:**
  ```bash
  docker exec wachplan-server sqlite3 /app/data/wachplan.db "PRAGMA integrity_check;"
  ```

#### 📋 Konfigurationsbeispiel: Synology DSM 7

```bash
# SSH in NAS
# 1. Docker-Compose hochladen (z.B. via SCP)
scp -r wachplan-generator admin@nas.local:/volume1/docker/

# 2. SSH in NAS
ssh admin@nas.local

# 3. In der NAS:
cd /volume1/docker/wachplan-generator
cp .env.example .env
nano .env  # Secrets eintragen

# 4. Container starten
docker-compose up -d

# 5. Health Check
curl http://localhost:3000/health

# 6. Admin erstellen
curl -X POST http://localhost:3000/api/auth/init \
  -H "Content-Type: application/json" \
  -d '{"username":"admin","password":"SICHERES_PW"}'

# 7. Backup-Script konfigurieren
# In crontab via `crontab -e`:
# 0 2 * * * /usr/local/bin/backup-wachplan.sh
```

---

## Betroffenenrechte-Prozess

### Recht auf Auskunft (Art. 15 DSGVO)

**Prozess:**
1. **Anfrage erhalten:** Betroffene Person bittet um Auskunft über ihre gespeicherten Daten
2. **Identifizierung:** Prüfe, dass Anfrage von der Person selbst oder berechtigtem Vertreter kommt
3. **Daten zusammenstellen:**
   - Im Admin-Panel: Liste alle Benutzer (`/api/admin/users`)
   - Nach Benutzer filtern
   - Plan-Liste des Benutzers (`/api/plans`)
   - State exportieren (JSON) → zeigt alle Personen-Daten die in diesem Plan sind
4. **Auskunft erteilen:** Innerhalb 1 Monat, kostenlos (1 Kopie), ggf. schriftlich per Mail

**Anmerkung:** Der Wachplan-Generator speichert **selbst keine personenbezogenen Daten betroffener Personen** (Schwimmer, Rettungsschwimmer sind nicht Nutzer des Systems). Die einzigen Betroffenen sind die Planer (Nutzer), deren Daten via Login-Credentials geschützt sind.

### Recht auf Löschung (Art. 17 DSGVO)

**Prozess:**
1. **Anfrage:** Betroffene Person (oder Nutzer selbst) bittet um Löschung
2. **Überprüfung:**
   - Sind Zwecke erfüllt? (Plan erstellt, Pläne der Vergangenheit?)
   - Besteht Aufbewahrungspflicht? (z.B. Steuer, Haftung)
3. **Löschung durchführen:**
   - Admin-Panel: User + zugehörige Plans löschen (`DELETE /api/admin/users/:id`)
   - System führt Cascade-Delete durch: Alle `plans`, `plan_shares`, `sessions` werden gelöscht
4. **Bestätigung:** Nutzer erhält Bestätigung per E-Mail

### Recht auf Datenübertragbarkeit (Art. 20 DSGVO)

**Prozess:**
1. Nutzer exportiert seinen Plan als JSON (`🔽 JSON` Button)
2. Diese JSON-Datei kann in eine andere Instanz importiert werden
3. Alle Daten sind damit portierbar

### Recht auf Berichtigung (Art. 16 DSGVO)

**Prozess:**
1. Nutzer loggt sich ein
2. Bearbeitet seinen Plan (Namen, Rollen, Verfügbarkeit ändern)
3. Speichert (`🖉 Speichern`)
4. System verschlüsselt aktualisierte Daten

---

## Datenschutz-Kontakt

### Kontaktinformationen ausfüllen

| Rolle | Name | E-Mail | Telefon |
|-------|------|--------|---------|
| **Datenschutzverantwortlicher** | [Eintragen] | [Eintragen] | [Eintragen] |
| **Datenschutzbeauftragter (falls vorhanden)** | [Eintragen] | [Eintragen] | [Eintragen] |
| **Technischer Admin** | [Eintragen] | [Eintragen] | [Eintragen] |

### Dokumentation & Überprüfung

- [ ] Diese DATENSCHUTZ.md wurde von der Organisation durchgelesen und an die lokale Situation angepasst
- [ ] Alle Kontaktinformationen oben eingetragen
- [ ] Alle TOMs in der Checkliste durchgearbeitet
- [ ] Incident Response Plan geschrieben
- [ ] Backup-Prozess dokumentiert und getestet
- [ ] Betroffenenrechte-Prozesse für die Organisation angepasst
- [ ] Datenschutzerklärung der Organisation aktualisiert (externe Nutzer sollten wissen, dass Daten gespeichert werden)

### Versionskontrolle

| Datum | Version | Änderungen | Gültig ab |
|-------|---------|-----------|-----------|
| 2026-06-05 | 1.0 | Initial | 2026-06-05 |
| | | | |

---

## Zusätzliche Ressourcen

- **DSGVO-Text:** https://dsgvo-gesetz.de/
- **Bundesdatenschutzgesetz (BDSG):** https://www.gesetze-im-internet.de/bdsg_2018/
- **Arbeitsgruppe Datenschutz (WP29):** https://ec.europa.eu/justice/spc/index_en.htm
- **Tech-Dokumentation dieses Projekts:** [CLAUDE.md](../CLAUDE.md)
- **Deployment-Anleitung:** [DEPLOYMENT.md](DEPLOYMENT.md)

---

**Version:** 1.0  
**Gültig ab:** 2026-06-05  
**Nächste Überprüfung:** 2026-12-05

---

**Made with ❤️ for DLRG – Datenschutz-freundliche Wasserrettung**
