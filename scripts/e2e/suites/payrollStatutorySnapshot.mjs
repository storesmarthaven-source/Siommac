/**
 * scripts/e2e/suites/payrollStatutorySnapshot.mjs
 *
 * E2E for the statutory-version SNAPSHOT guarantee (audit remediation 2a).
 *
 * calculateRun must resolve PAYE/health-surcharge rates AND NIS classes from the
 * run's snapshotted statutory_version_id (fixed at create time) — NEVER from the
 * currently-active version. So activating a new statutory version mid-cycle can
 * never retro-change an in-flight run's figures.
 *
 * Proof (pollution-free — the ACTIVE version is never touched):
 *   1. Create run R against the active version V1; lock-inputs; calculate → PAYE_v1.
 *   2. Build a throwaway V2 (a copy of V1 with a DIFFERENT paye_band1_rate, kept
 *      INACTIVE) + copy V1's NIS classes onto it.
 *   3. Repoint ONLY run R's snapshot to V2 (service-role), then recalculate.
 *   4. Assert PAYE moved to V2's rate (PAYE_v2 != PAYE_v1). Under the old bug
 *      (calc read the active version) PAYE would have stayed PAYE_v1.
 *   5. NIS is unchanged (classes copied identically) — only the rate-driven field
 *      moved, confirming the snapshot binding is per-version.
 *
 * No new migration required (finance_statutory_versions / finance_nis_classes
 * already exist). Every created row is tagged and removed in onCleanup.
 */

export const title = 'Payroll — statutory-version snapshot binding (2a)';

// A far-future, uncommon effective_from so the throwaway V2 never collides with
// seeded versions on unique(effective_from, jurisdiction).
const V2_EFFECTIVE_FROM = '2099-12-28';
const V2_LABEL_MARK = 'snapshot-2a V2';

function seedDateFromTag(tag, salt) {
  let n = salt >>> 0;
  for (let i = 0; i < tag.length; i++) n = (Math.imul(n, 31) + tag.charCodeAt(i)) >>> 0;
  const day = 20820 + (salt % 10) * 400 + (n % 365);
  const d = new Date(Date.UTC(1970, 0, 1));
  d.setUTCDate(d.getUTCDate() + day);
  return d.toISOString().slice(0, 10);
}

