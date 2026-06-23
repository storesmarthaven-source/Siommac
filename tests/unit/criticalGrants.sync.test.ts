/**
 * tests/unit/criticalGrants.sync.test.ts
 *
 * The backend (netlify/functions/lib/permissions.ts) and frontend
 * (src/lib/permissions.ts) both export CRITICAL_GRANT_KEYS. They MUST stay
 * identical — any drift means the UI can silently skip the reason dialog for
 * a key the server treats as critical (or vice-versa).
 *
 * We parse source text (rather than importing) because the frontend module
 * pulls in Vite-only globals (import.meta.env) that don't load under jest.
 */

import { readFileSync } from 'fs';
import { join }         from 'path';

/** Extract the quoted 'resource.action' strings from a CRITICAL_GRANT_KEYS Set literal. */
function extractCriticalKeys(relPath: string): string[] {
  const src = readFileSync(join(__dirname, '../../', relPath), 'utf8');
  // Match: new Set<string>([ ... ]) immediately after CRITICAL_GRANT_KEYS =
  const m = src.match(/CRITICAL_GRANT_KEYS\s*=\s*new Set[^(]*\(\s*\[([\s\S]*?)\]\s*\)/);
  if (!m) throw new Error(`CRITICAL_GRANT_KEYS Set literal not found in ${relPath}`);
  const keys = m[1]!.match(/'[a-z_.]+'/g) ?? [];
  return keys.map(k => k.replace(/'/g, '')).sort();
}

describe('critical grant keys sync (backend ↔ frontend)', () => {
  it('has identical CRITICAL_GRANT_KEYS on both sides', () => {
    const backend  = extractCriticalKeys('netlify/functions/lib/permissions.ts');
    const frontend = extractCriticalKeys('src/lib/permissions.ts');
    expect(backend).toEqual(frontend);
  });
});
