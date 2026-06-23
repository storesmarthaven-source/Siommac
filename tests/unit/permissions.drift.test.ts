/**
 * tests/unit/permissions.drift.test.ts
 *
 * Drift-guard: every permission key that a route enforces via requirePermission()
 * MUST be present in the backend catalogue (netlify/functions/lib/permissions.ts).
 *
 * This test parses source text rather than importing, for two reasons:
 *   1. The backend modules have Supabase/env dependencies that won't load in jest.
 *   2. Parse-from-source is the same approach as permissions.sync.test.ts, keeping
 *      the test suite consistent.
 *
 * How it works:
 *   - Reads every *.ts file in netlify/functions/routes/
 *   - Extracts all quoted string arguments to requirePermission(c, '...')
 *   - Also extracts keys from requireAnyPermission([...]) and
 *     requireAllPermissions([...]) if those helpers are present
 *   - Reads the PERMISSION_KEYS array from netlify/functions/lib/permissions.ts
 *     using a regex that matches keys with ONE OR MORE dots (captures 3-segment
 *     keys like hse.ptw.view that the sync test regex misses)
 *   - Asserts that every enforced key is in the catalogue
 *
 * On failure the error message lists the offending "enforced but not catalogued"
 * keys so the fix is immediately obvious.
 */

import { readdirSync, readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../');
const ROUTES_DIR = join(ROOT, 'netlify/functions/routes');
const BE_PERMISSIONS = join(ROOT, 'netlify/functions/lib/permissions.ts');

/** Extract all permission keys from the backend catalogue. Matches 1+ dots. */
function extractCatalogueKeys(): Set<string> {
  const src = readFileSync(BE_PERMISSIONS, 'utf8');
  const m = src.match(/PERMISSION_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) throw new Error('PERMISSION_KEYS array not found in netlify/functions/lib/permissions.ts');
  const raw = m[1].match(/'[a-z_]+(?:\.[a-z_]+)+'/g) ?? [];
  return new Set(raw.map(k => k.replace(/'/g, '')));
}

/** Extract all keys enforced by requirePermission / requireAnyPermission / requireAllPermissions in a source string. */
function extractEnforcedKeysFromSrc(src: string): string[] {
  const keys: string[] = [];

  // requirePermission(c, 'key')
  const single = src.matchAll(/requirePermission\s*\(\s*\w+\s*,\s*'([^']+)'/g);
  for (const m of single) {
    if (m[1]) keys.push(m[1]);
  }

  // requireAnyPermission(c, ['key1', 'key2', ...]) or requireAnyPermission(['key1', ...])
  const any = src.matchAll(/requireAnyPermission\s*\([^)]*?\[([^\]]*)\]/g);
  for (const m of any) {
    const inner = m[1].match(/'([^']+)'/g) ?? [];
    for (const k of inner) keys.push(k.replace(/'/g, ''));
  }

  // requireAllPermissions(c, ['key1', 'key2', ...])
  const all = src.matchAll(/requireAllPermissions\s*\([^)]*?\[([^\]]*)\]/g);
  for (const m of all) {
    const inner = m[1].match(/'([^']+)'/g) ?? [];
    for (const k of inner) keys.push(k.replace(/'/g, ''));
  }

  return keys;
}

describe('permission drift guard (routes → catalogue)', () => {
  it('every key enforced by a route exists in the backend PERMISSION_KEYS catalogue', () => {
    const catalogue = extractCatalogueKeys();

    // Collect all .ts files in the routes directory
    const routeFiles = readdirSync(ROUTES_DIR).filter(f => f.endsWith('.ts'));
    expect(routeFiles.length).toBeGreaterThan(0); // sanity: we found route files

    const enforcedKeys = new Set<string>();
    for (const file of routeFiles) {
      const src = readFileSync(join(ROUTES_DIR, file), 'utf8');
      for (const key of extractEnforcedKeysFromSrc(src)) {
        enforcedKeys.add(key);
      }
    }

    const missing = [...enforcedKeys].filter(k => !catalogue.has(k)).sort();

    if (missing.length > 0) {
      throw new Error(
        `These permission keys are enforced by routes but missing from the catalogue:\n  ${missing.join('\n  ')}`
      );
    }

    expect(missing).toHaveLength(0);
  });
});
