-- Installable declarative widget packages (no-code widgets), org-wide.
-- A package is a name/version + an array of DeclarativeWidgetSpec (jsonb). Managed via the
-- authenticated JWT API /api/widgets/packages/* (install/uninstall are admin-only; list is any
-- authenticated user). Service-role backend accesses this; no direct browser reads.
create table if not exists public.ui_widget_packages (
  id           uuid primary key default gen_random_uuid(),
  name         text not null,
  version      text,
  widgets      jsonb not null default '[]'::jsonb,
  installed_by text references public.app_users(id) on delete set null,
  created_at   timestamptz not null default now(),
  updated_at   timestamptz
);

alter table public.ui_widget_packages enable row level security;

comment on table public.ui_widget_packages is
  'Installed declarative (no-code) widget packages, org-wide. Each row = a package (name/version) with a DeclarativeWidgetSpec[] in `widgets`. Managed via /api/widgets/packages/*.';

-- refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
