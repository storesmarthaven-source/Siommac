// ═══════════════════════════════════════════════════════════════════════════
// F-02 pay-policy fixture — attach an ACTIVE governed pay policy to a pay group.
// ═══════════════════════════════════════════════════════════════════════════
// Migration 711 makes finance_payroll_create_run_tx UNCONDITIONALLY require that
// every new run be pay-group-scoped AND resolve to exactly one ACTIVE policy
// assignment+version whose effective windows cover the WHOLE run period (else
// policy.pay_group_required / policy.missing / policy.ambiguous). Suites that
// predate F-02 create runs against a bare pay group with no policy, so they would
// fail create under 711. This helper provisions the missing prerequisite: a single
// active, whole-period policy assignment for the given pay group.
//
// PROVISIONING STRATEGY (deliberate): the 8 legacy suites converted here seed the
// policy via the service-role client (standard E2E prerequisite seeding — see the
// per-module seed-data standard). They do NOT assert F-01 governance or the
// canonical-checksum VALUE, and create_run_tx only requires the pinned checksum to
// be present + 64-hex (it never recomputes it), so a deterministic sha256 fixture
// checksum is sufficient and honest here. The NEW focused F-02 suite
// (payrollPayPolicyRun.mjs) instead provisions through F-01's real create→submit→
// approve→activate→assign routes (and F-CAL's routes for the working_days path)
// and asserts the real checksum + governance. This helper is intentionally the
// NON-working_days path: it binds no working_days component, so the run is not
// calendar-pinned and base pay stays full-period — the exact behaviour the 8
// legacy suites already expect.
//
// CLEANUP ORDER (caller-owned, non-negotiable — mig 710 FKs are `on delete
// restrict`): a run pins pay_policy_version_id (restrict); the assignment
// references the version (restrict) and the pay group (restrict). So the caller
// MUST tear down in this order inside its own onCleanup block:
//     delete runs (+ cascades)  →  fixture.cleanup()  →  delete pay group
// fixture.cleanup() removes the assignment then the policy (which cascades to the
// version + its components/rules). Calling it before the runs are gone will fail
// the restrict FK; calling it after the pay group is gone leaves nothing to do.

import { createHash } from 'node:crypto';

function fixturePolicyCode(payGroupId) {
  const h = createHash('sha256').update(String(payGroupId)).digest('hex').slice(0, 12).toUpperCase();
  return `F02FIX${h}`; // 6 + 12 = 18 chars, matches ^[A-Z0-9][A-Z0-9_-]{1,19}$
}

/**
 * Idempotently ensure `payGroupId` has one active, whole-period pay-policy
 * assignment so migration 711's create_run_tx can resolve + pin it.
 *
 * @param {object}  args
 * @param {object}  args.sb           service-role Supabase client (h.service()/sb)
 * @param {string}  args.payGroupId   finance_pay_groups.id the runs are scoped to
 * @param {string}  args.actorId      an ACTIVE app_users.id to own the seed rows
 * @param {string} [args.tag]         the suite's h.TAG — embedded in the policy name +
 *                 version change_summary so an orphan sweep can find un-cleaned rows
 * @param {string} [args.effectiveFrom='2000-01-01'] assignment/version start; keep
 *                 well before any suite run period (some suites use far-future years)
 * @returns {Promise<{policyId:string,versionId:string,assignmentId:string,
 *                     checksum:string,reused:boolean,cleanup:()=>Promise<void>}>}
 */
