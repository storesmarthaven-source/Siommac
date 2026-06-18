/**
 * src/shell/sections/ManagerSections.tsx
 *
 * HTML shells for manager-role section panels:
 *   • s-mgr-overview   — department overview (profile pill + Preact mount)
 *   • s-mgr-employees  — department employees (Preact mount)
 *   • s-mgr-leaves     — pending leaves (Preact mount)
 *
 * IDs are preserved exactly as in assets/partials/app-shell.html.
 *
 * @see docs/SHELL_STRUCTURE.md §sections/ManagerSections
 * @see docs/CODING_STANDARDS.md
 */

import { ProfilePill } from '@shared/ProfilePill';
import { AppSection } from './AppSection';

/** Right-aligned wrapper over the reusable, self-populating pill. */
function MgrProfilePill() {
  return (
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <ProfilePill />
    </div>
  );
}

export default function ManagerSections() {
  return (
    <>
      {/* Manager — Department Overview */}
      <AppSection id="s-mgr-overview" role="manager">
        {/* NOTE: profile pill must stay in HTML — wired by nav.js badge system */}
        <MgrProfilePill />
        <div id="preact-mgr-overview-root" />
      </AppSection>

      {/* Manager — Department Employees */}
      <AppSection id="s-mgr-employees" role="manager">
        <div id="preact-mgr-employees-root" />
      </AppSection>

      {/* Manager — Pending Leaves */}
      <AppSection id="s-mgr-leaves" role="manager">
        <div id="preact-mgr-leaves-root" />
      </AppSection>
    </>
  );
}
