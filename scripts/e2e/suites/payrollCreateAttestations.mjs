// ═══════════════════════════════════════════════════════════════════════════
// P0-4 — Creation governance attestations (certification WP-3), live acceptance.
// ═══════════════════════════════════════════════════════════════════════════
// Proves the create-run attestation contract end-to-end against the dev server:
//   A1  valid attestations → run created; the SAME transaction's app_event and
//       hr_audit_log rows carry the attestation object (actor/time = the rows' own).
//   A2  missing attestations → 400 validation.failed at the route; NO run row.
//   A3  false/extra-key attestations → 400 at the route (z.literal(true)/strict).
//   A4  DB defense-in-depth: a direct RPC call with a false attestation raises
//       PR422 (attestations.invalid) and leaves ZERO run/event/audit rows (atomic).
//   A5  idempotent replay (same key + same payload incl. attestations) returns the
//       original run and adds no second event.
//   A6  same key + different payload (attestations in the hash) → 409.
// Run via: npm run test:e2e -- payrollCreateAttestations
import { payrollRunCommand, PAYROLL_CREATE_ATTESTATIONS } from '../helpers/payrollRun.mjs';
import { attachActivePolicy } from '../helpers/payPolicyFixture.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  h.section('P0-4 create-run attestations — acceptance');

  const MGR = `ATT-MGR-${TAG}`;
  let T = null;
  const ids = { pgId: null, runIds: [], policyFixture: null };
  const P_START = '2026-05-01', P_END = '2026-05-31';

  h.onCleanup(async () => {
    for (const rid of ids.runIds) {
      try { await sb.from('app_events').delete().eq('source_entity_id', rid).eq('source_module', 'finance_payroll'); } catch {}
      try { await sb.from('hr_audit_log').delete().eq('record_id', rid); } catch {}
      try { await sb.from('finance_payroll_runs').delete().eq('id', rid); } catch {}
    }
    // F-02: policy assignment + policy BEFORE the pay group (restrict FK).
    if (ids.policyFixture) { try { await ids.policyFixture.cleanup(); } catch {} }
    if (ids.pgId) { try { await sb.from('finance_pay_groups').delete().eq('id', ids.pgId); } catch {} }
    try { await sb.from('hr_audit_log').delete().eq('actor_id', MGR); } catch {}
    try { await sb.from('app_users').delete().eq('id', MGR); } catch {}
  });

  await test('ATT-setup — finance manager + pay group with an active policy (F-02)', async () => {
    const { error } = await sb.from('app_users').insert([
      { id: MGR, username: `${TAG}_att_mgr`, full_name: 'Attest Manager', role: 'finance_manager', status: 'active', employment_type: 'employee' },
    ]);
    expect(!error, `seed user: ${error?.message}`);
    T = mint({ id: MGR, username: `${TAG}_att_mgr`, role: 'finance_manager', department_id: null });
    const group = await api('finance/payroll/pay-groups/create', T, {
      code: `ATT-${TAG.slice(-10)}`, name: `Attestations ${TAG}`, frequency: 'monthly', statutoryCountry: 'TT',
    });
    ok(group, `pay group: ${group.body.message}`);
    ids.pgId = group.body.data.id;
    // F-02: create_run_tx resolves an active whole-period policy from the pay group.
    ids.policyFixture = await attachActivePolicy({ sb, payGroupId: ids.pgId, actorId: MGR, tag: TAG });
  });

  await test('A1 — valid attestations create the run AND persist in event + audit evidence', async () => {
    const r = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:main`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
    }));
    ok(r, `create: ${r.body.message}`);
    const runId = r.body.data.id; ids.runIds.push(runId);

    // jsonb normalizes key order — compare semantically (exact keys, exact values).
    const sameAttestations = (got) => {
      if (!got || typeof got !== 'object') return false;
      const want = Object.entries(PAYROLL_CREATE_ATTESTATIONS);
      return Object.keys(got).length === want.length && want.every(([k, v]) => got[k] === v);
    };

    const ev = await sb.from('app_events').select('payload, actor_user_id, created_at')
      .eq('source_entity_id', runId).eq('event_type', 'finance.payroll.run.created');
    expect((ev.data ?? []).length === 1, `exactly 1 created event (got ${ev.data?.length})`);
    expect(sameAttestations(ev.data[0].payload.attestations),
      `event payload carries the exact attestation object (got ${JSON.stringify(ev.data[0].payload.attestations)})`);
    expect(ev.data[0].actor_user_id === MGR && !!ev.data[0].created_at, 'event actor/time are server-authoritative');

    const au = await sb.from('hr_audit_log').select('new_state, actor_id, created_at')
      .eq('record_id', runId).eq('action', 'payroll_run.created');
    expect((au.data ?? []).length === 1, `exactly 1 audit row (got ${au.data?.length})`);
    expect(sameAttestations(au.data[0].new_state.attestations),
      'audit new_state carries the exact attestation object');
    expect(au.data[0].actor_id === MGR, 'audit actor is server-authoritative');
  });

  await test('A2 — missing attestations → 400 validation.failed; no run row', async () => {
    const r = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:missing`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
      attestations: null,   // helper omits the field entirely
    }));
    fails(r); expect(r.status === 400, `expected 400, got ${r.status}`);
    expect(r.body.error?.code === 'validation.failed', `typed code validation.failed (got ${r.body.error?.code})`);
    const rows = await sb.from('finance_payroll_runs').select('id').like('creation_request_key', `%${TAG}:att:missing`);
    expect((rows.data ?? []).length === 0, 'no run row for the rejected create');
  });

  await test('A3 — false value / unknown key → 400 at the route; no run row', async () => {
    const falseAtt = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:false`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
      attestations: { ...PAYROLL_CREATE_ATTESTATIONS, separationOfDutiesAcknowledged: false },
    }));
    fails(falseAtt); expect(falseAtt.status === 400, `false attestation expected 400, got ${falseAtt.status}`);
    const extraKey = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:extra`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
      attestations: { ...PAYROLL_CREATE_ATTESTATIONS, extraClaim: true },
    }));
    fails(extraKey); expect(extraKey.status === 400, `unknown key expected 400 (strict), got ${extraKey.status}`);
    const rows = await sb.from('finance_payroll_runs').select('id, creation_request_key')
      .or(`creation_request_key.like.%${TAG}:att:false,creation_request_key.like.%${TAG}:att:extra`);
    expect((rows.data ?? []).length === 0, 'no run rows for rejected creates');
  });

  await test('A4 — direct RPC with false attestation: PR422 attestations.invalid + ZERO side-effect rows', async () => {
    // Defense in depth below the route: the transaction itself must reject and
    // roll back atomically (no run, no receipt, no event, no audit).
    const sv = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).eq('jurisdiction', 'TT').limit(1);
    const { error } = await sb.rpc('finance_payroll_create_run_tx', {
      p_actor_id: MGR, p_request_key: `${TAG}:att:rpcfalse`,
      p_run_type: 'scheduled', p_period_start: P_START, p_period_end: P_END,
      p_statutory_version_id: sv.data[0].id, p_pay_group_id: ids.pgId,
      p_attestations: { ...PAYROLL_CREATE_ATTESTATIONS, separationOfDutiesAcknowledged: false },
    });
    expect(error, 'direct RPC with a false attestation must fail');
    expect(String(error.message).includes('attestations.invalid'), `typed leading code (got ${error.message})`);
    const scoped = `${MGR}|payroll_run.create|${TAG}:att:rpcfalse`;
    const [runs, evs, aus] = await Promise.all([
      sb.from('finance_payroll_runs').select('id').eq('creation_request_key', scoped),
      sb.from('app_events').select('id').eq('actor_user_id', MGR).eq('event_type', 'finance.payroll.run.created'),
      sb.from('hr_audit_log').select('record_id').eq('actor_id', MGR).eq('action', 'payroll_run.created'),
    ]);
    expect((runs.data ?? []).length === 0, 'atomic rollback: no run row');
    // Only the A1 run's evidence may exist for this actor.
    expect((evs.data ?? []).length === 1, `no extra event rows (got ${evs.data?.length})`);
    expect((aus.data ?? []).length === 1, `no extra audit rows (got ${aus.data?.length})`);
  });

  await test('A5 — same key + same payload replays the ORIGINAL run; no duplicate event', async () => {
    const replay = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:main`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
    }));
    ok(replay, `replay: ${replay.body.message}`);
    expect(replay.body.data.id === ids.runIds[0], 'replay returns the original run id');
    const ev = await sb.from('app_events').select('id').eq('source_entity_id', ids.runIds[0]).eq('event_type', 'finance.payroll.run.created');
    expect((ev.data ?? []).length === 1, 'replay adds no second created event');
  });

  await test('A6 — same key + different payload (hash includes attestations) → 409', async () => {
    const conflict = await api('finance/payroll/runs/create', T, payrollRunCommand({
      idempotencyKey: `${TAG}:att:main`, periodStart: P_START, periodEnd: P_END, payGroupId: ids.pgId,
      internalDescription: 'changed payload',
    }));
    fails(conflict); expect(conflict.status === 409, `changed payload expected 409, got ${conflict.status}`);
  });
}
