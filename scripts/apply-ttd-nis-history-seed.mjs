/**
 * scripts/apply-ttd-nis-history-seed.mjs
 *
 * Seeds the REAL Trinidad & Tobago NIS contribution history (2008–2026) into
 * finance_statutory_versions + finance_nis_classes, replacing the sparse
 * single-version state (and clearing leaked E2E test versions). Source of truth
 * is supabase/seed/ttd_nis_seed_2008_2026.json (NIBTT, committed alongside).
 *
 * Modelling notes — NO fabrication (CLAUDE.md No-Band-Aids):
 *   - NIS bands (weekly min/max, EE/ER weekly, assumed-average weekly, Class Z)
 *     come verbatim from the NIBTT package.
 *   - nis_monthly_ceiling is the NIBTT max insurable monthly earnings = the top
 *     class's monthly floor (8,300 → 13,600 across versions).
 *   - Our finance_statutory_versions row BUNDLES PAYE + Health Surcharge with the
 *     NIS schedule. The package is NIS-only, so PAYE/HS are filled with the
 *     POINT-IN-TIME-correct T&T values in force on each NIS effective date
 *     (public BIR/PwC facts, cited below) — never invented, never carried blindly:
 *       PAYE personal allowance: TT$60,000 (pre-2016) → TT$72,000 (2016 income
 *         year) → TT$90,000 (2023). 30% band over chargeable TT$1,000,000 began
 *         2017-01-01; before that a flat 25% (band2_rate = band1_rate = 0.25).
 *       Health Surcharge: TT$8.25/wk (monthly income > TT$469.99) else TT$4.80/wk
 *         — unchanged across the whole range.
 *     Retired versions are audit/history only; payroll computes from the ACTIVE
 *     (2026) version, whose figures match migration 20260802000002.
 *   Sources: PwC "Trinidad and Tobago — Individual — Taxes on personal income" /
 *   "Other taxes"; NIBTT Contribution Rate schedules (URLs in the JSON).
 *
 * Idempotent — upserts on the natural keys, re-runnable. Emits a durable SQL
 * mirror to supabase/apply-ttd-nis-history-seed.sql for operator re-apply.
 *
 * Usage: node scripts/apply-ttd-nis-history-seed.mjs
 */

import { readFileSync, writeFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];
function loadEnv() {
  const txt = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of txt.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQUIRED_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQUIRED_ENV) if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  return out;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

const seed = JSON.parse(readFileSync(new URL('../supabase/seed/ttd_nis_seed_2008_2026.json', import.meta.url), 'utf8'));

