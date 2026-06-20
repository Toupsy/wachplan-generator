// ============================================================
// Authentication API Routes
// POST /api/auth/login
// POST /api/auth/logout
// GET /api/auth/me
// POST /api/auth/init (Initialize first admin user)
// POST /api/auth/register (Self-service user registration)
// GET /api/auth/registration-status (Check if registration enabled)
// GET /api/auth/verify-email (E-Mail-Bestätigungslink aus der Mail)
// POST /api/auth/resend-verification (Bestätigungsmail erneut senden)
// POST /api/auth/request-password-reset (Reset-Link per Mail anfordern)
// POST /api/auth/reset-password (Neues Passwort via Reset-Token setzen)
// ============================================================

const express = require('express');
const router = express.Router();
const bcryptjs = require('bcryptjs');
const crypto = require('crypto');
const { dbRun, dbGet, dbAll, getDb } = require('../db/connection');
const { destroyUserSessions } = require('../db/session');
const { auditLog } = require('../db/init');
const { isMailEnabled, sendMail, baseUrl } = require('../mailer');
const { isCaptchaEnabled, verifyCaptcha } = require('../captcha');

// ───────────────────────────────────────────────────────────
// Security Constants
// ───────────────────────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 10;
const REGISTRATION_MODE = process.env.REGISTRATION_MODE || 'disabled'; // disabled | open | code

// E-Mail-Format: bewusst simpel (kein RFC-Parser), Länge nach RFC 5321
const EMAIL_RE = /^[^\s@]+@[^\s@]+\.[^\s@]+$/;
const isValidEmail = e => typeof e === 'string' && e.length <= 254 && EMAIL_RE.test(e);

// Audit-Log fire-and-forget (Login-Pfad darf an Logging nicht scheitern)
function _audit(userId, action, details, ip) {
  auditLog(getDb(), userId, action, 'user', userId, details, ip)
    .catch(err => console.error('Audit log error:', err.message));
}

// ───────────────────────────────────────────────────────────
// Einmal-Tokens (auth_tokens): nur SHA-256-Hash in der DB,
// Ablauf als Epoch-ms (timezone-sicher), Einlösung markiert used_at.
// ───────────────────────────────────────────────────────────
const TOKEN_TTL_MS = {
  verify_email: 24 * 60 * 60 * 1000,   // 24 h
  password_reset: 60 * 60 * 1000       // 60 min
};

const _hashToken = t => crypto.createHash('sha256').update(t).digest('hex');

async function createAuthToken(userId, type) {
  const token = crypto.randomBytes(32).toString('hex');
  // Pro User & Typ nur ein gültiges Token (Resend/erneuter Reset entwertet alte Links)
  await dbRun('DELETE FROM auth_tokens WHERE user_id = ? AND type = ?', [userId, type]);
  await dbRun(
    'INSERT INTO auth_tokens (user_id, token_hash, type, expires_at) VALUES (?, ?, ?, ?)',
    [userId, _hashToken(token), type, Date.now() + TOKEN_TTL_MS[type]]
  );
  return token;
}

async function consumeAuthToken(token, type) {
  if (!token || typeof token !== 'string' || token.length !== 64) return null;
  const row = await dbGet(
    'SELECT id, user_id FROM auth_tokens WHERE token_hash = ? AND type = ? AND used_at IS NULL AND expires_at > ?',
    [_hashToken(token), type, Date.now()]
  );
  if (!row) return null;
  await dbRun('UPDATE auth_tokens SET used_at = CURRENT_TIMESTAMP WHERE id = ?', [row.id]);
  return row;
}

// ───────────────────────────────────────────────────────────
// Mail-Templates (Text, deutsch)
// ───────────────────────────────────────────────────────────
function sendVerificationMail(email, username, token) {
  return sendMail({
    to: email,
    subject: 'Wachplan-Generator: E-Mail-Adresse bestätigen',
    text:
      `Hallo ${username},\n\n` +
      `bitte bestätige deine E-Mail-Adresse, um deinen Account zu aktivieren:\n\n` +
      `${baseUrl()}/api/auth/verify-email?token=${token}\n\n` +
      `Der Link ist 24 Stunden gültig.\n` +
      `Falls du dich nicht registriert hast, ignoriere diese E-Mail.\n`
  });
}

