# SIOMAC ERP — Messaging System: Frontend & Backend Architecture + Implementation

> Status: design spec. Reconciles the **canonical thread-based backbone** (already
> in the DB) with the **legacy `messages` system** still serving production, and
> defines the build + cutover. Mirrors the patterns proven by the Notification
> Center (PageHeader/TabBar sections, POST-only routes, `communication_signals`
> realtime, `emitAppEvent` notifications).

---

## 0. Principle

> A message is a post in a **thread** with **participants** — not a row addressed
> to one person.

The system is **thread-based, participant-scoped, realtime, and
notification-aware**. Protected data flows only through authenticated Netlify
POST routes; the browser never reads message tables directly. The canonical
backbone is the source of truth; the legacy `messages`/`message_replies`/
`message_reads` tables are retired after cutover.

---

## 1. Current State → Target (reconciliation)

| Concern | Canonical (target) | Legacy (retire) |
|---|---|---|
| Tables | `message_threads`, `message_participants`, `message_posts` | `messages`, `message_replies`, `message_reads` |
| Realtime | `communication_signals` (domain `messages`) + `useRealtimeSignals` | `RealtimeController` direct table subs + 5s poll |
| Backend | `routes/communications.ts` (`communications/messages/*`) | `routes/messages.ts` (`sendMessage`, `getMessages`, …) |
| Frontend | Message Center section + header dropdown (Preact, canonical) | `nav/MessagesPanel.ts` (imperative, `#hdrMsgModal`) |
| Unread | `participant.last_read_at` vs latest post | `message_reads` + `read_by_recipient` |

**Already built / wired:** canonical tables (RLS, indexes), `createMessageThread`,
`POST .../messages/post` (emits `emitSignal(..,'messages')`), `useMessageThreads`/
`useMessagePosts`/`usePostMessage`/`useCreateMessageThread`, `messageKeys`,
`useRealtimeSignals` routing `messages` → `messageKeys`.

**Gaps to close (this spec):** no `markRead` handler; thread list not enriched
(no participant profiles / last post / unread count); `messagesUnread` is
approximate; no in-app **notification** on message receipt; no full-page **Message
Center**; the new `MessagePanel` is unmounted and points at legacy routes; no
group/record-linked thread UI; legacy data not migrated.

---

## 2. Data Model

### 2.1 Existing canonical tables (keep)
- **`message_threads`** — `id, thread_type(direct|group|record|system), subject, source_module, source_entity_type, source_entity_id, created_by→app_users, created_at, archived_at, metadata`.
- **`message_participants`** — PK `(thread_id, user_id)`, `role(owner|participant|watcher), last_read_at, archived_at`.
- **`message_posts`** — `id, thread_id, author_user_id→app_users, body, is_system, metadata, created_at`.
- **`communication_signals`** — `channel_key, domain` (realtime ping only, no payload).

### 2.2 Additions (new migration `..._messaging_enhance.sql`)
- `message_posts.attachment_count int default 0`, `edited_at timestamptz`, `deleted_at timestamptz` (soft delete for posts).
- `message_threads.last_post_at timestamptz` + `last_post_preview text` — denormalized for fast inbox sort/preview (maintained on post insert).
- `message_attachments(id, post_id→message_posts cascade, file_name, file_path, content_type, size_bytes, uploaded_by→app_users, created_at)` — reuse the presigned-upload pattern from Risk/JSA attachments.
- (Optional) `message_reactions(post_id, user_id, emoji, created_at)` — deferred.
- **Unread model:** a thread is unread for a participant when `latest(message_posts.created_at) > participant.last_read_at` (or `last_read_at IS NULL`). Unread **count** = posts in thread after `last_read_at` not authored by the user.

---

## 3. Backend Architecture

### 3.1 Routes — all under `routes/communications.ts`, POST-only, `requirePermission('communications.view')`

