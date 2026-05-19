/**
 * src/lib/index.ts  —  Barrel export
 *
 * Import utilities from '@lib/api', '@lib/logger', etc. — not from '@lib'
 * directly — to keep tree-shaking effective.  This barrel exists only so
 * the tsconfig '@lib' path alias has a valid resolution target.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

export * from './api';
export * from './logger';
export * from './session';
export * from './env';
export * from './queryClient';
// Note: supabase.ts is intentionally NOT re-exported here — import directly
// from '@lib/supabase' to keep the client a single, identifiable import point.
