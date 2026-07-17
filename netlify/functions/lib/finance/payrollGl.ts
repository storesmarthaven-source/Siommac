// ============================================================================
// Finance Payroll — GL posting (Wave 2)
// ============================================================================
// Builds a BALANCED double-entry journal from a locked run's lines and posts it
// through the shared GL helper. Deterministic — no AI, no recomputation of pay.
//
// Debits (expense):  salary + overtime + allowances + employer NIS
// Credits (payable): PAYE, NIS employee, NIS employer, Health Surcharge,
//                    voluntary deductions, and Net Pay Clearing (the balancing plug).
// By construction Σdebit == Σcredit (= gross + employer NIS); net_pay_clearing is
// computed as the plug so the journal balances to the cent regardless of rounding.
// ============================================================================

import { sb } from '../db';
import { selectAllRows } from '../dbBulk';
import { getJournalWithLines, type JournalDto } from './generalLedger';
import { payrollRpcHttpError } from './payroll/rpcError';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const DEBIT_KEYS = ['salary_expense', 'overtime_expense', 'allowance_expense', 'employer_nis_expense'] as const;
const CREDIT_KEYS = ['paye_payable', 'nis_employee_payable', 'nis_employer_payable', 'health_surcharge_payable', 'deductions_payable'] as const;

export interface GlPreviewLine {
  mappingKey: string;
  accountCode: string | null;
  accountName: string | null;
  side: 'debit' | 'credit';
  amount: number;
}
export interface GlPreview {
  runId: string;
  lines: GlPreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  missingMappings: string[];
  alreadyPosted: boolean;
  journalId: string | null;
}

// ── Compute journal amounts from the run lines ──────────────────────────────

async function computeAmounts(
  calculationVersionId: string,
): Promise<Record<string, number>> {
  // Paginate past the 1000-row cap — truncating at 1000 understates the GL journal for
  // large runs and breaks the balanced-entry invariant.
  const lines = await selectAllRows<{ base: number; nis_employee: number; nis_employer: number; health_surcharge: number; paye: number; voluntary_deductions: number; breakdown: Record<string, unknown> | null }>(
    () => sb.from('finance_payroll_calculation_version_lines')
      .select('base, gross, nis_employee, nis_employer, health_surcharge, paye, voluntary_deductions, net, breakdown')
      .eq('calculation_version_id', calculationVersionId).order('employee_id'),
  );

  let salary = 0, ot = 0, allow = 0, nisER = 0, paye = 0, nisEE = 0, hs = 0, vol = 0;
  for (const l of lines) {
    const bd = l.breakdown ?? {};
    salary += Number(l.base);
    ot     += Number(bd['approvedOtAmount'] ?? 0);
    allow  += Number(bd['taxableAllowances'] ?? 0) + Number(bd['nonTaxableAllowances'] ?? 0);
    nisER  += Number(l.nis_employer);
    paye   += Number(l.paye);
    nisEE  += Number(l.nis_employee);
    hs     += Number(l.health_surcharge);
    vol    += Number(l.voluntary_deductions);
  }
  return {
    salary_expense: salary, overtime_expense: ot, allowance_expense: allow, employer_nis_expense: nisER,
    paye_payable: paye, nis_employee_payable: nisEE, nis_employer_payable: nisER,
    health_surcharge_payable: hs, deductions_payable: vol,
  };
}

async function loadMappings(): Promise<Map<string, string>> {
  const { data, error } = await sb.from('finance_payroll_gl_mappings')
    .select('mapping_key, account_code')
    .eq('active', true).is('component_id', null).is('department_id', null);
  if (error) throw Object.assign(new Error('payrollGl/mappings: ' + error.message), { status: 500 });
  return new Map(((data ?? []) as Array<{ mapping_key: string; account_code: string }>).map(m => [m.mapping_key, m.account_code]));
}

