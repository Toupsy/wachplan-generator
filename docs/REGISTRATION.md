# Registrierung, E-Mail-Verifizierung & Passwort-Reset

Setup-Guide für die Selbstregistrierung mit Bot-Schutz (reCAPTCHA v3),
E-Mail-Verifizierung und Passwort-Reset per Mail. Alle Bausteine sind
**einzeln optional** und werden rein über `.env` aktiviert – ohne Konfiguration
verhält sich die App wie bisher (Registrierung per `REGISTRATION_MODE`,
kein Mail-Versand, kein CAPTCHA).

## Überblick: Wer macht was?

| Baustein | Aktiviert durch | Wirkung |
|---|---|---|
| Selbstregistrierung | `REGISTRATION_MODE=open` oder `code` | Register-Formular im Login-Modal |
| E-Mail-Verifizierung | `SMTP_HOST` gesetzt (+ Registrierung aktiv) | E-Mail wird Pflichtfeld, Account erst nach Bestätigungslink aktiv (Login vorher: 403) |
| Passwort-Reset | `SMTP_HOST` gesetzt | „Passwort vergessen?"-Link im Login, Reset-Link 60 min gültig |
| Bot-Schutz | `RECAPTCHA_SITE_KEY` + `RECAPTCHA_SECRET_KEY` | reCAPTCHA v3 auf Registrierung + Reset-Anfrage (unsichtbar, score-basiert) |

Passwörter werden wie bisher mit **bcrypt** (bcryptjs, 10 Runden) gehasht;
Tokens (Verifizierung/Reset) werden nur als **SHA-256-Hash** gespeichert
(ein DB-Leak liefert keine gültigen Links) und sind **Einmal-Tokens**
(`used_at`), Verifizierung 24 h / Reset 60 min gültig.

## 1. E-Mail-Versand (SMTP) einrichten

```ini
SMTP_HOST=smtp.example.org
SMTP_PORT=587            # 587 = STARTTLS (Default); 465 = SMTPS → SMTP_SECURE=true
SMTP_SECURE=false
SMTP_USER=wachplan@example.org
SMTP_PASS=geheim
MAIL_FROM=wachplan@example.org   # optional, Default: SMTP_USER
APP_BASE_URL=https://wachplan.example.org   # PFLICHT: Basis für Links in Mails
```

- **APP_BASE_URL nicht vergessen** – sonst zeigen Bestätigungs-/Reset-Links auf
  `http://localhost:3000` (der Server warnt beim Start).
