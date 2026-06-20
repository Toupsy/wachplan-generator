// ============================================================
// GeoIP-Lookup für das Audit-Log (Offline, geoip-lite)
// ------------------------------------------------------------
// Ermittelt aus einer Client-IP einen groben Standort (Stadt/Land)
// rein lokal über die mitgelieferte MaxMind-GeoLite-DB – KEIN externer
// Aufruf, kein ausgehender Netzverkehr (DSGVO-konform im Audit-Kontext).
//
// `geoip-lite` ist optional: Ist das Paket (oder seine DB) nicht
// installiert, liefert lookupLocation() schlicht null statt zu crashen –
// der Audit-Log funktioniert dann wie bisher ohne Standortspalte.
// (DB-Update beim Maintainer: `node node_modules/geoip-lite/scripts/updatedb.js`.)
// ============================================================

let geoip = null;
try {
  // Lazy/optional: fehlendes Paket darf den Server nicht killen.
  geoip = require('geoip-lite');
} catch (e) {
  console.warn('geoip-lite nicht verfügbar – Audit-Log ohne Standort:', e.message);
}

// ISO-3166-Alpha-2 → deutscher Ländername (nur die häufigsten; Fallback = Code).
const COUNTRY_NAMES = {
  DE: 'Deutschland', AT: 'Österreich', CH: 'Schweiz', NL: 'Niederlande',
  FR: 'Frankreich', BE: 'Belgien', LU: 'Luxemburg', DK: 'Dänemark',
  PL: 'Polen', CZ: 'Tschechien', IT: 'Italien', ES: 'Spanien',
  GB: 'Großbritannien', US: 'USA', SE: 'Schweden', NO: 'Norwegen',
};

/**
 * Normalisiert eine IP-Adresse: entfernt das IPv6-Mapped-Präfix (::ffff:1.2.3.4)
 * und trimmt. Gibt '' bei leerer Eingabe.
 */
function normalizeIp(ip) {
  if (!ip) return '';
  let s = String(ip).trim();
  const m = s.match(/^::ffff:(\d+\.\d+\.\d+\.\d+)$/i);
  if (m) s = m[1];
  return s;
}

/**
 * True für private/interne/Loopback-IPs (RFC 1918, CGNAT, Link-Local, ULA, ::1).
 * Solche Adressen haben keinen sinnvollen Geo-Standort.
 */
function isPrivateIp(ip) {
  const s = normalizeIp(ip);
  if (!s) return true;
  if (s === '127.0.0.1' || s === '::1' || s === 'localhost') return true;
  // IPv4-Privatbereiche + CGNAT (100.64/10) + Link-Local (169.254/16)
  if (/^10\./.test(s)) return true;
  if (/^192\.168\./.test(s)) return true;
  if (/^172\.(1[6-9]|2\d|3[0-1])\./.test(s)) return true;        // 172.16–172.31
  if (/^100\.(6[4-9]|[7-9]\d|1[0-1]\d|12[0-7])\./.test(s)) return true; // 100.64–100.127
  if (/^169\.254\./.test(s)) return true;
  // IPv6 ULA (fc00::/7) + Link-Local (fe80::/10)
  if (/^f[cd]/i.test(s)) return true;
  if (/^fe[89ab]/i.test(s)) return true;
  return false;
}

/**
 * Ermittelt einen lesbaren Standort-String aus einer IP, z.B. "Hamburg, Deutschland"
 * oder "Deutschland". Gibt null zurück, wenn:
 *   - geoip-lite nicht verfügbar ist,
 *   - die IP privat/intern ist (z.B. NGINX-Container-IP), oder
 *   - kein Treffer in der DB existiert.
 */
function lookupLocation(ip) {
  if (!geoip) return null;
  const s = normalizeIp(ip);
  if (!s || isPrivateIp(s)) return null;
  let geo;
  try {
    geo = geoip.lookup(s);
  } catch {
    return null;
  }
  if (!geo || !geo.country) return null;
  const country = COUNTRY_NAMES[geo.country] || geo.country;
  return geo.city ? `${geo.city}, ${country}` : country;
}

module.exports = { lookupLocation, isPrivateIp, normalizeIp };
