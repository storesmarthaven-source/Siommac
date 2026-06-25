-- ============================================================================
-- message_thread_access_grants — controlled, audited compliance access to
-- private message threads.
--
-- A grant is created ONLY through the audited request flow
-- (POST /api/communications/messages/requestThreadAccess), which requires
-- communications.compliance_read and writes an app_events + audit_logs row.
--
-- Access model: TIME-BOXED. A grant opens the thread for `user_id` until
-- `expires_at`. The messaging read-gate honours a grant only while
--   revoked_at IS NULL AND expires_at > now().
-- After expiry a new request (new grant row) is required. No role — not even
-- superadmin — reads a private thread without an active grant row here.
--
-- app_users.id is TEXT (not uuid); user_id is a text FK accordingly.
-- ============================================================================

create table if not exists public.message_thread_access_grants (
  id          uuid        primary key default gen_random_uuid(),
  thread_id   uuid        not null references public.message_threads(id) on delete cascade,
  user_id     text        not null references public.app_users(id)       on delete cascade,
  -- why access was requested (investigation | safety_incident | hr_complaint |
  --   legal_compliance | security_review | other)
  reason      text        not null,
  case_ref    text,                 -- case / reference number (optional)
  notes       text,                 -- free-text justification (optional)
  granted_at  timestamptz not null default now(),
  expires_at  timestamptz not null, -- end of the access window
  revoked_at  timestamptz,          -- early revocation (settings/owner action)
  exported_at timestamptz,          -- set when message history was exported under this grant
  created_at  timestamptz not null default now()
);

-- Fast active-grant lookup: "does this user have a live grant on this thread?"
create index if not exists idx_msg_access_grants_lookup
  on public.message_thread_access_grants (thread_id, user_id, expires_at);

create index if not exists idx_msg_access_grants_user
  on public.message_thread_access_grants (user_id, granted_at desc);

alter table public.message_thread_access_grants enable row level security;

-- Service-role (backend) is the only writer; authenticated read for audit views.
drop policy if exists "authenticated read msg access grants" on public.message_thread_access_grants;
create policy "authenticated read msg access grants"
  on public.message_thread_access_grants
  for select using (auth.role() = 'authenticated');
