-- ============================================================================
-- Approval "seen" receipts — per-(reviewer, approval) acknowledgement.
--
-- The Approvals sidebar badge shows the count of pending grant requests the actor
-- can act on that they have NOT yet acknowledged (unseenActionableCount), separate
-- from the total actionable backlog (pendingActionableCount). A reviewer opens
-- Access Control > Approvals; after the queue loads, the FE calls markSeen({asOf})
-- and the server writes a receipt for every actionable approval visible through
-- that snapshot. This clears ONLY the unseen count; the backlog is unchanged, and
-- a request committed after the snapshot stays unseen.
--
-- WHY receipts, not a single per-user watermark (supersedes the first cut of this
-- migration, `approval_seen_watermarks`):
--   • A global "last seen" timestamp acknowledges any request that lands between
--     the queue read and the markSeen write (acknowledgement race).
--   • It also hides approvals that become NEWLY VISIBLE when a reviewer's scope
--     expands (compliance-only reviewer later granted permissions.manage): a recent
--     global watermark would mark those older, previously-invisible approvals as
--     seen. Per-approval receipts are keyed to the exact approval, so a
--     never-receipted approval is correctly unseen after a scope change.
--
-- Backend service-role only: the browser never reads this table directly (custom
-- JWT auth, not Supabase Auth, so auth.uid() cannot gate it). RLS enabled with no
-- policy → deny-all to anon/authenticated; service_role bypasses RLS.
--
-- IDs are TEXT: app_users.id and permission_grant_approvals.id are both TEXT.
--
-- PROVENANCE / FORWARD-SAFETY: an earlier form of migration 460 created
-- `approval_seen_watermarks`. That form reached ONLY disposable/shared development
-- (this slice is uncommitted; no other environment has recorded 460). This file is
-- fully IDEMPOTENT and self-healing — `drop table if exists` + `create table if not
-- exists` — so a single forward run produces the correct end state on ANY database,
-- whether it previously had the watermark table, the receipts table, or neither.
-- If a migration runner elsewhere has already recorded the old 460, apply this file
-- as a reviewed forward migration there (do NOT rely on it auto-re-running).
-- ============================================================================

begin;

-- Drop the superseded single-watermark design if it was applied. Nothing depends
-- on it (uncommitted slice), so this is a clean forward correction, not a shim.
drop table if exists public.approval_seen_watermarks;

create table if not exists public.approval_seen_receipts (
  user_id     text        not null references public.app_users(id) on delete cascade,
  approval_id text        not null references public.permission_grant_approvals(id) on delete cascade,
  seen_at     timestamptz not null default now(),
  -- One receipt per (reviewer, approval): the PK prevents duplicate seen records.
  primary key (user_id, approval_id)
);

-- Count query filters by user_id then intersects approval ids.
create index if not exists approval_seen_receipts_user_idx
  on public.approval_seen_receipts (user_id);

alter table public.approval_seen_receipts enable row level security;

revoke all on table public.approval_seen_receipts from public, anon, authenticated;
grant select, insert on table public.approval_seen_receipts to service_role;

commit;

notify pgrst, 'reload schema';
