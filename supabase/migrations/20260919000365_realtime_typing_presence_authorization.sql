-- ============================================================================
-- Messenger typing/presence slice -- Supabase Realtime AUTHORIZATION policies
-- ============================================================================
-- Typing indicators and presence are EPHEMERAL (no business rows): they ride
-- Supabase Realtime private channels (broadcast + presence extensions), which
-- authorize joins via RLS policies on realtime.messages evaluated with the
-- connection's JWT (our ES256 realtime token -- see RUNBOOK_REALTIME_AUTH.md).
--
-- Topics:
--   siomac:presence            presence extension -- any authenticated user
--                              (online dots are org-visible, like the roster)
--   siomac:typing:<thread_id>  broadcast extension -- THREAD PARTICIPANTS only
--
-- The participant check runs through a private SECURITY DEFINER helper because the
-- policy executes as the `authenticated` role, which has no direct read access
-- to public.message_participants (protected data stays behind the JWT APIs).
-- The helper derives the user from auth.jwt(); no caller-supplied identity and
-- no exposed public-schema RPC membership oracle.
--
-- Anonymous connections match NO policy -> private-channel joins are refused.
-- ASCII only + idempotent / re-runnable.
-- ============================================================================

create schema if not exists msg_internal;

create or replace function msg_internal.is_message_thread_participant(p_thread_id text)
returns boolean
language sql
stable
security definer
set search_path = ''
as $$
  select exists (
    select 1
      from public.message_participants p
     where p.thread_id::text = p_thread_id
       and p.user_id         = (select auth.jwt()->>'sub')
       and p.removed_at is null
  );
$$;

revoke all on schema msg_internal from public, anon;
grant usage on schema msg_internal to authenticated, service_role;
revoke all on function msg_internal.is_message_thread_participant(text) from public, anon;
grant execute on function msg_internal.is_message_thread_participant(text) to authenticated, service_role;

-- ── Presence: one shared channel, any authenticated user ─────────────────────
-- Covers BOTH extensions: the private-channel JOIN evaluates broadcast-level
-- read access even when the client only uses presence (verified live -- a
-- presence-only policy yields "Unauthorized ... read from this Channel").
drop policy if exists "siomac presence read"  on realtime.messages;
create policy "siomac presence read" on realtime.messages
  for select to authenticated
  using (extension in ('presence', 'broadcast') and realtime.topic() = 'siomac:presence');

drop policy if exists "siomac presence write" on realtime.messages;
create policy "siomac presence write" on realtime.messages
  for insert to authenticated
  with check (extension in ('presence', 'broadcast') and realtime.topic() = 'siomac:presence');

-- ── Typing: per-thread broadcast, participants only ──────────────────────────
drop policy if exists "siomac typing read" on realtime.messages;
create policy "siomac typing read" on realtime.messages
  for select to authenticated
  using (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and split_part(realtime.topic(), ':', 4) = ''
    and msg_internal.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3))
  );

drop policy if exists "siomac typing write" on realtime.messages;
create policy "siomac typing write" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and split_part(realtime.topic(), ':', 4) = ''
    and msg_internal.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3))
  );
