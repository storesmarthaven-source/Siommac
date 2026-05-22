-- supabase/phase5-trusted-devices.sql
--
-- Trusted device tokens for "remember this device" 2FA skip.
-- Run once in the Supabase SQL Editor.
--
-- DESIGN:
--   After a successful TOTP verification the backend inserts a row here and
--   returns the plaintext token to the client (stored in localStorage under
--   TRUSTED_DEVICE_KEY).  On every subsequent /login the client sends the
--   token; if a valid unexpired row is found for that user, the 2FA challenge
--   is skipped entirely.
--
--   token_hash  — SHA-256(plaintext_token).  The plaintext never enters the DB.
--   expires_at  — 30 days from issuance; rotated on every successful login.
--   device_name — browser UA substring, shown in the 2FA settings panel.
--
-- SECURITY:
--   RLS prevents any frontend client from reading or writing this table.
--   All access is via the Netlify backend (service role key).

create table if not exists trusted_devices (
  id           uuid         primary key default gen_random_uuid(),
  user_id      text         not null references app_users(id) on delete cascade,  -- text, not uuid (app_users.id is 'USR-XXXXXXXX')
  token_hash   text         not null unique,       -- SHA-256 hex of the plaintext token
  device_name  text         not null default '',   -- e.g. "Chrome on Windows"
  created_at   timestamptz  not null default now(),
  expires_at   timestamptz  not null
);

-- Fast lookup by user when validating
create index if not exists trusted_devices_user_id_idx on trusted_devices(user_id);

-- Auto-delete expired rows (Supabase pg_cron can run this; manual OK too)
-- For now, the backend prunes on each login attempt.

-- RLS: no direct frontend access — service role only
alter table trusted_devices enable row level security;

-- No policies = nobody except service role can touch this table