| Endpoint | Args | Purpose |
|---|---|---|
| `communications/messages/threads` | `{ tab?: 'inbox'\|'sent'\|'archived'\|'all', search?, limit?, cursor? }` | Enriched, paginated thread list for the user (participant rows + thread + last post preview + unread count + other-participant profiles). |
| `communications/messages/thread` | `{ threadId }` | Single thread detail (thread + participants w/ profiles + my role/last_read_at). |
| `communications/messages/posts` | `{ threadId, limit?, cursor? }` | Paginated posts (ascending), oldest→newest with cursor. Does **not** auto-mark read. |
| `communications/messages/createThread` | `{ threadType, subject, participantUserIds[], body, sourceModule?, sourceEntityType?, sourceEntityId? }` | Create thread + participants + first post; emit signal + notifications. |
| `communications/messages/post` | `{ threadId, body, attachmentIds? }` | Append a post; bump `last_post_*`; emit signal + notifications to other participants. |
| `communications/messages/markRead` | `{ threadId }` | Set my `participant.last_read_at = now()`; emit `summary` signal so my badge clears on other devices. **(currently missing — implement)** |
| `communications/messages/archive` | `{ threadId, archived: bool }` | Toggle `participant.archived_at` (per-user archive). |
| `communications/messages/participants/add` | `{ threadId, userIds[] }` | Owner-only; adds participants + system post "X added Y". |
| `communications/messages/participants/remove` | `{ threadId, userId }` | Owner-only; soft-removes (system post). |
| `communications/messages/search` | `{ query, limit? }` | Full-text over `message_posts.body` within the user's threads. |
| `communications/messages/recipients` | `{ query? }` | Active `app_users` the requester may message (dept/role-scoped), for compose. |

Admin-only management (delete any thread, broadcast→thread) gated on
`communications.admin`.

### 3.2 Lib — `lib/communications.ts`
- `createMessageThread(input)` *(exists)* — creator `owner`, rest `participant`, first post, `emitSignal(others,'messages')`. **Add:** `emitAppEvent('communications.thread.created', …)` per recipient.
- `postMessage({ threadId, authorId, body, attachmentIds })` **(new — extract from the route)** — insert post → bump `last_post_at/preview` → `emitSignal(others,'messages')` → `emitAppEvent('communications.message.received', recipients=other active participants)`.
- `listThreadsForUser(userId, { tab, search, limit, cursor })` **(new)** — join participants→threads, compute unread count + other-participant profiles + last-post preview; order by `last_post_at desc`.
- `getThread(threadId, userId)` / `getThreadPosts(...)` **(new/extract)**.
- `markThreadRead(threadId, userId)` **(new)** — upsert `last_read_at`, `emitSignal([userId],'summary')`.
- `archiveThread(threadId, userId, archived)` **(new)**.
- `getCommsSummary` **(fix)** — `messagesUnread` = count of threads with `latest post.created_at > last_read_at`, not `last_read_at IS NULL`.

### 3.3 Realtime
Every post / thread create / markRead calls `emitSignal(targetUserIds, domain)`
→ inserts `communication_signals` rows for each target's `channel_key` →
`useRealtimeSignals` invalidates `messageKeys.all` + `communicationKeys.summary()`
and calls `scheduleHdrBadgeSync()`. No browser-side table subscriptions; no poll.

### 3.4 Notifications (message → notification engine)
`postMessage` and `createMessageThread` emit `emitAppEvent`:
- `communications.message.received` → other active participants, `severity:'info'`, `actionRoute:'s-messages'`, **not** action-required, `dedupeKey: msg:<threadId>:<postId>`.
- `communications.message.mention` → @-mentioned users, higher emphasis (future, when @mentions ship).
- `communications.thread.created` → added participants.
Recipient routing is via `explicitRecipients` (participants are known) — no
`event_rules` needed. Respect `notification_preferences` / `notification_mutes`
(the engine already does).

