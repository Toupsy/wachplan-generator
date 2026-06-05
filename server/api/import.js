// ============================================================
// Import API Routes
// POST /api/import/plans – Alte JSON-Pläne importieren
// ============================================================

const express = require('express');
const router = express.Router();
const { dbRun } = require('../db/connection');
const { encryptPlanState } = require('../db/crypto');

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

// Verschlüsselung: siehe db/crypto.js (zentral, mit Key-Caching)

// ───────────────────────────────────────────────────────────
// POST /api/import/plans – Alte JSON-Pläne importieren
// ───────────────────────────────────────────────────────────
router.post('/plans', express.json(), async (req, res) => {
  try {
    const { plans } = req.body;

    if (!Array.isArray(plans) || plans.length === 0) {
      return res.status(400).json({ error: 'plans array required and non-empty' });
    }

    const MAX_IMPORT = 100;
    if (plans.length > MAX_IMPORT) {
      return res.status(400).json({ error: `Maximal ${MAX_IMPORT} Pläne pro Import erlaubt` });
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
