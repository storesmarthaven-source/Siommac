-- ============================================================================
-- 20260919000750_hr_import_batch_scope.sql
--
-- Employee Import — batch ownership scope (audit 2026-07-26, finding P1-3).
--
-- Every import endpoint checked a capability but NONE checked who owned the batch.
-- Any actor holding e.g. hr.employees.import.commit could map, validate, resolve,
-- commit, or download the report of ANOTHER operator's batch given only its UUID —
-- and the report returns complete mapped_data, including date of birth, nationality,
-- NIS and BIR values.
--
-- The route layer now scopes every batch operation to `uploaded_by = actor` unless
-- the actor holds hr.employees.import.manage_all. This migration grants that
-- capability, deliberately NARROWLY: hr_manager keeps full import capability over
-- its OWN batches but cannot reach another operator's staged personal data.
--
-- NOTE: a permission key is inert until it exists in role_permissions — the runtime
-- resolves capabilities from this table, not from the static catalogues.
-- ============================================================================

insert into public.role_permissions (role_name, permission) values
  ('admin',      'hr.employees.import.manage_all'),
  ('superadmin', 'hr.employees.import.manage_all')
on conflict (role_name, permission) do nothing;

-- Index supporting the ownership predicate now applied to every batch lookup.
create index if not exists hr_employee_import_batches_uploaded_by_idx
  on public.hr_employee_import_batches (uploaded_by);

-- ── Mapping allowlist version (audit finding P2-1) ──────────────────────────
-- `mapping` was an open Record<string,string>: any target field name was accepted and
-- persisted. The server now validates targets against a versioned allowlist
-- (lib/hr/importFields.ts); recording the version makes a stored mapping traceable to
-- the contract it was accepted under.
alter table public.hr_employee_import_batches
  add column if not exists mapping_version integer not null default 1;
