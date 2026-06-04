# Cloudflare Worker Setup

## Übersicht

Der Wachplan-Generator wird als Cloudflare Worker deployed. Der Worker:
- Serviert statische Dateien aus `public/` über Cloudflare's Asset-System
- Proxied API-Anfragen (`/api/*`, `/ws`) zum Origin-Server
- Handhabt SPA-Routing mit HTML-Fallback

## Dateien

```
wrangler.toml           – Cloudflare Worker Konfiguration
src/worker.js           – Worker-Einstiegspunkt
```

## Konfiguration

### 1. `wrangler.toml` vorbereiten

Passe die folgenden Werte an:
```toml
account_id = "YOUR_ACCOUNT_ID"  # Finde deine Account ID auf https://dash.cloudflare.com

# Production Route (optional)
[env.production]
routes = [
  { pattern = "wachplan-generator.de/*", zone_name = "wachplan-generator.de" }
]

# KV Namespace IDs (für Plan-Speicherung, optional)
[[kv_namespaces]]
binding = "PLANS_KV"
id = "YOUR_KV_NAMESPACE_ID"
preview_id = "YOUR_PREVIEW_ID"
```

### 2. Origin-Server konfigurieren

In `src/worker.js`:
```javascript
const ORIGIN_SERVER = 'https://dein-server.com'; // Änere auf deinen Server
```

Der Worker proxied alle `/api/*` und `/ws` Anfragen zu diesem Server.

### 3. Secrets einrichten (falls benötigt)

```bash
wrangler secret put API_KEY
wrangler secret put DATABASE_URL
```

## Deploy

### Lokal testen
```bash
npm install -D wrangler
wrangler dev
```

### Zu Cloudflare deployen
```bash
npm run deploy          # Production
npm run deploy:dev      # Development
```

Oder direkt:
```bash
npx wrangler deploy --env production
```

## Architektur

```
Browser
  ↓
Cloudflare Worker (statische Dateien + API-Proxy)
  ├→ /public/* → Cloudflare Assets (static files)
  ├→ /api/*   → proxied zu Origin Server
  └→ /ws      → WebSocket proxied zu Origin Server
  ↓
Origin Server (Node.js Express)
  ├→ /api/* (REST-Endpoints)
  ├→ /ws (WebSocket für Live-Updates)
  └→ SQLite DB
```

## Debugging

### Logs anschauen
```bash
wrangler tail --env production
```

### Build-Fehler beheben
Falls `wrangler deploy` fehlschlägt:

1. **"Could not detect static files"** → Stelle sicher, dass `public/` existiert und `wrangler.toml` die richtige `[assets]` Section hat
2. **Account ID fehlt** → `wrangler login` ausführen und Account ID in `wrangler.toml` eintragen
3. **KV/Secret Fehler** → Ist optional; falls nicht gewünscht, kommentiere die KV-Sektion aus

## Performance-Tipps

1. **Caching:** Der Worker cached statische Dateien automatisch über Cloudflare's Edge
2. **Gzip-Kompression:** Cloudflare komprimiert automatisch
3. **API-Timeout:** Der Worker hat einen Standard-Timeout von 30s für API-Anfragen

## Kosten

- **Free Tier:** 100,000 requests/Tag
- **Paid:** $5/Monat für bis zu 50 Millionen requests

Siehe [Cloudflare Pricing](https://workers.cloudflare.com/pricing/).

---

**Weitere Ressourcen:**
- [Wrangler CLI Documentation](https://developers.cloudflare.com/workers/wrangler/)
- [Cloudflare Workers Docs](https://developers.cloudflare.com/workers/)
- [Assets Configuration](https://developers.cloudflare.com/workers/static-assets/)
