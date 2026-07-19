/**
 * scripts/e2e/scale-controlCenter.mjs
 *
 * Scale verification for finance_payroll_control_center over the COMPLETE dataset WITH REALISTIC JOINS.
 * Seeds N runs, each with an input snapshot + current calculation version + 2 version lines + a blocker
 * finding + a funding confirmation, so the aggregation exercises the fnd/fund/cert/att/bank joins (not
 * bare run rows). Times the RPC, asserts exact correctness at scale, prints the EXPLAIN query, then
 * chunk-cleans in FK-safe order — and EXITS NON-ZERO if any cleanup chunk fails (no silent leak).
 * Run: node scripts/e2e/scale-controlCenter.mjs
 */
import { createClient } from '@supabase/supabase-js';
import { readFileSync } from 'node:fs';
import { randomUUID } from 'node:crypto';
import { payrollRunSeed } from './helpers/payrollRun.mjs';

const N = Number(process.env.SCALE_N ?? 10000);
const YEAR = '2035';
const CHUNK = 1000;

const env = Object.fromEntries(readFileSync('.env', 'utf8').split('\n')
  .filter(l => l.includes('=') && !l.trimStart().startsWith('#'))
  .map(l => { const i = l.indexOf('='); return [l.slice(0, i).trim(), l.slice(i + 1).trim().replace(/^["']|["']$/g, '')]; }));
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });
const TAG = `CCSCALE-${Date.now()}`;
const pct = (s, p) => s[Math.min(s.length - 1, Math.floor(p * s.length))];
let cleanupFailed = false;
const del = async (t, col, vals) => {
  for (let i = 0; i < vals.length; i += 500) {
    const { error } = await sb.from(t).delete().in(col, vals.slice(i, i + 500));
    if (error) { cleanupFailed = true; console.warn(`  cleanup ${t} @${i}: ${error.message}`); }
  }
};

async function main() {
  const { data: sv } = await sb.from('finance_statutory_versions').select('id').eq('is_active', true).limit(1);
  const versionId = sv?.[0]?.id; if (!versionId) throw new Error('no active statutory version');
  const { data: emps } = await sb.from('app_users').select('id').limit(2);
  const empIds = (emps ?? []).map(r => r.id); if (empIds.length < 2) throw new Error('need 2 app_users for version lines');

  console.log(`Seeding ${N} runs WITH calc-version + lines + finding + funding…`);
  const runIds = [], snapIds = [], cvIds = [], findingIds = [];
  const t0 = Date.now();
  const ins = async (t, rows) => { const { error } = await sb.from(t).insert(rows); if (error) throw new Error(`${t}: ${error.message}`); };
  for (let start = 0; start < N; start += CHUNK) {
    const runs = [], snaps = [], cvs = [], lines = [], finds = [], funds = [], ptrs = [];
    for (let i = start; i < Math.min(start + CHUNK, N); i++) {
      const runId = randomUUID(), snapId = randomUUID(), cvId = randomUUID();
      runIds.push(runId); snapIds.push(snapId); cvIds.push(cvId);
      runs.push(payrollRunSeed({
        id: runId, run_no: `${TAG}-${i}`, periodMonth: `${YEAR}-06-01`, runType: 'off_cycle',
        statutory_version_id: versionId, status: 'draft', sequence_no: i + 1,
        employee_count: 2, gross_total: 1000, net_total: 900, deduction_total: 100,
      }));
      snaps.push({ id: snapId, run_id: runId, snapshot_no: 1, checksum: `s-${i}`, employee_count: 2, input_count: 2 });
      cvs.push({ id: cvId, run_id: runId, input_snapshot_id: snapId, version_no: 1, checksum: `c-${i}`,
        employee_count: 2, gross_total: 1000, deduction_total: 100, net_total: 900, nis_employer_total: 0,
        statutory_version_id: versionId });
      ptrs.push({ id: runId, cv: cvId, snap: snapId });
      lines.push({ calculation_version_id: cvId, run_id: runId, employee_id: empIds[0], net: 450 });
      lines.push({ calculation_version_id: cvId, run_id: runId, employee_id: empIds[1], net: 450 });
      const fId = randomUUID(); findingIds.push(fId);
      finds.push({ id: fId, run_id: runId, calculation_version_id: cvId, source_type: 'scale', source_id: `${TAG}-${i}`,
        finding_type: 'scale', domain: 'statutory', severity: 'blocker', state: 'open', title: 'scale blocker', detail: 's' });
      funds.push({ run_id: runId, calculation_version_id: cvId, confirmation_no: 1, confirmed_amount: 900,
        confirmation_reference: `${TAG}-${i}`, checksum: `f-${i}`, confirmed_by: empIds[0] });
    }
    // Circular FKs: runs (no pointers) → snapshots → calc_versions → set run pointers → children.
    await ins('finance_payroll_runs', runs);
    await ins('finance_payroll_input_snapshots', snaps);
    await ins('finance_payroll_calculation_versions', cvs);
    for (let j = 0; j < ptrs.length; j += 100)
      await Promise.all(ptrs.slice(j, j + 100).map(p =>
        sb.from('finance_payroll_runs').update({ current_calculation_version_id: p.cv, current_input_snapshot_id: p.snap }).eq('id', p.id)));
    await ins('finance_payroll_calculation_version_lines', lines);
    await ins('finance_payroll_control_findings', finds);
    await ins('finance_payroll_funding_confirmations', funds);
    process.stdout.write(`\r  seeded ${runIds.length}/${N}`);
  }
  console.log(`\n  seed done in ${((Date.now() - t0) / 1000).toFixed(1)}s`);

  const args = { p_from: `${YEAR}-01-01`, p_to: `${YEAR}-12-31`, p_pay_group_ids: null, p_actor_id: empIds[0],
    p_actor_role: 'admin', p_tab: 'all', p_search: null, p_limit: 10,
    p_cursor_pay_date: null, p_cursor_period_end: null, p_cursor_run_no: null, p_cursor_id: null };
  console.log(`Timing over ${N} joined runs (8 calls)…`);
  const times = []; let sample = null;
  for (let k = 0; k < 8; k++) { const s = Date.now(); const { data, error } = await sb.rpc('finance_payroll_control_center', args); if (error) throw new Error(`rpc: ${error.message}`); times.push(Date.now() - s); sample = data; }
  const srt = [...times].sort((a, b) => a - b);
  console.log(`  latency ms — min ${srt[0]} · p50 ${pct(srt, 0.5)} · p95 ${pct(srt, 0.95)} · max ${srt[srt.length - 1]}  (all: ${times.join(', ')})`);

  const k = sample.kpis, hh = sample.health;
  const checks = [
    ['activeRuns', k.activeRuns, N], ['employeesDue', k.employeesDue, N * 2],
    ['gross', k.gross, N * 1000], ['net', k.net, N * 900],
    ['fundingRequired', k.fundingRequired, N * 900], ['fundingConfirmed', k.fundingConfirmed, N * 900],
    ['openBlockerCount (findings)', hh.openBlockerCount, N], ['blockerRunCount', hh.blockerRunCount, N],
    ['register.total', sample.register.total, N], ['register.items', sample.register.items.length, 10],
  ];
  let okAll = true;
  for (const [name, got, want] of checks) { const p = Number(got) === Number(want); if (!p) okAll = false; console.log(`  ${p ? '✓' : '✗'} ${name}: ${got}${p ? '' : ` (expected ${want})`}`); }

  console.log('\nEXPLAIN query for a DB session:');
  console.log(`  EXPLAIN (ANALYZE, BUFFERS) SELECT public.finance_payroll_control_center('${YEAR}-01-01','${YEAR}-12-31',NULL,'${empIds[0]}','admin','all',NULL,10,NULL,NULL,NULL,NULL);`);

  console.log(`\nCleaning up (FK-safe)…`);
  await del('finance_payroll_control_findings', 'id', findingIds);
  await del('finance_payroll_funding_confirmations', 'run_id', runIds);
  await del('finance_payroll_calculation_version_lines', 'run_id', runIds);
  await sb.from('finance_payroll_runs').update({ current_calculation_version_id: null, current_input_snapshot_id: null }).in('id', runIds.slice(0, 1)); // no-op guard
  for (let i = 0; i < runIds.length; i += 500) await sb.from('finance_payroll_runs').update({ current_calculation_version_id: null, current_input_snapshot_id: null }).in('id', runIds.slice(i, i + 500));
  await del('finance_payroll_calculation_versions', 'id', cvIds);
  await del('finance_payroll_input_snapshots', 'id', snapIds);
  await del('finance_payroll_runs', 'id', runIds);
  console.log('Done.');
  if (!okAll) { console.error('SCALE CORRECTNESS FAILED'); process.exit(1); }
  if (cleanupFailed) { console.error('SCALE CLEANUP FAILED (rows leaked)'); process.exit(1); }
}
main().catch(e => { console.error('SCALE FAILED:', e.message); process.exit(1); });
