// ============================================================================
// Finance — General Ledger journal READ helper (Wave 2, hardened in audit P0-3)
// ============================================================================
// Journal WRITES happen in ONE database transaction via the Postgres functions
// post_payroll_gl_tx / reverse_payroll_gl_tx (migration 20260918000140) —
// row-locked, guarded, all-or-nothing. The old app-layer postJournal/
// reverseJournal (separate header/lines/link writes + compensating deletes)
// are DELETED: no dual write path. A future module poster (AP/AR) gets its own
// tx function following the same pattern.
// This file keeps the shared read/DTO layer.
// ============================================================================

import { sb } from '../db';

const round2 = (n: number): number => Math.round(n * 100) / 100;

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