export async function attachActivePolicy({ sb, payGroupId, actorId, tag = '', effectiveFrom = '2000-01-01' }) {
  if (!sb) throw new Error('attachActivePolicy requires a service-role client (sb)');
  if (!payGroupId) throw new Error('attachActivePolicy requires payGroupId');
  if (!actorId) throw new Error('attachActivePolicy requires an active actorId');
  const tagSuffix = tag ? ` [${tag}]` : '';

  // Reuse an existing active assignment on this pay group if one already covers
  // the range (idempotent re-run against a dirty DB); no-op cleanup in that case.
  const existing = await sb
    .from('finance_pay_group_policy_assignments')
    .select('id, policy_id, policy_version_id')
    .eq('pay_group_id', payGroupId)
    .eq('status', 'active')
    .limit(1);
  if (!existing.error && existing.data && existing.data.length > 0) {
    const row = existing.data[0];
    return {
      policyId: row.policy_id,
      versionId: row.policy_version_id,
      assignmentId: row.id,
      checksum: null,
      reused: true,
      cleanup: async () => {},
    };
  }

  const code = fixturePolicyCode(payGroupId);

  // 1) Policy shell (active).
  const policyIns = await sb
    .from('finance_pay_policies')
    .insert({
      code,
      name: `F-02 fixture policy ${code}${tagSuffix}`,
      policy_type: 'standard_salary',
      workforce_type: 'salaried',
      status: 'active',
      owner_id: actorId,
      created_by: actorId,
    })
    .select('id')
    .single();
  if (policyIns.error) {
    throw new Error(`attachActivePolicy: policy insert failed: ${policyIns.error.message}`);
  }
  const policyId = policyIns.data.id;

  // 2) Active version covering the whole future (no working_days component → the
  //    run is NOT calendar-pinned; base pay stays full-period).
  const versionIns = await sb
    .from('finance_pay_policy_versions')
    .insert({
      policy_id: policyId,
      version_no: 1,
      status: 'active',
      effective_from: effectiveFrom,
      effective_to: null,
      change_summary: `F-02 fixture — legacy-suite policy prerequisite${tagSuffix}`,
      day_boundary: 'calendar_day',
      prepared_by: actorId,
      submitted_by: actorId,
      approved_by: actorId,
      activated_by: actorId,
    })
    .select('id')
    .single();
  if (versionIns.error) {
    await sb.from('finance_pay_policies').delete().eq('id', policyId);
    throw new Error(`attachActivePolicy: version insert failed: ${versionIns.error.message}`);
  }
  const versionId = versionIns.data.id;

  // create_run_tx requires a present, 64-hex canonical_checksum (it never
  // recomputes it). A deterministic fixture checksum satisfies that contract.
  const checksum = createHash('sha256').update(`f02-fixture:${versionId}`).digest('hex');
  const sumUpd = await sb
    .from('finance_pay_policy_versions')
    .update({ canonical_checksum: checksum })
    .eq('id', versionId);
  if (sumUpd.error) {
    await sb.from('finance_pay_policies').delete().eq('id', policyId);
    throw new Error(`attachActivePolicy: checksum update failed: ${sumUpd.error.message}`);
  }

  // 3) Active, whole-period assignment binding the version to the pay group.
  const asgIns = await sb
    .from('finance_pay_group_policy_assignments')
    .insert({
      pay_group_id: payGroupId,
      policy_id: policyId,
      policy_version_id: versionId,
      effective_from: effectiveFrom,
      effective_to: null,
      status: 'active',
      assigned_by: actorId,
    })
    .select('id')
    .single();
  if (asgIns.error) {
    await sb.from('finance_pay_policies').delete().eq('id', policyId);
    throw new Error(`attachActivePolicy: assignment insert failed: ${asgIns.error.message}`);
  }
  const assignmentId = asgIns.data.id;

  return {
    policyId,
    versionId,
    assignmentId,
    checksum,
    reused: false,
    // Ordered teardown: assignment (restrict → version) THEN policy (cascades the
    // version + its components/rules). Caller must invoke AFTER deleting runs and
    // BEFORE deleting the pay group.
    cleanup: async () => {
      await sb.from('finance_pay_group_policy_assignments').delete().eq('id', assignmentId);
      await sb.from('finance_pay_policies').delete().eq('id', policyId);
    },
  };
}
