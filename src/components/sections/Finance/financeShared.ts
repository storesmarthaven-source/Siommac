/**
 * src/components/sections/Finance/financeShared.ts
 *
 * Small shared helpers for the Finance pages — money/percent/date formatting,
 * status → pill-tone mapping, and label humanization. Kept dependency-free so both
 * the Statutory and Payroll overviews can import it.
 */

const MONEY = new Intl.NumberFormat('en-TT', { style: 'currency', currency: 'TTD', minimumFractionDigits: 2 });

export function fmtMoney(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  return MONEY.format(n);
}

export function fmtPercent(rate: number | null | undefined): string {
  if (rate == null || Number.isNaN(rate)) return '—';
  // Stored as a fraction (0.25 = 25%).
  return `${(rate * 100).toFixed(2).replace(/\.00$/, '')}%`;
}

export function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  const d = new Date(iso);
  return Number.isNaN(d.getTime()) ? '—' : d.toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

export function humanize(s: string | null | undefined): string {
  if (!s) return '—';
  return s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
}

/** Lifecycle status → obx-pill tone. */
export function statusTone(status: string): string {
  switch (status) {
    case 'active':
    case 'approved':
    case 'verified':
    case 'paid':
    case 'locked':
      return 'green';
    case 'pending_approval':
    case 'pending_verification':
    case 'submitted':
    case 'calculating':
    case 'calculated':
      return 'amber';
    case 'rejected':
    case 'retired':
    case 'cancelled':
    case 'not_available':
      return 'red';
    default:
      return 'gray';
  }
}
