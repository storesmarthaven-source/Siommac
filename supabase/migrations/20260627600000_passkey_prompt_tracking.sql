-- Migration: passkey_prompt_tracking
-- Adds last_passkey_prompt_at to app_users so the backend can track when a
-- user last dismissed the post-login passkey setup prompt (7-day cadence).

alter table public.app_users
  add column if not exists last_passkey_prompt_at timestamptz;

comment on column public.app_users.last_passkey_prompt_at is
  'Timestamp when the user last dismissed the post-login passkey setup prompt. '
  'NULL means they have never been prompted. Used to enforce a 7-day re-prompt cadence.';