function sendPasswordResetMail(email, username, token) {
  return sendMail({
    to: email,
    subject: 'Wachplan-Generator: Passwort zurücksetzen',
    text:
      `Hallo ${username},\n\n` +
      `für deinen Account wurde ein Passwort-Reset angefordert. Hier kannst du ein neues Passwort setzen:\n\n` +
      `${baseUrl()}/?reset=${token}\n\n` +
      `Der Link ist 60 Minuten gültig.\n` +
      `Falls du das nicht warst, ignoriere diese E-Mail – dein Passwort bleibt unverändert.\n`
  });
}

// ───────────────────────────────────────────────────────────
// GET /api/auth/me – Check current session
// ───────────────────────────────────────────────────────────
router.get('/me', async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    const user = await dbGet(
      'SELECT id, username, is_admin FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!user) {
      return res.status(401).json({ error: 'User not found' });
    }

    res.json({
      userId: user.id,
      username: user.username,
      isAdmin: user.is_admin === 1
    });
  } catch (error) {
    console.error('Get me error:', error);
    res.status(500).json({ error: 'Database error' });
  }
});

// ───────────────────────────────────────────────────────────
// In-Memory Brute-Force-Schutz: IP-basiert + Account-basiert
// ───────────────────────────────────────────────────────────
const _loginAttempts = new Map();             // ip → { count, first }
const _accountLockouts = new Map();           // username → { count, first }
const LOGIN_MAX = 10, LOGIN_WINDOW_MS = 15 * 60 * 1000;

// Cleanup expired entries to prevent unbounded map growth (DoS mitigation)
function _cleanupExpiredEntries() {
  const now = Date.now();
  for (const [key, entry] of _loginAttempts.entries()) {
    if (now - entry.first > LOGIN_WINDOW_MS) {
      _loginAttempts.delete(key);
    }
  }
  for (const [key, entry] of _accountLockouts.entries()) {
    if (now - entry.first > LOGIN_WINDOW_MS) {
      _accountLockouts.delete(key);
    }
  }
}

const _loginCleanupTimer = setInterval(_cleanupExpiredEntries, LOGIN_WINDOW_MS);
if (typeof _loginCleanupTimer.unref === 'function') _loginCleanupTimer.unref();

function _attemptEntry(ip) {
  const now = Date.now();
  let e = _loginAttempts.get(ip);
  if (!e || now - e.first > LOGIN_WINDOW_MS) { e = { count: 0, first: now }; _loginAttempts.set(ip, e); }
  return e;
}

function _accountLockoutEntry(username) {
  const now = Date.now();
  let e = _accountLockouts.get(username);
  if (!e || now - e.first > LOGIN_WINDOW_MS) { e = { count: 0, first: now }; _accountLockouts.set(username, e); }
  return e;
}

const _isRateLimited = ip => _attemptEntry(ip).count >= LOGIN_MAX;
const _isAccountLocked = username => _accountLockoutEntry(username).count >= LOGIN_MAX;
const _recordFail = (ip, username) => {
  _attemptEntry(ip).count++;
  _accountLockoutEntry(username).count++;
};
const _resetAttempts = (ip, username) => {
  _loginAttempts.delete(ip);
  _accountLockouts.delete(username);
};

