-- ── HSE Risk & JSA cross-linking ───────────────────────────────────────────────
-- Generic link table connecting hazards, assessments, JSAs, permits, incidents,
-- inspections, CAPA, documents and training. One row per directed link.
--   Hazard → Risk Assessment · Hazard → JSA · JSA → Permit · Assessment → CAPA
--   Hazard → Incident · Inspection Finding → Hazard · Document → JSA · Training → JSA
-- Platform-level join table for the Risk & JSA module. app_users.id is TEXT.
-- ─────────────────────────────────────────────────────────────────────────────────

create table if not exists public.hse_risk_jsa_links (
  id           uuid primary key default gen_random_uuid(),
  source_type  text not null,
  source_id    text not null,
  target_type  text not null,
  target_id    text not null,
  link_type    text not null,
  created_by   text references public.app_users(id),
  created_at   timestamptz not null default now(),
  metadata     jsonb not null default '{}'::jsonb
);

create index if not exists hse_rjl_source_idx on public.hse_risk_jsa_links(source_type, source_id);
create index if not exists hse_rjl_target_idx on public.hse_risk_jsa_links(target_type, target_id);
-- Avoid duplicate identical links.
create unique index if not exists hse_rjl_uniq
  on public.hse_risk_jsa_links(source_type, source_id, target_type, target_id, link_type);

alter table public.hse_risk_jsa_links enable row level security;
create policy "authenticated read hse_risk_jsa_links" on public.hse_risk_jsa_links for select using (auth.role() = 'authenticated');
create policy "service write hse_risk_jsa_links"      on public.hse_risk_jsa_links for all
  using (auth.role() = 'service_role') with check (auth.role() = 'service_role');
