-- HSE Risk/JSA reference libraries: standard hazards + standard controls.
-- Pick-from-library banks so assessors don't re-type common hazards/controls.
-- Reference data: authenticated read, service-role write. Idempotent seed.

-- ── hse_hazard_library ────────────────────────────────────────────────────────
create table if not exists public.hse_hazard_library (
  id                  uuid primary key default gen_random_uuid(),
  code                text not null unique,
  category            text not null,
  title               text not null,
  description         text not null default '',
  typical_consequence text not null default '',
  default_likelihood  int check (default_likelihood between 1 and 5),
  default_severity    int check (default_severity between 1 and 5),
  work_types          text[] not null default '{}',
  is_active           boolean not null default true,
  created_at          timestamptz not null default now()
);

alter table public.hse_hazard_library enable row level security;
create policy "authenticated read hse_hazard_library" on public.hse_hazard_library for select using (auth.role() = 'authenticated');
create policy "service write hse_hazard_library"      on public.hse_hazard_library for all    using (auth.role() = 'service_role');
create index if not exists hse_hazard_library_cat_idx on public.hse_hazard_library(category);

-- ── hse_control_library ───────────────────────────────────────────────────────
create table if not exists public.hse_control_library (
  id              uuid primary key default gen_random_uuid(),
  code            text not null unique,
  control_type    text not null
                      check (control_type in ('elimination','substitution','engineering','administrative','ppe','emergency_response')),
  title           text not null,
  description     text not null default '',
  hazard_category text,
  effectiveness   text check (effectiveness in ('high','medium','low')),
  is_active       boolean not null default true,
  created_at      timestamptz not null default now()
);

alter table public.hse_control_library enable row level security;
create policy "authenticated read hse_control_library" on public.hse_control_library for select using (auth.role() = 'authenticated');
create policy "service write hse_control_library"      on public.hse_control_library for all    using (auth.role() = 'service_role');
create index if not exists hse_control_library_type_idx on public.hse_control_library(control_type);

-- ── Seed: standard hazards (T&T HSE context) ──────────────────────────────────
insert into public.hse_hazard_library (code, category, title, description, typical_consequence, default_likelihood, default_severity, work_types) values
  ('HZ-CS-O2',   'Confined Space', 'Oxygen deficiency in confined space', 'Entry into tanks/vessels with insufficient oxygen', 'Asphyxiation — serious injury or fatality', 3, 5, array['confined_space','tank_cleaning']),
  ('HZ-CS-TOXIC','Confined Space', 'Toxic atmosphere (H2S) in confined space', 'Accumulation of toxic gas during entry', 'Poisoning — serious injury or fatality', 3, 5, array['confined_space','marine']),
  ('HZ-WAH-FALL','Working at Height', 'Fall from height', 'Work on scaffolds, roofs, platforms or ladders', 'Fractures, serious injury or fatality', 3, 5, array['height','scaffolding']),
  ('HZ-HW-FIRE', 'Hot Work', 'Fire or explosion from hot work', 'Welding/cutting near flammables without controls', 'Burns, fire, explosion', 2, 5, array['hot_work','welding']),
  ('HZ-CHEM-BURN','Chemical', 'Chemical splash / contact burn', 'Exposure to corrosive or hazardous chemicals', 'Burns, skin/eye damage', 3, 4, array['chemical','dosing']),
  ('HZ-ELEC-ARC','Electrical', 'Electric shock / arc flash', 'Contact with live electrical equipment', 'Shock, burns, fatality', 2, 5, array['electrical','maintenance']),
  ('HZ-LIFT-LOAD','Lifting Operations', 'Dropped or swinging load', 'Crane/hoist lifting near personnel', 'Struck-by, crushing injury', 3, 4, array['lifting','rigging']),
  ('HZ-MH-MSD',  'Ergonomic', 'Manual handling injury', 'Lifting/carrying heavy or awkward loads', 'Musculoskeletal injury, back strain', 4, 3, array['general','warehouse']),
  ('HZ-MEQ-STRUCK','Mechanical', 'Struck by mobile equipment', 'Forklifts/vehicles in shared work areas', 'Struck-by, crushing injury', 3, 4, array['logistics','yard']),
  ('HZ-SLIP',    'Safety', 'Slip, trip or fall on level', 'Wet floors, trailing leads, poor housekeeping', 'Sprains, fractures', 4, 2, array['general']),
  ('HZ-NOISE',   'Health', 'Noise exposure', 'Prolonged exposure to high noise levels', 'Hearing loss over time', 3, 3, array['plant','workshop']),
  ('HZ-SPILL-ENV','Environmental', 'Spill or release to environment', 'Loss of containment of oil/chemicals', 'Environmental harm, regulatory breach', 3, 4, array['marine','transfer'])
