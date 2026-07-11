/**
 * scripts/preflight-paygroup-overlaps.mjs
 *
 * Preflight for migration 20260918000170 (pay-group overlap exclusion): finds
 * employees that ALREADY hold overlapping pay-group assignments in live data.
 * The exclusion constraint's ADD will fail on any such row — run this first so
 * the conflicts are named (and optionally auto-closed) before applying 170.
 *
 *   node scripts/preflight-paygroup-overlaps.mjs          # report only (exit 1 if any)
 *   node scripts/preflight-paygroup-overlaps.mjs --fix    # close the EARLIER row of
 *                                                         # each overlap (effective_to =
 *                                                         # day before the later's start)
 *
 * Two ranges [from, to|open] overlap (inclusive) when a.from <= b.to and b.from <= a.to.
 */
import 'dotenv/config';
import { createClient } from '@supabase/supabase-js';

const url = process.env.SUPABASE_URL, key = process.env.SUPABASE_SERVICE_ROLE_KEY;
if (!url || !key) { console.error('Missing SUPABASE_URL / SUPABASE_SERVICE_ROLE_KEY in .env'); process.exit(2); }
const sb = createClient(url, key, { auth: { persistSession: false } });

const INF = '9999-12-31';
const fix = process.argv.includes('--fix');
const dayBefore = (d) => { const t = new Date(d + 'T00:00:00Z'); t.setUTCDate(t.getUTCDate() - 1); return t.toISOString().slice(0, 10); };

const { data, error } = await sb
  .from('finance_employee_pay_group_assignments')
  .select('employee_id, pay_group_id, effective_from, effective_to')
  .order('employee_id').order('effective_from');
if (error) { console.error('query failed:', error.message); process.exit(2); }

const rows = data ?? [];
const byEmp = new Map();
for (const r of rows) (byEmp.get(r.employee_id) ?? byEmp.set(r.employee_id, []).get(r.employee_id)).push(r);

const conflicts = [];
for (const [emp, list] of byEmp) {
  for (let i = 0; i < list.length; i++) {
    for (let j = i + 1; j < list.length; j++) {
      const a = list[i], b = list[j];
      const aTo = a.effective_to ?? INF, bTo = b.effective_to ?? INF;
      if (a.effective_from <= bTo && b.effective_from <= aTo) {
        // a starts on/before b (sorted); a is the EARLIER row to close.
        conflicts.push({ emp, a, b });
      }
    }
  }
}

console.log(`Scanned ${rows.length} assignment(s) across ${byEmp.size} employee(s).`);
if (conflicts.length === 0) {
  console.log('✓ No overlapping pay-group assignments — migration 170 will apply cleanly.');
  process.exit(0);
}

console.error(`\n✖ ${conflicts.length} overlap(s) found — migration 170's exclusion constraint would reject these:`);
for (const { emp, a, b } of conflicts) {
  console.error(`  emp ${emp}: [${a.effective_from}..${a.effective_to ?? 'open'}] (grp ${a.pay_group_id})` +
    `  OVERLAPS  [${b.effective_from}..${b.effective_to ?? 'open'}] (grp ${b.pay_group_id})`);
}

if (!fix) {
  console.error('\nRe-run with --fix to close the EARLIER assignment of each overlap ' +
    '(sets its effective_to to the day before the later assignment starts). ' +
    'Review the list above first — a same-start-date overlap cannot be auto-closed and needs a manual decision.');
  process.exit(1);
}

let fixed = 0, manual = 0;
for (const { emp, a, b } of conflicts) {
  if (a.effective_from >= b.effective_from) { manual++; console.error(`  MANUAL: emp ${emp} both start ${a.effective_from} — decide which group wins.`); continue; }
  const newTo = dayBefore(b.effective_from);
  const { error: uErr } = await sb.from('finance_employee_pay_group_assignments')
    .update({ effective_to: newTo })
    .eq('employee_id', emp).eq('pay_group_id', a.pay_group_id).eq('effective_from', a.effective_from);
  if (uErr) { console.error(`  FAILED emp ${emp} grp ${a.pay_group_id}: ${uErr.message}`); continue; }
  console.log(`  closed emp ${emp} grp ${a.pay_group_id} [${a.effective_from}] -> effective_to ${newTo}`);
  fixed++;
}
console.log(`\nClosed ${fixed} overlap(s); ${manual} need a manual decision. Re-run without --fix to confirm clean, then apply migration 170.`);
process.exit(manual > 0 ? 1 : 0);
