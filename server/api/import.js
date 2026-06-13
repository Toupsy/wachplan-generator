// ============================================================
// Import API Routes
// POST /api/import/plans – Alte JSON-Pläne importieren
// ============================================================

const express = require('express');
const router = express.Router();
const { getDb, dbRun } = require('../db/connection');
const { encryptPlanState } = require('../db/crypto');
const { validatePlanInput } = require('./plans');
const { auditLog } = require('../db/init');

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
      // Anzeigename für Fehlermeldungen: immer String, gekürzt (plan.name kann beliebiger Typ sein)
      const label = String(plan && plan.name != null ? plan.name : 'Unbenannt').slice(0, 80);
      try {
        if (!plan.state) {
          errors.push(`Plan "${label}" hat keine state data`);
          continue;
        }

        const name = typeof plan.name === 'string' && plan.name.trim() !== ''
          ? plan.name : 'Importierter Plan';

        // Gleiche Limits wie POST/PUT /api/plans (#218/#270): Name ≤ 200, State ≤ 1 MB
        const plainJSON = JSON.stringify(plan.state);
        const invalid = validatePlanInput(name, plainJSON, { nameRequired: true });
        if (invalid) {
          errors.push(`Plan "${label}": ${invalid.error}`);
          continue;
        }

        // Encrypt state
        const { encrypted, iv, authTag } = encryptPlanState(plainJSON, req.session.userId);

        // Insert into database
        await dbRun(
          `INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag)
           VALUES (?, ?, ?, ?, ?)`,
          [req.session.userId, name, encrypted, iv, authTag]
        );

        importedCount++;
      } catch (planError) {
        // Interne Details (Crypto/DB) nicht an den Client leaken
        console.error(`Import plan error ("${label}"):`, planError);
        errors.push(`Plan "${label}": Import fehlgeschlagen`);
      }
    }

    if (importedCount > 0) {
      auditLog(getDb(), req.session.userId, 'plan_import', 'plan', null, { imported: importedCount, total: plans.length }, req.ip)
        .catch(err => console.error('Audit log error (plan_import):', err));
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
