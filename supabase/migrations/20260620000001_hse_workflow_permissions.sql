-- Phase 0B: Seed role_permissions for HSE module + platform workflow routes
-- Format: resource.action (CHECK constraint ^[a-z_]+\.[a-z_]+$ enforced in phase12-roles.sql)
-- ON CONFLICT DO NOTHING: safe to re-run; existing overrides are not clobbered.

-- ── HSE: Incidents ────────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.incidents.view'),
  ('superadmin', 'hse.incidents.manage'),
  ('admin',      'hse.incidents.view'),
  ('admin',      'hse.incidents.manage'),
  ('manager',    'hse.incidents.view'),
  ('manager',    'hse.incidents.manage'),
  ('employee',   'hse.incidents.view')
on conflict do nothing;

-- ── HSE: Risk & JSA ──────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.risk.view'),
  ('superadmin', 'hse.risk.manage'),
  ('admin',      'hse.risk.view'),
  ('admin',      'hse.risk.manage'),
  ('manager',    'hse.risk.view'),
  ('manager',    'hse.risk.manage'),
  ('employee',   'hse.risk.view')
on conflict do nothing;

-- ── HSE: Permits (PTW) ───────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.permits.view'),
  ('superadmin', 'hse.permits.manage'),
  ('admin',      'hse.permits.view'),
  ('admin',      'hse.permits.manage'),
  ('manager',    'hse.permits.view'),
  ('manager',    'hse.permits.manage'),
  ('employee',   'hse.permits.view')
on conflict do nothing;

-- ── HSE: Inspections ─────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.inspections.view'),
  ('superadmin', 'hse.inspections.manage'),
  ('admin',      'hse.inspections.view'),
  ('admin',      'hse.inspections.manage'),
  ('manager',    'hse.inspections.view'),
  ('manager',    'hse.inspections.manage'),
  ('employee',   'hse.inspections.view')
on conflict do nothing;

-- ── HSE: Training ────────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.training.view'),
  ('superadmin', 'hse.training.manage'),
  ('admin',      'hse.training.view'),
  ('admin',      'hse.training.manage'),
  ('manager',    'hse.training.view'),
  ('manager',    'hse.training.manage'),
  ('employee',   'hse.training.view')
on conflict do nothing;

-- ── HSE: Toolbox Talks ───────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.toolbox.view'),
  ('superadmin', 'hse.toolbox.manage'),
  ('admin',      'hse.toolbox.view'),
  ('admin',      'hse.toolbox.manage'),
  ('manager',    'hse.toolbox.view'),
  ('manager',    'hse.toolbox.manage'),
  ('employee',   'hse.toolbox.view')
on conflict do nothing;

-- ── HSE: Documents & SDS ─────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.documents.view'),
  ('superadmin', 'hse.documents.manage'),
  ('admin',      'hse.documents.view'),
  ('admin',      'hse.documents.manage'),
  ('manager',    'hse.documents.view'),
  ('manager',    'hse.documents.manage'),
  ('employee',   'hse.documents.view')
on conflict do nothing;

-- ── HSE: Contractors ─────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.contractors.view'),
  ('superadmin', 'hse.contractors.manage'),
  ('admin',      'hse.contractors.view'),
  ('admin',      'hse.contractors.manage'),
  ('manager',    'hse.contractors.view'),
  ('manager',    'hse.contractors.manage'),
  ('employee',   'hse.contractors.view')
on conflict do nothing;

-- ── HSE: Legal & Compliance ───────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.legal.view'),
  ('superadmin', 'hse.legal.manage'),
  ('admin',      'hse.legal.view'),
  ('admin',      'hse.legal.manage'),
  ('manager',    'hse.legal.view'),
  ('employee',   'hse.legal.view')
on conflict do nothing;

-- ── HSE: Emergency Response ───────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.emergency.view'),
  ('superadmin', 'hse.emergency.manage'),
  ('admin',      'hse.emergency.view'),
  ('admin',      'hse.emergency.manage'),
  ('manager',    'hse.emergency.view'),
  ('manager',    'hse.emergency.manage'),
  ('employee',   'hse.emergency.view')
on conflict do nothing;

-- ── HSE: Environmental ───────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.environmental.view'),
  ('superadmin', 'hse.environmental.manage'),
  ('admin',      'hse.environmental.view'),
  ('admin',      'hse.environmental.manage'),
  ('manager',    'hse.environmental.view'),
  ('manager',    'hse.environmental.manage'),
  ('employee',   'hse.environmental.view')
on conflict do nothing;

-- ── HSE: PPE ─────────────────────────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.ppe.view'),
  ('superadmin', 'hse.ppe.manage'),
  ('admin',      'hse.ppe.view'),
  ('admin',      'hse.ppe.manage'),
  ('manager',    'hse.ppe.view'),
  ('manager',    'hse.ppe.manage'),
  ('employee',   'hse.ppe.view')
on conflict do nothing;

-- ── HSE: Dashboard / Workflows ───────────────────────────────────────────────
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'hse.dashboard.view'),
  ('superadmin', 'hse.workflows.view'),
  ('superadmin', 'hse.workflows.manage'),
  ('admin',      'hse.dashboard.view'),
  ('admin',      'hse.workflows.view'),
  ('admin',      'hse.workflows.manage'),
  ('manager',    'hse.dashboard.view'),
  ('manager',    'hse.workflows.view'),
  ('manager',    'hse.workflows.manage'),
  ('employee',   'hse.dashboard.view'),
  ('employee',   'hse.workflows.view')
on conflict do nothing;

-- ── Platform: Workflow approval routes ───────────────────────────────────────
-- Any authenticated user can submit/view their own; approve requires manager+.
insert into public.role_permissions (role_name, permission) values
  ('superadmin', 'workflow.submit'),
  ('superadmin', 'workflow.approve'),
  ('superadmin', 'workflow.audit'),
  ('admin',      'workflow.submit'),
  ('admin',      'workflow.approve'),
  ('admin',      'workflow.audit'),
  ('manager',    'workflow.submit'),
  ('manager',    'workflow.approve'),
  ('manager',    'workflow.audit'),
  ('employee',   'workflow.submit')
on conflict do nothing;

-- ── module_permissions: HSE module visible to all roles ───────────────────────
-- This table drives the SuperAdmin console module toggle UI.
insert into public.module_permissions (module, role, enabled) values
  ('hse', 'superadmin', true),
  ('hse', 'admin',      true),
  ('hse', 'manager',    true),
  ('hse', 'employee',   true)
on conflict do nothing;
