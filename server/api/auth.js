// ============================================================
// Authentication API Routes
// POST /api/auth/login
// POST /api/auth/logout
// GET /api/auth/me
// POST /api/auth/init (Initialize first admin user)
// ============================================================

const express = require('express');
const router = express.Router();
const bcryptjs = require('bcryptjs');
const { dbRun, dbGet } = require('../db/connection');

// ───────────────────────────────────────────────────────────
// Security Constants
// ───────────────────────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 10;

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
  const { username, password } = req.body;

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
      'SELECT id, password_hash, is_admin FROM users WHERE username = ?',
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

    // Session-Fixation verhindern: neue Session-ID NACH erfolgreichem Login
    req.session.regenerate((regenErr) => {
      if (regenErr) {
        console.error('Session regenerate error:', regenErr);
        return res.status(500).json({ error: 'Failed to start session' });
      }
      req.session.userId = user.id;
      req.session.isAdmin = user.is_admin === 1;

      req.session.save((err) => {
        if (err) {
          console.error('Session save error:', err);
          return res.status(500).json({ error: 'Failed to save session' });
        }

        // Record last login (UTC via CURRENT_TIMESTAMP), fire-and-forget
        dbRun('UPDATE users SET last_login = CURRENT_TIMESTAMP WHERE id = ?', [user.id])
          .catch(err => console.error('last_login update failed:', err));

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
  req.session.destroy((err) => {
    if (err) {
      return res.status(500).json({ error: 'Logout failed' });
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
