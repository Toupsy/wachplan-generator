-- ============================================================
-- DLRG Wachplan-Generator Database Schema
-- SQLite 3
-- ============================================================

-- Users Table (Authentifizierung)
CREATE TABLE IF NOT EXISTS users (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  username TEXT UNIQUE NOT NULL,
  password_hash TEXT NOT NULL,
  email TEXT,
  is_admin BOOLEAN DEFAULT 0,
  last_login DATETIME,                       -- Letzter erfolgreicher Login (UTC), NULL = noch nie
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP
);

-- Plans Table (Verschlüsselte Wachpläne)
CREATE TABLE IF NOT EXISTS plans (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER NOT NULL,
  name TEXT DEFAULT 'Wachplan',
  encrypted_state BLOB NOT NULL,        -- AES-256-GCM encrypted state.js-JSON
  iv BLOB NOT NULL,                      -- Initialization Vector (16 bytes)
  auth_tag BLOB NOT NULL,                -- Authentication Tag (16 bytes)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  updated_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Sessions Table (express-session mit connect-sqlite3)
CREATE TABLE IF NOT EXISTS sessions (
  sid TEXT PRIMARY KEY,
  session TEXT NOT NULL,
  expiryDate DATETIME
);

-- Plan-Freigaben (Mitbearbeiter eines Plans). Zugriff = Owner ODER Eintrag hier.
-- Verschlüsselung bleibt mit dem Owner-Key (server-seitig aus plans.user_id ableitbar),
-- daher kein Re-Encrypt beim Teilen nötig.
CREATE TABLE IF NOT EXISTS plan_shares (
  plan_id INTEGER NOT NULL,
  user_id INTEGER NOT NULL,
  role TEXT NOT NULL DEFAULT 'edit',     -- 'edit' | 'view' (nur ansehen)
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  PRIMARY KEY (plan_id, user_id),
  FOREIGN KEY (plan_id) REFERENCES plans(id) ON DELETE CASCADE,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
);

-- Audit-Log für Admin-Aktionen (Art. 5 Abs. 2 – Rechenschaftspflicht)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  actor_user_id INTEGER,                 -- Admin der Aktion durchgeführt hat (NULL = System)
  action TEXT NOT NULL,                  -- z.B. 'user.create', 'user.delete', 'user.setpw', 'user.export', 'plans.purge'
  target TEXT,                           -- betroffene User/Plan (z.B. 'user:5' oder 'plan:123')
  created_at DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (actor_user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_user ON plan_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_plan ON plan_shares(plan_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_created ON audit_log(created_at DESC);
CREATE INDEX IF NOT EXISTS idx_audit_log_actor ON audit_log(actor_user_id);
