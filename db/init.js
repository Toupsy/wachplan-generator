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
  : path.join(__dirname, '..', 'data');

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

  console.log('✓ Environment variables validated');
}

// Initialize database
function initDatabase() {
  return new Promise((resolve, reject) => {
    const db = new sqlite3.Database(dbPath, (err) => {
      if (err) {
        console.error('❌ Failed to open database:', err);
        reject(err);
        return;
      }

      console.log('✓ Database connection established:', dbPath);

      // Read and execute schema
      const schemaPath = path.join(__dirname, 'schema.sql');
      const schema = fs.readFileSync(schemaPath, 'utf-8');

      // Split by semicolon and execute each statement
      db.exec(schema, (err) => {
        if (err) {
          console.error('❌ Failed to execute schema:', err);
          reject(err);
          return;
        }

        console.log('✓ Database schema initialized');

        // Auto-create admin if ADMIN_USERNAME + ADMIN_PASSWORD are set
        db.get("SELECT COUNT(*) as count FROM users WHERE is_admin = 1", async (err, row) => {
          if (err) { reject(err); return; }

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
              if (closeErr) reject(closeErr);
              else resolve();
            });
          }
        });
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

module.exports = { initDatabase, validateEnv };

// Run if called directly
if (require.main === module) {
  main();
}
