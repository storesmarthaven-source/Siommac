// ─── SIOMAC Service Worker ────────────────────────────────────────────────────
// Strategy overview:
//   STATIC  — local CSS/JS/HTML shell → Cache-first, long-lived, version-busted on deploy
//   CDN     — third-party libs/fonts  → Stale-while-revalidate, 7-day cache
//   PHOTOS  — profile images, selfies → Cache-first, 7-day cache, bg revalidate
//   API     — /api POST calls         → Network-only (never cache mutations/auth)

const CACHE_VERSION  = 'siomac-v2';
const STATIC_CACHE   = CACHE_VERSION + '-static';
const CDN_CACHE      = CACHE_VERSION + '-cdn';
const PHOTO_CACHE    = CACHE_VERSION + '-photos';

// Local static assets to precache on install
const PRECACHE_URLS = [
  '/',
  '/index.html',
  '/assets/partials/app-shell.html',
  '/assets/js/popup.js',
  '/assets/js/api.js',
  '/assets/js/config.js',
  '/assets/js/charts.js',
  '/assets/app.js',
  '/assets/styles/base.css',
  '/assets/styles/login.css',
  '/assets/styles/layout.css',
  '/assets/styles/views.css',
  '/assets/styles/components.css',
  '/assets/styles/live-map.css',
  '/assets/styles/preferences.css',
  '/assets/styles/payroll.css',
  '/assets/styles/tables.css',
  '/assets/styles/popup.css',
  '/assets/styles/print.css',
  '/assets/styles/loading.css',
  '/assets/styles/responsive.css',
];

// CDN hosts — stale-while-revalidate strategy
const CDN_HOSTS = [
  'cdnjs.cloudflare.com',
  'cdn.jsdelivr.net',
  'cdn.datatables.net',
  'unpkg.com',
  'fonts.googleapis.com',
  'fonts.gstatic.com',
];

// Photo hosts — cache-first with background revalidation
const PHOTO_HOSTS = [
  'drive.google.com',
  'lh3.googleusercontent.com',   // Google Drive direct image URLs
  'lh4.googleusercontent.com',
  'lh5.googleusercontent.com',
  'lh6.googleusercontent.com',
];

// Supabase storage bucket paths that serve images
const PHOTO_PATH_PATTERNS = [
  /\/storage\/v1\/object\/public\//,   // Supabase public storage
  /\/rest\/v1\/storage\//,
];

// ── Helpers ───────────────────────────────────────────────────────────────────

function isPhotoRequest(url) {
  if (PHOTO_HOSTS.some(h => url.hostname.includes(h))) return true;
  // Supabase project URL — image paths in storage bucket
  if (PHOTO_PATH_PATTERNS.some(p => p.test(url.pathname))) return true;
  // Any image extension from any host
  if (/\.(jpg|jpeg|png|gif|webp|avif|svg)(\?|$)/i.test(url.pathname)) return true;
  return false;
}

function isCdnRequest(url) {
  return CDN_HOSTS.some(h => url.hostname.includes(h));
}

function isApiRequest(url) {
  // Our own API endpoint + Netlify function
  return url.pathname === '/api' || url.pathname.startsWith('/.netlify/functions/');
}

function isLocalStatic(url, origin) {
  return url.origin === origin && !isApiRequest(url);
}

// ── Install — skip waiting immediately, no precache blocking install ──────────
self.addEventListener('install', event => {
  event.waitUntil(self.skipWaiting());
});

// ── Activate — delete stale caches from old versions ─────────────────────────
self.addEventListener('activate', event => {
  const KEEP = new Set([STATIC_CACHE, CDN_CACHE, PHOTO_CACHE]);
  event.waitUntil(
    caches.keys()
      .then(keys => Promise.all(
        keys.filter(k => !KEEP.has(k)).map(k => {
          console.log('[SW] Deleting old cache:', k);
          return caches.delete(k);
        })
      ))
      .then(() => self.clients.claim())   // take control of existing tabs immediately
  );
});

// ── Fetch — routing ───────────────────────────────────────────────────────────
self.addEventListener('fetch', event => {
  const req = event.request;
  const url = new URL(req.url);

  // Only handle GET (never intercept POST/mutation)
  if (req.method !== 'GET') return;

  // Never intercept API calls
  if (isApiRequest(url)) return;

  // Photos — cache-first, 7-day max-age, background revalidate
  if (isPhotoRequest(url)) {
    event.respondWith(cacheFirstWithRevalidate(req, PHOTO_CACHE, 7 * 24 * 60 * 60 * 1000));
    return;
  }

  // CDN — stale-while-revalidate with 7-day cache
  if (isCdnRequest(url)) {
    event.respondWith(staleWhileRevalidate(req, CDN_CACHE));
    return;
  }

  // Local static assets — network-first with cache fallback.
  // Tries network first so deploys take effect immediately; falls back to
  // cache only when offline. Updates cache on every successful network response.
  if (isLocalStatic(url, self.location.origin)) {
    event.respondWith(networkFirstLocal(req, STATIC_CACHE));
    return;
  }
});

