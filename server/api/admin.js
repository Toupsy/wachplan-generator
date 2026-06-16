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
const { parsePositiveInt } = require('../db/ids');

// ───────────────────────────────────────────────────────────
// Security Constants
// ───────────────────────────────────────────────────────────
const MIN_PASSWORD_LENGTH = 10;

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

    if (password.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `Password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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
    const userId = parsePositiveInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Ungültige Benutzer-ID' });

    // Prevent deleting yourself
    if (userId === req.session.userId) {
      return res.status(400).json({ error: 'Cannot delete your own account' });
    }

    // Check if user exists
    const user = await dbGet('SELECT id, is_admin FROM users WHERE id = ?', [userId]);
    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Prevent deleting the last remaining admin (Issue #216)
    if (user.is_admin) {
      const { c } = await dbGet('SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');
      if (c <= 1) {
        return res.status(400).json({ error: 'Der letzte Administrator kann nicht gelöscht werden' });
      }
    }

    // Delete in cascading order (GDPR Art. 17 – Recht auf Löschung)
    // Foreign keys are enabled in connection.js for plans/plan_shares cascade
    // connect-sqlite3 sessions: check sess column (serialized JSON) for userId
    await dbRun("DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?", [userId]);
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
    const userId = parsePositiveInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Ungültige Benutzer-ID' });
    const { newPassword } = req.body;

    if (!newPassword || newPassword.length < MIN_PASSWORD_LENGTH) {
      return res.status(400).json({ error: `New password must be at least ${MIN_PASSWORD_LENGTH} characters` });
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
// GET /api/admin/users/:id/export – DSGVO Art. 15 Datenexport
// ───────────────────────────────────────────────────────────
router.get('/users/:id/export', async (req, res) => {
  try {
    const userId = parsePositiveInt(req.params.id);
    if (!userId) return res.status(400).json({ error: 'Ungültige Benutzer-ID' });

    // Fetch user data (exclude password_hash)
    const user = await dbGet(
      'SELECT id, username, email, is_admin, last_login, created_at FROM users WHERE id = ?',
      [userId]
    );

    if (!user) {
      return res.status(404).json({ error: 'User not found' });
    }

    // Fetch user's own plans (metadata only, no encrypted content)
    const ownPlans = await dbAll(
      'SELECT id, name, created_at, updated_at FROM plans WHERE user_id = ? ORDER BY created_at DESC',
      [userId]
    );

    // Fetch shared plans: plans owned by other users but shared with this user
    const sharedWithUser = await dbAll(
      `SELECT p.id, p.name, u.username as owner_username, ps.role, p.created_at, p.updated_at
       FROM plan_shares ps
       JOIN plans p ON ps.plan_id = p.id
       JOIN users u ON p.user_id = u.id
       WHERE ps.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    // Fetch plans shared by this user to others
    const sharedByUser = await dbAll(
      `SELECT p.id, p.name, u.username as shared_with_username, ps.role, p.created_at, p.updated_at
       FROM plan_shares ps
       JOIN plans p ON ps.plan_id = p.id
       JOIN users u ON ps.user_id = u.id
       WHERE p.user_id = ?
       ORDER BY p.created_at DESC`,
      [userId]
    );

    // Build export object
    const exportData = {
      exportDate: new Date().toISOString(),
      userData: {
        id: user.id,
        username: user.username,
        email: user.email || null,
        isAdmin: user.is_admin === 1,
        lastLogin: user.last_login || null,
        createdAt: user.created_at
      },
      ownPlans: ownPlans.map(p => ({
        id: p.id,
        name: p.name,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      })),
      sharedWithMe: sharedWithUser.map(p => ({
        id: p.id,
        name: p.name,
        ownerUsername: p.owner_username,
        role: p.role,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      })),
      sharedByMe: sharedByUser.map(p => ({
        id: p.id,
        name: p.name,
        sharedWithUsername: p.shared_with_username,
        role: p.role,
        createdAt: p.created_at,
        updatedAt: p.updated_at
      }))
    };

    // Send as JSON download
    const filename = `wachplan-userdaten-${user.username}.json`;
    res.setHeader('Content-Type', 'application/json; charset=utf-8');
    res.setHeader('Content-Disposition', `attachment; filename="${filename}"`);
    res.json(exportData);
  } catch (error) {
    console.error('Export user data error:', error);
    res.status(500).json({ error: 'Failed to export user data' });
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
// GET /api/admin/audit-log – Audit-Log-Einträge auflisten
// Query-Parameter: action, user_id, limit (default 100), offset (default 0)
// ───────────────────────────────────────────────────────────
router.get('/audit-log', async (req, res) => {
  try {
    const { action, user_id, limit = 100, offset = 0 } = req.query;

    // Validate limit (prevent abuse)
    const safeLimit = Math.min(Math.max(1, parseInt(limit) || 100), 500);
    const safeOffset = Math.max(0, parseInt(offset) || 0);

    let query = 'SELECT * FROM audit_log WHERE 1=1';
    const params = [];

    if (action) {
      query += ' AND action = ?';
      params.push(action);
    }

    if (user_id) {
      query += ' AND user_id = ?';
      params.push(parseInt(user_id));
    }

    query += ' ORDER BY timestamp DESC LIMIT ? OFFSET ?';
    params.push(safeLimit, safeOffset);

    const logs = await dbAll(query, params);

    // Parse JSON details field. Ein einzelner korrupter Datensatz darf nicht
    // den ganzen Audit-Log-Endpoint (Compliance-Ansicht) mit einem 500 kippen.
    const formattedLogs = logs.map(log => {
      let details = null;
      if (log.details) {
        try {
          details = JSON.parse(log.details);
        } catch (e) {
          console.error('Audit log: ungültiges JSON in Datensatz', log.id, e.message);
          details = { _parseError: true, raw: log.details };
        }
      }
      return { ...log, details };
    });

    res.json({ logs: formattedLogs });
  } catch (error) {
    console.error('Audit log fetch error:', error);
    res.status(500).json({ error: 'Failed to fetch audit log' });
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
