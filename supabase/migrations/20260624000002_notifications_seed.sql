-- Demo/seed notifications so the Notification Center has representative content.
--
-- Idempotent: every seed row carries a 'SEED-' source_id, so we clear prior
-- seed rows first and re-insert. Targets active managers/admins/superadmins
-- (resolved at run time from app_users — no hardcoded TEXT ids), covering the
-- full spread the UI distinguishes: unread / read, action-required pending /
-- completed, info → critical severity, every HSE module, archived, and a range
-- of timestamps for the date-group headers (Today / Yesterday / Earlier / Older).
--
-- Safe to drop from a production deploy — it only inserts rows tagged 'SEED-%'.

delete from public.notifications where source_id like 'SEED-%';

insert into public.notifications
  (user_id, type, title, body, module, severity, source_type, source_id, action_route,
   is_read, action_required, action_status, due_at, created_at, archived_at)
select
  u.id, s.type, s.title, s.body, s.module, s.severity, s.source_type, s.source_id, s.action_route,
  s.is_read, s.action_required, s.action_status, s.due_at, s.created_at, s.archived_at
from public.app_users u
cross join (values
  -- Today ───────────────────────────────────────────────────────────────────
  ('hse.incident.critical', 'Critical incident reported',
   'CRITICAL — Scaffold collapse near Bay 3. Area cordoned, no injuries reported.',
   'hse.incidents', 'critical', 'incident', 'SEED-INC-2026-0007', 'hse/incidents',
   false, false, 'none', null::timestamptz, now() - interval '25 minutes', null::timestamptz),

  ('hse.capa.assigned', 'CAPA assigned to you',
   'Replace damaged guardrail on Level 2 walkway. Verify before the next shift.',
   'hse.capa', 'info', 'capa', 'SEED-CAPA-2026-0031', 'hse/incidents',
   false, true, 'pending', now() + interval '3 days', now() - interval '2 hours', null::timestamptz),

  ('hse.ptw.expired', 'Permit expired',
   'Hot-work permit PTW-000421 expired 40 minutes ago — work must not continue.',
   'hse.ptw', 'critical', 'permit', 'SEED-PTW-000421', 'hse/permits',
   false, true, 'pending', now() - interval '40 minutes', now() - interval '5 hours', null::timestamptz),

  ('hse.investigation.assigned', 'Investigation assigned to you',
   'You have been assigned to lead the investigation for INC-2026-0007.',
   'hse.investigations', 'info', 'investigation', 'SEED-INV-2026-0007', 'hse/investigations',
   false, true, 'pending', now() + interval '5 days', now() - interval '3 hours', null::timestamptz),

  -- Yesterday ─────────────────────────────────────────────────────────────────
  ('hse.risk.approval_required', 'Risk assessment needs your approval',
   'RA-2026-0044 (Working at Height — Tank Farm) is awaiting your decision.',
   'hse.risk', 'warning', 'assessment', 'SEED-RA-2026-0044', 'hse/risk-jsa',
   false, true, 'pending', now() + interval '1 day', now() - interval '1 day 3 hours', null::timestamptz),

  ('hse.jsa.approved', 'JSA approved',
   'JSA-2026-0021 (Confined Space Entry) was approved and is ready to activate.',
   'hse.risk', 'success', 'jsa', 'SEED-JSA-2026-0021', 'hse/risk-jsa',
   true, false, 'none', null::timestamptz, now() - interval '1 day 7 hours', null::timestamptz),

  -- Earlier this week ─────────────────────────────────────────────────────────
  ('communications.broadcast', 'Site-wide safety stand-down',
   'Mandatory toolbox talk Friday 07:00 at the main muster point. Attendance recorded.',
   'communications', 'info', 'broadcast', 'SEED-BC-2026-0007', null,
   false, false, 'none', null::timestamptz, now() - interval '3 days', null::timestamptz),

  ('hse.capa.assigned', 'CAPA completed',
   'Fire-extinguisher inspection (CAPA-2026-0019) was completed and verified.',
   'hse.capa', 'success', 'capa', 'SEED-CAPA-2026-0019', 'hse/incidents',
   true, true, 'completed', null::timestamptz, now() - interval '4 days', null::timestamptz),

  -- Older ─────────────────────────────────────────────────────────────────────
  ('hse.incident.closed', 'Incident closed',
   'INC-2026-0003 (Minor chemical splash) was investigated and closed.',
   'hse.incidents', 'success', 'incident', 'SEED-INC-2026-0003', 'hse/incidents',
   true, false, 'none', null::timestamptz, now() - interval '11 days', null::timestamptz),

  -- Archived (only visible under the Archived tab) ─────────────────────────────
  ('hse.capa.closed', 'CAPA closed',
   'Spill-kit restock (CAPA-2026-0012) was closed.',
   'hse.capa', 'info', 'capa', 'SEED-CAPA-2026-0012', 'hse/incidents',
   true, false, 'none', null::timestamptz, now() - interval '6 days', now() - interval '2 days')
) as s(type, title, body, module, severity, source_type, source_id, action_route,
       is_read, action_required, action_status, due_at, created_at, archived_at)
where u.status = 'active' and u.role in ('manager', 'admin', 'superadmin');
