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

test('session store retries transient read and save errors', async () => {
  delete require.cache[require.resolve('../server/db/connection')];
  delete require.cache[require.resolve('../server/db/session')];
  const { _wrapStoreMethodWithRetry } = require('../server/db/session');

  let setCalls = 0;
  let getCalls = 0;
  const store = {
    get(sid, cb) {
      getCalls += 1;
      if (getCalls === 1) {
        cb(Object.assign(new Error('temporary I/O error'), { code: 'SQLITE_IOERR' }));
        return;
      }
      cb(null, { userId: 1 });
    },
    set(sid, sess, cb) {
      setCalls += 1;
      if (setCalls === 1) {
        cb(Object.assign(new Error('temporary I/O error'), { code: 'SQLITE_IOERR' }));
        return;
      }
      cb(null, true);
    }
  };

  _wrapStoreMethodWithRetry(store, 'get');
  _wrapStoreMethodWithRetry(store, 'set');
  const sess = await new Promise((resolve, reject) => {
    store.get('retry-sid', (err, row) => err ? reject(err) : resolve(row));
  });
  assert.deepEqual(sess, { userId: 1 });

  await new Promise((resolve, reject) => {
    store.set(
      'retry-sid',
      { cookie: { expires: new Date(Date.now() + 1000) }, userId: 1 },
      (err) => err ? reject(err) : resolve()
    );
  });

  assert.equal(getCalls, 2);
  assert.equal(setCalls, 2);
});
