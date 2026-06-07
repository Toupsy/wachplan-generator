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
  marked_for_deletion BOOLEAN DEFAULT 0, -- Plan ist markiert zur Löschung (Plan Retention)
  marked_for_deletion_at DATETIME,       -- Zeitstempel der Markierung
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE CASCADE
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

-- Audit Log (DSGVO Art. 5 Abs. 1 f – Accountability, Art. 32 – Sicherheit)
CREATE TABLE IF NOT EXISTS audit_log (
  id INTEGER PRIMARY KEY AUTOINCREMENT,
  user_id INTEGER,                          -- NULL für System-Events (z.B. Cleanup)
  action TEXT NOT NULL,                     -- 'login', 'logout', 'plan_create', 'plan_update', 'plan_delete', 'plan_share', 'plan_share_revoke', 'plan_import', 'admin_user_create', 'admin_user_delete', 'admin_password_reset', 'plan_cleanup'
  entity_type TEXT,                         -- 'user', 'plan', 'plan_share', null für Login/Logout
  entity_id INTEGER,                        -- user_id oder plan_id, null wenn nicht relevant
  details TEXT,                             -- JSON-String mit zusätzlichen Infos (z.B. old_name, new_name, share_role, etc.)
  ip_address TEXT,                          -- Client-IP (aus X-Forwarded-For oder req.ip)
  timestamp DATETIME DEFAULT CURRENT_TIMESTAMP,
  FOREIGN KEY (user_id) REFERENCES users(id) ON DELETE SET NULL
);

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_user ON plan_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_plan ON plan_shares(plan_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_user ON audit_log(user_id);
CREATE INDEX IF NOT EXISTS idx_audit_log_action ON audit_log(action);
CREATE INDEX IF NOT EXISTS idx_audit_log_timestamp ON audit_log(timestamp);
