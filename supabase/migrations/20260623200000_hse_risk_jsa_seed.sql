-- ============================================================================
-- HSE Risk & JSA Demo Seed Data — T&T Operating Sites
--
-- Realistic hazard register, risk assessments, JSAs, controls, PPE and training
-- links for a T&T oil & gas / logistics operation. Mirrors the incident seed:
--   • site_id is NULL (project_sites ids are random per-env); the operating site
--     is carried in location_text so the register still reads naturally.
--   • All user references are NULL (no known app_user ids at migration time).
--   • created_at is spread across Jan–Jun 2026 so the insight-card trend
--     sparklines (6-month created_at series) render real movement.
--   • reference_counters are advanced past the seeded refs so the backend ref
--     generator does not collide.
-- ============================================================================

DO $$
DECLARE
  -- hazard UUIDs
  h1 uuid := '33333333-0003-0003-0003-000000000001';
  h2 uuid := '33333333-0003-0003-0003-000000000002';
  h3 uuid := '33333333-0003-0003-0003-000000000003';
  h4 uuid := '33333333-0003-0003-0003-000000000004';
  h5 uuid := '33333333-0003-0003-0003-000000000005';
  h6 uuid := '33333333-0003-0003-0003-000000000006';
  h7 uuid := '33333333-0003-0003-0003-000000000007';
  h8 uuid := '33333333-0003-0003-0003-000000000008';
  -- risk assessment UUIDs
  r1 uuid := '44444444-0004-0004-0004-000000000001';
  r2 uuid := '44444444-0004-0004-0004-000000000002';
  r3 uuid := '44444444-0004-0004-0004-000000000003';
  r4 uuid := '44444444-0004-0004-0004-000000000004';
  r5 uuid := '44444444-0004-0004-0004-000000000005';
  -- JSA UUIDs
  j1 uuid := '55555555-0005-0005-0005-000000000001';
  j2 uuid := '55555555-0005-0005-0005-000000000002';
  j3 uuid := '55555555-0005-0005-0005-000000000003';
  j4 uuid := '55555555-0005-0005-0005-000000000004';
  j5 uuid := '55555555-0005-0005-0005-000000000005';
