-- ============================================================================
-- PTW demo seed — run MANUALLY in Supabase (SQL editor) after the gas-test
-- removal migration (20260630000000_hse_ptw_remove_gas_tests.sql).
--
-- Populates hse_permits across statuses / types / risk so the PTW page shows
-- live data: the 4 StatsCards (Permit Mix, Expiring Soon, Isolation Readiness,
-- Permit Trend), the compact spark row, the register, and the navy signals rail
-- (Awaiting Approval · Expiring Soon · Suspended). Also seeds isolation points,
-- pending approvals, and a few permit templates.
--
-- Idempotent: fixed ids + on conflict do nothing. Safe to re-run.
-- All timing is relative to now(), so "expiring soon" stays meaningful.
-- requester / supervisor / authority point at the first app_user (or null).
-- ============================================================================

begin;

-- ── Permits ──────────────────────────────────────────────────────────────────
insert into public.hse_permits
  (id, ref, type, permit_type, permit_number, title, description, status, risk_level,
   site_id, specific_location, requester_id, work_supervisor_id, area_authority_id,
   start_datetime, end_datetime, requested_at,
   requires_jsa, requires_isolation, requires_simops_check, created_at, updated_at)
select
  v.id, v.ref, v.permit_type, v.permit_type, v.ref, v.title, v.descr, v.status, v.risk,
  v.site, v.loc,
  (select id from public.app_users order by created_at limit 1),
  (select id from public.app_users order by created_at limit 1),
  (select id from public.app_users order by created_at limit 1),
  v.starto, v.endo, v.starto,
  v.rjsa, v.riso, v.rsim, now() - interval '6 hour', now()
from (values
  -- ── ACTIVE (Permit Mix donut + Expiring Soon + spark "Active") ──
  ('a0000000-0000-4000-8000-000000009001'::uuid,'PTW-9001','hot_work',          'Welding repair on flare line','Hot work on the main flare header.','active','high',     'Galeota Marine Base','Flare deck, Level 3', now()-interval '2 hour',  now()+interval '1 hour',  true, true,  true),
  ('a0000000-0000-4000-8000-000000009002'::uuid,'PTW-9002','confined_space',    'Vessel internal inspection','Entry into V-204 separator.','active','critical',         'Pointe-a-Pierre Refinery','Tank V-204', now()-interval '4 hour',  now()+interval '5 hour',  true, true,  true),
  ('a0000000-0000-4000-8000-000000009003'::uuid,'PTW-9003','electrical_work',   'MCC panel maintenance','LOTO on MCC-7 for breaker replacement.','active','medium',     'Point Lisas Plant','Substation B', now()-interval '1 hour',  now()+interval '3 day',   true, true,  true),
  ('a0000000-0000-4000-8000-000000009004'::uuid,'PTW-9004','working_at_height', 'Roof gutter clearance','Work at height on warehouse roof.','active','low',              'Galeota Marine Base','Warehouse 2 roof', now()-interval '1 hour',  now()+interval '6 hour',  true, false, false),
  ('a0000000-0000-4000-8000-000000009005'::uuid,'PTW-9005','lifting_operation', 'Crane lift of pump skid','120t crane lift of process pump skid.','active','high',        'Point Lisas Plant','Laydown yard', now()-interval '30 minute', now()+interval '2 day',  true, false, true),

  -- ── AWAITING APPROVAL (navy rail + approval bottleneck) ──
  ('a0000000-0000-4000-8000-000000009006'::uuid,'PTW-9006','general_work',      'Routine pipe support repair','Replace corroded U-bolts.','awaiting_approval','low',      'Pointe-a-Pierre Refinery','Pipe rack 12', now()+interval '1 day',   now()+interval '1 day 8 hour',  false, false, false),
  ('a0000000-0000-4000-8000-000000009007'::uuid,'PTW-9007','hot_work',          'Grinding on structural steel','Grinding + welding on handrail.','awaiting_approval','high','Galeota Marine Base','Platform A', now()+interval '6 hour',  now()+interval '14 hour',  true, true,  true),

  -- ── PRE-ACTIVE pipeline (approval bottleneck by stage) ──
  ('a0000000-0000-4000-8000-000000009008'::uuid,'PTW-9008','excavation',        'Trench for new cable run','Excavate 30m trench near substation.','submitted','medium',    'Point Lisas Plant','North perimeter', now()+interval '2 day',  now()+interval '2 day 10 hour', true, true,  true),
  ('a0000000-0000-4000-8000-000000009009'::uuid,'PTW-9009','cold_work',         'Gasket replacement on pump','Cold work — replace pump seal.','risk_review','low',         'Pointe-a-Pierre Refinery','Pump P-110', now()+interval '1 day',   now()+interval '1 day 6 hour',  true, false, false),
  ('a0000000-0000-4000-8000-000000009010'::uuid,'PTW-9010','confined_space',    'Tank cleaning entry','Confined space entry for sludge removal.','isolation_pending','high','Point Lisas Plant','Tank T-301', now()+interval '1 day',   now()+interval '1 day 8 hour',  true, true,  true),
  ('a0000000-0000-4000-8000-000000009011'::uuid,'PTW-9011','chemical_handling', 'Acid transfer line flush','Flush and neutralise acid dosing line.','changes_requested','medium','Pointe-a-Pierre Refinery','Chem dosing skid', now()+interval '2 day', now()+interval '2 day 6 hour', true, false, true),

  -- ── SUSPENDED (navy rail "Suspended / Blocked" + spark) ──
  ('a0000000-0000-4000-8000-000000009012'::uuid,'PTW-9012','electrical_work',   'Switchgear upgrade','Suspended pending isolation re-verification.','suspended','high',    'Point Lisas Plant','Switchroom 1', now()-interval '1 day',   now()+interval '1 day',   true, true,  false),
  ('a0000000-0000-4000-8000-000000009013'::uuid,'PTW-9013','line_break',        'Break containment on product line','Suspended after weather alert.','suspended','critical','Galeota Marine Base','Jetty manifold', now()-interval '6 hour',  now()+interval '12 hour',  true, true,  true),

  -- ── ARCHIVE + DRAFT (register spread) ──
  ('a0000000-0000-4000-8000-000000009014'::uuid,'PTW-9014','general_work',      'Painting of handrails','Completed and closed.','closed','low',                          'Pointe-a-Pierre Refinery','Admin block', now()-interval '5 day',   now()-interval '4 day',   false, false, false),
  ('a0000000-0000-4000-8000-000000009015'::uuid,'PTW-9015','hot_work',          'Temporary repair welding','Draft — not yet submitted.','draft','medium',                'Galeota Marine Base','Workshop', now()+interval '3 day',   now()+interval '3 day 8 hour',  true, true, true)
) as v(id, ref, permit_type, title, descr, status, risk, site, loc, starto, endo, rjsa, riso, rsim)
on conflict (ref) do nothing;

