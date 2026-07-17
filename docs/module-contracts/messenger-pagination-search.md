# Messenger — cursor pagination + content search (slice 2 contract)

Adopted roadmap slice 2 (see memory: project-messenger-hardening-roadmap).
Status: contract locked 2026-07-17. One slice; no dual systems — the legacy
JS post-filter pagination inside `listThreadsForUser` is REPLACED, not kept.

## Defects this slice closes
1. **Newest-messages truncation (correctness)**: the FE loaded posts ASCENDING
   `limit:100` — threads >100 posts hid their newest messages entirely.
2. **Broken thread cursor**: cursor keyed by `thread_id` (UUID order) under an
   activity-ordered list — pages didn't line up; `sent`/search were post-query
   JS filters that could shrink a page to 0 while more rows existed.
3. **No message-content search** (name/preview only, client-side).

## REQUIRED

### Posts — directional keyset pages (`/communications/messages/posts`)
- args: `{ threadId, limit? (1..100, default 50), cursor?: string|null,
  direction?: 'backward' | 'forward' (default 'forward' = legacy semantics) }`
- Composite keyset `(created_at, id)` — the id tiebreak fixes same-timestamp
  skip/dupe of the old created_at-only cursor.
- `backward` (the chat default): newest `limit` posts, RETURNED ASCENDING for
  display; `nextCursor` points at the OLDEST returned row — pass it back to
  fetch the previous (older) page; `null` = history exhausted.
- `forward`: legacy ascending semantics preserved for existing callers,
  upgraded to the composite keyset.
- cursor wire format: `"<created_at ISO>|<post uuid>"`; malformed → 400.

### Threads — SQL keyset page (RPC `messaging_list_threads_page`)
- Migration `20260919000410_messaging_pagination_search.sql`.
- Ordering: `last_post_at DESC NULLS LAST, thread_id DESC`; cursor
  `"<last_post_at ISO>|<thread uuid>"`.
- `tab` (`inbox|archived|sent|all`) and `search` (subject/preview ILIKE) are
  SQL-side — pages are exact-size until the final page. `sent` = EXISTS
  (own non-deleted post).
- SECURITY DEFINER, EXECUTE revoked from anon/authenticated, granted to
  service_role only; the route passes the authenticated user id.

### Content search (RPC `messaging_search_posts_page` + new route
`/communications/messages/search`)
- args: `{ query (min 2 chars), limit? (1..50, default 20), cursor? }`
- ILIKE over `message_posts.body` (pg_trgm GIN index) restricted to threads
  where the caller is an ACTIVE participant (v1 scope: participant threads
  only; record-inherited/compliance surfaces keep their own views).
- Returns `{ threadId, postId, subject, snippet, authorUserId, createdAt }`
  keyset-paged newest-first. Deleted posts excluded.
- FTS upgrade path documented, not built (trgm suffices for v1).

### Frontend consumption
- `loadThreadDetail` → `direction:'backward', limit:50`; per-thread
  `olderCursor` retained; "Load earlier messages" control at the top of the
  list loads the previous page and PREPENDS without moving the reader's
  scroll position.
- Thread list: first page (30) + "Load more conversations" when
  `nextCursor` non-null. Queue tab counts become page-scoped (documented).
- Sidebar search ≥2 chars also queries `/messages/search`; content hits are
  shown as an "In messages" group that opens the thread.

### FORBIDDEN
- Client-side re-filtering that can void a server page (`sent`, search).
- Cursor formats other than `"<ISO>|<uuid>"`.
- Loading a thread's full history in one request.

### DEFERRED (documented, not built)
- Postgres FTS ranking; per-message unread badge; jump-to-searched-post
  scroll targeting inside the thread (search opens the thread for v1).

## E2E (messengerPagination.mjs) — boundary proofs
- Posts backward: 7 posts, page 3 → exact [7,6,5],[4,3,2],[1], each page
  ascending, terminal cursor null; a NEW post inserted mid-pagination must
  not skip or duplicate rows on the next page (keyset stability).
- Posts forward compat: ascending pages with composite keyset.
- Threads: 5 tagged threads, page 2 → exact activity order, no overlap,
  terminal null; `sent` and `search` pages are exact-size SQL pages.
- Search: participant sees the needle; NON-participant with the same query
  sees NOTHING (isolation negative); paging boundary; 1-char query → 400;
  malformed cursor → 400.
