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

function notFoundHandler(service) {
  return (req, res) => {
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
  notFoundHandler,
  jsonErrorHandler,
  installSigtermHandler,
  installFatalHandlers,
};
