-- ============================================================================
-- ui_widget_packages — enforce widget-id uniqueness at the DB level.
--
-- routes/widgetPackages.ts already rejects a colliding widget id app-side (a
-- read-then-check against every existing package before the insert), but that
-- is a check-then-act race: two concurrent /widgets/packages/install calls can
-- both pass the app-side check before either commits, landing two packages
-- that both claim the same widget id (silent shadowing at resolve time).
--
-- This trigger is the real guarantee: it takes a transaction-scoped advisory
-- lock to serialize concurrent installs against this table, then re-checks
-- the new row's widget ids against every OTHER package and raises (23505) on
-- a collision. Idempotent — safe to re-run.
-- ============================================================================

create or replace function public.ui_widget_packages_check_unique_ids()
returns trigger
language plpgsql
security definer
set search_path = public
as $$
declare
  v_dup text;
begin
  -- Serialize concurrent installs/updates so the check below can't race.
  perform pg_advisory_xact_lock(hashtext('ui_widget_packages_widgets'));

  select w.value ->> 'id' into v_dup
  from public.ui_widget_packages p
  cross join lateral jsonb_array_elements(p.widgets) as w(value)
  where p.id <> new.id
    and w.value ->> 'id' in (
      select nw.value ->> 'id'
      from jsonb_array_elements(coalesce(new.widgets, '[]'::jsonb)) as nw(value)
    )
  limit 1;

  if v_dup is not null then
    raise exception 'Widget id "%" is already installed in another package', v_dup
      using errcode = '23505';
  end if;

  return new;
end;
$$;

drop trigger if exists trg_ui_widget_packages_check_unique_ids on public.ui_widget_packages;
create trigger trg_ui_widget_packages_check_unique_ids
  before insert or update of widgets on public.ui_widget_packages
  for each row execute function public.ui_widget_packages_check_unique_ids();

-- refresh PostgREST schema cache
select pg_notify('pgrst', 'reload schema');
