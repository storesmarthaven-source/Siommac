/**
 * scripts/seed-payroll-command-center.mjs
 *
 * Realistic, idempotent demo seed for the Payroll Command Center, scoped to the CURRENT
 * reporting window (first day of this month → last day of next month — what the page queries
 * by default). Populates: pay runs across the window in several states, calculation versions
 * (gross/net/population → KPIs + register), control findings (attention + readiness gates),
 * funding confirmations (+ a funding gap), payroll activity events (activity feed), and one
 * approval workflow task assigned to the superadmin ("Assigned to you").
 *
 * Run:  node scripts/seed-payroll-command-center.mjs
 * Re-run safe: it deletes prior `PAY-SEED-*` runs + their satellites first.
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { fileURLToPath } from 'node:url';
import { dirname, resolve } from 'node:path';
import { payrollRunSeed } from './e2e/helpers/payrollRun.mjs';

const ROOT = resolve(dirname(fileURLToPath(import.meta.url)), '..');
const env = Object.fromEntries(
  readFileSync(resolve(ROOT, '.env'), 'utf8').split(/\r?\n/).filter(l => l && !l.startsWith('#') && l.includes('='))
    .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim()]; }),
);
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const SUPERADMIN = 'USR-9F174AB5';
const SEED = 'PAY-SEED';
const die = (m, e) => { console.error('✗', m, e?.message ?? e ?? ''); process.exit(1); };
const okOr = (label, error) => { if (error) die(label, error); };

// ── Date helpers scoped to the CURRENT window ────────────────────────────────
const now = new Date();
const Y = now.getFullYear(), M = now.getMonth();               // M: 0-based
const d = (yy, mm, dd) => `${yy}-${String(mm + 1).padStart(2, '0')}-${String(dd).padStart(2, '0')}`;
const lastDay = (yy, mm) => new Date(yy, mm + 1, 0).getDate();
const clamp = (yy, mm, dd) => d(yy, mm, Math.min(dd, lastDay(yy, mm)));
const nextY = M === 11 ? Y + 1 : Y, nextM = (M + 1) % 12;
// A "due within 3 days" date (real Date normalises month/year rollover) — drives the CRITICAL band:
// a run that pays in 2 days while still carrying an open blocker finding is at risk of missing release.
const soon = new Date(Y, M, now.getDate() + 2);
const soonPay = d(soon.getFullYear(), soon.getMonth(), soon.getDate());
const soonCut = d(Y, M, now.getDate());

async function main() {
  console.log(`Seeding Payroll Command Center for window ${d(Y, M, 1)} → ${clamp(nextY, nextM, 31)}`);

  // ── Prerequisites ──────────────────────────────────────────────────────────
  const { data: ver, error: ve } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1).maybeSingle();
  okOr('active statutory version', ve);
  if (!ver) die('no active statutory version — activate one first');
  const versionId = ver.id;

  // Runs are unique per (pay_group, period_start, period_end, run_type), so spread across groups.
  const { data: allGroups, error: ge } = await sb.from('finance_pay_groups').select('id, name');
  okOr('pay groups', ge);
  const byName = Object.fromEntries((allGroups ?? []).map(g => [g.name, g]));
  const pick = names => names.map(n => byName[n]).find(Boolean) ?? (allGroups ?? [])[0];
  const GROUPS = {
    monthly: pick(['Monthly Staff', 'Monthly Salaried']),
    weekly:  pick(['Weekly Wages', 'Weekly Field']),
    rota:    pick(['Fortnightly', 'Semi-Monthly']),
  };
  if (!GROUPS.monthly || !GROUPS.weekly || !GROUPS.rota) die('need at least 3 pay groups in the DB');
  console.log(`  statutory version ${versionId} · groups: ${[...new Set(Object.values(GROUPS).map(g => g.name))].join(', ')}`);

  // ── Idempotent cleanup of prior seed ─────────────────────────────────────────
  const { data: prior } = await sb.from('finance_payroll_runs').select('id, workflow_id').like('run_no', `${SEED}-%`);
  const priorIds = (prior ?? []).map(r => r.id);
  const priorWfIds = (prior ?? []).map(r => r.workflow_id).filter(Boolean);
  if (priorIds.length) {
    await sb.from('finance_payroll_runs').update({ current_calculation_version_id: null, current_input_snapshot_id: null }).in('id', priorIds);
    await sb.from('app_events').delete().eq('source_module', 'finance_payroll').in('source_entity_id', priorIds);
    if (priorWfIds.length) {
      await sb.from('workflow_tasks').delete().in('workflow_id', priorWfIds);
      await sb.from('workflow_instances').delete().in('id', priorWfIds);
    }
    await sb.from('finance_payroll_control_findings').delete().in('run_id', priorIds);
    await sb.from('finance_payroll_funding_confirmations').delete().in('run_id', priorIds);
    await sb.from('finance_payroll_calculation_versions').delete().in('run_id', priorIds);
    await sb.from('finance_payroll_input_snapshots').delete().in('run_id', priorIds);
    await sb.from('finance_payroll_runs').delete().in('id', priorIds);
    console.log(`  cleared ${priorIds.length} prior seed run(s)`);
  }

  // ── Run definitions (this month unless noted) ────────────────────────────────
  const RUNS = [
    { key: 'M01',  grp: 'monthly', name: 'Monthly Salaried',       freq: 'monthly', type: 'scheduled',  status: 'calculated',       gross: 7814920, net: 6900420, emp: 302, pay: clamp(Y, M, 31),         cutoff: clamp(Y, M, 25), findings: [['blocker', 'population'], ['blocker', 'funding']], funding: null },
    { key: 'W04',  grp: 'weekly',  name: 'Weekly Field',           freq: 'weekly',  type: 'scheduled',  status: 'pending_approval', gross: 700000,  net: 612480,  emp: 84,  pay: clamp(Y, M, 24),         cutoff: clamp(Y, M, 20), findings: [], funding: 612480, assign: true },
    { key: 'R14',  grp: 'rota',    name: 'Rotational Operations A', freq: 'monthly', type: 'scheduled',  status: 'calculated',       gross: 1400000, net: 1286440, emp: 84,  pay: clamp(Y, M, 31),         cutoff: clamp(Y, M, 25), findings: [['warning', 'input']], funding: null },
    { key: 'OC02', grp: 'monthly', name: 'Monthly Salaried',       freq: 'monthly', type: 'off_cycle',  status: 'released',         gross: 200000,  net: 188760,  emp: 17,  pay: clamp(Y, M, 22),         cutoff: clamp(Y, M, 18), findings: [], funding: 188760 },
    { key: 'W03',  grp: 'weekly',  name: 'Weekly Field',           freq: 'weekly',  type: 'correction', status: 'returned',         gross: 620000,  net: 598230,  emp: 82,  pay: clamp(Y, M, 17),         cutoff: clamp(Y, M, 13), findings: [['blocker', 'variance']], funding: null, correctionOf: 'W04' },
    { key: 'M02',  grp: 'monthly', name: 'Monthly Salaried',       freq: 'monthly', type: 'scheduled',  status: 'calculated',       gross: 7900000, net: 7010000, emp: 305, pay: clamp(nextY, nextM, 31), cutoff: clamp(nextY, nextM, 25), findings: [['warning', 'funding']], funding: null },
    // CRITICAL: pays in 2 days with an OPEN blocker still unresolved → criticalCount, 'critical' health band.
    { key: 'C01',  grp: 'weekly',  name: 'Weekly Field',           freq: 'weekly',  type: 'off_cycle',  status: 'calculated',       gross: 480000,  net: 441000,  emp: 58,  pay: soonPay,                cutoff: soonCut,                 findings: [['blocker', 'statutory']], funding: null },
  ];

  const ids = {};
  let created = 0;
  for (const r of RUNS) {
    const row = payrollRunSeed({
      run_no: `${SEED}-${r.key}`, periodStart: `${r.pay.slice(0, 8)}01`,
      periodEnd: r.pay, runType: r.type, payFrequency: r.freq, sequenceNo: 1,
      statutory_version_id: versionId, status: r.status, pay_group_id: GROUPS[r.grp].id, pay_group: r.name,
      gross_total: r.gross, net_total: r.net, deduction_total: Math.max(0, r.gross - r.net),
      employee_count: r.emp, pay_date: r.pay, cut_off_date: r.cutoff, created_by: SUPERADMIN,
      ...(r.correctionOf && ids[r.correctionOf] ? { source_run_id: ids[r.correctionOf] } : {}),
    });
    const { data: run, error: re } = await sb.from('finance_payroll_runs').insert(row).select('id').single();
    okOr(`run ${r.key}`, re);
    ids[r.key] = run.id;

    const { data: snap, error: se } = await sb.from('finance_payroll_input_snapshots')
      .insert({ run_id: run.id, snapshot_no: 1, checksum: `seed-snap-${r.key}`, employee_count: r.emp, input_count: r.emp }).select('id').single();
    okOr(`snapshot ${r.key}`, se);
    const { data: cv, error: ce } = await sb.from('finance_payroll_calculation_versions').insert({
      run_id: run.id, input_snapshot_id: snap.id, version_no: 1, checksum: `seed-cv-${r.key}`,
      employee_count: r.emp, gross_total: r.gross, deduction_total: Math.max(0, r.gross - r.net), net_total: r.net,
      nis_employer_total: Math.round(r.gross * 0.086), statutory_version_id: versionId, published_by: SUPERADMIN,
    }).select('id').single();
    okOr(`calc version ${r.key}`, ce);
    await sb.from('finance_payroll_runs').update({ current_calculation_version_id: cv.id, current_input_snapshot_id: snap.id }).eq('id', run.id);

    for (const [severity, domain] of r.findings) {
      const { error } = await sb.from('finance_payroll_control_findings').insert({
        run_id: run.id, calculation_version_id: cv.id, source_type: 'seed', source_id: `${SEED}:${r.key}:${domain}`,
        finding_type: 'seed_control', domain, severity, state: 'open',
        title: `${severity === 'blocker' ? 'Blocking' : 'Review'} · ${domain.replace(/_/g, ' ')}`,
        detail: 'Seeded demo finding.', due_at: r.cutoff,
      });
      okOr(`finding ${r.key}`, error);
    }
    if (r.funding != null) {
      const { error } = await sb.from('finance_payroll_funding_confirmations').insert({
        run_id: run.id, calculation_version_id: cv.id, confirmation_no: 1, confirmed_amount: r.funding,
        confirmation_reference: `${SEED}-${r.key}-FND`, checksum: `seed-fund-${r.key}`, confirmed_by: SUPERADMIN,
      });
      okOr(`funding ${r.key}`, error);
    }

    // Assigned approval workflow task (for "Assigned to you")
    if (r.assign) {
      try {
        const { data: tpl } = await sb.from('workflow_templates').select('id').limit(1).maybeSingle();
        if (!tpl) throw new Error('no workflow_templates row to reference');
        const { data: wf, error: wfe } = await sb.from('workflow_instances').insert({
          template_id: tpl.id, status: 'in_progress', priority: 'medium', workflow_no: `WF-${SEED}-${r.key}`,
          module_key: 'finance_payroll', workflow_type: 'finance_payroll_approval',
          source_record_id: run.id, source_record_ref: `${SEED}-${r.key}`,
          current_step_key: 'approve', requested_by: SUPERADMIN, owner_id: SUPERADMIN,
          started_at: new Date().toISOString(), metadata: {},
        }).select('id').single();
        if (wfe) throw wfe;
        await sb.from('finance_payroll_runs').update({ workflow_id: wf.id }).eq('id', run.id);
        const { error: te } = await sb.from('workflow_tasks').insert({
          workflow_id: wf.id, step_key: 'approve', step_name: 'Review Payroll Approval', step_type: 'approve',
          task_title: 'Approve Weekly Field payroll', assigned_to: SUPERADMIN, status: 'open',
          due_at: `${r.pay}T16:00:00Z`, is_required: true, metadata: {},
        });
        if (te) throw te;
        console.log(`  · assigned approval task on ${r.key}`);
      } catch (e) { console.warn(`  ! skipped workflow task on ${r.key}: ${e.message}`); }
    }
    created++;
  }

  // ── Activity feed (allowlisted payroll events) ───────────────────────────────
  const { data: runsForEvents } = await sb.from('finance_payroll_runs').select('id, run_no').like('run_no', `${SEED}-%`);
  const byKey = Object.fromEntries((runsForEvents ?? []).map(r => [r.run_no.replace(`${SEED}-`, ''), r.id]));
  const nowIso = new Date().toISOString();
  const ago = mins => new Date(Date.now() - mins * 60000).toISOString();
  const EVENTS = [
    { event_type: 'finance.payroll.run.certified',          key: 'W04', at: ago(28) },
    { event_type: 'finance.payroll.run.calculated',         key: 'M01', at: ago(46) },
    { event_type: 'finance.payroll.run.funding_confirmed',  key: 'OC02', at: ago(63) },
    { event_type: 'finance.payroll.run.released',           key: 'OC02', at: ago(70) },
    { event_type: 'finance.payroll.run.submitted',          key: 'W04', at: ago(85) },
  ];
  for (const e of EVENTS) {
    if (!byKey[e.key]) continue;
    const { error } = await sb.from('app_events').insert({
      source_module: 'finance_payroll', source_entity_type: 'finance_payroll_run', source_entity_id: byKey[e.key],
      event_type: e.event_type, actor_user_id: SUPERADMIN, payload: {}, created_at: e.at,
    });
    if (error) console.warn(`  ! event ${e.event_type}: ${error.message}`);
  }

  console.log(`✓ Seeded ${created} runs, findings, funding, ${EVENTS.length} activity events for the current window.`);
  console.log('  Open Finance → Payroll and reload — the Command Center should be fully populated.');
  process.exit(0);
}

main().catch(e => die('seed failed', e));
