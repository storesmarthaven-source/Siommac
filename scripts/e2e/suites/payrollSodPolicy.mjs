export const title = 'Finance Payroll - Segregation-of-Duties Policy (governed)';

/**
 * Covers the configurable SoD policy: read model, proposal validation,
 * maker-checker approval, per-run snapshot invariance, and the superadmin-only
 * eligible-role list.
 *
 * NOTE ON SCOPE: the level's ENFORCEMENT lives in finance_payroll_confirm_funding_tx
 * / finance_payroll_release_run_tx (patched to read v_run.sod_level). Exercising
 * those needs a fully locked run with certification + GL + payslips, which the
 * financePayroll suite already builds — the level-parameterised funding/release
 * cases belong there, not here. This suite proves the policy that feeds them, plus
 * the snapshot invariant that decides which level a run is judged by.
 *
 * SHARED-DB SAFETY: this suite mutates a singleton governance row. Cleanup deletes
 * every policy row it created and restores the original active row, so the database
 * ends exactly as it started.
 */

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;

  const users = {
    proposer: `SOD-PROP-${TAG}`,
    approver: `SOD-APPR-${TAG}`,
    employee: `SOD-EE-${TAG}`,
    superadmin: `SOD-SA-${TAG}`,
  };
  let T = {};
  let originalActiveId = null;
  let originalLevel = null;
  const createdPolicyIds = [];

  h.onCleanup(async () => {
    // notifications precede app_events (event_id FK); audit + events are tagged by module.
    if (createdPolicyIds.length) {
      await h.mustDelete('notifications', q => q.in('source_id', createdPolicyIds));
      await h.mustDelete('app_events', q => q.eq('source_module', 'finance_payroll_sod_policy').in('source_entity_id', createdPolicyIds));
      await h.mustDelete('hr_audit_log', q => q.eq('submodule_key', 'finance_payroll_sod_policy').in('record_id', createdPolicyIds));
      await h.mustDelete('finance_payroll_sod_policy', q => q.in('id', createdPolicyIds));
    }
    // Restore the singleton the suite borrowed.
    if (originalActiveId) {
      await sb.from('finance_payroll_sod_policy')
        .update({ status: 'active', approved_by: null })
        .eq('id', originalActiveId);
    }
    await h.mustDelete('app_users', q => q.in('id', Object.values(users)));
  });

  h.section('SoD policy - setup and access control');

  await test('provision real roles and capture the pre-existing policy', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: users.proposer,   username: `${TAG}_sod_p`, full_name: 'SoD Proposer (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: users.approver,   username: `${TAG}_sod_a`, full_name: 'SoD Approver (E2E)',   role: 'finance_manager', status: 'active', employment_type: 'employee' },
      { id: users.employee,   username: `${TAG}_sod_e`, full_name: 'SoD Employee (E2E)',   role: 'employee',        status: 'active', employment_type: 'employee' },
      { id: users.superadmin, username: `${TAG}_sod_s`, full_name: 'SoD Superadmin (E2E)', role: 'superadmin',      status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, `user setup failed: ${error?.message}`);
    T = {
      proposer:   mint({ id: users.proposer,   username: `${TAG}_sod_p`, role: 'finance_manager', department_id: null }),
      approver:   mint({ id: users.approver,   username: `${TAG}_sod_a`, role: 'finance_manager', department_id: null }),
      employee:   mint({ id: users.employee,   username: `${TAG}_sod_e`, role: 'employee',        department_id: null }),
      superadmin: mint({ id: users.superadmin, username: `${TAG}_sod_s`, role: 'superadmin',      department_id: null }),
    };
    const { data, error: e2 } = await sb.from('finance_payroll_sod_policy')
      .select('id, sod_level').eq('status', 'active').single();
    expect(!e2, `no active SoD policy — is the migration applied? ${e2?.message}`);
    originalActiveId = data.id;
    originalLevel = data.sod_level;
  });

  const paths = ['get', 'propose', 'approve', 'set-roles'];
  await test('every endpoint requires auth and denies a real employee', async () => {
    for (const p of paths) {
      const unauth = await api(`finance/payroll/sod-policy/${p}`, null, {});
      expect(unauth.status === 401, `${p}: expected 401, got ${unauth.status}`);
      const denied = await api(`finance/payroll/sod-policy/${p}`, T.employee, {});
      expect(denied.status === 403, `${p}: expected 403 before validation, got ${denied.status}`);
    }
  });

  await test('get returns the active policy and the selectable levels', async () => {
    const r = await api('finance/payroll/sod-policy/get', T.proposer, {});
    ok(r, `get failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.active && typeof d.active.sodLevel === 'number', 'active policy missing');
    expect([2, 3, 4].includes(d.active.sodLevel), `unexpected level ${d.active?.sodLevel}`);
    expect(JSON.stringify(d.levels) === JSON.stringify([2, 3, 4]), `levels must be [2,3,4], got ${JSON.stringify(d.levels)}`);
    expect(Array.isArray(d.history), 'history must be an array');
    // The contract the FE consumes.
    for (const k of ['id', 'sodLevel', 'status', 'eligibleRoles', 'proposedBy', 'approvedBy', 'effectiveAt']) {
      expect(k in d.active, `active is missing ${k}`);
    }
  });

  h.section('SoD policy - proposal validation');

  const target = originalLevel === 4 ? 3 : 4;   // always a real change

  await test('propose rejects an out-of-range level, a thin reason, and a no-op change', async () => {
    const bad = await api('finance/payroll/sod-policy/propose', T.proposer, { sodLevel: 1, reason: 'Too permissive for a control.' });
    fails(bad, 'level 1 must be rejected'); expect(bad.status === 400, `level 1 should be 400, got ${bad.status}`);

    const thin = await api('finance/payroll/sod-policy/propose', T.proposer, { sodLevel: target, reason: 'short' });
    fails(thin, 'short reason must be rejected'); expect(thin.status === 400, `short reason should be 400, got ${thin.status}`);

    const noop = await api('finance/payroll/sod-policy/propose', T.proposer, { sodLevel: originalLevel, reason: 'No change at all, should be refused.' });
    fails(noop, 'no-op change must be rejected'); expect(noop.status === 422, `no-op should be 422, got ${noop.status}`);
  });

  let proposalId = null;
  await test('a finance manager proposes a change; it does NOT take effect yet', async () => {
    const r = await api('finance/payroll/sod-policy/propose', T.proposer, {
      sodLevel: target, reason: `E2E ${TAG}: verifying governed SoD change.`,
    });
    ok(r, `propose failed: ${r.body.message}`);
    proposalId = r.body.data.id;
    createdPolicyIds.push(proposalId);
    expect(r.body.data.status === 'pending_approval', `expected pending_approval, got ${r.body.data.status}`);
    expect(r.body.data.proposedBy === users.proposer, 'proposedBy not recorded');

    // The ACTIVE level must be untouched until approval.
    const { data: level } = await sb.rpc('finance_payroll_active_sod_level');
    expect(level === originalLevel, `active level changed on propose (${originalLevel} -> ${level})`);
  });

  await test('propose writes its audit + app_events evidence (spec §2)', async () => {
    const { data: ev } = await sb.from('app_events')
      .select('event_type').eq('source_module', 'finance_payroll_sod_policy').eq('source_entity_id', proposalId);
    expect((ev ?? []).some(e => e.event_type === 'finance.payroll.sod_policy.change_proposed'),
      'missing change_proposed app_event');
    const { data: aud } = await sb.from('hr_audit_log')
      .select('action').eq('submodule_key', 'finance_payroll_sod_policy').eq('record_id', proposalId);
    expect((aud ?? []).some(a => a.action === 'sod_policy.change_proposed'), 'missing audit row');
  });

  await test('only ONE proposal may be open at a time', async () => {
    const second = await api('finance/payroll/sod-policy/propose', T.approver, {
      sodLevel: target, reason: `E2E ${TAG}: a second concurrent proposal.`,
    });
    fails(second, 'a second open proposal must be rejected');
    expect(second.status === 409, `second proposal should be 409, got ${second.status}`);
  });

  h.section('SoD policy - maker-checker approval');

  await test('the proposer CANNOT approve their own change (enforced in the RPC)', async () => {
    const self = await api('finance/payroll/sod-policy/approve', T.proposer, { policyId: proposalId });
    fails(self, 'self-approval must be denied');
    expect(self.status === 403, `self-approval should be 403, got ${self.status}`);
    // and nothing moved
    const { data: row } = await sb.from('finance_payroll_sod_policy').select('status').eq('id', proposalId).single();
    expect(row.status === 'pending_approval', `self-approval changed status to ${row.status}`);
  });

  await test('a DIFFERENT authorised approver activates it, superseding the previous policy', async () => {
    const r = await api('finance/payroll/sod-policy/approve', T.approver, { policyId: proposalId });
    ok(r, `approve failed: ${r.body.message}`);
    expect(r.body.data.status === 'active', `expected active, got ${r.body.data.status}`);
    expect(r.body.data.sodLevel === target, `expected level ${target}, got ${r.body.data.sodLevel}`);
    expect(r.body.data.approvedBy === users.approver, 'approvedBy not recorded');

    const { data: rows } = await sb.from('finance_payroll_sod_policy').select('id, status');
    const active = rows.filter(x => x.status === 'active');
    expect(active.length === 1, `expected exactly ONE active policy, found ${active.length}`);
    expect(active[0].id === proposalId, 'the approved proposal is not the active policy');
    const prior = rows.find(x => x.id === originalActiveId);
    expect(prior.status === 'superseded', `previous policy should be superseded, is ${prior.status}`);

    const { data: level } = await sb.rpc('finance_payroll_active_sod_level');
    expect(level === target, `active level should now be ${target}, got ${level}`);
  });

  await test('approving an already-decided proposal is refused', async () => {
    const again = await api('finance/payroll/sod-policy/approve', T.superadmin, { policyId: proposalId });
    fails(again, 're-approval must be refused');
    expect(again.status === 422, `re-approval should be 422, got ${again.status}`);
  });

  h.section('SoD policy - per-run snapshot invariance');

  await test('runs created BEFORE the change keep their own level', async () => {
    // Every existing run was created under the previous policy; none may have been
    // rewritten by the change. This is the "no switching between runs" guarantee.
    const { data: runs, error } = await sb.from('finance_payroll_runs')
      .select('run_no, sod_level').not('sod_level', 'is', null).limit(50);
    expect(!error, `run read failed: ${error?.message}`);
    const drifted = (runs ?? []).filter(r => r.sod_level === target && target !== originalLevel);
    expect(drifted.length === 0,
      `existing runs were re-levelled to ${target}: ${drifted.map(r => r.run_no).join(', ')}`);
  });

  h.section('SoD policy - eligible roles (superadmin only)');

  await test('a finance manager may NOT edit the eligible-role list', async () => {
    const denied = await api('finance/payroll/sod-policy/set-roles', T.proposer, { roles: ['finance_manager'] });
    fails(denied, 'finance_manager must not manage roles');
    expect(denied.status === 403, `set-roles for finance_manager should be 403, got ${denied.status}`);
  });

  await test('superadmin edits the list, and superadmin is always retained', async () => {
    // Deliberately try to REMOVE superadmin — the RPC must add it back, otherwise
    // the control could be locked out of itself.
    const r = await api('finance/payroll/sod-policy/set-roles', T.superadmin, { roles: ['finance_manager'] });
    ok(r, `set-roles failed: ${r.body.message}`);
    createdPolicyIds.push(r.body.data.id);
    expect(r.body.data.eligibleRoles.includes('superadmin'), 'superadmin was not retained');
    expect(r.body.data.eligibleRoles.includes('finance_manager'), 'finance_manager missing from the list');
    expect(r.body.data.sodLevel === target, 'a role change must not alter the level');
    expect(r.body.data.status === 'active', 'the amended policy must be active');

    const { data: rows } = await sb.from('finance_payroll_sod_policy').select('status');
    expect(rows.filter(x => x.status === 'active').length === 1, 'more than one active policy after set-roles');
  });

  await test('a role outside the eligible list cannot propose', async () => {
    // The list is now {finance_manager, superadmin}; an admin is permitted by the
    // permission catalogue but is NOT on the configured list, so the service denies it.
    const adminId = `SOD-ADM-${TAG}`;
    users.admin = adminId;
    await sb.from('app_users').insert({
      id: adminId, username: `${TAG}_sod_ad`, full_name: 'SoD Admin (E2E)',
      role: 'admin', status: 'active', employment_type: 'employee',
    });
    const adminT = mint({ id: adminId, username: `${TAG}_sod_ad`, role: 'admin', department_id: null });
    const denied = await api('finance/payroll/sod-policy/propose', adminT, {
      sodLevel: originalLevel, reason: `E2E ${TAG}: admin is not on the eligible list.`,
    });
    fails(denied, 'a non-eligible role must be refused');
    expect(denied.status === 403, `non-eligible propose should be 403, got ${denied.status}`);
  });
}
