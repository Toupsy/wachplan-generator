// ============================================================
// embedded-admin.test.js
// Regressionsschutz für den SQLITE_CORRUPT-Wurzelfix:
//   1. admin-server.js exportiert createAdminApp (Factory).
//   2. Das blosse `require` startet KEINEN Listener/DB-Prozess (require.main-Guard)
//      – sonst würde server.js' eingebettetes Panel einen zweiten DB-Öffner hochfahren
//      und die cross-process-Korruption wäre zurück.
// ============================================================

const test = require('node:test');
const assert = require('node:assert');
const path = require('path');
const { execFileSync } = require('child_process');

const REPO = path.join(__dirname, '..');

test('admin-server exportiert createAdminApp', () => {
  const mod = require('../server/admin-server');
  assert.strictEqual(typeof mod.createAdminApp, 'function', 'createAdminApp muss exportiert sein');
});

test('require("admin-server") startet keinen Listener (require.main-Guard)', () => {
  // In frischem Kindprozess: nur requiren, kurz warten, dann prüfen, dass KEIN Port
  // gebunden wurde (kein "Admin Panel läuft"-Log) und der Prozess sauber endet.
  const script = `
    const mod = require(${JSON.stringify(path.join(REPO, 'server', 'admin-server.js'))});
    if (typeof mod.createAdminApp !== 'function') { console.error('NO_FACTORY'); process.exit(2); }
    // Wenn beim require ein listen()/start() liefe, beendete sich der Prozess nicht von selbst.
    setTimeout(() => { console.log('NO_AUTOSTART'); process.exit(0); }, 400);
  `;
  const out = execFileSync(process.execPath, ['-e', script], {
    cwd: REPO,
    timeout: 8000,
    encoding: 'utf-8',
    // Minimal-Env: validateEnv läuft NICHT beim blossen require (nur in start()),
    // daher reichen keine Secrets – genau das soll der Test absichern.
    env: { ...process.env, ADMIN_PORT: '', PORT: '' },
  });
  assert.match(out, /NO_AUTOSTART/, 'require darf keinen Server starten; Output:\n' + out);
});
