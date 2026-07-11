/**
 * scripts/e2e/suites/payrollStatutoryForms.mjs
 * E2E for Payroll statutory forms (Wave 7): employer profile + TD4 / TD4 Summary.
 * Requires migration 20260919000000 (finance_statutory_forms + statutory-forms
 * bucket + bir_file_number) applied.
 */
export const title = 'Payroll — Statutory Forms (employer profile + TD4)';

// Distinct tax year per suite run (finance_payroll_runs.period_month is unique
// table-wide) — hash TAG into a high, unlikely-to-collide year.
function taxYearFromTag(tag) {
  let n = 7;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  return 2040 + (n % 120);
}

export default async function run(h) {
  const { api, test, expect, ok, fails, mint, sb, TAG, acquireActors } = h;

  const YEAR = taxYearFromTag(TAG);
  let fmgr1Id, fmgr2Id, emp1Id, emp2Id;
  let fmgr1T, empT;
  const ctx = { versionId: null, runId: null, profileSnapshot: undefined, statProfileIds: [], createdUserIds: [], td4FormId: null, summaryFormId: null };

  const waitFor = async (check, ms = 8000) => {
    const t0 = Date.now();
    while (Date.now() - t0 < ms) { if (await check()) return true; await new Promise(r => setTimeout(r, 300)); }
    return false;
  };

  h.onCleanup(async () => {
    try { await sb.from('finance_statutory_forms').delete().eq('tax_year', YEAR); } catch {}
    try { await sb.from('finance_statutory_forms').delete().eq('period_start', `${YEAR}-06-01`); } catch {}
    try {
      for (const folder of [`td4/${YEAR}`, 'td4_summary', `ni184`, `ni187`]) {
        const { data: objs } = await sb.storage.from('statutory-forms').list(folder);
        const keys = (objs ?? [])
          .filter(o => folder.startsWith('td4/') || o.name.startsWith(`${YEAR}-`))
          .map(o => `${folder}/${o.name}`);
        if (keys.length) await sb.storage.from('statutory-forms').remove(keys);
      }
    } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_run_lines').delete().eq('run_id', ctx.runId); } catch {}
    try { if (ctx.runId) await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
    try { if (ctx.versionId) await sb.from('finance_statutory_versions').delete().eq('id', ctx.versionId); } catch {}
    try { if (ctx.statProfileIds.length) await sb.from('hr_employee_statutory_profiles').delete().in('id', ctx.statProfileIds); } catch {}
    // Restore/remove the shared employerProfile settings singleton.
    try {
      if (ctx.profileSnapshot === null) await sb.from('settings').delete().eq('key', 'employerProfile');
      else if (ctx.profileSnapshot !== undefined) await sb.from('settings').upsert({ key: 'employerProfile', value: ctx.profileSnapshot }, { onConflict: 'key' });
    } catch {}
    try { await sb.from('app_events').delete().eq('source_module', 'finance_payroll').eq('source_entity_type', 'employer_profile'); } catch {}
    try { if (ctx.createdUserIds.length) await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
  });

  h.section('Statutory Forms > Setup');

  await test('acquire finance managers + employees; snapshot employer profile', async () => {
    const m = await acquireActors('finance_manager', 2);
    const e = await acquireActors('employee', 2);
    [{ id: fmgr1Id }, { id: fmgr2Id }] = m.actors;
    [{ id: emp1Id }, { id: emp2Id }] = e.actors;
    ctx.createdUserIds = [...m.createdIds, ...e.createdIds];
    fmgr1T = mint({ id: fmgr1Id, username: m.actors[0].username, role: 'finance_manager', department_id: null });
    empT   = mint({ id: emp1Id,  username: e.actors[0].username, role: 'employee', department_id: null });
    const { data: snap } = await sb.from('settings').select('value').eq('key', 'employerProfile').maybeSingle();
    ctx.profileSnapshot = snap ? snap.value : null;   // null => row didn't exist, delete on cleanup
  });

  await test('seed statutory version + a LOCKED run in the tax year + run lines', async () => {
    const { data: ver, error: vErr } = await sb.from('finance_statutory_versions').insert({
      effective_from: `${YEAR}-01-01`, label: `E2E SF ${TAG}`,
      paye_personal_allowance: 90000, paye_band1_ceiling: 1000000, paye_band1_rate: 0.25, paye_band2_rate: 0.30,
      hs_monthly_threshold: 469.99, hs_weekly_high: 8.25, hs_weekly_low: 4.80,
    }).select('id').single();
    expect(!vErr, `seed version failed: ${vErr?.message}`);
    ctx.versionId = ver.id;
    const { data: rn, error: rErr } = await sb.from('finance_payroll_runs').insert({
      run_no: `RUN-SF-${TAG.slice(-6)}`, period_month: `${YEAR}-06-15`,
      statutory_version_id: ctx.versionId, status: 'locked', employee_count: 2,
    }).select('id').single();
    expect(!rErr, `seed run failed: ${rErr?.message}`);
    ctx.runId = rn.id;
    const { error: lErr } = await sb.from('finance_payroll_run_lines').insert([
      { run_id: ctx.runId, employee_id: emp1Id, gross: 10000, taxable_gross: 10000, paye: 2000, nis_employee: 460.20, nis_employer: 920.40, health_surcharge: 33.00, net: 7506.80 },
      { run_id: ctx.runId, employee_id: emp2Id, gross: 6000,  taxable_gross: 6000,  paye: 500,  nis_employee: 276.12, nis_employer: 552.24, health_surcharge: 33.00, net: 5190.88 },
    ]);
    expect(!lErr, `seed run lines failed: ${lErr?.message}`);
    // Employee statutory profiles (NIS # + TIN) for the TD4 employee block.
    const { data: sp, error: spErr } = await sb.from('hr_employee_statutory_profiles').upsert([
      { employee_id: emp1Id, jurisdiction: 'TT', nis_number: 'NIS111', bir_file_number: 'BIR111' },
      { employee_id: emp2Id, jurisdiction: 'TT', nis_number: 'NIS222', bir_file_number: 'BIR222' },
    ], { onConflict: 'employee_id,jurisdiction' }).select('id');
    expect(!spErr, `seed statutory profiles failed: ${spErr?.message}`);
    ctx.statProfileIds = (sp ?? []).map(r => r.id);
  });

  h.section('Statutory Forms > Employer profile');

  await test('employee is DENIED employer-profile/update', async () => {
    fails(await api('finance/statutory-forms/employer-profile/update', empT, { legalName: 'X' }), 'employee denied profile update');
  });

  await test('finance_manager sets the employer profile (BIR + NIS required)', async () => {
    const r = await api('finance/statutory-forms/employer-profile/update', fmgr1T, {
      legalName: `E2E Employer ${TAG}`, birFileNumber: 'EMP-BIR-1', nisEmployerNumber: 'EMP-NIS-1',
      addressLine1: '1 Test Ave', city: 'Port of Spain', country: 'Trinidad and Tobago',
    });
    ok(r, `profile update failed: ${r.body.message}`);
    expect(r.body.data.birFileNumber === 'EMP-BIR-1' && r.body.data.nisEmployerNumber === 'EMP-NIS-1', 'employer identifiers not persisted');
    const gotEvent = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id').eq('event_type', 'finance.payroll.employer_profile.updated').limit(1);
      return (data ?? []).length > 0;
    });
    expect(gotEvent, 'employer_profile.updated app_event not found');
  });

  await test('employer-profile/get returns the saved profile (view perm)', async () => {
    const r = await api('finance/statutory-forms/employer-profile/get', fmgr1T, {});
    ok(r, `profile get failed: ${r.body.message}`);
    expect(r.body.data.legalName?.includes(TAG), 'legalName not returned');
  });

  h.section('Statutory Forms > TD4 generation');

  await test('employee is DENIED td4/generate-year', async () => {
    fails(await api('finance/statutory-forms/td4/generate-year', empT, { taxYear: YEAR }), 'employee denied generate');
  });

  await test('generate-year produces one TD4 per employee + a TD4 Summary, reconciling to run lines', async () => {
    const r = await api('finance/statutory-forms/td4/generate-year', fmgr1T, { taxYear: YEAR });
    ok(r, `generate-year failed: ${r.body.message}`);
    expect(r.body.data.employeeForms === 2, `expected 2 employee forms, got ${r.body.data.employeeForms}`);
    ctx.summaryFormId = r.body.data.summary.id;
    // Summary totals reconcile: emoluments 16000, PAYE 2500, NIS 736.32, HS 66.00
    const t = r.body.data.summary.totals;
    expect(Math.abs(t.totalEmoluments - 16000) < 0.01, `emoluments ${t.totalEmoluments}`);
    expect(Math.abs(t.payeDeducted - 2500) < 0.01, `paye ${t.payeDeducted}`);
    expect(Math.abs(t.nisEmployee - 736.32) < 0.01, `nis ${t.nisEmployee}`);
    // DB: 2 td4 rows + 1 summary for the year
    const { data: forms } = await sb.from('finance_statutory_forms').select('id, form_type, employee_id').eq('tax_year', YEAR).eq('status', 'generated');
    const td4 = (forms ?? []).filter(f => f.form_type === 'td4');
    const summary = (forms ?? []).filter(f => f.form_type === 'td4_summary');
    expect(td4.length === 2, `expected 2 td4 rows, got ${td4.length}`);
    expect(summary.length === 1, `expected 1 td4_summary row, got ${summary.length}`);
    ctx.td4FormId = td4[0]?.id;
  });

  await test('side-effect: statutory_form.generated app_event written', async () => {
    const got = await waitFor(async () => {
      const { data } = await sb.from('app_events').select('id')
        .eq('event_type', 'finance.payroll.statutory_form.generated')
        .eq('source_entity_id', ctx.summaryFormId).limit(1);
      return (data ?? []).length > 0;
    });
    expect(got, 'statutory_form.generated app_event not found for the summary');
  });

  await test('re-generating supersedes the prior TD4 set (no duplicate current forms)', async () => {
    ok(await api('finance/statutory-forms/td4/generate-year', fmgr1T, { taxYear: YEAR }), 're-generate failed');
    const { data: current } = await sb.from('finance_statutory_forms').select('id, form_type').eq('tax_year', YEAR).eq('status', 'generated');
    const td4 = (current ?? []).filter(f => f.form_type === 'td4');
    expect(td4.length === 2, `expected 2 CURRENT td4 after re-gen, got ${td4.length}`);
  });

  await test('single-employee td4/generate reconciles to that employee', async () => {
    const r = await api('finance/statutory-forms/td4/generate', fmgr1T, { employeeId: emp1Id, taxYear: YEAR });
    ok(r, `td4/generate failed: ${r.body.message}`);
    expect(Math.abs(r.body.data.totals.totalEmoluments - 10000) < 0.01, `emp1 emoluments ${r.body.data.totals.totalEmoluments}`);
  });

  h.section('Statutory Forms > NIBTT NI184 + NI187');

  await test('employee is DENIED ni/generate', async () => {
    fails(await api('finance/statutory-forms/ni/generate', empT, { year: YEAR, month: 6 }), 'employee denied NI generate');
  });

  await test('ni/generate produces NI184 + NI187 reconciling to run-line NIS', async () => {
    // Seeded run is period_month YEAR-06-15 → month 6.
    const r = await api('finance/statutory-forms/ni/generate', fmgr1T, { year: YEAR, month: 6 });
    ok(r, `ni/generate failed: ${r.body.message}`);
    const t = r.body.data.ni184.totals;
    // EE 460.20+276.12=736.32 · ER 920.40+552.24=1472.64 · total 2208.96 · insurable 16000
    expect(Math.abs(t.eeContribution - 736.32) < 0.01, `NIS EE ${t.eeContribution}`);
    expect(Math.abs(t.erContribution - 1472.64) < 0.01, `NIS ER ${t.erContribution}`);
    expect(Math.abs(t.total - 2208.96) < 0.01, `NIS total ${t.total}`);
    expect(Math.abs(t.insurableEarnings - 16000) < 0.01, `insurable ${t.insurableEarnings}`);
    ctx.ni184FormId = r.body.data.ni184.id;
    const { data: forms } = await sb.from('finance_statutory_forms').select('form_type').eq('period_start', `${YEAR}-06-01`).eq('status', 'generated');
    const types = new Set((forms ?? []).map(f => f.form_type));
    expect(types.has('ni184') && types.has('ni187'), 'expected both ni184 + ni187 rows for the period');
  });

  await test('NI184 CSV data file reconciles', async () => {
    const csv = await api('finance/statutory-forms/signed-url', fmgr1T, { id: ctx.ni184FormId, which: 'data' });
    ok(csv, `ni184 csv signed-url failed: ${csv.body.message}`);
    const res = await fetch(csv.body.data.signedUrl);
    expect(res.ok, `fetch ni184 csv failed: ${res.status}`);
    const text = await res.text();
    expect(text.includes('2208.96'), 'NI184 CSV should contain the total NIS remittance');
  });

  h.section('Statutory Forms > List + download');

  await test('list returns generated forms (view perm); employee denied', async () => {
    const r = await api('finance/statutory-forms/list', fmgr1T, { taxYear: YEAR });
    ok(r, `list failed: ${r.body.message}`);
    expect(Array.isArray(r.body.data) && r.body.data.length >= 3, `expected >=3 forms, got ${r.body.data?.length}`);
    fails(await api('finance/statutory-forms/list', empT, {}), 'employee denied list');
  });

  await test('signed-url downloads the summary PDF and its CSV data file', async () => {
    const pdf = await api('finance/statutory-forms/signed-url', fmgr1T, { id: ctx.summaryFormId, which: 'pdf' });
    ok(pdf, `pdf signed-url failed: ${pdf.body.message}`);
    expect(typeof pdf.body.data.signedUrl === 'string' && pdf.body.data.signedUrl.length > 0, 'pdf signedUrl missing');
    const csv = await api('finance/statutory-forms/signed-url', fmgr1T, { id: ctx.summaryFormId, which: 'data' });
    ok(csv, `csv signed-url failed: ${csv.body.message}`);
    const res = await fetch(csv.body.data.signedUrl);
    expect(res.ok, `fetch csv failed: ${res.status}`);
    const text = await res.text();
    expect(text.includes('TOTAL') && text.includes('16000.00'), 'CSV data file should contain the reconciled total');
  });

  await test('employee is DENIED signed-url', async () => {
    fails(await api('finance/statutory-forms/signed-url', empT, { id: ctx.summaryFormId }), 'employee denied signed-url');
  });
}
