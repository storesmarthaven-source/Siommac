-- 20260919000437_communication_signals_permissions_domain.sql
--
-- Adds a 'permissions' domain to communication_signals so the backend can emit a
-- targeted realtime signal when a user's CAPABILITY-level grants change (compliance
-- grant approved/revoked, or any user_permissions override set/cleared). The
-- affected user's client receives it (filtered by their channel_key, RLS from
-- mig 351) and re-pulls its permission snapshot via getMyPermissionOverrides —
-- the fix for cross-browser/cross-session grant propagation, since maker-checker
-- means the approver is never the affected user.
--
-- The original CHECK (mig 20260621100001) is an INLINE UNNAMED column constraint,
-- so its name is Postgres-auto-generated. Rather than assume that name, discover
-- and drop every CHECK constraint on communication_signals that references the
-- `domain` column (via pg_constraint.conkey), then add a canonically-named one.
-- Idempotent: safe to re-run (the add is guarded by the discover-and-drop).

begin;

do $$
declare
  r record;
begin
  for r in
    select con.conname
    from pg_constraint  con
    join pg_class       rel on rel.oid = con.conrelid
    join pg_namespace   nsp on nsp.oid = rel.relnamespace
    join pg_attribute   att on att.attrelid = rel.oid and att.attname = 'domain'
    where nsp.nspname = 'public'
      and rel.relname = 'communication_signals'
      and con.contype = 'c'                       -- CHECK constraints only
      and att.attnum = any (con.conkey)           -- that reference the domain column
  loop
    execute format(
      'alter table public.communication_signals drop constraint %I', r.conname
    );
  end loop;
end $$;

alter table public.communication_signals
  add constraint communication_signals_domain_check
  check (domain in (
    'summary','notifications','messages','tickets','workflow','handoffs','permissions'
  ));

commit;

notify pgrst, 'reload schema';
