// ============================================================
// Database Initialization
// SQLite Setup, Schema Migration, Environment Validation
// ============================================================

const sqlite3 = require('sqlite3');
const bcryptjs = require('bcryptjs');
const fs = require('fs');
const path = require('path');

// Ensure data directory exists
const dataDir = process.env.DATABASE_PATH
  ? path.dirname(process.env.DATABASE_PATH)
  : path.join(__dirname, '..', '..', 'data');

console.log('📂 __dirname:', __dirname);
console.log('📂 dataDir:', dataDir);
console.log('📂 dataDir exists:', fs.existsSync(dataDir));

if (!fs.existsSync(dataDir)) {
  fs.mkdirSync(dataDir, { recursive: true });
  console.log('✓ Created data directory');
}

try {
  fs.accessSync(dataDir, fs.constants.W_OK);
  console.log('📂 dataDir writable: YES');
} catch (e) {
  console.error('📂 dataDir writable: NO →', e.message);
}

const dbPath = process.env.DATABASE_PATH || path.join(dataDir, 'wachplan.db');
console.log('📂 dbPath:', dbPath);

const DB_BUSY_TIMEOUT_MS = Number.parseInt(process.env.DB_BUSY_TIMEOUT_MS || '30000', 10);
const INTEGRITY_RETRIES = Number.parseInt(process.env.DB_INTEGRITY_RETRIES || '6', 10);
const TRANSIENT_INTEGRITY_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_PROTOCOL']);
const INIT_LOCK_TIMEOUT_MS = Number.parseInt(process.env.DB_INIT_LOCK_TIMEOUT_MS || '60000', 10);
const INIT_LOCK_STALE_MS = Number.parseInt(process.env.DB_INIT_LOCK_STALE_MS || '120000', 10);
const AUDIT_LOG_RETRIES = Number.parseInt(process.env.DB_AUDIT_RETRIES || '5', 10);
const TRANSIENT_WRITE_CODES = new Set(['SQLITE_BUSY', 'SQLITE_LOCKED', 'SQLITE_IOERR', 'SQLITE_PROTOCOL']);

