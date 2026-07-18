/**
 * tests/unit/criticalGrants.sync.test.ts
 *
 * The backend (netlify/functions/lib/permissions.ts) and frontend
 * (src/lib/permissions.ts) both export CRITICAL_GRANT_KEYS and
 * COMPLIANCE_GATED_KEYS. Both sets MUST stay identical on both sides —
 * any drift means the UI can silently skip the reason dialog for a key the
 * server treats as critical (or vice-versa), or show compliance affordances
 * to superadmins who don't have an active grant.
 *
 * We parse source text (rather than importing) because the frontend module
 * pulls in Vite-only globals (import.meta.env) that don't load under jest.
 */

import { readFileSync } from 'fs';
import { join }         from 'path';

/** Extract quoted 'resource.action' strings from a named Set literal in a source file. */
function extractSetKeys(relPath: string, setName: string): string[] {
  const src = readFileSync(join(__dirname, '../../', relPath), 'utf8');
  const pattern = new RegExp(
    setName.replace(/\./g, '\\.') + '\\s*=\\s*new Set[^(]*\\(\\s*\\[([\\s\\S]*?)\\]\\s*\\)',
  );
  const m = src.match(pattern);
  if (!m) throw new Error(`${setName} Set literal not found in ${relPath}`);
  const keys = m[1]!.match(/'[a-z_.]+'/g) ?? [];
  return keys.map(k => k.replace(/'/g, '')).sort();
}

const BE = 'netlify/functions/lib/permissions.ts';
const FE = 'src/lib/permissions.ts';

describe('critical grant keys sync (backend ↔ frontend)', () => {
  it('has identical CRITICAL_GRANT_KEYS on both sides', () => {
    expect(extractSetKeys(BE, 'CRITICAL_GRANT_KEYS')).toEqual(
      extractSetKeys(FE, 'CRITICAL_GRANT_KEYS'),
    );
  });

  it('has identical COMPLIANCE_GATED_KEYS on both sides', () => {
    expect(extractSetKeys(BE, 'COMPLIANCE_GATED_KEYS')).toEqual(
      extractSetKeys(FE, 'COMPLIANCE_GATED_KEYS'),
    );
  });

  it('COMPLIANCE_GATED_KEYS is a proper subset of CRITICAL_GRANT_KEYS (BE side)', () => {
    const critical  = new Set(extractSetKeys(BE, 'CRITICAL_GRANT_KEYS'));
    const compliant = extractSetKeys(BE, 'COMPLIANCE_GATED_KEYS');
    for (const k of compliant) {
      expect(critical.has(k)).toBe(true);
    }
    expect(compliant.length).toBeLessThan(critical.size);
  });
});
