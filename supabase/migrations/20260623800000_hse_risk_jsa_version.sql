-- Optimistic-concurrency version columns for Risk/JSA records (spec §13).
-- An update may pass the version it read; the write only succeeds when the
-- stored version still matches, and bumps it. A mismatch means another edit
-- landed first → the API returns a conflict so the client can reload.

alter table public.hse_hazards          add column if not exists version int not null default 1;
alter table public.hse_risk_assessments add column if not exists version int not null default 1;
alter table public.hse_jsa              add column if not exists version int not null default 1;
