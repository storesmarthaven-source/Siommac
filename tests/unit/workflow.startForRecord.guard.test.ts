/**
 * tests/unit/workflow.startForRecord.guard.test.ts
 *
 * Grep gate: every reference to startWorkflowForRecord inside
 * netlify/functions/ MUST appear in the explicit allowlist below.
 *
 * Purpose: prevent new non-atomic workflow-start callers from sneaking back
 * in after the finding-#3 cutover.  Any new direct call to
 * startWorkflowForRecord that is not in the allowlist fails this test and
 * blocks the build.
 *
 * How it works (mirrors permissions.drift.test.ts):
 *   - Reads every .ts file under netlify/functions/ recursively.
 *   - Strips single-line (// ...) and block comments (/* ... *\/) to avoid
 *     false positives from commented-out code.
 *   - Searches the remaining source for the string 'startWorkflowForRecord'.
 *   - Asserts that only allowlisted relative paths match.
 *
 * Allowlist rationale:
 *   lib/workflow/service.ts
 *     -- Canonical definition and export.  Always allowed.
 *   lib/finance/accountsPayable.ts
 *     -- Direct caller; waiver dies with the AP module removal (D2).
 *   (moduleServiceAdapter.ts waiver REMOVED by slice D1 — the HSE callers now
 *    go through workflow_create_and_start_tx and the Stage-3 path is deleted.)
 *
 * On failure the error message lists the offending files so the fix is
 * immediately obvious.
 */

import { readdirSync, readFileSync, statSync } from 'fs';
import { join, relative } from 'path';

const ROOT       = join(__dirname, '../../');
const FUNCS_DIR  = join(ROOT, 'netlify/functions');

const ALLOWLIST = new Set<string>([
  // Canonical definition -- always allowed.
  'lib/workflow/service.ts',
  // Direct caller; waiver dies with the AP module removal.
  'lib/finance/accountsPayable.ts',
]);

/** Walk a directory recursively and return all .ts file paths. */
function walkTs(dir: string): string[] {
  const results: string[] = [];
  for (const entry of readdirSync(dir)) {
    const full = join(dir, entry);
    const stat = statSync(full);
    if (stat.isDirectory()) {
      results.push(...walkTs(full));
    } else if (entry.endsWith('.ts')) {
      results.push(full);
    }
  }
  return results;
}

/**
 * Strip single-line and block comments from TypeScript source so that
 * commented-out references do not trigger the gate.
 */
function stripComments(src: string): string {
  // Remove block comments first (non-greedy, dotall via workaround).
  let out = src.replace(/\/\*[\s\S]*?\*\//g, '');
  // Remove single-line comments.
  out = out.replace(/\/\/.*/g, '');
  return out;
}

describe('startWorkflowForRecord grep gate (finding #3 cutover)', () => {
  it('no file outside the allowlist references startWorkflowForRecord', () => {
    const files = walkTs(FUNCS_DIR);
    expect(files.length).toBeGreaterThan(0); // sanity: we found backend files

    const violations: string[] = [];

    for (const fullPath of files) {
      const src       = readFileSync(fullPath, 'utf8');
      const stripped  = stripComments(src);

      if (!stripped.includes('startWorkflowForRecord')) continue;

      // Compute the path relative to netlify/functions/ for allowlist lookup.
      const relPath = relative(FUNCS_DIR, fullPath).replace(/\\/g, '/');

      if (!ALLOWLIST.has(relPath)) {
        violations.push(relPath);
      }
    }

    if (violations.length > 0) {
      throw new Error(
        [
          'startWorkflowForRecord referenced outside the allowlist.',
          'Each new caller must use the direct-RPC pattern instead',
          '(workflow_create_and_start_tx / workflow_submit_for_record_tx).',
          'See FINAL_CUTOVER_CONTRACT.md section 5.',
          '',
          'Offending files:',
          ...violations.map(f => `  netlify/functions/${f}`),
        ].join('\n'),
      );
    }

    expect(violations).toHaveLength(0);
  });
});
