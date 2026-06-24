-- ============================================================================
-- Training / Competency demo seed — run MANUALLY in Supabase (SQL editor) AFTER
-- the Training migrations (20260701200000 + 20260701200001) and
-- NOTIFY pgrst, 'reload schema';
--
-- Populates hse_training_competencies (+ courses), hse_training_requirements
-- (role → competency rules), hse_worker_certificates across every status
-- (current / due_soon / expired / pending_verification), a few
-- hse_certificate_evidence + hse_certificate_verifications rows, and a handful
-- of hse_training_assignments — so the Training page renders fully: the 4
-- StatsCards, the spark row, the Competency Matrix (real cells per worker role),
-- the Certifications register, the navy signals rail, and the detail drawers.
--
-- Workers are picked dynamically from the first active non-superadmin app_users
-- (ranked by full_name) so this runs against whatever users exist. The seeded
-- role requirements target the coarse roles ('employee','manager','admin'); a
-- worker only gets matrix cells for competencies required by THEIR role.
--
-- Idempotent: fixed ids + on conflict do nothing. Safe to re-run.
-- Timing is relative to now() so "due soon" / "expired" stay meaningful.
-- ============================================================================

begin;

-- ── Competencies ──────────────────────────────────────────────────────────────
insert into public.hse_training_competencies
  (id, name, code, category, description, default_validity_months, default_renewal_window_days, requires_verification, requires_evidence, is_active, created_at)
values
  ('a1000000-0000-4000-8000-000000000001'::uuid,'Working at Heights','WAH','Safety','Authorised to work at height with fall protection.',24,90,true,true,true, now()-interval '60 day'),
  ('a1000000-0000-4000-8000-000000000002'::uuid,'Confined Space Entry','CSE','Safety','Authorised confined-space entrant / attendant.',12,60,true,true,true, now()-interval '60 day'),
  ('a1000000-0000-4000-8000-000000000003'::uuid,'First Aid','FA','Medical','Certified workplace first aider.',36,90,true,true,true, now()-interval '60 day'),
  ('a1000000-0000-4000-8000-000000000004'::uuid,'Fire Warden','FW','Emergency','Designated fire warden / marshal.',24,90,true,false,true, now()-interval '60 day'),
  ('a1000000-0000-4000-8000-000000000005'::uuid,'Manual Handling','MH','Safety','Safe manual-handling techniques.',36,120,false,false,true, now()-interval '60 day')
on conflict (id) do nothing;

-- ── Courses ───────────────────────────────────────────────────────────────────
insert into public.hse_training_courses
  (id, competency_id, name, provider, course_code, validity_months, is_internal, is_active, created_at)
values
  ('a2000000-0000-4000-8000-000000000001'::uuid,'a1000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-L1',24,false,true, now()-interval '55 day'),
  ('a2000000-0000-4000-8000-000000000002'::uuid,'a1000000-0000-4000-8000-000000000002'::uuid,'Confined Space Entry & Rescue','SafeWork TT','CSE-ER',12,false,true, now()-interval '55 day'),
  ('a2000000-0000-4000-8000-000000000003'::uuid,'a1000000-0000-4000-8000-000000000003'::uuid,'Standard First Aid + CPR/AED','Red Cross','FA-STD',36,false,true, now()-interval '55 day'),
  ('a2000000-0000-4000-8000-000000000004'::uuid,'a1000000-0000-4000-8000-000000000004'::uuid,'Fire Warden Training','SafeWork TT','FW-01',24,false,true, now()-interval '55 day'),
  ('a2000000-0000-4000-8000-000000000005'::uuid,'a1000000-0000-4000-8000-000000000005'::uuid,'Manual Handling (internal)',null,'MH-INT',36,true,true, now()-interval '55 day')
on conflict (id) do nothing;

-- ── Role requirements (role_name → competency) ────────────────────────────────
insert into public.hse_training_requirements
  (id, role_name, competency_id, requirement_level, mandatory_before_work, is_active, created_at)
values
  -- employee: the four field competencies
  ('a3000000-0000-4000-8000-000000000001'::uuid,'employee','a1000000-0000-4000-8000-000000000001'::uuid,'required',     true, true, now()-interval '50 day'),
  ('a3000000-0000-4000-8000-000000000002'::uuid,'employee','a1000000-0000-4000-8000-000000000002'::uuid,'required',     true, true, now()-interval '50 day'),
  ('a3000000-0000-4000-8000-000000000003'::uuid,'employee','a1000000-0000-4000-8000-000000000003'::uuid,'recommended',  false,true, now()-interval '50 day'),
  ('a3000000-0000-4000-8000-000000000004'::uuid,'employee','a1000000-0000-4000-8000-000000000005'::uuid,'required',     true, true, now()-interval '50 day'),
  -- manager: first aid + fire warden
  ('a3000000-0000-4000-8000-000000000005'::uuid,'manager', 'a1000000-0000-4000-8000-000000000003'::uuid,'required',     true, true, now()-interval '50 day'),
  ('a3000000-0000-4000-8000-000000000006'::uuid,'manager', 'a1000000-0000-4000-8000-000000000004'::uuid,'required',     true, true, now()-interval '50 day'),
  -- admin: fire warden
  ('a3000000-0000-4000-8000-000000000007'::uuid,'admin',   'a1000000-0000-4000-8000-000000000004'::uuid,'recommended',  false,true, now()-interval '50 day')