on conflict (code) do nothing;

-- ── Seed: standard controls (hierarchy of control) ────────────────────────────
insert into public.hse_control_library (code, control_type, title, description, hazard_category, effectiveness) values
  ('CT-ELIM-REMOTE',  'elimination',   'Eliminate entry — perform task remotely', 'Redesign task so confined entry is not required', 'Confined Space', 'high'),
  ('CT-SUB-LESSHAZ',  'substitution',  'Substitute a less hazardous chemical', 'Replace product with a safer alternative', 'Chemical', 'high'),
  ('CT-ENG-VENT',     'engineering',   'Forced ventilation before and during entry', 'Mechanical ventilation to maintain safe atmosphere', 'Confined Space', 'high'),
  ('CT-ENG-GUARD',    'engineering',   'Machine guarding / interlocks', 'Fixed or interlocked guards on moving parts', 'Mechanical', 'high'),
  ('CT-ENG-LEV',      'engineering',   'Local exhaust ventilation (LEV)', 'Capture contaminants at source', 'Health', 'high'),
  ('CT-ENG-ANCHOR',   'engineering',   'Certified fall-arrest anchor points', 'Engineered anchor for harness attachment', 'Working at Height', 'high'),
  ('CT-ADM-PTW',      'administrative','Permit to work', 'Authorised permit with isolations and checks', null, 'medium'),
  ('CT-ADM-GASTEST',  'administrative','Gas testing before and during work', 'Atmospheric monitoring by a competent person', 'Confined Space', 'medium'),
  ('CT-ADM-LOTO',     'administrative','Lock-out / tag-out isolation', 'Isolate and lock energy sources', 'Electrical', 'high'),
  ('CT-ADM-TBT',      'administrative','Toolbox talk & briefing', 'Pre-task briefing of hazards and controls', null, 'low'),
  ('CT-ADM-BARRIER',  'administrative','Barricades and signage', 'Demarcate and control access to the work area', 'Safety', 'medium'),
  ('CT-ADM-SWMS',     'administrative','Safe work method statement', 'Documented step-by-step safe procedure', null, 'medium'),
  ('CT-PPE-SCBA',     'ppe',           'Supplied-air / SCBA', 'Breathing apparatus for hazardous atmospheres', 'Confined Space', 'medium'),
  ('CT-PPE-HARNESS',  'ppe',           'Full-body harness and lanyard', 'Personal fall-protection equipment', 'Working at Height', 'medium'),
  ('CT-PPE-CHEM',     'ppe',           'Chemical gloves, goggles, apron', 'Chemical-resistant PPE for handling', 'Chemical', 'medium'),
  ('CT-PPE-HEARING',  'ppe',           'Hearing protection', 'Ear plugs / muffs in high-noise areas', 'Health', 'medium'),
  ('CT-ER-RESCUE',    'emergency_response','Confined space rescue plan & standby', 'Rescue team and equipment on standby', 'Confined Space', 'medium'),
  ('CT-ER-SPILLKIT',  'emergency_response','Spill kit and containment', 'Spill response equipment available on site', 'Environmental', 'medium')
on conflict (code) do nothing;
