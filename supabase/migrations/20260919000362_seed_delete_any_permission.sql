-- Grant communications.messages.delete_any (message moderation soft-delete) to the
-- moderation roles, matching communications.messages.unpin_any. role_permissions is the
-- authoritative role -> permission source read by loadRolePermissions(); superadmin
-- additionally receives every key in code, so this seed is belt-and-suspenders for it.
insert into public.role_permissions (role_name, permission)
values
  ('manager',    'communications.messages.delete_any'),
  ('admin',      'communications.messages.delete_any'),
  ('superadmin', 'communications.messages.delete_any')
on conflict (role_name, permission) do nothing;
