-- ============================================================================
-- HSE Demo Seed Data — T&T Operating Sites
--
-- Creates a realistic set of incidents, investigations, CAPA actions, and
-- people records representative of a T&T oil & gas / logistics operation.
-- All user references are null (no known app_user IDs at migration time).
-- reference_counters are advanced past the seeded refs so the backend
-- generates non-conflicting refs for new records.
-- ============================================================================

DO $$
DECLARE
  -- incident UUIDs
  inc1 uuid := '11111111-0001-0001-0001-000000000001';
  inc2 uuid := '11111111-0001-0001-0001-000000000002';
  inc3 uuid := '11111111-0001-0001-0001-000000000003';
  inc4 uuid := '11111111-0001-0001-0001-000000000004';
  inc5 uuid := '11111111-0001-0001-0001-000000000005';
  inc6 uuid := '11111111-0001-0001-0001-000000000006';
  -- investigation UUIDs
  inv1 uuid := '22222222-0002-0002-0002-000000000001';
  inv2 uuid := '22222222-0002-0002-0002-000000000002';
  inv3 uuid := '22222222-0002-0002-0002-000000000003';
BEGIN

  -- ── Incidents ────────────────────────────────────────────────────────────────

  INSERT INTO public.hse_incidents (
    id, ref, title, description, incident_date, incident_type, severity,
    status, location_text, immediate_action, recordable, lost_time,
    osh_classification, injury_type, body_part, lost_days,
    osh_notification_due, metadata
  ) VALUES

  -- INC-2026-0001: Environmental spill — critical, under investigation
  (inc1, 'INC-2026-0001',
   'Diesel sheen observed near storm drain',
   'During transfer line cleanup at Point Lisas Plant, diesel sheen was observed near the east storm drain. Estimated 15L released before valve isolation. Area cordoned off, spill kit deployed, and EMA notified verbally.',
   '2026-06-18 09:30:00+00', 'environmental', 'critical', 'investigation',
   'Point Lisas Plant — East transfer line manifold',
   'Area cordoned off. Spill kit deployed. Isolation valve closed. EMA verbal notification made at 10:45.',
   true, false, 'environmental', null, null, 0,
   '2026-06-19 09:30:00+00',
   '{"ema_case": "EMA-TT-2026-0441", "estimated_volume_litres": 15}'::jsonb),

  -- INC-2026-0002: Confined space near-miss — critical, blocked
  (inc2, 'INC-2026-0002',
   'Confined space entry stopped — no gas test or rescue plan',
   'Work crew attempted entry into ballast tank V-112 at Galeota Marine Base without completing the gas test or attaching a rescue plan to the PTW. Entry was stopped by the safety officer conducting a spot check. No injuries.',
   '2026-06-18 14:15:00+00', 'near_miss', 'critical', 'triage',
   'Galeota Marine Base — Ballast tank V-112',
   'Work stopped immediately. Permit suspended. Crew stood down pending re-induction.',
   true, false, 'near-miss', null, null, 0,
   '2026-06-19 14:15:00+00',
   '{"ptw_ref": "PTW-0033", "crew_size": 3}'::jsonb),

  -- INC-2026-0003: Laceration injury — high, capa raised
  (inc3, 'INC-2026-0003',
   'Hand laceration during manual handling of steel sheet',
   'An employee sustained a laceration to the right hand while manually handling a sharp-edged steel sheet at La Brea Yard warehouse. No cut-resistant gloves were being worn at the time of the incident.',
   '2026-06-17 11:20:00+00', 'injury', 'high', 'capa',
   'La Brea Yard — Warehouse bay 3',
   'First aid applied on-site. Employee transported to Union Industrial Estate clinic. Gloves are now mandatory in bay 3.',
   true, false, 'first-aid', 'Laceration / Cut', 'Hand', 0,
   null,
   '{"medical_centre": "UIE Clinic", "treatment_date": "2026-06-17"}'::jsonb),

  -- INC-2026-0004: Forklift near-miss — moderate, open
  (inc4, 'INC-2026-0004',
   'Forklift crossed pedestrian route without spotter',
   'A counterbalance forklift crossed the marked pedestrian walkway in the loading bay at Piarco Logistics without a spotter in position. A pedestrian was present and had to step back. No contact occurred.',
   '2026-06-16 08:50:00+00', 'near_miss', 'moderate', 'open',
   'Piarco Logistics — Loading bay B, pedestrian crossing',
   'Forklift operations suspended pending traffic management review. Warning issued to operator.',
   false, false, 'near-miss', null, null, 0,
   null,
   '{"forklift_id": "FL-04", "operator": "anonymous"}'::jsonb),

  -- INC-2026-0005: Work-at-height — high, open
  (inc5, 'INC-2026-0005',
   'Roof-edge maintenance without height control pack',
   'Facilities contractor was observed working within 2m of the unguarded roof edge at Port of Spain Office without a completed work-at-height control pack. No harness or edge protection was in place.',
   '2026-06-15 13:45:00+00', 'near_miss', 'high', 'open',
   'Port of Spain Office — Roof level, AC plant area',
   'Work stopped immediately. Contractor escorted off roof. Work suspended pending control-pack approval.',
   false, false, 'near-miss', null, null, 0,
   null,
   '{"contractor": "CoolAir Services Ltd", "permit_ref": null}'::jsonb),

  -- INC-2026-0006: Sprain — minor, closed
  (inc6, 'INC-2026-0006',
   'Ankle sprain — slip on wet floor in canteen',
   'Employee slipped on a wet floor in the canteen at Point Lisas Plant and sustained a mild ankle sprain. Wet floor sign was not in position. Employee returned to work same day.',
   '2026-06-10 12:05:00+00', 'injury', 'minor', 'closed',
   'Point Lisas Plant — Canteen',
   'First aid applied. Wet floor sign policy re-communicated to canteen staff.',
   false, false, 'first-aid', 'Sprain / Strain', 'Ankle', 0,
   null,
   '{}'::jsonb)

  ON CONFLICT (ref) DO NOTHING;

  -- ── People involved ──────────────────────────────────────────────────────────

  INSERT INTO public.hse_incident_people (
    incident_id, person_type, full_name, role_or_company, injury_description
  ) VALUES
  (inc3, 'injured',  'Marcus Williams',  'Warehouse Technician', 'Laceration to right palm, approximately 3cm. Required 2 sutures.'),
  (inc3, 'witness',  'Sonia Ramnarine',  'Warehouse Supervisor',  'Observed incident from 4m away. Confirmed no gloves were worn.'),
  (inc6, 'injured',  'Denise Phillip',   'Canteen Staff',         'Mild right ankle sprain. Ice applied, fit for light duties same day.'),
  (inc1, 'reporter', 'Jerome St. Hilaire','HSE Officer',           null),
  (inc2, 'reporter', 'Anika Persad',     'Safety Officer',        null)
  ON CONFLICT DO NOTHING;

  -- ── Investigations ───────────────────────────────────────────────────────────

  INSERT INTO public.hse_investigations (
    id, ref, incident_id, status, due_at, root_cause_method,
    summary, findings, recommendations, metadata
  ) VALUES

  -- INV-2026-0001: Environmental spill investigation (in progress)
  (inv1, 'INV-2026-0001', inc1,
   'collecting_evidence',
   '2026-06-25 17:00:00+00',
   '5why',
   'Investigation into diesel release at east manifold — evidence collection phase.',
   'Preliminary: isolation valve V-07A was not in the fully-closed position prior to line depressurisation. Transfer log shows crew proceeded without verifying valve position.',
   null,
   '{"lead": "HSE Manager", "evidence_items": ["site_photos", "transfer_log", "valve_inspection_report"]}'::jsonb),

  -- INV-2026-0002: Confined space near-miss investigation (findings stage)
  (inv2, 'INV-2026-0002', inc2,
   'findings',
   '2026-06-22 17:00:00+00',
   '5why',
   'Near-miss investigation — crew attempted vessel entry without completing all PTW prerequisites.',
   'Root cause: PTW sign-off process was not enforced at the point of work. Crew lead signed off the permit without verifying gas test completion. Contributing factor: time pressure from marine vessel schedule.',
   'Mandatory gas test verification step added to PTW issuer checklist. Crew lead suspended pending disciplinary review. All confined space crews to undergo refresher induction before next entry.',
   '{"root_cause_confirmed": true, "capa_count": 2}'::jsonb),

  -- INV-2026-0003: Hand laceration investigation (closed)
  (inv3, 'INV-2026-0003', inc3,
   'closed',
   '2026-06-20 17:00:00+00',
   '5why',
   'Investigation closed — root cause confirmed as inadequate PPE enforcement at bay entry.',
   'Root cause: no mandatory glove requirement was in place for the steel-handling task. The task risk assessment did not identify cut risk from sharp-edged sheets. Supervisor did not intervene.',
   'Task-specific RA updated. Cut-resistant gloves (Level D) are now mandatory in bay 3. Glove dispensers installed at bay entry. Supervisor counselled.',
   '{"root_cause_confirmed": true, "closed_at": "2026-06-20"}'::jsonb)

  ON CONFLICT (ref) DO NOTHING;

  -- ── Root causes ──────────────────────────────────────────────────────────────

  INSERT INTO public.hse_root_causes (
    investigation_id, category, cause, contributing_factor
  ) VALUES
  (inv2, 'Procedure',  'PTW issuer did not verify gas test completion before signing off',  false),
  (inv2, 'Supervision','Time pressure from vessel schedule influenced permit rush',          true),
  (inv3, 'Equipment',  'No cut-resistant gloves required or available at bay entry',        false),
  (inv3, 'Procedure',  'Risk assessment did not identify sharp-edge cut hazard for task',  true)
  ON CONFLICT DO NOTHING;

  -- ── CAPA Actions ─────────────────────────────────────────────────────────────

  INSERT INTO public.hse_capa_actions (
    ref, source_type, source_id, title, description, priority, status, due_at, metadata
  ) VALUES

  ('CAPA-2026-0001', 'incident',     'INC-2026-0001',
   'Complete EMA written notification — diesel spill',
   'Submit the formal written EMA notification (Form EMA-7) within 7 days of the verbal notification. Attach site photos, spill volume estimate, and cleanup evidence.',
   'critical', 'open',
   '2026-06-25 17:00:00+00',
   '{"statutory": true, "ema_deadline": "2026-06-25"}'::jsonb),

  ('CAPA-2026-0002', 'incident',     'INC-2026-0002',
   'Update confined space PTW checklist — mandatory gas test verification',
   'Revise the PTW issuer checklist to include a mandatory gas test result field that must be completed before sign-off. Pilot at Galeota before rolling out to all sites.',
   'critical', 'in_progress',
   '2026-06-27 17:00:00+00',
   '{"capa_owner_role": "HSE Manager"}'::jsonb),

  ('CAPA-2026-0003', 'investigation', 'INV-2026-0003',
   'Install glove dispensers and enforce PPE at bay 3 entry',
   'Install cut-resistant glove dispensers (Level D min.) at La Brea Yard warehouse bay 3 entry. Update the bay task risk assessment. Conduct spot-check for compliance within 30 days.',
   'high', 'implemented',
   '2026-06-18 17:00:00+00',
   '{"completed_date": "2026-06-18", "verification_due": "2026-07-18"}'::jsonb),

  ('CAPA-2026-0004', 'incident',     'INC-2026-0004',
   'Install physical pedestrian barrier at loading bay crossing',
   'Install a physical bollard barrier at the Piarco Logistics loading bay B pedestrian crossing to prevent forklift encroachment without a spotter. Review traffic management plan.',
   'medium', 'open',
   '2026-07-05 17:00:00+00',
   '{}'::jsonb)

  ON CONFLICT (ref) DO NOTHING;

END $$;

-- ── Advance reference counters ────────────────────────────────────────────────
-- Ensures the backend ref generator does not collide with seeded refs.

INSERT INTO public.reference_counters (prefix, year, next_number)
VALUES
  ('INC',  2026, 7),
  ('INV',  2026, 4),
  ('CAPA', 2026, 5)
ON CONFLICT (prefix, year) DO UPDATE
  SET next_number = GREATEST(reference_counters.next_number, EXCLUDED.next_number);