BEGIN

  -- ── Hazard register ──────────────────────────────────────────────────────────
  -- (residual_*_likelihood/severity drive the residual_score generated column)

  INSERT INTO public.hse_hazards (
    id, ref, title, description, category, location_text,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity,
    risk_level, status, review_due_at, created_at
  ) VALUES

  (h1, 'HAZ-2026-0001',
   'Chlorine gas release at water treatment skid',
   'Potential chlorine gas release during cylinder changeover at the potable water treatment skid. Affects operators and nearby maintenance crews. Detection and forced ventilation in place.',
   'Chemical', 'Point Lisas Plant — Water treatment skid',
   4, 4, 2, 3, 'high', 'monitoring',
   '2026-09-15 00:00:00+00', '2026-01-14 09:00:00+00'),

  (h2, 'HAZ-2026-0002',
   'Unguarded nip point on aggregate conveyor CV-04',
   'Exposed in-running nip point at the tail drum of conveyor CV-04. Risk of entanglement / amputation during belt tracking and cleaning. Interim lockout in place; fixed guard outstanding.',
   'Mechanical', 'La Brea Yard — Conveyor CV-04 tail drum',
   4, 5, 3, 4, 'critical', 'controls_required',
   '2026-07-01 00:00:00+00', '2026-02-03 10:30:00+00'),

  (h3, 'HAZ-2026-0003',
   'Exposed 480V busbar in MCC room B',
   'Missing dead-front cover on the 480V motor control centre exposes live busbar. Arc-flash and electrocution risk to electricians during routine inspection.',
   'Electrical', 'Point Lisas Plant — MCC room B',
   3, 4, NULL, NULL, 'high', 'under_review',
   '2026-08-10 00:00:00+00', '2026-02-22 14:15:00+00'),

  (h4, 'HAZ-2026-0004',
   'Flammable solvent storage adjacent to hot-work area',
   'Drummed flammable solvents stored within 6m of a designated hot-work area at the fabrication shop. Fire / explosion risk during welding and grinding operations.',
   'Fire', 'Galeota Marine Base — Fabrication shop',
   4, 5, NULL, NULL, 'critical', 'assessment_required',
   '2026-06-20 00:00:00+00', '2026-03-11 08:45:00+00'),

  (h5, 'HAZ-2026-0005',
   'Manual handling of 200L lube drums',
   'Operators manually upending and rolling 200L lubricant drums without mechanical aid. Musculoskeletal injury risk. Drum dolly and training introduced.',
   'Ergonomic', 'Piarco Logistics — Lube store',
   3, 2, 1, 2, 'medium', 'approved',
   '2026-11-30 00:00:00+00', '2026-03-28 11:00:00+00'),

  (h6, 'HAZ-2026-0006',
   'Hydrocarbon ingress to east storm drain',
   'Minor hydrocarbon sheen periodically observed entering the east storm drain from the transfer apron. Environmental / EMA reporting risk.',
   'Environmental', 'Point Lisas Plant — East transfer apron',
   3, 4, NULL, NULL, 'high', 'registered',
   '2026-07-18 00:00:00+00', '2026-04-15 13:20:00+00'),

  (h7, 'HAZ-2026-0007',
   'H2S exposure during well intervention',
   'Potential hydrogen sulphide exposure during slickline well intervention on sour wells. Life-threatening at high concentration. Personal monitors and SCBA staged.',
   'Process', 'Galeota Marine Base — Wellhead platform A',
   4, 5, 2, 5, 'critical', 'monitoring',
   '2026-09-05 00:00:00+00', '2026-05-06 07:30:00+00'),

  (h8, 'HAZ-2026-0008',
   'Fall from scaffold during tank inspection',
   'Work-at-height fall risk during external tank shell inspection from mobile scaffold. Guardrails and harness anchor points specified.',
   'Safety', 'La Brea Yard — Tank T-201',
   2, 3, NULL, NULL, 'medium', 'registered',
   '2026-10-22 00:00:00+00', '2026-05-29 15:40:00+00')

  ON CONFLICT (ref) DO NOTHING;

  -- ── Risk assessments ─────────────────────────────────────────────────────────

  INSERT INTO public.hse_risk_assessments (
    id, ref, assessment_type, title, description, location_text, status,
    initial_score, residual_score, risk_level, review_cycle, review_due_at, created_at
  ) VALUES

  (r1, 'RA-2026-0001', 'chemical',
   'Chlorine handling & cylinder changeover',
   'Formal assessment of chlorine cylinder storage, changeover and emergency response at the water treatment skid.',
   'Point Lisas Plant — Water treatment skid', 'active',
   16, 6, 'high', 'annual', '2026-09-15 00:00:00+00', '2026-01-20 09:30:00+00'),

  (r2, 'RA-2026-0002', 'task',
   'Conveyor CV-04 maintenance & belt tracking',
   'Task-based assessment for guarding, isolation and belt-tracking work on conveyor CV-04.',
   'La Brea Yard — Conveyor CV-04', 'under_review',
   20, 12, 'critical', 'biannual', '2026-08-01 00:00:00+00', '2026-02-10 10:00:00+00'),

  (r3, 'RA-2026-0003', 'area',
   'Tank farm bunding & overfill protection',
   'Area assessment of secondary containment, overfill protection and access for the main tank farm.',
   'Point Lisas Plant — Tank farm', 'submitted',
   15, NULL, 'high', 'annual', '2026-09-01 00:00:00+00', '2026-03-18 14:00:00+00'),

  (r4, 'RA-2026-0004', 'equipment',
   'Mobile crane lifting operations',
   'Equipment assessment for mobile crane set-up, ground bearing and lift planning on the marine base.',
   'Galeota Marine Base — Laydown yard', 'active',
   12, 4, 'high', 'annual', '2026-05-25 00:00:00+00', '2026-04-02 08:15:00+00'),

  (r5, 'RA-2026-0005', 'permit_linked',
   'Confined space entry — ballast tank V-112',
   'Permit-linked assessment for entry, atmospheric monitoring and rescue provision for ballast tank V-112.',
   'Galeota Marine Base — Ballast tank V-112', 'draft',
   20, NULL, 'critical', 'on_change', NULL, '2026-05-19 11:45:00+00')

  ON CONFLICT (ref) DO NOTHING;

  -- ── Assessment ↔ hazard links ────────────────────────────────────────────────

  INSERT INTO public.hse_risk_assessment_hazards (
    assessment_id, hazard_id, hazard_description, category,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity, notes
  ) VALUES
  (r1, h1, 'Chlorine gas release during cylinder changeover', 'Chemical', 4, 4, 2, 3, 'Residual after detection + forced ventilation + SCBA.'),
  (r2, h2, 'Entanglement at CV-04 nip point',                'Mechanical', 4, 5, 3, 4, 'Residual pending fixed guard install.'),
  (r4, NULL, 'Crane overturn from poor ground bearing',     'Mechanical', 3, 4, 1, 4, 'Residual after ground assessment + outrigger mats.')
  ON CONFLICT DO NOTHING;

  -- ── JSA library ──────────────────────────────────────────────────────────────

  INSERT INTO public.hse_jsa (
    id, ref, title, description, location_text, status, risk_level, review_due_at, created_at
  ) VALUES

  (j1, 'JSA-2026-0001',
   'Replace aggregate conveyor belt CV-04',
   'Step-by-step job safety analysis for de-tensioning, removing and replacing the CV-04 conveyor belt.',
   'La Brea Yard — Conveyor CV-04', 'active', 'high',
   '2026-08-15 00:00:00+00', '2026-02-12 09:00:00+00'),

  (j2, 'JSA-2026-0002',
   'Confined space tank cleaning — ballast tank V-112',
   'JSA for entry, sludge removal and cleaning of ballast tank V-112 under confined-space permit.',
   'Galeota Marine Base — Ballast tank V-112', 'hse_review', 'critical',
   '2026-07-20 00:00:00+00', '2026-03-22 10:30:00+00'),

  (j3, 'JSA-2026-0003',
   'Hot work — welding repair on pipe rack',
   'JSA for hot-work welding repairs on the elevated pipe rack including fire watch and gas testing.',
   'Point Lisas Plant — Pipe rack 3', 'active', 'high',
   '2026-05-30 00:00:00+00', '2026-04-08 13:00:00+00'),

  (j4, 'JSA-2026-0004',
   'Working at height — roof-edge AC maintenance',
   'JSA for maintenance of roof-mounted AC plant within 2m of an unguarded roof edge.',
   'Port of Spain Office — Roof level', 'submitted', 'medium',
   '2026-09-10 00:00:00+00', '2026-04-26 08:30:00+00'),

  (j5, 'JSA-2026-0005',
   'Chemical drum transfer & decanting',
   'JSA for transferring and decanting solvents from 200L drums to day tanks.',
   'Galeota Marine Base — Fabrication shop', 'draft', 'medium',
   NULL, '2026-05-24 15:00:00+00')

  ON CONFLICT (ref) DO NOTHING;

  -- ── JSA steps ────────────────────────────────────────────────────────────────

  INSERT INTO public.hse_jsa_steps (
    jsa_id, step_number, task_step, hazard_description,
    initial_likelihood, initial_severity, residual_likelihood, residual_severity, controls_summary
  ) VALUES
  (j1, 1, 'Isolate and lock out conveyor drive',       'Unexpected start-up / entanglement', 4, 5, 1, 5, 'LOTO applied; verified zero-energy; key control.'),
  (j1, 2, 'De-tension and remove old belt',            'Stored energy release; manual handling', 3, 4, 2, 3, 'Controlled de-tensioning; mechanical aids; gloves.'),
  (j1, 3, 'Fit and track new belt',                    'Nip point / pinch injury', 4, 4, 2, 3, 'Guards reinstated for tracking; jog mode only.'),
  (j1, 4, 'Function test and return to service',       'Premature energisation', 3, 4, 1, 4, 'Permit sign-off; area clear confirmation.'),

  (j2, 1, 'Atmospheric gas test of tank',              'Oxygen deficiency / toxic atmosphere', 4, 5, 1, 5, 'Continuous monitoring; ventilation; entry permit.'),
  (j2, 2, 'Establish entry, attendant and rescue',     'Entrapment / no rescue', 4, 5, 1, 5, 'Trained attendant; rescue plan; tripod/winch staged.'),
  (j2, 3, 'Remove sludge and clean shell',             'Slips; chemical contact', 3, 4, 2, 3, 'Non-slip footing; chemical PPE; lighting.'),
  (j2, 4, 'Continuous atmospheric monitoring',         'Atmosphere change during work', 4, 5, 2, 4, 'Personal monitors; stop-work on alarm.'),
  (j2, 5, 'Exit, account for personnel, close permit', 'Miscount of entrants', 3, 4, 1, 4, 'Entry log reconciliation; permit close-out.'),

  (j3, 1, 'Gas test and issue hot-work permit',        'Flammable atmosphere', 3, 5, 1, 5, 'Gas test pre-task and periodic; permit issued.'),
  (j3, 2, 'Set up fire watch and extinguishers',       'Fire spread / no suppression', 3, 4, 1, 4, 'Dedicated fire watch; extinguishers staged.'),
  (j3, 3, 'Perform welding repair',                    'Burns; UV; fume', 3, 4, 2, 3, 'Welding PPE; screens; local exhaust ventilation.'),
  (j3, 4, 'Post-work fire watch and inspection',       'Smouldering ignition', 3, 4, 1, 4, '30-min post-work fire watch; area inspection.'),

  (j4, 1, 'Erect edge protection / anchor harness',    'Fall from height', 4, 5, 1, 5, 'Guardrail or harness to certified anchor; permit.'),
  (j4, 2, 'Perform AC plant maintenance',              'Slip; electrical', 3, 3, 1, 3, 'Electrical isolation; non-slip footwear.'),
  (j4, 3, 'Remove access and reinstate area',          'Trip hazards left behind', 2, 3, 1, 2, 'Housekeeping; tool tally; barricade removal.')

  ON CONFLICT DO NOTHING;

  -- ── Controls (source_type / source_id keyed by ref) ──────────────────────────

  INSERT INTO public.hse_controls (
    source_type, source_id, hazard_id, description, control_type, status, effectiveness, due_at
  ) VALUES
  ('hazard', 'HAZ-2026-0001', h1, 'Fixed chlorine detection with audible/visual alarm', 'engineering',   'implemented', 'effective',           NULL),
  ('hazard', 'HAZ-2026-0001', h1, 'Forced ventilation interlock on cylinder room',       'engineering',   'implemented', 'effective',           NULL),
  ('hazard', 'HAZ-2026-0001', h1, 'SCBA staged at room entry; quarterly drill',          'ppe',           'verified',    'effective',           NULL),
  ('hazard', 'HAZ-2026-0002', h2, 'Install fixed mesh guard at CV-04 tail drum',         'engineering',   'planned',     NULL,                  '2026-07-01 00:00:00+00'),
  ('hazard', 'HAZ-2026-0002', h2, 'Interim LOTO before any belt-tracking work',          'administrative','implemented', 'partially_effective', NULL),
  ('hazard', 'HAZ-2026-0003', h3, 'Replace dead-front cover on MCC; arc-flash labelling','engineering',   'planned',     NULL,                  '2026-07-15 00:00:00+00'),
  ('hazard', 'HAZ-2026-0005', h5, 'Provide drum dolly and powered upender',              'engineering',   'implemented', 'effective',           NULL),
  ('hazard', 'HAZ-2026-0005', h5, 'Manual handling training for store crew',             'administrative','verified',    'effective',           NULL),
  ('hazard', 'HAZ-2026-0007', h7, 'Personal H2S monitors with stop-work alarm set',      'administrative','implemented', 'effective',           NULL),
  ('hazard', 'HAZ-2026-0007', h7, 'SCBA and escape sets staged at wellhead',             'ppe',           'verified',    'effective',           NULL),
  ('assessment', 'RA-2026-0004', NULL, 'Ground bearing assessment before crane set-up',  'administrative','implemented', 'effective',           NULL),
  ('assessment', 'RA-2026-0004', NULL, 'Outrigger mats and exclusion zone',              'engineering',   'implemented', 'effective',           NULL),
  ('jsa', 'JSA-2026-0002', NULL, 'Continuous atmospheric monitoring during entry',       'administrative','implemented', 'effective',           NULL),
  ('jsa', 'JSA-2026-0003', NULL, 'Dedicated fire watch with 30-min post-work hold',      'administrative','implemented', 'effective',           NULL)
  ON CONFLICT DO NOTHING;

  -- ── PPE requirements ─────────────────────────────────────────────────────────

  INSERT INTO public.hse_ppe_requirements (source_type, source_id, ppe_item, required, notes) VALUES
  ('jsa', 'JSA-2026-0002', 'Full-face respirator / SCBA', true, 'Confined space atmospheric protection.'),
  ('jsa', 'JSA-2026-0002', 'Chemical-resistant coveralls', true, 'Sludge / chemical contact.'),
  ('jsa', 'JSA-2026-0002', 'Confined space harness', true, 'For tripod/winch rescue.'),
  ('jsa', 'JSA-2026-0003', 'Welding helmet (shade 10+)', true, 'UV / arc protection.'),
  ('jsa', 'JSA-2026-0003', 'Flame-resistant coveralls', true, 'Hot-work protection.'),
  ('jsa', 'JSA-2026-0001', 'Cut-resistant gloves (Level D)', true, 'Belt handling.'),
  ('hazard', 'HAZ-2026-0007', 'H2S personal monitor', true, 'Worn at all times on platform.')
  ON CONFLICT DO NOTHING;

  -- ── Training links ───────────────────────────────────────────────────────────

  INSERT INTO public.hse_training_links (
    source_type, source_id, requirement_description, certification_required, competency_verification, notes
  ) VALUES
  ('jsa', 'JSA-2026-0002', 'Confined Space Entry & Rescue',  true,  true,  'Refresher within 24 months.'),
  ('jsa', 'JSA-2026-0002', 'Atmospheric Gas Testing',        true,  true,  'Authorised gas tester only.'),
  ('jsa', 'JSA-2026-0003', 'Hot Work / Fire Watch',          true,  false, 'Permit issuer and fire watch.'),
  ('jsa', 'JSA-2026-0001', 'LOTO — Authorised Person',       true,  true,  'Machine-specific isolation.'),
  ('hazard', 'HAZ-2026-0007', 'H2S Awareness & Escape',      true,  true,  'Sour-service certification.')
  ON CONFLICT DO NOTHING;

END $$;

-- ── Advance reference counters past the seeded refs ──────────────────────────
-- Literal refs above are for year 2026; advance the 2026 counters so generated
-- refs continue from HAZ-2026-0009 / RA-2026-0006 / JSA-2026-0006.

INSERT INTO public.reference_counters (prefix, year, next_number)
VALUES
  ('HAZ', 2026, 9),
  ('RA',  2026, 6),
  ('JSA', 2026, 6)
ON CONFLICT (prefix, year) DO UPDATE
  SET next_number = GREATEST(reference_counters.next_number, EXCLUDED.next_number);