// ───────────────────────────────────────────────────────────
// POST /api/auth/login – Authenticate with username/password
// ───────────────────────────────────────────────────────────
router.post('/login', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  const { username, password, rememberMe } = req.body;

  // Periodically clean up expired entries to prevent map unbounded growth
  _cleanupExpiredEntries();

  if (_isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Login-Versuche. Bitte später erneut versuchen.' });
  }

  if (username && _isAccountLocked(username)) {
    return res.status(429).json({ error: 'Zu viele fehlgeschlagene Login-Versuche für dieses Konto. Bitte später erneut versuchen.' });
  }

  try {
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user
    const user = await dbGet(
      'SELECT id, password_hash, is_admin, pending_verification FROM users WHERE username = ?',
      [username]
    );

    // Generische Fehlermeldung (keine User-Enumeration). Fehlversuch zählt.
    if (!user) {
      _recordFail(ip, username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    const validPassword = await bcryptjs.compare(password, user.password_hash);
    if (!validPassword) {
      _recordFail(ip, username);
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    _resetAttempts(ip, username);

    // E-Mail-Verifizierung ausstehend → Login blockieren (Passwort war korrekt,
    // zählt daher nicht als Fehlversuch). code für gezielte Frontend-Behandlung.
    if (user.pending_verification === 1) {
      return res.status(403).json({
        error: 'E-Mail-Adresse noch nicht bestätigt. Bitte Postfach prüfen.',
        code: 'email_unverified'
      });
    }

    // Session-Fixation verhindern: neue Session-ID NACH erfolgreichem Login
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('Session regenerate error:', regenErr);
        return res.status(500).json({ error: 'Failed to start session' });
      }
      req.session.userId = user.id;
      req.session.isAdmin = user.is_admin === 1;

      // Merke-mich: 30 Tage; Standard: 7 Tage (bestehende Konfig)
      if (rememberMe === true) {
        req.session.cookie.maxAge = 30 * 24 * 60 * 60 * 1000; // 30 Tage
      }

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Failed to save session' });
        }

        // Record last login (UTC via CURRENT_TIMESTAMP), fire-and-forget
        dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
          .catch(err => console.error('last_login update failed:', err));

        auditLog(getDb(), user.id, 'login', 'user', user.id, null, ip)
          .catch(err => console.error('Audit log error (login):', err));

        res.json({
          success: true,
          userId: user.id,
          username: username,
          isAdmin: user.is_admin === 1,
          message: 'Login successful'
        });
      });
    });
  } catch (error) {
    console.error('Login error:', error);
    res.status(500).json({ error: 'Login failed' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/logout – Clear session
// ───────────────────────────────────────────────────────────
router.post('/logout', (req, res) => {
  const userId = req.session.userId || null;
  const ip = req.ip || 'unknown';
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
    }
    if (userId) {
      auditLog(getDb(), userId, 'logout', 'user', userId, null, ip)
        .catch(err => console.error('Audit log error (logout):', err));
    }
    res.json({ success: true, message: 'Logged out' });
  });
});

// ───────────────────────────────────────────────────────────
// GET /api/auth/needs-setup – Check if initial setup required
// ───────────────────────────────────────────────────────────
router.get('/needs-setup', async (req, res) => {
  try {
    const adminExists = await dbGet('SELECT COUNT(*) as count FROM users WHERE is_admin = 1');
    res.json({ needsSetup: !adminExists || adminExists.count === 0 });
  } catch (error) {
    res.json({ needsSetup: true });
  }
});

