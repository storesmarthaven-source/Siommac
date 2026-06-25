-- ============================================================================
-- HR Employee Master — app_users column restructure (Phase 1 foundation)
-- ============================================================================
-- app_users is the platform identity/auth root (TEXT id, 141 FKs, login). This
-- migration is NON-DESTRUCTIVE: it keeps the table name, id, every FK, status,
-- and full_name, so all existing readers keep working. It:
--   1. Splits the name into first_name / last_name (additive).
--   2. Adds HR Employee-Master fields (supervisor, employment type, site,
--      dates, contractor flag, personal email, display name).
--   3. Backfills first/last from the existing full_name.
--   4. Keeps full_name auto-synced from first/last via a trigger (so writers can
--      set first/last and reads of full_name stay correct — no column drop).
--
-- `status` is intentionally left alone (auth checks status='active'); the richer
-- HR lifecycle lives in hr_employee_status_history (separate migration).
-- Run manually, then: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- ── 1. Name split + HR fields (all additive, nullable / defaulted) ────────────
alter table public.app_users add column if not exists first_name      text;
alter table public.app_users add column if not exists last_name       text;
alter table public.app_users add column if not exists display_name    text;
alter table public.app_users add column if not exists personal_email  text;

alter table public.app_users add column if not exists supervisor_id   text
  references public.app_users(id) on delete set null;
alter table public.app_users add column if not exists site_id         text;   -- cross-ref, no FK (sites.id)

alter table public.app_users add column if not exists employment_type text not null default 'employee'
  check (employment_type in ('employee','contractor','intern','temporary','consultant','seconded'));

alter table public.app_users add column if not exists start_date      date;
alter table public.app_users add column if not exists end_date        date;
alter table public.app_users add column if not exists contractor_flag boolean not null default false;

-- ── 2. Backfill first/last from full_name (only where not yet set) ─────────────
update public.app_users
   set first_name = nullif(split_part(full_name, ' ', 1), ''),
       last_name  = nullif(btrim(substring(full_name from position(' ' in full_name) + 1)), '')
 where (first_name is null and last_name is null)
   and full_name is not null and full_name <> '';

-- Single-word names: keep them in first_name, last_name stays null.
update public.app_users
   set last_name = null
 where last_name = first_name;

-- ── 3. Keep full_name synced from first/last (non-destructive; full_name stays) ─
-- If a writer provides first/last, full_name is derived. If a writer only sets
-- full_name (legacy path), it is preserved. This lets new HR code write
-- first/last while every existing reader of full_name keeps working.
create or replace function public.app_users_sync_full_name()
returns trigger as $$
begin
  if (new.first_name is distinct from old.first_name)
     or (new.last_name is distinct from old.last_name)
     or (tg_op = 'INSERT' and (new.first_name is not null or new.last_name is not null)) then
    new.full_name := btrim(coalesce(new.first_name, '') || ' ' || coalesce(new.last_name, ''));
  end if;
  return new;
end;
$$ language plpgsql;

drop trigger if exists app_users_full_name_sync on public.app_users;
create trigger app_users_full_name_sync
  before insert or update on public.app_users
  for each row execute function public.app_users_sync_full_name();

-- ── 4. Indexes for HR lookups ─────────────────────────────────────────────────
create index if not exists app_users_supervisor_idx on public.app_users(supervisor_id) where supervisor_id is not null;
create index if not exists app_users_site_idx        on public.app_users(site_id)        where site_id is not null;
create index if not exists app_users_employment_type_idx on public.app_users(employment_type);
