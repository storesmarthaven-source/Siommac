/**
 * src/main.tsx — Phase 1b Shell
 *
 * Vite entry point. The app-shell HTML is now compiled into the bundle as
 * typed Preact components (src/shell/) and rendered synchronously — no
 * runtime fetch of assets/partials/app-shell.html.
 *
 * Boot sequence:
 *   1. Validate environment variables (fails loudly on misconfigured deploy)
 *   2. Render <AppShell /> into #app-root (all section panels in DOM immediately)
 *   3. Warm IndexedDB SWR cache (non-blocking)
 *   4. Call AttendanceSystem.init() (reads session, applies theme, shows correct panel)
 *   5. Mount all section Preact controllers
 *   6. Clear FOUC guard (body.visibility)
 *
 * Enterprise notes:
 *   - env.ts is imported first — throws immediately on missing VITE_* vars
 *   - logger.ts captures startup errors in production (Sentry)
 *   - QueryClient is created here and registered with the data store so
 *     optimistic updates can invalidate TanStack Query cache entries
 *
 * @see docs/ARCHITECTURE.md §Boot-Sequence
 * @see docs/SHELL_STRUCTURE.md §Migration-Path-from-app-shell.html
 * @see docs/CODING_STANDARDS.md
 */

// ① Env validation — must be first import; throws on missing required vars
import '@lib/env';

// ② Global CSS entry — declares the @layer cascade order before any component
//    imports its own (section) stylesheet. Must precede all section imports.
import './styles/index.css';

// ③ Apply the saved design-system theme (token overrides) before first paint.
//    Synchronously applies the localStorage cache, then refreshes from settings.
import { initTheme } from '@ui/theme/applyTheme';
initTheme();

import { logger }                              from '@lib/logger';
import { registerQueryClient }                from './store/data';
import { createDefaultQueryClient, setQueryClient } from '@lib/queryClient';
import { mountAttendanceSection }     from '@sections/Attendance';
import { mountAdminLeaveSection }     from '@sections/AdminLeave';
import { mountProfileSection }        from '@sections/Profile';
import { mountSettingsSection }       from '@sections/Settings';
import { applyCompanyLogoToDom, applyCompanyNameToDom } from '@sections/Settings/domSync';
import { mountHourlyRatesSection }    from '@sections/HourlyRates';
import { mountPayrollSection }        from '@sections/Payroll';
import { mountDashboardController }   from '@sections/Dashboard';
import { mountLiveMapController }     from '@sections/LiveMap';
import { mountProjectSitesSection }   from '@sections/ProjectSites';
import { mountEmployeesModule }       from '@sections/Employees';
import type { EmployeeSectionId }     from '@sections/Employees';
import { mountAttendanceDashboard }   from '@sections/AttendanceDashboard';
import { mountNotificationCenterSection, mountNotificationDropdown } from '@sections/NotificationCenter';
import { mountMessageCenterSection, mountMessageDropdown } from '@sections/Messages';
import '@sections/HSE';                 // self-registers the HSE module
import '@sections/HR';                  // self-registers the HR module
import '@sections/Finance';             // self-registers the Finance module
import '@sections/Calendar';            // self-registers the Calendar & Tasks module
import '@sections/AccessControl';       // self-registers the Access Control module (RBAC console)
import { getModules } from '@lib/moduleRegistry';
import { h, render }           from 'preact';
import { QueryClientProvider }  from '@tanstack/preact-query';
import { AppShell }            from '@shell';
import { SetPasswordPage }     from '@/components/auth/SetPasswordPage';
import { mountNavController, mountCommandPalette, mountNavCustomizer }  from '@components/nav';
import { useSessionStore }     from '@store/session';
import '@cfg/index';            // registers window.SiomacConfig before any legacy script reads it
import '@lib/popup';            // registers window.cpop / window.Swal before any legacy script reads it
import '@lib/charts';           // registers window.SiomacCharts; needs Chart.js CDN global on window
import '@lib/appState';         // registers window.AppState before any legacy script reads it
import '@lib/apiLegacy';        // registers window.api / window.apiSwr / window.swr (BEFORE cache patch)
import '@lib/cache';            // registers SiomacDB / SwCacheManager, patches window.swr write-through
import '@components/realtime';  // registers window._initRealtime / _teardownRealtime
import '@components/livemap';   // registers window.LiveMap before any legacy script reads it
import { AttendanceSystem }     from '@lib/attSystem';  // registers window.AttendanceSystem (AFTER all its deps)
import { ensureFreshToken }     from '@lib/api';

