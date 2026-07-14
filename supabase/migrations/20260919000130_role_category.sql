-- ============================================================================
-- Role Categories — organizational TIER dimension for roles.
-- ============================================================================
-- Category (tier) is orthogonal to Source (`is_system` = System/Custom) and to
-- Module (how capabilities are grouped). A role has exactly one category; it
-- organizes the role DIRECTORY only — it never constrains which capabilities a
-- role can receive, which users are assigned, or where the role operates.
--
-- Staged rollout (existing custom-role categories cannot be safely inferred):
--   1. add NULLABLE role_category (this migration)
--   2. backfill the nine built-ins (D2 mapping, below)
--   3. existing custom roles stay NULL → surfaced as "Needs Categorization"
--   4. every NEW role must pick a category (enforced in createRole API)
--   5. once all roles are classified, a FOLLOW-UP migration makes it NOT NULL
--
-- Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

alter table public.roles add column if not exists role_category text;

alter table public.roles drop constraint if exists roles_role_category_check;
alter table public.roles add constraint roles_role_category_check
  check (role_category is null
    or role_category in ('administration', 'management', 'staff', 'self_service'));

-- Backfill the nine built-ins (only where still NULL, so re-runs are safe).
update public.roles set role_category = 'administration'
  where name in ('superadmin', 'admin') and role_category is null;
update public.roles set role_category = 'management'
  where name in ('manager', 'hr_manager', 'finance_manager') and role_category is null;
update public.roles set role_category = 'staff'
  where name in ('hr_staff', 'finance_staff', 'hse_staff') and role_category is null;
update public.roles set role_category = 'self_service'
  where name in ('employee') and role_category is null;

create index if not exists roles_role_category_idx on public.roles (role_category);
