/** Enterprise notification work inbox on the canonical communications API. */

import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import {
  ActivityDots, Button, EmptyState, LucideIcon, PageHeader,
  PageActionBar, SearchField, Select, Switch, Tabs, TabPanel, type TabItem,
} from '@ui';
import { useCan } from '@lib/permissions';
import {
  useNotifications, useMarkNotificationRead, useMarkAllNotificationsRead,
  useArchiveNotification, useCommsSummary,
  type CanonicalNotification, type NotificationListArgs,
} from '@api/communications';
import { NotificationItem } from './NotificationItem';
import { BroadcastComposer } from './BroadcastComposer';
import { NotificationPreferencesPanel } from './NotificationPreferencesPanel';
import { NotificationEmptyVisual, type NotificationEmptyVisualKind } from './NotificationEmptyVisual';
import {
  archiveAllReadPreviewNotifications, archivePreviewNotification, countPreviewNotifications,
  createPreviewNotifications, isArchivedNotification, markAllPreviewNotificationsRead,
  markPreviewNotificationRead,
} from './previewNotifications';
import { openNotificationTarget, openTicketNotification } from './notifAction';
import './notificationCenter.css';

type NotificationView = 'all' | 'unread' | 'action' | 'archived';
type SeverityFilter = '' | 'critical' | 'warning' | 'success' | 'info';

const TABS: readonly TabItem[] = [
  { id: 'all', label: 'All', icon: <LucideIcon name="Inbox" /> },
  { id: 'unread', label: 'Unread', icon: <LucideIcon name="Mail" /> },
  { id: 'action', label: 'Needs Action', icon: <LucideIcon name="ClipboardCheck" /> },
  { id: 'archived', label: 'Archived', icon: <LucideIcon name="Archive" /> },
];

const MODULE_OPTIONS = [
  { value: '', label: 'All Modules' },
  { value: 'hse.incidents', label: 'Incidents' },
  { value: 'hse.investigations', label: 'Investigations' },
  { value: 'hse.capa', label: 'CAPA' },
  { value: 'hse.risk', label: 'Risk & JSA' },
  { value: 'hse.ptw', label: 'Permit to Work' },
  { value: 'workflow', label: 'Workflow' },
  { value: 'communications', label: 'Announcements' },
  { value: 'hr', label: 'Human Resources' },
  { value: 'payroll', label: 'Payroll' },
  { value: 'finance', label: 'Finance' },
] as const;

const SEVERITY_OPTIONS = [
  { value: '', label: 'All Severities' },
  { value: 'critical', label: 'Critical' },
  { value: 'warning', label: 'Warning' },
  { value: 'success', label: 'Success' },
  { value: 'info', label: 'Information' },
] as const;

const GROUP_ORDER = ['Today', 'Yesterday', 'Earlier This Week', 'Older'] as const;

function dateGroup(iso: string): typeof GROUP_ORDER[number] {
  const startOfToday = new Date();
  startOfToday.setHours(0, 0, 0, 0);
  const value = new Date(iso).getTime();
  const today = startOfToday.getTime();
  if (value >= today) return 'Today';
  if (value >= today - 86_400_000) return 'Yesterday';
  if (value >= today - 6 * 86_400_000) return 'Earlier This Week';
  return 'Older';
}

function groupByDate(rows: readonly CanonicalNotification[]): [string, CanonicalNotification[]][] {
  const buckets = new Map<string, CanonicalNotification[]>();
  for (const notification of rows) {
    const group = dateGroup(notification.created_at);
    const values = buckets.get(group) ?? [];
    values.push(notification);
    buckets.set(group, values);
  }
  return GROUP_ORDER.filter(group => buckets.has(group)).map(group => [group, buckets.get(group) ?? []]);
}

function isView(value: string): value is NotificationView {
  return TABS.some(tab => tab.id === value);
}

