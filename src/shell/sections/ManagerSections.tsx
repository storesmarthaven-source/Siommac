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

/** Profile + notification pill used in manager sections. */
function MgrProfilePill() {
  return (
    <div style="display:flex;justify-content:flex-end;margin-bottom:20px;">
      <div class="profile-notif-pill">
        <div class="pnp-profile" id="mgrProfileBtn">
          <div class="pnp-avatar" id="mgrProfileAvatar">M</div>
          <div class="pnp-info">
            <span class="pnp-name" id="mgrProfileName">Manager</span>
            <span class="pnp-role" id="mgrProfileRole">Manager</span>
          </div>
        </div>
        <div class="pnp-divider" />
        <div class="pnp-icons">
          <button class="pnp-icon-btn" id="mgrNotifBtn" title="Notifications">
            <i class="fas fa-bell" />
            <span class="pnp-badge" id="mgrNotifBadge" style="display:none" />
          </button>
          <button class="pnp-icon-btn" id="mgrMsgBtn" title="Messages">
            <i class="fas fa-comment-dots" />
            <span class="pnp-badge" id="mgrMsgBadge" style="display:none" />
          </button>
          <button class="pnp-icon-btn" id="mgrTicketBtn" title="Support Tickets">
            <i class="fas fa-ticket-alt" />
            <span class="pnp-badge pnp-badge-gold" id="mgrTicketBadge" style="display:none" />
          </button>
        </div>
      </div>
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
