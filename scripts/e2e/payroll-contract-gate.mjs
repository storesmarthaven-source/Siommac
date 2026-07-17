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
  const saltUsage = new Map();
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

    // All suites share one harness TAG per run.mjs invocation, so the same
    // seedDateFromTag salt in two files produces the SAME period_start — and
    // the scheduled-run business key (migration 420) makes that a unique
    // violation at seed time. Salts must be globally unique across suites.
    // Within one file a repeated salt is legitimate (duplicate-key rejection
    // and idempotent-replay tests intentionally reuse the same period).
    const periodSalt = /(?:periodStart|periodMonth)\s*:\s*seedDateFromTag\(\s*TAG\s*,\s*(\d+)\s*\)/g;
    for (const match of source.matchAll(periodSalt)) {
      const salt = match[1];
      saltUsage.set(salt, saltUsage.get(salt) ?? new Map());
      const files = saltUsage.get(salt);
      if (!files.has(file)) files.set(file, lineNumber(source, match.index));
    }
  }

  for (const [salt, files] of saltUsage) {
    if (files.size > 1) {
      for (const [file, line] of files) {
        violations.push({
          file,
          line,
          message: `payroll period salt ${salt} is used by ${files.size} suites (${[...files.keys()].join(', ')}) — same TAG + same salt = same period_start = scheduled-run identity collision; assign a globally unique salt`,
        });
      }
    }
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
