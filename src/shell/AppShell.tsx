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
import { useEffect }                      from 'preact/hooks';
import { useSessionStore, selectUserId } from '@store/session';
import { initUserTheme, resetThemeToDefault } from '@store/ui';
import { useCommunicationSummary }       from '@/hooks/useCommunicationSummary';
import { useRealtimeSignals }            from '@/hooks/useRealtimeSignals';
import { StepUpProvider }                from '@/hooks/useStepUp';
import { UserPill }                       from '@shared/UserPill';
import { Toaster }                       from '@ui/toast';
import { ActionModalHost }               from '@/components/common/actions';

// ── Communications bridge ─────────────────────────────────────────────────────
// Headless component: subscribes to realtime signals and keeps summary fresh.
// Split into Inner/Outer so hooks only mount when authenticated.

function CommsBridgeInner() {
  const { channelKey, realtimeToken } = useCommunicationSummary();
  useRealtimeSignals(channelKey, realtimeToken);
  return null;
}

function CommsBridge() {
  const userId = useSessionStore(selectUserId);
  if (!userId) return null;
  return <CommsBridgeInner />;
}

// ── Theme bridge ──────────────────────────────────────────────────────────────
// Headless: loads the per-user theme (system.user_theme) from the DB on sign-in
// and whenever the signed-in user changes; resets to default on sign-out. Keyed
// by userId so switching users never inherits the previous user's theme.
function ThemeBridge() {
  const userId = useSessionStore(selectUserId);
  useEffect(() => {
    if (userId) void initUserTheme(userId);
    else resetThemeToDefault();
  }, [userId]);
  return null;
}

// ── Sidebar ───────────────────────────────────────────────────────────────────

function Sidebar() {
  // Render the brand from the already-hydrated session at first paint (read-once,
  // NOT subscribed — subscribing would re-render and wipe the imperatively-built
  // #sidebarMenu). This shows the real company logo immediately instead of flashing
  // the default building icon before domSync swaps it in on a hard reload.
  const persisted = useSessionStore.getState();
  const brandLogo = persisted.companyLogoUrl ?? '';
  const brandName = persisted.companyName ?? 'My Company';
  return (
    <aside class="sidebar" id="sidebar">
      <div class="sidebar-brand">
        {brandLogo && (
          <img class="sb-brand-img" alt={brandName} src={brandLogo}
            style="height:72px;max-width:180px;width:auto;object-fit:contain;display:block;" />
        )}
        <span class="sidebar-brand-text" id="companyName" style={brandLogo ? 'display:none;' : undefined}>{brandName}</span>
      </div>

      <div class="sidebar-avatar" id="sidebarAvatar" style="display:none;">U</div>
      <div class="sidebar-menu-section">
        <ul class="sidebar-menu" id="sidebarMenu" />
      </div>

      <div class="sidebar-powered">Powered by <strong>Siomac</strong></div>
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

      {/* Theme bridge: loads the per-user light/dark preference (no DOM output) */}
      <ThemeBridge />

      {/* App shell (sidebar + main content) — hidden class removed by attSystem after login */}
      <div id="appShell" class="app-container hidden">
        <Sidebar />

        <main class="main-content">
          <PageHeader />

          {/* Global top bar — ONE instance for every page (search + AI + account). */}
          <UserPill />

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

      {/* App-wide toast engine — ONE mount, portalled to document.body */}
      <Toaster />

      {/* App-wide enterprise lifecycle-action modal — ONE mount, imperative via openActionModal() */}
      <ActionModalHost />
    </>
    </StepUpProvider>
  );
}
