-- ============================================================================
-- Inspections demo seed — run MANUALLY in Supabase (SQL editor) after the
-- Inspections migrations (20260701000000 + 20260701000001).
--
-- Populates hse_inspection_templates (+ items), hse_inspections across statuses
-- / types / sites, hse_inspection_findings of varying severity / status, and a
-- few corrective actions — so the Inspections page renders fully: the 4
-- StatsCards, the spark row, both register tables, the navy signals rail, and
-- the detail drawers (including live checklist execution).
--
-- Idempotent: fixed ids + on conflict do nothing. Safe to re-run.
-- Timing is relative to now() so "overdue" / "due this week" stay meaningful.
-- assignee / owner / created_by point at the first app_user (or null).
-- ============================================================================

begin;

-- ── Templates ─────────────────────────────────────────────────────────────────
insert into public.hse_inspection_templates (id, name, inspection_type, description, is_active, created_at)
values
  ('c1000000-0000-4000-8000-000000000001'::uuid, 'Monthly Housekeeping Audit', 'housekeeping', 'Routine 5S / housekeeping inspection checklist.', true, now() - interval '40 day'),
  ('c1000000-0000-4000-8000-000000000002'::uuid, 'Fire Equipment Inspection',  'fire',         'Monthly fire extinguisher + hose reel check.',     true, now() - interval '40 day')
on conflict (id) do nothing;

-- ── Template items ──────────────────────────────────────────────────────────────
insert into public.hse_inspection_template_items
  (id, template_id, question, response_type, is_required, is_critical, requires_evidence_on_fail, auto_create_finding_on_fail, sort_order)
values
  -- Housekeeping
  ('c2000000-0000-4000-8000-000000000001'::uuid,'c1000000-0000-4000-8000-000000000001','Walkways and aisles clear of obstructions?','pass_fail_na', true, false, false, false, 0),
  ('c2000000-0000-4000-8000-000000000002'::uuid,'c1000000-0000-4000-8000-000000000001','Emergency exits and routes unobstructed?','pass_fail_na', true, true,  true,  true,  1),
  ('c2000000-0000-4000-8000-000000000003'::uuid,'c1000000-0000-4000-8000-000000000001','Waste segregated and bins not overflowing?','pass_fail_na', true, false, false, false, 2),
  ('c2000000-0000-4000-8000-000000000004'::uuid,'c1000000-0000-4000-8000-000000000001','Spill kits stocked and accessible?','pass_fail_na', true, false, false, false, 3),
  -- Fire
  ('c2000000-0000-4000-8000-000000000011'::uuid,'c1000000-0000-4000-8000-000000000002','Extinguishers in place and gauge in green?','pass_fail_na', true, true,  true,  true,  0),
  ('c2000000-0000-4000-8000-000000000012'::uuid,'c1000000-0000-4000-8000-000000000002','Hose reels free of damage and accessible?','pass_fail_na', true, false, false, false, 1),
  ('c2000000-0000-4000-8000-000000000013'::uuid,'c1000000-0000-4000-8000-000000000002','Fire alarm call points unobstructed?','pass_fail_na', true, true,  false, true,  2)
on conflict (id) do nothing;

-- ── Inspections ─────────────────────────────────────────────────────────────────
insert into public.hse_inspections
  (id, inspection_no, ref, type, inspection_type, title, description, status, priority,
   site_id, site_name, area, template_id, assignee_id, inspector_id, created_by,
   due_at, scheduled_at, started_at, completed_at, created_at, updated_at)
select
  v.id, v.ino, v.ino, v.itype, v.itype, v.title, v.descr, v.status, v.prio,
  v.site, v.site, v.area, v.tpl,
  (select id from public.app_users order by created_at limit 1),
  (select id from public.app_users order by created_at limit 1),
  (select id from public.app_users order by created_at limit 1),
  v.due, v.sched, v.started, v.completed, now() - interval '10 day', now()
