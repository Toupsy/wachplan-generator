/**
 * test/last-admin-protection.test.js
 *
 * Unit tests for Issue #216: Prevent deletion of last remaining admin.
 * Tests the guard logic in DELETE /api/admin/users/:id (server/api/admin.js).
 *
 * Uses an in-memory SQLite DB to simulate the admin count queries.
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');

// ───────────────────────────────────────────────────────────
// Minimal DB helpers (mirror server/db/connection.js)
// ───────────────────────────────────────────────────────────

function makeDb() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(':memory:', (err) => {
      if (err) return reject(err);
      db.exec(
        `CREATE TABLE users (
          id INTEGER PRIMARY KEY AUTOINCREMENT,
          username TEXT UNIQUE NOT NULL,
          password_hash TEXT NOT NULL DEFAULT 'x',
          is_admin INTEGER NOT NULL DEFAULT 0
        )`,
        (err2) => (err2 ? reject(err2) : resolve(db))
      );
    });
  });
}

function dbGet(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.get(sql, params, (err, row) => (err ? reject(err) : resolve(row)))
  );
}

function dbRun(db, sql, params = []) {
  return new Promise((resolve, reject) =>
    db.run(sql, params, function (err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    })
  );
}

// ───────────────────────────────────────────────────────────
// The guard extracted from admin.js (Issue #216)
// Returns null if deletion is allowed, or the error string to reject with.
// ───────────────────────────────────────────────────────────

async function lastAdminGuard(db, targetUserId, requestingUserId) {
  if (targetUserId === requestingUserId) {
    return 'Cannot delete your own account';
  }

  const user = await dbGet(db, 'SELECT id, is_admin FROM users WHERE id = ?', [targetUserId]);
  if (!user) return 'User not found';

  if (user.is_admin) {
    const { c } = await dbGet(db, 'SELECT COUNT(*) AS c FROM users WHERE is_admin = 1');
    if (c <= 1) return 'Der letzte Administrator kann nicht gelöscht werden';
  }

  return null; // allowed
}

// ───────────────────────────────────────────────────────────
// Tests
// ───────────────────────────────────────────────────────────

test('Issue #216: Last-admin protection', async (t) => {
  const db = await makeDb();

  let adminAId, adminBId, regularId;

  await t.test('Setup: insert test users', async () => {
    const a = await dbRun(db, "INSERT INTO users (username, is_admin) VALUES ('adminA', 1)");
    adminAId = a.lastID;
    const b = await dbRun(db, "INSERT INTO users (username, is_admin) VALUES ('adminB', 1)");
    adminBId = b.lastID;
    const r = await dbRun(db, "INSERT INTO users (username, is_admin) VALUES ('regular', 0)");
    regularId = r.lastID;
  });

  await t.test('Rejects deleting last admin (1 admin left)', async () => {
    // Remove adminB so only adminA remains
    await dbRun(db, 'DELETE FROM users WHERE id = ?', [adminBId]);
    const err = await lastAdminGuard(db, adminAId, 9999 /* other session */);
    assert.equal(err, 'Der letzte Administrator kann nicht gelöscht werden');
    // Restore adminB for subsequent tests
    const b = await dbRun(db, "INSERT INTO users (username, is_admin) VALUES ('adminB', 1)");
    adminBId = b.lastID;
  });

  await t.test('Allows deleting an admin when ≥2 admins exist', async () => {
    const err = await lastAdminGuard(db, adminBId, adminAId /* requesting admin */);
    assert.equal(err, null, 'Should be allowed when another admin remains');
  });

  await t.test('Allows deleting a regular user regardless of admin count', async () => {
    const err = await lastAdminGuard(db, regularId, adminAId);
    assert.equal(err, null, 'Non-admin deletion always allowed');
  });

  await t.test('Rejects self-deletion (own account)', async () => {
    const err = await lastAdminGuard(db, adminAId, adminAId);
    assert.equal(err, 'Cannot delete your own account');
  });

  await t.test('Returns user-not-found for unknown id', async () => {
    const err = await lastAdminGuard(db, 99999, adminAId);
    assert.equal(err, 'User not found');
  });

  db.close();
});
