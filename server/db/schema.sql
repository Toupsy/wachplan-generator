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

-- Indices für Performance
CREATE INDEX IF NOT EXISTS idx_plans_user_id ON plans(user_id);
