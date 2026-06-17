-- ============================================================
-- Siomac — Phase 13: Department data-scoping
-- Run this in the Supabase SQL editor (after phase12-roles.sql).
--
-- Roles answer "what can you do"; this adds "whose records can you touch".
-- A department-bound role ('own' scope) sees/edits only their own department's
-- records; org-wide roles ('all') see everything.
--   superadmin, admin → all      manager, employee, custom roles → own (default)
-- ============================================================

-- ── 1. roles.scope ───────────────────────────────────────────
ALTER TABLE public.roles
  ADD COLUMN IF NOT EXISTS scope text NOT NULL DEFAULT 'own'
  CHECK (scope IN ('own', 'all'));

-- Org-wide roles see all departments.
UPDATE public.roles SET scope = 'all'  WHERE name IN ('superadmin', 'admin');
UPDATE public.roles SET scope = 'own'  WHERE name IN ('manager', 'employee');

-- ── 2. project_sites.department_id ───────────────────────────
-- A site may belong to a department. NULL = org-wide / unassigned (visible to
-- everyone). Scoped users see their department's sites + unassigned ones.
ALTER TABLE public.project_sites
  ADD COLUMN IF NOT EXISTS department_id text NULL
  REFERENCES public.departments(id) ON DELETE SET NULL;

CREATE INDEX IF NOT EXISTS idx_project_sites_department ON public.project_sites (department_id);

-- ── 3. Verify ────────────────────────────────────────────────
SELECT name, scope FROM public.roles ORDER BY sort_order;
-- Expected: superadmin/all, employee/own, admin/all, manager/own, + customs (own).
