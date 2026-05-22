-- Supabase schema for the Siomac attendance app.
-- Run this once in Supabase SQL Editor, then seed users with supabase/seed.sql.

create extension if not exists pgcrypto;

create table if not exists public.app_users (
  id text primary key default ('USR-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  username text not null unique,
  password_hash text not null,
  full_name text not null,
  role text not null check (role in ('admin', 'manager', 'employee')),
  department_id text,
  position text,
  status text not null default 'active' check (status in ('active', 'inactive')),
  color_scheme text default 'navy',
  layout_mode text default 'sidebar',
  hourly_rate numeric(12,2) not null default 0,
  profile_image text,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.departments (
  id text primary key default ('DEPT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  name text not null unique,
  description text default '',
  manager_id text references public.app_users(id) on delete set null,
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

alter table public.app_users
  drop constraint if exists app_users_department_id_fkey;
alter table public.app_users
  add constraint app_users_department_id_fkey
  foreign key (department_id) references public.departments(id) on delete set null;

create table if not exists public.project_sites (
  id text primary key default ('SITE-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  name text not null,
  address text default '',
  latitude numeric(10,7) not null,
  longitude numeric(10,7) not null,
  radius numeric(10,2) not null default 200,
  description text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now()
);

create table if not exists public.attendance (
  id text primary key default ('ATT-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id text not null references public.app_users(id) on delete cascade,
  username text not null,
  work_date date not null,
  check_in_time timestamptz,
  check_out_time timestamptz,
  check_in_lat numeric(10,7),
  check_in_lng numeric(10,7),
  check_in_accuracy numeric(10,2),
  check_in_photo_url text default '',
  check_in_site_id text references public.project_sites(id) on delete set null,
  check_in_distance_m numeric(10,2),
  check_out_lat numeric(10,7),
  check_out_lng numeric(10,7),
  check_out_accuracy numeric(10,2),
  check_out_photo_url text default '',
  check_out_site_id text references public.project_sites(id) on delete set null,
  check_out_distance_m numeric(10,2),
  total_hours numeric(8,2) not null default 0,
  status text not null default 'present' check (status in ('present', 'late', 'absent')),
  notes text default '',
  created_at timestamptz not null default now(),
  updated_at timestamptz not null default now(),
  unique (user_id, work_date)
);

create table if not exists public.leave_requests (
  id text primary key default ('LV-' || upper(substr(replace(gen_random_uuid()::text, '-', ''), 1, 8))),
  user_id text not null references public.app_users(id) on delete cascade,
  username text not null,
  department_id text references public.departments(id) on delete set null,
  type text not null,
  from_date date not null,
  to_date date not null,
  days integer not null,
  reason text not null,
  status text not null default 'pending' check (status in ('pending', 'approved', 'rejected')),
  reviewed_by text references public.app_users(id) on delete set null,
  reviewed_at timestamptz,
  review_notes text default '',
  applied_at timestamptz not null default now()
);

create table if not exists public.activity_logs (
  id uuid primary key default gen_random_uuid(),
  created_at timestamptz not null default now(),
  user_id text,
  username text,
  action text,
  entity text,
  entity_id text,
  details text
);

create table if not exists public.settings (
  key text primary key,
  value text not null default '',
  updated_at timestamptz not null default now()
);

insert into public.settings (key, value) values
  ('companyName', 'My Company'),
  ('workStartHour', '6'),
  ('workEndHour', '22'),
  ('lateThresholdHHMM', '09:00'),
  ('maxDistanceM', '200'),
  ('currency', 'TT'),
  ('companyLogoUrl', ''),
  ('latePenaltyPerDay', '0'),
  ('leaveFinePerDay', '0')
on conflict (key) do nothing;

insert into storage.buckets (id, name, public)
values
  ('attendance-photos', 'attendance-photos', false),
  ('profile-photos', 'profile-photos', false),
  ('branding', 'branding', true)
on conflict (id) do nothing;

create table if not exists public.message_reads (
  message_id uuid not null references public.messages(id) on delete cascade,
  user_id    text not null references public.app_users(id) on delete cascade,
  last_read_at timestamptz not null default now(),
  primary key (message_id, user_id)
);

alter table public.message_reads enable row level security;

-- Add message_reads to realtime publication so both sides see instant updates
-- (guarded so re-running schema.sql on an existing DB doesn't error)
DO $$
BEGIN
  IF NOT EXISTS (
    SELECT 1 FROM pg_publication_tables
    WHERE pubname = 'supabase_realtime'
      AND schemaname = 'public'
      AND tablename  = 'message_reads'
  ) THEN
    ALTER PUBLICATION supabase_realtime ADD TABLE public.message_reads;
  END IF;
END $$;

alter table public.app_users enable row level security;
alter table public.departments enable row level security;
alter table public.project_sites enable row level security;
alter table public.attendance enable row level security;
alter table public.leave_requests enable row level security;
alter table public.activity_logs enable row level security;
alter table public.settings enable row level security;

-- The Netlify Function uses SUPABASE_SERVICE_ROLE_KEY and enforces authorization there.
-- RLS remains enabled so accidental browser-side anon access cannot read application data.
