-- ============================================================================
-- Finance payroll export artifact command
-- ============================================================================
-- Exporting is artifact generation, not release. This command records one
-- versioned export atomically while preserving the payroll run lifecycle state.
-- ============================================================================

create schema if not exists extensions;
create extension if not exists pgcrypto with schema extensions;

alter table public.finance_payroll_exports
  add column if not exists calculation_version_id uuid,
  add column if not exists version_no integer,
  add column if not exists content_text text,
  add column if not exists content_size_bytes integer,
  add column if not exists content_md5 text,
  add column if not exists serializer_version text;

do $migration$
begin
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.finance_payroll_exports'::regclass
       and conname = 'finance_payroll_exports_calculation_version_fk'
  ) then
    alter table public.finance_payroll_exports
      add constraint finance_payroll_exports_calculation_version_fk
      foreign key (calculation_version_id)
      references public.finance_payroll_calculation_versions(id)
      on delete restrict;
  end if;
  if not exists (
    select 1
      from pg_constraint
     where conrelid = 'public.finance_payroll_exports'::regclass
       and conname = 'finance_payroll_exports_artifact_shape_ck'
  ) then
    alter table public.finance_payroll_exports
      add constraint finance_payroll_exports_artifact_shape_ck
      check (
        (
          calculation_version_id is null
          and version_no is null
          and content_text is null
          and content_size_bytes is null
          and content_md5 is null
          and serializer_version is null
        )
        or (
          calculation_version_id is not null
          and version_no > 0
          and content_text is not null
          and content_size_bytes = octet_length(content_text)
          and content_md5 = md5(content_text)
          and serializer_version is not null
          and format in ('csv','json')
        )
      );
  end if;
end
$migration$;

-- Historical rows were logical placeholders only: no immutable bytes were
-- persisted. Keep them for audit history, but never present one as the current
-- downloadable artifact.
drop trigger if exists trg_finance_payroll_exports_immutable
  on public.finance_payroll_exports;
update public.finance_payroll_exports
   set is_current = false,
       metadata = metadata || jsonb_build_object(
         'quarantined', true,
         'quarantineReason', 'legacy_export_without_immutable_content'
       )
 where content_text is null;

create unique index if not exists finance_payroll_exports_version_uidx
  on public.finance_payroll_exports(run_id, version_no)
  where version_no is not null;
create index if not exists finance_payroll_exports_calculation_version_idx
  on public.finance_payroll_exports(calculation_version_id)
  where calculation_version_id is not null;

create table if not exists public.finance_payroll_export_command_receipts (
  request_key   text primary key,
  request_hash  text not null,
  run_id        uuid not null
                  references public.finance_payroll_runs(id) on delete cascade,
  actor_id      text not null
                  references public.app_users(id) on delete restrict,
  export_id     uuid not null
                  references public.finance_payroll_exports(id) on delete cascade,
  result        jsonb not null,
  created_at    timestamptz not null default now()
);

create index if not exists finance_payroll_export_receipts_run_idx
  on public.finance_payroll_export_command_receipts(run_id, created_at desc);

alter table public.finance_payroll_export_command_receipts enable row level security;
grant select, insert, update, delete
  on public.finance_payroll_export_command_receipts to service_role;

do $migration$
declare
  v_duplicate_run uuid;
begin
  select run_id
    into v_duplicate_run
    from public.finance_payroll_exports
   where is_current = true
   group by run_id
  having count(*) > 1
   limit 1;

  if v_duplicate_run is not null then
    raise exception 'finance_payroll_export: run % has multiple current exports; reconcile before applying this migration',
      v_duplicate_run;
  end if;
end
$migration$;

create unique index if not exists finance_payroll_exports_one_current_uidx
  on public.finance_payroll_exports(run_id)
  where is_current = true;

drop function if exists public.finance_payroll_record_export_tx(
  uuid, text, text, uuid, text, text, text, integer, text, jsonb
);

