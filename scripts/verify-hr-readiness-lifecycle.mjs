/**
 * scripts/verify-hr-readiness-lifecycle.mjs
 *
 * Service-role PostgREST verification for
 *   supabase/migrations/20260929000001_hr_readiness_lifecycle_tx.sql
 *   sha256 9443fe3280319dbaeedc8b1aa314863c1fdbf476d343cb2d3669c7c85a179fa0
 *
 * WHY THIS EXISTS, separately from
 * scripts/sql/verify_20260929000001_hr_readiness_lifecycle_tx.sql:
 * the SQL script proves the objects exist IN THE DATABASE. It cannot prove the
 * Data API picked them up — a session running SQL bypasses PostgREST entirely.
 * This probe crosses the API boundary the application actually uses.
 *
 * It calls the functions for real. A probe that only checks for a "function not
 * found" message proves nothing about the body (a documented trap in this
 * build: only trust a probe that reaches the function body).
 *
 * Read-only with respect to business data: `hr_readiness_recalculate` is
 * declared STABLE and writes nothing, and the transition command is exercised
 * only in its REFUSAL paths, which raise before the first insert.
 *
 * Usage:  node scripts/verify-hr-readiness-lifecycle.mjs
 * Exit:   0 = every check passed · 1 = at least one failed · 2 = bad environment
 */

import { readFileSync } from 'node:fs';
import { createClient } from '@supabase/supabase-js';

const REQUIRED_ENV = ['SUPABASE_URL', 'SUPABASE_SERVICE_ROLE_KEY'];

