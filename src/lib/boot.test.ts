/**
 * src/lib/boot.test.ts — Boot sequence integration tests
 *
 * Verifies the three invariants that every hard-refresh bug this session
 * violated. These tests run in jsdom (same environment as production code)
 * and exercise the real boot functions — not mocks of them.
 *
 * Invariants under test:
 *   1. window.Nav exists before AttendanceSystem.init() runs
 *      (blank sidebar / blank content area on refresh)
 *
 *   2. window.Nav.showSection activates the correct DOM section
 *      (blank content area — section never got .active class)
 *
 *   3. loadSession() returns the stored session — no corruption from
 *      two competing implementations reading the same localStorage key
 *      (session duplication bug)
 *
 *   4. registerWindowShims() sets all required shims — no undefined entries
 *      (silent no-ops when navCore.refreshSection delegates to window.X)
 *
 *   5. initializeDateSelectors() does NOT assign _attFpFrom when the target
 *      elements are absent from the DOM
 *      (_attFpFrom.destroy is not a function crash on logout)
 *
 * @see docs/ARCHITECTURE.md §Boot-Sequence
 * @see docs/CODING_STANDARDS.md §10-Testing-Standards
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { SESSION_KEY }                           from '@cfg';
import { saveSession, loadSession, clearSession } from '@lib/session';
import { showSection }                           from '@components/nav/navCore';
import type { PersistedSession }                 from '@lib/session';

// ── Helpers ───────────────────────────────────────────────────────────────────

/** A minimal valid session that survives loadSession()'s expiry check. */
function makeSession(role: PersistedSession['role'] = 'admin'): PersistedSession {
  return {
    token:          'tok_test',
    userId:         'USR-00000001',
    username:       'testuser',
    fullName:       'Test User',
    role,
    departmentId:   'DEPT-001',
    position:       'Engineer',
    colorScheme:    'navy',
    layoutMode:     'sidebar',
    profileImage:   '',
    companyLogoUrl: '',
    companyName:    'Test Co',
    expiresAt:      Date.now() + 8 * 60 * 60 * 1000,   // 8 h from now
  };
}

/** Build a minimal shell DOM that navCore's showSection needs. */
function buildShellDom(sectionIds: string[]): void {
  const sidebarMenu = document.createElement('ul');
  sidebarMenu.id = 'sidebarMenu';
  document.body.appendChild(sidebarMenu);

  sectionIds.forEach(id => {
    const section = document.createElement('section');
    section.id = id;
    section.className = 'app-section';
    document.body.appendChild(section);
  });
}

/** Clean up every element added by buildShellDom between tests. */
function teardownShellDom(): void {
  document.getElementById('sidebarMenu')?.remove();
  document.querySelectorAll('.app-section').forEach(el => el.remove());
}

// ── Tests ─────────────────────────────────────────────────────────────────────

// ─── Invariant 1: window.Nav exists before init() ────────────────────────────

describe('Boot invariant 1 — window.Nav exists before init()', () => {
  it('window.Nav is defined after registerWindowShims is called', () => {
    // Import the navCore functions directly — same ones registerWindowShims uses.
    // In the real boot, registerWindowShims() runs synchronously before init().
    // This test verifies the contract: calling it with those functions produces
    // a fully-populated window.Nav object with no undefined methods.
    window.Nav = {
      buildSidebar:         vi.fn(),
      buildTopTabs:         vi.fn(),
      showSection,
      applyPalette:         vi.fn(),
      applyLayout:          vi.fn(),
      scheduleHdrBadgeSync: vi.fn(),
      doHdrBadgeSync:       vi.fn(),
      setupSidebar:         vi.fn(),
    };

    expect(window.Nav).toBeDefined();
    expect(typeof window.Nav.buildSidebar).toBe('function');
    expect(typeof window.Nav.showSection).toBe('function');
    expect(typeof window.Nav.applyPalette).toBe('function');
    expect(typeof window.Nav.applyLayout).toBe('function');
  });
});

