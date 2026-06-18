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
import { useEffect }   from 'preact/hooks';

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
import { mountNotificationsPanel } from './NotificationsPanel';
import { mountMessagesPanel }      from './MessagesPanel';
import { mountTicketsPanel }       from './TicketsPanel';

// ── Shared header modals (one set, shared by every profile pill) ─────────────

const HDR_MODALS = ['hdrNotifModal', 'hdrMsgModal', 'hdrTicketModal'] as const;

type Win = Record<string, unknown>;

function callWin(name: string, ...args: unknown[]): void {
  const fn = (window as unknown as Win)[name];
  if (typeof fn === 'function') (fn as (...a: unknown[]) => void)(...args);
}

export function NavController(): h.JSX.Element {

  useEffect(() => {
    const cleanups: Array<() => void> = [];

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

    // ── 3. Sidebar collapse / expand toggle ─────────────────────────────────
    const sidebar     = document.getElementById('sidebar');
    const toggleBtn   = document.getElementById('sidebarToggleBtn');
    const toggleIcon  = document.getElementById('sidebarToggleIcon');

    if (sidebar && toggleIcon) {
      if (localStorage.getItem('sb_collapsed') === '1') {
        sidebar.classList.add('collapsed');
        toggleIcon.className = 'fas fa-chevron-right';
      }
    }

    function onSidebarToggle(): void {
      if (!sidebar || !toggleIcon) return;
      const collapsed = sidebar.classList.toggle('collapsed');
      toggleIcon.className = 'fas fa-chevron-' + (collapsed ? 'right' : 'left');
      localStorage.setItem('sb_collapsed', collapsed ? '1' : '0');
      callWin('updateSessionWidget');
    }
    toggleBtn?.addEventListener('click', onSidebarToggle);
    cleanups.push(() => toggleBtn?.removeEventListener('click', onSidebarToggle));

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
        showSection(btn.dataset['section'] ?? '');
        setMobileOpen(false);
      }
    }
    sidebarMenu?.addEventListener('click', onSidebarMenuClick);
    cleanups.push(() => sidebarMenu?.removeEventListener('click', onSidebarMenuClick));

    // ── 6. Top-tabs click delegation ─────────────────────────────────────────
    const topTabs = document.getElementById('topTabs');

    function onTopTabsClick(e: Event): void {
      const btn = (e.target as Element).closest<HTMLElement>('button[data-section]');
      if (btn) showSection(btn.dataset['section'] ?? '');
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

    /** Run the per-kind post-open setup (fetch lists, reset panes). */
    function afterOpen(kind: HdrKind): void {
      if (kind === 'ticket') {
        setTimeout(() => {
          const tl = document.getElementById('ticketList');
          const tf = document.getElementById('ticketModalFoot');
          const td = document.getElementById('ticketDetailPane');
          const tc = document.getElementById('ticketComposePane');
          if (tl) tl.style.display = '';
          if (tf) tf.style.display = '';
          if (td) td.style.display = 'none';
          if (tc) tc.style.display = 'none';
          callWin('_clearTicketDetail');
          callWin('_ticketModalOpened');
        }, 0);
      } else if (kind === 'notif') {
        callWin('_fetchNotifs');
        callWin('_notifModalOpened');
      } else {
        setTimeout(() => {
          const ml = document.getElementById('msgList');
          const mf = document.getElementById('msgModalFoot');
          const md = document.getElementById('msgDetailPane');
          const mc = document.getElementById('msgComposePane');
          if (ml) ml.style.display = '';
          if (mf) mf.style.display = '';
          if (md) md.style.display = 'none';
          if (mc) mc.style.display = 'none';
          callWin('_clearMsgDetail');
          callWin('_msgModalOpened');
        }, 0);
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
        modalBox.style.top   = (bRect.bottom + gap) + 'px';
        modalBox.style.left  = left + 'px';
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
      const kind = trigger.dataset['pillAction'] as HdrKind | undefined;
      if (kind !== 'notif' && kind !== 'msg' && kind !== 'ticket') return;
      e.stopPropagation();
      toggleHdrModal(trigger, kind);
    }
    document.addEventListener('click', onPillActionClick);
    cleanups.push(() => document.removeEventListener('click', onPillActionClick));

    // ── 8. Global click — close modals when clicking outside ─────────────────
    const CLOSE_CB: Record<string, string> = {
      hdrMsgModal: '_msgModalClosed', hdrTicketModal: '_ticketModalClosed', hdrNotifModal: '_notifModalClosed',
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

    // ── 11. Theme toggle (light / dark) ──────────────────────────────────────
    const btnLight = document.getElementById('dashThemeLight');
    const btnDark  = document.getElementById('dashThemeDark');

    function applyTheme(t: string): void {
      document.body.setAttribute('data-theme', t);
      btnLight?.classList.toggle('active', t === 'light');
      btnDark?.classList.toggle('active',  t === 'dark');
      localStorage.setItem('siomac-theme', t);
    }

    if (btnLight && btnDark) {
      const saved = localStorage.getItem('siomac-theme') ?? 'light';
      applyTheme(saved);

      function onThemeLight(): void { applyTheme('light'); }
      function onThemeDark():  void { applyTheme('dark');  }
      btnLight.addEventListener('click', onThemeLight);
      btnDark.addEventListener('click',  onThemeDark);
      cleanups.push(() => {
        btnLight.removeEventListener('click', onThemeLight);
        btnDark.removeEventListener('click',  onThemeDark);
      });
    }

    // ── 12. Mount the three panel systems ────────────────────────────────────
    const cleanupNotifs  = mountNotificationsPanel();
    const cleanupMsgs    = mountMessagesPanel();
    const cleanupTickets = mountTicketsPanel();
    cleanups.push(cleanupNotifs, cleanupMsgs, cleanupTickets);

    // ── 13. Expose Nav shim on window ─────────────────────────────────────────
    //    Other scripts call window.Nav.buildSidebar etc. after login.
    (window as unknown as Win)['Nav'] = {
      buildSidebar,
      buildTopTabs,
      showSection,
      applyPalette,
      applyLayout,
      scheduleHdrBadgeSync,
      doHdrBadgeSync,
      setupSidebar: () => { /* already set up by NavController */ },
    };

    // ── Cleanup ───────────────────────────────────────────────────────────────
    return () => {
      cleanups.forEach(fn => fn());
    };
  // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []); // run once on mount

  return h(Fragment, null);
}
