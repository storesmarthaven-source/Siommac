/**
 * src/components/shared/AuthGate.tsx
 *
 * Renders children only when the user is authenticated.
 * Renders a fallback (default: null) when not authenticated.
 *
 * USAGE:
 *   // Protect a section — render nothing if not authenticated:
 *   <AuthGate>
 *     <AdminDashboard />
 *   </AuthGate>
 *
 *   // With a fallback:
 *   <AuthGate fallback={<LoginPrompt />}>
 *     <ProtectedContent />
 *   </AuthGate>
 *
 *   // With role requirement — renders fallback for wrong role:
 *   <AuthGate require="admin">
 *     <AdminOnlyPanel />
 *   </AuthGate>
 *
 *   // With permission requirement (Phase 2b RBAC):
 *   <AuthGate permission="employees.add">
 *     <AddEmployeeButton />
 *   </AuthGate>
 *
 * NOTE (docs/ARCHITECTURE.md §Boot-Sequence):
 *   AppShell renders synchronously before auth state is known. AuthGate handles
 *   the unauthenticated state by rendering null — it does NOT unmount panels
 *   (which would destroy form state). attSystem.ts controls panel visibility
 *   via CSS class toggling, so authenticated/unauthenticated states co-exist
 *   safely in the DOM.
 *
 * @see docs/ARCHITECTURE.md §9-Authentication-&-Session
 * @see docs/SHELL_STRUCTURE.md §Critical-Rules
 * @see docs/UI_DESIGN_SYSTEM.md §Component-Library
 * @see docs/CODING_STANDARDS.md §6-Component-Rules
 * @see docs/PHASE_PLAN.md §Phase-2b
 */

import type { ComponentChildren } from 'preact';
import { useSessionStore }        from '@store/session';
import { useCan }                 from '@lib/permissions';
import type { UserRole }          from '@api/schemas/auth';

// ── Props ─────────────────────────────────────────────────────────────────────

interface AuthGateProps {
  /** Content to render when the gate passes */
  children:   ComponentChildren;
  /** Content to render when the gate fails (default: null) */
  fallback?:  ComponentChildren;
  /**
   * Minimum role required. Access is granted if the user's role is the given
   * role OR higher in the hierarchy: employee < manager < admin < superadmin.
   */
  require?:   UserRole;
  /**
   * Permission key required (Phase 2b RBAC).
   * Resolved via can() — checks role defaults + DB overrides.
   * e.g. 'employees.add', 'leaves.approve'
   */
  permission?: string;
}

// ── Role hierarchy ────────────────────────────────────────────────────────────

const ROLE_RANK: Record<UserRole, number> = {
  employee:        0,
  hr_staff:        0,
  hse_staff:       0,
  finance_staff:   0,
  manager:         1,
  hr_manager:      1,
  finance_manager: 1,
  admin:           2,
  superadmin:      3,
};

function roleAtLeast(actual: UserRole | null, required: UserRole): boolean {
  if (!actual) return false;
  return (ROLE_RANK[actual] ?? -1) >= (ROLE_RANK[required] ?? 99);
}

// ── Component ─────────────────────────────────────────────────────────────────

/**
 * AuthGate — guards children behind auth + optional role/permission check.
 *
 * Evaluates synchronously from the Zustand session store — no async, no flash.
 */
export function AuthGate({
  children,
  fallback  = null,
  require:  requiredRole,
  permission,
}: AuthGateProps) {
  const isAuthenticated = useSessionStore((s) => s.isAuthenticated);
  const role            = useSessionStore((s) => s.role);

  // Not logged in at all
  if (!isAuthenticated) return <>{fallback}</>;

  // Role check
  if (requiredRole && !roleAtLeast(role, requiredRole)) {
    return <>{fallback}</>;
  }

  // Permission check (RBAC — Phase 2b)
  // eslint-disable-next-line react-hooks/rules-of-hooks
  const permitted = permission ? useCan(permission) : true;
  if (!permitted) return <>{fallback}</>;

  return <>{children}</>;
}

export default AuthGate;
