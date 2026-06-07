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

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_user ON plan_shares(user_id);
CREATE INDEX IF NOT EXISTS idx_plan_shares_plan ON plan_shares(plan_id);
