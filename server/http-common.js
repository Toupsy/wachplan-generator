const net = require('node:net');

// Komprimiert eine IPv6-Adresse in ihre Kurzform (RFC 5952): führende Nullen weg,
// längster Null-Block als "::" (z. B. 2001:0db8:0000:…:0001 → 2001:db8::1).
// Nutzt den WHATWG-URL-Parser, der IPv6 kanonisch normalisiert. IPv4 und ungültige
// Eingaben bleiben unverändert.
function compressIpv6(ip) {
  if (!ip || net.isIPv6(ip) !== true) return ip;
  try {
    const host = new URL(`http://[${ip}]`).hostname; // → "[2001:db8::1]"
    return host.startsWith('[') ? host.slice(1, -1) : host;
  } catch {
    return ip;
  }
}

function securityHeaders({ captcha = false, worker = false } = {}) {
  const scriptExtra = captcha ? ' https://www.google.com https://www.gstatic.com' : '';
  const frameSrc = captcha ? 'frame-src https://www.google.com; ' : '';
  const workerSrc = worker ? "worker-src 'self' blob: https://cdnjs.cloudflare.com; " : '';
  return (req, res, next) => {
    res.setHeader('X-Content-Type-Options', 'nosniff');
    res.setHeader('X-Frame-Options', 'SAMEORIGIN');
    res.setHeader('Referrer-Policy', 'same-origin');
    res.setHeader('Content-Security-Policy',
      "default-src 'self'; img-src 'self' data:; style-src 'self' 'unsafe-inline' https://fonts.googleapis.com; " +
      "font-src 'self' https://fonts.gstatic.com; script-src 'self' 'unsafe-inline' https://cdnjs.cloudflare.com" +
      scriptExtra + "; " + workerSrc + "connect-src 'self' ws: wss:; " + frameSrc + "frame-ancestors 'self'");
    if (process.env.NODE_ENV === 'production')
      res.setHeader('Strict-Transport-Security', 'max-age=31536000; includeSubDomains');
    next();
  };
}

// Wert für `app.set('trust proxy', …)` aus der Umgebung (TRUST_PROXY).
// Default 1 = ein vertrauenswürdiger Proxy-Hop (z. B. NGINX). Hinter mehreren
// Hops (z. B. Cloudflare → NGINX) auf die Hop-Anzahl erhöhen, sonst landet die
// Proxy-IP statt der echten Client-IP in req.ip / im Audit-Log.
// Akzeptiert eine Zahl ("2") oder einen booleschen Wert ("true"/"false").
function trustProxyValue() {
  const raw = process.env.TRUST_PROXY;
  if (raw === undefined || raw === '') return 1;
  const s = String(raw).trim().toLowerCase();
  if (s === 'true') return true;
  if (s === 'false') return false;
  const n = parseInt(s, 10);
  return Number.isFinite(n) && n >= 0 ? n : 1;
}

// Ermittelt die echte Client-IP aus den Proxy-Headern – OHNE Reverse-Proxy-Umbau.
// Reihenfolge: Cloudflare (CF-Connecting-IP) → X-Real-IP → erstes X-Forwarded-For.
// Gibt '' zurück, wenn keiner gesetzt ist (dann gilt weiter Express' req.ip).
// ACHTUNG (Sicherheit): Diese Header sind vom Client fälschbar, falls der Origin
// direkt – an Cloudflare/NGINX vorbei – erreichbar ist. Für eine fälschungssichere
// Ermittlung s. docs/nginx.cloudflare.conf.example (Variante A, proxy-seitig).
function clientIpFromHeaders(req) {
  const pick = (v) => {
    if (!v) return '';
    // X-Forwarded-For kann eine Liste sein – die linkeste Adresse ist der Client.
    const first = String(v).split(',')[0].trim().replace(/^::ffff:/i, '');
    // IPv6 in Kurzform speichern (req.ip → Audit-Log/Rate-Limit konsistent kanonisch).
    return compressIpv6(first);
  };
  return pick(req.headers['cf-connecting-ip'])
      || pick(req.headers['x-real-ip'])
      || pick(req.headers['x-forwarded-for'])
      || '';
}

// Middleware: überschreibt `req.ip` mit der aus den Proxy-Headern ermittelten
// echten Client-IP. Dadurch sehen Audit-Log UND Rate-Limiting (beide lesen
// req.ip) die echte IP, ohne dass NGINX/Cloudflare angepasst werden müssen.
// Ohne passende Header bleibt Express' ursprüngliches req.ip (trust proxy)
// erhalten → lokale Entwicklung/Tests unverändert.
function overrideClientIp() {
  return (req, res, next) => {
    const ip = clientIpFromHeaders(req);
    if (ip) {
      // req.ip ist ein Getter auf dem Request-Prototyp; eine eigene
      // Daten-Property auf der Instanz überschattet ihn.
      try {
        Object.defineProperty(req, 'ip', { value: ip, configurable: true, enumerable: true });
      } catch { /* req.ip nicht überschreibbar → Express-Wert behalten */ }
    }
    next();
  };
}

function notFoundHandler(service) {
  return (req, res) => {
    // Schutz wie im jsonErrorHandler: serve-static reicht abgebrochene/teilweise
    // gesendete Antworten (Client-Disconnect, Range-/404-Fälle) an die nächste
    // Middleware weiter. Sind die Header schon raus, würde res.status().json()
    // mit ERR_HTTP_HEADERS_SENT scheitern – also nichts mehr senden.
    if (res.headersSent) return;
    const body = { error: 'Not found', path: req.url };
    if (service) body.service = service;
    res.status(404).json(body);
  };
}

function jsonErrorHandler() {
  return (err, req, res, next) => {
    console.error('Error:', err);
    if (res.headersSent) return next(err);
    res.status(500).json({ error: 'Internal server error' });
  };
}

function installSigtermHandler(server, label) {
  process.on('SIGTERM', () => {
    console.log('SIGTERM empfangen, fahre herunter...');
    server.close(() => {
      console.log(`${label} wurde beendet`);
      process.exit(0);
    });
  });
}

function installFatalHandlers() {
  process.on('uncaughtException', (err) => {
    console.error('❌ Uncaught Exception:', err);
    if (err.message && err.message.includes('database')) {
      console.error('⚠️  Database error - exiting');
      process.exit(1);
    }
  });

  process.on('unhandledRejection', (reason) => {
    console.error('❌ Unhandled Rejection:', reason);
    if (reason && reason.message && reason.message.includes('database')) {
      console.error('⚠️  Database error - exiting');
      process.exit(1);
    }
  });
}

module.exports = {
  securityHeaders,
  trustProxyValue,
  compressIpv6,
  clientIpFromHeaders,
  overrideClientIp,
  notFoundHandler,
  jsonErrorHandler,
  installSigtermHandler,
  installFatalHandlers,
};
