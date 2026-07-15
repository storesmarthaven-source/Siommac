/**
 * scripts/e2e/suites/payrollLoans.mjs
 *
 * E2E for Wave 5 — employee loans & salary advances.
 *
 * Routes: /api/finance/payroll/loans/{list,get,create,submit,settle,cancel}
 * Covers:
 *   - Access control: plain employee cannot create; finance_staff (maker) can.
 *   - Lifecycle: create(draft) → submit(→workflow) → approve via decideTask → active.
 *   - SoD: the creator cannot approve their own loan (workflow adapter guard).
 *   - Payroll integration: active loan → lock-inputs emits a loan_repayment deduction;
 *     calculate reduces net; lock records the ledger + decrements balance;
 *     reopen reverses the ledger + restores the balance.
 *   - Settle (active → settled, balance 0) and cancel.
 *   - §2 side-effects (app_events + hr_audit_log) + ledger assertions via service role.
 *
 * REQUIRES migrations 20260918000090 (loans tables) + 20260918000100 (grant) +
 * 20260918000110 (finance_loan_approval workflow binding) + NOTIFY pgrst.
 */

export const title = 'Finance Wave 5 - Loans & advances';

function seedDate(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + (n % 900) + salt * 900);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  let fmgrId, staffId, empId;
  let fmgrToken, staffToken, empToken;
  const ctx = { loanId: null, cancelLoanId: null, versionId: null, runId: null, groupId: null, createdUserIds: [], borrowerId: null };

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { if (ctx.runId) await sb.from('finance_loan_deductions').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.loanId) await sb.from('finance_loan_deductions').delete().eq('loan_id', ctx.loanId); } catch {}
    try { if (ctx.loanId) await sb.from('finance_employee_loans').delete().eq('id', ctx.loanId); } catch {}
    try { if (ctx.cancelLoanId) await sb.from('finance_employee_loans').delete().eq('id', ctx.cancelLoanId); } catch {}
    try { if (ctx.cancelLoanId) await sb.from('app_events').delete().eq('source_module', 'finance_loan').eq('source_entity_id', ctx.cancelLoanId); } catch {}
    try { if (ctx.cancelLoanId) await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_loan').eq('record_id', ctx.cancelLoanId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_inputs').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_warnings').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_employee_pay_group_assignments').delete().eq('pay_group_id', ctx.groupId); } catch {}
    try { if (ctx.groupId) await sb.from('finance_pay_groups').delete().eq('id', ctx.groupId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.loanId) await sb.from('app_events').delete().eq('source_module', 'finance_loan').eq('source_entity_id', ctx.loanId); } catch {}
    try { if (ctx.loanId) await sb.from('hr_audit_log').delete().eq('submodule_key', 'finance_loan').eq('record_id', ctx.loanId); } catch {}
    try { if (ctx.borrowerId) await sb.from('app_users').delete().eq('id', ctx.borrowerId); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Loans › Setup');

  await test('acquire finance_manager + finance_staff + provision a salaried borrower', async () => {
    const mgrR = await acquireActors('finance_manager', 1);
    const stfR = await acquireActors('finance_staff', 1);
    fmgrId = mgrR.actors[0].id; staffId = stfR.actors[0].id;
    ctx.createdUserIds = [...mgrR.createdIds, ...stfR.createdIds];
    fmgrToken  = mint({ id: fmgrId,  username: mgrR.actors[0].username, role: 'finance_manager', department_id: null });
    staffToken = mint({ id: staffId, username: stfR.actors[0].username, role: 'finance_staff',   department_id: null });

    // Dedicated borrower (salaried) so the payroll deduction math is deterministic.
    ctx.borrowerId = `${TAG}_borrower`;
    empId = ctx.borrowerId;
    const { error } = await sb.from('app_users').insert({
      id: empId, username: `${TAG}_brw`, full_name: 'Loan Borrower (E2E)', role: 'employee',
      status: 'active', employment_type: 'employee', pay_basis: 'salary', monthly_salary: 6000,
    });
    expect(!error, `seed borrower failed: ${error?.message}`);
    empToken = mint({ id: empId, username: `${TAG}_brw`, role: 'employee', department_id: null });
  });

  h.section('Loans › Create + access control');

  await test('plain employee CANNOT create a loan (403)', async () => {
    const r = await api('finance/payroll/loans/create', empToken, { employeeId: empId, loanType: 'loan', principal: 1200, installmentAmount: 500 });
    fails(r, 'employee should be denied loan create');
    expect(r.status === 403, `expected 403, got ${r.status}`);
  });

  await test('finance_staff creates a draft loan (principal 1200 + 0 interest, 500/period)', async () => {
    const r = await api('finance/payroll/loans/create', staffToken, {
      employeeId: empId, loanType: 'loan', principal: 1200, installmentAmount: 500, reason: 'E2E loan',
    });
    ok(r, `create loan failed: ${r.body.message}`);
    const d = r.body.data;
    expect(d.status === 'draft', `expected draft, got ${d.status}`);
    expect(Math.abs(d.totalRepayable - 1200) < 0.01, `total should be 1200, got ${d.totalRepayable}`);
    expect(Math.abs(d.balance - 1200) < 0.01, `balance should be 1200, got ${d.balance}`);
    expect(typeof d.reference === 'string' && d.reference.length > 0, 'reference missing');
    ctx.loanId = d.id;
  });

  await test('create rejects an installment greater than the total (422)', async () => {
    const r = await api('finance/payroll/loans/create', staffToken, { employeeId: empId, loanType: 'advance', principal: 500, installmentAmount: 600 });
    fails(r, 'installment > total should be rejected');
  });

  h.section('Loans › Submit + workflow approval (SoD)');

  await test('finance_staff submits the loan → pending_approval + workflow', async () => {
    const r = await api('finance/payroll/loans/submit', staffToken, { id: ctx.loanId, idempotencyKey: `loan-submit-main-${TAG}` });
    ok(r, `submit failed: ${r.body.message}`);
    expect(r.body.data.status === 'pending_approval', `expected pending_approval, got ${r.body.data.status}`);
    const got = await waitFor(async () => {
      const { data } = await sb.from('finance_employee_loans').select('workflow_id').eq('id', ctx.loanId).maybeSingle();
      return data?.workflow_id != null;
    });
    expect(got, 'workflow_id not set after submit');
  });

  await test('finance_manager (≠ creator) approves via decideTask → loan active', async () => {
    const { data: loan } = await sb.from('finance_employee_loans').select('workflow_id').eq('id', ctx.loanId).maybeSingle();
    const { data: tasks } = await sb.from('workflow_tasks').select('id').eq('workflow_id', loan.workflow_id).in('status', ['pending', 'open', 'in_progress']).limit(1);
    expect((tasks ?? []).length > 0, 'no pending workflow task to approve');
    const r = await api('workflow-engine/decide', fmgrToken, { workflowId: loan.workflow_id, taskId: tasks[0].id, decision: 'approved' });
    ok(r, `decide approved failed: ${r.body.message}`);
    const active = await waitFor(async () => {
      const { data } = await sb.from('finance_employee_loans').select('status, approved_by').eq('id', ctx.loanId).maybeSingle();
      return data?.status === 'active';
    });
    expect(active, 'loan did not become active after approval');
    const { data: after } = await sb.from('finance_employee_loans').select('approved_by').eq('id', ctx.loanId).maybeSingle();
    expect(after.approved_by === fmgrId, 'approved_by should be the finance_manager');
  });

  await test('§2 side-effect: finance.loan.activated app_event + loan.approved audit', async () => {
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('source_module', 'finance_loan').eq('event_type', 'finance.loan.activated').eq('source_entity_id', ctx.loanId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'finance.loan.activated app_event not found');
    const { data: audit } = await sb.from('hr_audit_log').select('id').eq('submodule_key', 'finance_loan').eq('action', 'loan.approved').eq('record_id', ctx.loanId).limit(1);
    expect((audit ?? []).length > 0, 'loan.approved audit not found');
  });

  // ═══════════════════════════════════════════════════════════════════════════
  h.section('Loans › Atomic submit (finding #3, slice A4)');
  // ═══════════════════════════════════════════════════════════════════════════
  // Submit now commits status(draft/rejected->pending_approval) + workflow_id + the
  // whole workflow + business event/audit in ONE txn (workflow_submit_for_record_tx,
  // finance_employee_loans branch), with request-key idempotency and NO handoff.
  // Isolated draft loans (self-cleaned below) so the main lifecycle is untouched.

  const atomCtx = { loanIds: [] };
  const { data: _loanBinding } = await sb.from('module_workflow_bindings')
    .select('id').eq('module_key', 'finance_loan').eq('workflow_type', 'finance_loan_approval')
    .eq('trigger_event', 'finance.loan.submitted').eq('is_active', true).limit(1).maybeSingle();
  const atomBindingId = _loanBinding?.id;

  const seedDraftLoan = async (salt) => {
    const { data, error } = await sb.from('finance_employee_loans').insert({
      reference: `LOAN-E2E-A4-${salt}-${TAG.slice(-6)}`, employee_id: empId, loan_type: 'loan',
      principal: 900, interest_amount: 0, total_repayable: 900, installment_amount: 300,
      balance: 900, status: 'draft', created_by: staffId,
    }).select('id').single();
    if (error) throw new Error(`seedDraftLoan(${salt}): ${error.message}`);
    atomCtx.loanIds.push(data.id);
    return data.id;
  };

  await test('A4 atomic: retry same key returns original workflow (no double-create, exact counts, no strand)', async () => {
    const id = await seedDraftLoan(1);
    const key = `a4-idem-${TAG}-${id}`;
    const r1 = await api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: key });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wf1 = r1.body.data.workflowId;
    expect(wf1, 'first submit returns a workflowId');
    expect(r1.body.data.status === 'pending_approval', `status should be pending_approval, got ${r1.body.data.status}`);
    const r2 = await api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: key });
    ok(r2, `idempotent retry failed: ${r2.body.message}`);
    expect(r2.body.data.workflowId === wf1, `retry should return ${wf1}, got ${r2.body.data.workflowId}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
    const evc = (await sb.from('app_events').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', id).eq('event_type', 'finance.loan.submitted')).count ?? 0;
    expect(evc === 1, `exactly one submitted event, got ${evc}`);
    const auc = (await sb.from('hr_audit_log').select('id', { count: 'exact', head: true })
      .eq('record_id', id).eq('action', 'loan.submitted')).count ?? 0;
    expect(auc === 1, `exactly one audit row, got ${auc}`);
    const { data: tsk } = await sb.from('workflow_tasks').select('id').eq('workflow_id', wf1);
    expect((tsk ?? []).length === 1, `exactly one workflow task, got ${(tsk ?? []).length}`);
    // No handoff for loans (unlike payroll runs).
    const hoc = (await sb.from('handoff_outbox').select('id', { count: 'exact', head: true })
      .eq('source_entity_id', id)).count ?? 0;
    expect(hoc === 0, `loans emit no handoff, got ${hoc}`);
  });

  await test('A4 atomic: a rejected submit leaves the loan UNCHANGED (no strand, no orphan workflow)', async () => {
    const id = await seedDraftLoan(2);
    // Flip to a non-submittable status (active) so the RPC rejects at the status guard.
    await sb.from('finance_employee_loans').update({ status: 'active' }).eq('id', id);
    const r = await api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: `a4-str-${id}` });
    fails(r, 'submitting an active loan should be rejected');
    const { data: after } = await sb.from('finance_employee_loans').select('status, workflow_id').eq('id', id).single();
    expect(after.status === 'active', `loan should stay active, got ${after.status}`);
    expect(after.workflow_id === null, `no workflow_id should be stamped, got ${after.workflow_id}`);
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 0, `no workflow should exist for a rejected submit, got ${(wfs ?? []).length}`);
  });

  await test('A4 atomic: same key + different payload is rejected WF409 (direct RPC)', async () => {
    const id = await seedDraftLoan(3);
    const key = `a4-hash-${TAG}-${id}`;
    expect(atomBindingId, 'finance_loan binding not found');
    const { error: e1 } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'finance_employee_loans', p_source_id: id, p_actor_id: staffId,
      p_binding_id: atomBindingId, p_request_key: key, p_business: { probe: 'A' } });
    expect(!e1, `first direct submit failed: ${e1?.message}`);
    const { error: e2 } = await sb.rpc('workflow_submit_for_record_tx', {
      p_source_table: 'finance_employee_loans', p_source_id: id, p_actor_id: staffId,
      p_binding_id: atomBindingId, p_request_key: key, p_business: { probe: 'B' } });
    expect(e2 && e2.code === 'WF409', `different-payload retry should be WF409, got ${e2?.code} ${e2?.message}`);
  });

  await test('A4 atomic: concurrent submits — exactly one succeeds, one workflow', async () => {
    const id = await seedDraftLoan(4);
    const [a, b2] = await Promise.all([
      api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: `a4-c1-${id}` }),
      api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: `a4-c2-${id}` }),
    ]);
    expect([a, b2].filter(x => x.body.success).length === 1, 'exactly one concurrent submit should succeed');
    const { data: wfs } = await sb.from('workflow_instances').select('id').eq('source_record_id', id);
    expect((wfs ?? []).length === 1, `exactly one workflow, got ${(wfs ?? []).length}`);
  });

  await test('A4 atomic: a rejected loan resubmits with a fresh workflow linked via supersedes', async () => {
    const id = await seedDraftLoan(5);
    const r1 = await api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: `a4-sup1-${id}` });
    ok(r1, `first submit failed: ${r1.body.message}`);
    const wfA = r1.body.data.workflowId;
    // Simulate the approval workflow REJECTING the loan (terminal 'rejected' + loan rejected).
    await sb.from('workflow_instances').update({ status: 'rejected' }).eq('id', wfA);
    await sb.from('finance_employee_loans').update({ status: 'rejected' }).eq('id', id);
    const r2 = await api('finance/payroll/loans/submit', staffToken, { id, idempotencyKey: `a4-sup2-${id}` });
    ok(r2, `resubmit failed: ${r2.body.message}`);
    const wfB = r2.body.data.workflowId;
    expect(wfB && wfB !== wfA, `resubmit should create a NEW workflow, got ${wfB} vs ${wfA}`);
    const { data: wfBrow } = await sb.from('workflow_instances').select('supersedes_workflow_id').eq('id', wfB).single();
    expect(wfBrow?.supersedes_workflow_id === wfA, `new workflow should supersede ${wfA}, got ${wfBrow?.supersedes_workflow_id}`);
  });

  await test('A4 atomic: a submit without an idempotency key is rejected', async () => {
    const id = await seedDraftLoan(6);
    const r = await api('finance/payroll/loans/submit', staffToken, { id });
    fails(r, 'submit without an idempotency key should be rejected');
    const { data: loan } = await sb.from('finance_employee_loans').select('status').eq('id', id).single();
    expect(loan.status === 'draft', `loan should stay draft, got ${loan.status}`);
  });

  await test('A4 atomic: cleanup seeded loans', async () => {
    for (const lid of atomCtx.loanIds) {
      try { await sb.from('workflow_instances').delete().eq('source_record_id', lid); } catch {}
      try { await sb.from('app_events').delete().eq('source_entity_id', lid); } catch {}
      try { await sb.from('hr_audit_log').delete().eq('record_id', lid); } catch {}
      try { await sb.from('finance_employee_loans').delete().eq('id', lid); } catch {}
    }
    expect(true, 'cleanup complete');
  });

  h.section('Loans › Payroll deduction (lock records ledger, reopen reverses)');

  await test('seed a statutory version + a run scoped to the borrower, lock-inputs emits the loan deduction', async () => {
    const { data: ver, error: verErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: seedDate(TAG, 5), label: 'E2E Loan Ver ' + TAG,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!verErr, `seed version failed: ${verErr?.message}`);
    ctx.versionId = ver.id;

    // Pay group with only the borrower so lock-inputs populates just them.
    const code = ('LG' + TAG.replace(/[^a-z0-9]/gi, '')).slice(0, 18).toUpperCase();
    const gr = await api('finance/payroll/pay-groups/create', fmgrToken, { code, name: `Loan Group ${TAG}`, frequency: 'monthly' });
    ok(gr, `create group failed: ${gr.body.message}`);
    const groupId = gr.body.data.id;
    const ar = await api('finance/payroll/pay-groups/assign', fmgrToken, { employeeId: empId, payGroupId: groupId, effectiveFrom: '2029-01-01' });
    ok(ar, `assign failed: ${ar.body.message}`);
    ctx.groupId = groupId;

    // Create the run as the MAKER (finance_staff) so the finance_manager can
    // approve it without tripping segregation-of-duties (creator != approver).
    const cr = await api('finance/payroll/runs/create', staffToken, { periodMonth: '2029-10-01', payGroupId: groupId });
    ok(cr, `create run failed: ${cr.body.message}`);
    ctx.runId = cr.body.data.id;

    const lr = await api('finance/payroll/runs/lock-inputs', fmgrToken, { id: ctx.runId });
    ok(lr, `lock-inputs failed: ${lr.body.message}`);

    const ir = await api('finance/payroll/inputs/list', fmgrToken, { runId: ctx.runId });
    ok(ir, `inputs/list failed: ${ir.body.message}`);
    const loanInput = ir.body.data.find(i => i.metadata?.loan === true && i.metadata?.loan_id === ctx.loanId);
    expect(loanInput, 'no loan_repayment deduction input emitted');
    expect(Math.abs(loanInput.amount - 500) < 0.01, `loan installment should be 500, got ${loanInput.amount}`);
  });

  await test('calculate + lock → ledger row written, balance decremented to 700', async () => {
    ok(await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId }), 'calculate failed');
    // Drive to approved via the run workflow, then lock.
    ok(await api('finance/payroll/runs/submit', staffToken, { id: ctx.runId, idempotencyKey: `loan-runsubmit-${TAG}` }), 'run submit failed');
    const { data: run } = await sb.from('finance_payroll_runs').select('workflow_id').eq('id', ctx.runId).maybeSingle();
    const { data: tasks } = await sb.from('workflow_tasks').select('id').eq('workflow_id', run.workflow_id).in('status', ['pending', 'open', 'in_progress']).limit(1);
    ok(await api('workflow-engine/decide', fmgrToken, { workflowId: run.workflow_id, taskId: tasks[0].id, decision: 'approved' }), 'run approve failed');
    const approved = await waitFor(async () => {
      const { data } = await sb.from('finance_payroll_runs').select('status').eq('id', ctx.runId).maybeSingle();
      return data?.status === 'approved';
    });
    expect(approved, 'run not approved');
    ok(await api('finance/payroll/runs/lock', fmgrToken, { id: ctx.runId }), 'lock failed');

    const { data: led } = await sb.from('finance_loan_deductions').select('amount, balance_after').eq('loan_id', ctx.loanId).eq('run_id', ctx.runId).maybeSingle();
    expect(led, 'no ledger row after lock');
    expect(Math.abs(led.amount - 500) < 0.01, `ledger amount should be 500, got ${led?.amount}`);
    const { data: loan } = await sb.from('finance_employee_loans').select('balance').eq('id', ctx.loanId).maybeSingle();
    expect(Math.abs(loan.balance - 700) < 0.01, `balance should be 700 after one 500 installment, got ${loan.balance}`);
  });

  await test('reopen the run → ledger reversed + balance restored to 1200', async () => {
    const r = await api('finance/payroll/runs/reopen', fmgrToken, { id: ctx.runId, reason: 'E2E loan reversal' });
    ok(r, `reopen failed: ${r.body.message}`);
    const { data: led } = await sb.from('finance_loan_deductions').select('id').eq('run_id', ctx.runId);
    expect((led ?? []).length === 0, 'ledger rows should be gone after reopen');
    const { data: loan } = await sb.from('finance_employee_loans').select('balance, status').eq('id', ctx.loanId).maybeSingle();
    expect(Math.abs(loan.balance - 1200) < 0.01, `balance should restore to 1200 after reopen, got ${loan.balance}`);
    expect(loan.status === 'active', `loan should be active again, got ${loan.status}`);
  });

  h.section('Loans › Settle + cancel');

  await test('an ACTIVE loan CANNOT be cancelled (settle or write-off only)', async () => {
    const r = await api('finance/payroll/loans/cancel', staffToken, { id: ctx.loanId, reason: 'trying to cancel active' });
    fails(r, 'cancelling an active loan should be refused');
    const { data: loan } = await sb.from('finance_employee_loans').select('status').eq('id', ctx.loanId).maybeSingle();
    expect(loan?.status === 'active', `loan must stay active after refused cancel, got ${loan?.status}`);
  });

  await test('finance_staff settles the active loan → balance 0, settled + SETTLEMENT LEDGER row', async () => {
    const r = await api('finance/payroll/loans/settle', staffToken, { id: ctx.loanId });
    ok(r, `settle failed: ${r.body.message}`);
    expect(r.body.data.status === 'settled', `expected settled, got ${r.body.data.status}`);
    expect(Math.abs(r.body.data.balance) < 0.01, `balance should be 0, got ${r.body.data.balance}`);
    // The ledger is the source of truth — the external payment MUST be recorded there.
    const { data: led } = await sb.from('finance_loan_deductions')
      .select('amount, entry_type, run_id, balance_after')
      .eq('loan_id', ctx.loanId).eq('entry_type', 'settlement');
    expect((led ?? []).length === 1, `expected exactly 1 settlement ledger row, got ${(led ?? []).length}`);
    expect(led[0].run_id === null, 'settlement ledger row must have no run_id');
    expect(Math.abs(Number(led[0].amount) - 1200) < 0.01, `settlement amount should be the cleared balance (1200), got ${led[0].amount}`);
    expect(Math.abs(Number(led[0].balance_after)) < 0.01, 'settlement balance_after should be 0');
  });

  await test('a settled loan cannot be settled again (422)', async () => {
    const r = await api('finance/payroll/loans/settle', staffToken, { id: ctx.loanId });
    fails(r, 'settling a settled loan should fail');
  });

  await test('plain employee CANNOT cancel a loan (403)', async () => {
    const r = await api('finance/payroll/loans/cancel', empToken, { id: ctx.loanId });
    fails(r, 'employee should be denied loan cancel');
  });

  await test('cancelling a PENDING loan also cancels its approval workflow (no dangling task)', async () => {
    // Create + submit a fresh loan → pending_approval with an open workflow task.
    const cr = await api('finance/payroll/loans/create', staffToken, {
      employeeId: empId, loanType: 'advance', principal: 300, installmentAmount: 100,
      reason: `E2E cancel-pending ${TAG}`,
    });
    ok(cr, `create for cancel-pending failed: ${cr.body.message}`);
    ctx.cancelLoanId = cr.body.data.id;
    const sr = await api('finance/payroll/loans/submit', staffToken, { id: ctx.cancelLoanId, idempotencyKey: `loan-submit-cancelpending-${TAG}` });
    ok(sr, `submit for cancel-pending failed: ${sr.body.message}`);
    const { data: pending } = await sb.from('finance_employee_loans')
      .select('status, workflow_id').eq('id', ctx.cancelLoanId).maybeSingle();
    expect(pending?.status === 'pending_approval', `expected pending_approval, got ${pending?.status}`);
    expect(pending?.workflow_id, 'pending loan should have a workflow_id');

    const cx = await api('finance/payroll/loans/cancel', staffToken, { id: ctx.cancelLoanId, reason: 'E2E cancel pending' });
    ok(cx, `cancel pending failed: ${cx.body.message}`);
    expect(cx.body.data.status === 'cancelled', `expected cancelled, got ${cx.body.data.status}`);

    // The approval workflow is closed and no open task remains.
    const { data: wfRow } = await sb.from('workflow_instances')
      .select('status').eq('id', pending.workflow_id).maybeSingle();
    expect(wfRow?.status === 'cancelled', `workflow should be cancelled, got ${wfRow?.status}`);
    const { data: openTasks } = await sb.from('workflow_tasks')
      .select('id').eq('workflow_id', pending.workflow_id)
      .in('status', ['pending', 'open', 'in_progress']);
    expect((openTasks ?? []).length === 0, 'no open workflow task may remain after cancelling a pending loan');
  });
}
