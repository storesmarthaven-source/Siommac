/**
 * src/lib/sectionRestore.test.ts
 *
 * Refresh-restoration regressions.
 *
 * The failure this pins: a hard refresh never restored Employee Master. Two independent
 * causes, both asserted below.
 *
 *   • The stored value is a LOGICAL nav id (`s-hr-employees`). A registered module serves
 *     every one of its nav items from one panel (`#s-hr`), so the old
 *     `document.getElementById(storedId)` validation was null for every module-backed
 *     subsection — the boot discarded a perfectly valid target and fell back to the role's
 *     first section (or to no active panel at all, i.e. a blank page).
 *
 *   • `AttendanceSystem.init()` runs BEFORE NavController installs `window.Nav`, so the
 *     restore call was a silent no-op. It now waits on the one-shot `siomac:nav-ready`
 *     event — a barrier, so the tests below assert it fires exactly once and with no timer.
 */

import { describe, it, expect, beforeEach, afterEach, vi } from 'vitest';
import { showSection } from '@components/nav/navCore';
import {
  NAV_READY_EVENT, isNavReady, markNavReady, readLastSection,
  resolveRestorableSection, sectionPanelId, whenNavReady,
} from './sectionRestore';
import '@sections/HR';   // self-registers the HR module (s-hr-* → #s-hr)
import '@sections/HSE';  // self-registers the HSE module (s-hse-* → #s-hse)

/** The shell panels a signed-in admin has in the DOM. */
function buildShellDom(panelIds: string[]): void {
  const menu = document.createElement('ul');
  menu.id = 'sidebarMenu';
  menu.className = 'sidebar-menu';
  document.body.appendChild(menu);
  for (const id of panelIds) {
    const panel = document.createElement('section');
    panel.id = id;
    panel.className = 'app-section';
    document.body.appendChild(panel);
  }
}

const PANELS = ['s-adm-dashboard', 's-hr', 's-hse', 's-settings'];

beforeEach(() => {
  localStorage.clear();
  buildShellDom(PANELS);
  window.AppState = { get: (k: string) => (k === 'currentRole' ? 'admin' : ''), set: vi.fn(), _photoCache: {} };
});

afterEach(() => {
  document.getElementById('sidebarMenu')?.remove();
  document.querySelectorAll('.app-section').forEach(el => el.remove());
  delete (window as Partial<Window>).Nav;
  vi.restoreAllMocks();
});

// ── The canonical logical-id → panel mapping ───────────────────────────────────

describe('sectionPanelId — the canonical module/section mapping', () => {
  it('maps every module-backed subsection to its module mount panel', () => {
    expect(sectionPanelId('s-hr-employees')).toBe('s-hr');
    expect(sectionPanelId('s-hr-onboarding')).toBe('s-hr');
    expect(sectionPanelId('s-hr-attendance')).toBe('s-hr');
    expect(sectionPanelId('s-hse-dashboard')).toBe('s-hse');
  });

  it('leaves a plain section id alone', () => {
    expect(sectionPanelId('s-adm-dashboard')).toBe('s-adm-dashboard');
    expect(sectionPanelId('s-settings')).toBe('s-settings');
  });
});

// ── Restoration ───────────────────────────────────────────────────────────────