create or replace function public.finance_payroll_record_export_tx(
  p_run_id          uuid,
  p_actor_id        text,
  p_idempotency_key text,
  p_format          text,
  p_serializer_version text,
  p_metadata        jsonb default '{}'::jsonb
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $fn$
declare
  v_request_key text;
  v_hash        text;
  v_receipt     public.finance_payroll_export_command_receipts%rowtype;
  v_run         public.finance_payroll_runs%rowtype;
  v_version     public.finance_payroll_calculation_versions%rowtype;
  v_export      public.finance_payroll_exports%rowtype;
  v_export_no   text;
  v_version_no  integer;
  v_file_path   text;
  v_event_id    uuid;
  v_result      jsonb;
  v_content     text;
  v_checksum    text;
  v_line_count  integer;
  v_year        integer := extract(year from current_date)::integer;
begin
  if p_run_id is null then
    raise exception 'finance_payroll_export: run is required'
      using errcode = 'PR400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_export: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_export: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if p_format is null or p_format not in ('csv','json') then
    raise exception 'finance_payroll_export: unsupported format %', p_format
      using errcode = 'PR422';
  end if;
  if p_serializer_version is distinct from 'payroll-export-v1' then
    raise exception 'finance_payroll_export: unsupported serializer version %',
      p_serializer_version using errcode = 'PR422';
  end if;
  if p_metadata is null or jsonb_typeof(p_metadata) <> 'object' then
    raise exception 'finance_payroll_export: metadata must be an object'
      using errcode = 'PR422';
  end if;
  if not exists (
    select 1
      from public.app_users u
     where u.id = p_actor_id
       and u.status = 'active'
  ) then
    raise exception 'finance_payroll_export: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor_id || '|payroll_run.export|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'runId', p_run_id,
    'actorId', p_actor_id,
    'format', p_format,
    'serializerVersion', btrim(p_serializer_version),
    'metadata', p_metadata
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));

  select *
    into v_receipt
    from public.finance_payroll_export_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_export: idempotency key was already used for a different request'
        using errcode = 'PR409';
    end if;
    return v_receipt.result || jsonb_build_object('duplicate', true);
  end if;

  -- Different request keys for the same run must still serialize export versions.
  perform pg_advisory_xact_lock(
    hashtextextended('payroll_run.export|' || p_run_id::text, 0)
  );

  select *
    into v_run
    from public.finance_payroll_runs
   where id = p_run_id
   for update;
  if not found then
    raise exception 'finance_payroll_export: run % was not found', p_run_id
      using errcode = 'PR404';
  end if;

  if v_run.status <> 'released' then
    raise exception 'finance_payroll_export: run % is % (only released runs can be exported)',
      p_run_id, v_run.status using errcode = 'PR422';
  end if;
  if v_run.current_calculation_version_id is null then
    raise exception 'finance_payroll_export: released run has no current calculation version'
      using errcode = 'PR409';
  end if;

  select *
    into v_version
    from public.finance_payroll_calculation_versions
   where id = v_run.current_calculation_version_id
     and run_id = v_run.id
   for share;
  if not found then
    raise exception 'finance_payroll_export: calculation version does not belong to the run'
      using errcode = 'PR422';
  end if;
  perform l.id
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_version.id
   order by l.employee_id
     for share;

  select count(*)::integer
    into v_line_count
    from public.finance_payroll_calculation_version_lines l
   where l.calculation_version_id = v_version.id;
  if v_version.employee_count is distinct from v_line_count then
    raise exception
      'finance_payroll_export: calculation version line count % does not match employee count %',
      v_line_count, v_version.employee_count using errcode = 'PR409';
  end if;

  if p_format = 'json' then
    select jsonb_pretty(jsonb_build_object(
      'runId', v_run.id::text,
      'lines', coalesce(
        jsonb_agg(
          jsonb_build_object(
            'employeeId', l.employee_id,
            'base', l.base,
            'taxableGross', l.taxable_gross,
            'gross', l.gross,
            'nisEmployee', l.nis_employee,
            'nisEmployer', l.nis_employer,
            'healthSurcharge', l.health_surcharge,
            'chargeableIncome', l.chargeable_income,
            'paye', l.paye,
            'voluntaryDeductions', l.voluntary_deductions,
            'net', l.net,
            'nisNumberMasked', l.nis_number_masked,
            'nisStatus', l.nis_status,
            'nisClassNo', l.nis_class_no
          )
          order by l.employee_id
        ),
        '[]'::jsonb
      )
    ))
      into v_content
      from public.finance_payroll_calculation_version_lines l
     where l.calculation_version_id = v_version.id;
  else
    select
      'employee_id,base,taxable_gross,gross,nis_employee,nis_employer,' ||
      'health_surcharge,chargeable_income,paye,voluntary_deductions,net,' ||
      'nis_number_masked,nis_status,nis_class_no'
      || coalesce(
        E'\n' || string_agg(
          concat_ws(',',
            case
              when position(',' in l.employee_id) > 0
                or position('"' in l.employee_id) > 0
                or position(E'\r' in l.employee_id) > 0
                or position(E'\n' in l.employee_id) > 0
                then '"' || replace(l.employee_id, '"', '""') || '"'
              else l.employee_id
            end,
            l.base::text,
            l.taxable_gross::text,
            l.gross::text,
            l.nis_employee::text,
            l.nis_employer::text,
            l.health_surcharge::text,
            l.chargeable_income::text,
            l.paye::text,
            l.voluntary_deductions::text,
            l.net::text,
            case
              when position(',' in coalesce(l.nis_number_masked, '')) > 0
                or position('"' in coalesce(l.nis_number_masked, '')) > 0
                or position(E'\r' in coalesce(l.nis_number_masked, '')) > 0
                or position(E'\n' in coalesce(l.nis_number_masked, '')) > 0
                then '"' || replace(coalesce(l.nis_number_masked, ''), '"', '""') || '"'
              else coalesce(l.nis_number_masked, '')
            end,
            case
              when position(',' in coalesce(l.nis_status, '')) > 0
                or position('"' in coalesce(l.nis_status, '')) > 0
                or position(E'\r' in coalesce(l.nis_status, '')) > 0
                or position(E'\n' in coalesce(l.nis_status, '')) > 0
                then '"' || replace(coalesce(l.nis_status, ''), '"', '""') || '"'
              else coalesce(l.nis_status, '')
            end,
            coalesce(l.nis_class_no::text, '')
          ),
          E'\n'
          order by l.employee_id
        ),
        ''
      )
      into v_content
      from public.finance_payroll_calculation_version_lines l
     where l.calculation_version_id = v_version.id;
  end if;
  v_checksum := encode(digest(convert_to(v_content, 'UTF8'), 'sha256'), 'hex');

  v_export_no := 'EXP-' || v_year::text || '-' ||
    lpad(public.increment_ref_counter('EXP', v_year)::text, 4, '0');
  select coalesce(max(e.version_no), 0) + 1
    into v_version_no
    from public.finance_payroll_exports e
   where e.run_id = v_run.id;
  v_file_path :=
    'payroll_exports/' || v_run.run_no || '/' || v_export_no || '.' || p_format;

  update public.finance_payroll_exports
     set is_current = false
   where run_id = v_run.id
     and is_current = true;

  insert into public.finance_payroll_exports (
    export_no,
    run_id,
    calculation_version_id,
    version_no,
    format,
    file_path,
    checksum,
    content_text,
    content_size_bytes,
    content_md5,
    serializer_version,
    generated_by,
    generated_at,
    is_current,
    metadata
  )
  values (
    v_export_no,
    v_run.id,
    v_version.id,
    v_version_no,
    p_format,
    v_file_path,
    v_checksum,
    v_content,
    octet_length(v_content),
    md5(v_content),
    btrim(p_serializer_version),
    p_actor_id,
    clock_timestamp(),
    true,
    (
      p_metadata
      - 'runNo'
      - 'calculationVersionId'
      - 'lineCount'
      - 'canonicalSource'
    ) || jsonb_build_object(
      'runNo', v_run.run_no,
      'calculationVersionId', v_version.id,
      'lineCount', v_line_count,
      'canonicalSource', 'finance_payroll_calculation_version_lines'
    )
  )
  returning * into v_export;

  update public.finance_payroll_runs
     set exported_at = v_export.generated_at
   where id = v_run.id;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.export.generated',
    'finance_payroll',
    'payroll_run',
    v_run.id::text,
    p_actor_id,
    'success',
    jsonb_build_object(
      'runNo', v_run.run_no,
      'runStatus', v_run.status,
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'exportVersion', v_export.version_no,
      'calculationVersionId', v_export.calculation_version_id,
      'format', v_export.format,
      'checksum', v_export.checksum
    ),
    'finance.payroll.export.generated:' || v_export.id::text
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    previous_state,
    new_state
  )
  values (
    'finance_payroll',
    v_run.id::text,
    p_actor_id,
    'payroll_run.export.generated',
    jsonb_build_object(
      'status', v_run.status,
      'currentExportId', (
        select e.id
          from public.finance_payroll_exports e
         where e.run_id = v_run.id
           and e.id <> v_export.id
         order by e.generated_at desc
         limit 1
      )
    ),
    jsonb_build_object(
      'status', v_run.status,
      'currentExportId', v_export.id,
      'exportNo', v_export.export_no,
      'exportVersion', v_export.version_no,
      'calculationVersionId', v_export.calculation_version_id,
      'format', v_export.format,
      'checksum', v_export.checksum
    )
  );

  v_result := jsonb_build_object(
    'export', to_jsonb(v_export) - 'content_text',
    'eventId', v_event_id,
    'runStatus', v_run.status,
    'duplicate', false
  );

  insert into public.finance_payroll_export_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    export_id,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_run.id,
    p_actor_id,
    v_export.id,
    v_result
  );

  return v_result;
