/**
 * tests/unit/permissions.sync.test.ts
 *
 * The backend (netlify/functions/lib/permissions.ts) mirrors the frontend
 * permission catalogue (src/lib/permissions.ts). They are the security boundary
 * and the UI gate respectively and MUST stay in sync. This test fails if the
 * PERMISSION_KEYS sets diverge, so a permission added on one side can't be
 * silently forgotten on the other.
 *
 * We parse the source text (rather than importing) because the frontend module
 * pulls in Vite-only globals (`import.meta.env`) that don't load under jest.
 */

import { readFileSync } from 'fs';
import { join } from 'path';

/** Extract the quoted 'resource.action' keys from a PERMISSION_KEYS array literal. */
function extractKeys(relPath: string): string[] {
  const src = readFileSync(join(__dirname, '../../', relPath), 'utf8');
  const m = src.match(/PERMISSION_KEYS\s*=\s*\[([\s\S]*?)\]\s*as const/);
  if (!m) throw new Error(`PERMISSION_KEYS array not found in ${relPath}`);
  const keys = m[1].match(/'[a-z_]+\.[a-z_]+'/g) ?? [];
  return keys.map(k => k.replace(/'/g, '')).sort();
}

describe('permission catalogue sync (backend ↔ frontend)', () => {
  it('has the same set of permission keys on both sides', () => {
    const backend  = extractKeys('netlify/functions/lib/permissions.ts');
    const frontend = extractKeys('src/lib/permissions.ts');
    expect(backend).toEqual(frontend);
  });
});