describe('resolveRestorableSection', () => {
  it('restores Employee Master after a direct refresh', () => {
    localStorage.setItem('siomac_last_section_admin', 's-hr-employees');

    const target = resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard');

    // The LOGICAL id survives — the module shell needs it to pick the right page.
    expect(target).toBe('s-hr-employees');
    showSection(target);
    expect(document.getElementById('s-hr')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('s-adm-dashboard')?.classList.contains('active')).toBe(false);
  });

  it('broadcasts the logical id so the HR shell renders Employee Master, not the module default', () => {
    const seen: string[] = [];
    const onSection = (e: Event): void => { seen.push((e as CustomEvent<string>).detail); };
    window.addEventListener('siomac:section', onSection);
    try {
      localStorage.setItem('siomac_last_section_admin', 's-hr-employees');
      showSection(resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard'));
    } finally {
      window.removeEventListener('siomac:section', onSection);
    }
    expect(seen).toContain('s-hr-employees');
  });

  it('restores another module-backed subsection the same way', () => {
    localStorage.setItem('siomac_last_section_admin', 's-hr-attendance');
    const attendance = resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard');
    expect(attendance).toBe('s-hr-attendance');
    showSection(attendance);
    expect(document.getElementById('s-hr')?.classList.contains('active')).toBe(true);

    localStorage.setItem('siomac_last_section_admin', 's-hse-dashboard');
    const hse = resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard');
    expect(hse).toBe('s-hse-dashboard');
    showSection(hse);
    expect(document.getElementById('s-hse')?.classList.contains('active')).toBe(true);
    expect(document.getElementById('s-hr')?.classList.contains('active')).toBe(false);
  });

  it('restores a plain (non-module) section', () => {
    localStorage.setItem('siomac_last_section_admin', 's-settings');
    expect(resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard')).toBe('s-settings');
  });

  it('falls back safely for a stored section that resolves to no panel', () => {
    // A renamed/removed section, a typo'd id, an empty value, and whitespace all land on
    // the role's default rather than on a dead panel.
    for (const stored of ['s-section-that-does-not-exist', 's-hr-employees-typo', 's-hr', '', '   ']) {
      localStorage.setItem('siomac_last_section_admin', stored);
      const resolved = resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard');
      // `s-hr` is the panel, not a nav id — but it IS in the DOM, so it stays valid.
      expect(resolved, stored).toBe(stored === 's-hr' ? 's-hr' : 's-adm-dashboard');
    }
  });

  it('falls back when a module IS registered but its panel is absent from the shell', () => {
    // A role whose shell does not mount the HR panel must not be routed into a missing panel.
    document.getElementById('s-hr')?.remove();
    localStorage.setItem('siomac_last_section_admin', 's-hr-employees');
    expect(resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard')).toBe('s-adm-dashboard');
  });

  it('falls back when nothing was stored at all', () => {
    expect(readLastSection('admin')).toBeNull();
    expect(resolveRestorableSection(null, 's-adm-dashboard')).toBe('s-adm-dashboard');
  });
});

// ── The window.Nav readiness barrier ──────────────────────────────────────────

describe('whenNavReady — the boot-order barrier', () => {
  it('reports Nav as not ready before NavController installs the shim', () => {
    expect(isNavReady()).toBe(false);
  });

  it('defers a restore issued before window.Nav exists, then runs it exactly once', () => {
    localStorage.setItem('siomac_last_section_admin', 's-hr-employees');
    const showSectionSpy = vi.fn();

    // This is the real boot order: init() restores while window.Nav is still undefined.
    whenNavReady(nav => nav.showSection?.(resolveRestorableSection(readLastSection('admin'), 's-adm-dashboard')));
    expect(showSectionSpy).not.toHaveBeenCalled();

    window.Nav = { showSection: showSectionSpy };
    markNavReady();

    expect(showSectionSpy).toHaveBeenCalledExactlyOnceWith('s-hr-employees');

    // One-shot: a later announcement must not re-navigate and clobber the user's page.
    markNavReady();
    expect(showSectionSpy).toHaveBeenCalledOnce();
  });

  it('runs synchronously when Nav is already installed — no timer, no polling', () => {
    const setTimeoutSpy = vi.spyOn(window, 'setTimeout');
    const showSectionSpy = vi.fn();
    window.Nav = { showSection: showSectionSpy };

    whenNavReady(nav => nav.showSection?.('s-settings'));

    expect(showSectionSpy).toHaveBeenCalledExactlyOnceWith('s-settings');
    expect(setTimeoutSpy).not.toHaveBeenCalled();
  });

  it('uses the documented one-shot event as its only signal', () => {
    const listener = vi.fn();
    window.addEventListener(NAV_READY_EVENT, listener);
    try {
      markNavReady();
    } finally {
      window.removeEventListener(NAV_READY_EVENT, listener);
    }
    expect(listener).toHaveBeenCalledOnce();
  });
});
