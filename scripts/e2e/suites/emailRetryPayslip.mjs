/**
 * scripts/e2e/suites/emailRetryPayslip.mjs
 *
 * The payslip retry handler: rebuild from the IMMUTABLE payroll snapshot, never re-run the
 * business operation.
 *
 * ⭐ THE ASSERTION THAT MATTERS: `finance_payslip_deliveries` count is UNCHANGED across a retry.
 * `deliverPayslip()` writes a fresh row per attempt and derives the idempotency key from that
 * row's id — so if the handler ever called it, a retry would mint a new payroll delivery record
 * AND a new key, breaking "no duplicate business records" and "same key" in one move. Every case
 * below brackets the retry with that count.
 *
 * ⛔ NO REAL EMAIL. Guard cases refuse before rendering; the full-reconstruct case renders the PDF
 * for real and is then refused at recipient validation, so the provider is never contacted.
 */

export const title = 'Platform — payslip retry handler';

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG } = h;
  const { admin } = h.users;
  const A = mint(admin);

  const ids = { employees: [], payslips: [], runs: [], lines: [], deliveries: [] };

  h.onCleanup(async () => {
    if (ids.deliveries.length) {
      try { await sb.from('app_events').delete().in('source_entity_id', ids.deliveries); } catch {}
      try { await sb.from('email_deliveries').delete().in('id', ids.deliveries); } catch {}
    }
    for (const [table, key, list] of [
      ['finance_payslip_deliveries', 'payslip_id', ids.payslips],
      ['finance_payslips', 'id', ids.payslips],
      ['finance_payroll_run_lines', 'id', ids.lines],
      ['finance_payroll_runs', 'id', ids.runs],
      ['app_users', 'id', ids.employees],
    ]) {
      if (list.length) { try { await sb.from(table).delete().in(key, list); } catch {} }
    }
  });

  const seedEmployee = async (over = {}) => {
    const id = `PSR-EMP-${TAG}-${ids.employees.length}`;
    const { error } = await sb.from('app_users').insert({
      id, username: `${TAG}_psr_${ids.employees.length}`.toLowerCase(), full_name: `Payslip Retry ${TAG}`,
      role: 'employee', status: 'active', employment_type: 'employee', ...over,
    });
    expect(!error, `seed employee: ${error?.message ?? ''}`);
    ids.employees.push(id);
    return id;
  };

  /**
   * A payslip row that BORROWS an existing locked payroll run and one of its lines.
   *
   * ⭐ Creating a run from scratch is not viable and not the point: finance_payroll_runs carries a
   * pay-policy check constraint and a chain of required references, and reproducing that here
   * would test the payroll fixture rather than the retry handler. The run and line are IMMUTABLE
   * source data read by buildPayslipSnapshot — borrowing them is exactly how a real payslip
   * relates to them. Only the payslip row (and the email delivery) belong to this suite, and both
   * are cleaned up.
   *
   * `finance_payslips.run_id` and `run_line_id` are NOT NULL, which is why a real pair is needed
   * at all; `employee_id` on the PAYSLIP is what the handler resolves the recipient from, so each
   * case still controls its own employee.
   */
  let borrowed = null;
  const borrowRunAndLine = async () => {
    if (borrowed) return borrowed;
    const { data: runs } = await sb.from('finance_payroll_runs')
      .select('id').in('status', ['locked', 'exported']).limit(20);
    for (const run of runs ?? []) {
      const { data: line } = await sb.from('finance_payroll_run_lines')
        .select('id').eq('run_id', run.id).limit(1).maybeSingle();
      if (line) { borrowed = { runId: run.id, lineId: line.id }; return borrowed; }
    }
    return null;
  };

  const seedPayslip = async (employeeId, { filePath = null } = {}) => {
    const src = await borrowRunAndLine();
    if (!src) return { skip: 'no locked payroll run with a line exists to attach a payslip to' };

    const ps = await sb.from('finance_payslips').insert({
      payslip_no: `PS-${TAG}-${ids.payslips.length}`, employee_id: employeeId,
      run_id: src.runId, run_line_id: src.lineId,
      ...(filePath ? { file_path: filePath } : {}),
    }).select('id').single();
    if (ps.error) return { skip: `payslip fixture unavailable: ${ps.error.message}` };
    ids.payslips.push(ps.data.id);
    return { payslipId: ps.data.id, runId: src.runId };
  };

  const seedDelivery = async (payslipId, status = 'failed') => {
    const key = `payslip:${payslipId ?? 'none'}:${TAG}:${ids.deliveries.length}`;
    const { data, error } = await sb.from('email_deliveries').insert({
      module_key: 'finance_payroll', use_case: 'payslip', idempotency_key: key,
      recipient: `psr-${TAG}@example.com`, sender: 'Siomac <no-reply@example.com>',
      subject: `Payslip retry ${TAG}`, provider: 'resend', status,
      source_module: 'finance_payroll', source_entity_type: 'payslip', source_entity_id: payslipId,
    }).select('id, idempotency_key').single();
    expect(!error, `seed delivery: ${error?.message ?? ''}`);
    ids.deliveries.push(data.id);
    return data;
  };

  const financeDeliveryCount = async () => {
    const { count, error } = await sb.from('finance_payslip_deliveries')
      .select('id', { count: 'exact', head: true });
    expect(!error, `count finance_payslip_deliveries: ${error?.message ?? ''}`);
    return count ?? 0;
  };

  /** Bracket a retry with the payroll-delivery count — the core invariant. */
  const retryWithCount = async deliveryId => {
    const before = await financeDeliveryCount();
    const r = await api('email/retry', A, { deliveryId });
    const after = await financeDeliveryCount();
    expect(after === before,
      `⛔ retry created a payroll delivery record — finance_payslip_deliveries ${before} → ${after}. ` +
      'The handler must rebuild from the snapshot, never call deliverPayslip().');
    return r;
  };

  h.section('Payslip retry › Guards (nothing rendered, nothing sent)');

  await test('a missing payslip refuses with origin_missing', async () => {
    const d = await seedDelivery(null);
    const r = await retryWithCount(d.id);
    fails(r, 'no payslip to rebuild from');
    expect(r.body.data.refusal === 'origin_missing', `expected origin_missing, got ${r.body.data.refusal}`);
  });

  await test('an unrendered payslip refuses — there is nothing to attach', async () => {
    const emp = await seedEmployee({ email: `psr-${TAG}@example.com`, date_of_birth: '1990-03-07' });
    const seeded = await seedPayslip(emp, { filePath: null });
    if (seeded.skip) { expect(false, seeded.skip); return; }

    const d = await seedDelivery(seeded.payslipId);
    const r = await retryWithCount(d.id);
    fails(r, 'the PDF was never rendered');
    expect(r.body.data.refusal === 'origin_invalid', `expected origin_invalid, got ${r.body.data.refusal}`);
    expect(/render/i.test(r.body.message ?? ''), `it must say to render first — got ${r.body.message}`);
  });

  await test('⛔ no date of birth ⇒ REFUSED, because a payslip is never emailed unprotected', async () => {
    // The same safety rule the original send enforces. A retry must not become the path that
    // ships an unprotected payslip.
    const emp = await seedEmployee({ email: `psr-nodob-${TAG}@example.com`, date_of_birth: null });
    const seeded = await seedPayslip(emp, { filePath: 'payslips/fake.pdf' });
    if (seeded.skip) { expect(false, seeded.skip); return; }

    const d = await seedDelivery(seeded.payslipId);
    const r = await retryWithCount(d.id);
    fails(r, 'no password can be derived');
    expect(r.body.data.refusal === 'origin_invalid', `expected origin_invalid, got ${r.body.data.refusal}`);
    expect(/password-protected|self-service/i.test(r.body.message ?? ''),
      `it must explain the protection rule — got ${r.body.message}`);
  });

  await test('no email address on file refuses rather than rendering a PDF it cannot send', async () => {
    const emp = await seedEmployee({ email: null, personal_email: null, date_of_birth: '1990-03-07' });
    const seeded = await seedPayslip(emp, { filePath: 'payslips/fake.pdf' });
    if (seeded.skip) { expect(false, seeded.skip); return; }

    const d = await seedDelivery(seeded.payslipId);
    const r = await retryWithCount(d.id);
    fails(r, 'nowhere to send it');
    expect(r.body.data.refusal === 'origin_invalid', `expected origin_invalid, got ${r.body.data.refusal}`);
  });

  h.section('Payslip retry › Same row, same key');

  await test('⭐ a refused retry leaves the delivery row and its key untouched', async () => {
    const emp = await seedEmployee({ email: `psr-key-${TAG}@example.com`, date_of_birth: null });
    const seeded = await seedPayslip(emp, { filePath: 'payslips/fake.pdf' });
    if (seeded.skip) { expect(false, seeded.skip); return; }

    const d = await seedDelivery(seeded.payslipId);
    await retryWithCount(d.id);

    const { data: rows } = await sb.from('email_deliveries')
      .select('id, idempotency_key, status').eq('idempotency_key', d.idempotency_key);
    expect((rows ?? []).length === 1, `exactly one delivery keeps this key, found ${(rows ?? []).length}`);
    expect(rows[0].id === d.id, 'it is the SAME row');
    expect(rows[0].idempotency_key === d.idempotency_key, 'the key is unchanged — no retry key was minted');
  });

  await test('⛔ bounced and complained payslips are never re-sent', async () => {
    const emp = await seedEmployee({ email: `psr-b-${TAG}@example.com`, date_of_birth: '1990-03-07' });
    const seeded = await seedPayslip(emp, { filePath: 'payslips/fake.pdf' });
    if (seeded.skip) { expect(false, seeded.skip); return; }

    for (const status of ['bounced', 'complained']) {
      const d = await seedDelivery(seeded.payslipId, status);
      const r = await retryWithCount(d.id);
      fails(r, `${status} payslip must not be re-sent`);
      expect(r.body.data.refusal === 'not_retryable_status', `expected not_retryable_status, got ${r.body.data.refusal}`);
    }
  });

  h.section('Payslip retry › Full reconstruction from the snapshot');

  await test('⭐ the PDF is rebuilt from the immutable snapshot and stops at validation', async () => {
    // The deepest path available without transmitting: a real snapshot, a real password-protected
    // render, then refusal at recipient validation because the address is deliberately invalid.
    // Proves the reconstruction runs end-to-end AND still creates no payroll delivery record.
    const emp = await seedEmployee({ email: 'not-a-valid-address', date_of_birth: '1990-03-07' });
    const seeded = await seedPayslip(emp, { filePath: 'payslips/fake.pdf' });
    if (seeded.skip) {
      // Stated, not silently skipped: a fixture that cannot be built is a coverage gap to report.
      expect(false, `full-reconstruct coverage unavailable — ${seeded.skip}`);
      return;
    }

    const d = await seedDelivery(seeded.payslipId);
    const r = await retryWithCount(d.id);
    fails(r, 'the rebuilt message has an invalid recipient, so nothing was transmitted');
    expect(/not-a-valid-address/.test(r.body.message ?? ''),
      `the rebuild used the CURRENT address from the employee record — got ${r.body.message}`);
  });
}
