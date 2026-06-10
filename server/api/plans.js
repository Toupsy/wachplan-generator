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
const { dbRun, dbGet, dbAll } = require('../db/connection');
const { encryptPlanState, decryptPlanState } = require('../db/crypto');
const { getPlanAccess } = require('../db/access');
const { broadcastPlanUpdate } = require('../realtime');

// ───────────────────────────────────────────────────────────
// ID Parsing Helpers
// ───────────────────────────────────────────────────────────
function parsePlanId(paramStr) {
  const id = parseInt(paramStr, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

function parseUserId(paramStr) {
  const id = parseInt(paramStr, 10);
  return Number.isInteger(id) && id > 0 ? id : null;
}

// ───────────────────────────────────────────────────────────
// Eingabe-Limits (Schutz vor Storage-Exhaustion, Issue #218)
// ───────────────────────────────────────────────────────────
const MAX_NAME_LEN    = 200;               // analog zum Frontend-labels-Limit (Feature 19)
const MAX_STATE_BYTES = 1024 * 1024;       // 1 MB pro serialisiertem State (real << 100 KB)

/** Validiert name (optional) + serialisierte State-Größe.
 * @returns {{status:number, error:string}|null} Fehler-Objekt oder null wenn ok. */
function validatePlanInput(name, plainJSON, { nameRequired = false } = {}) {
  if (nameRequired || name !== undefined) {
    if (typeof name !== 'string' || name.length > MAX_NAME_LEN) {
      return { status: 400, error: `Ungültiger oder zu langer Name (max. ${MAX_NAME_LEN} Zeichen)` };
    }
  }
  if (Buffer.byteLength(plainJSON, 'utf8') > MAX_STATE_BYTES) {
    return { status: 413, error: 'Plan zu groß' };
  }
  return null;
}

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

// Verschlüsselung: siehe db/crypto.js (zentral, mit Key-Caching).
// WICHTIG: Ent-/Verschlüsselt wird IMMER mit dem Key des PLAN-OWNERS (plans.user_id),
// nicht dem des Anfragenden. So können Mitbearbeiter denselben Plan lesen/schreiben,
// ohne dass neu verschlüsselt werden muss. Zugriff wird über plan_shares gegated.
// getPlanAccess() liegt zentral in db/access.js (auch von realtime.js genutzt).

// ───────────────────────────────────────────────────────────
// GET /api/plans – Alle Pläne des Users auflisten
// ───────────────────────────────────────────────────────────
router.get('/', async (req, res) => {
  try {
    // Eigene Pläne + Pläne, die mit dem User geteilt wurden (mit Owner-Name).
    const plans = await dbAll(
      `SELECT p.id, p.name, p.user_id, p.created_at, p.updated_at, u.username AS owner_name
         FROM plans p
         JOIN users u ON u.id = p.user_id
         LEFT JOIN plan_shares s ON s.plan_id = p.id AND s.user_id = ?
        WHERE p.user_id = ? OR s.user_id IS NOT NULL
        ORDER BY p.updated_at DESC`,
      [req.session.userId, req.session.userId]
    );

    res.json({
      plans: plans.map(p => ({
        id: p.id,
        name: p.name,
        created_at: p.created_at,
        updated_at: p.updated_at,
        isOwner: p.user_id === req.session.userId,
        ownerName: p.owner_name
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
    const invalid = validatePlanInput(name, plainJSON, { nameRequired: true });
    if (invalid) return res.status(invalid.status).json({ error: invalid.error });

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
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access === false) return res.status(403).json({ error: 'No access to this plan' });

    const plan = await dbGet(
      'SELECT encrypted_state, iv, auth_tag, name FROM plans WHERE id = ?',
      [planId]
    );
    if (!plan) return res.status(404).json({ error: 'Plan not found' });

    // Entschlüsseln mit dem OWNER-Key (access.ownerId), nicht dem Anfragenden
    const plainJSON = decryptPlanState(
      plan.encrypted_state,
      plan.iv,
      plan.auth_tag,
      access.ownerId
    );

    res.json({
      id: planId,
      name: plan.name,
      state: plainJSON,  // Return as string; client will JSON.parse it
      role: access.role,
      canEdit: !(access.role === 'collaborator' && access.shareRole === 'view')
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
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const { state, name } = req.body;

    if (!state) {
      return res.status(400).json({ error: 'State data required' });
    }

    // Zugriff prüfen (Owner oder Mitbearbeiter)
    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access === false) return res.status(403).json({ error: 'No access to this plan' });
    // Nur-Lese-Mitbearbeiter dürfen nicht schreiben
    if (access.role === 'collaborator' && access.shareRole === 'view') {
      return res.status(403).json({ error: 'Nur-Lese-Zugriff – Speichern nicht erlaubt' });
    }

    // Verschlüsseln mit dem OWNER-Key (damit alle Berechtigten lesen können)
    const plainJSON = JSON.stringify(state);
    const invalid = validatePlanInput(name, plainJSON);
    if (invalid) return res.status(invalid.status).json({ error: invalid.error });

    const { encrypted, iv, authTag } = encryptPlanState(plainJSON, access.ownerId);

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

    // Live-Update: andere verbundene Mitbearbeiter dieses Plans benachrichtigen
    // (außer dem Speichernden selbst).
    broadcastPlanUpdate(planId, req.session.userId);

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
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

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

// ───────────────────────────────────────────────────────────
// GET /api/plans/:id/shares – Mitbearbeiter auflisten (Owner oder Mitbearbeiter)
// ───────────────────────────────────────────────────────────
router.get('/:id/shares', async (req, res) => {
  try {
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access === false) return res.status(403).json({ error: 'No access to this plan' });

    const owner = await dbGet('SELECT username FROM users WHERE id = ?', [access.ownerId]);
    const collaborators = await dbAll(
      `SELECT u.id AS userId, u.username, s.role
         FROM plan_shares s JOIN users u ON u.id = s.user_id
        WHERE s.plan_id = ? ORDER BY u.username`,
      [planId]
    );

    res.json({
      ownerId: access.ownerId,
      ownerName: owner ? owner.username : '?',
      isOwner: access.role === 'owner',
      collaborators
    });
  } catch (error) {
    console.error('List shares error:', error);
    res.status(500).json({ error: 'Failed to list collaborators' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/plans/:id/share – { username } → Mitbearbeiter hinzufügen (nur Owner)
// ───────────────────────────────────────────────────────────
router.post('/:id/share', express.json(), async (req, res) => {
  try {
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const username = (req.body.username || '').trim();
    const role = req.body.role === 'view' ? 'view' : 'edit';
    if (!username) return res.status(400).json({ error: 'Username required' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access.role !== 'owner') return res.status(403).json({ error: 'Only the owner can share this plan' });

    const target = await dbGet('SELECT id FROM users WHERE username = ?', [username]);
    if (!target) return res.status(404).json({ error: 'Benutzer nicht gefunden' });
    if (target.id === access.ownerId) return res.status(400).json({ error: 'Das ist der Eigentümer' });

    // INSERT or UPDATE (Rolle ändern, falls bereits geteilt)
    await dbRun(
      `INSERT INTO plan_shares (plan_id, user_id, role) VALUES (?, ?, ?)
       ON CONFLICT(plan_id, user_id) DO UPDATE SET role = excluded.role`,
      [planId, target.id, role]
    );
    res.status(201).json({ success: true, userId: target.id, username, role, message: 'Geteilt' });
  } catch (error) {
    console.error('Share plan error:', error);
    res.status(500).json({ error: 'Failed to share plan' });
  }
});

// ───────────────────────────────────────────────────────────
// DELETE /api/plans/:id/share/:userId – Mitbearbeiter entfernen (nur Owner)
// ───────────────────────────────────────────────────────────
router.delete('/:id/share/:userId', async (req, res) => {
  try {
    const planId = parsePlanId(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const userId = parseUserId(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Ungültige Benutzer-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access.role !== 'owner') return res.status(403).json({ error: 'Only the owner can manage sharing' });

    await dbRun('DELETE FROM plan_shares WHERE plan_id = ? AND user_id = ?', [planId, userId]);
    res.json({ success: true, message: 'Mitbearbeiter entfernt' });
  } catch (error) {
    console.error('Unshare plan error:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

module.exports = router;