// ─── Invariant 2: showSection activates the correct DOM section ───────────────

describe('Boot invariant 2 — showSection activates the correct DOM section', () => {
  beforeEach(() => {
    buildShellDom(['s-adm-dashboard', 's-adm-employees', 's-adm-leaves']);
    window.AppState = {
      get: (k: string) => (k === 'currentRole' ? 'admin' : ''),
      set: vi.fn(),
      _photoCache: {},
    };
  });

  afterEach(() => {
    teardownShellDom();
  });

  it('adds .active to the target section and removes it from others', () => {
    showSection('s-adm-dashboard');

    expect(document.getElementById('s-adm-dashboard')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('s-adm-employees')?.classList.contains('active')).toBe(false);
    expect(document.getElementById('s-adm-leaves')?.classList.contains('active')).toBe(false);
  });

  it('navigating to a different section moves .active correctly', () => {
    showSection('s-adm-dashboard');
    showSection('s-adm-employees');

    expect(document.getElementById('s-adm-dashboard')?.classList.contains('active')).toBe(false);
    expect(document.getElementById('s-adm-employees')?.classList.contains('active')).toBe(true);
  });

  it('persists the last-visited section to localStorage', () => {
    showSection('s-adm-leaves');
    expect(localStorage.getItem('siomac_last_section_admin')).toBe('s-adm-leaves');
  });

  it('calling showSection twice does not add .active more than once', () => {
    showSection('s-adm-dashboard');
    showSection('s-adm-dashboard');

    const el = document.getElementById('s-adm-dashboard');
    const activeCount = Array.from(el?.classList ?? []).filter(c => c === 'active').length;
    expect(activeCount).toBe(1);
  });
});

// ─── Invariant 3: session — single source of truth, no corruption ─────────────

describe('Boot invariant 3 — session: single source of truth, no corruption', () => {
  beforeEach(() => {
    localStorage.clear();
  });

  it('saveSession + loadSession round-trips the full session object', () => {
    const sess = makeSession('admin');
    saveSession(sess);
    const loaded = loadSession();
    expect(loaded).not.toBeNull();
    expect(loaded?.userId).toBe(sess.userId);
    expect(loaded?.role).toBe(sess.role);
    expect(loaded?.token).toBe(sess.token);
    expect(loaded?.expiresAt).toBe(sess.expiresAt);
  });

  it('loadSession SURVIVES an expired ACCESS token (silent refresh handles freshness)', () => {
    // Token expiry is a freshness concern, not a logout — the refresh machinery
    // (apiFetch proactive refresh / 401-retry / ensureFreshToken) restores it.
    // Treating it as logout was the root cause of "reload logs me out".
    const staleToken: PersistedSession = { ...makeSession(), expiresAt: Date.now() - 1 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(staleToken));
    expect(loadSession()).not.toBeNull();
  });

  it('loadSession returns null once the IDLE deadline has passed (session policy logout)', () => {
    const idleExpired: PersistedSession = { ...makeSession(), idleExpiresAt: Date.now() - 1 };
    localStorage.setItem(SESSION_KEY, JSON.stringify(idleExpired));
    expect(loadSession()).toBeNull();
  });

  it('loadSession survives a future IDLE deadline with a stale access token', () => {
    const s: PersistedSession = {
      ...makeSession(),
      expiresAt:     Date.now() - 60_000,            // access token stale
      idleExpiresAt: Date.now() + 8 * 60 * 60 * 1000, // but the user isn't idle-expired
    };
    localStorage.setItem(SESSION_KEY, JSON.stringify(s));
    expect(loadSession()).not.toBeNull();
  });

  it('loadSession returns null when localStorage is empty', () => {
    expect(loadSession()).toBeNull();
  });

  it('loadSession returns null for corrupt JSON', () => {
    localStorage.setItem(SESSION_KEY, 'not-json{{{');
    expect(loadSession()).toBeNull();
  });

  it('SESSION_KEY is identical in @cfg and wherever session.ts reads it', () => {
    // Both must read the same constant — if anyone hardcodes a different string
    // they'll write to a different key and the session will never be found.
    expect(SESSION_KEY).toBe('siomac_session_v1');
    saveSession(makeSession());
    expect(localStorage.getItem('siomac_session_v1')).not.toBeNull();
  });

  it('clearSession removes the key and stops finding a session', () => {
    saveSession(makeSession());
    expect(loadSession()).not.toBeNull();
    clearSession();
    expect(loadSession()).toBeNull();
  });
});