- Versand läuft über [nodemailer](https://nodemailer.com). Für Gmail/Office365
  App-Passwörter verwenden; für DLRG-Infrastruktur den Vereins-SMTP.
- **Test/Entwicklung ohne SMTP:** `MAIL_TRANSPORT=outbox` aktiviert die Mail-Features,
  Mails landen nur in-memory (wird von `test/auth-flow.test.js` genutzt).

### Verhalten mit aktivem Mail-Versand
1. **Registrierung:** E-Mail ist Pflicht (Format + Eindeutigkeit geprüft, generische
   Fehlermeldung gegen Enumeration). Account wird mit `pending_verification=1` angelegt,
   **kein Auto-Login**, Bestätigungsmail mit Link (`GET /api/auth/verify-email?token=…`).
   Schlägt der Mail-Versand fehl, wird der Account zurückgerollt (kein toter Account).
2. **Login vor Bestätigung:** `403` mit `code: "email_unverified"`; das Frontend bietet
   „Mail erneut senden" an (`POST /api/auth/resend-verification`, entwertet alte Tokens).
3. **Bestätigung:** Link setzt `pending_verification=0` und leitet auf `/?verified=1`
   (SPA zeigt Erfolgsmeldung) bzw. `/?verified=0` bei ungültigem/abgelaufenem Token.
4. **Passwort vergessen:** `POST /api/auth/request-password-reset` (Antwort immer generisch),
   Mail-Link `/?reset=<token>` öffnet die „Neues Passwort"-Ansicht der SPA.
   `POST /api/auth/reset-password` setzt das Passwort (min. 10 Zeichen, bcrypt),
   **invalidiert alle Sessions des Users** und gilt zugleich als E-Mail-Bestätigung.

Bestandsnutzer (vor diesem Feature angelegt) haben `pending_verification=0` und
können sich unverändert einloggen; Admin-Anlage (`/api/auth/init`, Admin-Panel)
bleibt verifizierungsfrei.

## 2. reCAPTCHA v3 einrichten

1. Unter <https://www.google.com/recaptcha/admin> eine Site vom Typ **reCAPTCHA v3**
   anlegen und die Domain(s) eintragen.
2. Keys in `.env` setzen (beide – der Server bricht bei halber Konfiguration ab):
   ```ini
   RECAPTCHA_SITE_KEY=…
   RECAPTCHA_SECRET_KEY=…
   RECAPTCHA_MIN_SCORE=0.5   # optional, Default 0.5
   ```
3. Fertig – das Frontend lädt das reCAPTCHA-Script nur, wenn der Server per
   `GET /api/auth/registration-status` einen `captchaSiteKey` meldet, und holt vor
   dem Absenden ein Token (`action: register` bzw. `password_reset`).

Server-seitig (`server/captcha.js`): Verifizierung gegen
`https://www.google.com/recaptcha/api/siteverify` mit Action- und Score-Prüfung,
**fail-closed** (Google nicht erreichbar → Anfrage abgelehnt). Die CSP in
`server.js` wird nur bei gesetzten Keys um `www.google.com`/`www.gstatic.com`
(script-src) und `frame-src https://www.google.com` erweitert.

> **Datenschutz:** reCAPTCHA lädt Google-Ressourcen im Browser. Für DSGVO-konforme
> Nutzung den Hinweis im Formular (wird automatisch eingeblendet) belassen und
> die Datenschutzerklärung (docs/DATENSCHUTZ.md / datenschutz.html) ergänzen.
> Alternativ CAPTCHA weglassen und `REGISTRATION_MODE=code` als Bot-Hürde nutzen.

## 3. API-Referenz (neue/erweiterte Endpoints)

| Endpoint | Beschreibung |
|---|---|
| `GET /api/auth/registration-status` | `{ enabled, requiresCode, emailVerification, passwordReset, captchaSiteKey }` |
| `POST /api/auth/register` | + Felder `password2`, `captchaToken`; E-Mail Pflicht bei aktiver Verifizierung; Antwort ggf. `{ verificationRequired: true }` ohne Session |
| `GET /api/auth/verify-email?token=…` | Bestätigungslink, Redirect `/?verified=1\|0` |
| `POST /api/auth/resend-verification` | Body `{ username }` oder `{ email }`, Antwort immer generisch |
| `POST /api/auth/request-password-reset` | Body `{ email, captchaToken? }`, Antwort immer generisch; `503` wenn kein Mail-Versand |
| `POST /api/auth/reset-password` | Body `{ token, password, password2 }`; invalidiert alle Sessions des Users |

Alle neuen Endpoints nutzen das bestehende IP-Rate-Limit (10 Anfragen/15 min)
und schreiben Audit-Log-Einträge (`register`, `email_verify`,
`password_reset_request`, `password_reset`).

## 4. Sicherheits-Eigenschaften

- **Keine Account-Enumeration:** Reset-/Resend-Antworten sind immer generisch;
  doppelte E-Mail/Username bei Registrierung → einheitlich „Registrierung nicht möglich".
- **Tokens:** 32 Byte `crypto.randomBytes`, nur SHA-256-Hash in der DB, Einmal-Nutzung,
  pro User+Typ existiert nur das jeweils neueste Token.
- **Session-Invalidierung:** Passwort-Reset löscht alle Sessions des Users
  (`sessions`-Tabelle in der Haupt-DB).
- **Plan-Verschlüsselung unberührt:** Der AES-Key wird aus `userId + MASTER_SECRET`
  abgeleitet (nicht aus dem Passwort) → Passwort-Reset macht keine Pläne unlesbar.
- **Fail-closed CAPTCHA**, Score-Schwelle konfigurierbar, Action-Bindung
  (Token von der Login-Seite kann nicht für die Registrierung verwendet werden).

## 5. Testen

`test/auth-flow.test.js` (Teil von `npm test`) deckt den kompletten Flow ab:
Registrierung (Validierung, Mail, pending), Login-Sperre, Verifizierung
(inkl. Token-Reuse/Expiry), Resend, Reset-Anfrage (Enumeration), Reset
(Passwortwechsel, Session-Invalidierung, Token-Reuse) und CAPTCHA
(fehlend/abgelehnt/Score/gültig, Google-API gemockt). Läuft ohne SMTP über
`MAIL_TRANSPORT=outbox` gegen eine Wegwerf-SQLite-DB (`DATABASE_PATH`).
