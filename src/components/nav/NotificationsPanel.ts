/**
 * src/components/nav/NotificationsPanel.ts
 *
 * Notifications system — Phase 2c upgrade.
 *
 * PHASE 2c CHANGES (vs Phase 1b):
 *   - Data source: legacy `getNotifications()` (Netlify) → `getMyNotifications(userId)` (Supabase direct)
 *   - Read tracking: localStorage set → `is_read` field from DB + `markAsRead()` mutation
 *   - Mark all: localStorage → `markAllAsRead(userId)` + `useNotificationStore.onPanelOpen()`
 *   - Clear/delete: localStorage → `deleteNotification()` / `clearAllNotifications()`
 *   - Realtime: wired via `initNotificationsRealtime()` called in `auth.ts` on login
 *   - Poll fallback: `useUnreadCount()` (staleTime 10s, refetchInterval 60s) via Zustand store
 *
 * The imperative DOM rendering is intentionally preserved so the existing
 * app-shell HTML structure (ids: notifList, notifMarkAllBtn, etc.) continues
 * to work without changes to the shell template.
 *
 * @see docs/ARCHITECTURE.md §10-Realtime
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 * @see docs/PHASE_PLAN.md §Phase-2c
 */

import { getMyNotifications, markAsRead, markAllAsRead, deleteNotification, clearAllNotifications } from '@api/notifications';
import { useSessionStore }      from '@store/session';
import { useNotificationStore } from '@store/notifications';
import { getQueryClient }       from '@lib/queryClient';
import { notificationKeys }     from '@api/queryKeys';
import { setHdrBadge, refreshNavBadges, getRole, esc } from './navCore';
import { showSection } from './navCore';
import type { NotificationRow, NotificationType } from '@api/schemas/notification';

function updateNotifBadges(count: number): void {
  // Profile-pill notif badges are id-free (data-pill-badge), set on every pill.
  document.querySelectorAll('[data-pill-badge="notif"]').forEach(el => setHdrBadge(el, count));
}

// ── Notification type → section mapping ──────────────────────────────────────

const TYPE_SECTION: Partial<Record<NotificationType, () => string | null>> = {
  attendance_late:            () => getRole() === 'admin' || getRole() === 'manager' ? 's-adm-attendance' : null,
  attendance_absent:          () => getRole() === 'admin' || getRole() === 'manager' ? 's-adm-attendance' : null,
  attendance_missed_checkout: () => getRole() === 'admin' || getRole() === 'manager' ? 's-adm-attendance' : 's-emp-attendance',
  leave_approved:             () => 's-emp-leave',
  leave_rejected:             () => 's-emp-leave',
  leave_pending:              () => getRole() === 'admin' ? 's-adm-leaves' : getRole() === 'manager' ? 's-mgr-leaves' : null,
  payroll_published:          () => 's-emp-payroll',
  system_announcement:        () => null,
  mention:                    () => null,
};

const TYPE_ICON: Record<NotificationType, string> = {
  attendance_late:            'fa-clock',
  attendance_absent:          'fa-user-times',
  attendance_missed_checkout: 'fa-sign-out-alt',
  leave_approved:             'fa-check-circle',
  leave_rejected:             'fa-times-circle',
  leave_pending:              'fa-hourglass-half',
  payroll_published:          'fa-money-bill-wave',
  system_announcement:        'fa-bullhorn',
  mention:                    'fa-at',
};

const TYPE_COLOR: Record<NotificationType, string> = {
  attendance_late:            'orange',
  attendance_absent:          'red',
  attendance_missed_checkout: 'orange',
  leave_approved:             'green',
  leave_rejected:             'red',
  leave_pending:              'navy',
  payroll_published:          'green',
  system_announcement:        'navy',
  mention:                    'purple',
};

// ── Helpers ───────────────────────────────────────────────────────────────────

function timeAgo(iso: string): string {
  if (!iso) return '';
  const d = new Date(iso);
  if (isNaN(d.getTime())) return '';
  const diff = Math.floor((Date.now() - d.getTime()) / 1000);
  if (diff < 60)    return 'Just now';
  if (diff < 3600)  return Math.floor(diff / 60) + ' min ago';
  if (diff < 86400) return Math.floor(diff / 3600) + 'h ago';
  return Math.floor(diff / 86400) + 'd ago';
}

function getUserId(): string | null {
  return useSessionStore.getState().userId;
}

// ── Main export ───────────────────────────────────────────────────────────────