export function NotificationCenter(): VNode {
  const [view, setView] = useState<NotificationView>('all');
  const [module, setModule] = useState('');
  const [severity, setSeverity] = useState<SeverityFilter>('');
  const [search, setSearch] = useState('');
  const [criticalOnly, setCriticalOnly] = useState(false);
  const [broadcastOpen, setBroadcastOpen] = useState(false);
  const [preferencesOpen, setPreferencesOpen] = useState(false);
  const [showLive, setShowLive] = useState(false);
  const [previewNotifications, setPreviewNotifications] = useState(createPreviewNotifications);
  const isAdmin = useCan('communications.admin');

  useEffect(() => {
    const openPreferences = (): void => setPreferencesOpen(true);
    window.addEventListener('siomac:openNotificationPreferences', openPreferences);
    return () => window.removeEventListener('siomac:openNotificationPreferences', openPreferences);
  }, []);

  const { data: summary } = useCommsSummary();

  const effectiveSeverity = criticalOnly ? 'critical' : severity;
  const args: NotificationListArgs = {
    limit: 100,
    unreadOnly: view === 'unread',
    actionRequiredOnly: view === 'action',
    archivedOnly: view === 'archived',
    module: module || undefined,
    severity: effectiveSeverity || undefined,
    search: search.trim() || undefined,
  };
  const query = useNotifications(args, { enabled: showLive });
  const markRead = useMarkNotificationRead();
  const markAll = useMarkAllNotificationsRead();
  const archive = useArchiveNotification();
  const sourceRows = showLive ? (query.data ?? []) : previewNotifications;
  const previewCounts = useMemo(() => countPreviewNotifications(previewNotifications), [previewNotifications]);
  const total = showLive ? (summary?.notificationsTotal ?? 0) : previewCounts.total;
  const unread = showLive ? (summary?.notificationsUnread ?? 0) : previewCounts.unread;
  const actionRequired = showLive ? (summary?.notificationsActionRequired ?? 0) : previewCounts.actionRequired;
  const archived = showLive ? (summary?.notificationsArchived ?? 0) : previewCounts.archived;

  const rows = useMemo(() => {
    const needle = search.trim().toLocaleLowerCase();
    return sourceRows.filter(notification => {
      if (view === 'unread' && notification.is_read) return false;
      if (view === 'action' && !(notification.action_required && notification.action_status === 'pending')) return false;
      if (view === 'archived' ? !isArchivedNotification(notification) : isArchivedNotification(notification)) return false;
      if (effectiveSeverity && notification.severity !== effectiveSeverity) return false;
      if (module && notification.module !== module) return false;
      if (needle) {
        const searchable = [notification.title, notification.body, notification.source_id, notification.module]
          .filter(Boolean).join(' ').toLocaleLowerCase();
        if (!searchable.includes(needle)) return false;
      }
      return true;
    });
  }, [effectiveSeverity, module, search, sourceRows, view]);
  const groups = useMemo(() => groupByDate(rows), [rows]);
  const hasFilters = Boolean(module || severity || search.trim() || criticalOnly);

  const tabs = TABS.map(tab => ({
    ...tab,
    badge: tab.id === 'all' ? total
        : tab.id === 'unread' ? unread
        : tab.id === 'action' ? actionRequired
          : archived,
  }));

  function open(notification: CanonicalNotification): void {
    if (!notification.is_read) {
      if (showLive) markRead.mutate(notification.id);
      else setPreviewNotifications(current => markPreviewNotificationRead(current, notification.id));
    }
    if (!openNotificationTarget(notification)) openTicketNotification(notification);
  }

  function markAllRead(): void {
    if (showLive) markAll.mutate({});
    else setPreviewNotifications(markAllPreviewNotificationsRead);
  }

  function archiveOne(notificationId: string): void {
    if (showLive) archive.mutate({ notificationId });
    else setPreviewNotifications(current => archivePreviewNotification(current, notificationId));
  }

  function archiveAllRead(): void {
    if (showLive) archive.mutate({ all: true });
    else setPreviewNotifications(archiveAllReadPreviewNotifications);
  }

  function clearFilters(): void {
    setModule('');
    setSeverity('');
    setSearch('');
    setCriticalOnly(false);
  }

  const emptyCopy = hasFilters
    ? { title: 'No Matching Notifications', text: 'Adjust the search or filters to broaden this view.' }
    : view === 'archived'
      ? { title: 'Archive Is Empty', text: 'Notifications you archive will remain available here.' }
      : view === 'action'
        ? { title: 'No Actions Waiting', text: 'There are no notification decisions waiting for you.' }
        : view === 'unread'
          ? { title: 'Everything Is Read', text: 'You have reviewed every notification in your inbox.' }
          : { title: "You're All Caught Up", text: 'New alerts, approvals, assignments and reminders will appear here.' };
  const emptyVisualKind: NotificationEmptyVisualKind = hasFilters
    ? 'search'
    : view === 'archived' ? 'archived'
      : view === 'action' ? 'action'
        : view === 'unread' ? 'unread'
          : 'all';

  return (
    <div class="nc-center">
      <PageHeader
        icon={<LucideIcon name="Bell" />}
        module="Communications"
        title="Notification Center"
        sub="Review alerts, approvals, assignments and updates from across SIOMAC."
        actions={(
          <PageActionBar
            label="Notification Center Actions"
            secondary={(
              <>
                <Button
                  variant="secondary"
                  iconLeft={<LucideIcon name="CheckCheck" />}
                  disabled={unread === 0}
                  loading={showLive && markAll.isPending}
                  onClick={markAllRead}
                >
                  Mark All Read
                </Button>
                <Button variant="secondary" iconLeft={<LucideIcon name="Settings2" />} onClick={() => setPreferencesOpen(true)}>
                  Notification Settings
                </Button>
              </>
            )}
            primary={isAdmin ? (
              <Button variant="primary" iconLeft={<LucideIcon name="Megaphone" />} onClick={() => setBroadcastOpen(true)}>
                Send Broadcast
              </Button>
            ) : undefined}
            overflow={[
              {
                id: 'archive-read',
                label: showLive && archive.isPending ? 'Archiving Read Notifications' : 'Archive All Read',
                icon: <LucideIcon name="Archive" />,
                disabled: (showLive && archive.isPending) || total - unread === 0,
                onSelect: archiveAllRead,
              },
              {
                id: 'refresh',
                label: showLive
                  ? (query.isFetching ? 'Refreshing Notifications' : 'Refresh Notifications')
                  : 'Reset Feature Preview',
                icon: <LucideIcon name="RefreshCw" />,
                disabled: showLive && query.isFetching,
                onSelect: () => {
                  if (showLive) void query.refetch();
                  else setPreviewNotifications(createPreviewNotifications());
                },
              },
            ]}
          />
        )}
      />

      <section class="nc-workspace" aria-label="Notification Inbox">
        <div class="nc-toolbar">
          <div class="nc-mode-row">
            <span class="nc-mode-copy">
              <strong>{showLive ? 'Live Notifications' : 'Feature Preview'}</strong>
              <small>{showLive ? 'Showing notifications from your account.' : 'Explore staged examples without changing live data.'}</small>
            </span>
            <Switch checked={showLive} onChange={setShowLive} aria-label="Show Live Notifications" />
          </div>
          <div class="nc-workspace-head">
            <Tabs
              id="notification-center-tabs"
              items={tabs}
              value={view}
              onChange={value => { if (isView(value)) { setView(value); setCriticalOnly(false); } }}
              label="Notification Views"
              variant="contained"
            />
          </div>

          <div class="nc-filters" aria-label="Notification Filters">
            <SearchField
              value={search}
              onInput={setSearch}
              placeholder="Search Notifications"
              aria-label="Search Notifications"
              class="nc-search"
            />
            <Select
              value={module}
              onChange={setModule}
              options={MODULE_OPTIONS}
              aria-label="Filter by Module"
              class="nc-filter-select"
            />
            <Select<SeverityFilter>
              value={severity}
              onChange={value => setSeverity(value)}
              options={SEVERITY_OPTIONS}
              disabled={criticalOnly}
              aria-label="Filter by Severity"
              class="nc-filter-select"
            />
            <Button
              variant="outline"
              pressed={criticalOnly}
              iconLeft={<LucideIcon name="TriangleAlert" />}
              onClick={() => setCriticalOnly(value => !value)}
            >
              Critical Only
            </Button>
            {hasFilters && (
              <Button variant="ghost" iconLeft={<LucideIcon name="X" />} onClick={clearFilters}>
                Clear Filters
              </Button>
            )}
          </div>
        </div>

        <div class="nc-results-head" aria-live="polite">
          <div>
            <strong>{rows.length}</strong> {rows.length === 1 ? 'Notification' : 'Notifications'}
            {hasFilters && <span> Matching This View</span>}
          </div>
          <div class="nc-results-status">
            {criticalOnly && <span class="nc-filter-note"><LucideIcon name="TriangleAlert" /> Critical Alerts Only</span>}
          </div>
        </div>

        <TabPanel tabsId="notification-center-tabs" tabId={view} value={view}>
          <div class="nc-results">
            {showLive && query.isLoading && (
              <div class="nc-state"><ActivityDots label="Loading Notifications" /></div>
            )}

            {showLive && !query.isLoading && query.isError && (
              <EmptyState
                visual={<NotificationEmptyVisual kind="error" />}
                title="Notifications Could Not Be Loaded"
                text="Check your connection and try again."
                actions={<Button variant="secondary" size="sm" iconLeft={<LucideIcon name="RefreshCw" />} onClick={() => void query.refetch()}>Try Again</Button>}
                role="alert"
              />
            )}

            {(!showLive || (!query.isLoading && !query.isError)) && rows.length === 0 && (
              <EmptyState
                visual={<NotificationEmptyVisual kind={emptyVisualKind} />}
                title={emptyCopy.title}
                text={emptyCopy.text}
                actions={hasFilters ? <Button variant="secondary" size="sm" onClick={clearFilters}>Clear Filters</Button> : undefined}
                role="status"
              />
            )}

            {(!showLive || (!query.isLoading && !query.isError)) && groups.map(([label, items]) => (
              <section class="nc-date-group" key={label} aria-label={`${label} Notifications`}>
                <div class="nc-date-group-head">
                  <span>{label}</span>
                  <span>{items.length}</span>
                </div>
                {items.map(notification => (
                  <NotificationItem
                    key={notification.id}
                    n={notification}
                    onOpen={open}
                    onArchive={view === 'archived' ? undefined : item => archiveOne(item.id)}
                  />
                ))}
              </section>
            ))}
          </div>
        </TabPanel>
      </section>

      <BroadcastComposer open={broadcastOpen} onClose={() => setBroadcastOpen(false)} />
      <NotificationPreferencesPanel open={preferencesOpen} onClose={() => setPreferencesOpen(false)} />
    </div>
  );
}
