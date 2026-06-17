-- ============================================================
-- Siomac — Starter departments
-- Run anytime (idempotent). Adds the common departments so users can be
-- assigned to them immediately. Edit/add more via the Departments page.
--
-- Departments are an org grouping (name + description + optional manager).
-- They are independent of roles: a person has a department (where) AND a
-- role (what). See phase 12 (roles) + the planned F2 department data-scoping.
-- ============================================================

INSERT INTO public.departments (id, name, description) VALUES
  ('DEPT-OPS', 'Operations',     'Field operations team'),
  ('DEPT-ADM', 'Administration', 'Office and administrative team'),
  ('DEPT-HSE', 'HSE',            'Health, Safety & Environment'),
  ('DEPT-FIN', 'Finance',        'Finance & accounting'),
  ('DEPT-HR',  'Human Resources','People & HR')
ON CONFLICT (name) DO NOTHING;

-- Verify
SELECT id, name, description FROM public.departments ORDER BY name;
