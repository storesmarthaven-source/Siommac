-- ── WebAuthn / Passkeys ─────────────────────────────────────────────────────
-- Stores registered passkey credentials and ephemeral challenges.
-- Credentials: one row per registered passkey per user.
-- Challenges:  ephemeral rows created at options-generation time, consumed on
--              verify, or auto-expired (cron / lazy cleanup).

-- ── webauthn_credentials ──────────────────────────────────────────────────────
create table if not exists webauthn_credentials (
  id            text        primary key,              -- 'WAC-<uuid>' generated in app
  user_id       text        not null references app_users(id) on delete cascade,
  credential_id text        unique not null,          -- base64url authenticator credential id
  public_key    text        not null,                 -- base64url COSE public key
  counter       bigint      not null default 0,       -- replay-attack counter
  transports    text[],                               -- ['internal','hybrid', ...] nullable
  device_type   text,                                 -- 'singleDevice' | 'multiDevice'
  backed_up     boolean     not null default false,   -- credential backed up to cloud
  aaguid        text,                                 -- authenticator AAGUID (UUID)
  label         text,                                 -- user-assigned friendly name
  created_at    timestamptz not null default now(),
  last_used_at  timestamptz
);

create index if not exists webauthn_credentials_user_id_idx
  on webauthn_credentials(user_id);

create index if not exists webauthn_credentials_credential_id_idx
  on webauthn_credentials(credential_id);

alter table webauthn_credentials enable row level security;

-- Authenticated users can read their own credentials
create policy "webauthn_credentials_select_own"
  on webauthn_credentials for select
  using (auth.uid()::text = user_id);

-- Service role handles all writes (insert/update/delete via backend)
create policy "webauthn_credentials_service_all"
  on webauthn_credentials for all
  using    (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');

-- ── webauthn_challenges ───────────────────────────────────────────────────────
create table if not exists webauthn_challenges (
  id          uuid        primary key default gen_random_uuid(),
  user_id     text        references app_users(id) on delete cascade,  -- nullable for usernameless flows
  type        text        not null check (type in ('register', 'authenticate')),
  challenge   text        not null,                  -- base64url random challenge
  expires_at  timestamptz not null,
  created_at  timestamptz not null default now()
);

create index if not exists webauthn_challenges_user_id_idx
  on webauthn_challenges(user_id);

alter table webauthn_challenges enable row level security;

-- Authenticated users can read their own challenges (needed for concurrent flows)
create policy "webauthn_challenges_select_own"
  on webauthn_challenges for select
  using (auth.uid()::text = user_id);

-- Service role handles all writes
create policy "webauthn_challenges_service_all"
  on webauthn_challenges for all
  using    (auth.role() = 'service_role')
  with check (auth.role() = 'service_role');
