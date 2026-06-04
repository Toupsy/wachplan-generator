/**
 * DLRG Wachplan-Generator Cloudflare Worker
 *
 * Handles:
 * 1. Static file serving from public/ directory
 * 2. API proxy to origin server (for /api/*)
 * 3. HTML fallback for SPA (single-page-application)
 */

const ORIGIN_SERVER = 'https://wachplan-generator.de'; // Change to your actual origin

export default {
  async fetch(request, env, ctx) {
    const url = new URL(request.url);
    const pathname = url.pathname;

    // API requests: proxy to origin server
    if (pathname.startsWith('/api/')) {
      return proxyToOrigin(request, url);
    }

    // WebSocket requests: proxy to origin
    if (pathname === '/ws') {
      return proxyToOrigin(request, url);
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
        const environmentScript = `<script>window.WORKER_ENVIRONMENT = '${env.ENVIRONMENT || 'production'}';</script>`;
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
 * Proxy request to origin server
 */
function proxyToOrigin(request, url) {
  const originUrl = new URL(url.pathname + url.search, ORIGIN_SERVER);

  return fetch(new Request(originUrl, {
    method: request.method,
    headers: request.headers,
    body: request.method !== 'GET' ? request.body : undefined,
  }));
}
