/**
 * Express.js Server für DLRG Wachplan-Generator
 * Hostet die SPA mit Docker-Support (Umgebungsvariablen, Health-Checks)
 */

const express = require('express');
const path = require('path');

const app = express();
const PORT = process.env.PORT || 3000;
const HOST = process.env.HOST || '0.0.0.0';

// ── Statische Dateien ──────────────────────────────────────────
app.use(express.static(path.join(__dirname, '.')));
app.use(express.json());

// ── Health-Check (für Docker/K8s) ──────────────────────────────
app.get('/health', (req, res) => {
  res.json({ status: 'ok', timestamp: new Date().toISOString() });
});

// ── SPA-Route: Immer index/main servieren ──────────────────────
app.get('/', (req, res) => {
  res.sendFile(path.join(__dirname, 'Wachplan-Generator.html'));
});

// ── 404 Handler ────────────────────────────────────────────────
app.use((req, res) => {
  res.status(404).json({ error: 'Not found', path: req.url });
});

// ── Error Handler ──────────────────────────────────────────────
app.use((err, req, res, next) => {
  console.error('Error:', err);
  res.status(500).json({ error: 'Internal server error' });
});

// ── Server starten ────────────────────────────────────────────
const server = app.listen(PORT, HOST, () => {
  console.log(`🚀 DLRG Wachplan-Generator läuft`);
  console.log(`   URL: http://${HOST === '0.0.0.0' ? 'localhost' : HOST}:${PORT}`);
  console.log(`   Statische Dateien: ${path.join(__dirname, '.')}`);
});

// Graceful shutdown
process.on('SIGTERM', () => {
  console.log('SIGTERM empfangen, fahre herunter...');
  server.close(() => {
    console.log('Server wurde beendet');
    process.exit(0);
  });
});
