/**
 * src/components/sections/NotificationCenter/NotificationCenter.tsx
 *
 * The global Notification Center (section s-notification-center) — a work inbox
 * for the ERP. Compact header with summary chips · segmented tab bar with counts
 * · filter toolbar + quick chips · a date-grouped notification stream with a calm,
 * helpful empty state. On the canonical communications backbone.
 */

import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { PageHeader, TabBar, withCounts, type AreaTab } from '@ui';
import { useCan } from '@lib/permissions';
import {
  useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  useArchiveNotification, useCommsSummary,
  type CanonicalNotification, type NotificationListArgs,
} from '@api/communications';
import { NotificationItem } from './NotificationItem';
import { BroadcastComposer } from './BroadcastComposer';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { openNotificationTarget, openTicketNotification } from './notifAction';

const TABS: AreaTab[] = [
  { key: 'all',      label: 'All',             icon: 'fa-inbox' },
  { key: 'unread',   label: 'Unread',          icon: 'fa-envelope' },
  { key: 'action',   label: 'Action Required', icon: 'fa-clipboard-check' },
  { key: 'archived', label: 'Archived',        icon: 'fa-box-archive' },
];

const MODULE_OPTIONS: { value: string; label: string }[] = [
  { value: 'hse.incidents',     label: 'Incidents' },
  { value: 'hse.investigations',label: 'Investigations' },
  { value: 'hse.capa',          label: 'CAPA' },
  { value: 'hse.risk',          label: 'Risk / JSA' },
  { value: 'hse.ptw',           label: 'Permit to Work' },
  { value: 'communications',    label: 'Announcements' },
];

// ── Date grouping ───────────────────────────────────────────────────────────
const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier this week', 'Older'] as const;

function dateGroup(iso: string): typeof GROUP_ORDER[number] {
  const startOfToday = new Date(); startOfToday.setHours(0, 0, 0, 0);
  const t = new Date(iso).getTime();
  const today = startOfToday.getTime();
  if (t >= today) return 'Today';
  if (t >= today - 86_400_000) return 'Yesterday';
  if (t >= today - 6 * 86_400_000) return 'Earlier this week';
  return 'Older';
}

function groupByDate(rows: CanonicalNotification[]): [string, CanonicalNotification[]][] {
  const buckets = new Map<string, CanonicalNotification[]>();
  for (const n of rows) {
    const g = dateGroup(n.created_at);
    (buckets.get(g) ?? buckets.set(g, []).get(g)!).push(n);
  }
  return GROUP_ORDER.filter(g => buckets.has(g)).map(g => [g, buckets.get(g)!]);
}

