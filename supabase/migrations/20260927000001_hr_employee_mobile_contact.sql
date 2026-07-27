-- HR Employee Master — distinct mobile contact
--
-- `app_users.phone` is the employee's work telephone. The full employee record
-- also needs a separately governed mobile number; overloading one column would
-- lose information on every edit/import. Backend-only access remains enforced
-- through the existing authenticated HR employee routes.

alter table public.app_users
  add column if not exists mobile_phone text;

comment on column public.app_users.mobile_phone
  is 'Employee mobile telephone, distinct from the organisation-issued work phone.';

-- Operator-applied. After applying: NOTIFY pgrst, 'reload schema';