function loadEnv() {
  const text = readFileSync(new URL('../.env', import.meta.url), 'utf8');
  const out = {};
  for (const line of text.split(/\r?\n/)) {
    const m = line.match(/^([A-Z0-9_]+)=(.*)$/);
    if (m && REQUIRED_ENV.includes(m[1])) out[m[1]] = m[2].replace(/^["']|["']$/g, '').trim();
  }
  for (const k of REQUIRED_ENV) {
    if (!out[k]) { console.error(`Missing ${k} in .env`); process.exit(2); }
  }
  return out;
}

const env = loadEnv();
const sb = createClient(env.SUPABASE_URL, env.SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

let failures = 0;
const pass = (label, detail) => console.log(`  PASS  ${label}${detail ? ` — ${detail}` : ''}`);
const fail = (label, detail) => { failures += 1; console.error(`  FAIL  ${label} — ${detail}`); };

console.log('\nPostgREST verification — HR readiness lifecycle');
console.log(`Endpoint: ${env.SUPABASE_URL}\n`);

// ── 1. Recalculation reaches its BODY and returns the real contract ─────────
console.log('1. hr_readiness_recalculate — real call, real result');
{
  const { data, error } = await sb.rpc('hr_readiness_recalculate', {
    p_employee_id: '__verify_no_such_employee__',
  });
  if (error) {
    fail('hr_readiness_recalculate', `${error.code ?? ''}: ${error.message}`);
  } else if (!data || typeof data !== 'object') {
    fail('hr_readiness_recalculate', 'returned no object — the body did not execute');
  } else {
    const keys = ['totalControls', 'readyControls', 'percent', 'blockedDomains', 'unresolvedWorkItems'];
    const missing = keys.filter(k => !(k in data));
    if (missing.length) {
      fail('hr_readiness_recalculate', `result is missing ${missing.join(', ')}`);
    } else if (data.readyControls !== 0) {
      // The single most dangerous wrong answer on this surface.
      fail('hr_readiness_recalculate', `an unevaluated employee reported ${data.readyControls} ready controls`);
    } else if (data.totalControls < 1) {
      fail('hr_readiness_recalculate', 'no active blocking controls are seeded — readiness cannot be measured');
    } else {
      pass('hr_readiness_recalculate', `${data.readyControls}/${data.totalControls} ready, ${data.percent}% for an unevaluated employee`);
    }
  }
}

// ── 2. The transition command exists and its GUARDS execute ────────────────
// Each call below must be REFUSED by a guard inside the body. A "function not
// found" here means the migration did not apply; a success would mean a guard
// is missing.
console.log('\n2. hr_readiness_work_item_transition_tx — guards reached (refusals prove the body ran)');

const baseArgs = {
  p_actor_id: 'verify-actor',
  p_employee_id: '__verify_no_such_employee__',
  p_control_key: 'assignment.complete',
  p_work_item_id: null,
  p_action: 'verify_probe',
  p_to_status: 'assigned',
  p_owner_type: 'role',
  p_owner_id: 'hr_manager',
  p_owner_label: 'HR Manager',
  p_recipient_ids: [],
  p_responsible_team: null,
  p_severity: 'warning',
  p_due_date: null,
  p_decision: null,
  p_decision_reason: null,
  p_note: null,
  p_template_version_id: null,
  p_handoff: null,
  p_correlation_id: 'verify-correlation',
};

async function expectRefusal(label, overrides, matcher) {
  const { error } = await sb.rpc('hr_readiness_work_item_transition_tx', { ...baseArgs, ...overrides });
  if (!error) {
    fail(label, 'the call SUCCEEDED — a guard is missing and this probe just wrote data');
    return;
  }
  if (/Could not find the function|PGRST202/i.test(error.message)) {
    fail(label, 'function not found — the migration has not been applied');
    return;
  }
  if (matcher.test(error.message)) pass(label, error.message.slice(0, 90));
  else fail(label, `refused, but with an unexpected message: ${error.message}`);
}

await expectRefusal('blank actor is refused', { p_actor_id: '' }, /actor is required/i);
await expectRefusal('blank correlation id is refused', { p_correlation_id: '' }, /correlation id is required/i);
await expectRefusal('unknown status is refused', { p_to_status: 'not_a_status' }, /unknown readiness status/i);
// Fail-closed ownership, re-asserted inside the transaction.
await expectRefusal('missing owner is refused (fail closed)', { p_owner_type: null, p_owner_id: null }, /resolved readiness owner is required/i);
await expectRefusal('unknown owner type is refused', { p_owner_type: 'department' }, /resolved readiness owner is required/i);
await expectRefusal('unknown control is refused', { p_control_key: '__no_such_control__' }, /readiness control .* not found/i);
// Guards pass, then the employee lookup refuses — proving execution reached
// past every input guard into the real body.
await expectRefusal('unknown employee is refused', {}, /employee .* not found/i);

// ── 3. Both readiness workflow templates are published and correctly shaped ─
console.log('\n3. Readiness workflow templates — published, correct assignment kinds');
{
  const { data: templates, error } = await sb.from('workflow_templates')
    .select('id, template_key, module_key, workflow_type')
    .in('template_key', ['hr_readiness_review_role', 'hr_readiness_review_user']);
  if (error) {
    fail('workflow_templates', `${error.code ?? ''}: ${error.message}`);
  } else if (templates.length !== 2) {
    fail('workflow_templates', `expected 2 readiness templates, found ${templates.length}`);
  } else {
    pass('workflow_templates', templates.map(t => t.template_key).sort().join(', '));

    const expectedKind = {
      hr_readiness_review_role: 'role',
      hr_readiness_review_user: 'fixed_user',
    };
    for (const tpl of templates) {
      const { data: versions, error: vErr } = await sb.from('workflow_template_versions')
        .select('id, version_no, version_status, definition')
        .eq('template_id', tpl.id).eq('version_status', 'published');
      if (vErr) { fail(`${tpl.template_key} version`, vErr.message); continue; }
      if (!versions.length) { fail(`${tpl.template_key} version`, 'no PUBLISHED version — the engine cannot instantiate it'); continue; }

      const step = versions[0].definition?.steps?.[0];
      if (!step) { fail(`${tpl.template_key} definition`, 'published definition has no first step'); continue; }
      if (step.stepType !== 'verification') {
        fail(`${tpl.template_key} definition`, `stepType is "${step.stepType}" — _create_instance raises WF422 on anything outside its vocabulary`);
        continue;
      }
      if (step.assignment?.type !== expectedKind[tpl.template_key]) {
        fail(`${tpl.template_key} definition`, `assignment kind is "${step.assignment?.type}", expected "${expectedKind[tpl.template_key]}"`);
        continue;
      }
      if (tpl.workflow_type !== 'hr_readiness_review') {
        fail(`${tpl.template_key} workflow_type`, `is "${tpl.workflow_type}", expected hr_readiness_review`);
        continue;
      }
      pass(`${tpl.template_key}`, `published v${versions[0].version_no}, ${step.assignment.type} assignment`);
    }
  }
}

// ── 4. The readiness tables are still reachable over the Data API ──────────
console.log('\n4. Readiness tables resolve over PostgREST (explicit projections)');
for (const [table, columns] of [
  ['hr_readiness_controls', 'id, control_key, label, domain, resolution_type, is_blocking, is_active'],
  ['hr_readiness_control_instances', 'id, employee_id, control_id, state, percent, evaluated_at'],
  ['hr_readiness_work_items', 'id, employee_id, control_id, status, severity, due_date, correlation_id, workflow_id'],
  ['hr_readiness_work_item_transitions', 'id, work_item_id, from_status, to_status, actor_id, correlation_id'],
]) {
  const { data, error } = await sb.from(table).select(columns).limit(3);
  if (error) fail(table, `${error.code ?? ''}: ${error.message}`);
  else pass(table, data.length ? `${data.length} row(s)` : 'projection resolved, table empty');
}

console.log(`\n${failures === 0 ? 'ALL CHECKS PASSED' : `${failures} CHECK(S) FAILED`}\n`);
process.exit(failures === 0 ? 0 : 1);
