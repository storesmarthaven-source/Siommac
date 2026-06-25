-- ============================================================================
-- HR Organization Structure — extend `departments` into an org-unit tree
-- ============================================================================
-- departments (id text 'DEPT-…', name, description, manager_id, timestamps) stays
-- the canonical org table (app_users.department_id FKs it). HR adds hierarchy +
-- typing additively so the existing Departments module becomes HR Organization
-- Structure without forking. Run manually + NOTIFY pgrst.
-- ============================================================================

alter table public.departments add column if not exists parent_id text
  references public.departments(id) on delete set null;

alter table public.departments add column if not exists org_unit_type text not null default 'department'
  check (org_unit_type in ('company','division','department','team','crew','site_department'));

alter table public.departments add column if not exists site_id   text;
alter table public.departments add column if not exists is_active boolean not null default true;

create index if not exists departments_parent_idx on public.departments(parent_id) where parent_id is not null;
create index if not exists departments_site_idx   on public.departments(site_id)   where site_id is not null;
create index if not exists departments_active_idx on public.departments(is_active);
