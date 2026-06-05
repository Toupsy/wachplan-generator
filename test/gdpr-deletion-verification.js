#!/usr/bin/env node
/**
 * GDPR Art. 17 (Recht auf Löschung) – Verification Script
 *
 * Verifiziert, dass beim Löschen eines Users alle zugehörigen Daten entfernt werden:
 * • User-Konto
 * • Verschlüsselte Pläne
 * • Plan-Freigaben
 * • Sessions
 */

const sqlite3 = require('sqlite3').verbose();
const path = require('path');
const fs = require('fs');

const dbPath = path.join(__dirname, '..', 'data', 'test-gdpr.db');

// Cleanup test database if exists
if (fs.existsSync(dbPath)) {
  fs.unlinkSync(dbPath);
}

const db = new sqlite3.Database(dbPath, (err) => {
  if (err) {
    console.error('❌ Failed to open database:', err.message);
    process.exit(1);
  }
  console.log('✓ Test database created');
});

const run = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.run(query, params, function(err) {
      if (err) reject(err);
      else resolve({ lastID: this.lastID, changes: this.changes });
    });
  });
};

const get = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.get(query, params, (err, row) => {
      if (err) reject(err);
      else resolve(row);
    });
  });
};

const all = (query, params = []) => {
  return new Promise((resolve, reject) => {
    db.all(query, params, (err, rows) => {
      if (err) reject(err);
      else resolve(rows || []);
    });
  });
};

