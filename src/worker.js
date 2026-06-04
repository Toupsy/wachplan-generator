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

    // API requests: proxy to origin server (with config fallback for preview)
    if (pathname.startsWith('/api/')) {
      // Special handling for /api/config in preview mode
      if (pathname === '/api/config' && isPreviewEnvironment(url.hostname)) {
        return new Response(JSON.stringify(getPreviewConfig()), {
          status: 200,
          headers: { 'Content-Type': 'application/json' }
        });
      }
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
 * Determine if this is a preview environment based on hostname
 */
function isPreviewEnvironment(hostname) {
  return hostname.includes('preview') ||
         hostname.includes('pr-') ||
         /^[a-f0-9]{8}-/.test(hostname);
}

/**
 * Get default preview configuration (fallback for /api/config)
 */
function getPreviewConfig() {
  return {
    template: {
      towers: [
        { name: "9/12", prio: 1, slotCount: 2 },
        { name: "9/13", prio: 2, slotCount: 2 },
        { name: "9/14", prio: 3, slotCount: 2 },
        { name: "9/15", prio: 4, slotCount: 2 },
        { name: "9/16", prio: 5, slotCount: 2 },
        { name: "9/17", prio: 6, slotCount: 2 },
        { name: "9/18", prio: 7, slotCount: 2 }
      ],
      boats: [
        { name: "Boot 78/1", towerName: "9/12", code: "78/1", prio: 1, slotCount: 1 },
        { name: "Boot 78/2", towerName: "9/14", code: "78/2", prio: 2, slotCount: 1 },
        { name: "Boot 78/3", towerName: "9/17", code: "78/3", prio: 3, slotCount: 1 }
      ],
      exportColumns: [
        "78/1", "9/12", "9/13", "", "WF", "HW", "",
        "78/2", "9/14", "9/15", "9/16", "78/3", "9/17", "9/18"
      ]
    },
    positions: {
      "3": "Wachführer",
      "4": "Bootsführer",
      "5": "Sanitäter",
      "6": "Beobachter",
      "7": "Verwalter"
    },
    ui: {
      maxPeople: 28,
      maxDays: 14,
      maxTowerSlots: 10,
      maxBoatSlots: 3
    }
  };
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