async function resolveAccountNames(codes: string[]): Promise<Map<string, string>> {
  const uniq = [...new Set(codes.filter(Boolean))];
  if (uniq.length === 0) return new Map();
  const { data } = await sb.from('finance_gl_accounts').select('code, name').in('code', uniq);
  return new Map(((data ?? []) as Array<{ code: string; name: string }>).map(a => [a.code, a.name]));
}

// ── Preview ─────────────────────────────────────────────────────────────────

export async function previewRunGl(runId: string): Promise<GlPreview> {
  const { data: run, error } = await sb.from('finance_payroll_runs')
    .select('id, gl_journal_id, current_calculation_version_id')
    .eq('id', runId)
    .maybeSingle<{
      id: string;
      gl_journal_id: string | null;
      current_calculation_version_id: string | null;
    }>();
  if (error) throw Object.assign(new Error('payrollGl/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!run.current_calculation_version_id) {
    throw Object.assign(
      new Error('The payroll run has no current calculation version.'),
      { status: 409 },
    );
  }

  const [amounts, map] = await Promise.all([
    computeAmounts(run.current_calculation_version_id),
    loadMappings(),
  ]);
  const missing: string[] = [];
  const lines: GlPreviewLine[] = [];
  let totalDebit = 0, otherCredits = 0;

  for (const k of DEBIT_KEYS) {
    const amount = round2(amounts[k] ?? 0);
    if (amount <= 0) continue;
    const accountCode = map.get(k) ?? null;
    if (!accountCode) missing.push(k);
    lines.push({ mappingKey: k, accountCode, accountName: null, side: 'debit', amount });
    totalDebit += amount;
  }
  for (const k of CREDIT_KEYS) {
    const amount = round2(amounts[k] ?? 0);
    if (amount <= 0) continue;
    const accountCode = map.get(k) ?? null;
    if (!accountCode) missing.push(k);
    lines.push({ mappingKey: k, accountCode, accountName: null, side: 'credit', amount });
    otherCredits += amount;
  }
  // Net Pay Clearing = plug so the journal balances exactly (≈ Σ net).
  const netClearing = round2(round2(totalDebit) - round2(otherCredits));
  const netCode = map.get('net_pay_clearing') ?? null;
  if (!netCode) missing.push('net_pay_clearing');
  lines.push({ mappingKey: 'net_pay_clearing', accountCode: netCode, accountName: null, side: 'credit', amount: netClearing });

  const nameMap = await resolveAccountNames(lines.map(l => l.accountCode ?? ''));
  for (const l of lines) l.accountName = l.accountCode ? (nameMap.get(l.accountCode) ?? null) : null;

  const td = round2(totalDebit);
  const tc = round2(otherCredits + netClearing);
  return {
    runId, lines, totalDebit: td, totalCredit: tc,
    balanced: Math.abs(td - tc) < 0.005,
    missingMappings: missing,
    alreadyPosted: !!run.gl_journal_id,
    journalId: run.gl_journal_id,
  };
}

// ── Post ────────────────────────────────────────────────────────────────────

export interface PostRunGlResult { journalId: string; journalNo: string; totalDebit: number; totalCredit: number }

export async function postRunGl(
  runId: string,
  actorId: string,
  idempotencyKey: string,
): Promise<PostRunGlResult> {
  const { data: run, error } = await sb.from('finance_payroll_runs')
    .select('id, status')
    .eq('id', runId)
    .maybeSingle<{ id: string; status: string }>();
  if (error) throw Object.assign(new Error('postRunGl/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (run.status !== 'locked') {
    throw Object.assign(new Error(`GL can only be posted for locked runs (run is '${run.status}').`), { status: 422 });
  }
  const preview = await previewRunGl(runId);
  if (preview.missingMappings.length > 0) {
    throw Object.assign(new Error('Missing GL account mappings for: ' + preview.missingMappings.join(', ') + '. Configure payroll GL mappings first.'), { status: 422 });
  }

  // The RPC owns the journal reference and all durable side effects.
  const { data: rpcData, error: rpcErr } = await sb.rpc('post_payroll_gl_tx', {
    p_run_id: runId,
    p_actor: actorId,
    p_idempotency_key: idempotencyKey,
    p_metadata: {},
  });
  if (rpcErr) throw payrollRpcHttpError(rpcErr);
  const result = (rpcData ?? {}) as { status: string; journal_id?: string; journal_no?: string; total_debit?: number; total_credit?: number; current?: string; message?: string };
  switch (result.status) {
    case 'posted': break;
    case 'already_posted': throw Object.assign(new Error('This run has already been posted to the GL. Reverse the existing journal first.'), { status: 409 });
    case 'not_lockable':   throw Object.assign(new Error(`GL can only be posted for locked runs (run is '${result.current}').`), { status: 422 });
    case 'not_found':      throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
    case 'unbalanced':
    case 'invalid_lines':  throw Object.assign(new Error('GL journal rejected by the database: ' + (result.message ?? result.status)), { status: 422 });
    case 'invalid_calculation': throw Object.assign(new Error('GL journal rejected by the database: ' + (result.message ?? result.status)), { status: 409 });
    case 'invalid_account': throw Object.assign(new Error('GL journal references an inactive or missing account.'), { status: 422 });
    default:               throw Object.assign(new Error('postRunGl/tx: unexpected result ' + JSON.stringify(result)), { status: 500 });
  }
  if (!result.journal_id || !result.journal_no) {
    throw Object.assign(new Error('GL posting committed but returned an invalid result.'), { status: 500 });
  }
  return {
    journalId: result.journal_id,
    journalNo: result.journal_no,
    totalDebit: Number(result.total_debit ?? 0),
    totalCredit: Number(result.total_credit ?? 0),
  };
}

// ── Reverse ─────────────────────────────────────────────────────────────────

export async function reverseRunGl(
  runId: string,
  actorId: string,
  reason: string,
  idempotencyKey: string,
): Promise<{ reversingJournalId: string; reversingJournalNo: string }> {
  if (!reason || !reason.trim()) throw Object.assign(new Error('A reason is required to reverse a GL posting.'), { status: 422 });

  // The RPC owns the reversing reference and all durable side effects.
  const { data: rpcData, error: rpcErr } = await sb.rpc('reverse_payroll_gl_tx', {
    p_run_id: runId,
    p_actor: actorId,
    p_reason: reason.trim(),
    p_idempotency_key: idempotencyKey,
  });
  if (rpcErr) throw payrollRpcHttpError(rpcErr);
  const result = (rpcData ?? {}) as { status: string; reversing_journal_id?: string; reversing_journal_no?: string; current?: string };
  switch (result.status) {
    case 'reversed': break;
    case 'not_posted':     throw Object.assign(new Error('This run has no posted GL journal to reverse.'), { status: 422 });
    case 'not_reversible': throw Object.assign(new Error(`Only posted journals can be reversed (status is '${result.current}').`), { status: 422 });
    case 'not_found':      throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
    default:               throw Object.assign(new Error('reverseRunGl/tx: unexpected result ' + JSON.stringify(result)), { status: 500 });
  }
  if (!result.reversing_journal_id || !result.reversing_journal_no) {
    throw Object.assign(new Error('GL reversal committed but returned an invalid result.'), { status: 500 });
  }
  return {
    reversingJournalId: result.reversing_journal_id,
    reversingJournalNo: result.reversing_journal_no,
  };
}

// ── Get the posted journal for a run ────────────────────────────────────────

export async function getRunGlJournal(runId: string): Promise<JournalDto | null> {
  const { data: run } = await sb.from('finance_payroll_runs')
    .select('gl_journal_id').eq('id', runId).maybeSingle<{ gl_journal_id: string | null }>();
  if (!run?.gl_journal_id) return null;
  return getJournalWithLines(run.gl_journal_id);
}
