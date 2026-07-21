# MESSAGING P0 CONTRACT — SIOMAC Hardening Track 1

Status: **IMPLEMENTED** (2026-07-15).  
All five P0 items are covered in migrations 300–350.  
Read this before touching any messaging RPC, migration, or TS caller.

---

## Locked product decisions

| Decision | Value |
|---|---|
| Message editing | **DISABLED** — delete-only. No `message_revisions`. |
| Soft-delete window | 15 min for own posts; moderation delete (`messages.delete.any`) requires a reason + audit event. Blocked under legal hold. |
| Read state | Per-participant **read cursor** (`last_read_sequence`, monotonic = `greatest(current, requested)`). Per-message receipts kept for delivery-detail/audit. |
| Attachments | Quarantine until `scan_status = 'clean'`. Only clean attachments may be sent. Ownership check in every send RPC. |
| Presence | `online` / `offline` only for initial corporate release. No auto-`away` from inactivity. |
| Events | Transactional outbox (`message_event_outbox`) + client idempotency keys + per-thread monotonic `sequence` + `version`. |
| DM membership | Immutable — add/remove RPCs reject `thread_type = 'direct'`. |

---

## Custom SQLSTATE → HTTP mapping

All messaging RPCs use the `MSG*` prefix (mirrors the workflow-engine `WF*` convention).

| SQLSTATE | HTTP | Meaning |
|---|---|---|
| `MSG400` | 400 | Bad request / missing required input |
| `MSG403` | 403 | Forbidden (not a participant, not an owner, etc.) |
| `MSG404` | 404 | Resource not found |
| `MSG409` | 409 | Conflict (duplicate, version mismatch, invariant violation) |
| `MSG422` | 422 | Unprocessable (business rule: attachment not clean, etc.) |

Mapped in `messagingRpc.ts` → `msgRpcHttpError()`.

---

## Side-effect ownership table

