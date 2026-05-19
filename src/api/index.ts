/**
 * src/api/index.ts
 *
 * Public barrel for the typed Supabase API layer.
 *
 * Import from '@api' to get query keys and all domain API functions:
 *
 *   import { attendanceKeys, listAttendance } from '@api';
 *   import { employeeKeys, listEmployees }    from '@api';
 *
 * Or import domain-specific modules directly for better tree-shaking:
 *
 *   import { listAttendance } from '@api/attendance';
 *   import { listEmployees }  from '@api/employees';
 *
 * @see docs/ARCHITECTURE.md §API-Layer
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

// ── Query keys ────────────────────────────────────────────────────────────────
export * from './queryKeys';

// ── Domain API modules ────────────────────────────────────────────────────────
export * from './auth';
export * from './employees';
export * from './attendance';
export * from './leave';
export * from './payroll';
export * from './sites';
export * from './settings';

// ── Schemas (for form validation) ─────────────────────────────────────────────
export * from './schemas';