// ───────────────────────────────────────────────────────────
// GET /api/auth/registration-status – Check if registration enabled
// ───────────────────────────────────────────────────────────
router.get('/registration-status', (req, res) => {
  const enabled = REGISTRATION_MODE !== 'disabled';
  const requiresCode = REGISTRATION_MODE === 'code';
  res.json({
    enabled,
    requiresCode,
    emailVerification: enabled && isMailEnabled(),  // E-Mail Pflicht + Account erst nach Bestätigung
    passwordReset: isMailEnabled(),                  // „Passwort vergessen?" anzeigen
    captchaSiteKey: isCaptchaEnabled() ? process.env.RECAPTCHA_SITE_KEY : null
  });
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/init – Create first admin user (one-time)
// ───────────────────────────────────────────────────────────
router.post('/init', express.json(), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
    }

    // Check if any admin exists
    const adminExists = await dbGet(
      'SELECT COUNT(*) as count FROM users WHERE is_admin = 1'
    );

    if (adminExists && adminExists.count > 0) {
      return res.status(403).json({ error: 'Admin user already exists' });
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(password, 10);

    // Create admin user
    await dbRun(
      'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
      [username, passwordHash]
    );

    res.json({ success: true, message: 'Admin user created' });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Init error:', error);
    res.status(500).json({ error: 'Failed to create admin user' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/register – Self-service user registration
// ───────────────────────────────────────────────────────────
router.post('/register', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  const { username, password, password2, email, code, acceptedPrivacy, captchaToken } = req.body;

  // Periodically clean up expired entries
  _cleanupExpiredEntries();

  // Check if registration is enabled
  if (REGISTRATION_MODE === 'disabled') {
    return res.status(403).json({ error: 'Registrierung ist deaktiviert' });
  }

  // Check rate limit
  if (_isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Registrierungsversuche. Bitte später erneut versuchen.' });
  }

  try {
    // Validate inputs
    if (!username || !password) {
      return res.status(400).json({ error: 'Benutzername und Passwort erforderlich' });
    }

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
    }

    // Passwort-Bestätigung serverseitig prüfen (Frontend prüft zusätzlich)
    if (password2 !== undefined && password2 !== password) {
      return res.status(400).json({ error: 'Passwörter stimmen nicht überein' });
    }

    if (acceptedPrivacy !== true) {
      return res.status(400).json({ error: 'Datenschutzhinweis muss akzeptiert werden' });
    }

    // Bot-Schutz: reCAPTCHA v3 (no-op wenn keine Keys konfiguriert)
    const captcha = await verifyCaptcha(captchaToken, ip, 'register');
    if (!captcha.ok) {
      _recordFail(ip, username);
      console.warn(`Registration captcha rejected (${captcha.reason}) from ${ip}`);
      return res.status(400).json({ error: 'Bot-Schutz fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.' });
    }

    // E-Mail: Pflicht sobald Verifizierung aktiv ist (Mail-Versand konfiguriert)
    const requireVerification = isMailEnabled();
    if (requireVerification && !email) {
      return res.status(400).json({ error: 'E-Mail-Adresse erforderlich' });
    }
    if (email && !isValidEmail(email)) {
      return res.status(400).json({ error: 'Ungültige E-Mail-Adresse' });
    }
    if (email) {
      // Eindeutigkeit für Passwort-Reset; generische Antwort (keine Enumeration)
      const existing = await dbGet('SELECT id FROM users WHERE email = ?', [email]);
      if (existing) {
        _recordFail(ip, username);
        return res.status(400).json({ error: 'Registrierung nicht möglich' });
      }
    }

    // Check code-based registration requirement
    if (REGISTRATION_MODE === 'code') {
      if (!code || code !== process.env.REGISTRATION_CODE) {
        _recordFail(ip, username);
        return res.status(403).json({ error: 'Registrierung nicht möglich' });
      }
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(password, 10);

    // Create user (always is_admin=0 for self-registration)
    await dbRun(
      'INSERT INTO users (username, password_hash, email, is_admin, pending_verification) VALUES (?, ?, ?, 0, ?)',
      [username, passwordHash, email || null, requireVerification ? 1 : 0]
    );

    _resetAttempts(ip, username);

    const newUser = await dbGet(
      'SELECT id, is_admin FROM users WHERE username = ?',
      [username]
    );

    if (newUser && requireVerification) {
      // Kein Auto-Login: Account erst nach E-Mail-Bestätigung aktiv
      try {
        const token = await createAuthToken(newUser.id, 'verify_email');
        await sendVerificationMail(email, username, token);
      } catch (mailErr) {
        // Mail nicht zustellbar → User wieder entfernen, sonst hängt der Account
        // unverifizierbar fest (und blockiert Username + E-Mail für Retries)
        console.error('Verification mail failed:', mailErr.message);
        await dbRun('DELETE FROM users WHERE id = ?', [newUser.id]).catch(() => {});
        return res.status(500).json({ error: 'Bestätigungs-E-Mail konnte nicht gesendet werden. Bitte später erneut versuchen.' });
      }
      _audit(newUser.id, 'register', { username, verificationRequired: true }, ip);
      return res.json({
        success: true,
        verificationRequired: true,
        message: 'Bestätigungs-E-Mail gesendet. Bitte Postfach prüfen und Link anklicken.'
      });
    }

    if (newUser) {
      _audit(newUser.id, 'register', { username, verificationRequired: false }, ip);
      req.session.regenerate((regenErr) => {
        if (regenErr) {
          console.error('Session regenerate error:', regenErr);
          return res.status(500).json({ error: 'Session initialization failed' });
        }

        req.session.userId = newUser.id;
        req.session.isAdmin = newUser.is_admin === 1;

        req.session.save((saveErr) => {
          if (saveErr) {
            console.error('Session save error:', saveErr);
            return res.status(500).json({ error: 'Session save failed' });
          }

          res.json({
            success: true,
            userId: newUser.id,
            username: username,
            isAdmin: false,
            message: 'Registrierung erfolgreich'
          });
        });
      });
    } else {
      res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
    }
  } catch (error) {
    // Non-enumerable error message for UNIQUE constraint (username already exists)
    if (error.message.includes('UNIQUE constraint failed')) {
      _recordFail(ip, username);
      return res.status(400).json({ error: 'Registrierung nicht möglich' });
    }
    console.error('Registration error:', error);
    _recordFail(ip, username);
    res.status(500).json({ error: 'Registrierung fehlgeschlagen' });
  }
});

// ───────────────────────────────────────────────────────────
// GET /api/auth/verify-email?token=… – Link aus der Bestätigungsmail.
// Redirect zur SPA: /?verified=1 (Erfolg) bzw. /?verified=0 (ungültig/abgelaufen).
// ───────────────────────────────────────────────────────────
router.get('/verify-email', async (req, res) => {
  try {
    const row = await consumeAuthToken(String(req.query.token || ''), 'verify_email');
    if (!row) return res.redirect('/?verified=0');

    await dbRun(
      'UPDATE users SET pending_verification = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [row.user_id]
    );
    _audit(row.user_id, 'email_verify', null, req.ip);
    res.redirect('/?verified=1');
  } catch (error) {
    console.error('Verify email error:', error);
    res.redirect('/?verified=0');
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/resend-verification – Bestätigungsmail erneut senden.
// Antwort immer generisch (keine Account-Enumeration).
// ───────────────────────────────────────────────────────────
router.post('/resend-verification', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  _cleanupExpiredEntries();
  if (_isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }
  _attemptEntry(ip).count++; // jede Anfrage drosseln (Mail-Versand ist teuer/missbrauchbar)

  const generic = { success: true, message: 'Falls ein unbestätigter Account existiert, wurde eine neue Bestätigungs-E-Mail gesendet.' };
  if (!isMailEnabled()) return res.json(generic);

  try {
    const { username, email } = req.body;
    const user = username
      ? await dbGet('SELECT id, username, email FROM users WHERE username = ? AND pending_verification = 1', [username])
      : (isValidEmail(email)
          ? await dbGet('SELECT id, username, email FROM users WHERE email = ? AND pending_verification = 1', [email])
          : null);

    if (user && user.email) {
      const token = await createAuthToken(user.id, 'verify_email');
      await sendVerificationMail(user.email, user.username, token);
    }
    res.json(generic);
  } catch (error) {
    console.error('Resend verification error:', error);
    res.json(generic);
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/request-password-reset – Reset-Link per Mail anfordern.
// Antwort immer generisch (keine Account-Enumeration), Link 60 min gültig.
// ───────────────────────────────────────────────────────────
router.post('/request-password-reset', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  _cleanupExpiredEntries();

  if (!isMailEnabled()) {
    return res.status(503).json({ error: 'Passwort-Reset ist nicht verfügbar (kein E-Mail-Versand konfiguriert).' });
  }
  if (_isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }
  _attemptEntry(ip).count++; // jede Anfrage drosseln

  try {
    const { email, captchaToken } = req.body;

    const captcha = await verifyCaptcha(captchaToken, ip, 'password_reset');
    if (!captcha.ok) {
      console.warn(`Password reset captcha rejected (${captcha.reason}) from ${ip}`);
      return res.status(400).json({ error: 'Bot-Schutz fehlgeschlagen. Bitte Seite neu laden und erneut versuchen.' });
    }

    if (!isValidEmail(email)) {
      return res.status(400).json({ error: 'Gültige E-Mail-Adresse erforderlich' });
    }

    // E-Mail war historisch nicht unique → ggf. mehrere Accounts bedienen
    const users = await dbAll('SELECT id, username FROM users WHERE email = ?', [email]);
    for (const user of users) {
      try {
        const token = await createAuthToken(user.id, 'password_reset');
        await sendPasswordResetMail(email, user.username, token);
        _audit(user.id, 'password_reset_request', null, ip);
      } catch (mailErr) {
        console.error('Password reset mail failed:', mailErr.message);
      }
    }

    res.json({ success: true, message: 'Falls ein Account mit dieser E-Mail existiert, wurde ein Reset-Link gesendet.' });
  } catch (error) {
    console.error('Request password reset error:', error);
    res.status(500).json({ error: 'Anfrage fehlgeschlagen' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/auth/reset-password – Neues Passwort via Reset-Token setzen.
// Invalidiert alle bestehenden Sessions des Users.
// ───────────────────────────────────────────────────────────
router.post('/reset-password', express.json(), async (req, res) => {
  const ip = req.ip || 'unknown';
  _cleanupExpiredEntries();
  if (_isRateLimited(ip)) {
    return res.status(429).json({ error: 'Zu viele Anfragen. Bitte später erneut versuchen.' });
  }

  try {
    const { token, password, password2 } = req.body;

    if (!password || password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Passwort muss mindestens ${MIN_PASSWORD_LENGTH} Zeichen haben` });
    }
    if (password2 !== undefined && password2 !== password) {
      return res.status(400).json({ error: 'Passwörter stimmen nicht überein' });
    }

    const row = await consumeAuthToken(token, 'password_reset');
    if (!row) {
      _attemptEntry(ip).count++; // ungültige Tokens drosseln
      return res.status(400).json({ error: 'Link ungültig oder abgelaufen. Bitte neuen Reset-Link anfordern.' });
    }

    // Sessions VOR dem Passwort-Update invalidieren: schlägt die Invalidierung
    // trotz Retry-Backoff (in destroyUserSessions) endgültig fehl, bleibt das
    // Passwort unverändert und der äußere catch gibt 500 zurück – kein falsches
    // „success" bei unvollständigem Reset.
    await destroyUserSessions(row.user_id);

    const newHash = await bcryptjs.hash(password, 10);
    // pending_verification=0: erfolgreicher Reset beweist E-Mail-Besitz
    await dbRun(
      'UPDATE users SET password_hash = ?, pending_verification = 0, updated_at = CURRENT_TIMESTAMP WHERE id = ?',
      [newHash, row.user_id]
    );

    _audit(row.user_id, 'password_reset', null, ip);
    res.json({ success: true, message: 'Passwort geändert. Bitte mit dem neuen Passwort anmelden.' });
  } catch (error) {
    console.error('Reset password error:', error);
    res.status(500).json({ error: 'Passwort-Reset fehlgeschlagen' });
  }
});

// ───────────────────────────────────────────────────────────
// PUT /api/auth/password – Change own password (authenticated)
// ───────────────────────────────────────────────────────────
router.put('/password', express.json(), async (req, res) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  const { currentPassword, newPassword } = req.body;
  if (!currentPassword || !newPassword) {
    return res.status(400).json({ error: 'Current and new password required' });
  }
  if (newPassword.length < MIN_PASSWORD_LENGTH) {
    return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
  }

  try {
    const user = await dbGet('SELECT password_hash FROM users WHERE id = ?', [req.session.userId]);
    if (!user) return res.status(404).json({ error: 'User not found' });

    const valid = await bcryptjs.compare(currentPassword, user.password_hash);
    if (!valid) return res.status(401).json({ error: 'Current password incorrect' });

    const newHash = await bcryptjs.hash(newPassword, 10);
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [newHash, req.session.userId]);

    res.json({ success: true, message: 'Password changed' });
  } catch (error) {
    console.error('Change password error:', error);
    res.status(500).json({ error: 'Failed to change password' });
  }
});

module.exports = router;
