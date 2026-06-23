/**
 * tests/unit/permissionMeta.sync.test.ts
 *
 * Drift guard: every key in the frontend PERMISSION_KEYS catalogue MUST have an
 * entry in PERMISSION_META, and vice-versa. This prevents the human-metadata
 * registry from falling behind when new permission keys are added or removed.
 *
 * We parse both files from source text (rather than importing) because the
 * frontend modules pull in Vite-only globals (`import.meta.env`) that don't
 * load under Jest. The permissionMeta.ts file also imports from '@lib/permissions'
 * via a path alias that Jest doesn't resolve without transpilation.
 *
 * Key extraction:
 *   - PERMISSION_KEYS: matches keys with ONE OR MORE dots so three-segment keys
 *     like 'hse.ptw.view' are captured (same approach as permissions.drift.test.ts).
 *   - PERMISSION_META: matches the object keys on the left-hand side of the record
 *     entries, in the form `'hse.ptw.view': {`.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

const ROOT = join(__dirname, '../../');

/** Extract PERMISSION_KEYS from src/lib/permissions.ts (1+ dots pattern). */
function extractPermissionKeys(): string[] {
  const src = readFileSync(join(ROOT, 'src/lib/permissions.ts'), 'utf8');
  const m = src.match(/PERMISSION_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) throw new Error('PERMISSION_KEYS array not found in src/lib/permissions.ts');
  const raw = m[1].match(/'[a-z_]+(?:\.[a-z_]+)+'/g) ?? [];
  return raw.map(k => k.replace(/'/g, '')).sort();
}

/** Extract keys defined in PERMISSION_META from src/lib/permissionMeta.ts. */
function extractMetaKeys(): string[] {
  const src = readFileSync(join(ROOT, 'src/lib/permissionMeta.ts'), 'utf8');
  // Match quoted object keys that contain dots, e.g. `'hse.ptw.view': {`
  const raw = src.match(/'[a-z_]+(?:\.[a-z_]+)+'\s*:/g) ?? [];
  return raw.map(k => k.replace(/'/g, '').replace(/\s*:$/, '')).sort();
}

describe('permissionMeta drift guard (PERMISSION_KEYS ↔ PERMISSION_META)', () => {
  let catalogueKeys: string[];
  let metaKeys: string[];

  beforeAll(() => {
    catalogueKeys = extractPermissionKeys();
    metaKeys = extractMetaKeys();
  });

  it('every PERMISSION_KEYS entry has a PERMISSION_META entry', () => {
    const metaSet = new Set(metaKeys);
    const missing = catalogueKeys.filter(k => !metaSet.has(k));
    if (missing.length > 0) {
      throw new Error(
        `These keys are in PERMISSION_KEYS but missing from PERMISSION_META:\n  ${missing.join('\n  ')}`
      );
    }
    expect(missing).toHaveLength(0);
  });

  it('every PERMISSION_META entry exists in PERMISSION_KEYS', () => {
    const catalogueSet = new Set(catalogueKeys);
    const extra = metaKeys.filter(k => !catalogueSet.has(k));
    if (extra.length > 0) {
      throw new Error(
        `These keys are in PERMISSION_META but missing from PERMISSION_KEYS:\n  ${extra.join('\n  ')}`
      );
    }
    expect(extra).toHaveLength(0);
  });

  it('the counts match exactly', () => {
    expect(metaKeys.length).toBe(catalogueKeys.length);
  });
});
