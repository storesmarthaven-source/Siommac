-- ============================================================================
-- Email Template Studio — the AUTHORITATIVE template store
-- ============================================================================
-- The Studio has shipped with no server-side persistence: its only store is a
-- browser dev adapter (module memory + localStorage). That is why production
-- sending cannot be wired yet — the specified flow is
--
--   Studio → backend loads AUTHORITATIVE template/version → resolve variables
--          → resolve hosted assets → compile MJML server-side → validate
--          → sendEmail() → email_deliveries → Resend
--
-- and "authoritative" has nowhere to live. Sending from a document supplied by
-- the browser would not be that flow: it would let the client dictate the body
-- of mail the platform sends under its own verified domain.
--
-- ⭐ THE EDITOR SCHEMA IS THE CANONICAL SOURCE. `compiled_html` / `compiled_text`
-- are a CACHE of the last compile, never the thing that gets sent. A real send
-- recompiles from `editor_schema` server-side, so a tampered or stale cached
-- HTML column cannot become an outgoing email.
--
-- Operator-applied. Migration history in this repository is NOT authoritative —
-- do not push/repair. After applying:  NOTIFY pgrst, 'reload schema';
-- ============================================================================

begin;

-- ── 1. template identity + governance ────────────────────────────────────────
create table if not exists public.email_templates (
  id                  uuid primary key default gen_random_uuid(),
  template_key        text not null,
  name                text not null,
  description         text,

  family              text not null
                        check (family in ('onboarding','user_invitation','worker_invitation')),
  trigger_key         text not null,
  trigger_label       text not null default '',
  audience            text not null default '',
  language            text not null default 'en',
  business_unit_label text not null default '',
  owner_label         text not null default '',

  status              text not null default 'draft'
                        check (status in ('draft','in_review','changes_requested','approved',
                                          'published','superseded','archived')),
  approval_state      text not null default 'not_submitted'
                        check (approval_state in ('not_required','not_submitted','pending',
                                                  'approved','changes_requested')),
  current_version     int  not null default 1,

  -- Starter templates the platform depends on. Protected rows may be copied but
  -- not archived out from under a live trigger.
  is_protected        boolean not null default false,

  created_at          timestamptz not null default now(),
  created_by          text references public.app_users(id) on delete set null,
  updated_at          timestamptz,
  updated_by          text references public.app_users(id) on delete set null
);

create unique index if not exists email_templates_key_uidx
  on public.email_templates (template_key);
create index if not exists email_templates_trigger_idx
  on public.email_templates (trigger_key) where status = 'published';

-- ── 2. versions ──────────────────────────────────────────────────────────────
create table if not exists public.email_template_versions (
  id              uuid primary key default gen_random_uuid(),
  template_id     uuid not null references public.email_templates(id) on delete cascade,
  version_no      int  not null,

  subject         text not null,
  preheader       text not null default '',

  -- ⭐ CANONICAL. Everything sent is compiled from this, server-side, at send time.
  editor_schema   jsonb not null,

  -- Cache of the last compile, for preview and diffing. NEVER the send source:
  -- a stale or tampered value here must not be able to leave the building.
  compiled_html   text,
  compiled_text   text,
  compiled_at     timestamptz,

  status          text not null default 'draft'
                    check (status in ('draft','in_review','changes_requested','approved',
                                      'published','superseded','archived')),
  approval_state  text not null default 'not_submitted'
                    check (approval_state in ('not_required','not_submitted','pending',
                                              'approved','changes_requested')),

  -- Segregation of duties, enforced by the database as well as the route: the
  -- person who submits a template version may not be the one who publishes it.
  submitted_by    text references public.app_users(id) on delete set null,
  submitted_at    timestamptz,
  published_by    text references public.app_users(id) on delete set null,
  published_at    timestamptz,
  change_note     text,

  created_at      timestamptz not null default now(),
  created_by      text references public.app_users(id) on delete set null,
  updated_at      timestamptz,
  updated_by      text references public.app_users(id) on delete set null,

  constraint email_template_versions_maker_checker_ck check (
    published_by is null or submitted_by is null or published_by <> submitted_by
  )
);

create unique index if not exists email_template_versions_no_uidx
  on public.email_template_versions (template_id, version_no);

-- Exactly one PUBLISHED version per template — the one a real send may use.
create unique index if not exists email_template_versions_one_published_uidx
  on public.email_template_versions (template_id) where status = 'published';

create index if not exists email_template_versions_status_idx
  on public.email_template_versions (template_id, status);

comment on column public.email_template_versions.editor_schema is
  'The canonical source. Production sends recompile from this server-side; compiled_html is a '
  'cache for preview only and is never the thing transmitted.';

-- ── 3. RLS — backend-only ────────────────────────────────────────────────────
-- Templates are authored and sent through authenticated Netlify APIs. No browser
-- policy is granted, so RLS with no permissive policy denies anon/authenticated
-- outright rather than depending on an absent grant.
alter table public.email_templates          enable row level security;
alter table public.email_template_versions  enable row level security;
revoke all on public.email_templates         from anon, authenticated;
revoke all on public.email_template_versions from anon, authenticated;

-- ── 4. updated_at triggers (repo convention) ─────────────────────────────────
create or replace function public.tg_email_templates_touch()
returns trigger language plpgsql as $$
begin
  new.updated_at := now();
  return new;
end $$;

drop trigger if exists email_templates_touch on public.email_templates;
create trigger email_templates_touch
  before update on public.email_templates
  for each row execute function public.tg_email_templates_touch();

drop trigger if exists email_template_versions_touch on public.email_template_versions;
create trigger email_template_versions_touch
  before update on public.email_template_versions
  for each row execute function public.tg_email_templates_touch();

-- ── 5. permission — authoring vs SENDING are different capabilities ──────────
-- Composing a template is not the same authority as mailing real people from
-- the platform's verified domain, so sending gets its own key. Granted in the
-- SAME migration, because a key absent from role_permissions is dead on arrival.
insert into public.role_permissions (role_name, permission) values
  ('superadmin','platform.email_templates.send'),
  ('admin','platform.email_templates.send'),
  ('hr_manager','platform.email_templates.send')
on conflict do nothing;

commit;

-- ── proof of application ─────────────────────────────────────────────────────
do $$
declare c_t int; c_v int; c_p int;
begin
  select count(*) into c_t from information_schema.columns
   where table_schema = 'public' and table_name = 'email_templates';
  select count(*) into c_v from information_schema.columns
   where table_schema = 'public' and table_name = 'email_template_versions';
  select count(*) into c_p from public.role_permissions
   where permission = 'platform.email_templates.send';
  raise notice 'email_templates columns: %, email_template_versions columns: %, send grants: %',
    c_t, c_v, c_p;
end $$;

-- After applying:  NOTIFY pgrst, 'reload schema';
