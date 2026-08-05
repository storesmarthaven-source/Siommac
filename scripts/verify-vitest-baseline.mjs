#!/usr/bin/env node
//
// Baseline-aware unit-test gate.
//
// `vitest run` cannot be the CI gate on its own while a committed baseline failure exists,
// and `continue-on-error` is not the answer — that tolerates NEW failures too, which is the
// entire thing a gate is for. This verifies the exact set instead:
//
//   · every actual failure is explicitly allowlisted   → pass (loudly, listing them)
//   · any failure that is not allowlisted              → fail
//   · zero failures                                    → pass
//   · an allowlist entry that no longer fails          → fail (stale debt must be deleted)
//
// Usage: node scripts/verify-vitest-baseline.mjs .artifacts/vitest.json

import { readFileSync } from 'node:fs';
import { dirname, resolve } from 'node:path';
import { fileURLToPath } from 'node:url';

const here = dirname(fileURLToPath(import.meta.url));
const reportPath = process.argv[2];

if (!reportPath) {
  console.error('Usage: node scripts/verify-vitest-baseline.mjs <vitest-json-report>');
  process.exit(2);
}

const readJson = (path, label) => {
  try { return JSON.parse(readFileSync(path, 'utf8')); }
  catch (error) {
    console.error(`Could not read ${label} at ${path}: ${error.message}`);
    // A missing or unparseable report means the run itself died. That is a failure, not a pass.
    process.exit(2);
  }
};

const report = readJson(resolve(reportPath), 'vitest report');
const baseline = readJson(resolve(here, 'vitest-baseline.json'), 'baseline allowlist');
const allowed = baseline.allowedFailures ?? [];

const basename = (path) => String(path ?? '').split(/[\\/]/).pop();

const failures = [];
for (const file of report.testResults ?? []) {
  for (const assertion of file.assertionResults ?? []) {
    if (assertion.status === 'failed') {
      failures.push({ file: basename(file.name), fullName: assertion.fullName });
    }
  }
}

const matches = (failure, entry) =>
  failure.file === entry.file && failure.fullName === entry.fullName;

const unexpected = failures.filter(f => !allowed.some(entry => matches(f, entry)));
const tolerated  = failures.filter(f => allowed.some(entry => matches(f, entry)));
const stale      = allowed.filter(entry => !failures.some(f => matches(f, entry)));

if (tolerated.length) {
  console.log(`Tolerated baseline failures (${tolerated.length}) — known debt, not a pass:`);
  for (const f of tolerated) {
    const entry = allowed.find(e => matches(f, e));
    console.log(`  · ${f.file} › ${f.fullName}`);
    console.log(`      owner: ${entry.owner ?? 'unassigned'} · since ${entry.firstSeen ?? 'unknown'}`);
    console.log(`      ${entry.reason ?? 'no reason recorded'}`);
  }
}

// A baseline entry that now passes is stale debt. Failing here is what forces the allowlist
// to shrink as tests are fixed, instead of quietly growing into a permanent exemption list.
if (stale.length) {
  console.error(`\n${stale.length} baseline entr${stale.length === 1 ? 'y' : 'ies'} no longer failing — remove from scripts/vitest-baseline.json:`);
  for (const entry of stale) console.error(`  · ${entry.file} › ${entry.fullName}`);
}

if (unexpected.length) {
  console.error(`\n${unexpected.length} unexpected test failure${unexpected.length === 1 ? '' : 's'}:`);
  for (const f of unexpected) console.error(`  · ${f.file} › ${f.fullName}`);
}

if (unexpected.length || stale.length) process.exit(1);

console.log(`\nUnit gate passed — ${failures.length} failure(s), all allowlisted.`);
