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
      <section class="app-section" id="s-mgr-overview" data-role="manager">
        {/* NOTE: profile pill must stay in HTML — wired by nav.js badge system */}
        <MgrProfilePill />
        <div id="preact-mgr-overview-root" />
      </section>

      {/* Manager — Department Employees */}
      <section class="app-section" id="s-mgr-employees" data-role="manager">
        <div id="preact-mgr-employees-root" />
      </section>

      {/* Manager — Pending Leaves */}
      <section class="app-section" id="s-mgr-leaves" data-role="manager">
        <div id="preact-mgr-leaves-root" />
      </section>
    </>
  );
}
