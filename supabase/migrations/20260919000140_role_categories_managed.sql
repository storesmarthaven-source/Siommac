-- ============================================================================
-- Role Categories become a MANAGED taxonomy (add / rename / remove tiers).
-- ============================================================================
-- Evolves 20260919000130 (already applied): the fixed CHECK-constrained
-- `roles.role_category` text column becomes a FK into a new `role_categories`
-- table. The four original tiers are seeded as SYSTEM tiers (protected from
-- delete) so existing `roles.role_category` values stay valid. Admins can then
-- create their own tiers (e.g. Supervisors, Executives) — unlimited roles per tier.
--
-- Operator-applied; after applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.role_categories (
  key         text primary key,
  label       text not null,
  sort_order  integer not null default 100,
  is_system   boolean not null default false,   -- seeded tiers: cannot be deleted (rename ok)
  created_at  timestamptz not null default now(),
  updated_at  timestamptz
);

insert into public.role_categories (key, label, sort_order, is_system) values
  ('administration', 'Administration', 10, true),
  ('management',     'Management',     20, true),
  ('staff',          'Staff',          30, true),
  ('self_service',   'Self-Service',   40, true)
on conflict (key) do nothing;

-- Enforce category validity via FK to the managed table instead of a fixed CHECK.
alter table public.roles drop constraint if exists roles_role_category_check;
alter table public.roles drop constraint if exists roles_role_category_fkey;
alter table public.roles
  add constraint roles_role_category_fkey
  foreign key (role_category) references public.role_categories (key)
  on update cascade on delete restrict;

alter table public.role_categories enable row level security;
