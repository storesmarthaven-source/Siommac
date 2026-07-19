/**
 * scripts/e2e/suites/rbacConsole.mjs
 *
 * Live E2E for the Superadmin Console RBAC surface (Roles tab + full-page Create/Edit
 * Role wizard, Users override editor, Overview/audit) — the console redesigned in
 * commit f1b0b409. Hits the real routes over HTTP and asserts the §2 side-effects
 * (activity_logs audit rows) via the service-role client.
 *
 * Covers, per the Testing Standard:
 *   • Every endpoint the console uses — listRoles/getRolePermissions/createRole/
 *     updateRole/deleteRole/setRolePermission, listUsers/getUserPermissions/
 *     setUserPermission/clearUserPermission, getAuditLogs (incl. the new entity_id filter).
 *   • The role lifecycle + the per-user Inherit/Allow/Deny override model + effective source.
 *   • Response shape — the exact fields the frontend (superadminApi.ts) consumes.
 *   • Side-effects — every mutation writes its activity_logs audit row.
 *   • Access control — a real employee is denied every console route with 403.
 *   • Cleanup — restores the target's baseline override; removes created roles + this
 *     run's audit rows; deletes only synthetic actors it created.
 */

export const title = 'RBAC Console';

// A real, non-critical permission key — low risk, so a grant applies immediately and
// never routes through the maker-checker approval queue that critical keys use.
const PERM = 'hr.employees.view';
// Compliance data-access grants are critical and time-boxed. They route through
// maker-checker and are the only requests a designated compliance approver may review.
const CRIT_COMPLIANCE_READ = 'communications.compliance_read';
const CRIT_COMPLIANCE_EXPORT = 'communications.compliance_export';
// A non-compliance critical key for proving designated approvers cannot see or act
// on the general high-risk approval queue.
const CRIT_GENERAL = 'communications.admin';
const COMPLIANCE_APPROVER = 'communications.compliance_approve';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, mintStepUp, sb, TAG } = h;
  const { admin } = h.users;

  // ── Actors ──────────────────────────────────────────────────────────────────
  // Positive actor: a real superadmin (allow-all) so roles.manage / permissions.manage
  // / audit.view all pass. Falls back to the harness admin if the roster has none.
  const { data: sadmins } = await sb.from('app_users')
    .select('id, username, role, department_id').eq('status', 'active').eq('role', 'superadmin').limit(1);
  const sadmin = sadmins?.[0] ?? admin;

  // Override target: a real MANAGER — a configurable-role user that appears in the Users
  // matrix (listUsers excludes 'employee'/'superadmin'). Only a per-user override is
  // written on them and it is fully restored in cleanup; their identity is never mutated.
  const { actors: [tgt], createdIds: idsMgr } = await h.acquireActors('manager', 1);
  // Negative actor: a real EMPLOYEE — lacks every console gate.
  const { actors: [emp], createdIds: idsEmp } = await h.acquireActors('employee', 1);
  const createdActorIds = [...idsMgr, ...idsEmp];

  // A different superadmin (checker) with a step-up token — still valid for the full
  // permissions.manage approval scope. Synthetic so it is always distinct from `sadmin`.
  const checkerId  = `${TAG}_checker`;
  const checkerUsr = `${TAG.toLowerCase()}_checker`;
  await sb.from('app_users').insert({ id: checkerId, username: checkerUsr, role: 'superadmin', status: 'active', employment_type: 'employee', full_name: 'E2E Checker' });
  const checkerTok = mintStepUp({ id: checkerId, username: checkerUsr, role: 'superadmin' });
  // Designated non-superadmin compliance approver. The explicit permission grants
  // only approval-scope authority; it does not grant message read/export access.
  const approverId = `${TAG}_compliance_approver`;
  const approverUsr = `${TAG.toLowerCase()}_compliance_approver`;
  const approver = { id: approverId, username: approverUsr, role: 'employee', department_id: null };
  await sb.from('app_users').insert({ id: approverId, username: approverUsr, role: 'employee', status: 'active', employment_type: 'employee', full_name: 'E2E Compliance Approver' });
  const approverTok = mint(approver);
  const approverStepTok = mintStepUp(approver);
  const approvalIds = [];

  const T = { sadmin: mint(sadmin), emp: mint(emp) };

  const runStart = new Date().toISOString();
  const roleName = ('e2e_' + TAG.toLowerCase()).replace(/[^a-z0-9_]/g, '_'); // valid RoleNameSchema
  // A SECOND throwaway role for the critical-role-grant test. The maker-checker
  // test must NEVER target a real role (e.g. 'manager') — a mistaken cleanup could
  // delete a live grant. This temp role is created fresh and torn down with the rest.
  const roleNameCrit = roleName + '_c';
  const createdRoles = [];
  const createdTiers = [];   // managed role_categories created by this suite

  // Capture pre-test overrides so cleanup restores exact state for borrowed actors.
  const { body: baseBody } = await api('superadmin/getUserPermissions', T.sadmin, { userId: tgt.id });
  const baseRow = (baseBody?.permissions ?? []).find(p => p.permission === PERM);
  const prevComplianceRead = await h.readPermissionOverride(tgt.id, CRIT_COMPLIANCE_READ);
  const prevComplianceExport = await h.readPermissionOverride(tgt.id, CRIT_COMPLIANCE_EXPORT);
  const prevApproverGrant = await h.readPermissionOverride(approverId, COMPLIANCE_APPROVER);

  const validityWindow = () => ({
    validFrom: new Date(Date.now() - 60_000).toISOString(),
    validUntil: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
  });

  h.onCleanup(async () => {
    // Restore the manager's PERM override to its exact pre-test state.
    if (baseRow) {
      await sb.from('user_permissions').upsert(
        { user_id: tgt.id, permission: PERM, granted: baseRow.granted, set_by: 'e2e', set_at: new Date().toISOString() },
        { onConflict: 'user_id,permission' });
    } else {
      await sb.from('user_permissions').delete().eq('user_id', tgt.id).eq('permission', PERM);
    }
    // Remove any roles + role_permissions this suite created (idempotent if already deleted).
    if (createdRoles.length) {
      await sb.from('role_permissions').delete().in('role_name', createdRoles);
      await sb.from('roles').delete().in('name', createdRoles);
      await sb.from('activity_logs').delete().eq('entity', 'role').in('entity_id', createdRoles);
    }
    // Managed tiers created by this suite — AFTER roles (FK role_category → role_categories restricts).
    if (createdTiers.length) {
      await sb.from('role_categories').delete().in('key', createdTiers);
      await sb.from('activity_logs').delete().eq('entity', 'role_category').in('entity_id', createdTiers);
    }
    // Remove only THIS run's user-scoped permission audit rows for the manager.
    await sb.from('activity_logs').delete()
      .eq('entity', 'user').eq('entity_id', tgt.id)
      .in('action', ['permission_grant', 'permission_deny', 'permission_clear', 'permission_grant_requested'])
      .gte('created_at', runStart);
    // Maker-checker artifacts: pending/approved approval rows + any applied critical grants.
    if (approvalIds.length) await sb.from('permission_grant_approvals').delete().in('id', approvalIds);
    await sb.from('permission_grant_approvals').delete().eq('requested_by', sadmin.id).gte('created_at', runStart);
    await h.restorePermissionOverride(tgt.id, CRIT_COMPLIANCE_READ, prevComplianceRead);
    await h.restorePermissionOverride(tgt.id, CRIT_COMPLIANCE_EXPORT, prevComplianceExport);
    await h.restorePermissionOverride(approverId, COMPLIANCE_APPROVER, prevApproverGrant);
    // NOTE: role_permissions for created roles are removed via createdRoles above —
    // we deliberately do NOT touch any real role (e.g. 'manager') here.
    // Platform §2 rows emitted by the mutations (app_events + emitAppEvent audit_logs).
    const evEntityIds = [tgt.id, roleName, ...approvalIds];
    await sb.from('app_events').delete().eq('source_module', 'platform').gte('created_at', runStart).in('source_entity_id', evEntityIds);
    await sb.from('audit_logs').delete().gte('created_at', runStart).in('entity_id', evEntityIds);
    if (approvalIds.length) await sb.from('activity_logs').delete().gte('created_at', runStart).in('entity_id', approvalIds);
    // Synthetic actors (checker + any shortfall).
    await sb.from('app_users').delete().eq('id', checkerId);
    await sb.from('app_users').delete().eq('id', approverId);
    if (createdActorIds.length) await sb.from('app_users').delete().in('id', createdActorIds);
  });

  // ── helpers ───────────────────────────────────────────────────────────────
  const findRole = async (name) => {
    const r = await api('superadmin/listRoles', T.sadmin, {});
    return { r, role: (r.body?.roles ?? []).find(x => x.name === name) };
  };
  const auditHas = async (entity, entityId, action) => {
    const { data } = await sb.from('activity_logs').select('id')
      .eq('entity', entity).eq('entity_id', entityId).eq('action', action).gte('created_at', runStart).limit(1);
    return (data ?? []).length > 0;
  };

  // ── Roles: list · create · permissions · update · delete ────────────────────
  h.section('RBAC Console › Roles');

  await test('listRoles returns the RoleRow contract', async () => {
    const r = await api('superadmin/listRoles', T.sadmin, {});
    ok(r);
    expect(Array.isArray(r.body.roles) && r.body.roles.length > 0, 'roles array non-empty');
    const row = r.body.roles[0];
    for (const f of ['name', 'label', 'description', 'isSystem', 'protected', 'sortOrder', 'category', 'userCount'])
      expect(f in row, `RoleRow.${f} present`);
    expect(typeof row.userCount === 'number', 'userCount is numeric');
  });

  await test('createRole creates a custom role + writes role_create audit', async () => {
    const r = await api('superadmin/createRole', T.sadmin, { name: roleName, label: 'E2E RBAC Role', description: 'temp', category: 'staff' });
    ok(r); createdRoles.push(roleName);
    const { role } = await findRole(roleName);
    expect(!!role, 'role appears in listRoles');
    expect(role.isSystem === false && role.protected === false, 'non-system, non-protected');
    expect(role.userCount === 0, 'zero members');
    expect(await auditHas('role', roleName, 'role_create'), 'role_create audit row written');
  });

  await test('createRole with a duplicate name → 409', async () => {
    const r = await api('superadmin/createRole', T.sadmin, { name: roleName, label: 'dup', category: 'staff' });
    fails(r); expect(r.status === 409, `expected 409, got ${r.status}`);
  });

  await test('getRolePermissions on a fresh role is empty', async () => {
    const r = await api('superadmin/getRolePermissions', T.sadmin, { roleName });
    ok(r);
    expect(Array.isArray(r.body.permissions) && r.body.permissions.length === 0, 'empty default set');
  });

  await test('setRolePermission grant → role_permissions row + role_perm_grant audit', async () => {
    const r = await api('superadmin/setRolePermission', T.sadmin, { roleName, permission: PERM, granted: true });
    ok(r);
    const g = await api('superadmin/getRolePermissions', T.sadmin, { roleName });
    expect((g.body.permissions ?? []).includes(PERM), 'permission now in the role default set');
    const { data } = await sb.from('role_permissions').select('permission').eq('role_name', roleName).eq('permission', PERM);
    expect((data ?? []).length === 1, 'role_permissions row written');
    expect(await auditHas('role', roleName, 'role_perm_grant'), 'role_perm_grant audit');
  });

  await test('setRolePermission revoke → removed + role_perm_revoke audit', async () => {
    const r = await api('superadmin/setRolePermission', T.sadmin, { roleName, permission: PERM, granted: false });
    ok(r);
    const g = await api('superadmin/getRolePermissions', T.sadmin, { roleName });
    expect(!(g.body.permissions ?? []).includes(PERM), 'permission removed from the set');
    expect(await auditHas('role', roleName, 'role_perm_revoke'), 'role_perm_revoke audit');
  });

  await test('setRolePermission rejects an unknown permission key', async () => {
    const r = await api('superadmin/setRolePermission', T.sadmin, { roleName, permission: 'not.a.real.key', granted: true });
    fails(r);
  });

  await test('updateRole changes the label + writes role_update audit', async () => {
    const r = await api('superadmin/updateRole', T.sadmin, { roleName, label: 'E2E RBAC Role (edited)' });
    ok(r);
    const { role } = await findRole(roleName);
    expect(role && role.label === 'E2E RBAC Role (edited)', 'label was updated');
    expect(await auditHas('role', roleName, 'role_update'), 'role_update audit');
  });

  await test('deleteRole removes the custom role + writes role_delete audit', async () => {
    const r = await api('superadmin/deleteRole', T.sadmin, { roleName });
    ok(r);
    const { role } = await findRole(roleName);
    expect(!role, 'role no longer listed');
    expect(await auditHas('role', roleName, 'role_delete'), 'role_delete audit');
  });

  await test('deleteRole is blocked for a protected/system role', async () => {
    const r = await api('superadmin/deleteRole', T.sadmin, { roleName: 'employee' });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  // ── Role categories: managed tiers (list · create · rename · delete guards) ──
  h.section('RBAC Console › Role categories (tiers)');

  const tierLabel = `E2E Tier ${TAG}`;
  let tierKey = null;
  const tierRoleName = roleName + '_t';

  await test('listRoleCategories returns the tier contract + the built-ins', async () => {
    const r = await api('superadmin/listRoleCategories', T.sadmin, {});
    ok(r);
    expect(Array.isArray(r.body.categories) && r.body.categories.length >= 4, 'categories array (≥ 4 built-ins)');
    const row = r.body.categories[0];
    for (const f of ['key', 'label', 'sortOrder', 'isSystem', 'roleCount'])
      expect(f in row, `tier.${f} present`);
    const keys = r.body.categories.map(c => c.key);
    for (const k of ['administration', 'management', 'staff', 'self_service'])
      expect(keys.includes(k), `built-in tier "${k}" present`);
    const staff = r.body.categories.find(c => c.key === 'staff');
    expect(staff && staff.isSystem === true, 'built-in tier is isSystem');
  });

  await test('createRoleCategory creates a custom tier + role_category_create audit', async () => {
    const r = await api('superadmin/createRoleCategory', T.sadmin, { label: tierLabel });
    ok(r); expect(typeof r.body.key === 'string' && r.body.key.length > 0, 'returns a slug key');
    tierKey = r.body.key; createdTiers.push(tierKey);
    const lr = await api('superadmin/listRoleCategories', T.sadmin, {});
    const t = (lr.body.categories ?? []).find(c => c.key === tierKey);
    expect(t && t.label === tierLabel && t.isSystem === false && t.roleCount === 0, 'custom tier listed, non-system, empty');
    expect(await auditHas('role_category', tierKey, 'role_category_create'), 'role_category_create audit');
  });

  await test('updateRoleCategory renames a tier + role_category_update audit', async () => {
    const r = await api('superadmin/updateRoleCategory', T.sadmin, { key: tierKey, label: `${tierLabel} (edited)` });
    ok(r);
    const lr = await api('superadmin/listRoleCategories', T.sadmin, {});
    const t = (lr.body.categories ?? []).find(c => c.key === tierKey);
    expect(t && t.label === `${tierLabel} (edited)`, 'label updated');
    expect(await auditHas('role_category', tierKey, 'role_category_update'), 'role_category_update audit');
  });

  await test('deleteRoleCategory is blocked for a built-in tier', async () => {
    const r = await api('superadmin/deleteRoleCategory', T.sadmin, { key: 'staff' });
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
  });

  await test('deleteRoleCategory is blocked while a role uses the tier', async () => {
    const cr = await api('superadmin/createRole', T.sadmin, { name: tierRoleName, label: 'E2E Tier Role', category: tierKey });
    ok(cr); createdRoles.push(tierRoleName);
    const del = await api('superadmin/deleteRoleCategory', T.sadmin, { key: tierKey });
    fails(del); expect(del.status === 400, `expected 400 (in use), got ${del.status}`);
    // free the tier again so the next test can delete it
    ok(await api('superadmin/deleteRole', T.sadmin, { roleName: tierRoleName }));
  });

  await test('deleteRoleCategory removes an empty custom tier + role_category_delete audit', async () => {
    const r = await api('superadmin/deleteRoleCategory', T.sadmin, { key: tierKey });
    ok(r);
    const lr = await api('superadmin/listRoleCategories', T.sadmin, {});
    expect(!(lr.body.categories ?? []).some(c => c.key === tierKey), 'tier no longer listed');
    expect(await auditHas('role_category', tierKey, 'role_category_delete'), 'role_category_delete audit');
  });

  // ── Users: per-user override model (Inherit / Allow / Deny) ──────────────────
  h.section('RBAC Console › User overrides');

  await test('listUsers returns the ConsoleUser contract (configurable roles only)', async () => {
    const r = await api('superadmin/listUsers', T.sadmin, {});
    ok(r);
    expect(Array.isArray(r.body.users) && r.body.users.length > 0, 'users array non-empty');
    const row = r.body.users[0];
    for (const f of ['id', 'username', 'fullName', 'role', 'email', 'position', 'department', 'active', 'access', 'overrideCount', 'profileImage'])
      expect(f in row, `ConsoleUser.${f} present`);
    expect(typeof row.overrideCount === 'number', 'overrideCount numeric');
    expect(r.body.users.some(u => u.id === tgt.id), 'the manager appears in the accounts matrix');
    expect(!r.body.users.some(u => u.role === 'superadmin' || u.role === 'employee'), 'superadmin + employee excluded');
  });

  await test('setUserPermission Allow → user_permissions row + permission_grant audit', async () => {
    const r = await api('superadmin/setUserPermission', T.sadmin, { userId: tgt.id, permission: PERM, granted: true });
    ok(r);
    const g = await api('superadmin/getUserPermissions', T.sadmin, { userId: tgt.id });
    const row = (g.body.permissions ?? []).find(p => p.permission === PERM);
    expect(row && row.granted === true, 'Allow override present (granted=true)');
    expect(await auditHas('user', tgt.id, 'permission_grant'), 'permission_grant audit');
    // §2: an app_event was emitted for the override.
    const { data: ev } = await sb.from('app_events').select('id')
      .eq('source_module', 'platform').eq('source_entity_id', tgt.id)
      .eq('event_type', 'iam.permission.override_allow').gte('created_at', runStart).limit(1);
    expect((ev ?? []).length >= 1, 'app_event emitted (§2)');
  });

  await test('setUserPermission Deny → granted=false + permission_deny audit', async () => {
    const r = await api('superadmin/setUserPermission', T.sadmin, { userId: tgt.id, permission: PERM, granted: false });
    ok(r);
    const g = await api('superadmin/getUserPermissions', T.sadmin, { userId: tgt.id });
    const row = (g.body.permissions ?? []).find(p => p.permission === PERM);
    expect(row && row.granted === false, 'Deny override present (granted=false)');
    expect(await auditHas('user', tgt.id, 'permission_deny'), 'permission_deny audit');
  });

  await test('getAuditLogs entity_id filter scopes to one user (powers the per-user timeline)', async () => {
    const r = await api('superadmin/getAuditLogs', T.sadmin, { entity_id: tgt.id, limit: 50 });
    ok(r);
    expect(Array.isArray(r.body.logs), 'logs array');
    expect(typeof r.body.total === 'number', 'total numeric');
    expect(r.body.logs.every(l => l.entity_id === tgt.id), 'every returned row is scoped to entity_id');
    const actions = new Set(r.body.logs.map(l => l.action));
    expect(actions.has('permission_grant') && actions.has('permission_deny'), 'the grant + deny events are surfaced');
    const row = r.body.logs[0];
    for (const f of ['id', 'created_at', 'user_id', 'username', 'action', 'entity', 'entity_id', 'details'])
      expect(f in row, `AuditLogRow.${f} present`);
  });

  await test('clearUserPermission → override removed (Inherit) + permission_clear audit', async () => {
    const r = await api('superadmin/clearUserPermission', T.sadmin, { userId: tgt.id, permission: PERM });
    ok(r);
    const g = await api('superadmin/getUserPermissions', T.sadmin, { userId: tgt.id });
    expect(!(g.body.permissions ?? []).some(p => p.permission === PERM), 'override cleared → inherits role default');
    expect(await auditHas('user', tgt.id, 'permission_clear'), 'permission_clear audit');
  });

  // ── Maker-checker: critical grants need a different authorized reviewer ─────
  h.section('RBAC Console › Maker-checker (critical grants)');

  await test('critical user grant without a reason is rejected (not applied)', async () => {
    const r = await api('superadmin/setUserPermission', T.sadmin, { userId: tgt.id, permission: CRIT_COMPLIANCE_READ, granted: true });
    fails(r);
    expect(r.status === 400 && r.body.code === 'reason_required', `400 reason_required, got ${r.status}/${r.body.code}`);
    const { data } = await sb.from('user_permissions').select('permission').eq('user_id', tgt.id).eq('permission', CRIT_COMPLIANCE_READ);
    expect((data ?? []).length === 0, 'not applied');
  });

  let userApprovalId = null;
  await test('critical user grant WITH a reason → pending approval, NOT applied', async () => {
    const r = await api('superadmin/setUserPermission', T.sadmin, {
      userId: tgt.id, permission: CRIT_COMPLIANCE_READ, granted: true, reason: 'E2E maker-checker',
      ...validityWindow(),
    });
    ok(r);
    expect(r.body.pending === true, 'response marked pending');
    expect(!!r.body.approvalId, 'approvalId returned');
    userApprovalId = r.body.approvalId; approvalIds.push(userApprovalId);
    const { data: appr } = await sb.from('permission_grant_approvals')
      .select('status, request_type, permission_key, target_user_id, requested_by').eq('id', userApprovalId).maybeSingle();
    expect(appr && appr.status === 'pending' && appr.request_type === 'user_override' && appr.permission_key === CRIT_COMPLIANCE_READ && appr.target_user_id === tgt.id, 'pending user_override row created');
    expect(appr.requested_by === sadmin.id, 'requested_by = the maker');
    const { data: up } = await sb.from('user_permissions').select('permission').eq('user_id', tgt.id).eq('permission', CRIT_COMPLIANCE_READ);
    expect((up ?? []).length === 0, 'grant NOT applied while pending');
  });

  await test('a duplicate critical request is de-duped (409 already_pending)', async () => {
    const r = await api('superadmin/setUserPermission', T.sadmin, {
      userId: tgt.id, permission: CRIT_COMPLIANCE_READ, granted: true, reason: 'again',
      ...validityWindow(),
    });
    fails(r); expect(r.status === 409 && r.body.code === 'already_pending', `409 already_pending, got ${r.status}/${r.body.code}`);
  });

  let generalApprovalId = null;
  await test('general critical ROLE grant routes through the full approval queue', async () => {
    const cr = await api('superadmin/createRole', T.sadmin, { name: roleNameCrit, label: 'E2E Crit Role', category: 'staff' });
    ok(cr); createdRoles.push(roleNameCrit);
    const noReason = await api('superadmin/setRolePermission', T.sadmin, { roleName: roleNameCrit, permission: CRIT_GENERAL, granted: true });
    fails(noReason); expect(noReason.status === 400 && noReason.body.code === 'reason_required', 'role critical grant needs a reason');
    const r = await api('superadmin/setRolePermission', T.sadmin, { roleName: roleNameCrit, permission: CRIT_GENERAL, granted: true, reason: 'E2E general critical' });
    ok(r); expect(r.body.pending === true && !!r.body.approvalId, 'pending role approval');
    generalApprovalId = r.body.approvalId; approvalIds.push(generalApprovalId);
    const { data: appr } = await sb.from('permission_grant_approvals').select('request_type, target_role, permission_key, status').eq('id', generalApprovalId).maybeSingle();
    expect(appr && appr.request_type === 'role_permission' && appr.target_role === roleNameCrit && appr.permission_key === CRIT_GENERAL && appr.status === 'pending', 'pending general role_permission row');
    const { data: rp } = await sb.from('role_permissions').select('permission').eq('role_name', roleNameCrit).eq('permission', CRIT_GENERAL);
    expect((rp ?? []).length === 0, 'role grant NOT applied while pending');
  });

  await test('seed designated compliance approver grant', async () => {
    const { error } = await sb.from('user_permissions').upsert(
      { user_id: approverId, permission: COMPLIANCE_APPROVER, granted: true, set_by: `e2e_${TAG}`, set_at: new Date().toISOString() },
      { onConflict: 'user_id,permission' },
    );
    expect(!error, error?.message ?? 'approver grant inserted');
  });

  await test('designated approver lists compliance requests only', async () => {
    const r = await api('admin/approvals/list', approverTok, { status: 'pending' });
    ok(r);
    const keys = (r.body.approvals ?? []).map(a => a.permissionKey);
    expect(keys.includes(CRIT_COMPLIANCE_READ), 'compliance request visible');
    expect(!keys.includes(CRIT_GENERAL), 'general critical request hidden');
  });

  await test('permissions.manage still sees the full pending queue', async () => {
    const r = await api('admin/approvals/list', T.sadmin, { status: 'pending' });
    ok(r);
    const ids = new Set((r.body.approvals ?? []).map(a => a.id));
    expect(ids.has(userApprovalId), 'compliance approval visible to permissions.manage');
    expect(ids.has(generalApprovalId), 'general critical approval visible to permissions.manage');
  });

  await test('the maker CANNOT approve their own request (segregation of duties)', async () => {
    const r = await api('admin/approvals/approve', mintStepUp(sadmin), { approvalId: userApprovalId });
    fails(r); expect(r.status === 403 && r.body.code === 'self_approval', `403 self_approval, got ${r.status}/${r.body.code}`);
    const { data: appr } = await sb.from('permission_grant_approvals').select('status').eq('id', userApprovalId).maybeSingle();
    expect(appr && appr.status === 'pending', 'still pending after a blocked self-approval');
  });

  await test('designated approver approves a compliance grant with step-up', async () => {
    const r = await api('admin/approvals/approve', approverStepTok, { approvalId: userApprovalId });
    ok(r);
    const { data: up } = await sb.from('user_permissions').select('granted, valid_from, valid_until').eq('user_id', tgt.id).eq('permission', CRIT_COMPLIANCE_READ).maybeSingle();
    expect(up && up.granted === true, 'grant now applied after approval');
    const { data: appr } = await sb.from('permission_grant_approvals').select('status, decided_by, applied_at').eq('id', userApprovalId).maybeSingle();
    expect(appr && appr.status === 'approved' && appr.decided_by === approverId, 'row approved by the designated approver');
    expect(appr && appr.applied_at, 'applied_at stamped atomically with the grant');
    expect(up && up.valid_from && up.valid_until, 'time-box copied to the applied compliance grant');
  });

  await test('re-approving an already-approved request is rejected (atomic status guard)', async () => {
    // The apply + status flip is one transaction with a `pending` guard, so a second
    // approve cannot re-apply the grant — it must see the row is no longer pending.
    const r = await api('admin/approvals/approve', checkerTok, { approvalId: userApprovalId });
    fails(r); expect(r.status === 400, `expected 400 not_pending, got ${r.status}`);
  });

  let exportApprovalId = null;
  await test('designated approver rejects a compliance grant', async () => {
    const req = await api('superadmin/setUserPermission', T.sadmin, {
      userId: tgt.id, permission: CRIT_COMPLIANCE_EXPORT, granted: true, reason: 'E2E compliance reject',
      ...validityWindow(),
    });
    ok(req); expect(req.body.pending === true && !!req.body.approvalId, 'pending export approval');
    exportApprovalId = req.body.approvalId; approvalIds.push(exportApprovalId);
    const r = await api('admin/approvals/reject', approverTok, { approvalId: exportApprovalId, reason: 'E2E reject' });
    ok(r);
    const { data: appr } = await sb.from('permission_grant_approvals').select('status, decided_by').eq('id', exportApprovalId).maybeSingle();
    expect(appr && appr.status === 'rejected' && appr.decided_by === approverId, 'row rejected by designated approver');
    const { data: up } = await sb.from('user_permissions').select('permission').eq('user_id', tgt.id).eq('permission', CRIT_COMPLIANCE_EXPORT);
    expect((up ?? []).length === 0, 'rejected grant was not applied');
  });

  await test('designated approver cannot approve or reject their own compliance request', async () => {
    const selfApprovalId = `PGA-${crypto.randomUUID()}`;
    approvalIds.push(selfApprovalId);
    const { validFrom, validUntil } = validityWindow();
    const { error } = await sb.from('permission_grant_approvals').insert({
      id: selfApprovalId,
      request_type: 'user_override',
      target_user_id: tgt.id,
      target_role: null,
      permission_key: CRIT_COMPLIANCE_EXPORT,
      effect: 'allow',
      reason: 'E2E self approval guard',
      requested_by: approverId,
      expires_at: new Date(Date.now() + 7 * 24 * 60 * 60 * 1000).toISOString(),
      grant_valid_from: validFrom,
      grant_valid_until: validUntil,
    });
    expect(!error, error?.message ?? 'self approval row inserted');
    const approveSelf = await api('admin/approvals/approve', approverStepTok, { approvalId: selfApprovalId });
    fails(approveSelf); expect(approveSelf.status === 403 && approveSelf.body.code === 'self_approval', `403 self_approval, got ${approveSelf.status}/${approveSelf.body.code}`);
    const rejectSelf = await api('admin/approvals/reject', approverTok, { approvalId: selfApprovalId, reason: 'nope' });
    fails(rejectSelf); expect(rejectSelf.status === 403 && rejectSelf.body.code === 'self_approval', `403 self_approval, got ${rejectSelf.status}/${rejectSelf.body.code}`);
  });

  await test('designated approver gets 403 for a non-compliance approval id', async () => {
    const r = await api('admin/approvals/approve', approverTok, { approvalId: generalApprovalId });
    fails(r); expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('actor without approval capability cannot list or decide approvals', async () => {
    const list = await api('admin/approvals/list', T.emp, { status: 'pending' });
    fails(list); expect(list.status === 403, `list expected 403, got ${list.status}`);
    const approve = await api('admin/approvals/approve', mintStepUp(emp), { approvalId: generalApprovalId });
    fails(approve); expect(approve.status === 403, `approve expected 403, got ${approve.status}`);
  });

  // ── Access control: the negative path (a real employee is denied) ────────────
  h.section('RBAC Console › Access control (deny)');

  const denied = (name, path, args) => test(name, async () => {
    const r = await api(path, T.emp, args);
    expect(r.status === 403, `expected 403, got ${r.status} — ${JSON.stringify(r.body).slice(0, 160)}`);
    fails(r);
  });

  await denied('employee cannot listRoles', 'superadmin/listRoles', {});
  await denied('employee cannot listUsers', 'superadmin/listUsers', {});
  await denied('employee cannot getAuditLogs', 'superadmin/getAuditLogs', {});
  await denied('employee cannot getRolePermissions', 'superadmin/getRolePermissions', { roleName: 'manager' });
  await denied('employee cannot listRoleCategories', 'superadmin/listRoleCategories', {});
  await denied('employee cannot createRoleCategory', 'superadmin/createRoleCategory', { label: 'nope' });

  await test('employee cannot createRole (and no role row is written)', async () => {
    const sneaky = roleName + '_sneak';
    const r = await api('superadmin/createRole', T.emp, { name: sneaky, label: 'nope' });
    expect(r.status === 403, `expected 403, got ${r.status}`); fails(r);
    const { data } = await sb.from('roles').select('name').eq('name', sneaky);
    expect((data ?? []).length === 0, 'no role row created by the denied request');
  });

  await test('employee cannot set a per-user override (and none is written)', async () => {
    const r = await api('superadmin/setUserPermission', T.emp, { userId: tgt.id, permission: PERM, granted: true });
    expect(r.status === 403, `expected 403, got ${r.status}`); fails(r);
    const { data } = await sb.from('user_permissions').select('permission').eq('user_id', tgt.id).eq('permission', PERM);
    expect((data ?? []).length === 0, 'no override written by the denied request');
  });
}
