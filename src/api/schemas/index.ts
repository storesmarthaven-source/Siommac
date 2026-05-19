/**
 * src/api/schemas/index.ts
 *
 * Zod schema barrel — re-exports all domain schemas.
 *
 * Import individual schema files for tree-shaking; import from here only
 * when you need multiple domains (e.g. in api/index.ts).
 *
 * @see docs/ARCHITECTURE.md §Validation
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

export * from './auth';
export * from './notification';
export * from './attendance';
export * from './employee';
export * from './leave';
export * from './payroll';
export * from './site';
export * from './settings';
