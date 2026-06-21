# SIOMAC Communications Backbone

> Detailed spec for **Step 5** of [ARCHITECTURE.md](../ARCHITECTURE.md). One
> enterprise communication system, three channels driven by a shared event
> backbone, shared badge API, shared realtime-signal/refetch layer, consistent
> permissions.
>
> **Hard dependency:** the `app_events` layer (Step 4) must exist first — all
> three channels are event-driven.

---

## Verified repo findings (2026-06, confirmed against code)

| Claim | Verified | Location |
|---|---|---|
| `notify.ts` exists but NOT mounted | ✅ | `routes/notify.ts` (6 endpoints); absent from `api.ts` |
| Notification logic split (synthetic + persistent) | ✅ | `routes/notifications.ts` builds inline from leave/attendance; `notifications` table in `database/migrations/002_notifications.sql` + `supabase/phase6-notifications.sql` (two sources) |
| **Browser reads Supabase directly for notifications** ⚠️ | ✅ CRITICAL | `src/api/notifications.ts` imports `@lib/supabase`, calls `.from('notifications')` |
| Custom JWT auth (not Supabase Auth) | ✅ | so browser-side Supabase reads are NOT session-protected — must move to backend JWT API |
| Messages = two-party only | ✅ | `routes/messages.ts`: `from_user_id`/`to_user_id` + `message_replies` |
| Tickets = `support_tickets` + `ticket_replies` | ✅ | `routes/tickets.ts` |
| `badgeSync.ts` polls + localStorage read-state | ✅ | `src/components/nav/badgeSync.ts`: polls `getHeaderCounts`, cross-refs `siomac_read_notifs_v1` / `siomac_cleared_notifs_v1` localStorage |
| User id is text (`USR-…`), schemas assume UUID | ✅ | migrate `user_id` to text `app_users.id` everywhere |

---

## Three channels — definitions
- **Notifications** — short alerts, action prompts, reminders, due/overdue alerts.
- **Messages** — conversations, record comments, mentions, human follow-up.
- **Tickets** — support/service cases with category, priority, assignee, status, SLA, resolution.

## Data model

**Notifications** — keep `notifications` + `notification_preferences`; migrate `user_id` → text `app_users.id`; remove the UUID-only migration path. Extend with `event_id`, `module`, `severity`, `source_type`, `source_id`, `action_route`, `metadata`, `read_at`, `archived_at`, `expires_at`, `dedupe_key`. Add `notification_deliveries` (channel: in_app/email/whatsapp/push; default in-app on, rest preference-gated).

**Messages** — canonical `message_threads`, `message_participants`, `message_posts`, `message_reads`. Migrate two-party rows into threads. Keep `/sendMessage` `/replyMessage` `/getMessages` as compat wrappers. Support DMs, department/support inboxes, entity-linked threads (`incident:INC-0001`).

**Tickets** — canonical `tickets`, `ticket_comments`, `ticket_watchers`, `ticket_events`, optional `ticket_attachments`. Migrate `support_tickets` + `ticket_replies`. Add assignee, requester, dept/site scope, priority, SLA due, first-response ts, resolution code, source module/id, internal notes.

**Attachments** — shared `communication_attachments` (entity_type, entity_id, storage_path, uploaded_by, created_at). Serve via backend signed URLs, never public bucket paths.

**Realtime** — `communication_signals`: opaque recipient signal key + domain + timestamp, NO sensitive payload. Clients use it only to invalidate Query keys and refetch via JWT API.

## API changes
- Mount `routes/notify.ts`; consolidate/retire `routes/notifications.ts`.
- `/api/communications/summary` → `{ notificationsUnread, messagesUnread, ticketsOpen, ticketsUnread, pendingActions }`.
- Notifications: list, read, readAll, archive, clearArchived, preferences, adminSend.
- Messages: threads, threadDetail, createThread, postMessage, markThreadRead, archiveThread, participants.
- Tickets: list, detail, create, reply, assign, changeStatus, watch, unwatch, close, reopen.
- Internal helpers: `emitAppEvent`, `resolveRecipients`, `createNotification`, `notifyMany`, `createSystemPost`, `createTicketFromEvent`.
- **Rule: frontend uses `apiPost`/`apiFetch` with custom JWT for ALL protected data. No new direct browser Supabase reads.**

