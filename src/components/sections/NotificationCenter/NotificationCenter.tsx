/**
 * src/components/sections/NotificationCenter/NotificationCenter.tsx
 *
 * The global Notification Center (section s-notification-center). Header + tabs
 * (All / Unread / Action Required / Archived) + filters (module / severity /
 * search) + the notification list, on the canonical communications backbone.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader, TabBar, type AreaTab } from '@ui';
import { useCan } from '@lib/permissions';
import {
  useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  useArchiveNotification, useCommsSummary,
  type CanonicalNotification, type NotificationListArgs,
} from '@api/communications';
import { NotificationItem } from './NotificationItem';
import { BroadcastComposer } from './BroadcastComposer';

const TABS: AreaTab[] = [
  { key: 'all',      label: 'All',             icon: 'fa-inbox' },
  { key: 'unread',   label: 'Unread',          icon: 'fa-envelope' },
  { key: 'action',   label: 'Action Required', icon: 'fa-clipboard-check' },
  { key: 'archived', label: 'Archived',        icon: 'fa-box-archive' },
];

const MODULES = ['', 'hse.incidents', 'hse.investigations', 'hse.capa', 'hse.risk', 'hse.ptw', 'communications'];

export function NotificationCenter(): VNode {
  const [tab, setTab] = useState('all');
  const [module, setModule] = useState('');
  const [severity, setSeverity] = useState('');
  const [search, setSearch] = useState('');
  const [broadcastOpen, setBroadcastOpen] = useState(false);

  const isAdmin = useCan('communications.admin');
  const { data: summary } = useCommsSummary();

  const args: NotificationListArgs = {
    limit: 100,
    unreadOnly:         tab === 'unread',
    actionRequiredOnly: tab === 'action',
    archivedOnly:       tab === 'archived',
    module:             module || undefined,
    severity:           (severity || undefined) as NotificationListArgs['severity'],
    search:             search || undefined,
  };
  const { data, isLoading } = useNotifications(args);
  const rows = data ?? [];

  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useArchiveNotification();

  function open(n: CanonicalNotification) {
    if (!n.is_read) markRead.mutate(n.id);
    // action_route deep-linking is wired as modules expose section ids (follow-up).
  }

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-bell"
        module="Notifications"
        title="Notification Center"
        sub="Everything across the ERP that needs your attention — alerts, approvals, assignments and reminders."
        meta={[
          { icon: 'fa-envelope', label: `${summary?.notificationsUnread ?? 0} unread` },
        ]}
        actions={
          <div style={{ display: 'flex', gap: '8px' }}>
            {isAdmin && (
              <button class="hse-btn" onClick={() => setBroadcastOpen(true)}><i class="fas fa-bullhorn" /> Broadcast</button>
            )}
            <button class="hse-btn" disabled={markAll.isPending} onClick={() => markAll.mutate({})}>
              <i class="fas fa-check-double" /> Mark all read
            </button>
          </div>
        }
      />

      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '12px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={TABS} active={tab} onSelect={setTab} />
        </div>
      </div>

      {/* Filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginTop: '8px' }}>
        <div class="vt-search" style={{ flex: '1 1 200px' }}>
          <i class="fas fa-search" />
          <input type="search" placeholder="Search notifications…" value={search}
            onInput={e => setSearch((e.target as HTMLInputElement).value)} />
        </div>
        <select class="emp-filter-select" value={module} onChange={e => setModule((e.target as HTMLSelectElement).value)}>
          <option value="">All modules</option>
          {MODULES.filter(Boolean).map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select class="emp-filter-select" value={severity} onChange={e => setSeverity((e.target as HTMLSelectElement).value)}>
          <option value="">All severities</option>
          <option value="critical">Critical</option>
          <option value="warning">Warning</option>
          <option value="success">Success</option>
          <option value="info">Info</option>
        </select>
      </div>

      {/* List */}
      <div class="hse-table-card" style={{ overflow: 'hidden' }}>
        {isLoading && <div style={{ padding: '28px', textAlign: 'center', color: 'var(--text-muted)' }}>Loading…</div>}
        {!isLoading && rows.length === 0 && (
          <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
            <i class="fas fa-bell-slash" style={{ fontSize: '1.8rem', opacity: 0.4 }} />
            <div style={{ marginTop: '10px' }}>Nothing here.</div>
          </div>
        )}
        {rows.map(n => (
          <NotificationItem key={n.id} n={n} onOpen={open}
            onArchive={tab === 'archived' ? undefined : (x => archive.mutate({ notificationId: x.id }))} />
        ))}
      </div>

      <BroadcastComposer open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
    </div>
  );
}
