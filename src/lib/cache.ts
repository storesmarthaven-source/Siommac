/**
 * src/lib/cache.ts
 *
 * Persistent cache layer — ported from assets/js/cache.js.
 *
 * Two components:
 *   SiomacDB       — IndexedDB wrapper that persists SWR API responses across
 *                    page reloads, so navigating back to a section is instant.
 *   SwCacheManager — registers the Service Worker and exposes helpers for
 *                    the rest of the app (photo eviction, cache stats, full clear).
 *
 * Also monkey-patches the legacy `swr` global (defined by api.js) to write
 * through to IndexedDB on every cache set.
 *
 * Must be imported before api.js executes so the SWR patch is ready;
 * main.tsx imports this module at the top of the script chain.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

// ── 1. IndexedDB — persistent SWR store ──────────────────────────────────────

const DB_NAME    = 'siomac_cache';
const DB_VERSION = 1;
const STORE      = 'swr';

/** Actions whose responses should never be persisted. */
const SKIP_PERSIST = /^(login|logout|ping|getSettings|markAttendance)/i;

/** Max age before an entry is considered cold (still served, SWR revalidates). */
const COLD_AGE = 5 * 60 * 1000; // 5 minutes

let _db: IDBDatabase | null = null;

function _openDB(): Promise<IDBDatabase | null> {
  if (_db) return Promise.resolve(_db);
  return new Promise(resolve => {
    const req = indexedDB.open(DB_NAME, DB_VERSION);
    req.onupgradeneeded = (e) => {
      const db = (e.target as IDBOpenDBRequest).result;
      if (!db.objectStoreNames.contains(STORE)) {
        const store = db.createObjectStore(STORE, { keyPath: 'key' });
        store.createIndex('ts', 'ts', { unique: false });
      }
    };
    req.onsuccess = (e) => { _db = (e.target as IDBOpenDBRequest).result; resolve(_db); };
    req.onerror   = (e) => {
      console.warn('[SiomacDB] open error', (e.target as IDBOpenDBRequest).error);
      resolve(null); // degrade gracefully
    };
  });
}

export const SiomacDB = {
  /** Write a key/data pair with current timestamp. */
  async set(key: string, data: unknown): Promise<void> {
    if (SKIP_PERSIST.test(key.split(':')[0] ?? '')) return;
    const db = await _openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, data, ts: Date.now() });
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch (e) { console.warn('[SiomacDB] set error', e); resolve(); }
    });
  },

  /** Read a key. Returns `{ data, ts, isCold }` or `null`. */
  async get(key: string): Promise<{ data: unknown; ts: number; isCold: boolean } | null> {
    const db = await _openDB();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = (e) => {
          const row = (e.target as IDBRequest<{ key: string; data: unknown; ts: number } | undefined>).result;
          if (!row) return resolve(null);
          resolve({ data: row.data, ts: row.ts, isCold: (Date.now() - row.ts) > COLD_AGE });
        };
        req.onerror = () => resolve(null);
      } catch { resolve(null); }
    });
  },

  /** Delete a specific key. */
  async del(key: string): Promise<void> {
    const db = await _openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch { resolve(); }
    });
  },

  /** Clear all persisted SWR data. */
  async clearAll(): Promise<void> {
    const db = await _openDB();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch { resolve(); }
    });
  },

  /** Prune entries older than `maxAge` ms (default: 1 day). */
  async pruneOld(maxAge = 24 * 60 * 60 * 1000): Promise<void> {
    const db = await _openDB();
    if (!db) return;
    const cutoff = Date.now() - maxAge;
    return new Promise(resolve => {
      try {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const idx   = store.index('ts');
        const range = IDBKeyRange.upperBound(cutoff);
        const cursorReq = idx.openCursor(range);
        cursorReq.onsuccess = (e) => {
          const cursor = (e.target as IDBRequest<IDBCursorWithValue | null>).result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        tx.oncomplete = () => resolve();
        tx.onerror    = () => resolve();
      } catch { resolve(); }
    });
  },

  /** Count entries (for cache stats UI). */
  async count(): Promise<number> {
    const db = await _openDB();
    if (!db) return 0;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = (e) => resolve((e.target as IDBRequest<number>).result || 0);
        req.onerror   = () => resolve(0);
      } catch { resolve(0); }
    });
  },

  /**
   * Warm the in-memory SWR from IndexedDB on startup.
   * Called once after api.js loads — injects persisted data into swr._cache
   * so the first render of every section is instant (reads cache before fetch).
   */
  async warmSwr(): Promise<void> {
    const db = await _openDB();
    interface SWRGlobal { _cache: Map<string, { data: unknown; ts: number }> }
    const swrGlobal = (window as unknown as { swr?: SWRGlobal }).swr;
    if (!db || !swrGlobal) return;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = (e) => {
          const rows = (e.target as IDBRequest<{ key: string; data: unknown; ts: number }[]>).result ?? [];
          let warmed = 0;
          rows.forEach(row => {
            const existing = swrGlobal._cache.get(row.key);
            if (!existing || existing.ts < row.ts) {
              swrGlobal._cache.set(row.key, { data: row.data, ts: row.ts });
              warmed++;
            }
          });
          if (warmed) console.log('[SiomacDB] Warmed SWR from IndexedDB:', warmed, 'entries');
          resolve();
        };
        req.onerror = () => resolve();
      } catch { resolve(); }
    });
  },
};