### 3.5 Permissions
`communications.view` — read/post in threads the user participates in.
`communications.admin` — broadcast, manage/delete any thread, add arbitrary
participants. (Mirrors the Notification Center's admin gating.)

---

## 4. Frontend Architecture

Two surfaces share the same hooks (like Notification Center + bell dropdown):

### 4.1 Header dropdown — `#hdrMsgModal` (replaces `MessagesPanel.ts`)
Compact `MessageDropdown.tsx` (analogous to `NotificationDropdown.tsx`):
header (Messages · unread count · ⋯ · close) → tabs (All / Unread) → recent
threads (avatar, name, last-post preview, time, unread dot) → empty state
("No conversations yet" + "Open Message Center") → "View all" → `s-messages`.

### 4.2 Full-page **Message Center** — section `s-messages`
`MessageCenter.tsx` = `PageHeader` (icon `fa-comments`, "Messages", unread/threads
chips) + `TabBar` (Inbox / Sent / Archived) + a two-pane body:
- **left:** `ThreadList` (search, filter chips, virtualized, unread badges)
- **right:** `Conversation` (header w/ participants + actions, `PostList`, `Composer`)
- **New Message** button on the right of the tab row (per the page standard) →
  `ComposeThreadDialog` (recipient picker, subject, body) → `createThread`.

### 4.3 Registration (same wiring as Notification Center)
- `src/config/index.ts` → add `{ id:'s-messages', label:'Messages', icon:'fa-comments', group:'account' }` to `COMMON_SECTIONS`.
- `src/shell/sections/SharedSections.tsx` → `<AppSection id="s-messages">` with `<div id="preact-messages-root" />`.
- `src/main.tsx` → `mountMessageCenter(root, { queryClient })` + `mountMessageDropdown(hdrRoot, …)`.
- `src/components/sections/Messages/mount.ts` → renders under `QueryClientProvider`.

### 4.4 API hooks — `src/api/communications.ts` (point at canonical routes)
`useMessageThreads({tab,search})`, `useThread(id)`, `useThreadPosts(id)`,
`useCreateMessageThread()`, `usePostMessage()` *(optimistic)*, `useMarkThreadRead()`
*(optimistic, fire on open)*, `useArchiveThread()`, `useMessageSearch(q)`,
`useMessageRecipients(q)`. Cache keys from `messageKeys`. Every mutation
`onSuccess` → invalidate `messageKeys.all` + `communicationKeys.summary()`.
The existing `Messages/api.ts` (legacy `getMessages`/`sendMessage`) is replaced
by these canonical hooks.

### 4.5 Realtime (frontend)
Nothing new — `useRealtimeSignals` (mounted in AppShell) already invalidates
`messageKeys` on `domain:'messages'`. The Center/dropdown are TanStack
subscribers, so they refetch automatically.

---

## 5. Component / File Structure

```
src/components/sections/Messages/
  MessageCenter.tsx          # full-page section (PageHeader + TabBar + 2-pane)
  MessageDropdown.tsx        # #hdrMsgModal header content (replaces MessagesPanel.ts)
  ThreadList.tsx             # inbox list (search, unread badges, virtualized)
  ThreadListItem.tsx         # one thread row (shared by Center + dropdown)
  Conversation.tsx           # right pane: header + PostList + Composer
  PostList.tsx               # message bubbles, grouped by day/author
  Composer.tsx               # textarea + attachments + send (optimistic)
  ComposeThreadDialog.tsx    # new-thread modal (recipient picker + subject + body)
  ParticipantsBar.tsx        # avatars + add/remove (owner)
  mount.ts                   # mountMessageCenter / mountMessageDropdown
  index.ts

src/api/communications.ts    # + message hooks (canonical)
src/api/queryKeys.ts         # messageKeys (exists)

netlify/functions/routes/communications.ts   # + messages/markRead, thread, archive, search, recipients, participants/*
netlify/functions/lib/communications.ts      # + postMessage, listThreadsForUser, markThreadRead, getThread, archiveThread; fix unread count
supabase/migrations/..._messaging_enhance.sql # last_post_*, message_attachments, soft-delete, indexes
```

---

## 6. Thread Lifecycle & Semantics
- **thread_type**: `direct` (1:1), `group` (N people), `record` (linked to an HSE/PTW/etc. entity via `source_*`), `system` (automated).
- **participant.role**: `owner` (can add/remove, archive for all), `participant`, `watcher` (read-only/CC).
- **is_system post**: audit lines ("X added Y", "thread archived"), styled distinctly.
- **read state**: per participant `last_read_at`; opening a thread → `markRead`.
- **record threads** let any module attach a conversation to its record (e.g. an
  incident drawer "Discussion" tab) by `createThread({ threadType:'record', sourceModule:'hse.incidents', sourceEntityId })`.

---

## 7. Event Catalogue (notifications)

| event_type | recipients | severity | action route | action-required |
|---|---|---|---|---|
| `communications.message.received` | other active participants | info | `s-messages` | no |
| `communications.thread.created` | added participants | info | `s-messages` | no |
| `communications.message.mention` *(future)* | mentioned users | info | `s-messages` | no |
| `communications.broadcast` *(exists)* | audience | info+ | — | no |

All via `emitAppEvent` with `explicitRecipients`; deduped per post; subject to
the user's notification preferences/mutes.

---

## 8. Migration / Cutover Plan (legacy → canonical)

**Phase A — finish canonical backend** (no UI risk): add `markRead`, enrich
`threads`, accurate `messagesUnread`, `postMessage`/`listThreadsForUser` lib,
message notifications, `_messaging_enhance` migration.

**Phase B — build canonical UI**: `MessageDropdown` + `Message Center` on the
canonical hooks; register section; mount alongside (don't unmount legacy yet).

**Phase C — data migration** (`..._messages_to_threads.sql`): for each legacy
`messages` row → create a `direct` `message_threads` row (subject, created_by =
from_user) + 2 `message_participants` (from/to) + a `message_posts` for the body
and one per `message_replies`; map `message_reads.last_read_at` →
`participant.last_read_at`. Idempotent, keyed by a `legacy_message_id` in
`metadata`.

**Phase D — cutover**: swap `NavController` to mount `MessageDropdown` instead of
`MessagesPanel.ts`; the `#hdrMsgModal` panes are driven by Preact.

**Phase E — retire legacy** (after parity verified): delete `MessagesPanel.ts`,
`routes/messages.ts` (+ unmount in `api.ts`), the legacy `messages`/
`message_replies`/`message_reads` table subscriptions in `RealtimeController.ts`
(this is also the last thing keeping `RealtimeController` alive on the messages
side), and the `Messages/api.ts` legacy wrapper.

---

## 9. Acceptance Criteria
- User sees a thread inbox sorted by latest activity with unread badges + previews.
- Opening a thread loads posts and marks it read; the header badge updates in realtime on every device (via `communication_signals`).
- Sending a message appends optimistically, persists via `communications/messages/post`, signals other participants, and creates an in-app notification for them (respecting their prefs/mutes).
- New thread compose supports direct + group; record-linked threads can be created by other modules.
- Per-user archive works; archived threads live under the Archived tab.
- `messagesUnread` in the summary equals real unread threads.
- Full-page Message Center + header dropdown share hooks; no direct browser DB reads; all POST-routes behind `communications.view`.
- After cutover, no code path reads the legacy `messages` tables; `RealtimeController` no longer subscribes to them.

---

## 10. Build Order
1. Phase A backend (routes + lib + migration) — verify typecheck/build/tests.
2. `messageKeys` already present; add canonical hooks in `src/api/communications.ts`.
3. `MessageDropdown` (header) on canonical hooks; mount; verify against legacy in parallel.
4. `Message Center` full-page section + registration.
5. `ComposeThreadDialog` + group/record threads + attachments.
6. Message notifications (`emitAppEvent`) + summary unread fix.
7. Data migration (Phase C) on a copy; verify counts.
8. Cutover (Phase D) → retire legacy (Phase E).
