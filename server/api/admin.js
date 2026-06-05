// ============================================================
// Admin API Routes
// GET /api/admin/users – Alle User auflisten (Admin only)
// POST /api/admin/users – Neuen User erstellen (Admin only)
// DELETE /api/admin/users/:id – User löschen (Admin only)
// ============================================================

const express = require('express');
const router = express.Router();
const path = require('path');
const fs = require('fs');
const bcryptjs = require('bcryptjs');
const { dbRun, dbGet, dbAll } = require('../db/connection');

// ───────────────────────────────────────────────────────────
// Admin-only Middleware
// ───────────────────────────────────────────────────────────
const adminMiddleware = async (req, res, next) => {
  // Check if authenticated
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }

  try {
    // Check if user is admin
    const user = await dbGet(
      'SELECT is_admin FROM users WHERE id = ?',
      [req.session.userId]
    );

    if (!user || !user.is_admin) {
      return res.status(403).json({ error: 'Admin access required' });
    }

    next();
  } catch (error) {
    console.error('Admin middleware error:', error);
    res.status(500).json({ error: 'Authorization failed' });
  }
};

router.use(adminMiddleware);

// ───────────────────────────────────────────────────────────
// GET /api/admin/users – Alle User auflisten
// ───────────────────────────────────────────────────────────
router.get('/users', async (req, res) => {
  try {
    const users = await dbAll(
      'SELECT id, username, email, is_admin, last_login, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        isAdmin: u.is_admin === 1,
        lastLogin: u.last_login,
        createdAt: u.created_at
      }))
    });
  } catch (error) {
    console.error('Get users error:', error);
    res.status(500).json({ error: 'Failed to fetch users' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/admin/users – Neuen User erstellen
// ───────────────────────────────────────────────────────────
router.post('/users', express.json(), async (req, res) => {
  try {
    const { username, password, email, isAdmin } = req.body;

    // Validate input
    if (!username || !password) {
      return res.status(400).json({ error: 'Username and password required' });
    }

    if (username.length < 3) {
      return res.status(400).json({ error: 'Username must be at least 3 characters' });
    }

    if (password.length < 8) {
      return res.status(400).json({ error: 'Password must be at least 8 characters' });
    }

    // Hash password
    const passwordHash = await bcryptjs.hash(password, 10);

    // Create user
    const result = await dbRun(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      [username, passwordHash, email || null, isAdmin ? 1 : 0]
    );

    res.status(201).json({
      id: result.lastID,
      username: username,
      email: email || null,
      isAdmin: !!isAdmin,
      message: 'User created successfully'
    });
  } catch (error) {
    if (error.message.includes('UNIQUE constraint failed')) {
      return res.status(400).json({ error: 'Username already exists' });
    }
    console.error('Create user error:', error);
    res.status(500).json({ error: 'Failed to create user' });
  }
});

// ───────────────────────────────────────────────────────────
// DELETE /api/admin/users/:id – User löschen (GDPR Art. 17)
// Cascading: plans, plan_shares, sessions
// ───────────────────────────────────────────────────────────
router.delete('/users/:id', async (req, res) => {
  try {
    const userId = parseInt(req.params.id);

    // Prevent deleting yourself
    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Delete in cascading order (GDPR Art. 17 – Recht auf Löschung)
    // Foreign keys are enabled in connection.js, but explicit cleanup ensures completeness
    await dbRun('DELETE FROM sessions WHERE json_extract(session, "$.userId") = ?', [userId]);
    // plan_shares cascade via foreign key
    // plans cascade via foreign key (will trigger plan_shares cascade)
    await dbRun('DELETE FROM plans WHERE user_id = ?', [userId]);
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
  }
});

// ───────────────────────────────────────────────────────────
// PUT /api/admin/users/:id/password – Passwort eines Users setzen
// (Admin braucht das aktuelle Passwort NICHT)
// ───────────────────────────────────────────────────────────
router.put('/users/:id/password', express.json(), async (req, res) => {
  try {
    const userId = parseInt(req.params.id);
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < 8) {
      return res.status(400).json({ error: 'New password must be at least 8 characters' });
    }

    const user = await dbGet('SELECT id FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    const passwordHash = await bcryptjs.hash(newPassword, 10);
    await dbRun('UPDATE users SET password_hash = ? WHERE id = ?', [passwordHash, userId]);

    res.json({ success: true, message: 'Password updated' });
  } catch (error) {
    console.error('Admin set password error:', error);
    res.status(500).json({ error: 'Failed to update password' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/admin/reload-config – Reload configuration file
// ───────────────────────────────────────────────────────────
router.post('/reload-config', express.json(), async (req, res) => {
  try {
    const configPath = path.join(__dirname, '..', 'config.json');

    // Try to read and parse config
    const configRaw = fs.readFileSync(configPath, 'utf-8');
    const config = JSON.parse(configRaw);

    // Validate basic structure
    if (!config.template || !config.template.towers || !config.template.boats) {
      return res.status(400).json({ error: 'Invalid config structure' });
    }

    res.json({
      message: 'Configuration reloaded successfully',
      config: {
        towers: config.template.towers.length,
        boats: config.template.boats.length,
        exportColumns: config.template.exportColumns.length
      }
    });
  } catch (error) {
    if (error instanceof SyntaxError) {
      return res.status(400).json({ error: 'Invalid JSON in config.json: ' + error.message });
    }
    console.error('Reload config error:', error);
    res.status(500).json({ error: 'Failed to reload configuration' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/admin/purge-orphans – Security net: remove orphaned data
// Cleans up: plans without user, plan_shares without plan/user
// ───────────────────────────────────────────────────────────
router.post('/purge-orphans', express.json(), async (req, res) => {
  try {
    // Delete plan_shares where plan doesn't exist
    const orphanShares = await dbRun(
      'DELETE FROM plan_shares WHERE plan_id NOT IN (SELECT id FROM plans)'
    );

    // Delete plan_shares where user doesn't exist
    const orphanSharesUser = await dbRun(
      'DELETE FROM plan_shares WHERE user_id NOT IN (SELECT id FROM users)'
    );

    // Delete plans where user doesn't exist
    const orphanPlans = await dbRun(
      'DELETE FROM plans WHERE user_id NOT IN (SELECT id FROM users)'
    );

    res.json({
      message: 'Orphan data purged successfully',
      removed: {
        plansWithoutUser: orphanPlans.changes || 0,
        sharesWithoutPlan: orphanShares.changes || 0,
        sharesWithoutUser: orphanSharesUser.changes || 0
      }
    });
  } catch (error) {
    console.error('Orphan purge error:', error);
    res.status(500).json({ error: 'Failed to purge orphans' });
  }
});

module.exports = router;
