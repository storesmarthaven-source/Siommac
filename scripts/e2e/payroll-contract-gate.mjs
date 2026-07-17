/**
 * Static guard for the payroll execution E2E contract.
 *
 * The production routes require explicit execution periods and stable
 * idempotency keys. Direct database fixtures must also carry the complete run
 * identity. Failing here produces one actionable error instead of a cascade of
 * lifecycle failures later in the live suite.
 */

import { readdirSync, readFileSync } from 'node:fs';
import { dirname, join } from 'node:path';
import { fileURLToPath } from 'node:url';
import {
  PAYROLL_PERIOD_YEAR_BANDS,
  assertPayrollPeriodAllocatorDisjoint,
} from './helpers/payrollRun.mjs';

const here = dirname(fileURLToPath(import.meta.url));
const defaultSuitesDir = join(here, 'suites');

function escapeRegExp(value) {
  return value.replace(/[.*+?^${}()|[\]\\]/g, '\\$&');
}

function extractCall(source, start) {
  const open = source.indexOf('(', start);
  if (open < 0) return source.slice(start);

  let depth = 0;
  let quote = null;
  let lineComment = false;
  let blockComment = false;

  for (let index = open; index < source.length; index += 1) {
    const char = source[index];
    const next = source[index + 1];

    if (lineComment) {
      if (char === '\n') lineComment = false;
      continue;
    }
    if (blockComment) {
      if (char === '*' && next === '/') {
        blockComment = false;
        index += 1;
      }
      continue;
    }
    if (quote) {
      if (char === '\\') {
        index += 1;
        continue;
      }
      if (char === quote) quote = null;
      continue;
    }
    if (char === '/' && next === '/') {
      lineComment = true;
      index += 1;
      continue;
    }
    if (char === '/' && next === '*') {
      blockComment = true;
      index += 1;
      continue;
    }
    if (char === "'" || char === '"' || char === '`') {
      quote = char;
      continue;
    }
    if (char === '(') depth += 1;
    if (char === ')') {
      depth -= 1;
      if (depth === 0) return source.slice(start, index + 1);
    }
  }

  return source.slice(start);
}

function routeCalls(source, route) {
  const pattern = new RegExp(
    `api\\s*\\(\\s*(['"\`])${escapeRegExp(route)}\\1`,
    'g',
  );
  return [...source.matchAll(pattern)].map((match) => ({
    index: match.index,
    source: extractCall(source, match.index),
  }));
}

function lineNumber(source, index) {
  return source.slice(0, index).split('\n').length;
}

