/**
 * DLRG Wachplan-Generator Cloudflare Worker
 *
 * Handles:
 * 1. Static file serving from public/ directory
 * 2. API proxy to origin server (for /api/*)
 * 3. HTML fallback for SPA (single-page-application)
 */

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // Determine origin server based on environment
    const originServer = getOriginServer(url, env);

    // API requests: proxy to origin server
    if (pathname.startsWith('/api/')) {
      if (!originServer) {
        // Preview environment with no backend: return mock 404 for API
        return new Response(JSON.stringify({ error: 'API not available in preview' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return proxyToOrigin(request, url, originServer);
    }

    // WebSocket requests: proxy to origin
    if (pathname === '/ws') {
      if (!originServer) {
        return new Response(JSON.stringify({ error: 'WebSocket not available in preview' }), {
          status: 404,
          headers: { 'Content-Type': 'application/json' },
        });
      }
      return proxyToOrigin(request, url, originServer);
    }

    // Static assets: serve from Cloudflare Assets
    // This includes /public/*, /js/*, /css/*, etc.
    if (shouldServeAsset(pathname)) {
      const assetResponse = await env.ASSETS.fetch(request);
      if (assetResponse.status === 200) {
        return assetResponse;
      }
    }

    // HTML files and SPA fallback
    // Serve index.html for root and unknown paths (SPA routing)
    if (
      pathname === '/' ||
      pathname === '/Wachplan-Generator.html' ||
      !pathname.includes('.')
    ) {
      const indexResponse = await env.ASSETS.fetch(
        new Request(new URL('/Wachplan-Generator.html', request.url))
      );
      if (indexResponse.status === 200) {
        // Inject environment variable into HTML
        const html = await indexResponse.text();

        // Detect if this is a preview URL (contains 'preview' or 'pr-' or commit hash in subdomain)
        const hostname = url.hostname;
        let environment = env.ENVIRONMENT || 'production';

        // If subdomain contains preview/pr-, or commit hash pattern, use preview environment
        if (hostname.includes('preview') || hostname.includes('pr-') || /^[a-f0-9]{8}-/.test(hostname)) {
          environment = 'preview';
        }

        const environmentScript = `<script>window.WORKER_ENVIRONMENT = '${environment}';</script>`;
        const modifiedHtml = html.replace('</head>', `${environmentScript}</head>`);

        return new Response(modifiedHtml, {
          status: indexResponse.status,
          headers: new Headers(indexResponse.headers),
          statusText: indexResponse.statusText,
        });
      }
    }

    // 404 fallback
    return new Response('Not Found', { status: 404 });
  },
};

/**
 * Determine if a path should be served as a static asset
 */
function shouldServeAsset(pathname) {
  const assetExtensions = [
    '.html', '.css', '.js', '.json',
    '.png', '.jpg', '.jpeg', '.gif', '.svg', '.webp', '.ico',
    '.woff', '.woff2', '.ttf', '.eot',
    '.xlsx', '.pdf'
  ];

  return assetExtensions.some(ext => pathname.endsWith(ext));
}

/**
 * Determine origin server URL based on environment
 * Returns null for preview environment (no backend)
 */
function getOriginServer(url, env) {
  const hostname = url.hostname;
  const environment = env.ENVIRONMENT || 'production';

  // Preview environment: no backend (uses localStorage/offline mode)
  if (environment === 'preview' || hostname.includes('preview') || hostname.includes('pr-')) {
    return null;
  }

  // Development: localhost backend
  if (environment === 'development') {
    return env.DEV_ORIGIN_SERVER || 'http://localhost:3000';
  }

  // Production: use configured origin server
  return env.ORIGIN_SERVER || 'https://wachplan-generator.de';
}

/**
 * Proxy request to origin server
 */
function proxyToOrigin(request, url, originServer) {
  const originUrl = new URL(url.pathname + url.search, originServer);

  return fetch(new Request(originUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' ? request.body : undefined,
  }));
}
