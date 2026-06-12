// ============================================================
// E-Mail-Versand (nodemailer) – E-Mail-Verifizierung & Passwort-Reset
// Konfiguration via SMTP_* in .env; ohne SMTP_HOST ist der Versand
// deaktiviert (→ Registrierung ohne Verifizierung, kein Passwort-Reset).
// MAIL_TRANSPORT=outbox: Mails landen in-memory in _outbox (Tests).
// ============================================================

const nodemailer = require('nodemailer');

let _transport = null;
const _outbox = []; // nur bei MAIL_TRANSPORT=outbox befüllt (Tests)

function isMailEnabled() {
  return process.env.MAIL_TRANSPORT === 'outbox' || !!process.env.SMTP_HOST;
}

function _getTransport() {
  if (!_transport) {
    _transport = nodemailer.createTransport({
      host: process.env.SMTP_HOST,
      port: parseInt(process.env.SMTP_PORT, 10) || 587,
      secure: process.env.SMTP_SECURE === 'true', // true = SMTPS (Port 465), sonst STARTTLS
      auth: process.env.SMTP_USER
        ? { user: process.env.SMTP_USER, pass: process.env.SMTP_PASS }
        : undefined
    });
  }
  return _transport;
}

// Basis-URL für Links in Mails (Verifizierung/Reset). Ohne APP_BASE_URL
// funktionieren die Links nur lokal → in Produktion setzen!
function baseUrl() {
  return (process.env.APP_BASE_URL || `http://localhost:${process.env.PORT || 3000}`)
    .replace(/\/+$/, '');
}

async function sendMail({ to, subject, text }) {
  if (!isMailEnabled()) {
    throw new Error('Mail-Versand nicht konfiguriert (SMTP_HOST fehlt)');
  }
  if (process.env.MAIL_TRANSPORT === 'outbox') {
    _outbox.push({ to, subject, text });
    return true;
  }
  const from = process.env.MAIL_FROM || process.env.SMTP_USER;
  await _getTransport().sendMail({ from, to, subject, text });
  return true;
}

module.exports = { isMailEnabled, sendMail, baseUrl, _outbox };