export function assertPayrollE2EContracts(suitesDir = defaultSuitesDir) {
  const violations = [];
  const files = readdirSync(suitesDir).filter((file) => file.endsWith('.mjs')).sort();

  for (const file of files) {
    const source = readFileSync(join(suitesDir, file), 'utf8');

    for (const call of routeCalls(source, 'finance/payroll/runs/create')) {
      if (!call.source.includes('payrollRunCommand(')) {
        violations.push({
          file,
          line: lineNumber(source, call.index),
          message: 'run creation must use payrollRunCommand (explicit period + idempotency key)',
        });
      }
    }

    for (const call of routeCalls(source, 'finance/payroll/runs/calculate')) {
      if (!call.source.includes('payrollCalculationCommand(')) {
        violations.push({
          file,
          line: lineNumber(source, call.index),
          message: 'calculation must use payrollCalculationCommand (stable idempotency key)',
        });
      }
    }

    for (const call of routeCalls(source, 'finance/payroll/runs/lock')) {
      if (!call.source.includes('payrollLockCommand(')) {
        violations.push({
          file,
          line: lineNumber(source, call.index),
          message: 'run lock must use payrollLockCommand (stable idempotency key)',
        });
      }
    }

    for (const call of routeCalls(source, 'finance/payroll/runs/reopen')) {
      if (!call.source.includes('payrollReopenCommand(')) {
        violations.push({
          file,
          line: lineNumber(source, call.index),
          message: 'run reopen must use payrollReopenCommand (reason + stable idempotency key)',
        });
      }
    }

    const directSeed = /from\(\s*['"]finance_payroll_runs['"]\s*\)\s*\.insert\s*\(\s*(?:\{|\[)/g;
    for (const match of source.matchAll(directSeed)) {
      violations.push({
        file,
        line: lineNumber(source, match.index),
        message: 'direct run fixtures must use payrollRunSeed (complete execution identity)',
      });
    }

    // All suites share one harness TAG per run.mjs invocation, and payroll-run
    // identity is (pay group, period_start, period_end, run_type) under
    // migration 420's partial unique indexes. Run periods must therefore come
    // from the CENTRAL registry (PAYROLL_PERIOD_SALTS + payrollPeriod() in
    // helpers/payrollRun.mjs, uniqueness-validated below and at import time) —
    // never from an ad-hoc seedDateFromTag call whose salt another suite might
    // also pick.

    // Direct ad-hoc period derivation.
    const directPeriod = /(?:periodStart|periodMonth|period)\s*:\s*seedDateFromTag\(/g;
    for (const match of source.matchAll(directPeriod)) {
      violations.push({
        file,
        line: lineNumber(source, match.index),
        message: 'run periods must come from payrollPeriod(suite, key, TAG) — claim a salt in PAYROLL_PERIOD_SALTS instead of calling seedDateFromTag directly',
      });
    }

    // Indirect derivation through a local variable
    // (const p = seedDateFromTag(...); ... periodStart: p).
    const periodVars = [...source.matchAll(/(?:const|let)\s+(\w+)\s*=\s*seedDateFromTag\(/g)]
      .map((m) => m[1]);
    for (const name of periodVars) {
      const use = new RegExp(`(?:periodStart|periodMonth|period)\\s*:\\s*${name}\\b`).exec(source);
      if (use) {
        violations.push({
          file,
          line: lineNumber(source, use.index),
          message: `run period is derived from local seedDateFromTag via '${name}' — use payrollPeriod(suite, key, TAG) with a registered salt`,
        });
      }
    }

    // A suite may only draw from its OWN registry entry — reusing another
    // suite's key/band would recreate the cross-suite collision under one TAG.
    const suiteKey = file.replace(/\.mjs$/, '');
    for (const re of [
      /payrollPeriod\(\s*['"]([^'"]+)['"]/g,
      /payrollPeriodYear\(\s*['"]([^'"]+)['"]/g,
    ]) {
      for (const match of source.matchAll(re)) {
        if (match[1] !== suiteKey) {
          violations.push({
            file,
            line: lineNumber(source, match.index),
            message: `payroll period allocator called with '${match[1]}' inside ${file} — a suite must use its own registry entry ('${suiteKey}')`,
          });
        }
      }
    }

    // Year-band suites must draw their business year from the central allocator,
    // never a private year hash (the exact class of the removed yearFromTag/
    // taxYearFromTag helpers, which could collide across suites).
    if (PAYROLL_PERIOD_YEAR_BANDS[suiteKey]) {
      if (!new RegExp(`payrollPeriodYear\\(\\s*['"]${suiteKey}['"]`).test(source)) {
        violations.push({
          file,
          line: 1,
          message: `${file} is a registered year-band suite but never calls payrollPeriodYear('${suiteKey}', TAG)`,
        });
      }
    }
    for (const m of source.matchAll(/function\s+(taxYearFromTag|yearFromTag)\b/g)) {
      violations.push({
        file,
        line: lineNumber(source, m.index),
        message: `local ${m[1]}() reintroduces a private year allocator — draw the year from payrollPeriodYear() instead`,
      });
    }
  }

  // Registry-level invariant: salts unique, year bands mutually disjoint, and no
  // salt year-window overlaps any year band. The helper throws at import too;
  // surfacing it here keeps every contract failure in one report.
  try {
    assertPayrollPeriodAllocatorDisjoint();
  } catch (err) {
    violations.push({
      file: 'helpers/payrollRun.mjs',
      line: 0,
      message: err.message,
    });
  }

  if (violations.length > 0) {
    const detail = violations
      .map(({ file, line, message }) => `  ${file}:${line} ${message}`)
      .join('\n');
    throw new Error(`Payroll E2E contract gate failed:\n${detail}`);
  }
}

if (process.argv[1] === fileURLToPath(import.meta.url)) {
  assertPayrollE2EContracts();
  console.log('Payroll E2E contract gate passed.');
}