// Point-in-time PAYE per NIS effective date (see header). band1_ceiling is the
// chargeable-income boundary for the 30% band; a flat-25% year sets band2 = band1.
const PAYE_BY_DATE = {
  '2008-01-07': { pa: 60000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2010-01-04': { pa: 60000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2012-01-02': { pa: 60000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2013-03-04': { pa: 60000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2014-03-03': { pa: 60000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2016-09-05': { pa: 72000, ceil: 1000000, r1: 0.25, r2: 0.25 },
  '2026-01-05': { pa: 90000, ceil: 1000000, r1: 0.25, r2: 0.30 },
};
// Health Surcharge — constant across the entire range.
const HS = { threshold: 469.99, high: 8.25, low: 4.80 };
const ACTIVE_DATE = '2026-01-05';

const roman = (n) => ['','I','II','III','IV','V','VI','VII','VIII','IX','X','XI','XII','XIII','XIV','XV','XVI'][n] ?? String(n);
const ceilingOf = (v) => v.classes[v.classes.length - 1].monthly_min; // NIBTT max insurable monthly earnings

function versionRow(v) {
  const p = PAYE_BY_DATE[v.effective_date];
  if (!p) throw new Error(`No PAYE map for ${v.effective_date}`);
  const active = v.effective_date === ACTIVE_DATE;
  return {
    effective_from: v.effective_date,
    label: `NIS ${v.contribution_rate_percent}% · ${v.effective_date.slice(0, 4)}`,
    jurisdiction: 'TT',
    currency: 'TTD',
    paye_personal_allowance: p.pa,
    paye_band1_ceiling: p.ceil,
    paye_band1_rate: p.r1,
    paye_band2_rate: p.r2,
    hs_monthly_threshold: HS.threshold,
    hs_weekly_high: HS.high,
    hs_weekly_low: HS.low,
    nis_monthly_ceiling: ceilingOf(v),
    status: active ? 'active' : 'retired',
    is_active: active,
    activated_at: active ? `${v.effective_date}T00:00:00Z` : null,
    retired_at: active ? null : (v.effective_to ? `${v.effective_to}T00:00:00Z` : null),
  };
}

function classRows(versionId, v) {
  return v.classes.map((c) => ({
    statutory_version_id: versionId,
    class_no: c.class_no,
    weekly_min: c.weekly_min,
    weekly_max: c.weekly_max ?? null,
    assumed_average_weekly: c.assumed_average_weekly ?? null,
    employee_weekly: c.employee_weekly,
    employer_weekly: c.employer_weekly,
    class_z_weekly: c.class_z_weekly ?? null,
  }));
}

async function main() {
  console.log('Seeding T&T NIS history (2008–2026)…\n');

  // 1) Detect leaked E2E test versions — do NOT delete (they are referenced by
  //    leaked E2E payroll runs/remittances; purging that shared graph is a
  //    separate, explicitly-approved hygiene task, not part of seeding).
  const { data: junk } = await sb.from('finance_statutory_versions')
    .select('id,label').ilike('label', '%E2E%');
  if (junk?.length) console.log(`  NOTE: ${junk.length} leaked E2E test version(s) present (left untouched): ${junk.map(j => j.label).join(', ')}`);

  // 2) Upsert the 7 versions (natural key: effective_from + jurisdiction).
  const versionRows = seed.versions.map(versionRow);
  const { data: upVers, error: vErr } = await sb.from('finance_statutory_versions')
    .upsert(versionRows, { onConflict: 'effective_from,jurisdiction' })
    .select('id,effective_from');
  if (vErr) { console.error('  ! upsert versions:', vErr.message); process.exit(1); }
  const idByDate = new Map((upVers ?? []).map((r) => [r.effective_from, r.id]));
  console.log(`  versions upserted: ${upVers?.length ?? 0}`);

  // 3) Upsert 16 classes per version.
  let classTotal = 0;
  for (const v of seed.versions) {
    const vid = idByDate.get(v.effective_date);
    if (!vid) { console.error(`  ! no id for ${v.effective_date}`); process.exit(1); }
    const { error: cErr, data: cData } = await sb.from('finance_nis_classes')
      .upsert(classRows(vid, v), { onConflict: 'statutory_version_id,class_no' })
      .select('id');
    if (cErr) { console.error(`  ! classes ${v.effective_date}:`, cErr.message); process.exit(1); }
    classTotal += cData?.length ?? 0;
  }
  console.log(`  NIS classes upserted: ${classTotal}`);

  // 4) Enforce exactly one active version — scoped to the seed's own dates only
  //    (never touches leaked E2E versions).
  const retireDates = seed.versions.map((v) => v.effective_date).filter((d) => d !== ACTIVE_DATE);
  await sb.from('finance_statutory_versions').update({ status: 'retired', is_active: false })
    .eq('jurisdiction', 'TT').in('effective_from', retireDates);
  const { error: aErr } = await sb.from('finance_statutory_versions')
    .update({ status: 'active', is_active: true, activated_at: `${ACTIVE_DATE}T00:00:00Z`, retired_at: null })
    .eq('jurisdiction', 'TT').eq('effective_from', ACTIVE_DATE);
  if (aErr) { console.error('  ! activate 2026:', aErr.message); process.exit(1); }

  // 5) Verify.
  const { data: check } = await sb.from('finance_statutory_versions')
    .select('effective_from,status,is_active,nis_monthly_ceiling,paye_personal_allowance')
    .eq('jurisdiction', 'TT').order('effective_from');
  console.log('\n  Final state:');
  for (const r of check ?? []) {
    console.log(`   ${r.effective_from} | ${r.status.padEnd(8)} | active=${r.is_active} | PA=${r.paye_personal_allowance} | ceil=${r.nis_monthly_ceiling}`);
  }
  const actives = (check ?? []).filter((r) => r.is_active).length;
  console.log(`\n  active versions: ${actives} (expected 1)`);

  emitSql();
  console.log('\nDone. Remember: NOTIFY pgrst, \'reload schema\'; is not required (DML only).');
}

// ── durable SQL mirror (operator re-apply / repo record) ──────────────────────
function sqlLit(x) { return x === null || x === undefined ? 'null' : (typeof x === 'number' ? String(x) : `'${String(x).replace(/'/g, "''")}'`); }
function emitSql() {
  const lines = [];
  lines.push('-- Generated by scripts/apply-ttd-nis-history-seed.mjs — DO NOT edit by hand.');
  lines.push('-- Real T&T NIS history (2008–2026) from NIBTT; PAYE/HS point-in-time (see script header).');
  lines.push('begin;');
  for (const v of seed.versions) {
    const r = versionRow(v);
    lines.push(
      `insert into public.finance_statutory_versions ` +
      `(effective_from,label,jurisdiction,currency,paye_personal_allowance,paye_band1_ceiling,paye_band1_rate,paye_band2_rate,` +
      `hs_monthly_threshold,hs_weekly_high,hs_weekly_low,nis_monthly_ceiling,status,is_active,activated_at,retired_at) values (` +
      [r.effective_from, r.label, r.jurisdiction, r.currency, r.paye_personal_allowance, r.paye_band1_ceiling, r.paye_band1_rate, r.paye_band2_rate,
       r.hs_monthly_threshold, r.hs_weekly_high, r.hs_weekly_low, r.nis_monthly_ceiling, r.status, r.is_active, r.activated_at, r.retired_at].map(sqlLit).join(',') +
      `) on conflict (effective_from,jurisdiction) do update set ` +
      `label=excluded.label,paye_personal_allowance=excluded.paye_personal_allowance,paye_band1_ceiling=excluded.paye_band1_ceiling,` +
      `paye_band1_rate=excluded.paye_band1_rate,paye_band2_rate=excluded.paye_band2_rate,hs_monthly_threshold=excluded.hs_monthly_threshold,` +
      `hs_weekly_high=excluded.hs_weekly_high,hs_weekly_low=excluded.hs_weekly_low,nis_monthly_ceiling=excluded.nis_monthly_ceiling;`);
  }
  lines.push('');
  for (const v of seed.versions) {
    for (const c of v.classes) {
      lines.push(
        `insert into public.finance_nis_classes ` +
        `(statutory_version_id,class_no,weekly_min,weekly_max,assumed_average_weekly,employee_weekly,employer_weekly,class_z_weekly) ` +
        `select id,${c.class_no},${c.weekly_min},${sqlLit(c.weekly_max ?? null)},${sqlLit(c.assumed_average_weekly ?? null)},` +
        `${c.employee_weekly},${c.employer_weekly},${sqlLit(c.class_z_weekly ?? null)} ` +
        `from public.finance_statutory_versions where effective_from=${sqlLit(v.effective_date)} and jurisdiction='TT' ` +
        `on conflict (statutory_version_id,class_no) do update set weekly_min=excluded.weekly_min,weekly_max=excluded.weekly_max,` +
        `assumed_average_weekly=excluded.assumed_average_weekly,employee_weekly=excluded.employee_weekly,` +
        `employer_weekly=excluded.employer_weekly,class_z_weekly=excluded.class_z_weekly;`);
    }
  }
  lines.push('');
  const retireDates = seed.versions.map((v) => v.effective_date).filter((d) => d !== ACTIVE_DATE);
  lines.push(`update public.finance_statutory_versions set status='retired', is_active=false where jurisdiction='TT' and effective_from in (${retireDates.map((d) => `'${d}'`).join(',')});`);
  lines.push(`update public.finance_statutory_versions set status='active', is_active=true, activated_at='${ACTIVE_DATE}T00:00:00Z', retired_at=null where jurisdiction='TT' and effective_from='${ACTIVE_DATE}';`);
  lines.push('commit;');
  writeFileSync(new URL('../supabase/apply-ttd-nis-history-seed.sql', import.meta.url), lines.join('\n') + '\n');
  console.log('  wrote supabase/apply-ttd-nis-history-seed.sql');
}

main().catch((e) => { console.error(e); process.exit(1); });
