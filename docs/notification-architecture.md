# ERP Notification System — Architecture & Implementation Plan

The notification system is a **shared ERP service**. Modules never create notifications
directly — they **emit business events** and the engine resolves recipients, persists
per-user notifications, logs deliveries, and signals the frontend to refetch.

```
Module action → emitAppEvent() → app_events → event_rules → recipientResolver
  → event_recipients → notifyMany() → notifications → notification_deliveries
  → communication_signals → frontend refetch → bell / dropdown / Notification Center
```

## Repo reconciliation notes (this codebase)
- `app_events.source_module` is free `text` (no CHECK) → granular values like `hse.ptw`,
  `hse.capa` are valid. Keep `source_module` granular and mirror it into
  `notifications.module` so the Center's module filter works.
- Everything goes through authenticated Netlify **POST** routes behind `requirePermission()`.
  Realtime may only **trigger refetches** — never the data source. `app_users.id` is TEXT.
- `communications.admin` (broadcast) must be seeded (done in Phase 1) like `hse.risk.approve`.
- PTW / Inspections / Documents events (Phase 6) depend on modules not yet built; the engine
  (Phases 1–5) is module-agnostic and ships first. Wire Incidents/Investigations/CAPA/Risk-JSA first.

## Retire (legacy duplicates)
`lib/events.ts` · `routes/notifications.ts` · `RealtimeController.ts` ·
`components/nav/NotificationsPanel.ts` · `components/nav/badgeSync.ts` ·
`store/notifications.ts` · legacy `@api/notifications`.

## Keep / extend (canonical)
`lib/appEvents.ts` (`emitAppEvent`) · `lib/recipientResolver.ts` · `lib/notify.ts` ·
`lib/communications.ts` (`emitSignal`, `getCommsSummary`) ·
`routes/communications.ts` · `src/api/communications.ts` · `hooks/useRealtimeSignals.ts`.

---

## 1. Database

### 1.1 Fix `notifications.event_id` (uuid → text)
`app_events.id` is text; `notifications.event_id` was uuid. Re-type and re-link so every
notification traces back to its event.

### 1.2 Add to `notifications`
`action_required boolean`, `action_status text` in
`(none, pending, completed, dismissed, expired, escalated)`, `due_at`, `escalated_at`,
`completed_at`, `completed_by`. **Read/unread = the user saw it; action_status = the work
was done** (a CAPA notice can be read but still `pending`).

### 1.3 `notification_preferences`
`(user_id, event_type) PK`, `in_app default true`, `email default false`, `whatsapp default
false`. `event_type='*'` is the user default; a specific type overrides it.

### 1.4 `notification_mutes`
`(user_id, scope) PK`, `muted_until` (null = indefinite, future = until then, past = not
muted). Scope: `all` | `module:<m>` | `event:<type>`.

### 1.5 `notification_deliveries` (exists — start writing it)
One row per channel attempt: `notification_id`, `channel (in_app|email|whatsapp)`,
`status (pending|sent|delivered|failed|skipped)`, `provider_message_id`, `error`, `attempted_at`.

All new tables: RLS enabled, `for all using (auth.role() = 'authenticated')`; writes via
service-role backend only.

---

## 2. Backend pipeline

### 2.1 Single entry point — `emitAppEvent`
```ts
type EmitAppEventInput = {
  eventType: string; sourceModule: string;
  sourceEntityType: string; sourceEntityId: string;
  actorUserId: string | null;
  severity: 'info'|'success'|'warning'|'critical';
  siteId?: string|null; departmentId?: string|null;
  payload?: Record<string, unknown>; dedupeKey?: string;
  explicitRecipients?: string[];
  title: string; body: string; actionRoute?: string;
  actionRequired?: boolean; dueAt?: string|null;
};
type EmitAppEventResult = { eventId: string; recipientIds: string[] };
```
Flow: insert `app_events` → `resolveRecipients` → insert `event_recipients` → `notifyMany` →
`emitSignal(recipientIds, 'notifications', { eventType, notificationIds })` → best-effort
`audit_logs`.

### 2.2 Data-driven recipient resolver (`event_rules`)
Replace the hardcoded switch. Load active rules for `event_type` (and `*`); expand each
`recipient_kind` (`actor | owner | assignee | explicit | role | dept_manager | site_manager
| watcher`) to user ids; dedupe; drop the actor unless the type is in the confirmation
allow-list:
```
workflow.approved, workflow.rejected, hse.capa.closed, hse.incident.closed,
ptw.permit.approved, ptw.permit.rejected, documents.document.published, payroll.published
```

### 2.3 `notifyMany(userIds, input)` → `NotificationRow[]`
Per recipient: load effective preference (`event_type` → fallback `*`); check mutes; skip if
muted or no channel enabled; insert `notifications` (with module/severity/source/action_route/
metadata/dedupe `${userId}:${dedupeKey}`/event_id/action_required/action_status/due_at);
write `notification_deliveries` (`in_app` `delivered`); fan out email/whatsapp if enabled.

### 2.4 Channel strategy
```ts
type DeliveryResult = { status: 'sent'|'delivered'|'failed'|'skipped'; providerMessageId?: string; error?: string };
type NotificationChannel = { channel: 'email'|'whatsapp'; send(n: NotificationRow, userId: string): Promise<DeliveryResult> };
```
`EmailChannel` (Resend) + `WhatsAppChannel` (Meta Cloud). Each attempt writes/updates a
`notification_deliveries` row (`pending` → result). In-app needs no external send.

---