// Prune on open (non-blocking)
void _openDB().then(() => SiomacDB.pruneOld());


// ── 2. Service Worker registration & messaging ────────────────────────────────

function _sendSW(msg: object): void {
  if (navigator.serviceWorker?.controller) {
    navigator.serviceWorker.controller.postMessage(msg);
  }
}

export const SwCacheManager = {
  register(): Promise<ServiceWorkerRegistration | null> {
    if (!('serviceWorker' in navigator)) {
      console.log('[SW] Not supported in this browser');
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        console.log('[SW] Registered, scope:', reg.scope);
        if (reg.waiting) reg.waiting.postMessage({ type: 'SKIP_WAITING' });
        reg.addEventListener('updatefound', () => {
          const newSw = reg.installing;
          if (newSw) {
            newSw.addEventListener('statechange', () => {
              if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version available — will activate on next navigation');
                newSw.postMessage({ type: 'SKIP_WAITING' });
              }
            });
          }
        });
        return reg;
      })
      .catch((err: unknown) => { console.warn('[SW] Registration failed:', err); return null; });
  },

  /** Tell the SW to evict a specific photo URL (call after profile image update). */
  evictPhoto(url: string): void {
    if (url) _sendSW({ type: 'EVICT_PHOTO', payload: { url } });
  },

  /** Clear only the photo cache in the SW. */
  clearPhotoCache(): void {
    _sendSW({ type: 'CLEAR_PHOTO_CACHE' });
  },

  /** Full cache wipe: SW caches + IndexedDB + in-memory SWR. */
  clearAll(): void {
    _sendSW({ type: 'CLEAR_ALL_CACHES' });
    void SiomacDB.clearAll();
    interface SWRGlobal { clear: (key?: string) => void; _cache: Map<string, unknown> }
    const swrGlobal = (window as unknown as { swr?: SWRGlobal }).swr;
    if (swrGlobal) {
      swrGlobal.clear();
      const swrHash = (window as unknown as { _swrLastHash?: Map<string, string> })._swrLastHash;
      swrHash?.clear();
    }
  },

  /**
   * Get combined cache stats.
   * Returns `{ static, cdn, photos, idb }` or a best-effort partial result.
   */
  async getStats(): Promise<{ static: number; cdn: number; photos: number; idb: number }> {
    const [idb, sw] = await Promise.all([
      SiomacDB.count(),
      new Promise<{ static: number; cdn: number; photos: number }>(resolve => {
        if (!navigator.serviceWorker?.controller) {
          return resolve({ static: 0, cdn: 0, photos: 0 });
        }
        const timeout = setTimeout(() => resolve({ static: 0, cdn: 0, photos: 0 }), 2000);
        const handler = (e: MessageEvent) => {
          if (e.data?.type === 'CACHE_STATS') {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve(e.data.payload as { static: number; cdn: number; photos: number });
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        _sendSW({ type: 'GET_CACHE_STATS' });
      }),
    ]);
    return { ...sw, idb };
  },
};


// ── 3. Wire SWR → IndexedDB persistence (monkey-patch) ───────────────────────
// Patches the `swr` global defined by api.js to write-through to IndexedDB.
// Applied immediately if `swr` is already defined, otherwise deferred to
// DOMContentLoaded (api.js loads synchronously after this module in the chain).

function _patchSwrPersistence(): boolean {
  interface SWRGlobal {
    set:    (key: string, data: unknown) => void;
    clear:  (key?: string) => void;
    _cache: Map<string, { data: unknown; ts: number }>;
  }
  const swrGlobal = (window as unknown as { swr?: SWRGlobal }).swr;
  if (!swrGlobal) return false;

  // Patch swr.set
  const originalSet = swrGlobal.set.bind(swrGlobal);
  swrGlobal.set = function (key: string, data: unknown) {
    originalSet(key, data);
    void SiomacDB.set(key, data);
  };

  // Patch the internal Map.set so swr.fetch write-through hits IndexedDB too
  const internalCache = swrGlobal._cache;
  const originalMapSet = internalCache.set.bind(internalCache);
  internalCache.set = function (key: string, entry: { data: unknown; ts: number }) {
    originalMapSet(key, entry);
    if (entry?.data !== undefined) void SiomacDB.set(key, entry.data);
    return internalCache;
  };

  // Patch swr.clear so full/partial clears also evict from IndexedDB
  const originalClear = swrGlobal.clear.bind(swrGlobal);
  swrGlobal.clear = function (key?: string) {
    originalClear(key);
    if (key == null) { void SiomacDB.clearAll(); }
    else             { void SiomacDB.del(key);   }
  };

  return true;
}

if (!_patchSwrPersistence()) {
  document.addEventListener('DOMContentLoaded', _patchSwrPersistence);
}


// ── 4. Register globals so app.js keeps working unchanged ────────────────────
(window as unknown as Record<string, unknown>).SiomacDB       = SiomacDB;
(window as unknown as Record<string, unknown>).SwCacheManager = SwCacheManager;
