// ============================================================================
// Finance Payroll -- Payslip Studio token-map builder (Phase 2)
// ============================================================================
// Pure module -- NO database imports. This keeps it importable from ts-jest
// unit tests without pulling in the supabase/upload regex chain.
//
// buildTokenMap(snapshot, employer) -> Record<string, string>
//   Flattens payslip snapshot + employer profile into the dotted token keys
//   the studio's TOKEN_GROUPS catalogue defines (e.g. "company.name").
//   All values are pre-formatted strings (numbers include $ and separators).
//
// resolveTokenText(text, map) -> string
//   Replaces {{token}} placeholders using the map. Unknown tokens are left
//   as-is so the PDF shows the raw placeholder rather than blank space.
// ============================================================================

// Minimal shape pulled from PayslipSnapshot (payslipPdf.ts). Defined here
// to avoid a circular import: payslipPdf imports this file; this file must
// not import payslipPdf. TypeScript structural typing means any PayslipSnapshot
// value satisfies this interface without an explicit import.
export interface PayslipTokenSource {
  payslipNo:      string;
  periodLabel:    string;
  payFrequency:   string;
  payDate:        string | null;
  currency:       string;
  employer:       { name: string };
  employee: {
    name:              string;
    employeeNumber:    string | null;
    department:        string | null;
    position:          string | null;
    nisNumberMasked:   string | null;
  };
  bank:           { bankName: string; accountType: string; accountMasked: string } | null;
  gross:          number;
  totalDeductions: number;
  net:            number;
  ytd:            { gross: number; net: number };
}

// Minimal employer profile shape (mirrors EmployerProfile from employerProfile.ts).
// type-only import would work too; duplicated here for zero-dep purity.
export interface PayslipEmployerSource {
  legalName:         string;
  tradingName:       string | null;
  birFileNumber:     string | null;
  nisEmployerNumber: string | null;
  addressLine1:      string | null;
  addressLine2:      string | null;
  city:              string | null;
  country:           string;
  phone:             string | null;
  email:             string | null;
}

// ── Helpers ──────────────────────────────────────────────────────────────────

const TOKEN_RE = /\{\{\s*([\w.]+)\s*\}\}/g;

function money(n: number): string {
  return '$' + n.toLocaleString('en-TT', { minimumFractionDigits: 2, maximumFractionDigits: 2 });
}

function cap(s: string): string {
  return s ? s.charAt(0).toUpperCase() + s.slice(1) : s;
}

function fmtDate(iso: string): string {
  const d = new Date(iso + 'T00:00:00Z');
  return d.toLocaleDateString('en-GB', {
    day: '2-digit', month: 'short', year: 'numeric', timeZone: 'UTC',
  });
}

// ── Public API ────────────────────────────────────────────────────────────────

/**
 * Replace `{{token}}` placeholders in a text string.
 * Tokens absent from the map are kept verbatim (e.g. `{{employee.name}}`),
 * so the PDF shows the raw key rather than blank space.
 */
export function resolveTokenText(text: string, map: Record<string, string>): string {
  return text.replace(TOKEN_RE, (m, key: string) => map[key] ?? m);
}

/**
 * Build the full token map from the payslip snapshot + employer profile.
 * Key names match the studio's TOKEN_GROUPS catalogue exactly
 * (see `src/components/sections/PayslipStudio/constants/tokens.ts`).
 */
export function buildTokenMap(
  s: PayslipTokenSource,
  e: PayslipEmployerSource,
): Record<string, string> {
  // Build a single-line company address from the available fields.
  const addrParts: string[] = [];
  if (e.addressLine1?.trim()) addrParts.push(e.addressLine1.trim());
  if (e.addressLine2?.trim()) addrParts.push(e.addressLine2.trim());
  if (e.city?.trim())         addrParts.push(e.city.trim());
  // Include country only when it is not the implied default.
  if (e.country && e.country !== 'Trinidad and Tobago') addrParts.push(e.country);
  const address = addrParts.join(', ') || 'Trinidad and Tobago';

  // company.reg: BIR file number takes priority; fall back to NIS employer #.
  let reg = '';
  if (e.birFileNumber?.trim())     reg = `BIR# ${e.birFileNumber.trim()}`;
  else if (e.nisEmployerNumber?.trim()) reg = `NIS ER# ${e.nisEmployerNumber.trim()}`;

  return {
    // Company block
    'company.name':    e.legalName?.trim() || s.employer.name,
    'company.address': address,
    'company.reg':     reg,

    // Employee block
    'employee.name':       s.employee.name,
    'employee.id':         s.employee.employeeNumber ?? '',
    'employee.position':   s.employee.position ?? '',
    'employee.department': s.employee.department ?? '',
    'employee.nis':        s.employee.nisNumberMasked ?? '',
    'employee.tin':        '',        // employee TIN not tracked separately yet
    'employee.bank':       s.bank?.bankName ?? '',
    'employee.account':    s.bank?.accountMasked ?? '',

    // Pay run block
    'pay.period':    s.periodLabel,
    'pay.date':      s.payDate ? fmtDate(s.payDate) : '',
    'pay.frequency': cap(s.payFrequency),
    'pay.method':    s.bank ? 'Direct Deposit' : 'Cash',
    'pay.currency':  s.currency,
    'pay.ref':       s.payslipNo,

    // Totals block
    'pay.gross':      money(s.gross),
    'pay.deductions': money(s.totalDeductions),
    'pay.net':        money(s.net),
    'pay.ytd.gross':  money(s.ytd.gross),
    'pay.ytd.net':    money(s.ytd.net),
  };
}
