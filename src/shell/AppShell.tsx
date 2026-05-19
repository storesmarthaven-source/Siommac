/**
 * src/shell/AppShell.tsx
 *
 * Root compositor for the Siomac app shell.
 *
 * Renders the complete shell structure that replaces the runtime-fetched
 * assets/partials/app-shell.html. This component:
 *   • Composes Sidebar + MainArea (containing TopBar + SectionPanels + modals)
 *   • Renders LoginShell (shown pre-auth, hidden post-auth)
 *   • Renders all modal overlays (portalled in Phase 2, in-DOM for Phase 1b)
 *
 * All section switching, show/hide logic, and event wiring is still handled by
 * attSystem.ts and section Preact components — AppShell is purely structural.
 *
 * Boot order note: AppShell renders immediately when main.tsx mounts it.
 * attSystem.ts is called AFTER render (in bootApp), so all IDs it references
 * must exist in the DOM at that point. Do not use conditional rendering that
 * removes elements from the DOM.
 *
 * @see docs/SHELL_STRUCTURE.md
 * @see docs/ARCHITECTURE.md §Boot-Sequence
 * @see docs/UI_DESIGN_SYSTEM.md §5-Shell-Layout
 * @see docs/CODING_STANDARDS.md
 */

import LoginShell          from './LoginShell';
import EmployeeSections    from './sections/EmployeeSections';
import ManagerSections     from './sections/ManagerSections';
import AdminSections       from './sections/AdminSections';
import SharedSections      from './sections/SharedSections';
import NotificationModal   from './modals/NotificationModal';
import MessageModal        from './modals/MessageModal';
import TicketModal         from './modals/TicketModal';
import EmployeeModals      from './modals/EmployeeModals';
import ProjectSiteModal    from './modals/ProjectSiteModal';

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  return (
    <aside class="sidebar" id="sidebar">
      <button class="sidebar-toggle" id="sidebarToggleBtn" title="Toggle sidebar">
        <i class="fas fa-chevron-left" id="sidebarToggleIcon" />
      </button>
      <div class="sidebar-brand">
        <i class="fas fa-building" />
        <span class="sidebar-brand-text" id="companyName">My Company</span>
      </div>
      <div class="sidebar-avatar" id="sidebarAvatar" style="display:none;">U</div>
      <div class="sidebar-menu-section">
        <div class="sidebar-menu-title" id="sidebarNavTitle">Navigation</div>
        <ul class="sidebar-menu" id="sidebarMenu" />
      </div>
      <div class="sidebar-session hidden" id="sessionTimer" title="Session time remaining">
        <i class="fas fa-clock" />
        <span class="sidebar-session-label">Session</span>
        <span class="sidebar-session-time" id="sessionTimerText">--</span>
      </div>
      <div class="sidebar-logout">
        <button id="logoutBtn" title="Logout">
          <i class="fas fa-sign-out-alt" /> <span id="logoutText">Logout</span>
        </button>
      </div>
    </aside>
  );
}

// ── Page header (topbar) ─────────────────────────────────────────────────────

function PageHeader() {
  return (
    <div class="page-header">
      <div class="page-header-left">
        <button class="mobile-menu-btn" id="mobileMenuBtn" title="Menu">
          <i class="fas fa-bars" />
        </button>
      </div>
      <div class="page-header-right" />
    </div>
  );
}

// ── App Shell root ────────────────────────────────────────────────────────────

export default function AppShell() {
  return (
    <>
      {/* Global notification banner (toast-style, legacy) */}
      <div class="notification" id="notification" />

      {/* Mobile sidebar backdrop */}
      <div id="sidebarBackdrop" class="sidebar-backdrop" />

      {/* Login screen (visible until authentication) */}
      <LoginShell />

      {/* Headless Preact controllers (legacy mount points — do not remove) */}
      <div id="preact-login-ctrl" style="display:none;" aria-hidden="true" />
      <div id="preact-nav-ctrl"   style="display:none;" aria-hidden="true" />

      {/* App shell (sidebar + main content) — hidden class removed by attSystem after login */}
      <div id="appShell" class="app-container hidden">
        <Sidebar />

        <main class="main-content">
          <PageHeader />

          {/* Header modals (anchored inside main-content, float above via CSS) */}
          <NotificationModal />
          <MessageModal />
          <TicketModal />

          {/* Top tabs (only rendered when layoutMode === 'tabs', populated by nav.js) */}
          <nav class="top-tabs" id="topTabs" />

          {/* ── Section panels — ALL rendered, visibility toggled by attSystem.ts ── */}
          <EmployeeSections />
          <SharedSections />
          <ManagerSections />
          <AdminSections />
        </main>
      </div>

      {/* Full-screen overlays (outside #appShell to avoid stacking-context clipping) */}
      <EmployeeModals />
      <ProjectSiteModal />
    </>
  );
}