// ── Register session store on window so attSystem.ts can sync it ──────────────
// attSystem._completeLogin() calls window.__siomacSessionStore to update the
// Zustand store so all Preact components see isAuthenticated=true immediately.
(window as unknown as Record<string, unknown>).__siomacSessionStore = useSessionStore;

// ── TanStack Query client ─────────────────────────────────────────────────────

const queryClient = createDefaultQueryClient();

// Register as module-level singleton — accessible via getQueryClient() anywhere
setQueryClient(queryClient);

// Wire data store → query cache so patchEmployee / setEmployees invalidate queries
registerQueryClient(queryClient);

// ── Legacy script chain ───────────────────────────────────────────────────────

const SCRIPTS: readonly string[] = [
  // ALL legacy scripts have been ported to TypeScript/Preact:
  // popup.js        → src/lib/popup.ts
  // cache.js        → src/lib/cache.ts
  // api.js          → src/lib/apiLegacy.ts
  // config.js       → src/config/index.ts
  // charts.js       → src/lib/charts.ts
  // realtime.js     → src/components/realtime/
  // state.js        → src/lib/appState.ts
  // live-map.js     → src/components/livemap/LiveMapModule.ts
  // dashboard.js    → src/components/sections/Dashboard/
  // nav.js          → src/components/nav/
  // employees.js    → src/components/sections/Employees/
  // sites.js        → src/components/sections/ProjectSites/
  // attendance-view.js → src/components/sections/Attendance/
  // leave.js        → src/components/sections/AdminLeave/
  // profile.js      → src/components/sections/Profile/
  // settings-view.js→ src/components/sections/Settings/
  // payroll.js      → src/components/sections/HourlyRates/ + Payroll/
  // app.js          → src/lib/attSystem.ts  ← FINAL PORT
];

function loadScript(src: string): Promise<void> {
  return new Promise((resolve, reject) => {
    const s     = document.createElement('script');
    s.src       = src;
    s.onload    = () => resolve();
    s.onerror   = () => reject(new Error(`Could not load ${src}`));
    document.body.appendChild(s);
  });
}

function loadScripts(paths: readonly string[]): Promise<void> {
  return paths.reduce<Promise<void>>(
    (chain, src) => chain.then(() => loadScript(src)),
    Promise.resolve(),
  );
}

// ── Bootstrap ─────────────────────────────────────────────────────────────────

