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

import LoginShell                from './LoginShell';
import EmployeeSections         from './sections/EmployeeSections';
import ManagerSections          from './sections/ManagerSections';
import AdminSections            from './sections/AdminSections';
import SharedSections           from './sections/SharedSections';
import NotificationModal        from './modals/NotificationModal';
import MessageModal             from './modals/MessageModal';
import TicketModal              from './modals/TicketModal';
import EmployeeModals           from './modals/EmployeeModals';
import ProjectSiteModal         from './modals/ProjectSiteModal';
import { useSessionStore, selectUserId } from '@store/session';
import { useCommunicationSummary }       from '@/hooks/useCommunicationSummary';
import { useRealtimeSignals }            from '@/hooks/useRealtimeSignals';
import { StepUpProvider }                from '@/hooks/useStepUp';

// ── Communications bridge ─────────────────────────────────────────────────────
// Headless component: subscribes to realtime signals and keeps summary fresh.
// Split into Inner/Outer so hooks only mount when authenticated.

function CommsBridgeInner() {
  const { channelKey } = useCommunicationSummary();
  useRealtimeSignals(channelKey);
  return null;
}

function CommsBridge() {
  const userId = useSessionStore(selectUserId);
  if (!userId) return null;
  return <CommsBridgeInner />;
}

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

      {/* Command-palette launcher (⌘K) — opens CommandPalette overlay */}
      <button class="sidebar-search" id="sidebarSearchBtn" type="button" title="Search & jump to (Ctrl/⌘K)">
        <i class="fas fa-search" />
        <span class="sidebar-search-text">Search</span>
        <kbd class="sidebar-search-kbd">⌘K</kbd>
      </button>

      <div class="sidebar-avatar" id="sidebarAvatar" style="display:none;">U</div>
      <div class="sidebar-menu-section">
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
    <StepUpProvider>
      <>
      {/* Global notification banner (toast-style, legacy) */}
      <div class="notification" id="notification" />

      {/* Mobile sidebar backdrop */}
      <div id="sidebarBackdrop" class="sidebar-backdrop" />

      {/* Login screen (visible until authentication) */}
      <LoginShell />

      {/* Headless Preact controller mount point (nav badge wiring) */}
      <div id="preact-nav-ctrl"   style="display:none;" aria-hidden="true" />

      {/* Comms bridge: realtime signals + summary refresh (no DOM output) */}
      <CommsBridge />

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

      {/* ⌘K command palette mount root */}
      <div id="preact-cmdk-root" />

      {/* Reusable nav sub-menu customizer mount root */}
      <div id="preact-navcust-root" />
    </>
    </StepUpProvider>
  );
}
