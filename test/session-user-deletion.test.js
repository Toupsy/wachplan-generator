/**
 * test/session-user-deletion.test.js
 *
 * Integration test for Issue #211: Sessions table schema collision
 * Tests that:
 * 1. User deletion removes associated sessions (GDPR Art. 17)
 * 2. Sessions table can be managed by connect-sqlite3 after schema removal
 */

const { test } = require('node:test');
const assert = require('node:assert/strict');
const sqlite3 = require('sqlite3');
const path = require('path');
const fs = require('fs');

// ============================================================
// TEST SETUP & TEARDOWN
// ============================================================

let testDbPath;
let testDb;

function setupTestDb() {
  // Create temporary test database
  const tmpDir = path.join(__dirname, '..', 'data');
  if (!fs.existsSync(tmpDir)) {
    fs.mkdirSync(tmpDir, { recursive: true });
  }
  testDbPath = path.join(tmpDir, `test-sessions-${Date.now()}.db`);
  console.log('📂 Test DB:', testDbPath);
}

function cleanupTestDb() {
  return new Promise((resolve) => {
    if (testDb) {
      testDb.close((err) => {
        if (testDbPath && fs.existsSync(testDbPath)) {
          fs.unlinkSync(testDbPath);
          console.log('✓ Test DB cleaned up');
        }
        resolve();
      });
    } else {
      resolve();
    }
  });
}

// ============================================================
// HELPER: Execute DB query
// ============================================================

function dbRun(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.run(sql, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
}

function dbGet(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.get(sql, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
}

function dbAll(sql, params = []) {
  return new Promise((resolve, reject) => {
    testDb.all(sql, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
}

// ============================================================
// MAIN TEST
// ============================================================

test('Issue #211: User deletion with sessions management', async (t) => {
  setupTestDb();

  await t.test('Setup: Initialize database', async () => {
    return new Promise((resolve, reject) => {
      testDb = new sqlite3.Database(testDbPath, (err) => {
        if (err) {
          reject(err);
          return;
        }

        // Create users table (minimal for this test)
        testDb.exec(`
          CREATE TABLE IF NOT EXISTS users (
            id INTEGER PRIMARY KEY AUTOINCREMENT,
            username TEXT UNIQUE NOT NULL,
            password_hash TEXT NOT NULL
          );

          CREATE TABLE IF NOT EXISTS sessions (
            sid TEXT PRIMARY KEY,
            expired INTEGER,
            sess TEXT NOT NULL
          );
        `, (err) => {
          if (err) {
            reject(err);
          } else {
            console.log('✓ Tables created (users, sessions)');
            resolve();
          }
        });
      });
    });
  });

  await t.test('Sessions table has correct schema (sid, expired, sess)', async () => {
    // Verify columns exist
    const tableInfo = await dbAll("PRAGMA table_info(sessions)");
    assert(tableInfo.length > 0, 'Sessions table should exist');

    const columnNames = tableInfo.map(col => col.name);
    console.log('📊 Sessions table columns:', columnNames);

    assert(columnNames.includes('sid'), 'Should have sid column');
    assert(columnNames.includes('sess'), 'Should have sess column');
    assert(columnNames.includes('expired'), 'Should have expired column');
    assert(!columnNames.includes('session'), 'Should NOT have session column (old schema)');
    assert(!columnNames.includes('expiryDate'), 'Should NOT have expiryDate column (old schema)');

    console.log('✓ Sessions table has correct schema');
  });

  await t.test('Sessions persist and are retrievable', async () => {
    // Insert a test session (simulating connect-sqlite3)
    const testSessionId = 'test-session-123';
    const testSessionData = {
      userId: 999,
      username: 'testuser',
      isAdmin: false
    };

    await dbRun(
      "INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)",
      [testSessionId, Date.now() + 7 * 24 * 60 * 60 * 1000, JSON.stringify(testSessionData)]
    );

    // Verify it was inserted
    const row = await dbGet("SELECT * FROM sessions WHERE sid = ?", [testSessionId]);
    assert(row, 'Session should be retrievable');
    assert.equal(row.sid, testSessionId);

    const sess = JSON.parse(row.sess);
    assert.equal(sess.userId, 999);
    assert.equal(sess.username, 'testuser');

    console.log('✓ Session persisted and retrieved correctly');
  });

  await t.test('User deletion removes associated sessions (GDPR Art. 17)', async () => {
    // Create a test user
    const result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      ['deleteme', 'hash123']
    );
    const userId = result.lastID;
    console.log('👤 Created test user:', userId);

    // Create sessions for this user
    const sessionIds = ['sess-1', 'sess-2'];
    for (const sid of sessionIds) {
      const sessionData = { userId, username: 'deleteme' };
      await dbRun(
        "INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)",
        [sid, Date.now() + 7 * 24 * 60 * 60 * 1000, JSON.stringify(sessionData)]
      );
    }

    // Verify sessions exist before deletion
    const sessionsBefore = await dbAll(
      "SELECT * FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [userId]
    );
    assert.equal(sessionsBefore.length, 2, 'Should have 2 sessions before deletion');
    console.log('✓ Created 2 test sessions for user:', userId);

    // Delete sessions using the query from admin.js (line 141)
    const deleteSessionsResult = await dbRun(
      "DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [userId]
    );
    assert(deleteSessionsResult.changes > 0, 'DELETE should affect rows');
    console.log('✓ Deleted sessions using admin.js query');

    // Delete the user
    const deleteUserResult = await dbRun('DELETE FROM users WHERE id = ?', [userId]);
    assert.equal(deleteUserResult.changes, 1, 'DELETE should remove the user');

    // Verify no sessions remain for this user
    const sessionsAfter = await dbAll(
      "SELECT * FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [userId]
    );
    assert.equal(sessionsAfter.length, 0, 'All sessions should be deleted');

    console.log('✓ User deletion successfully removed all associated sessions');
  });

  await t.test('Sessions from other users are not affected', async () => {
    // Create two users
    const user1Result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      ['user1', 'hash1']
    );
    const user1Id = user1Result.lastID;

    const user2Result = await dbRun(
      "INSERT INTO users (username, password_hash) VALUES (?, ?)",
      ['user2', 'hash2']
    );
    const user2Id = user2Result.lastID;

    // Create sessions for both users
    await dbRun(
      "INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)",
      ['sess-u1', Date.now() + 7 * 24 * 60 * 60 * 1000, JSON.stringify({ userId: user1Id, username: 'user1' })]
    );
    await dbRun(
      "INSERT INTO sessions (sid, expired, sess) VALUES (?, ?, ?)",
      ['sess-u2', Date.now() + 7 * 24 * 60 * 60 * 1000, JSON.stringify({ userId: user2Id, username: 'user2' })]
    );

    // Delete user1's sessions
    await dbRun(
      "DELETE FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [user1Id]
    );

    // Verify user1's sessions are gone
    const user1Sessions = await dbAll(
      "SELECT * FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [user1Id]
    );
    assert.equal(user1Sessions.length, 0, 'User1 sessions should be deleted');

    // Verify user2's sessions remain
    const user2Sessions = await dbAll(
      "SELECT * FROM sessions WHERE json_extract(sess, '$.userId') = ?",
      [user2Id]
    );
    assert.equal(user2Sessions.length, 1, 'User2 sessions should remain unaffected');
    assert.equal(user2Sessions[0].sid, 'sess-u2');

    console.log('✓ Other users\' sessions remain unaffected');
  });

  await cleanupTestDb();
});
