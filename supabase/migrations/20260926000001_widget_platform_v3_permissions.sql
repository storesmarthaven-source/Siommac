-- Widget Platform v3 capability surfaces. Capability grants expose administration UI;
-- they never grant access to the business records rendered by a widget.
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'ui.widgets.governance.view'),
  ('superadmin', 'ui.widgets.governance.manage'),
  ('superadmin', 'ui.widgets.sources.view'),
  ('superadmin', 'ui.widgets.sources.manage'),
  ('admin', 'ui.widgets.governance.view'),
  ('admin', 'ui.widgets.governance.manage'),
  ('admin', 'ui.widgets.sources.view'),
  ('admin', 'ui.widgets.sources.manage')
on conflict do nothing;
