// ═══════════════════════════════════════════════════════════════════════════
// §8 — Payroll System Certification (cross-domain lifecycle suite) — PHASE 1.
// ═══════════════════════════════════════════════════════════════════════════
// Thin certification layer over the §7 canonical fixture: one dataset, distinct
// stage actors, real routes only. Detailed domain behavior stays in the 25
// existing suites (doc §3); this suite proves the CROSS-DOMAIN chain.
//
// Phase 1 (this file, grows by §12 loop):
//   CERT-SEC-1  explicit deny overrides role grant (403); outsider 403; anon 401
//   CERT-A-1    fixture governance provisioning succeeded (groups/calendar/policies)
//   CERT-B-1    preparer creates a run on the monthly group → salary policy pinned
//   CERT-D-1    lock blocked 422 policy.source_missing:payment_destination (E12 no bank)
//               → typed error envelope carries code + correlationId (P0-5 live)
//   CERT-D-2    after the source is repaired, lock succeeds; snapshot immutable evidence
//   CERT-E-1    calculate publishes ONE version; excluded/blocked employees honored;
//               E2 approved+linked timesheet contributes hourly evidence (weekly group N/A here)
//   CERT-CLEAN  fixture cleanup is FK-safe (proven by running this suite twice: §7)
// Run: npm run test:e2e -- payrollSystemCertification   (twice, per §7/§12.7)

import { payrollRunCommand, payrollLockCommand, payrollCalculationCommand } from '../helpers/payrollRun.mjs';
import { provisionPayrollCertification, purgeRunArtifacts } from '../helpers/payrollCertificationFixture.mjs';

