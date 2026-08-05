-- app_setting_values: make "one override per (setting, scope)" a DATABASE guarantee.
--
-- The bug this closes: the write path used
--   upsert(..., { onConflict: 'setting_key,scope_type,scope_id' })
-- but a GLOBAL override has scope_id IS NULL, and NULL is never equal to NULL in a unique
-- index. ON CONFLICT therefore never fired for global settings and every write INSERTED a
-- new row. `resolveSetting` read the scope with `.maybeSingle()`, which errors on multiple
-- rows, and the caller swallowed that error as "no override" — so the SECOND write to any
-- global setting silently switched it OFF and fell back to the catalog default. `values/reset`
-- hit the same `.maybeSingle()` wall and refused to delete, which made the state unrecoverable
-- through the API. Observed live on `hr_onboarding.work_email_domain`.
--
-- The application paths are fixed (explicit read → UPDATE-or-INSERT; resolver and reset now
-- distinguish "no rows" from "multiple rows"). This migration stops any OTHER writer — a
-- script, a seed, a future call site — from reintroducing the duplicate.
--
-- TWO partial indexes rather than one three-column index, precisely because of the NULL
-- semantics above: the NULL-scope case needs its own index that keys only on the two non-null
-- columns. Partial indexes are also why the app no longer relies on ON CONFLICT inference —
-- PostgREST cannot express the index predicate.

-- De-duplicate first: the indexes cannot be created while duplicates exist. Keep the most
-- recently updated row per (setting_key, scope_type, scope_id) — that is the value the
-- deployment last intended. Ties break on id so the result is deterministic.
with ranked as (
  select id,
         row_number() over (
           partition by setting_key, scope_type, coalesce(scope_id, '__global__')
           order by updated_at desc nulls last, id desc
         ) as rn
  from public.app_setting_values
)
delete from public.app_setting_values v
using ranked r
where v.id = r.id and r.rn > 1;

create unique index if not exists app_setting_values_scope_null_uidx
  on public.app_setting_values (setting_key, scope_type)
  where scope_id is null;

create unique index if not exists app_setting_values_scope_uidx
  on public.app_setting_values (setting_key, scope_type, scope_id)
  where scope_id is not null;

comment on index public.app_setting_values_scope_null_uidx is
  'One override per (setting_key, scope_type) when scope_id IS NULL. A plain three-column unique index does NOT cover this case: NULL never equals NULL, so global overrides could duplicate freely and a duplicated setting resolves as unset.';

-- Verification (operator):
-- 1. select setting_key, scope_type, coalesce(scope_id,'__global__') s, count(*)
--    from public.app_setting_values group by 1,2,3 having count(*) > 1;   -- 0 rows
-- 2. Insert a second global row for any existing key → must raise 23505.
-- 3. `settings/values/set` twice on a global key → one row, second call UPDATES it.
-- 4. `settings/values/reset` on a global key → row removed, rowsCleared = 1.
