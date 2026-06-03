// ============================================================
// Plan-Verschlüsselung (AES-256-GCM, pro-User abgeleiteter Key)
// Zentral statt dupliziert in api/plans.js + api/import.js
// ============================================================

const crypto = require('crypto');

// Cache für abgeleitete Keys: PBKDF2 (100k Iterationen) ist teuer, der Key ist
// aber pro userId deterministisch (userId + MASTER_SECRET, SALT konstant).
// autoSave läuft nach JEDEM generate() → ohne Cache würde jeder Save/Load erneut
// 100k Iterationen rechnen. Sicherheitlich unkritisch: MASTER_SECRET/SALT liegen
// ohnehin im Prozessspeicher (env), der Key ist daraus ableitbar.
// Max ~1 Key (32 B) pro User → vernachlässigbarer Speicher, keine Eviction nötig.
const _keyCache = new Map();

function deriveKey(userId) {
  const cacheKey = String(userId);
  let key = _keyCache.get(cacheKey);
  if (!key) {
    key = crypto.pbkdf2Sync(
      userId + process.env.MASTER_SECRET,
      process.env.SALT,
      100000,
      32,
      'sha256'
    );
    _keyCache.set(cacheKey, key);
  }
  return key;
}

function encryptPlanState(plainJSON, userId) {
  const key = deriveKey(userId);
  const iv = crypto.randomBytes(16);
  const cipher = crypto.createCipheriv('aes-256-gcm', key, iv);

  const encrypted = Buffer.concat([
    cipher.update(plainJSON, 'utf8'),
    cipher.final()
  ]);

  return {
    encrypted,
    iv,
    authTag: cipher.getAuthTag()
  };
}

function decryptPlanState(encrypted, iv, authTag, userId) {
  const key = deriveKey(userId);
  const decipher = crypto.createDecipheriv('aes-256-gcm', key, iv);
  decipher.setAuthTag(authTag);

  return decipher.update(encrypted) + decipher.final('utf8');
}

module.exports = { deriveKey, encryptPlanState, decryptPlanState };