end
$fn$;

create or replace function public.finance_payroll_download_export_tx(
  p_export_id       uuid,
  p_actor_id        text,
  p_idempotency_key text
) returns jsonb
language plpgsql
security invoker
set search_path = public, extensions
as $fn$
declare
  v_request_key text;
  v_hash        text;
  v_receipt     public.finance_payroll_export_command_receipts%rowtype;
  v_export      public.finance_payroll_exports%rowtype;
  v_event_id    uuid;
  v_result      jsonb;
  v_filename    text;
  v_mime_type   text;
  v_duplicate   boolean := false;
begin
  if p_export_id is null then
    raise exception 'finance_payroll_export_download: export is required'
      using errcode = 'PR400';
  end if;
  if p_actor_id is null or btrim(p_actor_id) = '' then
    raise exception 'finance_payroll_export_download: actor is required'
      using errcode = 'PR400';
  end if;
  if p_idempotency_key is null or btrim(p_idempotency_key) = '' then
    raise exception 'finance_payroll_export_download: idempotency key is required'
      using errcode = 'PR400';
  end if;
  if not exists (
    select 1
      from public.app_users u
     where u.id = p_actor_id
       and u.status = 'active'
  ) then
    raise exception 'finance_payroll_export_download: actor is not an active user'
      using errcode = 'PR403';
  end if;

  v_request_key :=
    p_actor_id || '|payroll_export.download|' || btrim(p_idempotency_key);
  v_hash := md5(jsonb_build_object(
    'exportId', p_export_id,
    'actorId', p_actor_id
  )::text);

  perform pg_advisory_xact_lock(hashtextextended(v_request_key, 0));

  select *
    into v_receipt
    from public.finance_payroll_export_command_receipts
   where request_key = v_request_key;
  if found then
    if v_receipt.request_hash is distinct from v_hash then
      raise exception 'finance_payroll_export_download: idempotency key was already used for a different export'
        using errcode = 'PR409';
    end if;
    v_duplicate := true;
    select *
      into v_export
      from public.finance_payroll_exports
     where id = v_receipt.export_id
     for share;
    if not found then
      raise exception 'finance_payroll_export_download: receipt points to a missing export'
        using errcode = 'PR409';
    end if;
  else
    select *
      into v_export
      from public.finance_payroll_exports
     where id = p_export_id
     for share;
    if not found then
      raise exception 'finance_payroll_export_download: export % was not found', p_export_id
        using errcode = 'PR404';
    end if;
  end if;
  if v_export.content_text is null
     or v_export.content_size_bytes is distinct from octet_length(v_export.content_text)
     or v_export.content_md5 is distinct from md5(v_export.content_text)
     or v_export.checksum is distinct from encode(
       digest(convert_to(v_export.content_text, 'UTF8'), 'sha256'),
       'hex'
     )
     or v_export.calculation_version_id is null
     or v_export.version_no is null then
    raise exception 'finance_payroll_export_download: immutable artifact content is unavailable or corrupt'
      using errcode = 'PR409';
  end if;
  if v_duplicate then
    return v_receipt.result || jsonb_build_object(
      'content', v_export.content_text,
      'duplicate', true
    );
  end if;

  v_filename := regexp_replace(v_export.file_path, '^.*/', '');
  v_mime_type := case v_export.format
    when 'json' then 'application/json'
    else 'text/csv'
  end;

  insert into public.app_events (
    event_type,
    source_module,
    source_entity_type,
    source_entity_id,
    actor_user_id,
    severity,
    payload,
    dedupe_key
  )
  values (
    'finance.payroll.export.downloaded',
    'finance_payroll',
    'payroll_export',
    v_export.id::text,
    p_actor_id,
    'info',
    jsonb_build_object(
      'runId', v_export.run_id,
      'exportNo', v_export.export_no,
      'exportVersion', v_export.version_no,
      'format', v_export.format,
      'calculationVersionId', v_export.calculation_version_id
    ),
    'finance.payroll.export.downloaded:' ||
      p_actor_id || ':' || btrim(p_idempotency_key)
  )
  returning id into v_event_id;

  insert into public.hr_audit_log (
    submodule_key,
    record_id,
    actor_id,
    action,
    new_state
  )
  values (
    'finance_payroll',
    v_export.run_id::text,
    p_actor_id,
    'payroll_export.downloaded',
    jsonb_build_object(
      'exportId', v_export.id,
      'exportNo', v_export.export_no,
      'exportVersion', v_export.version_no,
      'format', v_export.format,
      'calculationVersionId', v_export.calculation_version_id,
      'checksum', v_export.checksum
    )
  );

  v_result := jsonb_build_object(
    'exportId', v_export.id,
    'exportNo', v_export.export_no,
    'runId', v_export.run_id,
    'format', v_export.format,
    'checksum', v_export.checksum,
    'contentSizeBytes', v_export.content_size_bytes,
    'mimeType', v_mime_type,
    'filename', v_filename,
    'eventId', v_event_id,
    'duplicate', false
  );

  insert into public.finance_payroll_export_command_receipts (
    request_key,
    request_hash,
    run_id,
    actor_id,
    export_id,
    result
  )
  values (
    v_request_key,
    v_hash,
    v_export.run_id,
    p_actor_id,
    v_export.id,
    v_result
  );

  return v_result || jsonb_build_object('content', v_export.content_text);