on conflict (id) do nothing;

-- ── Worker certificates (joined to real workers by rank) ───────────────────────
-- v(rn) selects the rn-th active non-superadmin worker (by full_name).
with w as (
  select id, full_name, username, role,
         row_number() over (order by full_name) as rn
  from public.app_users
  where status = 'active' and role <> 'superadmin'
),
verifier as (
  select id from public.app_users
  where status = 'active' and role in ('admin','manager','superadmin')
  order by created_at limit 1
)
insert into public.hse_worker_certificates
  (id, certificate_no, worker_id, worker_name, competency_id, course_id, course_name, provider,
   certificate_number, issued_at, expires_at, status, verification_required,
   verified_by, verified_at, created_by, created_at)
select
  v.id, v.cno, w.id, coalesce(w.full_name, w.username), v.comp, v.course, v.cname, v.provider,
  v.certnum, v.issued, v.expires, v.status, true,
  case when v.verified then (select id from verifier) else null end,
  case when v.verified then now() - interval '20 day' else null end,
  (select id from verifier), now() - interval '30 day'
from (values
  -- Worker 1 — mixed: heights ok · confined-space due · first-aid pending
  ('b0000000-0000-4000-8000-000000000001'::uuid,'CERT-9001',1,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-0001', (now()-interval '300 day')::date, (now()+interval '400 day')::date,'current',  true),
  ('b0000000-0000-4000-8000-000000000002'::uuid,'CERT-9002',1,'a1000000-0000-4000-8000-000000000002'::uuid,'a2000000-0000-4000-8000-000000000002'::uuid,'Confined Space Entry & Rescue','SafeWork TT','CSE-0001', (now()-interval '320 day')::date, (now()+interval '40 day')::date,'due_soon', true),
  ('b0000000-0000-4000-8000-000000000003'::uuid,'CERT-9003',1,'a1000000-0000-4000-8000-000000000003'::uuid,'a2000000-0000-4000-8000-000000000003'::uuid,'Standard First Aid + CPR/AED','Red Cross','FA-0001', (now()-interval '10 day')::date, (now()+interval '700 day')::date,'pending_verification', false),
  -- Worker 2 — fully compliant employee
  ('b0000000-0000-4000-8000-000000000004'::uuid,'CERT-9004',2,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-0002', (now()-interval '200 day')::date, (now()+interval '500 day')::date,'current', true),
  ('b0000000-0000-4000-8000-000000000005'::uuid,'CERT-9005',2,'a1000000-0000-4000-8000-000000000002'::uuid,'a2000000-0000-4000-8000-000000000002'::uuid,'Confined Space Entry & Rescue','SafeWork TT','CSE-0002', (now()-interval '100 day')::date, (now()+interval '260 day')::date,'current', true),
  ('b0000000-0000-4000-8000-000000000006'::uuid,'CERT-9006',2,'a1000000-0000-4000-8000-000000000005'::uuid,'a2000000-0000-4000-8000-000000000005'::uuid,'Manual Handling (internal)',null,'MH-0002', (now()-interval '120 day')::date, (now()+interval '900 day')::date,'current', true),
  -- Worker 3 — expired heights (non-compliant)
  ('b0000000-0000-4000-8000-000000000007'::uuid,'CERT-9007',3,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-0003', (now()-interval '800 day')::date, (now()-interval '30 day')::date,'expired', true),
  ('b0000000-0000-4000-8000-000000000008'::uuid,'CERT-9008',3,'a1000000-0000-4000-8000-000000000002'::uuid,'a2000000-0000-4000-8000-000000000002'::uuid,'Confined Space Entry & Rescue','SafeWork TT','CSE-0003', (now()-interval '90 day')::date, (now()+interval '270 day')::date,'current', true),
  -- Worker 4 — manager: first aid + fire warden current
  ('b0000000-0000-4000-8000-000000000009'::uuid,'CERT-9009',4,'a1000000-0000-4000-8000-000000000003'::uuid,'a2000000-0000-4000-8000-000000000003'::uuid,'Standard First Aid + CPR/AED','Red Cross','FA-0004', (now()-interval '150 day')::date, (now()+interval '800 day')::date,'current', true),
  ('b0000000-0000-4000-8000-000000000010'::uuid,'CERT-9010',4,'a1000000-0000-4000-8000-000000000004'::uuid,'a2000000-0000-4000-8000-000000000004'::uuid,'Fire Warden Training','SafeWork TT','FW-0004', (now()-interval '60 day')::date, (now()+interval '50 day')::date,'due_soon', true),
  -- Worker 5 — heights + confined-space both renewing soon
  ('b0000000-0000-4000-8000-000000000011'::uuid,'CERT-9011',5,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-0005', (now()-interval '330 day')::date, (now()+interval '35 day')::date,'due_soon', true),
  ('b0000000-0000-4000-8000-000000000012'::uuid,'CERT-9012',5,'a1000000-0000-4000-8000-000000000005'::uuid,'a2000000-0000-4000-8000-000000000005'::uuid,'Manual Handling (internal)',null,'MH-0005', (now()-interval '40 day')::date, (now()+interval '1000 day')::date,'current', true),
  -- Worker 6 — heights pending verification
  ('b0000000-0000-4000-8000-000000000013'::uuid,'CERT-9013',6,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Working at Heights L1','SafeWork TT','WAH-0006', (now()-interval '5 day')::date, (now()+interval '720 day')::date,'pending_verification', false)
) as v(id, cno, rn, comp, course, cname, provider, certnum, issued, expires, status, verified)
join w on w.rn = v.rn
on conflict (certificate_no) do nothing;

-- ── Evidence (on a couple of certs) ───────────────────────────────────────────
insert into public.hse_certificate_evidence
  (id, certificate_id, file_name, file_path, file_type, evidence_type, uploaded_at)
values
  ('b1000000-0000-4000-8000-000000000001'::uuid,'b0000000-0000-4000-8000-000000000004'::uuid,'wah-l1-certificate.pdf','hse-attachments/training/seed/wah-l1-certificate.pdf','application/pdf','certificate', now()-interval '25 day'),
  ('b1000000-0000-4000-8000-000000000002'::uuid,'b0000000-0000-4000-8000-000000000009'::uuid,'first-aid-card.jpg','hse-attachments/training/seed/first-aid-card.jpg','image/jpeg','training_card', now()-interval '22 day'),
  ('b1000000-0000-4000-8000-000000000003'::uuid,'b0000000-0000-4000-8000-000000000013'::uuid,'wah-provider-confirmation.pdf','hse-attachments/training/seed/wah-provider-confirmation.pdf','application/pdf','provider_confirmation', now()-interval '4 day')
on conflict (id) do nothing;

-- ── Verifications (approved decisions on verified certs) ───────────────────────
insert into public.hse_certificate_verifications
  (id, certificate_id, decision, comments, verified_by, verified_at)
select v.id, v.cert, 'approved', v.comment,
  (select id from public.app_users where status='active' and role in ('admin','manager','superadmin') order by created_at limit 1),
  now() - interval '20 day'
from (values
  ('b2000000-0000-4000-8000-000000000001'::uuid,'b0000000-0000-4000-8000-000000000004'::uuid,'Certificate and provider record checked — approved.'),
  ('b2000000-0000-4000-8000-000000000002'::uuid,'b0000000-0000-4000-8000-000000000009'::uuid,'First-aid card verified against Red Cross registry.')
) as v(id, cert, comment)
on conflict (id) do nothing;

-- ── Training assignments (close the gaps) ─────────────────────────────────────
with w as (
  select id, row_number() over (order by full_name) as rn
  from public.app_users
  where status = 'active' and role <> 'superadmin'
),
assigner as (
  select id from public.app_users
  where status = 'active' and role in ('admin','manager','superadmin')
  order by created_at limit 1
)
insert into public.hse_training_assignments
  (id, assignment_no, worker_id, competency_id, course_id, reason, priority, provider, due_at, status, assigned_by, assigned_at)
select
  v.id, v.ano, w.id, v.comp, v.course, v.reason, v.prio, v.provider, v.due, v.status,
  (select id from assigner), now() - interval '7 day'
from (values
  ('b3000000-0000-4000-8000-000000000001'::uuid,'TRN-9001',3,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Renew expired Working at Heights certificate','critical','SafeWork TT', now()+interval '7 day','assigned'),
  ('b3000000-0000-4000-8000-000000000002'::uuid,'TRN-9002',1,'a1000000-0000-4000-8000-000000000005'::uuid,'a2000000-0000-4000-8000-000000000005'::uuid,'Manual handling not yet certified','high',null, now()+interval '14 day','assigned'),
  ('b3000000-0000-4000-8000-000000000003'::uuid,'TRN-9003',6,'a1000000-0000-4000-8000-000000000002'::uuid,'a2000000-0000-4000-8000-000000000002'::uuid,'Schedule Confined Space induction','medium','SafeWork TT', now()+interval '30 day','scheduled'),
  ('b3000000-0000-4000-8000-000000000004'::uuid,'TRN-9004',5,'a1000000-0000-4000-8000-000000000001'::uuid,'a2000000-0000-4000-8000-000000000001'::uuid,'Heights refresher before expiry','medium','SafeWork TT', now()-interval '2 day','overdue')
) as v(id, ano, rn, comp, course, reason, prio, provider, due, status)
join w on w.rn = v.rn
on conflict (assignment_no) do nothing;

commit;
