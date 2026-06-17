-- ============================================================
-- Siomac — Phase 11: Enterprise audit log
-- Run this in the Supabase SQL editor.
--
-- Builds on the existing activity_logs table (written by log_() on every
-- privileged action). Adds request context, indexes for the viewer's filters,
-- and append-only integrity so audit records cannot be altered or deleted via
-- the API.
-- ============================================================

-- ── 1. Request context columns ───────────────────────────────
ALTER TABLE public.activity_logs
  ADD COLUMN IF NOT EXISTS ip_address text NULL,
  ADD COLUMN IF NOT EXISTS user_agent text NULL;

-- ── 2. Indexes for the viewer (filter by time / user / action / entity) ──
CREATE INDEX IF NOT EXISTS idx_activity_logs_created_at ON public.activity_logs (created_at DESC);
CREATE INDEX IF NOT EXISTS idx_activity_logs_user_id    ON public.activity_logs (user_id);
CREATE INDEX IF NOT EXISTS idx_activity_logs_action     ON public.activity_logs (action);
CREATE INDEX IF NOT EXISTS idx_activity_logs_entity     ON public.activity_logs (entity);

-- ── 3. Append-only integrity ─────────────────────────────────
-- The service-role backend inserts rows; nobody updates or deletes them.
-- RLS is enabled with NO update/delete policies → those operations are denied
-- for anon/authenticated. The service-role key bypasses RLS for inserts only
-- because we never issue update/delete from the backend.
ALTER TABLE public.activity_logs ENABLE ROW LEVEL SECURITY;

-- Allow reads for authenticated users (the viewer route additionally gates on
-- the 'audit.view' permission server-side).
DROP POLICY IF EXISTS "activity_logs_read" ON public.activity_logs;
CREATE POLICY "activity_logs_read"
  ON public.activity_logs
  FOR SELECT
  USING (true);

-- Belt-and-braces: a trigger that blocks UPDATE/DELETE even for elevated roles,
-- making the table truly append-only.
CREATE OR REPLACE FUNCTION public.activity_logs_no_mutate()
RETURNS trigger
LANGUAGE plpgsql
AS $$
BEGIN
  RAISE EXCEPTION 'activity_logs is append-only';
END;
$$;

DROP TRIGGER IF EXISTS activity_logs_block_update ON public.activity_logs;
CREATE TRIGGER activity_logs_block_update
  BEFORE UPDATE OR DELETE ON public.activity_logs
  FOR EACH ROW EXECUTE FUNCTION public.activity_logs_no_mutate();

-- ── 4. Optional retention (add in Dashboard → Scheduled jobs) ─
-- Prune audit rows older than 1 year (adjust to your policy):
--   DELETE FROM public.activity_logs WHERE created_at < now() - interval '1 year';
-- NOTE: the no-mutate trigger blocks DELETE; disable it for the prune job, or
-- run the prune as a maintenance task that drops+recreates the trigger.

-- ── 5. Verify ────────────────────────────────────────────────
SELECT column_name FROM information_schema.columns
WHERE table_schema = 'public' AND table_name = 'activity_logs'
  AND column_name IN ('ip_address', 'user_agent');
-- Expected: 2 rows
