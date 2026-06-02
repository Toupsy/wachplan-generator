// ============================================================
// Import API Routes
// POST /api/import/plans – Alte JSON-Pläne importieren
// ============================================================

const express = require('express');
const router = express.Router();
const crypto = require('crypto');
const { dbRun } = require('../db/connection');

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
// Encryption Helpers (same as api/plans.js)
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

// ───────────────────────────────────────────────────────────
// POST /api/import/plans – Alte JSON-Pläne importieren
// ───────────────────────────────────────────────────────────
router.post('/plans', express.json(), async (req, res) => {
  try {
    const { plans } = req.body;

    if (!Array.isArray(plans) || plans.length === 0) {
      return res.status(400).json({ error: 'plans array required and non-empty' });
    }

    let importedCount = 0;
    const errors = [];

    for (const plan of plans) {
      try {
        if (!plan.state) {
          errors.push(`Plan "${plan.name}" hat keine state data`);
          continue;
        }

        // Encrypt state
        const plainJSON = JSON.stringify(plan.state);
        const { encrypted, iv, authTag } = encryptPlanState(plainJSON, req.session.userId);

        // Insert into database
        await dbRun(
          `INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag)
           VALUES (?, ?, ?, ?, ?)`,
          [req.session.userId, plan.name || 'Importierter Plan', encrypted, iv, authTag]
        );

        importedCount++;
      } catch (planError) {
        errors.push(`Plan "${plan.name}": ${planError.message}`);
      }
    }

    res.json({
      success: true,
      imported: importedCount,
      total: plans.length,
      errors: errors.length > 0 ? errors : undefined,
      message: `${importedCount}/${plans.length} Pläne erfolgreich importiert`
    });
  } catch (error) {
    console.error('Import plans error:', error);
    res.status(500).json({ error: 'Failed to import plans' });
  }
});

module.exports = router;
