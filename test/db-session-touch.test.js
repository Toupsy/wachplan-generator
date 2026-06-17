const test = require('node:test');
const assert = require('node:assert/strict');
const os = require('node:os');
const path = require('node:path');
const fs = require('node:fs');

test('session middleware disables per-request SQLite touch writes by default', async () => {
  const tmpDir = fs.mkdtempSync(path.join(os.tmpdir(), 'session-touch-'));
  process.env.DATABASE_PATH = path.join(tmpDir, 'wachplan.db');
  process.env.SESSION_SECRET = 'test-session-secret';
  delete process.env.SESSION_TOUCH_WRITES;

  const { createSessionMiddleware } = require('../server/db/session');
  const middleware = createSessionMiddleware({ resave: false, saveUninitialized: false });
  const statements = [];
  const originalRun = middleware.store.db.run.bind(middleware.store.db);
  middleware.store.db.run = (sql, ...args) => {
    statements.push(String(sql));
    return originalRun(sql, ...args);
  };

  let touched = false;
  await new Promise((resolve, reject) => {
    middleware.store.touch('sid', { cookie: { expires: new Date(Date.now() + 1000) } }, (err) => {
      if (err) reject(err);
      touched = true;
      resolve();
    });
  });

  assert.equal(touched, true);
  assert.equal(statements.some((sql) => /UPDATE\s+sessions\s+SET\s+expired/i.test(sql)), false);
  await middleware.closeStore();

  const dbFiles = fs.readdirSync(tmpDir).filter((file) => file.endsWith('.db'));
  assert.deepEqual(dbFiles, ['wachplan.db']);

  fs.rmSync(tmpDir, { recursive: true, force: true });
});
