-- ============================================================================
-- hr_document_requirements: enforce one ACTIVE requirement per
-- (document_type, applies_to_scope, applies_to_value)
-- ============================================================================
-- createRequirement (documentsRequirements.ts) already maps a 23505 unique
-- violation to a 409 "already exists" — but the unique constraint was never
-- created (the table migration only did `create table`), so duplicate
-- requirements were silently accepted. coalesce(applies_to_value,'') makes the
-- global-scope rows (NULL value) unique too; the index is partial on is_active so
-- a RETIRED requirement never blocks creating a fresh one.
-- Operator-applied; idempotent. After applying: NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- Surface any pre-existing active duplicates rather than silently indexing around
-- them (a duplicate here is real data drift from the missing constraint).
do $$
declare d int;
begin
  select count(*) into d from (
    select 1 from public.hr_document_requirements
    where is_active
    group by document_type, applies_to_scope, coalesce(applies_to_value, '')
    having count(*) > 1
  ) x;
  if d > 0 then
    raise exception 'hr_document_requirements has % active duplicate (document_type, scope, value) group(s) — resolve before enforcing the unique index', d;
  end if;
end $$;

create unique index if not exists hr_document_requirements_active_uniq
  on public.hr_document_requirements (document_type, applies_to_scope, coalesce(applies_to_value, ''))
  where is_active;

-- After applying:  NOTIFY pgrst, 'reload schema';
