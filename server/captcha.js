// ============================================================
// Bot-Schutz: Google reCAPTCHA v3 (Server-side Token-Verifizierung)
// Aktiv nur wenn RECAPTCHA_SITE_KEY + RECAPTCHA_SECRET_KEY gesetzt sind
// (sonst no-op → Deployment ohne CAPTCHA, z.B. LAN/VPN, bleibt möglich).
// Fail-closed: ungültiges Token, zu niedriger Score oder Google nicht
// erreichbar → Anfrage wird abgelehnt.
// ============================================================

const VERIFY_URL = 'https://www.google.com/recaptcha/api/siteverify';

let _fetch = (...args) => fetch(...args); // injizierbar für Tests

function isCaptchaEnabled() {
  return !!(process.env.RECAPTCHA_SITE_KEY && process.env.RECAPTCHA_SECRET_KEY);
}

/**
 * Verifiziert ein reCAPTCHA-v3-Token. expectedAction (z.B. 'register')
 * muss mit der im Frontend bei grecaptcha.execute() gesetzten Action
 * übereinstimmen, sonst lässt sich ein Token zweckentfremden.
 * @returns {{ok: boolean, reason?: string, score?: number, skipped?: boolean}}
 */
async function verifyCaptcha(token, ip, expectedAction) {
  if (!isCaptchaEnabled()) return { ok: true, skipped: true };
  if (!token || typeof token !== 'string' || token.length > 5000) {
    return { ok: false, reason: 'missing-token' };
  }
  try {
    const params = new URLSearchParams({
      secret: process.env.RECAPTCHA_SECRET_KEY,
      response: token
    });
    if (ip) params.set('remoteip', ip);

    const res = await _fetch(VERIFY_URL, {
      method: 'POST',
      headers: { 'Content-Type': 'application/x-www-form-urlencoded' },
      body: params.toString(),
      signal: AbortSignal.timeout(5000)
    });
    const data = await res.json();

    if (!data.success) {
      return { ok: false, reason: (data['error-codes'] || []).join(',') || 'invalid' };
    }
    if (expectedAction && data.action && data.action !== expectedAction) {
      return { ok: false, reason: `action-mismatch:${data.action}` };
    }
    const minScore = parseFloat(process.env.RECAPTCHA_MIN_SCORE) || 0.5;
    if (typeof data.score === 'number' && data.score < minScore) {
      return { ok: false, reason: `low-score:${data.score}` };
    }
    return { ok: true, score: data.score };
  } catch (err) {
    console.error('reCAPTCHA verify failed:', err.message);
    return { ok: false, reason: 'verify-unreachable' };
  }
}

module.exports = { isCaptchaEnabled, verifyCaptcha, _setFetch: f => { _fetch = f; } };