from (values
  -- OVERDUE (past due, not completed) — rail "Overdue" + spark
  ('d0000000-0000-4000-8000-000000000001'::uuid,'INSP-9001','housekeeping','Housekeeping audit — Bay 3','Monthly 5S audit.','overdue','high',
     'Point Lisas Plant','Bay 3','c1000000-0000-4000-8000-000000000001'::uuid,
     now()-interval '3 day', now()-interval '10 day', null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000000002'::uuid,'INSP-9002','fire','Fire equipment check — Workshop','Monthly extinguisher check.','overdue','medium',
     'Pointe-a-Pierre Refinery','Workshop','c1000000-0000-4000-8000-000000000002'::uuid,
     now()-interval '1 day', now()-interval '8 day', null::timestamptz, null::timestamptz),

  -- DUE THIS WEEK (scheduled, due soon) — rail "Due Soon" + spark
  ('d0000000-0000-4000-8000-000000000003'::uuid,'INSP-9003','equipment','Crane pre-use inspection','Quarterly crane inspection.','scheduled','high',
     'Galeota Marine Base','Laydown yard',null::uuid,
     now()+interval '2 day', now()-interval '2 day', null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000000004'::uuid,'INSP-9004','chemical','Chemical store inspection','Storage compliance check.','scheduled','critical',
     'Point Lisas Plant','Chemical Store','c1000000-0000-4000-8000-000000000001'::uuid,
     now()+interval '5 day', now()-interval '1 day', null::timestamptz, null::timestamptz),

  -- IN PROGRESS — rail "In Progress" + drawer checklist execution
  ('d0000000-0000-4000-8000-000000000005'::uuid,'INSP-9005','housekeeping','Housekeeping audit — Admin block','Routine audit underway.','in_progress','medium',
     'Pointe-a-Pierre Refinery','Admin block','c1000000-0000-4000-8000-000000000001'::uuid,
     now()+interval '1 day', now()-interval '1 day', now()-interval '2 hour', null::timestamptz),

  -- SUBMITTED (awaiting review)
  ('d0000000-0000-4000-8000-000000000006'::uuid,'INSP-9006','ppe','PPE compliance walkthrough','Submitted for review.','submitted','medium',
     'Galeota Marine Base','Platform A',null::uuid,
     now()+interval '1 day', now()-interval '3 day', now()-interval '1 day', null::timestamptz),

  -- COMPLETED (completion rate)
  ('d0000000-0000-4000-8000-000000000007'::uuid,'INSP-9007','fire','Fire inspection — Jetty','Completed and signed off.','completed','low',
     'Galeota Marine Base','Jetty','c1000000-0000-4000-8000-000000000002'::uuid,
     now()-interval '5 day', now()-interval '12 day', now()-interval '6 day', now()-interval '5 day'),
  ('d0000000-0000-4000-8000-000000000008'::uuid,'INSP-9008','environmental','Spill containment audit','Completed.','completed','medium',
     'Point Lisas Plant','Bund area','c1000000-0000-4000-8000-000000000001'::uuid,
     now()-interval '8 day', now()-interval '15 day', now()-interval '9 day', now()-interval '8 day'),

  -- SCHEDULED (this month, future)
  ('d0000000-0000-4000-8000-000000000009'::uuid,'INSP-9009','equipment','Forklift monthly check','Upcoming.','scheduled','low',
     'Pointe-a-Pierre Refinery','Warehouse 2',null::uuid,
     now()+interval '12 day', now()-interval '1 day', null::timestamptz, null::timestamptz),
  ('d0000000-0000-4000-8000-000000000010'::uuid,'INSP-9010','site_audit','Quarterly site HSE audit','Full site audit.','scheduled','high',
     'Point Lisas Plant','Whole site',null::uuid,
     now()+interval '20 day', now()-interval '1 day', null::timestamptz, null::timestamptz)
) as v(id, ino, itype, title, descr, status, prio, site, area, tpl, due, sched, started, completed)
on conflict (ref) do nothing;

-- ── Findings ────────────────────────────────────────────────────────────────────
insert into public.hse_inspection_findings
  (id, finding_no, inspection_id, title, description, category, severity, status,
   site_id, site_name, area, owner_id, created_by, due_at, closed_at, created_at, updated_at)
select
  v.id, v.fno, v.insp, v.title, v.descr, v.cat, v.sev, v.status,
  v.site, v.site, v.area,
  (select id from public.app_users order by created_at limit 1),
  (select id from public.app_users order by created_at limit 1),
  v.due, v.closed, now() - interval '6 day', now()
from (values
  ('e0000000-0000-4000-8000-000000000001'::uuid,'FND-9001','d0000000-0000-4000-8000-000000000001'::uuid,
     'Emergency exit blocked by pallets','Pallets stacked in front of exit door E3.','Housekeeping','critical','open',
     'Point Lisas Plant','Bay 3', now()+interval '1 day', null::timestamptz),
  ('e0000000-0000-4000-8000-000000000002'::uuid,'FND-9002','d0000000-0000-4000-8000-000000000001'::uuid,
     'Spill kit not restocked','Absorbent pads depleted in Bay 3 spill kit.','Housekeeping','medium','assigned',
     'Point Lisas Plant','Bay 3', now()+interval '4 day', null::timestamptz),
  ('e0000000-0000-4000-8000-000000000003'::uuid,'FND-9003','d0000000-0000-4000-8000-000000000002'::uuid,
     'Extinguisher gauge in red','Workshop CO2 extinguisher requires recharge.','Fire','high','in_progress',
     'Pointe-a-Pierre Refinery','Workshop', now()+interval '2 day', null::timestamptz),
  ('e0000000-0000-4000-8000-000000000004'::uuid,'FND-9004','d0000000-0000-4000-8000-000000000007'::uuid,
     'Hose reel signage faded','Replace faded hose reel location sign.','Fire','low','closed',
     'Galeota Marine Base','Jetty', now()-interval '2 day', now()-interval '1 day'),
  ('e0000000-0000-4000-8000-000000000005'::uuid,'FND-9005','d0000000-0000-4000-8000-000000000008'::uuid,
     'Bund drain valve left open','Containment bund drain valve found open.','Environmental','high','awaiting_review',
     'Point Lisas Plant','Bund area', now()+interval '1 day', null::timestamptz)
) as v(id, fno, insp, title, descr, cat, sev, status, site, area, due, closed)
on conflict (id) do nothing;

-- ── Corrective actions ───────────────────────────────────────────────────────────
insert into public.hse_inspection_finding_actions
  (id, finding_id, action_description, owner_id, due_at, status, created_at)
select
  v.id, v.fid, v.descr,
  (select id from public.app_users order by created_at limit 1),
  v.due, v.status, now() - interval '5 day'
from (values
  ('f0000000-0000-4000-8000-000000000001'::uuid,'e0000000-0000-4000-8000-000000000001'::uuid,'Relocate pallets and barrier the exit', now()+interval '1 day','in_progress'),
  ('f0000000-0000-4000-8000-000000000002'::uuid,'e0000000-0000-4000-8000-000000000002'::uuid,'Restock spill kit with absorbent pads', now()+interval '3 day','open'),
  ('f0000000-0000-4000-8000-000000000003'::uuid,'e0000000-0000-4000-8000-000000000003'::uuid,'Send extinguisher for recharge + swap spare', now()+interval '2 day','open')
) as v(id, fid, descr, due, status)
on conflict (id) do nothing;

commit;