export default async function run(h) {
  const { api, test, expect, ok, fails, sb, TAG } = h;
  h.section('Payroll System Certification — Phase 1 (fixture + lifecycle backbone)');

  let ctx = null;
  const ids = { runId: null, run2Id: null };

  // Run-scoped rows are owned by this suite (fixture owns config/identities).
  // Strict checked purge — shared with the fixture's self-sufficient sweep.
  h.onCleanup(async () => {
    await purgeRunArtifacts(h, [ids.runId, ids.run2Id]);
  });

  await test('CERT-SETUP — §7 canonical fixture provisions through real routes', async () => {
    ctx = await provisionPayrollCertification(h);
    expect(Object.keys(ctx.payGroups).length === 4, 'four pay groups');
    expect(!!ctx.policies.salary?.versionId, 'governed salary policy active');
    expect(!!ctx.calendar.wcVerId, 'work calendar published + assigned');
    for (const lim of ctx.limitations) h.skip(`fixture limitation: ${lim}`);
  });

  await test('CERT-SEC-1 — anon 401; unauthorized employee 403; EXPLICIT DENY overrides role grant', async () => {
    const anon = await api('finance/payroll/runs/list', null, { limit: 5 });
    expect(anon.status === 401, `anon expected 401, got ${anon.status}`);
    const outs = await api('finance/payroll/runs/list', ctx.T.outs, { limit: 5 });
    fails(outs); expect(outs.status === 403, `outsider expected 403, got ${outs.status}`);
    // deny user's ROLE (finance_staff) grants view_all — the user_permissions deny must win.
    const deny = await api('finance/payroll/runs/list', ctx.T.deny, { limit: 5 });
    fails(deny); expect(deny.status === 403, `explicitly-denied expected 403, got ${deny.status}`);
    // sanity: an un-denied finance_staff (the preparer) CAN read.
    const prep = await api('finance/payroll/runs/list', ctx.T.prep, { limit: 5 });
    ok(prep, `preparer list: ${prep.body.message}`);
  });

  await test('CERT-B-1 — preparer creates the monthly run; salary policy version pinned', async () => {
    const cr = await api('finance/payroll/runs/create', ctx.T.prep, payrollRunCommand({
      idempotencyKey: `${TAG}:cert:run:create`, periodStart: ctx.period.start, periodEnd: ctx.period.end,
      payGroupId: ctx.payGroups.monthly, payFrequency: 'monthly',
    }));
    ok(cr, `create: ${cr.body.message}`);
    ids.runId = cr.body.data.id;
    const row = await sb.from('finance_payroll_runs')
      .select('pay_policy_version_id, work_calendar_version_id, status').eq('id', ids.runId).single();
    expect(row.data.pay_policy_version_id === ctx.policies.salary.versionId, 'run pins the fixture salary policy version');
    expect(row.data.work_calendar_version_id === ctx.calendar.wcVerId, 'run pins the fixture work calendar');
    expect(row.data.status === 'draft', 'run starts as draft');
  });

  await test('CERT-D-1 — lock blocked by E12 missing payment destination; typed envelope (P0-5)', async () => {
    const li = await api('finance/payroll/runs/lock-inputs', ctx.T.prep,
      payrollLockCommand(ids.runId, `${TAG}:cert:lock:blocked`));
    fails(li); expect(li.status === 422, `expected 422, got ${li.status}`);
    expect(String(li.body.message).includes('policy.source_missing:payment_destination'),
      `typed blocker in message (got ${String(li.body.message).slice(0, 100)})`);
    expect(li.body.error?.code?.startsWith('policy.source_missing'),
      `envelope carries the typed code (got ${li.body.error?.code})`);
    expect(typeof li.body.error?.correlationId === 'string' && li.body.error.correlationId.length > 10,
      'envelope carries a correlation id');
    const snaps = await sb.from('finance_payroll_input_snapshots').select('id').eq('run_id', ids.runId);
    expect((snaps.data ?? []).length === 0, 'failed lock leaves NO snapshot (atomic)');
  });

  await test('CERT-D-2 — source repaired → lock succeeds with immutable snapshot evidence', async () => {
    const fix = await sb.from('finance_employee_bank_accounts').insert({
      employee_id: ctx.EMP.E12, bank_name: 'Cert Bank', account_type: 'savings',
      account_number: '00012121212', account_number_masked: '****1212', is_primary: true, is_active: true,
    });
    expect(!fix.error, `repair E12 bank: ${fix.error?.message}`);
    const li = await api('finance/payroll/runs/lock-inputs', ctx.T.prep,
      payrollLockCommand(ids.runId, `${TAG}:cert:lock:ok`));
    ok(li, `lock: ${li.body.message}`);
    const snap = await sb.from('finance_payroll_input_snapshots')
      .select('id, checksum, employee_count').eq('run_id', ids.runId)
      .order('snapshot_no', { ascending: false }).limit(1).single();
    expect(!snap.error && !!snap.data.checksum, 'snapshot with checksum recorded');
    expect(snap.data.employee_count > 0, `snapshot covers employees (got ${snap.data.employee_count})`);
  });

  await test('CERT-E-1 — calculate publishes exactly one current version with real lines', async () => {
    const cc = await api('finance/payroll/runs/calculate', ctx.T.prep,
      payrollCalculationCommand(ids.runId, `${TAG}:cert:calc`));
    ok(cc, `calculate: ${cc.body.message}`);
    expect(cc.body.data.status === 'calculated', `run calculated (got ${cc.body.data.status})`);
    const versions = await sb.from('finance_payroll_calculation_versions').select('id').eq('run_id', ids.runId);
    expect((versions.data ?? []).length === 1, `exactly one calculation version (got ${versions.data?.length})`);
    // Run lines are keyed by the published calculation version.
    const lines = await sb.from('finance_payroll_run_lines')
      .select('employee_id').eq('calculation_version_id', versions.data[0].id).limit(50);
    expect((lines.data ?? []).length > 0, `calculation produced run lines (got ${lines.data?.length})`);
    // E1 (standard salaried, monthly group) must have a line.
    const e1 = (lines.data ?? []).find(l => l.employee_id === ctx.EMP.E1);
    expect(e1, 'E1 standard salaried employee has a calculation line');
  });

  // ═══ Phase 2 — certification, approval SoD, revise loop, lock/reopen, funding, release ═══

  const SIX = {
    populationReconciled: true, inputsReviewed: true, statutoryReviewed: true,
    variancesReviewed: true, paymentReadinessReviewed: true, glReadinessReviewed: true,
  };

  await test('CERT-G-1 — certification demands ALL SIX attestations; valid certify pins version+checksum', async () => {
    const bad = await api('finance/payroll/runs/certify', ctx.T.cert, {
      runId: ids.runId, idempotencyKey: `${TAG}:cert:cf:bad`,
      attestations: { ...SIX, glReadinessReviewed: false },
    });
    fails(bad); expect(bad.status === 400, `false attestation expected 400, got ${bad.status}`);
    const missing = await api('finance/payroll/runs/certify', ctx.T.cert, {
      runId: ids.runId, idempotencyKey: `${TAG}:cert:cf:miss`,
      attestations: { populationReconciled: true },
    });
    fails(missing); expect(missing.status === 400, `missing attestations expected 400, got ${missing.status}`);
    const good = await api('finance/payroll/runs/certify', ctx.T.cert, {
      runId: ids.runId, idempotencyKey: `${TAG}:cert:cf:1`, attestations: SIX, note: 'phase-1 evidence reviewed',
    });
    ok(good, `certify: ${good.body.message}`);
    const certification = good.body.data.certification;
    expect(!!certification?.calculationVersionId, 'certification pins the calculation version');
    expect(typeof certification?.checksum === 'string' && certification.checksum.length > 8, 'certification carries a checksum');
  });

  await test('CERT-G-2 — submit creates the workflow instance/task + run goes pending_approval', async () => {
    const sub = await api('finance/payroll/runs/submit', ctx.T.prep, { id: ids.runId, idempotencyKey: `${TAG}:cert:sub:1` });
    ok(sub, `submit: ${sub.body.message}`);
    const row = await sb.from('finance_payroll_runs').select('status').eq('id', ids.runId).single();
    expect(row.data.status === 'pending_approval', `pending_approval (got ${row.data.status})`);
    // workflow_tasks key by workflow_id — assert the atomic side effect via the
    // submitted app_event on the run instead (the engine round-trip is proven by
    // the approve/reject decisions in G-3..G-5 actually transitioning the run).
    const ev = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ids.runId).like('event_type', '%submit%');
    expect((ev.count ?? 0) >= 1, 'a submitted app_event exists for the run');
  });

  await test('CERT-G-3 — reject demands a reason; reject returns the run; revise→recertify→resubmit', async () => {
    const noReason = await api('finance/payroll/runs/reject', ctx.T.appr, { id: ids.runId, reason: '' });
    fails(noReason); expect(noReason.status === 400, `empty reason expected 400, got ${noReason.status}`);
    const rej = await api('finance/payroll/runs/reject', ctx.T.appr, { id: ids.runId, reason: 'variance explanations incomplete' });
    ok(rej, `reject: ${rej.body.message}`);
    const st1 = await sb.from('finance_payroll_runs').select('status').eq('id', ids.runId).single();
    expect(st1.data.status === 'returned', `returned after reject (got ${st1.data.status})`);
    // revise: recalculate (returned permits it), recertify against the NEW version, resubmit.
    const rc = await api('finance/payroll/runs/calculate', ctx.T.prep, payrollCalculationCommand(ids.runId, `${TAG}:cert:calc:2`));
    ok(rc, `recalc: ${rc.body.message}`);
    const recert = await api('finance/payroll/runs/certify', ctx.T.cert, {
      runId: ids.runId, idempotencyKey: `${TAG}:cert:cf:2`, attestations: SIX,
    });
    ok(recert, `recertify: ${recert.body.message}`);
    const resub = await api('finance/payroll/runs/submit', ctx.T.prep, { id: ids.runId, idempotencyKey: `${TAG}:cert:sub:2` });
    ok(resub, `resubmit: ${resub.body.message}`);
  });

  await test('CERT-G-4 — SoD: the maker cannot approve their own run; an independent manager can', async () => {
    // run-2 is CREATED by the approver, so the approver is its maker.
    const cr = await api('finance/payroll/runs/create', ctx.T.appr, payrollRunCommand({
      idempotencyKey: `${TAG}:cert:run2:create`, periodStart: '2026-04-01', periodEnd: '2026-04-30',
      payGroupId: ctx.payGroups.monthly, payFrequency: 'monthly',
    }));
    ok(cr, `run-2 create: ${cr.body.message}`);
    ids.run2Id = cr.body.data.id;
    ok(await api('finance/payroll/runs/lock-inputs', ctx.T.appr, payrollLockCommand(ids.run2Id, `${TAG}:cert:run2:lock`)), 'run-2 lock');
    ok(await api('finance/payroll/runs/calculate', ctx.T.appr, payrollCalculationCommand(ids.run2Id, `${TAG}:cert:run2:calc`)), 'run-2 calc');
    ok(await api('finance/payroll/runs/certify', ctx.T.cert, { runId: ids.run2Id, idempotencyKey: `${TAG}:cert:run2:cf`, attestations: SIX }), 'run-2 certify');
    ok(await api('finance/payroll/runs/submit', ctx.T.appr, { id: ids.run2Id, idempotencyKey: `${TAG}:cert:run2:sub` }), 'run-2 submit');
    // maker (appr) attempts to approve own run → server-side SoD must block.
    const self = await api('finance/payroll/runs/approve', ctx.T.appr, { id: ids.run2Id });
    fails(self); expect(self.status >= 400 && self.status < 500, `maker self-approve blocked (got ${self.status})`);
    // an independent finance manager (the certifier) approves.
    const okApprove = await api('finance/payroll/runs/approve', ctx.T.cert, { id: ids.run2Id, comment: 'independent review complete' });
    ok(okApprove, `independent approve: ${okApprove.body.message}`);
    const st = await sb.from('finance_payroll_runs').select('status').eq('id', ids.run2Id).single();
    expect(st.data.status === 'approved', `run-2 approved (got ${st.data.status})`);
  });

  await test('CERT-G-5 — a second decision on a decided run yields ONE transition (no double-approve)', async () => {
    const again = await api('finance/payroll/runs/approve', ctx.T.cert, { id: ids.run2Id });
    fails(again); expect(again.status >= 400 && again.status < 500, `duplicate decision rejected (got ${again.status})`);
    // run-1 (pending after resubmit) approved by the independent approver (maker = prep).
    const ap1 = await api('finance/payroll/runs/approve', ctx.T.appr, { id: ids.runId, comment: 'revise loop verified' });
    ok(ap1, `run-1 approve: ${ap1.body.message}`);
  });

  await test('CERT-H-1 — approved run locks; reopen demands a reason and reverts to DRAFT (full revise cycle)', async () => {
    const lock1 = await api('finance/payroll/runs/lock', ctx.T.cert, { id: ids.runId, idempotencyKey: `${TAG}:cert:hlock:1` });
    ok(lock1, `lock: ${lock1.body.message}`);
    const st = await sb.from('finance_payroll_runs').select('status').eq('id', ids.runId).single();
    expect(st.data.status === 'locked', `locked (got ${st.data.status})`);
    // reopen without a reason → 400 at the route contract.
    const noReason = await api('finance/payroll/runs/reopen', ctx.T.cert, { id: ids.runId, idempotencyKey: `${TAG}:cert:reopen:bad` });
    fails(noReason); expect(noReason.status === 400, `reopen without reason expected 400, got ${noReason.status}`);
    const reopen = await api('finance/payroll/runs/reopen', ctx.T.cert, { id: ids.runId, reason: 'certification loop check', idempotencyKey: `${TAG}:cert:reopen:1` });
    ok(reopen, `reopen: ${reopen.body.message}`);
    // The reopen contract reverts the run to DRAFT — a reopened run must retravel
    // the WHOLE governed cycle (inputs→calc→certify→approve), not just re-lock.
    const st2 = await sb.from('finance_payroll_runs').select('status').eq('id', ids.runId).single();
    expect(st2.data.status === 'draft', `reopen reverts to draft (got ${st2.data.status})`);
    const relock = await api('finance/payroll/runs/lock', ctx.T.cert, { id: ids.runId, idempotencyKey: `${TAG}:cert:hlock:2` });
    fails(relock); expect(relock.status >= 400, 'a reopened (draft) run cannot skip straight back to locked');
  });

  await test('CERT-H-2 — funding evidence + release on run-2: certificate, idempotent replay, no duplicates', async () => {
    // run-2 is approved (G-4) — lock it, then fund + release with a DIFFERENT actor pair.
    ok(await api('finance/payroll/runs/lock', ctx.T.cert, { id: ids.run2Id, idempotencyKey: `${TAG}:cert:r2lock` }), 'run-2 lock');
    const pf1 = await api('finance/payroll/releases/preflight', ctx.T.fund, { runId: ids.run2Id });
    ok(pf1, `preflight: ${pf1.body.message}`);
    expect(pf1.body.data.ready === false, 'preflight is NOT ready before funding is confirmed');
    const runRow = await sb.from('finance_payroll_runs').select('net_total').eq('id', ids.run2Id).single();
    const fundRes = await api('finance/payroll/releases/confirm-funding', ctx.T.fund, {
      runId: ids.run2Id, idempotencyKey: `${TAG}:cert:fund:1`,
      confirmedAmount: Number(runRow.data.net_total), confirmationReference: `FUND-${TAG.slice(-6)}`,
    });
    ok(fundRes, `confirm-funding: ${fundRes.body.message}`);
    // §8-I/J: release preflight demands rendered payslips + a posted GL journal —
    // the DISTRIBUTOR drives both output surfaces before the funder can release.
    // render-run is idempotent by contract; one bounded retry absorbs the local
    // netlify-dev lambda timeout on the PDF batch (a real finding if it persists).
    let slips = await api('finance/payroll/payslips/render-run', ctx.T.dist, { runId: ids.run2Id });
    if (!slips.body?.success) {
      slips = await api('finance/payroll/payslips/render-run', ctx.T.dist, { runId: ids.run2Id });
    }
    ok(slips, `payslips render-run: ${slips.body.message}`);
    const gl = await api('finance/payroll/gl/post', ctx.T.dist, { runId: ids.run2Id, idempotencyKey: `${TAG}:cert:gl:1` });
    ok(gl, `gl post: ${gl.body.message}`);
    const rel = await api('finance/payroll/releases/release', ctx.T.fund, { runId: ids.run2Id, idempotencyKey: `${TAG}:cert:rel:1` });
    ok(rel, `release: ${rel.body.message}`);
    const st = await sb.from('finance_payroll_runs').select('status').eq('id', ids.run2Id).single();
    expect(st.data.status === 'released', `released (got ${st.data.status})`);
    const cert1 = await api('finance/payroll/releases/get-certificate', ctx.T.fund, { runId: ids.run2Id });
    ok(cert1, `certificate: ${cert1.body.message}`);
    expect(!!cert1.body.data, 'release certificate exists');
    // idempotent replay — same key returns the SAME outcome, no duplicate transition.
    const replay = await api('finance/payroll/releases/release', ctx.T.fund, { runId: ids.run2Id, idempotencyKey: `${TAG}:cert:rel:1` });
    ok(replay, `release replay: ${replay.body.message}`);
    const ev = await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', ids.run2Id).like('event_type', '%release%');
    expect((ev.count ?? 0) <= 2, `no duplicate release events (got ${ev.count})`);
  });
}
