-- ============================================================================
-- Platform — canonical EMAIL DELIVERY backbone
-- ============================================================================
-- ONE authoritative record per production email, for every module that sends:
-- notifications, HR/onboarding invitations, payroll payslips and platform test
-- mail. Today the only per-email evidence is `notification_deliveries`, whose
-- `notification_id` is NOT NULL with an FK — so it structurally CANNOT record a
-- payslip, an account invitation or a test email. That is why this is a new
-- table rather than more columns on that one.
--
-- `notification_deliveries` is NOT dropped here and NOT duplicated: it remains
-- the per-channel record for the in-app inbox. The follow-up commit points the
-- email channel at this table and removes the email leg from that one, so there
-- is never a period where both claim to be authoritative for email.
--
-- WHY TIMESTAMPS ARE SEPARATE COLUMNS
-- -----------------------------------
-- Provider webhooks arrive late, duplicated and OUT OF ORDER. A single
-- `status_changed_at` would let a delayed `sent` webhook overwrite the moment a
-- message was actually `delivered`, destroying history to record something
-- older. Each lifecycle moment therefore has its own column, written once and
-- never cleared, and `status` is derived from the furthest point reached.
--
-- Operator-applied. Migration history in this repository is NOT authoritative —
-- do not push/repair. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

begin;

-- ── 1. the delivery record ───────────────────────────────────────────────────
create table if not exists public.email_deliveries (
  id                  uuid primary key default gen_random_uuid(),

  -- WHICH BUSINESS OPERATION. Both are required: an audit that cannot say what
  -- the email was for answers "was it sent?" but never "why?".
  module_key          text not null,
  use_case            text not null,

  -- DURABLE SEND IDEMPOTENCY. Derived from content + originating record by the
  -- caller, never random — a random key can never dedupe, which is the
  -- synthetic-idempotency-key failure this codebase already refuses. Unique, so
  -- a retried SIOMAC send collides here instead of mailing a person twice.
  -- Provider-side idempotency is an ADDITIONAL safeguard, not a substitute:
  -- Resend's retention is finite, this is not.
  idempotency_key     text not null,

  recipient           text not null,
  sender              text not null,
  reply_to            text,
  subject             text not null,

  provider            text not null default 'resend'
                        check (provider in ('resend')),
  -- Null until the provider accepts. Webhook matching keys off this.
  provider_message_id text,

  -- Furthest lifecycle point reached. `sent` = the provider ACCEPTED the
  -- message; `delivered` may ONLY be set from verified provider evidence
  -- (a webhook), never inferred from acceptance.
  status              text not null default 'pending'
                        check (status in ('pending','sent','delivered','delayed',
                                          'failed','bounced','complained','skipped')),

  -- Independent lifecycle moments — write-once, never cleared. See header.
  queued_at           timestamptz not null default now(),
  sent_at             timestamptz,
  delivered_at        timestamptz,
  delayed_at          timestamptz,
  failed_at           timestamptz,
  bounced_at          timestamptz,
  complained_at       timestamptz,
  skipped_at          timestamptz,

  -- SAFE error information only. Never a credential, never a raw provider
  -- payload — the payload lands in email_delivery_events instead.
  error_code          text,
  error_message       text,

  -- ORIGINATING RECORD, so an operator can walk from an email back to the
  -- payslip / case / notification that caused it.
  source_module       text,
  source_entity_type  text,
  source_entity_id    text,
  notification_id     text references public.notifications(id) on delete set null,
  actor_user_id       text references public.app_users(id)     on delete set null,

  metadata            jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now(),
  updated_at          timestamptz
);

-- The idempotency guarantee itself.
create unique index if not exists email_deliveries_idempotency_uidx
  on public.email_deliveries (idempotency_key);

-- Webhook matching. Partial: rows without a provider id are unmatched by
-- definition, and NULLs do not belong in a lookup index.
create index if not exists email_deliveries_provider_msg_idx
  on public.email_deliveries (provider, provider_message_id)
  where provider_message_id is not null;

-- Reconciliation sweeps: stuck pending, delayed, retryable failures.
create index if not exists email_deliveries_status_idx
  on public.email_deliveries (status, queued_at desc);
create index if not exists email_deliveries_source_idx
  on public.email_deliveries (source_entity_type, source_entity_id)
  where source_entity_id is not null;
