// ============================================================================
// Finance — General Ledger journal helper (Wave 2)
// ============================================================================
// The one place that writes finance_gl_journals / finance_gl_journal_lines.
// Enforces the GL contract: a posted journal must BALANCE (Σdebit == Σcredit),
// have ≥2 lines, and each line is debit XOR credit. Reusable by any module
// (payroll is the first caller; AP/AR can adopt it later).
//
// No app-layer multi-table transaction is possible (supabase-js) → the line
// insert uses a COMPENSATING ROLLBACK (delete the header) on failure, never a
// swallowed error / orphaned header.
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';

const round2 = (n: number): number => Math.round(n * 100) / 100;

export interface JournalLineInput {
  accountCode: string;
  debit?: number;
  credit?: number;
  description?: string;
  costCenterId?: string | null;
}

export interface PostJournalInput {
  sourceModule: string;
  sourceRef?: string | null;
  entryDate: string;              // YYYY-MM-DD
  memo?: string;
  lines: JournalLineInput[];
  actorId: string;
  metadata?: Record<string, unknown>;
}

export interface JournalLineDto {
  lineNo: number; accountCode: string; debit: number; credit: number;
  description: string | null; costCenterId: string | null;
}
export interface JournalDto {
  id: string; journalNo: string; entryDate: string; memo: string | null;
  status: 'draft' | 'posted' | 'reversed';
  sourceModule: string; sourceRef: string | null;
  postedAt: string | null; postedBy: string | null;
  reversedAt: string | null; reversalOf: string | null;
  createdAt: string;
  lines: JournalLineDto[]; totalDebit: number; totalCredit: number;
}

interface DbJournalRow {
  id: string; journal_no: string; entry_date: string; memo: string | null;
  status: JournalDto['status']; source_module: string; source_ref: string | null;
  posted_at: string | null; posted_by: string | null;
  reversed_at: string | null; reversal_of: string | null; created_at: string;
}
interface DbLineRow {
  line_no: number; account_code: string; debit: number; credit: number;
  description: string | null; cost_center_id: string | null;
}

/** Normalise + validate lines to the GL contract. Throws 422 on any violation. */
function prepareLines(input: JournalLineInput[]): Array<{ line_no: number; account_code: string; debit: number; credit: number; description: string | null; cost_center_id: string | null }> {
  const lines = input.map((l, i) => ({
    line_no: i + 1,
    account_code: l.accountCode,
    debit: round2(l.debit ?? 0),
    credit: round2(l.credit ?? 0),
    description: l.description ?? null,
    cost_center_id: l.costCenterId ?? null,
  }));
  if (lines.length < 2) throw Object.assign(new Error('A journal must have at least 2 lines.'), { status: 422 });
  for (const l of lines) {
    const debitOnly = l.debit > 0 && l.credit === 0;
    const creditOnly = l.credit > 0 && l.debit === 0;
    if (!debitOnly && !creditOnly) {
      throw Object.assign(new Error(`Journal line ${l.line_no} (${l.account_code}) must be a debit XOR a credit, both non-zero not allowed.`), { status: 422 });
    }
  }
  const totalDebit = round2(lines.reduce((s, l) => s + l.debit, 0));
  const totalCredit = round2(lines.reduce((s, l) => s + l.credit, 0));
  if (Math.abs(totalDebit - totalCredit) > 0.005) {
    throw Object.assign(new Error(`Journal does not balance: debit ${totalDebit} ≠ credit ${totalCredit}.`), { status: 422 });
  }
  return lines;
}