// ── Strategies ────────────────────────────────────────────────────────────────

// Network-first: try network, update cache, fall back to cache when offline.
// This ensures every deploy is picked up immediately while still working offline.
async function networkFirstLocal(req, cacheName) {
  const cache = await caches.open(cacheName);
  try {
    const fresh = await fetch(req);
    if (fresh.ok) cache.put(req, fresh.clone());
    return fresh;
  } catch {
    // Offline — serve from cache
    const cached = await cache.match(req);
    return cached || new Response('Offline', { status: 503, statusText: 'Service Unavailable' });
  }
}

// Cache-first with max-age check + background revalidate (for photos)
async function cacheFirstWithRevalidate(req, cacheName, maxAge) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);

  if (cached) {
    const cachedDate = cached.headers.get('sw-cached-at');
    const age = cachedDate ? Date.now() - Number(cachedDate) : Infinity;

    if (age < maxAge) {
      // Still fresh — serve from cache, optionally revalidate in background
      if (age > maxAge * 0.75) {
        // Past 75% of TTL — silently refresh in background
        fetchAndStore(req, cache).catch(() => {});
      }
      return cached;
    }
    // Expired — fall through to network, but serve stale on failure
  }

  try {
    const fresh = await fetchAndStore(req, cache);
    return fresh;
  } catch {
    // Network failed — serve stale if we have it
    return cached || new Response('Photo unavailable', { status: 503 });
  }
}

// Stale-while-revalidate: serve cache instantly, always refresh in background
async function staleWhileRevalidate(req, cacheName) {
  const cache  = await caches.open(cacheName);
  const cached = await cache.match(req);
  // Always kick off a background refresh
  const fetchPromise = fetchAndStore(req, cache).catch(() => {});
  return cached || fetchPromise;
}

// Fetch a request and store it with a timestamp header
async function fetchAndStore(req, cache) {
  const response = await fetch(req);
  if (response.ok) {
    // Inject a timestamp so we can enforce max-age ourselves
    const headers = new Headers(response.headers);
    headers.set('sw-cached-at', String(Date.now()));
    const cloned = new Response(await response.clone().arrayBuffer(), {
      status:     response.status,
      statusText: response.statusText,
      headers,
    });
    cache.put(req, cloned);
  }
  return response;
}

// ── Cache management messages (from app) ──────────────────────────────────────
self.addEventListener('message', event => {
  const { type, payload } = event.data || {};

  switch (type) {
    // Clear just the photo cache (e.g. after profile image update)
    case 'CLEAR_PHOTO_CACHE':
      caches.delete(PHOTO_CACHE).then(() => {
        event.source && event.source.postMessage({ type: 'PHOTO_CACHE_CLEARED' });
      });
      break;

    // Full cache wipe — triggered by "Clear Cache" button in settings
    case 'CLEAR_ALL_CACHES':
      Promise.all([
        caches.delete(STATIC_CACHE),
        caches.delete(CDN_CACHE),
        caches.delete(PHOTO_CACHE),
      ]).then(() => {
        event.source && event.source.postMessage({ type: 'ALL_CACHES_CLEARED' });
      });
      break;

    // Evict a single URL from photo cache (after re-upload)
    case 'EVICT_PHOTO':
      if (payload && payload.url) {
        caches.open(PHOTO_CACHE).then(c => c.delete(payload.url));
      }
      break;

    // Return cache storage usage stats
    case 'GET_CACHE_STATS':
      Promise.all([
        cacheSize(STATIC_CACHE),
        cacheSize(CDN_CACHE),
        cacheSize(PHOTO_CACHE),
      ]).then(([staticSz, cdnSz, photoSz]) => {
        event.source && event.source.postMessage({
          type: 'CACHE_STATS',
          payload: { static: staticSz, cdn: cdnSz, photos: photoSz }
        });
      });
      break;
  }
});

async function cacheSize(name) {
  try {
    const cache = await caches.open(name);
    const keys  = await cache.keys();
    return keys.length;
  } catch {
    return 0;
  }
}
