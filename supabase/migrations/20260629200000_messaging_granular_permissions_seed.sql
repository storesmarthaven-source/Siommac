-- ============================================================================
-- Rich Message Center — seed the granular message/participant permission keys
-- into role_permissions (the DB source of truth). Mirrors the ROLE_PERMISSIONS
-- defaults in netlify/functions/lib/permissions.ts + src/lib/permissions.ts.
--
-- Idempotent: ON CONFLICT DO NOTHING. superadmin is allow-all in code, but we
-- seed it too for completeness/visibility.
-- ============================================================================

-- ── Basic messaging capabilities — everyone who uses messaging ───────────────
-- post, attach, download attachments, delete own attachment, personal pins.
insert into public.role_permissions (role_name, permission) values
  ('employee',   'communications.messages.post'),
  ('employee',   'communications.messages.attach'),
  ('employee',   'communications.messages.download_attachment'),
  ('employee',   'communications.messages.delete_own_attachment'),
  ('employee',   'communications.messages.pin_own'),
  ('employee',   'communications.messages.unpin_own'),
  ('employee',   'communications.participants.add'),
  ('employee',   'communications.participants.remove'),
  ('manager',    'communications.messages.post'),
  ('manager',    'communications.messages.attach'),
  ('manager',    'communications.messages.download_attachment'),
  ('manager',    'communications.messages.delete_own_attachment'),
  ('manager',    'communications.messages.pin_own'),
  ('manager',    'communications.messages.unpin_own'),
  ('manager',    'communications.participants.add'),
  ('manager',    'communications.participants.remove'),
  ('admin',      'communications.messages.post'),
  ('admin',      'communications.messages.attach'),
  ('admin',      'communications.messages.download_attachment'),
  ('admin',      'communications.messages.delete_own_attachment'),
  ('admin',      'communications.messages.pin_own'),
  ('admin',      'communications.messages.unpin_own'),
  ('admin',      'communications.participants.add'),
  ('admin',      'communications.participants.remove'),
  ('superadmin', 'communications.messages.post'),
  ('superadmin', 'communications.messages.attach'),
  ('superadmin', 'communications.messages.download_attachment'),
  ('superadmin', 'communications.messages.delete_own_attachment'),
  ('superadmin', 'communications.messages.pin_own'),
  ('superadmin', 'communications.messages.unpin_own'),
  ('superadmin', 'communications.participants.add'),
  ('superadmin', 'communications.participants.remove')
on conflict do nothing;

-- ── Elevated messaging capabilities — managers / admins (+ superadmin) ───────
-- pin for everyone, remove anyone's pin, change participant roles.
insert into public.role_permissions (role_name, permission) values
  ('manager',    'communications.messages.pin_thread'),
  ('manager',    'communications.messages.unpin_any'),
  ('manager',    'communications.participants.change_role'),
  ('admin',      'communications.messages.pin_thread'),
  ('admin',      'communications.messages.unpin_any'),
  ('admin',      'communications.participants.change_role'),
  ('superadmin', 'communications.messages.pin_thread'),
  ('superadmin', 'communications.messages.unpin_any'),
  ('superadmin', 'communications.participants.change_role')
on conflict do nothing;
