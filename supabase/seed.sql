-- Demo seed data. Run after supabase/schema.sql.
-- Passwords are set by the Netlify setup function because bcrypt hashes are generated in Node.
-- Call GET /.netlify/functions/api with body {"action":"setupDemoUsers"} after running this.

insert into public.departments (id, name, description)
values
  ('DEPT-001', 'Operations', 'Field operations team'),
  ('DEPT-002', 'Administration', 'Office and administrative team')
on conflict (id) do nothing;

-- Add project sites via the admin UI or insert your own below:
-- insert into public.project_sites (name, address, latitude, longitude, radius, description)
-- values ('Site Name', 'Address', 10.6549, -61.5019, 200, '');