## UI changes
- Replace `badgeSync.ts` synthetic/localStorage logic with `/communications/summary`.
- Header badges from ONE store/query source, not panel-specific DOM mutation.
- Keep header quick-panels (Notifications/Messages/Tickets) but back them with shared Query hooks + same realtime-invalidation pattern.
- Reusable **Communication Inbox** layout: tabs for Notifications/Messages/Tickets/Preferences. No "intelligence" page.
- Row layouts: notifications (icon, severity, module, source ref, time, read state, one action route); messages (avatar, participants, subject, latest post, unread count, source chip, archive); tickets (number, requester, assignee, category, priority, status, SLA state, last activity, new-reply indicator).
- Remove localStorage read-tracking except temporary migration compat.

## Implementation phases
1. **Schema & type cleanup** — fix user-id typing to text across schemas/validators/tests/payloads; add event/delivery/signal/thread/ticket/attachment/workflow migrations; RLS defensive but app-auth enforced in Netlify routes (custom JWT is the real auth).
2. **Canonical notification backend** — mount `notify.ts`; all reads/writes through backend; convert synthetic sources to persisted events/notifications at source actions; keep `/getNotifications` + `/getHeaderCounts` as wrappers until UI migrates.
3. **Unified summary & realtime** — build `/communications/summary`; replace badge polling/localStorage; insert opaque `communication_signals` on change; client invalidates + refetches via JWT API.
4. **Messages migration** — migrate conversations to threads; canonical APIs; entity-linked threads + participant permissions; legacy panel via adapters then Query hooks.
5. **Tickets migration** — migrate to canonical tables; assignee/SLA/watchers/source links/internal notes/resolution; emit notifications on create/assign/reply/status/overdue/close.
6. **Workflow/HSE integration** — replace localStorage workflow store with backend APIs; incident report → workflow task + approver notification + audit event + optional linked thread; CAPA overdue → notification, escalation → ticket; handoffs → events + notifications to receiving owners.
7. **UI consolidation** — shared hooks for header panels; remove synthetic code + localStorage read-state; standardize empty/loading/error + row layouts; add preferences UI.

## Test plan
- **Events:** source action emits one `app_event`, correct recipients, no dup notifications with same `dedupe_key`.
- **Notifications:** list, unread count, mark read, read all, archive, preferences, delivery status; user cannot read/update another's notification.
- **Messages:** create DM thread, reply, mark read, participant-only access, entity-linked thread, admin/manager boundaries.
- **Tickets:** create, assign, reply, status changes, SLA overdue, watcher notifications, requester/assignee visibility, close/reopen.
- **Integration:** incident → workflow task → approver notification → approval → handoff event; message reply → unread badge increments → opening clears; ticket reply/status → requester/support notification + badge; CAPA overdue → notification first, escalation ticket only at rule threshold.
- **Frontend:** header summary badges, panel rendering, realtime-signal invalidation, no localStorage read-state dependency.
- **Security:** no protected data from direct Supabase client; non-participant APIs return 403.
- **Verify:** typecheck, unit tests, focused communication tests, production build.

## Assumptions & defaults
- Messages stay human/conversation-focused; system events become notifications unless tied to a record thread.
- Tickets are NOT workflow tasks; they're support/service/escalation cases.
- In-app notifications mandatory for critical workflow actions; email/WhatsApp preference-based, enabled later.
- No new "intelligence" page; existing panels/pages get unified architecture + design.
- Backward compatibility via wrapper routes during migration; legacy synthetic routes removed after.