end
$fn$;

revoke all on function public.finance_payroll_record_export_tx(
  uuid, text, text, text, text, jsonb
) from public, anon, authenticated;
grant execute on function public.finance_payroll_record_export_tx(
  uuid, text, text, text, text, jsonb
) to service_role;

revoke all on function public.finance_payroll_download_export_tx(
  uuid, text, text
) from public, anon, authenticated;
grant execute on function public.finance_payroll_download_export_tx(
  uuid, text, text
) to service_role;

-- Export content is immutable. The only permitted update is retiring the
-- previous current artifact when a new version is recorded.
create or replace function public.finance_payroll_guard_export_update()
returns trigger
language plpgsql
security invoker
set search_path = public
as $fn$
begin
  if old.is_current is true
     and new.is_current is false
     and (to_jsonb(new) - 'is_current')
       is not distinct from (to_jsonb(old) - 'is_current') then
    return new;
  end if;

  raise exception 'finance payroll export artifacts are immutable'
    using errcode = 'PR409';
end
$fn$;

drop trigger if exists trg_finance_payroll_exports_immutable
  on public.finance_payroll_exports;
create trigger trg_finance_payroll_exports_immutable
  before update on public.finance_payroll_exports
  for each row execute function public.finance_payroll_guard_export_update();

notify pgrst, 'reload schema';
