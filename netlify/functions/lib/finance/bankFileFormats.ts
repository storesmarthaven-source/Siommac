// ============================================================================
// Finance Payroll — per-bank direct-credit (ACH) file formatter (Wave 6)
// ============================================================================
// PURE, DB-FREE, unit-testable. No Supabase, no node-only deps.
//
// A disbursement's net-pay lines are grouped BY BANK and one structured
// direct-credit file is generated per bank. This module knows nothing about the
// database — it only turns already-resolved line data into H/D/T text.
//
// File shape (comma-separated, one record per line):
//   Header:  H,<bankCode>,<bankName>,<companyName>,<disbursementNo>,<fileDate>,<currency>,<count>,<total>
//   Detail:  D,<transit>,<account>,<accountTypeCode>,<amount>,<employeeRef>   (one per employee)
//   Trailer: T,<count>,<total>
// The control count/total in the header and trailer ALWAYS equal the summed
// detail lines (balanced control total) — this is what the receiving bank checks.
//
// This is an HONEST generic structured file, NOT a proprietary per-bank layout.
// When a specific bank supplies its spec sheet, the field positions/widths get
// mapped in a bank-specific formatter; the grouping + control-total logic here
// is reused unchanged.
// ============================================================================

/** A Trinidad & Tobago clearing bank the formatter recognises. */
export interface TtBank {
  /** Short routing code used as the file's bank identifier + the per-bank grouping key. */
  code: string;
  /** Canonical display name. */
  name: string;
  /** Lower-case substrings that identify this bank in a free-text bank_name. */
  aliases: string[];
}

/**
 * T&T clearing-bank registry. `resolveBankCode` matches a free-text bank name
 * (as typed on the employee's bank account) against these aliases. Anything
 * unrecognised falls back to `OTHER` — those lines still route correctly because
 * every detail record carries its own branch transit number.
 */
export const TT_BANK_REGISTRY: readonly TtBank[] = [
  { code: 'RBL',    name: 'Republic Bank',            aliases: ['republic'] },
  { code: 'FCB',    name: 'First Citizens',           aliases: ['first citizens', 'firstcitizens', 'fcb', 'first citizen'] },
  { code: 'SCOTIA', name: 'Scotiabank',               aliases: ['scotia'] },
  { code: 'RBC',    name: 'RBC Royal Bank',           aliases: ['rbc', 'royal bank'] },
  { code: 'JMB',    name: 'JMMB Bank',                aliases: ['jmmb', 'jmb'] },
  { code: 'INTERCOMMERCIAL', name: 'Intercommercial Bank', aliases: ['intercommercial', 'ibl'] },
] as const;

export const OTHER_BANK_CODE = 'OTHER';

/** Resolve a free-text bank name to its short routing code (or OTHER). */
export function resolveBankCode(bankName: string | null | undefined): string {
  const n = (bankName ?? '').trim().toLowerCase();
  if (!n) return OTHER_BANK_CODE;
  for (const b of TT_BANK_REGISTRY) {
    if (b.aliases.some(a => n.includes(a))) return b.code;
  }
  return OTHER_BANK_CODE;
}

/** Canonical display name for a resolved bank code (falls back to the code). */
export function bankNameForCode(code: string): string {
  return TT_BANK_REGISTRY.find(b => b.code === code)?.name ?? code;
}

/** Map a free-text account type to a 2-letter direct-credit code (SA / CH / OT). */
export function accountTypeCode(accountType: string | null | undefined): string {
  const n = (accountType ?? '').trim().toLowerCase();
  if (n.startsWith('sav')) return 'SA';                    // savings
  if (n.startsWith('che') || n.startsWith('chq') || n.startsWith('cur') || n.startsWith('cheq')) return 'CH'; // chequing / current
  return 'OT';
}

// ── Number + CSV helpers ─────────────────────────────────────────────────────

function round2(n: number): number {
  return Math.round((Number(n) || 0) * 100) / 100;
}

/** RFC-4180-style field escaping (quote when the value contains , " or newline). */
function esc(value: string | number): string {
  const s = String(value ?? '');
  return /[",\n\r]/.test(s) ? '"' + s.replace(/"/g, '""') + '"' : s;
}

// ── Direct-credit file builder ───────────────────────────────────────────────

export interface DirectCreditLine {
  /** Branch transit / routing number for this account (may be null if not captured). */
  transitNumber: string | null;
  /** Full account number (server-side only — never surfaced in a DTO). */
  accountNumber: string;
  /** Free-text account type ('savings' | 'chequing' | …). */
  accountType: string;
  /** Net amount credited to this account. */
  amount: number;
  /** Opaque per-employee reference printed in the detail record. */
  employeeRef: string;
}

export interface BuildDirectCreditFileInput {
  bankName: string;
  bankCode: string;
  companyName: string;
  currency: string;
  /** File date, caller-supplied YYYY-MM-DD (kept out of the pure fn so it's deterministic). */
  fileDate: string;
  disbursementNo: string;
  lines: DirectCreditLine[];
}

export interface BuiltBankFile {
  content: string;
  /** Number of detail records (== employees in this bank group). */
  employeeCount: number;
  /** Control total (sum of all detail amounts, rounded to cents). */
  totalAmount: number;
}

/**
 * Build one bank's direct-credit file from its grouped lines.
 * The header + trailer control count/total are derived from `lines`, so the
 * file is always internally balanced.
 */
export function buildDirectCreditFile(input: BuildDirectCreditFileInput): BuiltBankFile {
  const count = input.lines.length;
  const total = round2(input.lines.reduce((s, l) => s + (Number(l.amount) || 0), 0));

  const header = [
    'H',
    input.bankCode,
    input.bankName,
    input.companyName,
    input.disbursementNo,
    input.fileDate,
    input.currency,
    String(count),
    total.toFixed(2),
  ].map(esc).join(',');

  const detail = input.lines.map(l => [
    'D',
    l.transitNumber ?? '',
    l.accountNumber,
    accountTypeCode(l.accountType),
    round2(l.amount).toFixed(2),
    l.employeeRef,
  ].map(esc).join(','));

  const trailer = ['T', String(count), total.toFixed(2)].join(',');

  return {
    content: [header, ...detail, trailer].join('\n'),
    employeeCount: count,
    totalAmount: total,
  };
}
