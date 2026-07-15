-- Messaging: direct-thread uniqueness (one canonical direct thread per participant pair).
--
-- Adds a maintained direct_pair_key on message_threads (sorted "u1|u2" for direct
-- threads, null otherwise), reconciles pre-existing duplicate direct threads down to
-- one canonical per pair (keeping the most recently active), and enforces the invariant
-- with a partial unique index. The get-or-create create_thread_tx (mig 310) relies on
-- this column + index.
--
-- Reconciliation is NON-DESTRUCTIVE: duplicate threads are archived (thread-level +
-- participant-level) and their pair_key cleared so they drop out of the invariant and
-- the inbox, but every post/attachment is preserved and still reachable by thread id
-- (search / compliance). The canonical thread keeps the pair_key and stays active.

alter table public.message_threads
  add column if not exists direct_pair_key text;

-- Rank the direct threads of each pair by recency; rank 1 is canonical.
with pair_of_thread as (
  select t.id as thread_id, t.created_at, t.last_post_at,
         count(mp.user_id)                                   as n_parts,
         (array_agg(mp.user_id order by mp.user_id))[1]      as u1,
         (array_agg(mp.user_id order by mp.user_id))[2]      as u2
    from public.message_threads t
    join public.message_participants mp on mp.thread_id = t.id
   where t.thread_type = 'direct'
   group by t.id, t.created_at, t.last_post_at
),
keyed as (
  select thread_id, created_at, last_post_at,
         case when n_parts = 2
              then least(u1, u2) || '|' || greatest(u1, u2)
              else null end as pair_key
    from pair_of_thread
),
ranked as (
  select thread_id, pair_key,
         row_number() over (
           partition by pair_key
           order by last_post_at desc nulls last, created_at asc
         ) as rn
    from keyed
   where pair_key is not null
)
update public.message_threads t
   set direct_pair_key = case when r.rn = 1 then r.pair_key else null end,
       archived_at     = case when r.rn = 1 then t.archived_at
                              else coalesce(t.archived_at, now()) end
  from ranked r
 where t.id = r.thread_id;

-- Consolidate inbox visibility: hide the reconciled-away duplicates from every
-- participant (they were archived + pair_key cleared just above).
update public.message_participants mp
   set archived_at = coalesce(mp.archived_at, now())
  from public.message_threads t
 where mp.thread_id       = t.id
   and t.thread_type      = 'direct'
   and t.archived_at is not null
   and t.direct_pair_key is null;

-- Enforce one canonical (pair_key-bearing) direct thread per pair, forever.
create unique index if not exists mt_direct_pair_uidx
  on public.message_threads(direct_pair_key)
  where direct_pair_key is not null;
