// lib/hr/importFields.ts — the versioned, server-owned mapping allowlist for
// Employee Import (audit 2026-07-26, finding P2-1).
//
// `mapping` was previously `Record<string, string>` with no server allowlist: arbitrary
// target field names were accepted and persisted, and several targets could point at the
// same source column. Anything the commit path didn't read was silently dropped, and a
// removed field (`role`) could still be posted by an old or hand-crafted client.
//
// This list is the CONTRACT: exactly the targets `toProvisionInput`/`updateFromImport`
// actually consume. A target outside it is rejected, never stored.

/** Bump when the accepted target set changes; persisted on the batch for traceability. */
export const IMPORT_MAPPING_VERSION = 1;

export const IMPORT_TARGET_FIELDS = [
  // Identity
  'firstName', 'lastName', 'fullName', 'username', 'employeeNumber',
  'email', 'phone', 'dateOfBirth', 'nationality',
  // Employment
  'workerType', 'employmentType', 'position', 'startDate',
  // Assignment
  'department', 'site', 'supervisor',
  // Statutory
  'nisNumber', 'nisStatus', 'birFileNumber', 'td1Received', 'hsApplicable',
] as const;

export type ImportTargetField = typeof IMPORT_TARGET_FIELDS[number];

const ALLOWED = new Set<string>(IMPORT_TARGET_FIELDS);

/**
 * Validate a proposed column mapping.
 * Returns an error message, or null when the mapping is acceptable.
 *
 * `role` is called out explicitly: it was removed because it wrote straight to
 * app_users.role, so a stale client posting it must get a clear refusal rather than a
 * generic "unknown field".
 */
export function checkMapping(mapping: Record<string, string>): string | null {
  const targets = Object.keys(mapping);

  if (targets.includes('role')) {
    return 'The "role" field can no longer be imported. System access is granted per person through an approved access profile, never from a spreadsheet column.';
  }

  const unknown = targets.filter(t => !ALLOWED.has(t));
  if (unknown.length) {
    return `Unknown import field${unknown.length > 1 ? 's' : ''}: ${unknown.join(', ')}.`;
  }

  if (targets.length > IMPORT_TARGET_FIELDS.length) {
    return 'The mapping contains more fields than the import supports.';
  }

  // Two targets fed by one column is almost always a mis-drag, and it silently writes
  // the same value into unrelated fields.
  const bySource = new Map<string, string[]>();
  for (const [target, source] of Object.entries(mapping)) {
    if (!source) continue;
    const list = bySource.get(source) ?? [];
    list.push(target);
    bySource.set(source, list);
  }
  for (const [source, list] of bySource) {
    if (list.length > 1) {
      return `Column "${source}" is mapped to more than one field (${list.join(', ')}). Map each column once.`;
    }
  }

  return null;
}
