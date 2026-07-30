/**
 * src/components/nav/NavController.tsx
 *
 * Headless Preact component — renders nothing visible, but wires all nav
 * behaviour into the existing app-shell.html DOM via useEffect.
 *
 * Mounts the three panel systems (notifications / messages / tickets) and
 * sets up sidebar collapse, mobile backdrop, header-icon modals, theme
 * toggle, profile button, and the dashboard date stamp.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { h, Fragment } from 'preact';
import { useEffect, useRef } from 'preact/hooks';
import { useSessionStore } from '@store/session';

import {
  buildSidebar,
  buildTopTabs,
  showSection,
  applyPalette,
  applyLayout,
  getLayout,
  getRole,
} from './navCore';
import { scheduleHdrBadgeSync, doHdrBadgeSync } from './badgeSync';
import { markNavReady } from '@lib/sectionRestore';

// ── Shared header modals (one set, shared by every profile pill) ─────────────

const HDR_MODALS = ['hdrNotifModal', 'hdrMsgModal', 'hdrTicketModal'] as const;

type Win = Record<string, unknown>;

function callWin(name: string, ...args: unknown[]): void {
  const fn = (window as unknown as Win)[name];
  if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args);
}

/**
 * A stable signature of everything that affects nav-item permission gating: the
 * per-user overrides (incl. compliance validity/revocation) + the role's default
 * set + the role. When this changes, the imperative sidebar must be rebuilt.
 */
function permissionSignature(s: ReturnType<typeof useSessionStore.getState>): string {
  return s.permissionOverrides
    .map(o => `${o.permission}|${String(o.granted)}|${o.revoked_at ?? ''}|${o.valid_from ?? ''}|${o.valid_until ?? ''}`)
    .sort().join(';')
    + '::' + [...s.rolePermissions].sort().join(',')
    + '::' + (s.role ?? '');
}

