/**
 * src/components/sections/Finance/_shared/EmployeeCell.tsx
 *
 * Display components for rendering employee identities in Finance tables and drawers.
 * All Finance surfaces must use these components — no raw UUIDs/IDs ever appear in the UI.
 *
 * Two components are exported:
 *
 *   EmployeeCell (self-fetching)
 *     For isolated displays (drawer headers, single-field labels). Calls the lookup
 *     API internally. Fine for 1–5 employees; for bulk tables use EmployeeCellResolved.
 *
 *   EmployeeCellResolved (pre-resolved)
 *     For table rows where the caller has already batched employee IDs via
 *     useEmployeeNames([...ids]) and holds the resolved Map. One API round-trip
 *     for the entire table; each cell receives its slice of the result.
 *
 * Usage patterns:
 *
 *   // Single / isolated:
 *   <EmployeeCell employeeId={row.employeeId} showDept />
 *
 *   // Bulk table (recommended):
 *   const allIds = rows.map(r => r.employeeId).filter(Boolean);
 *   const { data: nameMap } = useEmployeeNames(allIds);
 *   // Then in each row:
 *   <EmployeeCellResolved resolved={nameMap?.get(row.employeeId)} showDept />
 */

import type { VNode } from 'preact';
import { useEmployeeNames } from '@api/finance/lookups';
import type { EmployeeResolved } from '@api/finance/lookups';
import { PersonCell } from '@ui';

// ── EmployeeCellResolved ───────────────────────────────────────────────────────

export interface EmployeeCellResolvedProps {
  /** Pre-resolved employee data. undefined = caller is still loading. */
  resolved: EmployeeResolved | undefined;
  /**
   * Fallback display when the id cannot be resolved (left the org, etc.)
   * Defaults to showing the id trimmed to 8 chars.
   */
  fallbackId?: string;
  /** When true, show the department name below the employee name. */
  showDept?: boolean;
  /** When true, show the position as a subtitle. */
  showPosition?: boolean;
  /** Optional CSS class applied to the root span. */
  class?: string;
}

/**
 * Renders pre-resolved employee display data. This is the Finance adapter: it maps an
 * `EmployeeResolved` (id → name / photo / dept) onto the shared @ui `PersonCell`, so the
 * avatar + name + meta layout lives in exactly one place. Shows a skeleton while loading.
 */
export function EmployeeCellResolved({
  resolved,
  fallbackId,
  showDept = false,
  showPosition = false,
  class: extraClass,
}: EmployeeCellResolvedProps): VNode {
  if (!resolved) {
    return <PersonCell name="" loading class={extraClass} />;
  }

  const displayName = resolved.fullName !== resolved.id
    ? resolved.fullName
    : fallbackId
      ? `[${fallbackId.slice(0, 8)}…]`
      : '—';

  const subParts: string[] = [];
  if (showDept && resolved.department) subParts.push(resolved.department);
  if (showPosition && resolved.position) subParts.push(resolved.position);

  return (
    <PersonCell
      name={displayName}
      image={resolved.imageUrl}
      meta={resolved.employeeNo
        ? <span title="Employee number">{'· '}{resolved.employeeNo}</span>
        : undefined}
      sub={subParts.length ? subParts.join(' · ') : undefined}
      class={extraClass}
    />
  );
}

// ── EmployeeCell (self-fetching) ───────────────────────────────────────────────

export interface EmployeeCellProps {
  /** Employee ID (TEXT — app_users.id). null/undefined renders an em dash. */
  employeeId: string | null | undefined;
  showDept?: boolean;
  showPosition?: boolean;
  class?: string;
}

/**
 * Self-fetching employee display cell.
 * Suitable for 1–5 isolated cells (drawer header, label, etc.).
 * For bulk table rows, prefer batching: useEmployeeNames(allIds) + EmployeeCellResolved.
 */
export function EmployeeCell({
  employeeId,
  showDept = false,
  showPosition = false,
  class: extraClass,
}: EmployeeCellProps): VNode {
  const ids = employeeId ? [employeeId] : [];
  const { data: nameMap, isLoading } = useEmployeeNames(ids);

  if (!employeeId) {
    return <span class={`ec-empty hse-muted${extraClass ? ` ${extraClass}` : ''}`}>—</span>;
  }

  // Show skeleton on first load only (isLoading && no cached data)
  const resolved = nameMap?.get(employeeId);

  return (
    <EmployeeCellResolved
      resolved={isLoading && !resolved ? undefined : resolved}
      fallbackId={employeeId}
      showDept={showDept}
      showPosition={showPosition}
      class={extraClass}
    />
  );
}
