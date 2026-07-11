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
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';
import { createHandoff } from '../handoffBus';
import { nextRef } from '../refGenerator';
import { getJournalWithLines, type JournalDto } from './generalLedger';

const round2 = (n: number): number => Math.round(n * 100) / 100;

const DEBIT_KEYS = ['salary_expense', 'overtime_expense', 'allowance_expense', 'employer_nis_expense'] as const;
const CREDIT_KEYS = ['paye_payable', 'nis_employee_payable', 'nis_employer_payable', 'health_surcharge_payable', 'deductions_payable'] as const;

const KEY_LABEL: Record<string, string> = {
  salary_expense: 'Salaries & Wages', overtime_expense: 'Overtime', allowance_expense: 'Allowances',
  employer_nis_expense: 'Employer NIS', net_pay_clearing: 'Net Pay Clearing', paye_payable: 'PAYE Payable',
  nis_employee_payable: 'NIS Employee Payable', nis_employer_payable: 'NIS Employer Payable',
  health_surcharge_payable: 'Health Surcharge Payable', deductions_payable: 'Payroll Deductions Payable',
};

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

async function computeAmounts(runId: string): Promise<Record<string, number>> {
  const { data: lines, error } = await sb.from('finance_payroll_run_lines')
    .select('base, gross, nis_employee, nis_employer, health_surcharge, paye, voluntary_deductions, net, breakdown')
    .eq('run_id', runId);
  if (error) throw Object.assign(new Error('payrollGl/lines: ' + error.message), { status: 500 });

  let salary = 0, ot = 0, allow = 0, nisER = 0, paye = 0, nisEE = 0, hs = 0, vol = 0;
  for (const l of (lines ?? []) as Array<{ base: number; nis_employee: number; nis_employer: number; health_surcharge: number; paye: number; voluntary_deductions: number; breakdown: Record<string, unknown> | null }>) {
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
    .select('id, gl_journal_id').eq('id', runId).maybeSingle<{ id: string; gl_journal_id: string | null }>();
  if (error) throw Object.assign(new Error('payrollGl/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });

  const [amounts, map] = await Promise.all([computeAmounts(runId), loadMappings()]);
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

export async function postRunGl(runId: string, actorId: string): Promise<PostRunGlResult> {
  const { data: run, error } = await sb.from('finance_payroll_runs')
    .select('id, run_no, period_month, pay_date, status, gl_journal_id')
    .eq('id', runId)
    .maybeSingle<{ id: string; run_no: string; period_month: string; pay_date: string | null; status: string; gl_journal_id: string | null }>();
  if (error) throw Object.assign(new Error('postRunGl/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!['locked', 'exported'].includes(run.status)) {
    throw Object.assign(new Error(`GL can only be posted for locked runs (run is '${run.status}').`), { status: 422 });
  }
  if (run.gl_journal_id) {
    throw Object.assign(new Error('This run has already been posted to the GL. Reverse the existing journal first.'), { status: 409 });
  }

  const preview = await previewRunGl(runId);
  if (preview.missingMappings.length > 0) {
    throw Object.assign(new Error('Missing GL account mappings for: ' + preview.missingMappings.join(', ') + '. Configure payroll GL mappings first.'), { status: 422 });
  }

  // ONE atomic transaction (Postgres fn): lock run → guards → header + lines +
  // run link. Two concurrent posts serialise on the row lock; the loser gets
  // 'already_posted'. No compensating deletes on the accounting path.
  const journalNo = await nextRef('JE');
  const { data: rpcData, error: rpcErr } = await sb.rpc('post_payroll_gl_tx', {
    p_run_id:     runId,
    p_journal_no: journalNo,
    p_entry_date: run.pay_date ?? run.period_month,
    p_memo:       `Payroll ${run.run_no} — ${run.period_month.slice(0, 7)}`,
    p_actor:      actorId,
    p_lines:      preview.lines.map(l => ({
      account_code: l.accountCode as string,
      debit:  l.side === 'debit'  ? l.amount : 0,
      credit: l.side === 'credit' ? l.amount : 0,
      description: KEY_LABEL[l.mappingKey] ?? l.mappingKey,
    })),
    p_metadata:   { runNo: run.run_no },
  });
  if (rpcErr) throw Object.assign(new Error('postRunGl/tx: ' + rpcErr.message), { status: 500 });
  const result = (rpcData ?? {}) as { status: string; journal_id?: string; journal_no?: string; total_debit?: number; total_credit?: number; current?: string; message?: string };
  switch (result.status) {
    case 'posted': break;
    case 'already_posted': throw Object.assign(new Error('This run has already been posted to the GL. Reverse the existing journal first.'), { status: 409 });
    case 'not_lockable':   throw Object.assign(new Error(`GL can only be posted for locked runs (run is '${result.current}').`), { status: 422 });
    case 'not_found':      throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
    case 'unbalanced':
    case 'invalid_lines':  throw Object.assign(new Error('GL journal rejected by the database: ' + (result.message ?? result.status)), { status: 422 });
    default:               throw Object.assign(new Error('postRunGl/tx: unexpected result ' + JSON.stringify(result)), { status: 500 });
  }
  const journal = {
    id: result.journal_id!, journalNo: result.journal_no ?? journalNo,
    totalDebit: Number(result.total_debit ?? 0), totalCredit: Number(result.total_credit ?? 0),
  };

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.gl_posted',
    newState: { journalId: journal.id, journalNo: journal.journalNo, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.gl.posted', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: runId, actorUserId: actorId, severity: 'success',
    payload: { runNo: run.run_no, journalNo: journal.journalNo, totalDebit: journal.totalDebit },
  });
  void createHandoff({
    sourceModule: 'finance_payroll', targetModule: 'finance_gl',
    sourceEntityType: 'payroll_run', sourceEntityId: runId,
    targetEntityType: 'gl_journal',
    payload: { journalId: journal.id, journalNo: journal.journalNo, runNo: run.run_no },
    createdBy: actorId,
  });

  return { journalId: journal.id, journalNo: journal.journalNo, totalDebit: journal.totalDebit, totalCredit: journal.totalCredit };
}

// ── Reverse ─────────────────────────────────────────────────────────────────

export async function reverseRunGl(runId: string, actorId: string, reason: string): Promise<{ reversingJournalId: string; reversingJournalNo: string }> {
  const { data: run, error } = await sb.from('finance_payroll_runs')
    .select('id, run_no, gl_journal_id').eq('id', runId)
    .maybeSingle<{ id: string; run_no: string; gl_journal_id: string | null }>();
  if (error) throw Object.assign(new Error('reverseRunGl/run: ' + error.message), { status: 500 });
  if (!run) throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
  if (!run.gl_journal_id) throw Object.assign(new Error('This run has no posted GL journal to reverse.'), { status: 422 });
  if (!reason || !reason.trim()) throw Object.assign(new Error('A reason is required to reverse a GL posting.'), { status: 422 });

  // ONE atomic transaction: lock run + original journal → mirror journal +
  // mark reversed + unlink run. Concurrent/duplicate reversals lose on the lock.
  const reversingNo = await nextRef('JE');
  const { data: rpcData, error: rpcErr } = await sb.rpc('reverse_payroll_gl_tx', {
    p_run_id:               runId,
    p_reversing_journal_no: reversingNo,
    p_entry_date:           new Date().toISOString().slice(0, 10),
    p_actor:                actorId,
    p_reason:               reason.trim(),
  });
  if (rpcErr) throw Object.assign(new Error('reverseRunGl/tx: ' + rpcErr.message), { status: 500 });
  const result = (rpcData ?? {}) as { status: string; reversing_journal_id?: string; reversing_journal_no?: string; current?: string };
  switch (result.status) {
    case 'reversed': break;
    case 'not_posted':     throw Object.assign(new Error('This run has no posted GL journal to reverse.'), { status: 422 });
    case 'not_reversible': throw Object.assign(new Error(`Only posted journals can be reversed (status is '${result.current}').`), { status: 422 });
    case 'not_found':      throw Object.assign(new Error('Payroll run not found.'), { status: 404 });
    default:               throw Object.assign(new Error('reverseRunGl/tx: unexpected result ' + JSON.stringify(result)), { status: 500 });
  }
  const reversing = { id: result.reversing_journal_id!, journalNo: result.reversing_journal_no ?? reversingNo };

  await writeHrAudit({
    submoduleKey: 'finance_payroll', recordId: runId, actorId,
    action: 'payroll_run.gl_reversed',
    previousState: { journalId: run.gl_journal_id },
    newState: { reversingJournalId: reversing.id, reversingJournalNo: reversing.journalNo, reason: reason.trim() },
    reason: reason.trim(),
  });
  void emitAppEvent({
    eventType: 'finance.payroll.gl.reversed', sourceModule: 'finance_payroll',
    sourceEntityType: 'payroll_run', sourceEntityId: runId, actorUserId: actorId, severity: 'warning',
    payload: { runNo: run.run_no, reversingJournalNo: reversing.journalNo, reason: reason.trim() },
  });

  return { reversingJournalId: reversing.id, reversingJournalNo: reversing.journalNo };
}

// ── Get the posted journal for a run ────────────────────────────────────────

export async function getRunGlJournal(runId: string): Promise<JournalDto | null> {
  const { data: run } = await sb.from('finance_payroll_runs')
    .select('gl_journal_id').eq('id', runId).maybeSingle<{ gl_journal_id: string | null }>();
  if (!run?.gl_journal_id) return null;
  return getJournalWithLines(run.gl_journal_id);
}