export function NavController(): h.JSX.Element {

  // The sidebar / top-tabs are built imperatively into the DOM once, and their
  // per-item permission gates (canAccessModuleNavItem → can()) are evaluated at
  // build time. A permission change (grant/revoke via refreshPermissionOverrides,
  // the boundary timer, token-refresh) updates the store but would NOT rebuild the
  // raw-DOM nav — so a newly-granted item (e.g. Approvals) would stay hidden until
  // reload. Rebuild when the effective permission signature actually changes.
  const permSig = useRef(permissionSignature(useSessionStore.getState()));
  useEffect(() => useSessionStore.subscribe(s => {
    const next = permissionSignature(s);
    if (next === permSig.current) return;
    permSig.current = next;
    const role = getRole();
    if (!role) return;
    buildSidebar(role);
    if (getLayout() === 'tabs') buildTopTabs(role);
    // The rebuild replaced the sidebar DOM, dropping every badge. Re-sync so counts
    // (leave, Approvals, …) reappear on the new buttons immediately, not after the
    // next poll — the per-button badge cache no longer suppresses this (WeakMap).
    scheduleHdrBadgeSync();
  }), []);

  useEffect(() => {
    const cleanups: (() => void)[] = [];

    // ── 1. Build sidebar / top-tabs from config ─────────────────────────────
    const role = getRole();
    if (role) {
      buildSidebar(role);
      const layout = getLayout();
      applyLayout(layout);
      if (layout === 'tabs') buildTopTabs(role);
    }

    // ── 2. Apply saved palette ──────────────────────────────────────────────
    applyPalette(
      (window as unknown as { AppState?: { get: (k: string) => string } })
        .AppState?.get('currentColorScheme') ?? 'navy',
    );

    // ── 3. Sidebar element ───────────────────────────────────────────────────
    const sidebar = document.getElementById('sidebar');

    // ── 4. Mobile open/close ─────────────────────────────────────────────────
    const backdrop    = document.getElementById('sidebarBackdrop');
    const mobileBtn   = document.getElementById('mobileMenuBtn');

    function setMobileOpen(open: boolean): void {
      sidebar?.classList.toggle('mobile-open', open);
      backdrop?.classList.toggle('active', open);
    }

    function onMobileMenuClick(): void {
      setMobileOpen(!sidebar?.classList.contains('mobile-open'));
    }
    function onBackdropClick(): void { setMobileOpen(false); }

    mobileBtn?.addEventListener('click',   onMobileMenuClick);
    backdrop?.addEventListener('click',    onBackdropClick);
    cleanups.push(() => {
      mobileBtn?.removeEventListener('click',  onMobileMenuClick);
      backdrop?.removeEventListener('click',   onBackdropClick);
    });

    // ── 5. Sidebar menu item clicks → showSection ───────────────────────────
    const sidebarMenu = document.getElementById('sidebarMenu');

    function onSidebarMenuClick(e: Event): void {
      const btn = (e.target as Element).closest<HTMLElement>('button[data-section]');
      if (btn) {
        showSection(btn.dataset.section ?? '');
        setMobileOpen(false);
      }
    }
    sidebarMenu?.addEventListener('click', onSidebarMenuClick);
    cleanups.push(() => sidebarMenu?.removeEventListener('click', onSidebarMenuClick));

    // ── 6. Top-tabs click delegation ─────────────────────────────────────────
    const topTabs = document.getElementById('topTabs');

    function onTopTabsClick(e: Event): void {
      const btn = (e.target as Element).closest<HTMLElement>('button[data-section]');
      if (btn) showSection(btn.dataset.section ?? '');
    }
    topTabs?.addEventListener('click', onTopTabsClick);
    cleanups.push(() => topTabs?.removeEventListener('click', onTopTabsClick));

    // ── 7. Header-icon modal open / close ────────────────────────────────────

    function closeAllModals(): void {
      HDR_MODALS.forEach(modal => document.getElementById(modal)?.classList.remove('open'));
      document.querySelectorAll('[data-pill-action].active').forEach(b => b.classList.remove('active'));
    }

    type HdrKind = 'notif' | 'msg' | 'ticket';
    const MODAL_FOR: Record<HdrKind, string> = { notif: 'hdrNotifModal', msg: 'hdrMsgModal', ticket: 'hdrTicketModal' };

    /** Run the per-kind post-open setup. Dropdowns self-fetch through Query. */
    function afterOpen(kind: HdrKind): void {
      if (kind === 'notif') {
        // The bell is the self-fetching Preact <NotificationDropdown> mounted
        // into #hdrNotifModal — it loads via TanStack Query on open, so there is
        // no imperative post-open work here.
      } else if (kind === 'msg') {
        // The message modal is now the self-fetching Preact <MessageDropdown>
        // mounted into #hdrMsgModal — no imperative post-open work needed.
      }
    }

    /**
     * Toggle a shared header modal, positioned under `triggerEl`. Driven by the
     * delegated [data-pill-action] handler, so every <ProfilePill> works with no
     * id registration.
     */
    function toggleHdrModal(triggerEl: HTMLElement, kind: HdrKind): void {
      const m = document.getElementById(MODAL_FOR[kind]);
      if (!m) return;
      const isOpen = m.classList.contains('open');
      closeAllModals();
      if (isOpen) return;
      const modalBox = m.querySelector<HTMLElement>('.hdr-modal');
      if (modalBox) {
        const bRect  = triggerEl.getBoundingClientRect();
        const mWidth = modalBox.offsetWidth || parseInt(modalBox.style.width, 10) || 360;
        const gap = 12, pad = 10;
        let left = bRect.left + bRect.width / 2 - mWidth / 2;
        left = Math.max(pad, Math.min(left, window.innerWidth - mWidth - pad));
        modalBox.style.top   = `${bRect.bottom + gap}px`;
        modalBox.style.left  = `${left}px`;
        modalBox.style.right = 'auto';
      }
      m.classList.add('open');
      triggerEl.classList.add('active');
      afterOpen(kind);
    }

    // Every profile pill (one shared <ProfilePill> component) drives the shared
    // modals via delegated, id-free clicks. Any element with
    // data-pill-action="notif|msg|ticket" opens the matching shared modal.
    function onPillActionClick(e: Event): void {
      const trigger = (e.target as Element).closest<HTMLElement>('[data-pill-action]');
      if (!trigger) return;
      const kind = trigger.dataset.pillAction as HdrKind | undefined;
      if (kind !== 'notif' && kind !== 'msg' && kind !== 'ticket') return;
      e.stopPropagation();
      toggleHdrModal(trigger, kind);
    }
    document.addEventListener('click', onPillActionClick);
    cleanups.push(() => document.removeEventListener('click', onPillActionClick));

    // ── 8. Global click — close modals when clicking outside ─────────────────
    const CLOSE_CB: Record<string, string> = {
      hdrMsgModal: '_msgModalClosed', hdrNotifModal: '_notifModalClosed',
    };
    function onDocClickForModals(e: Event): void {
      const target = e.target as Element;
      const openModal = HDR_MODALS.find(id => document.getElementById(id)?.classList.contains('open'));

      if (target.closest('.hdr-modal-close')) {
        closeAllModals();
      } else if (!target.closest('[data-pill-action]') && !target.closest('.hdr-icon-group') && !target.closest('.hdr-modal')) {
        closeAllModals();
      } else {
        return; // click was inside an open modal or a pill icon — do nothing
      }

      if (openModal && CLOSE_CB[openModal]) callWin(CLOSE_CB[openModal]);
    }
    document.addEventListener('click', onDocClickForModals);
    cleanups.push(() => document.removeEventListener('click', onDocClickForModals));

    // ── 9. Dashboard today date ──────────────────────────────────────────────
    const dashDate = document.getElementById('dashTodayDate');
    const dashDay  = document.getElementById('dashTodayDay');
    if (dashDate) {
      const now = new Date();
      dashDate.textContent = new Intl.DateTimeFormat('en-US', { month: 'long', day: 'numeric', year: 'numeric' }).format(now);
      if (dashDay) dashDay.textContent = new Intl.DateTimeFormat('en-US', { weekday: 'long' }).format(now);
    }

    // ── 11. Theme toggle — REMOVED. Per-user light/dark is owned by the
    //    AccountPill (store setTheme → system.user_theme in the DB). The old
    //    #dashThemeLight/#dashThemeDark buttons and their localStorage path are gone.

    // ── 12. Mount the panel systems ───────────────────────────────────────────
    //    Notifications render via Preact <NotificationDropdown> (main.tsx) — retired.
    //    Messages now render via Preact <MessageDropdown> (main.tsx) — retired.

    // ── 13. Expose Nav shim on window ─────────────────────────────────────────
    //    Other scripts call window.Nav.buildSidebar etc. after login.
    (window as unknown as Win).Nav = {
      buildSidebar,
      buildTopTabs,
      showSection,
      applyPalette,
      applyLayout,
      scheduleHdrBadgeSync,
      doHdrBadgeSync,
      setupSidebar: () => { /* already set up by NavController */ },
    };
    // The shim is installed LAST in this effect, and AttendanceSystem.init() runs
    // BEFORE this component mounts — so boot-time navigation (refresh restoration)
    // waits on this one-shot signal instead of firing into an undefined window.Nav.
    markNavReady();

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cleanups.forEach(fn => fn());
    };
   
  }, []); // run once on mount

  return h(Fragment, null);
}
