-- ============================================================================
-- Orchestration — record_links (Cross-Module Orchestration §7).
--
-- Generic record-to-record linking across modules (the repo has no equivalent
-- today). Read/written only via the service-role backend
-- (lib/orchestration/recordLinkService); access is gated in the app layer by each
-- side's source-module view permission. Conventions: text user ids, snake_case.
--
-- Operator-applied. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

create table if not exists public.record_links (
  id uuid primary key default gen_random_uuid(),

  source_module      text not null,
  source_record_type text not null,
  source_record_id   text not null,
  source_record_no   text,
  source_title       text,
  source_deep_link   text,

  target_module      text not null,
  target_record_type text not null,
  target_record_id   text not null,
  target_record_no   text,
  target_title       text,
  target_deep_link   text,

  relationship_type  text not null,           -- e.g. related_to, caused_by, blocks, evidence_for
  label              text,
  direction          text not null default 'bidirectional'
                          check (direction in ('outbound', 'inbound', 'bidirectional')),
  visibility         text not null default 'internal'
                          check (visibility in ('public', 'internal', 'restricted', 'confidential')),

  created_by text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  metadata   jsonb not null default '{}'::jsonb,

  unique (source_module, source_record_type, source_record_id,
          target_module, target_record_type, target_record_id,
          relationship_type)
);

create index if not exists idx_record_links_source
  on public.record_links (source_module, source_record_type, source_record_id);
create index if not exists idx_record_links_target
  on public.record_links (target_module, target_record_type, target_record_id);
create index if not exists idx_record_links_relationship
  on public.record_links (relationship_type);

alter table public.record_links enable row level security;

-- Backend (service role) manages links; no direct browser writes/reads.
create policy "record_links: service role" on public.record_links
  for all to service_role using (true) with check (true);
