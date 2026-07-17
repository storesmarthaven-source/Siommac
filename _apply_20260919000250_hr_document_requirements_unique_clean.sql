
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

