/**
 * src/components/sections/AdminDashboard/mount.ts
 *
 * No imperative mount needed — AdminStatCards and AdminRecentTable are
 * rendered directly inside the AppShell JSX tree via AdminSections.tsx.
 *
 * This file is kept as a no-op so existing dynamic import paths in main.tsx
 * don't need to be touched if they ever reference '@sections/AdminDashboard'.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

// intentionally empty — components render via AdminSections.tsx JSX slots
export {};