// Validate environment variables
function validateEnv() {
  const required = ['MASTER_SECRET', 'SALT', 'SESSION_SECRET'];
  const missing = required.filter(key => !process.env[key]);

  if (missing.length > 0) {
    console.error('❌ Missing required environment variables:', missing.join(', '));
    console.error('Set them in docker-compose.yml or .env file');
    process.exit(1);
  }

  // Validate lengths
  if (process.env.MASTER_SECRET.length < 32) {
    console.error('❌ MASTER_SECRET must be at least 32 characters');
    process.exit(1);
  }
  if (process.env.SALT.length < 16) {
    console.error('❌ SALT must be at least 16 characters');
    process.exit(1);
  }
  if (process.env.SESSION_SECRET.length < 16) {
    console.error('❌ SESSION_SECRET must be at least 16 characters');
    process.exit(1);
  }

  // Validate REGISTRATION_MODE if set
  const registrationMode = process.env.REGISTRATION_MODE || 'disabled';
  if (!['disabled', 'open', 'code'].includes(registrationMode)) {
    console.error('❌ REGISTRATION_MODE must be one of: disabled, open, code');
    process.exit(1);
  }

  // If code mode, require REGISTRATION_CODE
  if (registrationMode === 'code' && !process.env.REGISTRATION_CODE) {
    console.error('❌ REGISTRATION_CODE required when REGISTRATION_MODE=code');
    process.exit(1);
  }

  // reCAPTCHA: beide Keys oder keiner (halber Zustand = Fehlkonfiguration)
  const hasSiteKey = !!process.env.RECAPTCHA_SITE_KEY;
  const hasSecretKey = !!process.env.RECAPTCHA_SECRET_KEY;
  if (hasSiteKey !== hasSecretKey) {
    console.error('❌ RECAPTCHA_SITE_KEY und RECAPTCHA_SECRET_KEY müssen beide gesetzt sein (oder beide leer)');
    process.exit(1);
  }

  // SMTP konfiguriert, aber keine öffentliche URL → Mail-Links zeigen auf localhost
  if (process.env.SMTP_HOST && !process.env.APP_BASE_URL) {
    console.warn('⚠ SMTP_HOST gesetzt, aber APP_BASE_URL fehlt – Links in E-Mails zeigen auf localhost');
  }

  console.log('✓ Environment variables validated');
}

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(
      dbPath,
      sqlite3.OPEN_READWRITE | sqlite3.OPEN_CREATE | sqlite3.OPEN_FULLMUTEX,
      (err) => {
      let releaseInitLock = null;
      if (err) {
        console.error('❌ Failed to open database:', err);
        reject(err);
        return;
      }

      console.log('✓ Database connection established:', dbPath);
      if (typeof db.configure === 'function') db.configure('busyTimeout', DB_BUSY_TIMEOUT_MS);

      // Rollback-Journal (DELETE) statt WAL – früh und auf DERSELBEN Verbindung, die
      // gleich das Schema schreibt. WAL ist zwischen den zwei Containern (wachplan +
      // wachplan-admin) auf dem geteilten Volume nicht prozess-kohärent und korrumpiert
      // die DB (s. connection.js). Setzt zudem eine bestehende WAL-DB beim Start auf
      // DELETE zurück, bevor irgendetwas geschrieben wird. busy_timeout: cross-process
      // Lock-Contention abwarten statt SQLITE_BUSY.
      acquireInitLock()
        .then((release) => {
          releaseInitLock = release;
          return configureStartupConnection(db);
        })
        .then(() => checkIntegrity(db))
        .then(() => proceedAfterIntegrity())
        .catch((integErr) => {
          if (integErr && integErr.isInitLockError) {
            db.close(() => reject(integErr));
            return;
          }
          if (isTransientIntegrityError(integErr)) {
            console.warn('⚠ Database integrity check skipped: database is busy/locked.');
            console.warn('   This is not corruption. Another container is currently using ' + dbPath);
            proceedAfterIntegrity();
            return;
          }
          // Auto-Heilung: Ist die Beschädigung auf die (wegwerfbare) sessions-Tabelle
          // beschränkt, kann sie gefahrlos entfernt werden – connect-sqlite3 legt sie
          // beim nächsten Session-Schreiben neu an. Nutzer/Pläne bleiben unberührt;
          // die Nutzer müssen sich nur neu anmelden. (CLAUDE.md: sessions-Store ist
          // bekanntermaßen fragil bei zwei Containern auf demselben WAL-Volume.)
          healSessionCorruption(db, integErr).then((healed) => {
            if (healed) { proceedAfterIntegrity(); return; }

            console.error('');
            console.error('============================================================');
            console.error('❌ DATENBANK-INTEGRITÄTSPRÜFUNG FEHLGESCHLAGEN');
            console.error('   ' + integErr.message);
            console.error('   Datei: ' + dbPath);
            console.error('   Vermutlich beschädigt (SQLITE_CORRUPT). Wiederherstellung:');
            console.error('     1) beide Container stoppen (wachplan + wachplan-admin)');
            console.error('     2) sqlite3 wachplan.db ".recover" | sqlite3 wachplan.db.recovered');
            console.error('     3) recovered-DB nach Prüfung einspielen, -wal/-shm löschen');
            console.error('============================================================');
            console.error('');
            if (process.env.DB_ALLOW_CORRUPT_START !== '1') {
              console.error('   Start wird abgebrochen. Setze DB_ALLOW_CORRUPT_START=1 nur zur Notfall-Datenrettung.');
              db.close((closeErr) => {
                if (releaseInitLock) releaseInitLock();
                reject(closeErr || integErr);
              });
              return;
            }
            // Standard: weiterlaufen (kein Single-Point-of-Failure durch einen
            // evtl. transienten Check), aber der Fehler ist jetzt unübersehbar geloggt.
            proceedAfterIntegrity();
          });
        });

      function proceedAfterIntegrity() {
      // Migration: Drop old incorrectly-structured sessions table from pre-#211 versions.
      // connect-sqlite3 expects (sid, expired, sess) but old schema had (sid, session, expiryDate).
      // Nur bei altem Schema droppen – sonst würden persistente Sessions
      // (Merke-mich, seit Session-Store-Fix) bei jedem Neustart gelöscht.
      db.all('PRAGMA table_info(sessions)', (err, cols) => {
        if (err || !cols || cols.length === 0) return;
        const names = cols.map(c => c.name);
        if (names.includes('expiryDate') || names.includes('session')) {
          db.run('DROP TABLE IF EXISTS sessions', () => {});
        }
      });

      // Read and execute schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // Split by semicolon and execute each statement
      db.exec(schema, (err) => {
        if (err) {
          console.error('❌ Failed to execute schema:', err);
          db.close((closeErr) => {
            if (releaseInitLock) releaseInitLock();
            reject(err);  // Reject with original error, not close error
          });
          return;
        }

        console.log('✓ Database schema initialized');

        // Idempotente Migration: role-Spalte für plan_shares (alte DBs ohne role).
        // Fehler ("duplicate column name") wird bewusst ignoriert. sqlite3 serialisiert
        // Statements auf der Verbindung → läuft vor den folgenden Queries.
        db.run("ALTER TABLE plan_shares ADD COLUMN role TEXT NOT NULL DEFAULT 'edit'", () => {});

        // Idempotente Migration: last_login-Spalte für users (alte DBs ohne last_login).
        // Fehler ("duplicate column name") wird bewusst ignoriert.
        db.run("ALTER TABLE users ADD COLUMN last_login DATETIME", () => {});

        // Idempotente Migration: pending_verification für users (E-Mail-Verifizierung).
        // Default 0 → Bestandsnutzer gelten als verifiziert und können sich weiter einloggen.
        db.run("ALTER TABLE users ADD COLUMN pending_verification BOOLEAN DEFAULT 0", () => {});

        // Idempotente Migration: Plan-Retention-Spalten für plans (alte DBs ohne diese Spalten).
        // Fehler ("duplicate column name") wird bewusst ignoriert.
        db.run("ALTER TABLE plans ADD COLUMN marked_for_deletion BOOLEAN DEFAULT 0", () => {});
        db.run("ALTER TABLE plans ADD COLUMN marked_for_deletion_at DATETIME", () => {});

        // Auto-create admin if ADMIN_USERNAME + ADMIN_PASSWORD are set
        db.get("SELECT COUNT(*) as count FROM users WHERE is_admin = 1", async (err, row) => {
          if (err) {
            db.close((closeErr) => {
              if (releaseInitLock) releaseInitLock();
              reject(err);  // Reject with original error
            });
            return;
          }

          const autoUser = process.env.ADMIN_USERNAME;
          const autoPass = process.env.ADMIN_PASSWORD;

          if (row.count === 0 && autoUser && autoPass) {
            try {
              const hash = await bcryptjs.hash(autoPass, 10);
              db.run(
                'INSERT INTO users (username, password_hash, is_admin) VALUES (?, ?, 1)',
                [autoUser, hash],
                (insertErr) => {
                  if (insertErr && !insertErr.message.includes('UNIQUE')) {
                    console.error('❌ Failed to create default admin:', insertErr.message);
                  } else if (!insertErr) {
                    console.log(`✓ Default admin created: ${autoUser}`);
                  }
                  closeDb();
                }
              );
            } catch (hashErr) {
              console.error('❌ Hash error:', hashErr.message);
              closeDb();
            }
          } else {
            if (row.count === 0) console.log('⚠ No admin user. Set ADMIN_USERNAME + ADMIN_PASSWORD or use /api/auth/init');
            closeDb();
          }

          function closeDb() {
            db.close((closeErr) => {
              if (releaseInitLock) releaseInitLock();
              if (closeErr) reject(closeErr);
              else resolve();
            });
          }
        });
      });
      } // end proceedAfterIntegrity
    });
  });
}

