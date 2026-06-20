-- Phase 1A-ext: Enterprise incident fields
-- Adds injury classification, people involved, witness, body-part, OSH class,
-- and LTIFR support columns to hse_incidents.
-- Safe to run on an empty table (no data migration needed yet).

alter table public.hse_incidents
  add column if not exists classification    text
    check (classification in ('first-aid','medical-treatment','restricted-duty','lost-time','fatality','property-damage','environmental','near-miss','dangerous-occurrence') or classification is null),
  add column if not exists injury_type       text,   -- laceration, fracture, burn, etc.
  add column if not exists body_part         text,   -- hand, foot, head, back, eye, etc.
  add column if not exists lost_days         int     not null default 0,
  add column if not exists return_to_work    date,
  -- People involved (JSON array: [{name, employeeId, role, contractor}])
  add column if not exists people_involved   jsonb   not null default '[]',
  -- Witnesses (JSON array: [{name, employeeId, statement}])
  add column if not exists witnesses         jsonb   not null default '[]',
  -- Evidence attachments (JSON array: [{label, url, type}])
  add column if not exists evidence          jsonb   not null default '[]',
  -- OSH Act classification: 'notifiable' | 'non-notifiable' | 'dangerous-occurrence'
  add column if not exists osh_class         text,
  -- Hours worked at site (for LTIFR calculation)
  add column if not exists hours_worked      numeric(10,2);

-- OSH notification acknowledgement (separate from osh_notified_at on the old column)
-- osh_notified_at already exists from the initial migration — no add needed.

-- Index for LTIFR queries (lost-time incidents only)
create index if not exists idx_hse_incidents_classification on public.hse_incidents(classification)
  where classification = 'lost-time';
