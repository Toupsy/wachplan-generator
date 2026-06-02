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
// POST /api/auth/login – Authenticate with username/password
// ───────────────────────────────────────────────────────────
router.post('/login', express.json(), async (req, res) => {
  try {
    const { username, password } = req.body;

    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    // Find user
    const user = await dbGet(
      'SELECT id, password_hash, is_admin FROM users WHERE username = ?',
      [username]
    );

    if (!user) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Compare password
    const validPassword = await bcryptjs.compare(password, user.password_hash);
    if (!validPassword) {
      return res.status(401).json({ error: 'Invalid credentials' });
    }

    // Create session
    req.session.userId = user.id;
    req.session.isAdmin = user.is_admin === 1;

    res.json({
      success: true,
      userId: user.id,
      username: username,
      isAdmin: user.is_admin === 1,
      message: 'Login successful'
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
  if (newPassword.length < 8) {
    return res.status(400).json({ error: 'New password must be at least 8 characters' });
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
