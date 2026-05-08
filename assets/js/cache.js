// ─── SIOMAC Persistent Cache ──────────────────────────────────────────────────
// Two components:
//   1. SiomacDB  — IndexedDB wrapper that persists SWR API responses across
//                  page reloads, so navigating back to a section is instant.
//   2. SwCacheManager — registers the Service Worker and exposes helpers for
//                  the rest of the app (photo eviction, cache stats, full clear).
//
// This file must be loaded BEFORE api.js so apiSwr can call SiomacDB.

// ─── 1. IndexedDB — persistent SWR store ─────────────────────────────────────
const SiomacDB = (function () {
  const DB_NAME    = 'siomac_cache';
  const DB_VERSION = 1;
  const STORE      = 'swr';

  // Actions whose responses should never be persisted
  const SKIP_PERSIST = /^(login|logout|ping|getSettings|markAttendance)/i;

  // Max age for a persisted entry before it is considered cold (still served,
  // but the in-memory SWR will revalidate immediately).
  const COLD_AGE = 5 * 60 * 1000;   // 5 minutes

  let _db = null;

  function _open() {
    if (_db) return Promise.resolve(_db);
    return new Promise((resolve, reject) => {
      const req = indexedDB.open(DB_NAME, DB_VERSION);
      req.onupgradeneeded = e => {
        const db = e.target.result;
        if (!db.objectStoreNames.contains(STORE)) {
          const store = db.createObjectStore(STORE, { keyPath: 'key' });
          store.createIndex('ts', 'ts', { unique: false });
        }
      };
      req.onsuccess = e => { _db = e.target.result; resolve(_db); };
      req.onerror   = e => {
        console.warn('[SiomacDB] open error', e.target.error);
        resolve(null);   // degrade gracefully — app works without persistence
      };
    });
  }

  // Write a key/data pair with current timestamp
  async function set(key, data) {
    if (SKIP_PERSIST.test(key.split(':')[0])) return;
    const db = await _open();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).put({ key, data, ts: Date.now() });
        tx.oncomplete = resolve;
        tx.onerror    = resolve;   // never throw — it's a cache
      } catch (e) {
        console.warn('[SiomacDB] set error', e);
        resolve();
      }
    });
  }

  // Read a key; returns { data, ts, isCold } or null
  async function get(key) {
    const db = await _open();
    if (!db) return null;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).get(key);
        req.onsuccess = e => {
          const row = e.target.result;
          if (!row) return resolve(null);
          resolve({ data: row.data, ts: row.ts, isCold: (Date.now() - row.ts) > COLD_AGE });
        };
        req.onerror = () => resolve(null);
      } catch (e) {
        resolve(null);
      }
    });
  }

  // Delete a specific key
  async function del(key) {
    const db = await _open();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).delete(key);
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      } catch (e) { resolve(); }
    });
  }

  // Clear all persisted SWR data (triggered by mutations or "Clear Cache")
  async function clearAll() {
    const db = await _open();
    if (!db) return;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readwrite');
        tx.objectStore(STORE).clear();
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      } catch (e) { resolve(); }
    });
  }

  // Prune entries older than maxAge (called on SW activation, not blocking)
  async function pruneOld(maxAge) {
    maxAge = maxAge || 24 * 60 * 60 * 1000;   // default: 1 day
    const db = await _open();
    if (!db) return;
    const cutoff = Date.now() - maxAge;
    return new Promise(resolve => {
      try {
        const tx    = db.transaction(STORE, 'readwrite');
        const store = tx.objectStore(STORE);
        const idx   = store.index('ts');
        const range = IDBKeyRange.upperBound(cutoff);
        idx.openCursor(range).onsuccess = function (e) {
          const cursor = e.target.result;
          if (cursor) { cursor.delete(); cursor.continue(); }
        };
        tx.oncomplete = resolve;
        tx.onerror    = resolve;
      } catch (e) { resolve(); }
    });
  }

  // Count entries (for cache stats UI)
  async function count() {
    const db = await _open();
    if (!db) return 0;
    return new Promise(resolve => {
      try {
        const tx = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).count();
        req.onsuccess = e => resolve(e.target.result || 0);
        req.onerror   = () => resolve(0);
      } catch (e) { resolve(0); }
    });
  }

  // Warm the in-memory SWR from IndexedDB on startup.
  // Called once after api.js loads — injects persisted data into swr._cache
  // so the first render of every section is instant (reads cache before fetch).
  async function warmSwr() {
    const db = await _open();
    if (!db || typeof swr === 'undefined') return;
    return new Promise(resolve => {
      try {
        const tx  = db.transaction(STORE, 'readonly');
        const req = tx.objectStore(STORE).getAll();
        req.onsuccess = e => {
          const rows = e.target.result || [];
          let warmed = 0;
          rows.forEach(row => {
            // Only warm if in-memory cache doesn't already have a fresher entry
            const existing = swr._cache.get(row.key);
            if (!existing || existing.ts < row.ts) {
              swr._cache.set(row.key, { data: row.data, ts: row.ts });
              warmed++;
            }
          });
          if (warmed) console.log('[SiomacDB] Warmed SWR from IndexedDB:', warmed, 'entries');
          resolve();
        };
        req.onerror = () => resolve();
      } catch (e) { resolve(); }
    });
  }

  // Prune on open (non-blocking, runs after warm)
  _open().then(() => pruneOld());

  return { set, get, del, clearAll, warmSwr, count, pruneOld };
})();


