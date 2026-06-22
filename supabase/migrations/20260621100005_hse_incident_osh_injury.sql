-- ════════════════════════════════════════════════════════════════════════════
-- 20260621100005_hse_incident_osh_injury.sql
--
-- First-class OSH statutory-notification and injury-detail columns on
-- hse_incidents. These were previously absent from the canonical core table;
-- OSH notification deadlines are a statutory compliance obligation (OSH Act
-- 2004 T&T, s.19 verbal / s.19 written) and MUST be queryable, indexable and
-- RLS-governed — never buried in a metadata jsonb bag.
--
-- Witnesses and other involved parties continue to use hse_incident_people
-- (person_type already includes 'witness').
-- ════════════════════════════════════════════════════════════════════════════

-- ── Injury classification + detail ────────────────────────────────────────────

alter table public.hse_incidents
  add column if not exists osh_classification text
    check (osh_classification is null or osh_classification in (
      'first-aid','medical-treatment','restricted-duty','lost-time',
      'fatality','property-damage','environmental','near-miss','dangerous-occurrence'
    )),
  add column if not exists injury_type     text,
  add column if not exists body_part       text,
  add column if not exists lost_days       integer not null default 0,
  add column if not exists return_to_work  date;

-- ── OSH statutory notification tracking ───────────────────────────────────────
-- Deadlines are computed on the backend at create time for notifiable incidents
-- (severity high|critical). Verbal: 24h from incident. Written: 7 days.

alter table public.hse_incidents
  add column if not exists osh_notification_due timestamptz,
  add column if not exists osh_notified_at      timestamptz,
  add column if not exists osh_written_due       timestamptz,
  add column if not exists osh_written_at        timestamptz;

-- Partial index: surface incidents with an unmet verbal-notification deadline
-- (drives the "OSH notifications overdue" dashboard KPI and the drawer banner).
create index if not exists idx_hse_incidents_osh_notification_pending
  on public.hse_incidents (osh_notification_due)
  where osh_notification_due is not null and osh_notified_at is null;

-- Lost-time index already implied by the dashboard query; add a supporting
-- index for the lost_time + incident_date KPI scan.
create index if not exists idx_hse_incidents_lost_time
  on public.hse_incidents (incident_date)
  where lost_time = true;
