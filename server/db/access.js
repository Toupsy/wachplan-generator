// ============================================================
// Plan-Zugriffsprüfung – zentral (von api/plans.js und realtime.js genutzt)
// ============================================================

const { dbGet } = require('./connection');

// Zugriff prüfen → { ownerId, role:'owner'|'collaborator', shareRole? } | null (404) | false (403)
async function getPlanAccess(planId, userId) {
  const plan = await dbGet('SELECT user_id FROM plans WHERE id = ?', [planId]);
  if (!plan) return null;
  if (plan.user_id === userId) return { ownerId: plan.user_id, role: 'owner' };
  const share = await dbGet(
    'SELECT role FROM plan_shares WHERE plan_id = ? AND user_id = ?',
    [planId, userId]
  );
  return share ? { ownerId: plan.user_id, role: 'collaborator', shareRole: share.role || 'edit' } : false;
}

module.exports = { getPlanAccess };
