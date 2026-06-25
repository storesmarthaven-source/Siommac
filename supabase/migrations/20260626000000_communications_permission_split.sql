-- ============================================================================
-- Communications permission split — replace broad admin-read with granular keys
--
-- SIOMAC messaging access model (participant-default):
--   communications.view              use messaging; see threads you participate in
--   communications.thread_create     start direct / group / record-linked threads
--   communications.thread_manage_own add/remove participants in threads you OWN
--   communications.record_thread_read read a record-linked thread IF you can view
--                                     that linked record (PTW / incident / CAPA …)
--   communications.moderate          hide/remove inappropriate posts (audited)
--   communications.admin             messaging settings, retention, broadcast, blocks
--   communications.compliance_read   controlled, AUDITED read of private threads
--   communications.compliance_export export message history for approved cases
--
-- Deliberately NOT seeded to ANY role:
--   communications.compliance_read / communications.compliance_export
--     → assigned PER-USER only, via user_permissions overrides in the Console.
--       Even superadmin must still go through the audited grant flow to read a
--       private thread (the read-gate requires an active grant row, not just the
--       permission). Nobody silently reads private DMs.
--
-- Idempotent: every insert uses ON CONFLICT DO NOTHING.
-- ============================================================================

-- ── Everyone who can use messaging can start threads + manage their own ───────
insert into public.role_permissions (role_name, permission) values
  ('employee',   'communications.thread_create'),
  ('employee',   'communications.thread_manage_own'),
  ('manager',    'communications.thread_create'),
  ('manager',    'communications.thread_manage_own'),
  ('admin',      'communications.thread_create'),
  ('admin',      'communications.thread_manage_own'),
  ('superadmin', 'communications.thread_create'),
  ('superadmin', 'communications.thread_manage_own')
on conflict do nothing;

-- ── Record-linked thread inheritance — managers / admins who work records ─────
insert into public.role_permissions (role_name, permission) values
  ('manager',    'communications.record_thread_read'),
  ('admin',      'communications.record_thread_read'),
  ('superadmin', 'communications.record_thread_read')
on conflict do nothing;

-- ── Moderation — admins (and superadmin) only ────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('admin',      'communications.moderate'),
  ('superadmin', 'communications.moderate')
on conflict do nothing;

-- communications.view (all roles) and communications.admin (admin/superadmin)
-- were already seeded by earlier migrations; left untouched.

-- Compliance keys are intentionally NOT seeded to any role (per-user only).
