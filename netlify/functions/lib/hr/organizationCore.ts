// lib/hr/organizationCore.ts — pure helpers for the Organization Structure module.
//
// No DB access here (except cycle guards take already-loaded rows) — validation,
// normalization, hierarchy invariants, and the shared HTTP-error helper. Kept pure
// so it's trivially unit-testable and reusable by queries/mutations.

/** Attach an HTTP status to an Error so the route layer can map it (mirrors the HR pattern). */
export function httpError(status: number, message: string): Error & { status: number } {
  return Object.assign(new Error(message), { status });
}

/** Trim + upper-case a code; empty → null (codes are optional, unique when present). */
export function normalizeCode(value: string | null | undefined): string | null {
  const cleaned = value?.trim().toUpperCase();
  return cleaned ? cleaned : null;
}

/** Optimistic-concurrency guard: reject (409) if the record moved under us. */
export function assertExpectedUpdatedAt(
  currentUpdatedAt: string | null | undefined,
  expectedUpdatedAt: string | null | undefined,
): void {
  if (!expectedUpdatedAt) return;                            // caller opted out of the check
  if ((currentUpdatedAt ?? '') !== expectedUpdatedAt) {
    throw httpError(409, 'This record was updated by another user. Reload and try again.');
  }
}

/** Reject (409) if re-parenting `unitId` under `newParentId` would create a cycle. */
export function assertNoOrgCycle(
  units: Array<{ id: string; parentId: string | null }>,
  unitId: string,
  newParentId: string | null,
): void {
  if (!newParentId) return;
  if (unitId === newParentId) throw httpError(409, 'An org unit cannot be its own parent.');

  const byId = new Map(units.map(u => [u.id, u]));
  let cursor = byId.get(newParentId);
  while (cursor) {
    if (cursor.id === unitId) throw httpError(409, 'This move would create an org hierarchy cycle.');
    cursor = cursor.parentId ? byId.get(cursor.parentId) : undefined;
  }
}

/** Reject (409) if `positionId` reporting to `reportsToPositionId` would create a cycle. */
export function assertNoPositionCycle(
  positions: Array<{ id: string; reportsToPositionId: string | null }>,
  positionId: string,
  reportsToPositionId: string | null,
): void {
  if (!reportsToPositionId) return;
  if (positionId === reportsToPositionId) throw httpError(409, 'A position cannot report to itself.');

  const byId = new Map(positions.map(p => [p.id, p]));
  let cursor = byId.get(reportsToPositionId);
  while (cursor) {
    if (cursor.id === positionId) throw httpError(409, 'This reports-to change would create a position hierarchy cycle.');
    cursor = cursor.reportsToPositionId ? byId.get(cursor.reportsToPositionId) : undefined;
  }
}

/** Shallow field diff for audit trails: keys whose JSON value changed. */
export function changedFields(prev: Record<string, unknown>, next: Record<string, unknown>): string[] {
  const keys = new Set([...Object.keys(prev), ...Object.keys(next)]);
  const out: string[] = [];
  for (const k of keys) if (JSON.stringify(prev[k]) !== JSON.stringify(next[k])) out.push(k);
  return out;
}
