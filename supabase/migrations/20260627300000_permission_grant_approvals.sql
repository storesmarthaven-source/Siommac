-- Migration: permission_grant_approvals
-- Maker-checker dual-superadmin approval for critical permission grants.
-- A critical grant (isCriticalGrant=true, effect=allow) does NOT apply immediately.
-- Instead it creates a pending row here. A DIFFERENT superadmin approves it,
-- at which point the normal grant write is executed and the row is marked approved.

create table if not exists permission_grant_approvals (
  id                text primary key,                        -- 'PGA-' + gen_random_uuid()
  request_type      text not null check (request_type in ('role_permission', 'user_override')),
  -- exactly one of these is set per request_type:
  target_role       text,                                    -- role_name for role_permission
  target_user_id    text references app_users(id) on delete cascade, -- for user_override
  permission_key    text not null,
  effect            text not null default 'allow' check (effect in ('allow', 'deny')),
  reason            text not null,
  status            text not null default 'pending' check (status in ('pending', 'approved', 'rejected', 'cancelled')),
  requested_by      text not null references app_users(id),
  requested_at      timestamptz not null default now(),
  decided_by        text references app_users(id),
  decided_at        timestamptz,
  decision_reason   text,
  applied_at        timestamptz,
  expires_at        timestamptz not null,                    -- now() + 7 days at insert time
  created_at        timestamptz not null default now()
);

-- Constraint: role_permission rows must have target_role; user_override rows must have target_user_id
alter table permission_grant_approvals
  add constraint pga_role_target_check
    check (request_type != 'role_permission' or target_role is not null),
  add constraint pga_user_target_check
    check (request_type != 'user_override' or target_user_id is not null);

-- Fast lookup for the approvals list and expiry sweep
create index if not exists pga_status_requested_at_idx
  on permission_grant_approvals (status, requested_at desc);

-- RLS: enabled; authenticated users can read their own or pending requests;
--       service role does all writes (bypasses RLS).
alter table permission_grant_approvals enable row level security;

-- Superadmins and the requester can read approval rows
create policy "pga_read" on permission_grant_approvals
  for select
  using (
    auth.role() = 'authenticated'
  );

-- No direct DML from client — all writes go through service-role backend