export function mountNotificationsPanel(): () => void {
  let _data: NotificationRow[] = [];
  let _loaded                  = false;
  let _lastHash                = '';
  let _unsubStore: (() => void) | null = null;

  // ── Render ──────────────────────────────────────────────────────────────────

  function render(): void {
    const list = document.getElementById('notifList');
    if (!list) return;
    if (!_data.length) {
      _lastHash = '';
      if (_loaded) {
        list.innerHTML =
          '<div class="hdr-notif-empty"><i class="fas fa-bell-slash"></i><p>No notifications</p></div>';
      }
      return;
    }

    const hash = _data.map(n => n.id + (n.is_read ? 'r' : 'u')).join(',');
    if (hash === _lastHash) return;
    _lastHash = hash;

    function rowHtml(n: NotificationRow): string {
      const type    = n.type as NotificationType;
      const icon    = TYPE_ICON[type] ?? 'fa-bell';
      const color   = TYPE_COLOR[type] ?? 'navy';
      const section = TYPE_SECTION[type]?.() ?? null;
      const link    = n.link ?? section ?? '';
      const isRead  = n.is_read;

      const bodyPreview = n.body
        ? `<div class="hdr-notif-sub" style="margin-top:3px;font-style:italic;opacity:.85;white-space:nowrap;overflow:hidden;text-overflow:ellipsis;">"${esc(n.body)}"</div>`
        : '';

      return `<div
        class="hdr-notif-item${isRead ? ' read' : ' unread'}"
        data-id="${esc(n.id)}"
        data-notif-id="${esc(n.id)}"
        ${section ? `data-notif-section="${esc(section)}"` : ''}
        ${n.link  ? `data-notif-link="${esc(n.link)}"` : ''}
        style="cursor:${link ? 'pointer' : 'default'}">
          <div class="hdr-notif-icon ${esc(color)}"><i class="fas ${esc(icon)}"></i></div>
          <div class="hdr-notif-text" style="flex:1;min-width:0;">
            <div class="hdr-notif-title">${esc(n.title)}</div>
            ${bodyPreview}
            <div class="hdr-notif-sub" style="margin-top:2px;opacity:.7">${timeAgo(n.created_at ?? '')}</div>
          </div>
          ${!isRead ? '<div class="hdr-notif-dot"></div>' : ''}
      </div>`;
    }

    // Diff against existing DOM rows for minimal reflows
    const existing = new Map<string, Element>();
    list.querySelectorAll<HTMLElement>('[data-id]').forEach(el => {
      existing.set(el.dataset['id'] ?? '', el);
    });

    const frag = document.createDocumentFragment();
    _data.forEach(n => {
      const key    = (n.is_read ? 'r' : 'u') + '|' + n.id;
      let domEl: Element | undefined = existing.get(n.id);
      if (!domEl || (domEl as HTMLElement).dataset['rowKey'] !== key) {
        const tmp     = document.createElement('div');
        tmp.innerHTML = rowHtml(n);
        const child   = tmp.firstElementChild;
        if (child) domEl = child;
      }
      if (domEl) {
        (domEl as HTMLElement).dataset['rowKey'] = key;
        frag.appendChild(domEl);
      }
    });
    list.innerHTML = '';
    list.appendChild(frag);

    // Update bell badge from store (Realtime increments, markAll resets)
    const unread = _data.filter(n => !n.is_read).length;
    updateNotifBadges(unread);
  }

  // ── Fetch ────────────────────────────────────────────────────────────────────

  async function fetchNotifs(): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    try {
      const rows = await getMyNotifications(userId);
      _data   = rows;
      _loaded = true;
      render();
      // Sync the Zustand store unread count
      const unread = rows.filter(r => !r.is_read).length;
      useNotificationStore.setState({ unreadCount: unread });
    } catch {
      // degrade silently — old data stays visible
    }
  }

  // ── Wire DOM buttons ─────────────────────────────────────────────────────────

  const markAllBtn = document.getElementById('notifMarkAllBtn');
  async function onMarkAll(): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    try {
      await markAllAsRead(userId);
      _data     = _data.map(n => ({ ...n, is_read: true }));
      _lastHash = '';
      render();
      useNotificationStore.setState({ unreadCount: 0 });
      void getQueryClient().invalidateQueries({ queryKey: notificationKeys.mine() });
      void getQueryClient().invalidateQueries({ queryKey: notificationKeys.unread() });
    } catch {
      // badge stays as-is on error
    }
  }
  function onMarkAllClick(): void { void onMarkAll(); }
  markAllBtn?.addEventListener('click', onMarkAllClick);

  const clearAllBtn = document.getElementById('notifClearAllBtn');
  async function onClearAll(): Promise<void> {
    const userId = getUserId();
    if (!userId) return;
    try {
      await clearAllNotifications(userId);
      _data     = [];
      _lastHash = '';
      _loaded   = true;
      render();
      useNotificationStore.setState({ unreadCount: 0, items: [] });
      void getQueryClient().invalidateQueries({ queryKey: notificationKeys.all });
    } catch {
      // ignore
    }
  }
  function onClearAllClick(): void { void onClearAll(); }
  clearAllBtn?.addEventListener('click', onClearAllClick);

  const refreshBtn = document.getElementById('notifRefreshBtn');
  function onRefresh(): void {
    (window as unknown as { _spinBtn?: (id: string) => void })._spinBtn?.('notifRefreshBtn');
    void fetchNotifs();
  }
  refreshBtn?.addEventListener('click', onRefresh);

  function onItemClick(e: Event): void {
    const item = (e.target as Element).closest<HTMLElement>('.hdr-notif-item[data-notif-id]');
    if (!item) return;

    const id      = item.dataset['notifId'] ?? '';
    const section = item.dataset['notifSection'] ?? '';
    const link    = item.dataset['notifLink'] ?? '';

    // Mark as read in DB (fire-and-forget)
    const userId = getUserId();
    if (userId && id) {
      void markAsRead(id).then(() => {
        _data = _data.map(n => n.id === id ? { ...n, is_read: true } : n);
        const unread = _data.filter(n => !n.is_read).length;
        useNotificationStore.setState({ unreadCount: unread });
        _lastHash = '';
        render();
        void getQueryClient().invalidateQueries({ queryKey: notificationKeys.mine() });
        void getQueryClient().invalidateQueries({ queryKey: notificationKeys.unread() });
      }).catch(() => {
        // optimistic mark — flip locally even on error
        _data = _data.map(n => n.id === id ? { ...n, is_read: true } : n);
        _lastHash = '';
        render();
      });
    }

    // Close the modal
    const modal = document.getElementById('hdrNotifModal');
    const btn   = document.getElementById('hdrNotifBtn');
    modal?.classList.remove('open');
    btn?.classList.remove('active');
    useNotificationStore.getState().onPanelClose();

    // Navigate
    if (link) {
      window.open(link, '_blank');
    } else if (section) {
      if (section.startsWith('__modal:')) {
        const modalId     = section.slice('__modal:'.length);
        const targetModal = document.getElementById(modalId);
        const targetBtn   = document.getElementById(modalId.replace('Modal', 'Btn'));
        targetModal?.classList.add('open');
        targetBtn?.classList.add('active');
      } else {
        showSection(section);
      }
    }
  }
  document.addEventListener('click', onItemClick);

  // ── Subscribe to Zustand notification store for Realtime-driven re-renders ──
  //    When `onNewNotification()` fires (Realtime INSERT), we refetch so the
  //    panel list updates automatically even if it's closed.
  _unsubStore = useNotificationStore.subscribe((state, prev) => {
    if (state.unreadCount !== prev.unreadCount) {
      updateNotifBadges(state.unreadCount);
      // Pulse the bell icon if count increased
      if (state.unreadCount > prev.unreadCount) {
        const bell = document.getElementById('hdrNotifBtn');
        if (bell) {
          bell.classList.add('notif-bell-pulse');
          setTimeout(() => bell.classList.remove('notif-bell-pulse'), 1000);
        }
        // Refetch so the list shows the new item if the panel is open
        void fetchNotifs();
      }
    }
  });

  // ── Expose globals (backward compat with NavController + legacy scripts) ─────
  const win = window as unknown as Record<string, unknown>;

  win['_fetchNotifs']        = () => { void fetchNotifs(); };
  win['_renderNotifs']       = () => render();
  win['_applyNotifData']     = (rows: NotificationRow[]) => {
    _data = rows; _loaded = true; render();
  };

  // Called by NavController when the notification modal opens
  win['_notifModalOpened'] = () => {
    const userId = getUserId();
    if (userId) useNotificationStore.getState().onPanelOpen(userId);
    void fetchNotifs();
  };

  // Called by NavController when the notification modal closes
  win['_notifModalClosed'] = () => {
    useNotificationStore.getState().onPanelClose();
  };

  // start/stop called by the session lifecycle (legacy compatibility)
  win['_startNotifPolling'] = () => { void fetchNotifs(); };
  win['_stopNotifPolling']  = () => {
    refreshNavBadges(0);
    _data = []; _loaded = false; _lastHash = '';
    const l = document.getElementById('notifList');
    if (l) l.innerHTML = '';
  };

  // Initial fetch if already authenticated
  const userId = getUserId();
  if (userId) void fetchNotifs();

  // ── Cleanup ───────────────────────────────────────────────────────────────────
  return () => {
    _unsubStore?.();
    markAllBtn?.removeEventListener('click', onMarkAllClick);
    clearAllBtn?.removeEventListener('click', onClearAllClick);
    refreshBtn?.removeEventListener('click', onRefresh);
    document.removeEventListener('click', onItemClick);

    delete win['_fetchNotifs'];
    delete win['_renderNotifs'];
    delete win['_applyNotifData'];
    delete win['_notifModalOpened'];
    delete win['_notifModalClosed'];
    delete win['_startNotifPolling'];
    delete win['_stopNotifPolling'];
  };
}