export function NotificationCenter(): VNode {
  const [tab, setTab] = useState('all');
  const [module, setModule] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [prefsOpen, setPrefsOpen] = useState(false);
  const [menuOpen, setMenuOpen] = useState(false);
  const menuRef = useRef<HTMLDivElement>(null);
  const menuBtnRef = useRef<HTMLButtonElement>(null);

  const isAdmin = useCan('communications.admin');
  const { data: summary } = useCommsSummary();

  // Close the overflow menu on an outside click.
  useEffect(() => {
    if (!menuOpen) return;
    const onDown = (e: MouseEvent) => {
      const t = e.target as Node;
      if (menuRef.current?.contains(t) || menuBtnRef.current?.contains(t)) return;
      setMenuOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [menuOpen]);

  const effectiveSeverity = criticalOnly ? 'critical' : severity;
  const hasFilters = Boolean(module || severity || search || criticalOnly);

  const args: NotificationListArgs = {
    limit: 100,
    unreadOnly:         tab === 'unread',
    actionRequiredOnly: tab === 'action',
    archivedOnly:       tab === 'archived',
    module:             module || undefined,
    severity:           (effectiveSeverity || undefined) as NotificationListArgs['severity'],
    search:             search || undefined,
  };
  const { data, isLoading, refetch } = useNotifications(args);
  // Belt-and-suspenders: filter the active-tab predicates client-side too, so the
  // tabs are correct even if an older deployed backend ignores the list args.
  const rows = (data ?? []).filter(n => {
    if (tab === 'unread') return !n.is_read;
    if (tab === 'action') return n.action_required && n.action_status === 'pending';
    if (severity && n.severity !== severity)             return false;
    if (criticalOnly && n.severity !== 'critical')       return false;
    if (module && n.module !== module)                   return false;
    return true;
  });
  const groups = useMemo(() => groupByDate(rows), [rows]);
  const unread = summary?.notificationsUnread ?? 0;

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useArchiveNotification();

  const tabs = withCounts(TABS, {
    all:      summary?.notificationsTotal,
    unread:   summary?.notificationsUnread,
    action:   summary?.notificationsActionRequired,
    archived: summary?.notificationsArchived,
  });

  function open(n: CanonicalNotification) {
    if (!n.is_read) markRead.mutate(n.id);
    if (!openNotificationTarget(n)) openTicketNotification(n);
  }

  function clearFilters() {
    setModule(''); setSeverity(''); setSearch(''); setCriticalOnly(false);
  }

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-bell"
        module="Notifications"
        title="Notification Center"
        sub="Everything across the ERP that needs your attention — alerts, approvals, assignments and reminders."
      />

      {/* Tabs row — status on the left, list/utility actions on the right. */}
      <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginTop: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabs} active={tab} onSelect={setTab} />
        </div>

        {unread > 0 && (
          <button class="hse-btn" disabled={markAll.isPending} onClick={() => markAll.mutate({})} style={{ flexShrink: 0 }}>
            <i class="fas fa-check-double" /> Mark all read
          </button>
        )}

        <div style={{ position: 'relative', flexShrink: 0 }}>
          <button ref={menuBtnRef} class="hse-btn" title="More actions" onClick={() => setMenuOpen(o => !o)}>
            <i class="fas fa-ellipsis" />
          </button>
          {menuOpen && (
            <div ref={menuRef} style={{ position: 'absolute', top: '100%', right: 0, zIndex: 41, minWidth: '210px', marginTop: '4px',
              background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px', boxShadow: 'var(--elev-4)', overflow: 'hidden' }}>
              {[
                { icon: 'fa-sliders',     label: 'Notification preferences', onClick: () => setPrefsOpen(true), show: true },
                { icon: 'fa-box-archive', label: 'Archive all read',         onClick: () => archive.mutate({ all: true }), show: true },
                { icon: 'fa-rotate',      label: 'Refresh',                  onClick: () => { void refetch(); }, show: true },
                { icon: 'fa-bullhorn',    label: 'Send broadcast',           onClick: () => setBroadcastOpen(true), show: isAdmin },
              ].filter(it => it.show).map(it => (
                <button key={it.label} onClick={() => { it.onClick(); setMenuOpen(false); }}
                  style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '9px 12px',
                    background: 'none', border: 'none', borderBottom: '1px solid var(--border)', cursor: 'pointer',
                    textAlign: 'left', fontSize: '0.8rem', color: 'var(--siomac-navy)', whiteSpace: 'nowrap' }}>
                  <i class={`fas ${it.icon}`} style={{ width: '16px', color: 'var(--text-muted)', flexShrink: 0 }} /> {it.label}
                </button>
              ))}
            </div>
          )}
        </div>
      </div>

      {/* Filter toolbar */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', alignItems: 'center', marginTop: '8px' }}>
        <div class="vt-search" style={{ flex: '1 1 200px' }}>
          <i class="fas fa-search" />
          <input type="search" placeholder="Search notifications…" value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)} />
        </div>
        <select class="emp-filter-select" value={module} onChange={e => setModule((e.target as HTMLSelectElement).value)}>
          <option value="">All modules</option>
          {MODULE_OPTIONS.map(m => <option key={m.value} value={m.value}>{m.label}</option>)}
        </select>
        <select class="emp-filter-select" value={severity} disabled={criticalOnly}
          onChange={e => setSeverity((e.target as HTMLSelectElement).value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
        </select>
        {/* Quick filter chips */}
        <button type="button" onClick={() => setCriticalOnly(v => !v)}
          class={`nc-chip${criticalOnly ? ' is-active' : ''}`}>
          <i class="fas fa-triangle-exclamation" /> Critical only
        </button>
        {hasFilters && (
          <button type="button" onClick={clearFilters} class="nc-chip nc-chip--ghost">
            <i class="fas fa-xmark" /> Clear filters
          </button>
        )}
      </div>

      {/* List */}
      <div class="hse-table-card" style={{ overflow: 'hidden' }}>
        {isLoading && <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}

        {!isLoading && rows.length === 0 && (
          <div style={{ padding: '46px 24px', textAlign: 'center' }}>
            <i class="fas fa-bell-slash" style={{ fontSize: '2rem', color: 'var(--text-muted)', opacity: 0.4 }} />
            <div style={{ fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', marginTop: '12px', fontSize: '0.95rem' }}>
              You're all caught up
            </div>
            <div style={{ fontSize: '0.8rem', color: 'var(--text-muted)', marginTop: '3px' }}>
              {hasFilters
                ? 'No notifications match this view. Try changing the filters.'
                : tab === 'archived'
                  ? 'Nothing has been archived yet.'
                  : 'No notifications or required actions right now.'}
            </div>
            <div style={{ display: 'flex', gap: '8px', justifyContent: 'center', marginTop: '14px' }}>
              {hasFilters && <button class="hse-btn" onClick={clearFilters}><i class="fas fa-filter-circle-xmark" /> Clear filters</button>}
              {tab !== 'archived' && <button class="hse-btn" onClick={() => setTab('archived')}><i class="fas fa-box-archive" /> Show archived</button>}
            </div>
          </div>
        )}

        {!isLoading && groups.map(([label, items]) => (
          <div key={label}>
            <div class="nc-group-head">{label} <span class="nc-group-count">{items.length}</span></div>
            {items.map(n => (
              <NotificationItem key={n.id} n={n} onOpen={open}
                onArchive={tab === 'archived' ? undefined : (x => archive.mutate({ notificationId: x.id }))} />
            ))}
          </div>
        ))}
      </div>

      <BroadcastComposer open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
      <NotificationPreferencesPanel open={prefsOpen} onClose={() => setPrefsOpen(false)} />
    </div>
  );
}
