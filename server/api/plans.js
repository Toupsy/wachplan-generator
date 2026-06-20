// ============================================================
// Plans API Routes
// GET /api/plans – Alle Pläne des Users
// POST /api/plans – Neuen Plan erstellen
// GET /api/plans/:id – Plan laden (dekryptiert)
// PUT /api/plans/:id – Plan speichern (verschlüsselt)
// DELETE /api/plans/:id – Plan löschen
// ============================================================

const express = require('express');
const crypto = require('crypto');
const router = express.Router();
const { getDb, dbRun, dbGet, dbAll } = require('../db/connection');
const { encryptPlanState, decryptPlanState } = require('../db/crypto');
const { getPlanAccess } = require('../db/access');
const { broadcastPlanUpdate } = require('../realtime');
const { parsePositiveInt } = require('../db/ids');
const { auditLog, auditLogCoalesced } = require('../db/init');

// ───────────────────────────────────────────────────────────
// Öffentliche Beobachter-Links (plan_public_links): unguessbares 256-Bit-Token,
// in der DB nur als SHA-256-Hash. Standard-Lebensdauer 7 Tage. Siehe api/public.js
// für den (auth-freien) Lese-Endpoint.
// ───────────────────────────────────────────────────────────
const PUBLIC_LINK_TTL_MS = 7 * 24 * 60 * 60 * 1000;   // 7 Tage
const hashLinkToken = t => crypto.createHash('sha256').update(t).digest('hex');