## 3. API routes (POST, `requirePermission`)
- `/communications/summary` — badge counts + `realtimeChannelKey`. (exists)
- `/communications/notifications/list` — `{ limit, cursor, unreadOnly, archivedOnly, actionRequiredOnly, module, severity, search }` → `{ rows, nextCursor }`. Always scoped to current user; exclude archived + expired by default.
- `/notifications/markRead` · `/markAllRead` `{ module? }` · `/archive` `{ id? , all? }`.
- `/notifications/preferences/get` → `{ defaults, preferences[] }`.
- `/notifications/preferences/set` `{ eventType, in_app, email, whatsapp }` (upsert).
- `/notifications/mute` `{ scope, mutedUntil, clear? }`.
- `/notifications/broadcast` — **`communications.admin`** — `{ audience{type:all|role|site|department|users, value?, userIds?}, severity, title, body, actionRoute?, expiresAt? }` → internally `emitAppEvent({ eventType:'communications.broadcast', sourceModule:'communications', sourceEntityType:'broadcast' })`.
- Implement or delete the documented `/communications/signal`; fix `getCommsSummary` `ticketsUnread` TODO and the ticket-create empty-recipient list. Retire `routes/notifications.ts`.

---

## 4. Realtime (refetch trigger only)
Backend `emitSignal(userIds, domain, payload)` inserts `communication_signals` per user
(keyed by their `channel_key`). Frontend `useRealtimeSignals()` (mounted once after login)
subscribes to `communication_signals` filtered by `channel_key`; on INSERT, **route by
`domain`**: `notifications` → invalidate `summary` + `notificationKeys.mine()`; `messages` →
`summary` + message queries. Delete `RealtimeController.ts`.

---

## 5. Frontend data layer (`src/api/communications.ts`)
Hooks: `useCommsSummary`, `useNotifications({ unreadOnly, archivedOnly, actionRequiredOnly,
module, severity, search, limit })`, `useMarkNotificationRead`, `useMarkAllNotificationsRead`,
`useArchiveNotification`, `useNotificationPreferences`, `useSetNotificationPreference`,
`useMuteNotifications`, `useBroadcastNotification`.

Query keys: `communicationKeys.summary()`, `notificationKeys.mine(filters)`, `.unread()`,
`.preferences()`.

---

## 6. Frontend components
```
NotificationBell → NotificationDropdown → NotificationItem
NotificationCenter
  ├ NotificationCenterHeader   (Mark all read · Preferences · Broadcast[admin])
  ├ Tabs: All · Unread · Action Required · Assigned · Archived
  ├ Filters: module · severity · date · search
  ├ 4 StatsCards (Unread · Critical Alerts · Action Completion % w/ bar · Overdue Escalations)
  ├ List → NotificationItem (infinite scroll)
  └ Empty / loading / error
NotificationPreferences   (Settings + Center)
BroadcastComposer         (admin only)
```
Route `/notifications` (global, not HSE-only). Follow `src/ui/PAGE_GUIDE.md` page standard.
Delete `NotificationsPanel.ts`, `badgeSync.ts`, `store/notifications.ts`.

**NotificationItem** (shared by dropdown + center): severity rail · module icon · title (bold
if unread) · body · record ref · relative time · unread dot · action badge · archive · snooze ·
open. Click → mark read + navigate `action_route`.

**Tabs:** All = non-archived; Unread = `!is_read`; Action Required = `action_required &&
action_status='pending'`; Assigned = metadata/assignment to current user; Archived =
`archived_at not null`.

---

## 7. HSE event catalogue (Phase 6 wiring)
Incidents · Investigations · CAPA · Risk/JSA · Permit-to-Work · Inspections · Documents — each
emits typed events through `emitAppEvent()` (full list in the source spec). Scheduled jobs emit
due-soon/overdue events with deterministic dedupe keys `event-name:record-id:yyyy-mm-dd`.

Example (CAPA overdue):
```ts
await emitAppEvent({
  eventType: 'hse.capa.overdue', sourceModule: 'hse.capa',
  sourceEntityType: 'capa', sourceEntityId: capa.id, actorUserId: null,
  severity: 'warning', siteId: capa.siteId, departmentId: capa.departmentId,
  payload: { capaNo: capa.capaNo, dueDate: capa.dueDate },
  dedupeKey: `capa-overdue:${capa.id}:${today}`,
  explicitRecipients: [capa.ownerId, capa.ownerSupervisorId, capa.hseOfficerId].filter(Boolean),
  title: 'CAPA Overdue', body: `${capa.capaNo} is overdue and requires action.`,
  actionRoute: `/hse/incidents/capa/${capa.id}`, actionRequired: true, dueAt: capa.dueDate,
});
```

---

## 8. Implementation order
1. **Schema + canonical pipeline** — prefs/mutes tables, `event_id` fix, action columns, start writing `notification_deliveries`, seed `communications.admin`.
2. **Backend cleanup** — `emitAppEvent` sole entry; `event_rules`-driven resolver; prefs/mute filtering + channel strategy in `notifyMany`; signal after create; delete `events.ts`.
3. **API** — list filters; preferences get/set; mute; broadcast; `/signal`; retire legacy `routes/notifications.ts`.
4. **Frontend** — bell → dropdown → shared item → Notification Center page → preferences → admin broadcast; delete legacy panel/badge/store.
5. **Realtime unify** — domain-routed `useRealtimeSignals`; delete `RealtimeController.ts`.
6. **HSE wiring** — Incidents/Investigations/CAPA → Risk/JSA → PTW → Inspections → Documents + scheduled reminder jobs.

## 9. Acceptance criteria
One canonical event→notification path; legacy removed; every notification links to
`app_events`; per-user read/archive/action state; preferences + mutes work; deliveries logged;
realtime refreshes bell + Center; `/notifications` exists with filter/search/archive/mark-read/
open; admins can broadcast; HSE modules emit events only via `emitAppEvent()`.