create index if not exists email_deliveries_module_idx
  on public.email_deliveries (module_key, created_at desc);

comment on table public.email_deliveries is
  'One authoritative record per production email, across every module. status is the furthest '
  'lifecycle point reached; each moment has its own write-once timestamp so a late or '
  'out-of-order provider webhook can never erase history.';
comment on column public.email_deliveries.idempotency_key is
  'Derived from content + originating record by the caller, never random. Unique: a retried '
  'SIOMAC send collides here rather than emailing a person twice.';
comment on column public.email_deliveries.status is
  'delivered may ONLY be set from verified provider evidence (a webhook), never inferred '
  'from the provider accepting the message.';

-- ── 2. provider events (webhook idempotency + unmatched-event evidence) ──────
create table if not exists public.email_delivery_events (
  id                  uuid primary key default gen_random_uuid(),
  provider            text not null default 'resend'
                        check (provider in ('resend')),

  -- The provider's own event id (Resend/Svix `svix-id`). UNIQUE per provider:
  -- this single constraint is what makes webhook handling idempotent, so a
  -- redelivered event is a no-op INSERT conflict rather than a second state
  -- transition. Idempotency belongs in the database, not in handler branching.
  provider_event_id   text not null,
  event_type          text not null,

  -- Kept even when it matches nothing: an event for an unknown message id is
  -- exactly what reconciliation needs to surface, and discarding it would hide
  -- a real integration fault. delivery_id stays NULL in that case — an unknown
  -- provider id must never be allowed to modify some other delivery.
  provider_message_id text,
  delivery_id         uuid references public.email_deliveries(id) on delete cascade,

  -- Provider's own timestamp for the event, distinct from when we received it.
  occurred_at         timestamptz,
  received_at         timestamptz not null default now(),

  -- Raw payload for forensics. Signature-verified before it is ever written.
  payload             jsonb not null default '{}'::jsonb,
  created_at          timestamptz not null default now()
);

create unique index if not exists email_delivery_events_provider_event_uidx
  on public.email_delivery_events (provider, provider_event_id);
create index if not exists email_delivery_events_delivery_idx
  on public.email_delivery_events (delivery_id, occurred_at)
  where delivery_id is not null;
-- The unmatched queue: events that arrived for a message id we do not know.
create index if not exists email_delivery_events_unmatched_idx
  on public.email_delivery_events (received_at desc)
  where delivery_id is null;

comment on table public.email_delivery_events is
  'Signature-verified provider webhook events. unique(provider, provider_event_id) is what '
  'makes webhook handling idempotent — a redelivered event conflicts instead of transitioning '
  'state a second time. Events whose provider_message_id matches nothing are RETAINED with a '
  'null delivery_id so reconciliation can surface them.';

-- ── 3. RLS — backend-only tables ─────────────────────────────────────────────
-- Delivery evidence carries recipient addresses and provider errors. It is read
-- through authenticated Netlify APIs (service role) only; no browser policy is
-- granted, so enabling RLS with no permissive policy denies anon/authenticated
-- outright rather than relying on an absent grant.
alter table public.email_deliveries       enable row level security;
alter table public.email_delivery_events  enable row level security;

revoke all on public.email_deliveries      from anon, authenticated;
revoke all on public.email_delivery_events from anon, authenticated;

-- ── 4. updated_at trigger (repo convention for mutable tables) ───────────────
create or replace function public.tg_email_deliveries_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists email_deliveries_touch on public.email_deliveries;
create trigger email_deliveries_touch
  before update on public.email_deliveries
  for each row execute function public.tg_email_deliveries_touch();

commit;

-- ── proof of application ─────────────────────────────────────────────────────
-- Prints only if the transaction COMMITTED, so the operator can tell a real
-- application from a silent rollback. "Applied" from a human is not evidence.
do $$
declare c_del int; c_evt int; c_idx int;
begin
  select count(*) into c_del from information_schema.columns
   where table_schema = 'public' and table_name = 'email_deliveries';
  select count(*) into c_evt from information_schema.columns
   where table_schema = 'public' and table_name = 'email_delivery_events';
  select count(*) into c_idx from pg_indexes
   where schemaname = 'public' and tablename in ('email_deliveries','email_delivery_events');
  raise notice 'email_deliveries columns: %, email_delivery_events columns: %, indexes: %',
    c_del, c_evt, c_idx;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