function sleep(ms) {
  return new Promise(resolve => setTimeout(resolve, ms));
}

function acquireInitLock() {
  const lockDir = `${dbPath}.init.lock`;
  const started = Date.now();

  return new Promise(async (resolve, reject) => {
    while (true) {
      try {
        fs.mkdirSync(lockDir);
        fs.writeFileSync(path.join(lockDir, 'owner'), `${process.pid}\n${new Date().toISOString()}\n`);
        return resolve(() => {
          try { fs.rmSync(lockDir, { recursive: true, force: true }); } catch {}
        });
      } catch (err) {
        if (!err || err.code !== 'EEXIST') {
          if (err) err.isInitLockError = true;
          return reject(err);
        }

        try {
          const stat = fs.statSync(lockDir);
          if (Date.now() - stat.mtimeMs > INIT_LOCK_STALE_MS) {
            console.warn('Stale database init lock removed: ' + lockDir);
            fs.rmSync(lockDir, { recursive: true, force: true });
            continue;
          }
        } catch {}

        if (Date.now() - started > INIT_LOCK_TIMEOUT_MS) {
          const timeout = new Error(`Timed out waiting for database init lock: ${lockDir}`);
          timeout.isInitLockError = true;
          return reject(timeout);
        }

        await sleep(250);
      }
    }
  });
}

