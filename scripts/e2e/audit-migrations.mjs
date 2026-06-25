/**
 * scripts/e2e/audit-migrations.mjs
 *
 * Migration drift auditor. There is no migration-tracking table (migrations are
 * applied by hand in the Supabase SQL editor), so this parses every file in
 * supabase/migrations/ for the schema objects it declares — tables, columns,
 * storage buckets — and probes the LIVE database to see which are actually
 * present. Surfaces the full drift list at once instead of discovering it
 * one failing feature at a time.
 *
 * Covers: tables, table columns (incl. add/alter/rename column), storage buckets.
 * Cannot probe via PostgREST: policies, indexes, functions, triggers, types —
 * those migrations show as "no probable objects" (—), not as applied/missing.
 *
 * RUN:  node scripts/e2e/audit-migrations.mjs
 *       npm run db:audit
 */

import { readFileSync, readdirSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

function env(key) {
  const txt = readFileSync(new URL('../../.env', import.meta.url), 'utf8');
  const m = txt.match(new RegExp(`^${key}=(.*)$`, 'm'));
  if (!m) { console.error(`Missing ${key} in .env`); process.exit(2); }
  return m[1].replace(/^["']|["']$/g, '').trim();
}

const sb = createClient(env('SUPABASE_URL'), env('SUPABASE_SERVICE_ROLE_KEY'), { auth: { persistSession: false } });

const CONSTRAINT_KW = /^(primary|foreign|unique|constraint|check|exclude|like|create|references)$/i;

function stripComments(sql) {
  return sql.replace(/\/\*[\s\S]*?\*\//g, '').replace(/--[^\n]*/g, '');
}

/** Split a create-table body into column/constraint segments on TOP-LEVEL commas
 *  only (ignoring commas inside parentheses or quotes). */
function splitTopLevel(body) {
  const segs = [];
  let depth = 0, cur = '', quote = null;
  for (const ch of body) {
    if (quote) { cur += ch; if (ch === quote) quote = null; continue; }
    if (ch === "'" || ch === '"') { quote = ch; cur += ch; continue; }
    if (ch === '(') { depth++; cur += ch; continue; }
    if (ch === ')') { depth--; cur += ch; continue; }
    if (ch === ',' && depth === 0) { segs.push(cur); cur = ''; continue; }
    cur += ch;
  }
  if (cur.trim()) segs.push(cur);
  return segs;
}

/** Extract declared tables→columns and storage buckets from one migration's SQL. */
function parse(sql) {
  const s = stripComments(sql);
  const tables = new Map(); // table → Set(columns)
  const buckets = new Set();
  const add = (tbl, col) => {
    const k = tbl.toLowerCase();
    if (!tables.has(k)) tables.set(k, new Set());
    if (col) tables.get(k).add(col.toLowerCase());
  };

  // create table ( … ) — split the body on TOP-LEVEL commas only, so enum values
  // inside `check (status in ('a','b'))` are never mistaken for columns.
  for (const m of s.matchAll(/create\s+table\s+(?:if\s+not\s+exists\s+)?(?:public\.)?["']?(\w+)["']?\s*\(([\s\S]*?)\n\s*\)\s*;/gi)) {
    add(m[1], null);
    for (const seg of splitTopLevel(m[2])) {
      const first = (seg.trim().match(/^["']?(\w+)["']?/) || [])[1];
      if (first && !CONSTRAINT_KW.test(first)) add(m[1], first);
    }
  }
  // alter table … add column <col>
  for (const m of s.matchAll(/alter\s+table\s+(?:public\.)?["']?(\w+)["']?\s+add\s+column\s+(?:if\s+not\s+exists\s+)?["']?(\w+)["']?/gi)) add(m[1], m[2]);
  // alter table … alter column <col>
  for (const m of s.matchAll(/alter\s+table\s+(?:public\.)?["']?(\w+)["']?\s+alter\s+column\s+["']?(\w+)["']?/gi)) add(m[1], m[2]);
  // alter table … rename column <old> to <new>  (applied ⇒ new name present)
  for (const m of s.matchAll(/alter\s+table\s+(?:public\.)?["']?(\w+)["']?\s+rename\s+column\s+["']?(\w+)["']?\s+to\s+["']?(\w+)["']?/gi)) add(m[1], m[3]);
  // insert into storage.buckets values ('<id>' …)
  for (const m of s.matchAll(/insert\s+into\s+storage\.buckets[\s\S]*?values\s*\(\s*'([^']+)'/gi)) buckets.add(m[1]);

  return { tables, buckets };
}

const _tableCache = new Map();
/** Probe a table + the given columns. Returns { missingTable } or { missingCols:[…] } or {} (all present). */
async function probeTable(table, cols) {
  const key = `${table}|${[...cols].sort().join(',')}`;
  if (_tableCache.has(key)) return _tableCache.get(key);

  const sel = cols.size ? [...cols].join(',') : '*';
  const { error } = await sb.from(table).select(sel, { head: true });
  let result = {};
  if (error) {
    const msg = error.message || '';
    const tableMissing = error.code === '42P01' || /could not find the table/i.test(msg) || (/relation .* does not exist/i.test(msg) && !/column/i.test(msg));
    if (tableMissing) {
      result = { missingTable: true };
    } else {
      const missingCols = [];
      for (const col of cols) {
        const { error: e2 } = await sb.from(table).select(col, { head: true });
        if (e2) missingCols.push(col);
      }
      result = missingCols.length ? { missingCols } : { other: msg };
    }
  }
  _tableCache.set(key, result);
  return result;
}

async function main() {
  const dir = new URL('../../supabase/migrations/', import.meta.url);
  const files = readdirSync(dir).filter(f => f.endsWith('.sql')).sort();

  const { data: bk } = await sb.storage.listBuckets();
  const haveBuckets = new Set((bk || []).map(b => b.id));

  const serious = [];   // table/bucket missing entirely — almost certainly needs running
  const colDiff = [];   // table exists, declared columns absent — usually a SUPERSEDED draft
  let applied = 0, unknown = 0;

  console.log(`\nAuditing ${files.length} migrations against the live DB…\n`);

  for (const f of files) {
    const sql = readFileSync(new URL(`../../supabase/migrations/${f}`, import.meta.url), 'utf8');
    const { tables, buckets } = parse(sql);
    if (tables.size + buckets.size === 0) { unknown++; console.log(`  —  ${f}  (no probeable objects: policies/indexes/functions only)`); continue; }

    const missingTables = [], colMiss = [];
    for (const [table, cols] of tables) {
      const r = await probeTable(table, cols);
      if (r.missingTable) missingTables.push(table);
      else if (r.missingCols) colMiss.push(`${table}.{${r.missingCols.join(',')}}`);
    }
    const missingBuckets = [...buckets].filter(id => !haveBuckets.has(id));

    if (missingTables.length || missingBuckets.length) {
      serious.push(f);
      const parts = [...missingTables.map(t => `table ${t}`), ...missingBuckets.map(b => `bucket ${b}`), ...colMiss];
      console.log(`  ✗  ${f}\n        MISSING → ${parts.join('  ·  ')}`);
    } else if (colMiss.length) {
      colDiff.push(f);
      console.log(`  ⚠  ${f}\n        columns differ (likely a SUPERSEDED draft) → ${colMiss.join('  ·  ')}`);
    } else {
      applied++; console.log(`  ✓  ${f}`);
    }
  }

  console.log(`\n────────────────────────────────────────`);
  console.log(`${applied} applied · ${colDiff.length} superseded-or-diff · ${serious.length} MISSING · ${unknown} unknown · ${files.length} total`);
  if (serious.length) {
    console.log(`\n✗ Tables/buckets missing — run these (Supabase SQL editor):`);
    for (const f of serious) console.log(`  • supabase/migrations/${f}`);
  }
  if (colDiff.length) {
    console.log(`\n⚠ Columns differ — these are usually EARLY DRAFTS later migrations redefined.`);
    console.log(`  Verify (the table likely exists with its canonical schema) BEFORE running any of:`);
    for (const f of colDiff) console.log(`  • ${f}`);
  }
  console.log(`\nBlind spots (this tool checks existence only — it can't see these):`);
  console.log(`  · NOT NULL / type / default / constraint changes (e.g. message_attachments.post_id)`);
  console.log(`  · policies, indexes, functions, triggers, types, seed data`);
  console.log(`  → for those, trust the behavioural E2E suites (npm run test:e2e).`);
  process.exit(serious.length ? 1 : 0);
}

main().catch(e => { console.error(e); process.exit(2); });
