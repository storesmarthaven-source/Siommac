-- ============================================================================
-- SIOMAC — Incidents demo data spread across Jan–Jun 2026
--
-- Gives the four Incident stat cards real movement:
--   Severity Mix (MTD = June) · Open Investigations · Corrective Actions % ·
--   Incident Trend (6-month sparkline).
--
-- Paste into Supabase Dashboard → SQL Editor → Run. Idempotent (guarded on
-- INC-2026-0101). Refs 0101+ so they don't collide with the base seed (0001–0006).
-- Assumes public.hse_incidents / hse_investigations / hse_capa_actions exist.
-- ============================================================================

DO $$
DECLARE
  -- incidents that get an investigation (fixed UUIDs so we can link them)
  v1 uuid := '66666666-0006-0006-0006-000000000001';
  v2 uuid := '66666666-0006-0006-0006-000000000002';
  v3 uuid := '66666666-0006-0006-0006-000000000003';
  v4 uuid := '66666666-0006-0006-0006-000000000004';
  v5 uuid := '66666666-0006-0006-0006-000000000005';
  v6 uuid := '66666666-0006-0006-0006-000000000006';
BEGIN
  IF EXISTS (SELECT 1 FROM public.hse_incidents WHERE ref = 'INC-2026-0101') THEN
    RAISE NOTICE 'Incident trend demo data already present — skipping.';
  ELSE

  -- ── Incidents (id, ref, title, description, incident_date, incident_type, severity, status, location_text, immediate_action, recordable, lost_time, osh_classification) ──
  INSERT INTO public.hse_incidents
    (id, ref, title, description, incident_date, incident_type, severity, status, location_text, immediate_action, recordable, lost_time, osh_classification)
  VALUES
  -- January (4)
  (gen_random_uuid(),'INC-2026-0101','Slip on wet walkway','Minor slip, no injury','2026-01-08 08:10:00+00','near_miss','minor','closed','Point Lisas Plant — Walkway','Area mopped, sign placed',false,false,'near-miss'),
  (gen_random_uuid(),'INC-2026-0102','Hand laceration on sheet metal','First-aid laceration','2026-01-15 10:30:00+00','injury','moderate','closed','La Brea Yard — Bay 3','First aid applied',true,false,'first-aid'),
  (gen_random_uuid(),'INC-2026-0103','Forklift near pedestrian','No contact, spotter missing','2026-01-22 14:00:00+00','near_miss','high','closed','Piarco Logistics — Bay B','Ops suspended',false,false,'near-miss'),
  (v1,'INC-2026-0104','Chemical splash to forearm','Caustic splash, medical treatment','2026-01-27 09:45:00+00','injury','high','capa','Point Lisas Plant — Dosing skid','Eyewash, transported to clinic',true,false,'medical-treatment'),
  -- February (6)
  (gen_random_uuid(),'INC-2026-0105','Oil sheen at drain','Small hydraulic leak','2026-02-03 11:20:00+00','environmental','moderate','closed','La Brea Yard — Workshop','Absorbent deployed',false,false,'environmental'),
  (gen_random_uuid(),'INC-2026-0106','Dropped object from scaffold','Tool fell, no injury','2026-02-09 13:05:00+00','near_miss','high','closed','Galeota — Platform A','Exclusion zone',false,false,'near-miss'),
  (gen_random_uuid(),'INC-2026-0107','Ankle sprain on stairs','Lost-time sprain','2026-02-14 16:40:00+00','injury','moderate','capa','Port of Spain Office — Stairwell','First aid, sent home',true,true,'lost-time'),
  (gen_random_uuid(),'INC-2026-0108','Reversing truck clipped barrier','Property damage only','2026-02-18 07:55:00+00','property_damage','minor','closed','Piarco Logistics — Gate','Barrier repaired',false,false,'property-damage'),
  (v2,'INC-2026-0109','Confined space entry without gas test','Stopped by spot check','2026-02-21 10:15:00+00','near_miss','critical','investigation','Galeota — Ballast tank','Work stopped, permit suspended',true,false,'dangerous-occurrence'),
  (gen_random_uuid(),'INC-2026-0110','Minor steam burn','First-aid burn','2026-02-26 12:00:00+00','injury','minor','closed','Point Lisas Plant — Boiler','Cooled, dressed',true,false,'first-aid'),
  -- March (3)
  (gen_random_uuid(),'INC-2026-0111','Diesel spill at apron','15L released to bund','2026-03-05 09:30:00+00','environmental','high','capa','Point Lisas Plant — Transfer apron','Valve isolated, EMA verbal',true,false,'environmental'),
  (v3,'INC-2026-0112','Crush injury to finger','Caught in conveyor guard','2026-03-12 15:20:00+00','injury','high','investigation','La Brea Yard — CV-04','First aid, X-ray ordered',true,false,'medical-treatment'),
  (gen_random_uuid(),'INC-2026-0113','Near miss — swinging load','Crane load swung near crew','2026-03-24 11:10:00+00','near_miss','moderate','closed','Galeota — Laydown','Lift halted, re-briefed',false,false,'near-miss'),
  -- April (7)
  (gen_random_uuid(),'INC-2026-0114','Trip over hose','Minor trip, no injury','2026-04-02 08:25:00+00','near_miss','minor','closed','Piarco Logistics — Bay A','Hose rerouted',false,false,'near-miss'),
  (gen_random_uuid(),'INC-2026-0115','Eye irritation from dust','First-aid flush','2026-04-07 10:50:00+00','injury','minor','closed','La Brea Yard — Crusher','Eyewash used',true,false,'first-aid'),
  (v4,'INC-2026-0116','Arc flash near MCC','Flash, no contact','2026-04-13 14:35:00+00','near_miss','critical','investigation','Point Lisas Plant — MCC B','Isolated, area cleared',true,false,'dangerous-occurrence'),
  (gen_random_uuid(),'INC-2026-0117','Vehicle reversing damage','Mirror damaged','2026-04-18 07:40:00+00','property_damage','minor','closed','Port of Spain Office — Car park','Reported to fleet',false,false,'property-damage'),
  (gen_random_uuid(),'INC-2026-0118','Spill of lube oil','Drum tipped, 20L','2026-04-22 13:15:00+00','environmental','moderate','capa','Piarco Logistics — Lube store','Spill kit deployed',false,false,'environmental'),
  (gen_random_uuid(),'INC-2026-0119','Back strain lifting drum','Restricted duty','2026-04-25 09:05:00+00','injury','moderate','capa','La Brea Yard — Store','Manual handling review',true,false,'restricted-duty'),
  (gen_random_uuid(),'INC-2026-0120','Near miss — unsecured ladder','Ladder slipped, no fall','2026-04-29 16:00:00+00','near_miss','high','closed','Galeota — Workshop','Ladder removed',false,false,'near-miss'),
  -- May (5)
  (gen_random_uuid(),'INC-2026-0121','Hot work without permit','Stopped, no fire','2026-05-04 11:30:00+00','near_miss','high','closed','Point Lisas Plant — Pipe rack','Work stopped',false,false,'near-miss'),
  (v5,'INC-2026-0122','Laceration requiring sutures','Medical treatment','2026-05-11 14:10:00+00','injury','high','investigation','La Brea Yard — Fab shop','First aid, 4 sutures',true,false,'medical-treatment'),
  (gen_random_uuid(),'INC-2026-0123','Forklift tyre blowout','Property damage','2026-05-16 08:45:00+00','property_damage','minor','closed','Piarco Logistics — Yard','Unit removed',false,false,'property-damage'),
  (gen_random_uuid(),'INC-2026-0124','Chemical odour complaint','Investigated, no leak','2026-05-23 10:20:00+00','environmental','minor','closed','Point Lisas Plant — Tank farm','Area checked',false,false,'environmental'),
  (gen_random_uuid(),'INC-2026-0125','Slip in canteen','Minor sprain','2026-05-28 12:35:00+00','injury','minor','closed','Port of Spain Office — Canteen','First aid',true,false,'first-aid'),
  -- June (current month) (8) — drives Severity Mix MTD + open work
  (gen_random_uuid(),'INC-2026-0126','Near miss — dropped scaffold board','No injury','2026-06-02 09:15:00+00','near_miss','moderate','open','La Brea Yard — Tank T-201','Exclusion zone',false,false,'near-miss'),
  (v6,'INC-2026-0127','H2S alarm during intervention','Crew evacuated','2026-06-05 07:30:00+00','near_miss','critical','investigation','Galeota — Wellhead A','Evacuated, monitors checked',true,false,'dangerous-occurrence'),
  (gen_random_uuid(),'INC-2026-0128','Diesel sheen near storm drain','EMA reportable','2026-06-09 09:30:00+00','environmental','critical','investigation','Point Lisas Plant — East drain','Cordoned, EMA notified',true,false,'environmental'),
  (gen_random_uuid(),'INC-2026-0129','Hand laceration manual handling','Medical treatment','2026-06-12 11:20:00+00','injury','high','capa','La Brea Yard — Bay 3','First aid, clinic',true,false,'medical-treatment'),
  (gen_random_uuid(),'INC-2026-0130','Forklift crossed walkway','No contact','2026-06-16 08:50:00+00','near_miss','high','open','Piarco Logistics — Bay B','Ops suspended',false,false,'near-miss'),
  (gen_random_uuid(),'INC-2026-0131','Work at height without harness','Stopped','2026-06-18 13:45:00+00','near_miss','moderate','open','Port of Spain Office — Roof','Escorted off roof',false,false,'near-miss'),
  (gen_random_uuid(),'INC-2026-0132','Minor chemical splash','First aid','2026-06-20 10:05:00+00','injury','minor','open','Point Lisas Plant — Lab','Eyewash',true,false,'first-aid'),
  (gen_random_uuid(),'INC-2026-0133','Ankle sprain wet floor','First aid','2026-06-21 12:05:00+00','injury','minor','closed','Point Lisas Plant — Canteen','First aid',false,false,'first-aid')
  ON CONFLICT (ref) DO NOTHING;

  -- ── Investigations on the 6 high/critical incidents ──
  INSERT INTO public.hse_investigations (ref, incident_id, status, due_at, root_cause_method, summary)
  VALUES
  ('INV-2026-0101', v1, 'closed',             '2026-02-05 17:00:00+00','5why','Caustic splash — PPE gap. Closed.'),
  ('INV-2026-0102', v2, 'findings',           '2026-03-01 17:00:00+00','5why','Confined space PTW not enforced.'),
  ('INV-2026-0103', v3, 'collecting_evidence','2026-03-20 17:00:00+00','5why','Conveyor guard interlock review.'),
  ('INV-2026-0104', v4, 'collecting_evidence','2026-04-25 17:00:00+00','5why','Arc flash — isolation procedure.'),
  ('INV-2026-0105', v5, 'findings',           '2026-05-22 17:00:00+00','5why','Sharp-edge handling without gloves.'),
  ('INV-2026-0106', v6, 'collecting_evidence','2026-06-15 17:00:00+00','5why','H2S exposure during intervention.')
  ON CONFLICT (ref) DO NOTHING;

  -- ── CAPA actions (mixed completed / open → drives the Corrective Actions % bar) ──
  INSERT INTO public.hse_capa_actions (ref, source_type, source_id, title, description, priority, status, due_at)
  VALUES
  ('CAPA-2026-0101','incident','INC-2026-0104','Issue chemical-resistant gauntlets','Dosing skid PPE upgrade','high','closed','2026-02-10 17:00:00+00'),
  ('CAPA-2026-0102','incident','INC-2026-0107','Anti-slip nosing on stairwell','Stair tread upgrade','medium','closed','2026-03-01 17:00:00+00'),
  ('CAPA-2026-0103','incident','INC-2026-0111','Submit EMA written notification','Form EMA-7 within 7 days','critical','closed','2026-03-12 17:00:00+00'),
  ('CAPA-2026-0104','incident','INC-2026-0118','Bund the lube store','Secondary containment','medium','verification','2026-05-10 17:00:00+00'),
  ('CAPA-2026-0105','incident','INC-2026-0119','Provide drum handling aids','Mechanical lifting','medium','closed','2026-05-12 17:00:00+00'),
  ('CAPA-2026-0106','incident','INC-2026-0122','Mandatory cut gloves in fab shop','Level D gloves','high','implemented','2026-05-25 17:00:00+00'),
  ('CAPA-2026-0107','incident','INC-2026-0129','Glove dispensers at Bay 3','Enforce PPE','high','open','2026-06-26 17:00:00+00'),
  ('CAPA-2026-0108','incident','INC-2026-0128','EMA written notification — diesel','Statutory submission','critical','open','2026-06-23 17:00:00+00'),
  ('CAPA-2026-0109','incident','INC-2026-0130','Install pedestrian barrier','Loading bay segregation','medium','open','2026-07-05 17:00:00+00'),
  ('CAPA-2026-0110','incident','INC-2026-0127','Review sour-service monitor checks','Personal H2S monitors','critical','in_progress','2026-06-30 17:00:00+00'),
  ('CAPA-2026-0111','incident','INC-2026-0102','Cut-resistant gloves in Bay 3','Standardise PPE','medium','closed','2026-01-25 17:00:00+00'),
  ('CAPA-2026-0112','incident','INC-2026-0116','Arc-flash labelling on MCC','Hazard signage','high','open','2026-07-01 17:00:00+00')
  ON CONFLICT (ref) DO NOTHING;

  RAISE NOTICE 'Incident trend demo data inserted.';
  END IF;
END $$;

-- Advance reference counters past the seeded refs (year 2026).
INSERT INTO public.reference_counters (prefix, year, next_number)
VALUES ('INC', 2026, 134), ('INV', 2026, 107), ('CAPA', 2026, 113)
ON CONFLICT (prefix, year) DO UPDATE
  SET next_number = GREATEST(reference_counters.next_number, EXCLUDED.next_number);

-- Quick check (optional):
-- select to_char(incident_date,'YYYY-MM') ym, count(*) from public.hse_incidents group by 1 order by 1;