// ─── 2. Service Worker registration & messaging ───────────────────────────────
const SwCacheManager = (function () {
  let _sw = null;   // ServiceWorkerRegistration

  function register() {
    if (!('serviceWorker' in navigator)) {
      console.log('[SW] Not supported in this browser');
      return Promise.resolve(null);
    }
    return navigator.serviceWorker.register('/sw.js', { scope: '/' })
      .then(reg => {
        _sw = reg;
        console.log('[SW] Registered, scope:', reg.scope);

        // If a new SW is waiting, skip waiting → reload once it activates
        if (reg.waiting) _skipWaiting(reg.waiting);
        reg.addEventListener('updatefound', () => {
          const newSw = reg.installing;
          if (newSw) {
            newSw.addEventListener('statechange', () => {
              if (newSw.state === 'installed' && navigator.serviceWorker.controller) {
                console.log('[SW] New version available — will activate on next navigation');
                _skipWaiting(newSw);
              }
            });
          }
        });

        return reg;
      })
      .catch(err => {
        console.warn('[SW] Registration failed:', err);
        return null;
      });
  }

  function _skipWaiting(worker) {
    worker.postMessage({ type: 'SKIP_WAITING' });
  }

  function _send(msg) {
    if (navigator.serviceWorker && navigator.serviceWorker.controller) {
      navigator.serviceWorker.controller.postMessage(msg);
    }
  }

  // Tell the SW to evict a specific photo URL (call after profile image update)
  function evictPhoto(url) {
    if (url) _send({ type: 'EVICT_PHOTO', payload: { url } });
  }

  // Clear only the photo cache in the SW
  function clearPhotoCache() {
    _send({ type: 'CLEAR_PHOTO_CACHE' });
  }

  // Full cache wipe: SW caches + IndexedDB + in-memory SWR
  function clearAll() {
    _send({ type: 'CLEAR_ALL_CACHES' });
    SiomacDB.clearAll();
    if (typeof swr !== 'undefined') { swr.clear(); }
    if (typeof _swrLastHash !== 'undefined') { _swrLastHash.clear(); }
  }

  // Get stats from the SW (photo count, CDN count, static count)
  // Returns a Promise that resolves to { static, cdn, photos, idb } or null
  function getStats() {
    return Promise.all([
      SiomacDB.count(),
      new Promise(resolve => {
        if (!navigator.serviceWorker || !navigator.serviceWorker.controller) {
          return resolve({ static: 0, cdn: 0, photos: 0 });
        }
        const timeout = setTimeout(() => resolve({ static: 0, cdn: 0, photos: 0 }), 2000);
        const handler = e => {
          if (e.data && e.data.type === 'CACHE_STATS') {
            clearTimeout(timeout);
            navigator.serviceWorker.removeEventListener('message', handler);
            resolve(e.data.payload);
          }
        };
        navigator.serviceWorker.addEventListener('message', handler);
        _send({ type: 'GET_CACHE_STATS' });
      })
    ]).then(([idb, sw]) => ({ ...sw, idb }));
  }

  return { register, evictPhoto, clearPhotoCache, clearAll, getStats };
})();


// ─── 3. Wire SWR → IndexedDB persistence ─────────────────────────────────────
// Monkey-patch the swr module to write-through to IndexedDB on every cache set.
// This happens AFTER api.js defines `swr`, so we use a DOMContentLoaded-safe
// approach: the patch is applied immediately if swr exists, otherwise deferred.
(function patchSwrPersistence() {
  function _patch() {
    if (typeof swr === 'undefined') return false;
    const originalSet = swr.set;
    swr.set = function (key, data) {
      originalSet.call(swr, key, data);
      SiomacDB.set(key, data);          // write-through — non-blocking
    };

    // Also patch the internal cache.set inside swr.fetch
    // The swr.fetch stores to cache via cache.set(key, {...}) internally —
    // we intercept at the Map level instead:
    const internalCache = swr._cache;
    const originalMapSet = internalCache.set.bind(internalCache);
    internalCache.set = function (key, entry) {
      originalMapSet(key, entry);
      if (entry && entry.data !== undefined) {
        SiomacDB.set(key, entry.data);  // write-through — non-blocking
      }
      return internalCache;
    };

    // Also clear IndexedDB when swr.clear() is called
    const originalClear = swr.clear;
    swr.clear = function (key) {
      originalClear.call(swr, key);
      if (key == null) {
        SiomacDB.clearAll();            // full clear
      } else {
        SiomacDB.del(key);             // single key eviction
      }
    };

    return true;
  }

  // api.js loads synchronously after this file in the script chain,
  // so `swr` is available by the time DOMContentLoaded fires.
  if (!_patch()) {
    document.addEventListener('DOMContentLoaded', _patch);
  }
})();
