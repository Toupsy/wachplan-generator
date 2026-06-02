// ============================================================
// Plans API Routes
// GET /api/plans – Alle Pläne des Users
// POST /api/plans – Neuen Plan erstellen
// GET /api/plans/:id – Plan laden (dekryptiert)
// PUT /api/plans/:id – Plan speichern (verschlüsselt)
// DELETE /api/plans/:id – Plan löschen
// ============================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { dbRun, dbGet, dbAll } = require('../db/connection');

// ───────────────────────────────────────────────────────────
// Authentication Middleware
// ───────────────────────────────────────────────────────────
const authMiddleware = (req, res, next) => {
  if (!req.session.userId) {
    return res.status(401).json({ error: 'Not authenticated' });
  }
  next();
};

router.use(authMiddleware);

// ───────────────────────────────────────────────────────────
// Encryption Helpers
// ───────────────────────────────────────────────────────────
function deriveKey(userId) {
  return crypto.pbkdf2Sync(
    userId + process.env.MASTER_SECRET,
    process.env.SALT,
    100000,
    32,
    'sha256'
  );
}

function encryptPlanState(plainJSON, userId) {
  const key = deriveKey(userId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainJSON, 'utf8'),
    cipher.final()
  ]);

  return {
    encrypted,
    iv,
    authTag: cipher.getAuthTag()
  };
}

function decryptPlanState(encrypted, iv, authTag, userId) {
  const key = deriveKey(userId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

// ───────────────────────────────────────────────────────────
// GET /api/plans – Alle Pläne des Users auflisten
// ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    const plans = await dbAll(
      'SELECT id, name, created_at, updated_at FROM plans WHERE user_id = ? ORDER BY updated_at DESC',
      [req.session.userId]
    );

    res.json({
      plans: plans.map(p => ({
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        updated_at: p.updated_at
      }))
    });
  } catch (error) {
    console.error('Get plans error:', error);
    res.status(500).json({ error: 'Failed to fetch plans' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/plans – Neuen Plan erstellen
// ───────────────────────────────────────────────────────────
router.post('/', express.json(), async (req, res) => {
  try {
    const { name = 'Wachplan', state } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State data required' });
    }

    // Encrypt state
    const plainJSON = JSON.stringify(state);
    const { encrypted, iv, authTag } = encryptPlanState(plainJSON, req.session.userId);

    // Insert into database
    const result = await dbRun(
      `INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag)
       VALUES (?, ?, ?, ?, ?)`,
      [req.session.userId, name, encrypted, iv, authTag]
    );

    res.status(201).json({
      id: result.lastID,
      name: name,
      message: 'Plan created'
    });
  } catch (error) {
    console.error('Create plan error:', error);
    res.status(500).json({ error: 'Failed to create plan' });
  }
});

// ───────────────────────────────────────────────────────────
// GET /api/plans/:id – Plan laden (dekryptiert)
// ───────────────────────────────────────────────────────────
router.get('/:id', async (req, res) => {
  try {
    const planId = parseInt(req.params.id);

    const plan = await dbGet(
      'SELECT encrypted_state, iv, auth_tag, name FROM plans WHERE id = ? AND user_id = ?',
      [planId, req.session.userId]
    );

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Decrypt state
    const plainJSON = decryptPlanState(
      plan.encrypted_state,
      plan.iv,
      plan.auth_tag,
      req.session.userId
    );

    res.json({
      id: planId,
      name: plan.name,
      state: plainJSON  // Return as string; client will JSON.parse if needed
    });
  } catch (error) {
    console.error('Get plan error:', error);
    if (error.message.includes('Unsupported state or unable to authenticate data')) {
      return res.status(400).json({ error: 'Decryption failed - invalid data or wrong key' });
    }
    res.status(500).json({ error: 'Failed to load plan' });
  }
});

// ───────────────────────────────────────────────────────────
// PUT /api/plans/:id – Plan speichern (verschlüsselt)
// ───────────────────────────────────────────────────────────
router.put('/:id', express.json(), async (req, res) => {
  try {
    const planId = parseInt(req.params.id);
    const { state, name } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State data required' });
    }

    // Verify plan belongs to user
    const plan = await dbGet(
      'SELECT id FROM plans WHERE id = ? AND user_id = ?',
      [planId, req.session.userId]
    );

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Encrypt state
    const plainJSON = JSON.stringify(state);
    const { encrypted, iv, authTag } = encryptPlanState(plainJSON, req.session.userId);

    // Update in database
    await dbRun(
      `UPDATE plans
       SET encrypted_state = ?, iv = ?, auth_tag = ?, updated_at = CURRENT_TIMESTAMP
       ${name ? ', name = ?' : ''}
       WHERE id = ?`,
      name
        ? [encrypted, iv, authTag, name, planId]
        : [encrypted, iv, authTag, planId]
    );

    res.json({
      id: planId,
      message: 'Plan saved'
    });
  } catch (error) {
    console.error('Save plan error:', error);
    res.status(500).json({ error: 'Failed to save plan' });
  }
});

// ───────────────────────────────────────────────────────────
// DELETE /api/plans/:id – Plan löschen
// ───────────────────────────────────────────────────────────
router.delete('/:id', async (req, res) => {
  try {
    const planId = parseInt(req.params.id);

    // Verify plan belongs to user
    const plan = await dbGet(
      'SELECT id FROM plans WHERE id = ? AND user_id = ?',
      [planId, req.session.userId]
    );

    if (!plan) {
      return res.status(404).json({ error: 'Plan not found' });
    }

    // Delete plan
    await dbRun(
      'DELETE FROM plans WHERE id = ?',
      [planId]
    );

    res.json({ message: 'Plan deleted' });
  } catch (error) {
    console.error('Delete plan error:', error);
    res.status(500).json({ error: 'Failed to delete plan' });
  }
});

module.exports = router;
