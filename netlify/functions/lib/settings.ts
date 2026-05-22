// In-memory settings cache with a tiered TTL.
//   • Branding keys (companyLogoUrl, companyName) — 5 s TTL
//   • Everything else — 60 s TTL

import { sb } from './db';

const BRANDING_TTL_MS = 5  * 1000;
const DEFAULT_TTL_MS  = 60 * 1000;
const BRANDING_KEYS   = new Set(['companyLogoUrl', 'companyName']);

let _cache:    Record<string, string> | null = null;
let _fetchedAt = 0;
let _inflight: Promise<Record<string, string>> | null = null;

async function _load(): Promise<Record<string, string>> {
  const { data } = await sb.from('settings').select('key, value');
  return Object.fromEntries((data ?? []).map((r: { key: string; value: string }) => [r.key, r.value]));
}

function _cacheAge(): number {
  return _cache ? Date.now() - _fetchedAt : Infinity;
}

async function getAllSettings(): Promise<Record<string, string>> {
  if (_cache && _cacheAge() < DEFAULT_TTL_MS) return _cache;
  if (_inflight) return _inflight;
  _inflight = _load().then(m => {
    _cache = m; _fetchedAt = Date.now(); _inflight = null; return m;
  }).catch(e => { _inflight = null; throw e; });
  return _inflight;
}

async function setting(key: string, fallback = ''): Promise<string> {
  const ttl = BRANDING_KEYS.has(key) ? BRANDING_TTL_MS : DEFAULT_TTL_MS;
  if (_cache && _cacheAge() >= ttl && !_inflight) { _cache = null; _fetchedAt = 0; }
  const map = await getAllSettings();
  return map[key] !== undefined ? map[key] : fallback;
}

function invalidateSettingsCache(): void {
  _cache = null; _fetchedAt = 0;
}

export { getAllSettings, setting, invalidateSettingsCache };
