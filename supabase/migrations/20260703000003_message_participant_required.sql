-- ============================================================================
-- Required message participants (Spec §22)
-- ============================================================================
-- Lets source modules lock responsible owners / approvers / reviewers into a
-- thread so employees cannot remove them. Enforced by assertCanRemoveParticipant
-- (communications.participants.remove_required overrides). Run manually + NOTIFY.
-- ============================================================================

alter table public.message_participants
  add column if not exists is_required boolean not null default false;

alter table public.message_participants
  add column if not exists required_reason text;

alter table public.message_participants
  add column if not exists can_be_removed_by_user boolean not null default true;
