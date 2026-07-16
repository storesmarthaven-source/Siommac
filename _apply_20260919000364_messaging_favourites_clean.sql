
create table if not exists public.message_thread_favourites (
  user_id    text not null references public.app_users(id) on delete cascade,
  thread_id  uuid not null references public.message_threads(id) on delete cascade,
  created_at timestamptz not null default now(),
  primary key (user_id, thread_id)
);

create index if not exists mtf_thread_idx on public.message_thread_favourites(thread_id);

alter table public.message_thread_favourites enable row level security;