async function runTest() {
  try {
    // 1. Enable foreign keys and create schema
    console.log('\n=== Setup ===');
    await run('PRAGMA foreign_keys = ON');
    console.log('✓ Foreign keys enabled');

    // Create tables
    const schema = fs.readFileSync(path.join(__dirname, '..', 'server', 'db', 'schema.sql'), 'utf-8');
    const statements = schema.split(';').filter(s => s.trim());
    for (const statement of statements) {
      if (statement.trim()) {
        await run(statement);
      }
    }
    console.log('✓ Schema created');

    // 2. Insert test data
    console.log('\n=== Insert Test Data ===');

    // Create user
    const userRes = await run(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      ['test_user', 'hashed_pw', 'test@example.com', 0]
    );
    const userId = userRes.lastID;
    console.log(`✓ User created (ID: ${userId})`);

    // Create plans for user
    const plan1Res = await run(
      'INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Plan 1', Buffer.from('encrypted1'), Buffer.from('iv1'), Buffer.from('tag1')]
    );
    const plan1Id = plan1Res.lastID;
    console.log(`✓ Plan 1 created (ID: ${plan1Id})`);

    const plan2Res = await run(
      'INSERT INTO plans (user_id, name, encrypted_state, iv, auth_tag) VALUES (?, ?, ?, ?, ?)',
      [userId, 'Plan 2', Buffer.from('encrypted2'), Buffer.from('iv2'), Buffer.from('tag2')]
    );
    const plan2Id = plan2Res.lastID;
    console.log(`✓ Plan 2 created (ID: ${plan2Id})`);

    // Create another user for sharing
    const otherUserRes = await run(
      'INSERT INTO users (username, password_hash, email, is_admin) VALUES (?, ?, ?, ?)',
      ['other_user', 'hashed_pw', 'other@example.com', 0]
    );
    const otherUserId = otherUserRes.lastID;
    console.log(`✓ Other user created (ID: ${otherUserId})`);

    // Create plan shares
    await run(
      'INSERT INTO plan_shares (plan_id, user_id, role) VALUES (?, ?, ?)',
      [plan1Id, otherUserId, 'view']
    );
    console.log(`✓ Plan 1 shared with other user`);

    // Create sessions
    const sessionObj = JSON.stringify({ userId: userId, username: 'test_user' });
    await run(
      'INSERT INTO sessions (sid, session, expiryDate) VALUES (?, ?, ?)',
      ['session-1', sessionObj, new Date(Date.now() + 7*24*60*60*1000).toISOString()]
    );
    console.log(`✓ Session created for user`);

    // Verify initial state
    console.log('\n=== Verify Initial State ===');
    let userCount = await get('SELECT COUNT(*) as count FROM users');
    let planCount = await get('SELECT COUNT(*) as count FROM plans');
    let shareCount = await get('SELECT COUNT(*) as count FROM plan_shares');
    let sessionCount = await get('SELECT COUNT(*) as count FROM sessions');

    console.log(`✓ Users: ${userCount.count}`);
    console.log(`✓ Plans: ${planCount.count}`);
    console.log(`✓ Plan Shares: ${shareCount.count}`);
    console.log(`✓ Sessions: ${sessionCount.count}`);

    // 3. Simulate deletion (from admin.js)
    console.log('\n=== Perform Cascading Deletion ===');
    await run('DELETE FROM sessions WHERE json_extract(session, "$.userId") = ?', [userId]);
    await run('DELETE FROM plans WHERE user_id = ?', [userId]);
    await run('DELETE FROM users WHERE id = ?', [userId]);
    console.log(`✓ User ${userId} and related data deleted`);

    // 4. Verify complete deletion
    console.log('\n=== Verify Complete Deletion ===');
    const userAfter = await get('SELECT COUNT(*) as count FROM users WHERE id = ?', [userId]);
    const plansAfter = await all('SELECT id FROM plans WHERE user_id = ?', [userId]);
    const sharesAfter = await all('SELECT * FROM plan_shares WHERE plan_id IN (?, ?)', [plan1Id, plan2Id]);
    const sessionsAfter = await all('SELECT * FROM sessions WHERE json_extract(session, "$.userId") = ?', [userId]);

    console.log(`✓ User record: ${userAfter.count === 0 ? 'DELETED ✓' : 'STILL EXISTS ✗'}`);
    console.log(`✓ Plans: ${plansAfter.length === 0 ? 'ALL DELETED ✓' : `${plansAfter.length} ORPHANS FOUND ✗`}`);
    console.log(`✓ Plan shares: ${sharesAfter.length === 0 ? 'ALL DELETED ✓' : `${sharesAfter.length} ORPHANS FOUND ✗`}`);
    console.log(`✓ Sessions: ${sessionsAfter.length === 0 ? 'ALL DELETED ✓' : `${sessionsAfter.length} ORPHANS FOUND ✗`}`);

    // Verify other user's data is intact
    const otherUserAfter = await get('SELECT COUNT(*) as count FROM users WHERE id = ?', [otherUserId]);
    console.log(`✓ Other user unaffected: ${otherUserAfter.count === 1 ? 'YES ✓' : 'NO ✗'}`);

    // Final summary
    console.log('\n=== Final State ===');
    userCount = await get('SELECT COUNT(*) as count FROM users');
    planCount = await get('SELECT COUNT(*) as count FROM plans');
    shareCount = await get('SELECT COUNT(*) as count FROM plan_shares');
    sessionCount = await get('SELECT COUNT(*) as count FROM sessions');

    console.log(`✓ Users: ${userCount.count} (1 remaining – other_user)`);
    console.log(`✓ Plans: ${planCount.count}`);
    console.log(`✓ Plan Shares: ${shareCount.count}`);
    console.log(`✓ Sessions: ${sessionCount.count}`);

    // Test result
    const allTestsPassed =
      userAfter.count === 0 &&
      plansAfter.length === 0 &&
      sharesAfter.length === 0 &&
      sessionsAfter.length === 0;

    console.log(`\n${allTestsPassed ? '✓ ALL TESTS PASSED' : '✗ SOME TESTS FAILED'}\n`);

    db.close();
    process.exit(allTestsPassed ? 0 : 1);

  } catch (error) {
    console.error('\n❌ Test failed:', error.message);
    db.close();
    process.exit(1);
  }
}

runTest();
