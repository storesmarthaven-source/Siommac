/**
 * netlify/functions/lib/refGenerator.ts
 *
 * Human-readable sequential reference numbers for ERP entities.
 * Format: <PREFIX>-<YYYY>-<NNNN> e.g. INC-2026-0001
 *
 * Uses the reference_counters table with FOR UPDATE locking to prevent
 * duplicates under concurrent inserts. Wrapped in a Supabase RPC call
 * because raw FOR UPDATE isn't expressible through the JS client.
 * Falls back to a timestamp-based ref if the DB counter fails so the
 * caller is never blocked.
 */

import { sb } from './db';

export type RefPrefix =
  | 'INC'   // HSE Incident
  | 'INV'   // HSE Investigation
  | 'CAPA'  // CAPA Action
  | 'HAZ'   // HSE Hazard
  | 'RA'    // Risk Assessment
  | 'JSA'   // Job Safety Analysis
  | 'WF'    // Workflow
  | 'TKT'   // Ticket
  | 'HO'    // Handoff
  | 'PAY'   // Payroll Run
  | 'FCE'   // Finance Cost Entry
  | 'OWO'   // Operations Work Order
  | 'PTW'   // Permit to Work
  | 'INSP'  // HSE Inspection
  | 'FND'   // HSE Inspection Finding
  | 'CERT'  // HSE Worker Certificate
  | 'TRN'   // HSE Training Assignment
  | 'HRC'   // HR Case
  | 'HRI';  // HR Employee Import batch

/**
 * Generate the next sequential reference for `prefix` in the current year.
 * e.g. nextRef('INC') → 'INC-2026-0001'
 *
 * Implementation: upsert increments via Postgres function to avoid race
 * conditions. The rpc `increment_ref_counter` must exist (created below as
 * a fallback-safe inline approach using raw SQL via service role).
 */
export async function nextRef(prefix: RefPrefix): Promise<string> {
  const year = new Date().getFullYear();

  try {
    // Atomic increment: insert or update, returning the reserved number.
    // Using a raw RPC keeps the FOR UPDATE lock inside one server round-trip.
    const { data, error } = await sb.rpc('increment_ref_counter', { p_prefix: prefix, p_year: year });

    if (error || data == null) {
      // Graceful fallback: timestamp-based ref is unique but not sequential.
      console.warn('[refGenerator] rpc failed, using timestamp fallback', error?.message);
      return `${prefix}-${year}-T${Date.now().toString(36).toUpperCase()}`;
    }

    const n = data as number;
    return `${prefix}-${year}-${String(n).padStart(4, '0')}`;
  } catch (e) {
    console.error('[refGenerator] unexpected error', e);
    return `${prefix}-${year}-T${Date.now().toString(36).toUpperCase()}`;
  }
}
