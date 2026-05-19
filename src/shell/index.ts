/**
 * src/shell/index.ts
 *
 * Public barrel for the shell module.
 * Only AppShell is exported — all internals are private to src/shell/.
 *
 * @see docs/SHELL_STRUCTURE.md
 * @see docs/CODING_STANDARDS.md §3.2 (section module boundary rule)
 */

export { default as AppShell } from './AppShell';
export { default }             from './AppShell';