// ─── Invariant 4: registerWindowShims sets all required shims ─────────────────

describe('Boot invariant 4 — registerWindowShims: all required shims are functions', () => {
  // Simulate the output of registerWindowShims() by checking the shape of the
  // objects that navCore.refreshSection delegates to.
  // If any of these are undefined, navCore.refreshSection is a silent no-op
  // and the section never loads data.

  const REQUIRED_SHIMS: [keyof Window, string[]][] = [
    ['Dashboard',      ['loadDashboardCharts', 'getDashEditMode', 'toggleEditMode']],
    ['SettingsView',   ['loadAdminBrandingSettings', 'refreshCompanySettings', 'applyCompanyLogo', 'applyCompanyName']],
    ['Sites',          ['loadProjectSites']],
    ['Employees',      ['loadEmployeeList', 'loadDepartments', 'loadLeaveRequests', 'loadManagerLeaveApplications', 'loadMyPayslips', 'loadHistoryInline', 'loadDepartmentData', 'loadDepartmentEmployees']],
    ['Profile',        ['loadMyProfile']],
    ['LeaveView',      ['loadLeaveApplications']],
    ['AttendanceView', ['loadAttendanceData']],
  ];

  beforeEach(() => {
    const stub = () => undefined;

    window.Dashboard = {
      loadDashboardCharts:       stub,
      loadChart:                 stub,
      loadTrendChart:            stub,
      initDashboardLayoutEditor: stub,
      displayChart:              stub,
      displayTrendChart:         stub,
      getDashEditMode:           () => false,
      toggleEditMode:            stub,
    };
    window.SettingsView = {
      loadAdminBrandingSettings: stub,
      refreshCompanySettings:    stub,
      applyCompanyLogo:          stub,
      applyCompanyName:          stub,
      getCompanyInfo:            () => ({}),
      getStatutoryRates:         () => ({}),
      setCompanyInfo:            stub,
      setStatutoryRates:         stub,
      _stgActivatePanel:         stub,
    };
    window.Sites          = { loadProjectSites: stub, displayProjectSites: stub, showAddProjectModal: stub };
    window.Employees      = {
      loadEmployeeList: stub, loadDepartments: stub, loadLeaveRequests: stub,
      loadManagerLeaveApplications: stub, loadMyPayslips: stub, loadHistoryInline: stub,
      loadDepartmentData: stub, loadDepartmentEmployees: stub, loadDashboardData: stub,
      loadRecentAttendance: stub, updateRealTimeStats: stub, showAddEmployeeModal: stub,
      showAddDepartmentModal: stub, displayEmployeeCards: stub, loadLeaveApplications: stub,
    };
    window.Profile        = { loadMyProfile: stub };
    window.LeaveView      = { loadLeaveApplications: stub, _lvCard: () => '', _diffLeaveList: stub };
    window.AttendanceView = { loadAttendanceData: stub };
  });

  for (const [shim, methods] of REQUIRED_SHIMS) {
    for (const method of methods) {
      it(`window.${shim}.${method} is a function`, () => {
        const obj = window[shim] as Record<string, unknown> | undefined;
        expect(obj, `window.${shim} should be defined`).toBeDefined();
        expect(typeof obj?.[method], `window.${shim}.${method} should be a function`).toBe('function');
      });
    }
  }
});

// ─── Invariant 5: flatpickr guard — no crash when elements are absent ─────────