export default async function run(h) {
  const { api, test, expect, ok, mint, sb, TAG, acquireActors } = h;

  const ctx = { runId: null, v1Id: null, v2Id: null, createdUserIds: [] };
  let fmgrId, fmgrToken;

  h.onCleanup(async () => {
    if (ctx.runId) {
      for (const t of ['finance_payslips', 'finance_payroll_run_lines',
        'finance_payroll_run_warnings', 'finance_payroll_run_inputs']) {
        try { await sb.from(t).delete().eq('run_id', ctx.runId); } catch {}
      }
      try { await sb.from('finance_payroll_runs').delete().eq('id', ctx.runId); } catch {}
      try {
        await sb.from('hr_audit_log').delete().eq('record_id', ctx.runId);
        await sb.from('app_events').delete().eq('source_entity_id', ctx.runId);
      } catch {}
    }
    // Remove the throwaway V2 (this run's, plus any orphan from a crashed prior run).
    try {
      const { data: orphans } = await sb.from('finance_statutory_versions')
        .select('id').eq('effective_from', V2_EFFECTIVE_FROM).eq('is_active', false);
      for (const o of (orphans ?? [])) {
        await sb.from('finance_nis_classes').delete().eq('statutory_version_id', o.id);
        await sb.from('finance_statutory_versions').delete().eq('id', o.id);
      }
    } catch {}
    if (ctx.createdUserIds.length) {
      try { await sb.from('app_users').delete().in('id', ctx.createdUserIds); } catch {}
    }
  });

  // ── Setup ─────────────────────────────────────────────────────────────────
  h.section('Statutory Snapshot › Setup');

  await test('an active statutory version exists (V1)', async () => {
    const { data } = await sb.from('finance_statutory_versions')
      .select('id').eq('is_active', true).eq('jurisdiction', 'TT').limit(1);
    expect((data ?? []).length > 0, 'No active statutory version — activate one before running this suite');
    ctx.v1Id = (data ?? [])[0]?.id ?? null;
  });

  await test('acquire a finance_manager + a well-paid salaried employee', async () => {
    const mgrR = await acquireActors('finance_manager', 1, {});
    // High salary so chargeable income clears the personal allowance and PAYE > 0,
    // making the run rate-sensitive (a rate change is observable).
    const empR = await acquireActors('employee', 1, { pay_basis: 'salary', monthly_salary: 30000.00 });
    fmgrId = mgrR.actors[0].id;
    ctx.createdUserIds = [...mgrR.createdIds, ...empR.createdIds];
    fmgrToken = mint({ id: fmgrId, username: mgrR.actors[0].username, role: 'finance_manager', department_id: null });
  });

  // ── Baseline calculate against V1 ───────────────────────────────────────────
  h.section('Statutory Snapshot › Calculate against V1');

  let payeV1 = null, nisV1 = null;

  await test('create + lock-inputs + calculate a run (snapshots V1)', async () => {
    const cr = await api('finance/payroll/runs/create', fmgrToken, {
      periodMonth: seedDateFromTag(TAG, 61), payFrequency: 'monthly', weeksInPeriod: 4.333,
    });
    ok(cr, `create failed: ${cr.body.message}`);
    expect(cr.body.data.statutoryVersionId === ctx.v1Id,
      `run should snapshot the active version V1 (${ctx.v1Id}), got ${cr.body.data.statutoryVersionId}`);
    ctx.runId = cr.body.data.id;

    const li = await api('finance/payroll/runs/lock-inputs', fmgrToken, { id: ctx.runId });
    ok(li, `lock-inputs failed: ${li.body.message}`);
    expect(li.body.data.employeeCount > 0, 'employeeCount should be > 0 (need a salaried actor in the run)');

    const cc = await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId });
    ok(cc, `calculate failed: ${cc.body.message}`);
    expect(cc.body.data.status === 'calculated', `status should be calculated, got ${cc.body.data.status}`);
  });

  await test('capture the well-paid employee line PAYE under V1 (must be > 0)', async () => {
    const r = await api('finance/payroll/run-lines/list', fmgrToken, { runId: ctx.runId });
    ok(r, `run-lines/list failed: ${r.body.message}`);
    const empUserId = ctx.createdUserIds.find(id => id !== fmgrId);
    const line = r.body.data.find(l => l.employeeId === empUserId) ?? r.body.data[0];
    expect(line, 'no run line found for the salaried employee');
    payeV1 = Number(line.paye);
    nisV1 = Number(line.nisEmployee);
    expect(payeV1 > 0, `PAYE under V1 should be > 0 for a 30000 salary (got ${payeV1}) — else the rate change is unobservable`);
  });

  // ── Build a differently-rated, INACTIVE V2 + copy V1 classes ────────────────
  h.section('Statutory Snapshot › Build throwaway V2');

  await test('clone V1 into an inactive V2 with a doubled PAYE band-1 rate', async () => {
    // Clear any orphan V2 from a crashed prior run before inserting.
    const { data: orphans } = await sb.from('finance_statutory_versions')
      .select('id').eq('effective_from', V2_EFFECTIVE_FROM).eq('is_active', false);
    for (const o of (orphans ?? [])) {
      await sb.from('finance_nis_classes').delete().eq('statutory_version_id', o.id);
      await sb.from('finance_statutory_versions').delete().eq('id', o.id);
    }

    const { data: v1row, error: v1err } = await sb.from('finance_statutory_versions')
      .select('*').eq('id', ctx.v1Id).single();
    expect(!v1err && v1row, `could not load V1 row: ${v1err?.message}`);

    const { id: _id, created_at: _c, updated_at: _u, activated_at: _a, ...rest } = v1row;
    const doubled = Math.min(Number(v1row.paye_band1_rate) * 2, 0.9);
    const v2insert = {
      ...rest,
      label: `${TAG} ${V2_LABEL_MARK}`,
      effective_from: V2_EFFECTIVE_FROM,
      paye_band1_rate: doubled,
      is_active: false,
      is_current: false,
    };
    const { data: v2row, error: v2err } = await sb.from('finance_statutory_versions')
      .insert(v2insert).select('id').single();
    expect(!v2err && v2row?.id, `V2 insert failed: ${v2err?.message}`);
    ctx.v2Id = v2row.id;

    // Copy V1's NIS classes onto V2 so calc's listNisClasses(V2) matches V1 exactly
    // (isolates the change to PAYE — NIS must stay identical).
    const { data: v1classes } = await sb.from('finance_nis_classes')
      .select('*').eq('statutory_version_id', ctx.v1Id);
    const copies = (v1classes ?? []).map(({ id: _cid, created_at: _cc, updated_at: _cu, ...c }) => ({
      ...c, statutory_version_id: ctx.v2Id,
    }));
    if (copies.length > 0) {
      const { error: clsErr } = await sb.from('finance_nis_classes').insert(copies);
      expect(!clsErr, `copying NIS classes to V2 failed: ${clsErr?.message}`);
    }

    // The active version must remain V1 (we never activated V2).
    const { data: active } = await sb.from('finance_statutory_versions')
      .select('id').eq('is_active', true).eq('jurisdiction', 'TT').single();
    expect(active.id === ctx.v1Id, 'active version must still be V1 — V2 must stay inactive');
  });

  // ── Repoint the run to V2 and recalculate ───────────────────────────────────
  h.section('Statutory Snapshot › Recalculate honors the run snapshot');

  await test('repoint run snapshot to V2, recalculate → PAYE follows V2, not the active version', async () => {
    const { error: repErr } = await sb.from('finance_payroll_runs')
      .update({ statutory_version_id: ctx.v2Id }).eq('id', ctx.runId);
    expect(!repErr, `repoint failed: ${repErr?.message}`);

    const cc = await api('finance/payroll/runs/calculate', fmgrToken, { id: ctx.runId });
    ok(cc, `recalculate failed: ${cc.body.message}`);

    const r = await api('finance/payroll/run-lines/list', fmgrToken, { runId: ctx.runId });
    ok(r, `run-lines/list failed: ${r.body.message}`);
    const empUserId = ctx.createdUserIds.find(id => id !== fmgrId);
    const line = r.body.data.find(l => l.employeeId === empUserId) ?? r.body.data[0];
    const payeV2 = Number(line.paye);
    const nisV2 = Number(line.nisEmployee);

    // The snapshot binding: calc used the run's version (V2), so the doubled band-1
    // rate raised PAYE. Under the old active-version bug PAYE would equal payeV1.
    expect(payeV2 > payeV1,
      `PAYE should rise under V2's doubled rate (V1=${payeV1}, V2=${payeV2}) — calc must read the run snapshot, not the active version`);
    // NIS classes were copied identically → NIS must be unchanged.
    expect(nisV2 === nisV1,
      `NIS should be unchanged (V1=${nisV1}, V2=${nisV2}) — only the PAYE rate differed between versions`);
  });
}
