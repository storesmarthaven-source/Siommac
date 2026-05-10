-- Cache a stable signed URL per user so the same URL is returned across cold starts.
-- This makes the SW photo cache key stable, preventing photo reloads on page refresh.
alter table app_users
  add column if not exists signed_url           text,
  add column if not exists signed_url_expires_at timestamptz;
