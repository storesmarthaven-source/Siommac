-- Demo seed data. Run after supabase/schema.sql.
-- Passwords are set by the Netlify setup function because bcrypt hashes are generated in Node.

insert into public.departments (id, name, description)
values
  ('DEPT-001', 'Construction', 'Road and bridge construction team'),
  ('DEPT-002', 'Administration', 'Office and administrative team')
on conflict (id) do nothing;

insert into public.project_sites (id, name, address, latitude, longitude, radius, description)
values
  ('SITE-001', 'Moro Starting Point', 'Moro', 26.6814598, 68.0169318, 150, ''),
  ('SITE-002', 'Section A - Bridge Construction', 'Moro to Ranipur', 26.6885305, 68.0231489, 200, ''),
  ('SITE-003', 'Section B - Road Work', 'Moro to Ranipur', 26.6954444, 68.0296019, 180, ''),
  ('SITE-004', 'Section C - Earthwork', 'Moro to Ranipur', 26.7024535, 68.0359368, 220, ''),
  ('SITE-005', 'Section D - Drainage', 'Moro to Ranipur', 26.7094488, 68.0422911, 160, ''),
  ('SITE-006', 'Section E - Pavement', 'Moro to Ranipur', 26.7164584, 68.0486262, 190, ''),
  ('SITE-007', 'Ranipur End Point', 'Ranipur', 26.7234578, 68.0549756, 150, '')
on conflict (id) do nothing;
