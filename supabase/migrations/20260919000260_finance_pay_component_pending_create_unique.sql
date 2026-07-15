-- ============================================================================
-- Finance pay-components: prevent duplicate PENDING create requests (review #9)
-- ============================================================================
-- createPayComponent() prechecks for an existing pending CREATE change-request with the
-- same normalized code, but that is precheck-then-insert (TOCTOU): two concurrent
-- submissions both pass the check and insert duplicate pending creates, which then both try
-- to create the same component on approval. Enforce it at the DB with a PARTIAL UNIQUE index
-- over the normalized payload code, scoped to pending creates. (The component row itself is
-- separately uniquely constrained on `code` once approved.)
--
-- The normalization matches the app: input.code.toUpperCase().trim() → upper(btrim(...)).
-- Idempotent. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

-- Preflight: an existing duplicate pending-create pair would make CREATE UNIQUE INDEX fail
-- with a non-obvious error — surface it so the extras are cancelled first.
do $$
declare v_dupes text;
begin
  select string_agg(code, ', ') into v_dupes from (
    select upper(btrim(payload->>'code')) as code
    from public.finance_pay_component_change_requests
    where change_type = 'create' and status = 'pending_approval'
    group by upper(btrim(payload->>'code'))
    having count(*) > 1
  ) d;
  if v_dupes is not null then
    raise exception 'Cannot enforce pending-create uniqueness: duplicate pending create requests exist for code(s): %. Cancel the extras first, then re-run.', v_dupes;
  end if;
end $$;

create unique index if not exists finance_pay_component_pending_create_code_uidx
  on public.finance_pay_component_change_requests (upper(btrim(payload->>'code')))
  where change_type = 'create' and status = 'pending_approval';

-- After applying:  NOTIFY pgrst, 'reload schema';
