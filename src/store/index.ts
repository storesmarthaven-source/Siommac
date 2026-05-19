/**
 * src/store/index.ts  —  Barrel export
 *
 * Import from '@store' in components instead of deep paths:
 *   import { useSessionStore, useUiStore, toast } from '@store';
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

export * from './session';
export * from './ui';
export * from './realtime';
export * from './data';
export * from './notifications';
