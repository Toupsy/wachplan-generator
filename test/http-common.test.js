// ============================================================
// http-common.test.js
// Regressionsschutz: notFoundHandler darf bei bereits gesendeten Headern nichts
// mehr senden (sonst ERR_HTTP_HEADERS_SENT, z. B. wenn serve-static eine
// abgebrochene Antwort an die 404-Middleware weiterreicht).
// ============================================================

const test = require('node:test');
const assert = require('node:assert');

const { notFoundHandler } = require('../server/http-common');

function mockRes({ headersSent }) {
  const calls = { status: [], json: [] };
  const res = {
    headersSent,
    status(code) { calls.status.push(code); return res; },
    json(body) { calls.json.push(body); return res; },
  };
  return { res, calls };
}

test('notFoundHandler: sendet nichts mehr, wenn Header bereits raus sind', () => {
  const handler = notFoundHandler('admin-panel');
  const { res, calls } = mockRes({ headersSent: true });
  assert.doesNotThrow(() => handler({ url: '/x' }, res));
  assert.strictEqual(calls.status.length, 0, 'status() darf nicht aufgerufen werden');
  assert.strictEqual(calls.json.length, 0, 'json() darf nicht aufgerufen werden');
});

test('notFoundHandler: antwortet normal mit 404, wenn Header noch offen', () => {
  const handler = notFoundHandler('admin-panel');
  const { res, calls } = mockRes({ headersSent: false });
  handler({ url: '/fehlt' }, res);
  assert.deepStrictEqual(calls.status, [404]);
  assert.strictEqual(calls.json.length, 1);
  assert.strictEqual(calls.json[0].error, 'Not found');
  assert.strictEqual(calls.json[0].path, '/fehlt');
  assert.strictEqual(calls.json[0].service, 'admin-panel');
});