/** Post a balanced journal (status = posted). */
export async function postJournal(input: PostJournalInput): Promise<JournalDto> {
  const lines = prepareLines(input.lines);
  const journalNo = await nextRef('JE');
  const nowIso = new Date().toISOString();

  const { data: j, error } = await sb.from('finance_gl_journals').insert({
    journal_no: journalNo, entry_date: input.entryDate, memo: input.memo ?? null,
    status: 'posted', source_module: input.sourceModule, source_ref: input.sourceRef ?? null,
    posted_at: nowIso, posted_by: input.actorId, created_by: input.actorId,
    metadata: input.metadata ?? {},
  }).select('*').single<DbJournalRow>();
  if (error) throw Object.assign(new Error('postJournal/header: ' + error.message), { status: 500 });

  const { error: lErr } = await sb.from('finance_gl_journal_lines')
    .insert(lines.map(l => ({ ...l, journal_id: j.id })));
  if (lErr) {
    // Compensating rollback — never leave an orphaned header.
    await sb.from('finance_gl_journals').delete().eq('id', j.id);
    throw Object.assign(new Error('postJournal/lines: ' + lErr.message), { status: 500 });
  }

  const dto = await getJournalWithLines(j.id);
  if (!dto) throw Object.assign(new Error('postJournal: journal vanished after insert.'), { status: 500 });
  return dto;
}

/** Reverse a posted journal — creates a mirror-image reversing journal and marks the original reversed. */
export async function reverseJournal(journalId: string, actorId: string, reason?: string): Promise<JournalDto> {
  const orig = await getJournalWithLines(journalId);
  if (!orig) throw Object.assign(new Error('Journal not found.'), { status: 404 });
  if (orig.status !== 'posted') {
    throw Object.assign(new Error(`Only posted journals can be reversed (status is '${orig.status}').`), { status: 422 });
  }

  const today = new Date().toISOString().slice(0, 10);
  const reversing = await postJournal({
    sourceModule: orig.sourceModule, sourceRef: orig.sourceRef,
    entryDate: today,
    memo: `Reversal of ${orig.journalNo}${reason ? ' — ' + reason : ''}`,
    lines: orig.lines.map(l => ({ accountCode: l.accountCode, debit: l.credit, credit: l.debit, description: l.description ?? undefined })),
    actorId, metadata: { reversalOf: journalId },
  });

  await sb.from('finance_gl_journals').update({ reversal_of: journalId }).eq('id', reversing.id);
  await sb.from('finance_gl_journals').update({ status: 'reversed', reversed_at: new Date().toISOString() }).eq('id', journalId);

  const dto = await getJournalWithLines(reversing.id);
  return dto ?? reversing;
}

/** Fetch a journal + its lines as a DTO with totals. */
export async function getJournalWithLines(journalId: string): Promise<JournalDto | null> {
  const { data: j, error } = await sb.from('finance_gl_journals')
    .select('id, journal_no, entry_date, memo, status, source_module, source_ref, posted_at, posted_by, reversed_at, reversal_of, created_at')
    .eq('id', journalId).maybeSingle<DbJournalRow>();
  if (error) throw Object.assign(new Error('getJournal: ' + error.message), { status: 500 });
  if (!j) return null;

  const { data: lines, error: lErr } = await sb.from('finance_gl_journal_lines')
    .select('line_no, account_code, debit, credit, description, cost_center_id')
    .eq('journal_id', journalId).order('line_no');
  if (lErr) throw Object.assign(new Error('getJournal/lines: ' + lErr.message), { status: 500 });

  const lineDtos: JournalLineDto[] = ((lines ?? []) as DbLineRow[]).map(l => ({
    lineNo: l.line_no, accountCode: l.account_code, debit: Number(l.debit), credit: Number(l.credit),
    description: l.description, costCenterId: l.cost_center_id,
  }));
  return {
    id: j.id, journalNo: j.journal_no, entryDate: j.entry_date, memo: j.memo, status: j.status,
    sourceModule: j.source_module, sourceRef: j.source_ref,
    postedAt: j.posted_at, postedBy: j.posted_by, reversedAt: j.reversed_at, reversalOf: j.reversal_of,
    createdAt: j.created_at, lines: lineDtos,
    totalDebit: round2(lineDtos.reduce((s, l) => s + l.debit, 0)),
    totalCredit: round2(lineDtos.reduce((s, l) => s + l.credit, 0)),
  };
}
