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
      'SELECT id, username, email, is_admin, created_at FROM users ORDER BY created_at DESC'
    );

    res.json({
      users: users.map(u => ({
        id: u.id,
        username: u.username,
        email: u.email,
        isAdmin: u.is_admin === 1,
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
// DELETE /api/admin/users/:id – User löschen
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

    // Delete user and their plans (cascade)
    await dbRun('DELETE FROM plans WHERE user_id = ?', [userId]);
    await dbRun('DELETE FROM users WHERE id = ?', [userId]);

    res.json({ message: 'User deleted successfully' });
  } catch (error) {
    console.error('Delete user error:', error);
    res.status(500).json({ error: 'Failed to delete user' });
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

module.exports = router;
