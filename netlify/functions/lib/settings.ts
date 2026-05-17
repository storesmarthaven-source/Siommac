// In-memory settings cache with a 60-second TTL.
// Eliminates per-request SELECT queries for workHours, lateThreshold, etc.

import { sb } from './db';

const CACHE_TTL_MS = 60 * 1000;

let _cache:     Record<string, string> | null = null;
let _fetchedAt  = 0;
let _inflight:  Promise<Record<string, string>> | null = null;

async function _load(): Promise<Record<string, string>> {
  const { data } = await sb.from('settings').select('key, value');
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

async function getAllSettings(): Promise<Record<string, string>> {
  const now = Date.now();
  if (_cache && now - _fetchedAt < CACHE_TTL_MS) return _cache;
  if (_inflight) return _inflight;

  _inflight = _load().then(m => {
    _cache    = m;
    _fetchedAt = Date.now();
    _inflight  = null;
    return m;
  }).catch(e => {
    _inflight = null;
    throw e;
  });

  return _inflight;
}

async function setting(key: string, fallback = ''): Promise<string> {
  const map = await getAllSettings();
  return map[key] !== undefined ? map[key] : fallback;
}

// Call after any setting write so the next read re-fetches from DB.
function invalidateSettingsCache(): void {
  _cache    = null;
  _fetchedAt = 0;
}

export { getAllSettings, setting, invalidateSettingsCache };