-- ── Isolation points (Isolation Readiness card: verified / required) ─────────
insert into public.hse_permit_isolations
  (id, permit_id, isolation_point, isolation_type, tag_number, status, sort_order)
values
  ('b0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000009002','V-204 inlet valve','valve','LV-204-IN','verified',0),
  ('b0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000009002','V-204 outlet valve','valve','LV-204-OUT','verified',1),
  ('b0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000009002','Agitator power','electrical','LE-204-AG','verified',2),
  ('b0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000009002','Steam supply','thermal','LT-204-ST','pending',3),
  ('b0000000-0000-4000-8000-000000000005','a0000000-0000-4000-8000-000000009003','MCC-7 main breaker','loto','LO-MCC7','verified',0),
  ('b0000000-0000-4000-8000-000000000006','a0000000-0000-4000-8000-000000009010','T-301 fill line','valve','LV-301','pending',0),
  ('b0000000-0000-4000-8000-000000000007','a0000000-0000-4000-8000-000000009010','T-301 mixer power','electrical','LE-301','pending',1),
  ('b0000000-0000-4000-8000-000000000008','a0000000-0000-4000-8000-000000009012','SWGR feeder A','loto','LO-SW-A','verified',0)
on conflict (id) do nothing;

-- ── Pending approvals (spark "Awaiting Approval" + bottleneck) ───────────────
insert into public.hse_permit_approvals
  (id, permit_id, step_order, role_required, status)
values
  ('c0000000-0000-4000-8000-000000000001','a0000000-0000-4000-8000-000000009006',0,'Area Authority','pending'),
  ('c0000000-0000-4000-8000-000000000002','a0000000-0000-4000-8000-000000009007',0,'Area Authority','pending'),
  ('c0000000-0000-4000-8000-000000000003','a0000000-0000-4000-8000-000000009007',1,'HSE Officer','pending'),
  ('c0000000-0000-4000-8000-000000000004','a0000000-0000-4000-8000-000000009008',0,'Area Authority','pending')
on conflict (id) do nothing;

-- ── Permit templates (Templates tab) ─────────────────────────────────────────
insert into public.hse_permit_templates
  (id, name, description, permit_type, risk_level, requires_jsa, requires_isolation, active)
values
  ('d0000000-0000-4000-8000-000000000001','Hot Work — Standard','Welding / grinding / cutting with fire watch.','hot_work','high',true,true,true),
  ('d0000000-0000-4000-8000-000000000002','Confined Space Entry','Entry with continuous monitoring + rescue plan.','confined_space','critical',true,true,true),
  ('d0000000-0000-4000-8000-000000000003','General Maintenance','Routine low-risk maintenance work.','general_work','low',false,false,true)
on conflict (id) do nothing;

commit;
