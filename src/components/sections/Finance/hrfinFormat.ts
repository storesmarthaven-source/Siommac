/**
 * src/components/sections/Finance/hrfinFormat.ts
 *
 * Money / percent / delta formatters for the Aurora Finance pages. Whole-dollar
 * display (the mockups show "$248,900", not cents) with a compact "$169k"
 * variant for tight chart labels, and a signed delta chip helper.
 */

export function money(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const sign = n < 0 ? '-' : '';
  return `${sign}$${Math.abs(Math.round(n)).toLocaleString('en-US')}`;
}

export function moneyCompact(n: number | null | undefined): string {
  if (n == null || Number.isNaN(n)) return '—';
  const abs = Math.abs(n);
  const sign = n < 0 ? '-' : '';
  if (abs >= 1_000_000) return `${sign}$${(abs / 1_000_000).toFixed(2).replace(/\.00$/, '')}M`;
  if (abs >= 1_000) return `${sign}$${Math.round(abs / 1_000)}k`;
  return `${sign}$${Math.round(abs)}`;
}

/** A delta chip label + tone from a signed percentage. `up` = good for spend? No —
 *  the caller decides good/bad; this only formats the arrow + rounded value. */
export function deltaLabel(pct: number | null | undefined): string | undefined {
  if (pct == null || Number.isNaN(pct)) return undefined;
  const arrow = pct >= 0 ? '▲' : '▼';
  return `${arrow} ${Math.abs(pct).toFixed(1)}%`;
}

/** Day-of-month + 3-letter uppercase month for the deadline badge. */
export function dateBadge(iso: string): { day: string; month: string } {
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return { day: '—', month: '' };
  return { day: String(d.getUTCDate()), month: d.toLocaleDateString('en-US', { month: 'short', timeZone: 'UTC' }).toUpperCase() };
}