| Mutation | In-txn (RPC) | Post-commit (TS wrapper) |
|---|---|---|
| `messaging_create_thread_tx` | `message_threads`, `message_participants`, `message_posts`, attachment link, `message_event_outbox`, `app_events` | `deliverEventNotifications`, `emitSignal(others, 'messages')` |
| `messaging_send_message_tx` | `message_posts`, attachment link, `message_post_receipts`, thread summary, `message_event_outbox`, `app_events` | `deliverEventNotifications`, `emitSignal(all_participants, 'messages')` |
| `messaging_add_participants_tx` | `message_participants` (UPSERT re-entry), system post, `message_event_outbox`, `app_events` | `deliverEventNotifications`, `emitSignal(all_active, 'messages')` |
| `messaging_remove_participant_tx` | `message_participants.removed_at`, system post, `message_event_outbox`, `app_events` | `emitSignal(remaining_participants, 'messages')` |
| `messaging_pin_tx` | `message_pins`, thread `version`, `app_events` | `emitSignal(all_active, 'messages')` |
| `messaging_mark_read_tx` | `message_participants.last_read_sequence`, `message_post_receipts` (bounded) | `emitSignal([actor], 'summary')` + `emitSignal(active_participants, 'messages')` (so the SENDER's read receipts refresh) |

---

## RPC signatures (all: SECURITY INVOKER, service_role-only)

### `public.messaging_create_thread_tx`

```sql
(
  p_thread_type          text,         -- 'direct'|'group'|'record'|'system'
  p_subject              text,         -- null OK for direct
  p_source_module        text,         -- null for non-record threads
  p_source_entity_type   text,
  p_source_entity_id     text,
  p_created_by           text,         -- app_users.id (TEXT)
  p_participant_ids      jsonb,        -- array of TEXT user IDs (NOT including creator)
  p_body                 text,         -- first post body (null allowed if attachment present)
  p_priority             text,         -- 'normal'|'important'|'urgent'|'action_required'
  p_attachment_ids       jsonb,        -- ["uuid",...] — pre-uploaded, scan_status='clean'
  p_request_key          text,         -- client UUID for thread-level idempotency
  p_client_msg_key       text          -- client UUID for first-post idempotency
) returns jsonb
-- returns: { threadId, postId, sequence, threadVersion, eventId, activeParticipantIds }
```

### `public.messaging_send_message_tx`

```sql
(
  p_thread_id            uuid,
  p_actor_id             text,         -- authenticated user ID
  p_body                 text,         -- null allowed if attachment present
  p_priority             text,
  p_reply_to_post_id     uuid,         -- null = not a reply
  p_attachment_ids       jsonb,        -- ["uuid",...] — scan_status='clean'
  p_client_msg_key       text          -- client UUID (idempotency)
) returns jsonb
-- returns: { postId, sequence, threadVersion, eventId, activeParticipantIds }
-- idempotent: duplicate p_client_msg_key returns { postId, sequence, threadVersion, duplicate:true }
```

### `public.messaging_add_participants_tx`

```sql
(
  p_thread_id    uuid,
  p_actor_id     text,    -- must be owner or communications.admin
  p_user_ids     jsonb,   -- array of TEXT user IDs to add
  p_actor_role   text     -- hint for admin check (requireUser resolves DB role anyway)
) returns jsonb
-- returns: { addedUserIds, activeParticipantIds }
-- Reuses ON CONFLICT (thread_id, user_id) DO UPDATE SET removed_at = NULL — re-entry fix.
-- Rejects direct threads (MSG409).
-- Signals ALL active participants (not just actor+new).
```

### `public.messaging_remove_participant_tx`

```sql
(
  p_thread_id      uuid,
  p_actor_id       text,   -- owner or communications.admin; self-removal always allowed
  p_target_user_id text,
  p_actor_role     text
) returns jsonb
-- returns: { left: bool }
-- Guards: last owner cannot be removed (MSG409); DM immutable (MSG409); target must be active.
-- Idempotent: already-removed target returns { left: false }.
```

### `public.messaging_pin_tx`

```sql
(
  p_action       text,   -- 'pin' | 'unpin' (explicit, not toggle)
  p_thread_id    uuid,
  p_actor_id     text,
  p_post_id      uuid,   -- null for thread pin
  p_pin_type     text,   -- 'thread' | 'post'
  p_visibility   text,   -- 'thread' | 'personal'
  p_note         text,
  p_expected_version bigint  -- If-Match; null = no concurrency check
) returns jsonb
-- Unpin: sets unpinned_at/unpinned_by on the LATEST active pin for this thread+post.
-- 409 if expected_version provided and thread.version differs.
-- Thread version is bumped on every pin/unpin.
```

### `public.messaging_mark_read_tx`

```sql
(
  p_thread_id       uuid,
  p_actor_id        text,
  p_up_to_sequence  bigint  -- monotonic cursor: greatest(current, this)
) returns jsonb
-- returns: { lastReadSequence }
-- Updates message_participants.last_read_sequence = greatest(current, p_up_to_sequence).
-- Updates message_post_receipts.read_at for un-read posts up to p_up_to_sequence (bounded set-based).
-- Emits emitSignal([actor], 'summary') post-commit (via TS wrapper).
```

---

## Migration file list and apply order

All migrations are in `supabase/migrations/`. Apply in this exact order:

| # | File | What it does |
|---|---|---|
| 1 | `20260919000300_messaging_p0_foundation.sql` | `msg_internal` schema; `message_request_receipts` (idempotency ledger); `message_event_outbox`; `message_upload_sessions`; schema deltas: `message_threads.{next_message_sequence, version}`, `message_posts.{sequence, client_idempotency_key}`, `message_participants.last_read_sequence`, `message_attachments.upload_session_id`; partial unique index on `(thread_id, author_user_id, client_idempotency_key)`; `msg_internal._claim_request` + `_record_request` helpers |
| 2 | `20260919000310_messaging_create_thread_tx.sql` | `public.messaging_create_thread_tx` |
| 3 | `20260919000320_messaging_send_message_tx.sql` | `public.messaging_send_message_tx` |
| 4 | `20260919000330_messaging_membership_tx.sql` | `public.messaging_add_participants_tx` + `public.messaging_remove_participant_tx` |
| 5 | `20260919000340_messaging_pin_read_tx.sql` | `public.messaging_pin_tx` + `public.messaging_mark_read_tx` |
| 6 | `20260919000350_messaging_signals_rls.sql` | Replace `SELECT USING(true)` on `communication_signals` with authenticated + channel-key-scoped policy |

After applying each (or all at once):
```sql
NOTIFY pgrst, 'reload schema';
```

Then: `npm run build:backend` and restart `dev:netlify`.

---

## Invariants as tests (E2E suite: `scripts/e2e/suites/messaging.mjs`)

| Test | What it asserts |
|---|---|
| Atomic rollback | Thread creation with an invalid (unowned) attachment ID leaves zero new rows in message_threads |
| Idempotent retry | Sending with the same `clientMsgKey` twice returns the same `postId` |
| Concurrent ordering | Two simultaneous sends produce distinct monotonically-increasing sequences |
| Auth matrix: non-participant | `posts` endpoint returns 403 for a non-participant |
| DM invariants | `add_participants` to a direct thread returns 409 |
| Re-entry | Removing then re-adding a participant restores the existing row (`removed_at = NULL`) |
| Last-owner | Removing the only owner returns 409 |
| Attachment cross-user hijack | Sending another user's pre-uploaded attachment returns 403 |
| Attachment not-clean | Sending a `scan_status='blocked'` attachment returns 422 |
| Read cursor monotonic | `markThreadRead` with a lower sequence than current has no effect |
| Pin version conflict | `pin` with wrong `expectedVersion` returns 409 |
| Pin unpin authority | Only thread participant may unpin |
| Signal RLS | Unauthenticated websocket cannot read another user's signal rows |

---

## FORBIDDEN / DEFERRED

**FORBIDDEN in this deliverable:**
- Creating parallel thread/post/participant/pin/receipt/attachment tables
- Accepting `actor_user_id` as a request body field (always from authenticated session)
- Bumping `@supabase/supabase-js` from 2.105.3
- Message editing (`message_revisions`)

**DEFERRED (explicit backlog):**
- Full upload-session lifecycle (client creates session → quarantine → scan → finalize)
- Moderator role and group governance
- Full-text search RPC (P1 #12)
- Unbounded receipt cleanup (P1 #11)
- Outbox worker (mirrors `workflow-outbox-worker.ts`) — the outbox table is created; the worker is deferred
- Retention / legal hold controls (P2)
- Audit export (P2)