function runDb(db, sql) {
  return new Promise((resolve, reject) => {
    db.run(sql, (err) => (err ? reject(err) : resolve()));
  });
}

async function configureStartupConnection(db) {
  // Queue these explicitly before any schema writes or integrity reads.
  await runDb(db, `PRAGMA busy_timeout = ${DB_BUSY_TIMEOUT_MS}`);
  await runDb(db, 'PRAGMA journal_mode = DELETE');
}

function isTransientIntegrityError(err) {
  if (!err) return false;
  if (TRANSIENT_INTEGRITY_CODES.has(err.code)) return true;
  return /SQLITE_BUSY|SQLITE_LOCKED|database is locked|database table is locked/i.test(String(err.message || ''));
}

// Führt PRAGMA integrity_check aus und lehnt ab, wenn die DB beschädigt ist.
// Gibt bei "ok" zurück; sonst Error mit den gemeldeten Problemzeilen.
function checkIntegrity(db) {
  return new Promise((resolve, reject) => {
    let attempt = 0;
    const runCheck = () => {
      db.all('PRAGMA integrity_check', (err, rows) => {
        if (err) {
          if (isTransientIntegrityError(err) && attempt < INTEGRITY_RETRIES) {
            attempt += 1;
            setTimeout(runCheck, 250 * attempt);
            return;
          }
          reject(err);
          return;
        }
        const lines = (rows || []).map(r => r && r.integrity_check).filter(Boolean);
        if (lines.length === 1 && lines[0] === 'ok') {
          console.log('✓ Database integrity check: ok');
          resolve();
        } else {
          reject(new Error('integrity_check: ' + (lines.join('; ') || 'unbekannter Fehler')));
        }
      });
    };
    runCheck();
  });
}

// Prüft, ob eine integrity_check-Meldung AUSSCHLIESSLICH die (wegwerfbare)
// sessions-Tabelle/ihren Autoindex betrifft. Konservativ: Sobald ein Schema-Index
// (idx_*) oder der Autoindex einer anderen Tabelle (users/plans/…) auftaucht,
// gilt die Korruption als NICHT sessions-isoliert → keine Auto-Heilung.
// Die abschließende Re-Prüfung nach dem DROP ist die eigentliche Sicherheitsnetz-Instanz.
function isSessionsOnlyCorruption(message) {
  const m = String(message || '').toLowerCase();
  if (!m.includes('sessions')) return false;
  // Ein benannter Schema-Index (idx_plans_user_id, idx_audit_log_*, …) → echte Tabelle betroffen.
  if (/\bidx_[a-z0-9_]+/.test(m)) return false;
  // Autoindizes anderer Tabellen als sessions?
  const autoIdxTables = [...m.matchAll(/sqlite_autoindex_([a-z0-9_]+?)_\d+/g)].map(x => x[1]);
  if (autoIdxTables.some(t => t !== 'sessions')) return false;
  return true;
}

// Versucht, eine auf die sessions-Tabelle beschränkte Beschädigung automatisch zu
// beheben: Tabelle droppen, DB kompaktieren (verwaiste Seiten freigeben) und erneut
// per integrity_check verifizieren. Gibt Promise<boolean> (true = geheilt) zurück.
// Per DB_NO_SESSION_AUTOHEAL=1 abschaltbar.
function healSessionCorruption(db, integErr) {
  return new Promise((resolve) => {
    if (process.env.DB_NO_SESSION_AUTOHEAL === '1') return resolve(false);
    if (!isSessionsOnlyCorruption(integErr && integErr.message)) return resolve(false);

    console.warn('⚠ DB-Beschädigung betrifft nur die (wegwerfbare) sessions-Tabelle – versuche Auto-Heilung…');
    db.run('DROP TABLE IF EXISTS sessions', (dropErr) => {
      if (dropErr) {
        console.error('   Auto-Heilung fehlgeschlagen (DROP sessions): ' + dropErr.message);
        return resolve(false);
      }
      // VACUUM gibt die durch den DROP freigewordenen (ggf. beschädigten) Seiten frei,
      // sonst kann integrity_check sie weiter über die Freelist melden. Best-effort.
      db.run('VACUUM', () => {
        checkIntegrity(db)
          .then(() => {
            console.log('✓ Auto-Heilung erfolgreich: beschädigte sessions-Tabelle entfernt.');
            console.log('  Sessions sind wegwerfbar – Nutzer/Pläne unberührt. Bitte erneut anmelden.');
            resolve(true);
          })
          .catch(() => resolve(false));
      });
    });
  });
}