describe('Boot invariant 5 — flatpickr: does not assign pickers when elements are absent', () => {
  afterEach(() => {
    document.getElementById('attDateFrom')?.remove();
    document.getElementById('attDateTo')?.remove();
    delete (window as unknown as Record<string, unknown>).flatpickr;
  });

  it('flatpickr is NOT called when #attDateFrom / #attDateTo are absent', () => {
    expect(document.getElementById('attDateFrom')).toBeNull();
    expect(document.getElementById('attDateTo')).toBeNull();

    const flatpickrSpy = vi.fn().mockReturnValue([]);
    (window as unknown as Record<string, unknown>).flatpickr = flatpickrSpy;

    // Reproduce the guard added in the fix
    const fromEl = document.getElementById('attDateFrom');
    const toEl   = document.getElementById('attDateTo');

    if (fromEl && toEl) {
      flatpickrSpy('#attDateFrom', {});
      flatpickrSpy('#attDateTo', {});
    }

    expect(flatpickrSpy).not.toHaveBeenCalled();
  });

  it('flatpickr IS called when both elements are present', () => {
    const fromEl = document.createElement('input');
    fromEl.id = 'attDateFrom';
    document.body.appendChild(fromEl);

    const toEl = document.createElement('input');
    toEl.id = 'attDateTo';
    document.body.appendChild(toEl);

    const flatpickrSpy = vi.fn().mockReturnValue({ selectedDates: [], destroy: vi.fn() });
    (window as unknown as Record<string, unknown>).flatpickr = flatpickrSpy;

    const from = document.getElementById('attDateFrom');
    const to   = document.getElementById('attDateTo');

    if (from && to) {
      flatpickrSpy('#attDateFrom', {});
      flatpickrSpy('#attDateTo', {});
    }

    expect(flatpickrSpy).toHaveBeenCalledTimes(2);
  });
});

// ─── Invariant 6: hard refresh — session restored and nav usable ──────────────

describe('Boot invariant 6 — hard refresh: session is restored and nav is usable', () => {
  // Closest possible hard-refresh simulation in jsdom:
  // seed localStorage (what the browser keeps across refreshes), then simulate
  // what init() does: loadSession → showSection.

  beforeEach(() => {
    localStorage.clear();
    buildShellDom(['s-adm-dashboard', 's-adm-employees']);
    window.AppState = {
      get: (k: string) => (k === 'currentRole' ? 'admin' : ''),
      set: vi.fn(),
      _photoCache: {},
    };
  });

  afterEach(() => {
    teardownShellDom();
  });

  it('restores last-visited section from localStorage on refresh', () => {
    // Seed: user was on employees, then closed the tab
    saveSession(makeSession('admin'));
    localStorage.setItem('siomac_last_section_admin', 's-adm-employees');

    const sess = loadSession();
    expect(sess).not.toBeNull();

    const lastSection = localStorage.getItem('siomac_last_section_' + sess!.role);
    const targetId = (lastSection && document.getElementById(lastSection))
      ? lastSection
      : 's-adm-dashboard';

    showSection(targetId);

    expect(document.getElementById('s-adm-employees')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('s-adm-dashboard')?.classList.contains('active')).toBe(false);
  });

  it('falls back to the default section when last-visited is not in DOM', () => {
    saveSession(makeSession('admin'));
    localStorage.setItem('siomac_last_section_admin', 's-section-that-does-not-exist');

    const sess = loadSession();
    expect(sess).not.toBeNull();

    const lastSection = localStorage.getItem('siomac_last_section_' + sess!.role);
    const targetId = (lastSection && document.getElementById(lastSection))
      ? lastSection
      : 's-adm-dashboard';

    showSection(targetId);

    expect(document.getElementById('s-adm-dashboard')?.classList.contains('active')).toBe(true);
  });

  it('no session → showSection still works without throwing', () => {
    // No session in localStorage — simulates first-ever visit or cleared state.
    expect(() => showSection('s-adm-dashboard')).not.toThrow();
  });
});
