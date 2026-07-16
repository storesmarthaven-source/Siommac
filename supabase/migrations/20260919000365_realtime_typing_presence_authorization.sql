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
-- The participant check runs through a SECURITY DEFINER helper because the
-- policy executes as the `authenticated` role, which has no direct read access
-- to public.message_participants (protected data stays behind the JWT APIs).
-- The helper leaks nothing: boolean in/out, fixed search_path.
--
-- Anonymous connections match NO policy -> private-channel joins are refused.
-- ASCII only + idempotent / re-runnable.
-- ============================================================================

create or replace function public.is_message_thread_participant(p_thread_id text, p_user_id text)
returns boolean
language sql
stable
security definer
set search_path = public
as $$
  select exists (
    select 1
      from public.message_participants p
     where p.thread_id::text = p_thread_id
       and p.user_id         = p_user_id
       and p.removed_at is null
  );
$$;

revoke all    on function public.is_message_thread_participant(text, text) from public, anon;
grant execute on function public.is_message_thread_participant(text, text) to authenticated, service_role;

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
    and public.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3),
          (select auth.jwt()->>'sub'))
  );

drop policy if exists "siomac typing write" on realtime.messages;
create policy "siomac typing write" on realtime.messages
  for insert to authenticated
  with check (
    extension = 'broadcast'
    and realtime.topic() like 'siomac:typing:%'
    and public.is_message_thread_participant(
          split_part(realtime.topic(), ':', 3),
          (select auth.jwt()->>'sub'))
  );