async function bootApp(): Promise<void> {
  // Phase 1b: Render shell synchronously from Preact components.
  // No network fetch — all HTML is compiled into the bundle via src/shell/.
  const root = document.getElementById('app-root');
  if (!root) throw new Error('#app-root element not found in DOM');

  // Public invite-accept page (HR Onboarding provisioning) — render standalone,
  // skipping the app shell + auth flow entirely. No session required.
  if (window.location.pathname.replace(/\/+$/, '') === '/set-password') {
    render(h(QueryClientProvider, { client: queryClient }, h(SetPasswordPage, null)), root);
    logger.info('Set-password page mounted');
    return;
  }

  // Wrap AppShell in QueryClientProvider so slot components (AdminStatCards,
  // AdminRecentTable, etc.) that use useQuery have access to the client.
  render(
    h(QueryClientProvider, { client: queryClient },
      h(AppShell, null),
    ),
    root,
  );

  await loadScripts(SCRIPTS);  // no-op — all scripts ported to TS

  // ── Boot the attendance system (replaces app.js _safeInit) ────────────────
  // Warm IndexedDB SWR cache first so the first render hits the cache, then init.
  const _siomacDB = (window as unknown as Record<string, { warmSwr?: () => Promise<void> }>).SiomacDB;
  if (_siomacDB?.warmSwr) {
    await _siomacDB.warmSwr().catch(() => undefined);
  }
  AttendanceSystem.init();

  // Boot-time silent refresh: if the persisted session's access token went stale
  // while the tab was closed/idle, mint a fresh one now (single-flight — early
  // queries queue behind it). A reload within the idle window NEVER logs out.
  void ensureFreshToken();

  logger.info('App bootstrapped');

  // ── Mount ported Preact sections ───────────────────────────────────────────
  // Each section replaces its legacy HTML with a Preact component tree.
  // The pnp (profile-notif-pill) headers remain in the HTML shell so nav.js
  // badge wiring continues to work unchanged.

  // Login / 2FA is now a fully Preact-controlled flow rendered by AppShell's
  // <LoginShell />, which applies the session via AttendanceSystem._completeLogin.
  // (The old headless controller + #preact-login-ctrl mount has been removed.)

  // Nav controller (replaces nav.js — sidebar, modals, notifications, messages, tickets)
  const navCtrlRoot = document.getElementById('preact-nav-ctrl');
  if (navCtrlRoot) {
    mountNavController(navCtrlRoot);
  }

  // ⌘K command palette (jump-to-section overlay)
  const cmdkRoot = document.getElementById('preact-cmdk-root');
  if (cmdkRoot) {
    mountCommandPalette(cmdkRoot);
  }

  // Reusable nav sub-menu customizer (gear on collapsible parents)
  const navcustRoot = document.getElementById('preact-navcust-root');
  if (navcustRoot) {
    mountNavCustomizer(navcustRoot);
  }

  // Attendance section (replaces attendance-view.js)
  const attRoot = document.getElementById('preact-attendance-root');
  if (attRoot) {
    mountAttendanceSection(attRoot, { queryClient });
  }

  // Admin Leave section (replaces leave.js)
  const adminLeaveRoot = document.getElementById('preact-admin-leave-root');
  if (adminLeaveRoot) {
    mountAdminLeaveSection(adminLeaveRoot, { queryClient });
  }

  // Settings section (replaces settings-view.js)
  const settingsRoot = document.getElementById('preact-settings-root');
  if (settingsRoot) {
    mountSettingsSection(settingsRoot, { queryClient });
  }

  // window.SettingsView shim — nav.js calls SettingsView.loadAdminBrandingSettings()
  // on section nav; we invalidate the settings query so the panel refetches.
  (window as unknown as Record<string, unknown>).SettingsView = {
    loadAdminBrandingSettings: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    refreshCompanySettings: () => {
      void queryClient.invalidateQueries({ queryKey: ['settings'] });
    },
    // applyCompanyLogo / applyCompanyName — DOM helpers imported eagerly below
    applyCompanyLogo: (url: string)  => applyCompanyLogoToDom(url),
    applyCompanyName: (name: string) => applyCompanyNameToDom(name),
    getCompanyInfo:    () => ({}),
    getStatutoryRates: () => ({ allowanceAnnual: 90000, nisRate: 6, payeRateLow: 25, payeRateHigh: 30 }),
    setCompanyInfo:    () => undefined,
    setStatutoryRates: () => undefined,
    _stgActivatePanel: () => undefined,
  };

  // Hourly Rates section (replaces payroll.js hourly rates, s-adm-rates)
  const hourlyRatesRoot = document.getElementById('preact-hourly-rates-root');
  if (hourlyRatesRoot) {
    mountHourlyRatesSection(hourlyRatesRoot, { queryClient });
  }

  // Payroll section (replaces payroll.js payroll run, s-payroll)
  const payrollRoot = document.getElementById('preact-payroll-root');
  if (payrollRoot) {
    mountPayrollSection(payrollRoot, { queryClient });
  }

  // window.Payroll shim — any legacy call to Payroll.loadHourlyRates() / initPayrollSection()
  // invalidates the relevant TanStack Query caches so sections refetch.
  (window as unknown as Record<string, unknown>).Payroll = {
    loadHourlyRates:   () => { void queryClient.invalidateQueries({ queryKey: ['hourlyRates'] }); },
    initPayrollSection:() => { void queryClient.invalidateQueries({ queryKey: ['payroll'] }); },
    renderHourlyRates: () => { void queryClient.invalidateQueries({ queryKey: ['hourlyRates'] }); },
    // stubs for rarely-called helpers referenced from app.js event delegation
    saveHourlyRate:         () => undefined,
    triggerRatesImport:     () => undefined,
    handleRatesImport:      () => undefined,
    parseRatesCsv:          () => [],
    _hrSaveAll:             () => undefined,
    _hrExportCsv:           () => undefined,
    _hrOpenModal:           () => undefined,
    _hrCloseModal:          () => undefined,
    _hrHandleFile:          () => undefined,
    _hrConfirmImport:       () => undefined,
    _hrSearch:              () => undefined,
    _hrDept:                () => undefined,
    _hrRole:                () => undefined,
    _prRunPayroll:          () => undefined,
    _prRunReportsSearch:    () => undefined,
    _prToggleReportsMode:   () => undefined,
    _prOpenPayslip:         () => undefined,
    _prOpenEditPayroll:     () => undefined,
    _prSendForApproval:     () => undefined,
    _prsOpen:               () => undefined,
    _prsClose:              () => undefined,
    _prsSave:               () => undefined,
    _prsToggleRateRows:     () => undefined,
    _prsRefreshEstimate:    () => undefined,
    _prcOpen:               () => undefined,
    _prcClose:              () => undefined,
    _prcVerify:             () => undefined,
    _prcSave:               () => undefined,
    _prcRestoreDefaults:    () => undefined,
    getRunData:             () => null,
    getCurrentRows:         () => [],
    initDataTable:          () => null,
    destroyDataTable:       () => undefined,
  };

  // Dashboard controller (replaces dashboard.js — headless, wires layout editor + chart queries)
  const dashCtrlRoot = document.getElementById('preact-dashboard-ctrl');
  if (dashCtrlRoot) {
    mountDashboardController(dashCtrlRoot, { queryClient });
  }

  // Live Map controller (wraps getLiveAttendance in TanStack Query, delegates to window.LiveMap)
  const liveMapCtrlRoot = document.getElementById('preact-live-map-ctrl');
  if (liveMapCtrlRoot) {
    mountLiveMapController(liveMapCtrlRoot, { queryClient });
  }

  // window.LiveMap — set by @components/livemap import at top of this file.
  // The block below is a belt-and-suspenders fallback in case the import somehow
  // didn't execute before nav.js runs its first loadLiveAttendance() delegation.
  if (!(window as unknown as Record<string, unknown>).LiveMap) {
    (window as unknown as Record<string, unknown>).LiveMap = {
      loadLiveAttendance: () => { void queryClient.invalidateQueries({ queryKey: ['liveAttendance'] }); },
      initializeMap:           () => undefined,
      renderLivePanel:         () => undefined,
      plotLiveEmployees:       () => undefined,
      focusLiveEmployee:       () => undefined,
      updateUserLocationOnMap: () => undefined,
      markProjectAttendance:   () => undefined,
      getCurrentLocation:      () => Promise.resolve({ fallback: true }),
      verifyLocation:          () => ({ verified: true }),
      showNotification:        () => undefined,
      _clearLiveSite:          () => undefined,
      _selectLiveSite:         () => undefined,
      _initCustomSelect:       () => undefined,
    };
  }

  // window.Dashboard shim — nav.js / app.js calls Dashboard.loadDashboardCharts() /
  // initDashboardLayoutEditor() / loadChart() on section nav.
  // Invalidating the query triggers the DashboardController to refetch + re-delegate to SiomacCharts.
  (window as unknown as Record<string, unknown>).Dashboard = {
    loadDashboardCharts:      (_forceReload?: boolean) => {
      void queryClient.invalidateQueries({ queryKey: ['dashboard', 'charts'] });
    },
    loadChart:                () => { void queryClient.invalidateQueries({ queryKey: ['dashboard', 'myChart'] }); },
    initDashboardLayoutEditor:() => undefined,  // layout applied on mount by DashboardController
    displayChart:             () => undefined,
    loadTrendChart:           () => undefined,
    displayTrendChart:        () => undefined,
    getDashEditMode:          () => false,
    toggleEditMode:           () => undefined,
  };

  // Project Sites section (replaces sites.js)
  const projectSitesRoot = document.getElementById('preact-project-sites-root');
  if (projectSitesRoot) {
    mountProjectSitesSection(projectSitesRoot, { queryClient });
  }

  // window.Sites shim — nav.js calls Sites.loadProjectSites() on section nav.
  // Invalidating the query triggers ProjectSitesSection to refetch.
  (window as unknown as Record<string, unknown>).Sites = {
    loadProjectSites:    (_forceWipe?: boolean, _forceRefresh?: boolean) => {
      void queryClient.invalidateQueries({ queryKey: ['projectSites'] });
    },
    displayProjectSites: () => { void queryClient.invalidateQueries({ queryKey: ['projectSites'] }); },
    showAddProjectModal:  () => undefined,  // invoked by app.js "Add" delegation; modal opened by Preact
  };

  // ── Attendance Dashboard controller (replaces checkStatus / camera modal in app.js) ──
  // Headless: drives #s-emp-attendance DOM + owns the camera check-in/out modal.
  // Must mount AFTER app.js so AppState.currentUser is populated.
  const attDashRoot = document.getElementById('preact-att-dashboard-ctrl');
  if (attDashRoot) {
    mountAttendanceDashboard(attDashRoot, { queryClient });
  }

  // ── Employees module (replaces employees.js — covers 8 sections across 3 roles) ──
  // AppState is populated by app.js (last in SCRIPTS chain) before we reach here.
  const _win     = window as unknown as Record<string, unknown>;
  const _AppSt   = _win.AppState as { get: (k: string) => string } | undefined;
  const _role    = (_AppSt?.get('currentRole') ?? 'employee') as Parameters<typeof mountEmployeesModule>[1]['currentRole'];
  const _user    = _AppSt?.get('currentUser') ?? '';

  function _mountEmp(rootId: string, sectionId: EmployeeSectionId): void {
    const root = document.getElementById(rootId);
    if (root) mountEmployeesModule(root, { sectionId, currentRole: _role, currentUsername: _user, queryClient });
  }

  // Admin sections
  _mountEmp('preact-adm-employees-root',   'employees');
  _mountEmp('preact-adm-departments-root', 'departments');   // superadmin-only section

  // Manager sections
  _mountEmp('preact-mgr-overview-root',   'manager-overview');
  _mountEmp('preact-mgr-employees-root',  'manager-employees');
  _mountEmp('preact-mgr-leaves-root',     'manager-leaves');

  // Employee sections
  _mountEmp('preact-emp-leave-root',   'leave');
  _mountEmp('preact-emp-history-root', 'history');
  _mountEmp('preact-emp-payroll-root', 'payslips');

  // window.Employees shim — nav.js refreshSection calls these on section nav.
  // Each invalidates the corresponding TanStack Query cache so the section refetches.
  (window as unknown as Record<string, unknown>).Employees = {
    loadEmployeeList:             () => { void queryClient.invalidateQueries({ queryKey: ['employees'] }); },
    loadDepartments:              () => { void queryClient.invalidateQueries({ queryKey: ['departments'] }); },
    loadLeaveRequests:            () => { void queryClient.invalidateQueries({ queryKey: ['leaves', 'employee'] }); },
    loadManagerLeaveApplications: () => { void queryClient.invalidateQueries({ queryKey: ['leaves', 'manager'] }); },
    loadMyPayslips:               () => { void queryClient.invalidateQueries({ queryKey: ['payslips'] }); },
    loadHistoryInline:            () => { void queryClient.invalidateQueries({ queryKey: ['attendance', 'history'] }); },
    loadDepartmentData:           () => { void queryClient.invalidateQueries({ queryKey: ['manager', 'overview'] }); },
    loadDepartmentEmployees:      () => { void queryClient.invalidateQueries({ queryKey: ['manager', 'employees'] }); },
    loadDashboardData:            () => { void queryClient.invalidateQueries({ queryKey: ['dashboard'] }); },
    loadRecentAttendance:         () => { void queryClient.invalidateQueries({ queryKey: ['attendance'] }); },
    updateRealTimeStats:          () => undefined,
    showAddEmployeeModal:         () => undefined,  // opened by EmployeesSection internally
    showAddDepartmentModal:       () => undefined,  // opened by DepartmentsSection internally
    displayEmployeeCards:         () => undefined,
    loadLeaveApplications:        () => { void queryClient.invalidateQueries({ queryKey: ['leaves'] }); },
  };

  // Notification Center section (all roles)
  const notificationCenterRoot = document.getElementById('preact-notification-center-root');
  if (notificationCenterRoot) {
    mountNotificationCenterSection(notificationCenterRoot, { queryClient });
  }

  // Bell dropdown (inside the header notification modal)
  const notifDropdownRoot = document.getElementById('preact-notif-dropdown-root');
  if (notifDropdownRoot) {
    mountNotificationDropdown(notifDropdownRoot, { queryClient });
  }

  // Message Center section (all roles)
  const messagesCenterRoot = document.getElementById('preact-messages-root');
  if (messagesCenterRoot) {
    mountMessageCenterSection(messagesCenterRoot, { queryClient });
  }

  // Message dropdown (inside the header message modal)
  const msgDropdownRoot = document.getElementById('preact-msg-dropdown-root');
  if (msgDropdownRoot) {
    mountMessageDropdown(msgDropdownRoot, { queryClient });
  }

  // Registered feature modules (HSE, and future modules) — each mounts into the
  // panel root it declares. Additive: existing sections above are unaffected.
  for (const mod of getModules()) {
    const root = document.getElementById(mod.mount.rootId);
    if (root) mod.mount.mount(root, { sectionId: mod.mount.rootId, queryClient });
  }

  // Profile section (replaces profile.js)
  const profileRoot = document.getElementById('preact-profile-root');
  if (profileRoot) {
    mountProfileSection(profileRoot, { queryClient });
  }

  // window.Profile shim — nav.js calls Profile.loadMyProfile() on section nav.
  // TanStack Query refetches on window focus; this additionally clears the query
  // so the next render always re-fetches fresh data.
  (window as unknown as Record<string, unknown>).Profile = {
    loadMyProfile: () => {
      void queryClient.invalidateQueries({ queryKey: ['profile'] });
    },
  };

  // window.LeaveView shim — any legacy call to LeaveView.loadLeaveApplications()
  // (e.g. from nav.js refreshSection) simply invalidates the TanStack Query cache.
  (window as unknown as Record<string, unknown>).LeaveView = {
    loadLeaveApplications: () => {
      void queryClient.invalidateQueries({ queryKey: ['admin', 'leaves'] });
    },
    // _lvCard / _diffLeaveList were shared with employees.js which is already
    // replaced by Preact; no callers remain — stubs provided for safety.
    _lvCard:        () => '',
    _diffLeaveList: () => undefined,
  };

  // window.AttendanceView shim — nav.js calls AttendanceView.loadAttendanceData()
  // when navigating to s-adm-attendance. TanStack Query auto-refetches on focus,
  // but we also invalidate the cache explicitly so a manual nav always refreshes.
  (window as unknown as Record<string, unknown>).AttendanceView = {
    loadAttendanceData: () => {
      void queryClient.invalidateQueries({ queryKey: ['attendance', 'log'] });
    },
  };

  // Reveal — the legacy init() has now run and decided which panel to show.
  // Keeping body hidden until this point eliminates the login-flash on refresh.
  document.body.style.visibility = '';
}

bootApp().catch((err: unknown) => {
  document.body.style.visibility = '';
  logger.critical('App bootstrap failed', err instanceof Error ? err : new Error(String(err)));
  const root = document.getElementById('app-root');
  if (root) {
    root.innerHTML =
      `<div style="padding:24px;font-family:sans-serif;color:#b00020;">` +
      `<strong>Startup error:</strong> ${err instanceof Error ? err.message : String(err)}</div>`;
  }
});