// ───────────────────────────────────────────────────────────
// ID Parsing Helpers – zentral über db/ids.js (strikte Validierung:
// '5abc' → null statt 5; verhindert teilgeparste IDs in DB-Queries).
// ───────────────────────────────────────────────────────────

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

    auditLog(getDb(), req.session.userId, 'plan_create', 'plan', result.lastID, { name }, req.ip)
      .catch(err => console.error('Audit log error (plan_create):', err));

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
    const planId = parsePositiveInt(req.params.id);
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
    const planId = parsePositiveInt(req.params.id);
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

    // Update in database.
    // marked_for_deletion zurücksetzen: Ein aktiv gespeicherter Plan darf NICHT durch den
    // Retention-Cleanup gelöscht werden. Die Markierung (init.js) setzt das Flag nur auf stale
    // Plänen (marked_for_deletion = 0 AND updated_at < cutoff); ohne explizites Zurücksetzen
    // beim Speichern bliebe ein bereits markierter Plan markiert und würde nach Ablauf der
    // Schonfrist gelöscht – obwohl er gerade bearbeitet wurde (stiller Datenverlust).
    await dbRun(
      `UPDATE plans
       SET encrypted_state = ?, iv = ?, auth_tag = ?, updated_at = CURRENT_TIMESTAMP,
           marked_for_deletion = 0, marked_for_deletion_at = NULL
       ${name ? ', name = ?' : ''}
       WHERE id = ?`,
      name
        ? [encrypted, iv, authTag, name, planId]
        : [encrypted, iv, authTag, planId]
    );

    // Live-Update: andere verbundene Mitbearbeiter dieses Plans benachrichtigen
    // (außer dem Speichernden selbst).
    broadcastPlanUpdate(planId, req.session.userId);

    // Umbenennungen sind seltene, bedeutsame Ereignisse → immer eine eigene Zeile.
    // Reine Autosaves (kein name) werden koalesziert (s. auditLogCoalesced), damit das
    // Audit-Log nicht von „Wachplan-Änderungen" nach jeder generate() geflutet wird.
    const auditPromise = name
      ? auditLog(getDb(), req.session.userId, 'plan_update', 'plan', planId, { name }, req.ip)
      : auditLogCoalesced(getDb(), req.session.userId, 'plan_update', 'plan', planId, null, req.ip);
    auditPromise.catch(err => console.error('Audit log error (plan_update):', err));

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
    const planId = parsePositiveInt(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    // Verify plan belongs to user (fetch name for audit log)
    const plan = await dbGet(
      'SELECT id, name FROM plans WHERE id = ? AND user_id = ?',
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

    auditLog(getDb(), req.session.userId, 'plan_delete', 'plan', planId, { name: plan.name }, req.ip)
      .catch(err => console.error('Audit log error (plan_delete):', err));

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
    const planId = parsePositiveInt(req.params.id);
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
    const planId = parsePositiveInt(req.params.id);
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

    auditLog(getDb(), req.session.userId, 'plan_share', 'plan', planId, { sharedWithUserId: target.id, role }, req.ip)
      .catch(err => console.error('Audit log error (plan_share):', err));

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
    const planId = parsePositiveInt(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const userId = parsePositiveInt(req.params.userId);
    if (!userId) return res.status(400).json({ error: 'Ungültige Benutzer-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access.role !== 'owner') return res.status(403).json({ error: 'Only the owner can manage sharing' });

    await dbRun('DELETE FROM plan_shares WHERE plan_id = ? AND user_id = ?', [planId, userId]);

    auditLog(getDb(), req.session.userId, 'plan_share_revoke', 'plan', planId, { revokedUserId: userId }, req.ip)
      .catch(err => console.error('Audit log error (plan_share_revoke):', err));

    res.json({ success: true, message: 'Mitbearbeiter entfernt' });
  } catch (error) {
    console.error('Unshare plan error:', error);
    res.status(500).json({ error: 'Failed to remove collaborator' });
  }
});

// ───────────────────────────────────────────────────────────
// GET /api/plans/:id/public-links – aktive Beobachter-Links auflisten
// (Owner oder Mitbearbeiter). Liefert NUR Metadaten – das Token selbst wird
// einmalig bei der Erstellung zurückgegeben und ist danach nicht mehr abrufbar.
// ───────────────────────────────────────────────────────────
router.get('/:id/public-links', async (req, res) => {
  try {
    const planId = parsePositiveInt(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access === false) return res.status(403).json({ error: 'No access to this plan' });

    const links = await dbAll(
      `SELECT id, expires_at, created_at FROM plan_public_links
        WHERE plan_id = ? AND revoked_at IS NULL AND expires_at > ?
        ORDER BY created_at DESC`,
      [planId, Date.now()]
    );

    res.json({ isOwner: access.role === 'owner', links });
  } catch (error) {
    console.error('List public links error:', error);
    res.status(500).json({ error: 'Failed to list public links' });
  }
});

// ───────────────────────────────────────────────────────────
// POST /api/plans/:id/public-link – neuen Beobachter-Link erstellen (nur Owner).
// Gibt das Klartext-Token EINMALIG zurück (in der DB liegt nur der Hash).
// ───────────────────────────────────────────────────────────
router.post('/:id/public-link', express.json(), async (req, res) => {
  try {
    const planId = parsePositiveInt(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access.role !== 'owner') return res.status(403).json({ error: 'Only the owner can create public links' });

    const token = crypto.randomBytes(32).toString('hex');
    const expiresAt = Date.now() + PUBLIC_LINK_TTL_MS;

    const result = await dbRun(
      `INSERT INTO plan_public_links (plan_id, token_hash, created_by, expires_at)
       VALUES (?, ?, ?, ?)`,
      [planId, hashLinkToken(token), req.session.userId, expiresAt]
    );

    auditLog(getDb(), req.session.userId, 'plan_public_link_create', 'plan', planId, { linkId: result.lastID, expiresAt }, req.ip)
      .catch(err => console.error('Audit log error (plan_public_link_create):', err));

    res.status(201).json({ id: result.lastID, token, expiresAt });
  } catch (error) {
    console.error('Create public link error:', error);
    res.status(500).json({ error: 'Failed to create public link' });
  }
});

// ───────────────────────────────────────────────────────────
// DELETE /api/plans/:id/public-link/:linkId – Beobachter-Link zurückziehen (nur Owner)
// ───────────────────────────────────────────────────────────
router.delete('/:id/public-link/:linkId', async (req, res) => {
  try {
    const planId = parsePositiveInt(req.params.id);
    if (!planId) return res.status(400).json({ error: 'Ungültige Plan-ID' });

    const linkId = parsePositiveInt(req.params.linkId);
    if (!linkId) return res.status(400).json({ error: 'Ungültige Link-ID' });

    const access = await getPlanAccess(planId, req.session.userId);
    if (access === null) return res.status(404).json({ error: 'Plan not found' });
    if (access.role !== 'owner') return res.status(403).json({ error: 'Only the owner can manage public links' });

    await dbRun(
      `UPDATE plan_public_links SET revoked_at = CURRENT_TIMESTAMP
        WHERE id = ? AND plan_id = ? AND revoked_at IS NULL`,
      [linkId, planId]
    );

    auditLog(getDb(), req.session.userId, 'plan_public_link_revoke', 'plan', planId, { linkId }, req.ip)
      .catch(err => console.error('Audit log error (plan_public_link_revoke):', err));

    res.json({ success: true, message: 'Link zurückgezogen' });
  } catch (error) {
    console.error('Revoke public link error:', error);
    res.status(500).json({ error: 'Failed to revoke public link' });
  }
});

module.exports = router;
module.exports.validatePlanInput = validatePlanInput;
module.exports.hashLinkToken = hashLinkToken;