// Main initialization
async function main() {
  try {
    validateEnv();
    await initDatabase();
    console.log('✓ Database initialization complete');
  } catch (error) {
    console.error('❌ Initialization failed:', error.message);
    process.exit(1);
  }
}

// Audit logging helper
function auditLog(db, userId, action, entityType = null, entityId = null, details = null, ipAddress = null) {
  const detailsStr = details ? JSON.stringify(details) : null;
  let attempt = 0;

  return new Promise((resolve, reject) => {
    const runInsert = () => {
      db.run(
        `INSERT INTO audit_log (user_id, action, entity_type, entity_id, details, ip_address)
         VALUES (?, ?, ?, ?, ?, ?)`,
        [userId, action, entityType, entityId, detailsStr, ipAddress],
        function(err) {
          if (err) {
            if (TRANSIENT_WRITE_CODES.has(err.code) && attempt < AUDIT_LOG_RETRIES) {
              attempt += 1;
              setTimeout(runInsert, 100 * attempt);
              return;
            }
            reject(err);
            return;
          }
          resolve({ id: this.lastID });
        }
      );
    };

    runInsert();
  });
}

// Plan retention cleanup helper – marks plans for deletion after N days of inactivity
function startPlanRetentionCleanup(db, retentionDays = 90) {
  if (!retentionDays || retentionDays <= 0) {
    console.log('ℹ Plan retention cleanup disabled (PLAN_RETENTION_DAYS not set or ≤0)');
    return;
  }

  console.log(`✓ Plan retention cleanup scheduled (${retentionDays} days)`);

  // Run cleanup every 24 hours (86400000 ms).
  // Guard gegen überlappende Läufe: sollte ein Durchlauf länger als das Intervall
  // dauern, würde ein zweiter parallel DELETEs absetzen und die DB sperren.
  let cleanupRunning = false;
  setInterval(async () => {
    if (cleanupRunning) {
      console.warn('⚠ Plan retention: vorheriger Lauf noch aktiv – überspringe diesen Zyklus');
      return;
    }
    cleanupRunning = true;
    try {
      const cutoffDate = new Date(Date.now() - retentionDays * 24 * 60 * 60 * 1000).toISOString();

      // Mark stale plans (not updated in retentionDays)
      const marked = await new Promise((resolve, reject) => {
        db.run(
          `UPDATE plans
           SET marked_for_deletion = 1, marked_for_deletion_at = CURRENT_TIMESTAMP
           WHERE marked_for_deletion = 0 AND updated_at < ?`,
          [cutoffDate],
          function(err) {
            if (err) reject(err);
            else {
              if (this.changes > 0) console.log(`✓ Plan retention: marked ${this.changes} stale plans for deletion`);
              resolve(this.changes);
            }
          }
        );
      });

      // Delete hard-marked plans (marked >7 days ago = grace period)
      const graceDate = new Date(Date.now() - 7 * 24 * 60 * 60 * 1000).toISOString();
      const deleted = await new Promise((resolve, reject) => {
        db.run(
          `DELETE FROM plans WHERE marked_for_deletion = 1 AND marked_for_deletion_at < ?`,
          [graceDate],
          function(err) {
            if (err) reject(err);
            else {
              if (this.changes > 0) console.log(`✓ Plan retention: permanently deleted ${this.changes} plans after grace period`);
              resolve(this.changes);
            }
          }
        );
      });

      // Audit-Log: System-Event für Compliance (user_id=NULL = System-Event).
      if (marked > 0 || deleted > 0) {
        await auditLog(db, null, 'plan_cleanup', 'plan', null, { marked, deleted }, null)
          .catch(err => console.error('❌ Plan retention audit log error:', err.message));
      }
    } catch (error) {
      console.error('❌ Plan retention cleanup error:', error.message);
    } finally {
      cleanupRunning = false;
    }
  }, 24 * 60 * 60 * 1000);
}

module.exports = { initDatabase, validateEnv, auditLog, startPlanRetentionCleanup, checkIntegrity, isTransientIntegrityError, isSessionsOnlyCorruption, healSessionCorruption };

// Run if called directly
if (require.main === module) {
  main();
}
