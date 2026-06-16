// ============================================================
// Public API Routes (KEINE Authentifizierung)
// GET /api/public/plan/:token – Nur-Lese-Zugriff auf einen Plan über einen
//   Beobachter-Link (plan_public_links). Für Wachgänger ohne Account.
// ============================================================
//
// Sicherheit: Das Token ist ein 256-Bit-Zufallswert (nicht erratbar). In der DB
// liegt nur dessen SHA-256-Hash. Abgelaufene oder zurückgezogene Links liefern 404
// (kein Unterschied zu „existiert nicht" → keine Token-Enumeration).
// Es werden ausschließlich Plan-Name + entschlüsselter State zurückgegeben –
// keine Owner-/User-Daten, keine Plan-ID.

const express = require('express');
const router = express.Router();
const { dbGet } = require('../db/connection');
const { decryptPlanState } = require('../db/crypto');
const { hashLinkToken } = require('./plans');

router.get('/plan/:token', async (req, res) => {
  try {
    const token = req.params.token;
    // Format-Guard: 64 Hex-Zeichen (crypto.randomBytes(32).toString('hex'))
    if (typeof token !== 'string' || !/^[0-9a-f]{64}$/.test(token)) {
      return res.status(404).json({ error: 'Link ungültig oder abgelaufen' });
    }

    const link = await dbGet(
      `SELECT plan_id, expires_at FROM plan_public_links
        WHERE token_hash = ? AND revoked_at IS NULL`,
      [hashLinkToken(token)]
    );
    if (!link || link.expires_at <= Date.now()) {
      return res.status(404).json({ error: 'Link ungültig oder abgelaufen' });
    }

    const plan = await dbGet(
      'SELECT user_id, name, encrypted_state, iv, auth_tag FROM plans WHERE id = ?',
      [link.plan_id]
    );
    if (!plan) return res.status(404).json({ error: 'Link ungültig oder abgelaufen' });

    // Entschlüsseln mit dem OWNER-Key (plans.user_id), wie bei /api/plans.
    const plainJSON = decryptPlanState(plan.encrypted_state, plan.iv, plan.auth_tag, plan.user_id);

    res.set('Cache-Control', 'no-store');
    res.json({ name: plan.name, state: plainJSON });
  } catch (error) {
    console.error('Public plan view error:', error);
    res.status(500).json({ error: 'Failed to load plan' });
  }
});

module.exports = router;
