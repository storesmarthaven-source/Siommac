/**
 * src/shell/sections/ManagerSections.tsx
 *
 * HTML shells for manager-role section panels:
 *   • s-mgr-overview   — department overview (profile pill + Preact mount)
 *   • s-mgr-employees  — department employees (Preact mount)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 *
 * @see docs/SHELL_STRUCTURE.md §sections/ManagerSections
 * @see docs/CODING_STANDARDS.md
 */

import { AppSection } from './AppSection';


export default function ManagerSections() {
  return (
    <>
      {/* Manager — Department Overview */}
      <AppSection id="s-mgr-overview" role="manager">
        {/* NOTE: profile pill must stay in HTML — wired by nav.js badge system */}
        <div id="preact-mgr-overview-root" />
      </AppSection>

      {/* Manager — Department Employees */}
      <AppSection id="s-mgr-employees" role="manager">
        <div id="preact-mgr-employees-root" />
      </AppSection>

    </>
  );
}
