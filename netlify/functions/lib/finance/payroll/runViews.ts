// lib/finance/payroll/runViews.ts
// Saved filter views CRUD — finance_payroll_run_views table.
// Authority: docs/module-contracts/PAYROLL_RUNS_REGISTER_SLICE.md §Decisions 4
//
// Scope rules (enforced server-side):
//   Personal views: owner only (create/update/delete). Any view_all holder can read.
//   Team views: create/update/delete requires finance.payroll.run_views.manage_team.
//   A view stores a validated PayrollRunViewFilters (no cursor/limit), never cached payroll values.
//
// §8 side-effects:
//   create: audit_log (all views) + app_event (team views only — team publish is significant)
//   update: audit_log (all) + app_event (team views only)
//   delete: audit_log (all) + app_event (team views only)
//
// NOTE: the finance_payroll_run_views table is created by migration 20260919000440 (operator-apply step).

import { sb } from '../../db';
import { emitAppEvent } from '../../appEvents';
import { writeHrAudit } from '../../hr/employeeCore';
import type {
  PayrollRunView,
  PayrollRunViewScope,
  PayrollRunViewCreateRequest,
  PayrollRunViewUpdateRequest,
  PayrollRunViewFilters,
  PayrollRunState,
  PayrollRunType,
} from '../../../../../types/payrollRuns';

// ── Validation ────────────────────────────────────────────────────────────────

/** Allowed sort values from the contract. */
const VALID_SORTS = new Set(['pay_date_desc', 'pay_date_asc', 'updated_desc']);

/** Allowed status values from the contract. */
const VALID_STATES = new Set([
  'draft','input_locked','calculation_failed','calculated',
  'pending_approval','returned','approved','locked','released','exported','cancelled',
]);

/** Allowed run types from the contract. */
const VALID_RUN_TYPES = new Set(['scheduled','off_cycle','correction','final_pay']);

/**
 * Validate and normalise a PayrollRunViewFilters payload.
 * The filters object is stored as-is in the jsonb column; we strip unknown
 * keys and validate each field so nothing malformed is ever persisted.
 * Throws { status: 400 } on validation failure.
 */
function validateFilters(raw: unknown): PayrollRunViewFilters {
  if (typeof raw !== 'object' || raw === null || Array.isArray(raw)) {
    throw Object.assign(new Error('View filters must be an object.'), { status: 400 });
  }
  const f = raw as Record<string, unknown>;
  const out: PayrollRunViewFilters = {};

  // search
  if (f['search'] !== undefined) {
    if (typeof f['search'] !== 'string' || f['search'].length > 200) {
      throw Object.assign(new Error('filters.search must be a string ≤ 200 chars.'), { status: 400 });
    }
    out.search = f['search'].trim() || undefined;
  }

  // states
  if (f['states'] !== undefined) {
    if (!Array.isArray(f['states'])) throw Object.assign(new Error('filters.states must be an array.'), { status: 400 });
    for (const s of f['states']) {
      if (typeof s !== 'string' || !VALID_STATES.has(s)) {
        throw Object.assign(new Error(`filters.states contains invalid value: "${s}".`), { status: 400 });
      }
    }
    out.states = f['states'].length > 0 ? (f['states'] as PayrollRunState[]) : undefined;
  }

  // runTypes
  if (f['runTypes'] !== undefined) {
    if (!Array.isArray(f['runTypes'])) throw Object.assign(new Error('filters.runTypes must be an array.'), { status: 400 });
    for (const rt of f['runTypes']) {
      if (typeof rt !== 'string' || !VALID_RUN_TYPES.has(rt)) {
        throw Object.assign(new Error(`filters.runTypes contains invalid value: "${rt}".`), { status: 400 });
      }
    }
    out.runTypes = f['runTypes'].length > 0 ? (f['runTypes'] as PayrollRunType[]) : undefined;
  }

  // payGroupIds
  if (f['payGroupIds'] !== undefined) {
    if (!Array.isArray(f['payGroupIds'])) throw Object.assign(new Error('filters.payGroupIds must be an array.'), { status: 400 });
    const UUID = /^[0-9a-fA-F]{8}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{4}-[0-9a-fA-F]{12}$/;
    for (const id of f['payGroupIds']) {
      if (typeof id !== 'string' || !UUID.test(id)) {
        throw Object.assign(new Error(`filters.payGroupIds contains invalid UUID: "${id}".`), { status: 400 });
      }
    }
    out.payGroupIds = f['payGroupIds'].length > 0 ? (f['payGroupIds'] as string[]) : undefined;
  }

  // periodFrom / periodTo
  const DATE = /^\d{4}-\d{2}-\d{2}$/;
  if (f['periodFrom'] !== undefined) {
    if (typeof f['periodFrom'] !== 'string' || !DATE.test(f['periodFrom'])) {
      throw Object.assign(new Error('filters.periodFrom must be YYYY-MM-DD.'), { status: 400 });
    }
    out.periodFrom = f['periodFrom'];
  }
  if (f['periodTo'] !== undefined) {
    if (typeof f['periodTo'] !== 'string' || !DATE.test(f['periodTo'])) {
      throw Object.assign(new Error('filters.periodTo must be YYYY-MM-DD.'), { status: 400 });
    }
    out.periodTo = f['periodTo'];
  }
  if (out.periodFrom && out.periodTo && out.periodFrom > out.periodTo) {
    throw Object.assign(new Error('filters.periodFrom must not be after periodTo.'), { status: 400 });
  }

  // sort
  if (f['sort'] !== undefined) {
    if (typeof f['sort'] !== 'string' || !VALID_SORTS.has(f['sort'])) {
      throw Object.assign(new Error(`filters.sort must be one of: ${[...VALID_SORTS].join(', ')}.`), { status: 400 });
    }
    out.sort = f['sort'] as PayrollRunViewFilters['sort'];
  }

  return out;
}

// ── DB row ────────────────────────────────────────────────────────────────────

interface RunViewRow {
  id: string;
  owner_id: string;
  name: string;
  scope: string;
  filters: unknown;
  created_at: string;
  updated_at: string;
}

function toPayrollRunView(row: RunViewRow, callerId: string): PayrollRunView {
  return {
    id:        row.id,
    name:      row.name,
    scope:     row.scope as PayrollRunViewScope,
    filters:   row.filters as PayrollRunViewFilters,
    ownerId:   row.owner_id,
    isOwn:     row.owner_id === callerId,
    updatedAt: row.updated_at,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

/** Returns the caller's personal views + all team-scoped views. */
export async function listRunViews(actorId: string): Promise<PayrollRunView[]> {
  // SECURITY: never embed the actor id into a PostgREST `.or()` filter STRING — that grammar is not
  // escaped and identifier characters (comma, paren, dot) would be parsed as filter syntax. Use two
  // PARAMETERISED `.eq()` queries (supabase-js URL-encodes the value) and merge in JS instead.
  const COLS = 'id,owner_id,name,scope,filters,created_at,updated_at';
  const [own, team] = await Promise.all([
    sb.from('finance_payroll_run_views').select(COLS).eq('owner_id', actorId),  // caller's own (personal + team)
    sb.from('finance_payroll_run_views').select(COLS).eq('scope', 'team'),      // all team views
  ]);
  if (own.error)  throw Object.assign(new Error('listRunViews/own: '  + own.error.message),  { status: 500 });
  if (team.error) throw Object.assign(new Error('listRunViews/team: ' + team.error.message), { status: 500 });

  // Dedup by id (a caller's own team view is in both sets), then order by scope then name.
  const byId = new Map<string, RunViewRow>();
  for (const r of [...(own.data ?? []), ...(team.data ?? [])] as RunViewRow[]) byId.set(r.id, r);
  const rows = [...byId.values()].sort((a, b) =>
    a.scope === b.scope ? a.name.localeCompare(b.name) : a.scope.localeCompare(b.scope));
  return rows.map(r => toPayrollRunView(r, actorId));
}

// ── Create ────────────────────────────────────────────────────────────────────

/**
 * Create a saved view.
 * @param canManageTeam  Must be true for team-scope views (checked by caller from `userCan`).
 */
export async function createRunView(
  req:           PayrollRunViewCreateRequest,
  actorId:       string,
  canManageTeam: boolean,
): Promise<PayrollRunView> {
  // Team scope requires elevated permission.
  if (req.scope === 'team' && !canManageTeam) {
    throw Object.assign(new Error('Creating a team-scope view requires the finance.payroll.run_views.manage_team permission.'), { status: 403 });
  }

  // Validate and strip filters (no cursor/limit fields stored).
  const validatedFilters = validateFilters(req.filters ?? {});

  const { data: row, error } = await sb
    .from('finance_payroll_run_views')
    .insert({
      owner_id:   actorId,
      name:       req.name.trim(),
      scope:      req.scope,
      filters:    validatedFilters,
      created_by: actorId,
    })
    .select('id,owner_id,name,scope,filters,created_at,updated_at')
    .single<RunViewRow>();
  if (error) {
    // Unique violation = duplicate name at same scope
    if (error.code === '23505') {
      throw Object.assign(new Error(`A ${req.scope} view named "${req.name.trim()}" already exists.`), { status: 409 });
    }
    throw Object.assign(new Error('createRunView: ' + error.message), { status: 500 });
  }

  // §8 side-effects: audit on all creates; app_event on team views.
  await writeHrAudit({
    submoduleKey: 'finance_payroll',
    recordId:     row.id,
    actorId,
    action:       'payroll_run_view.created',
    newState:     { name: row.name, scope: row.scope, filters: row.filters },
  });

  if (req.scope === 'team') {
    await emitAppEvent({
      eventType:        'finance.payroll.run_view.team_created',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run_view',
      sourceEntityId:   row.id,
      actorUserId:      actorId,
      severity:         'info',
      payload:          { viewId: row.id, name: row.name },
    });
  }

  return toPayrollRunView(row, actorId);
}

// ── Update ────────────────────────────────────────────────────────────────────

/**
 * Update a saved view (name and/or filters).
 * Personal views: only the owner. Team views: owner OR canManageTeam.
 */
export async function updateRunView(
  req:           PayrollRunViewUpdateRequest,
  actorId:       string,
  canManageTeam: boolean,
): Promise<PayrollRunView> {
  // Fetch the existing view.
  const { data: existing, error: fetchErr } = await sb
    .from('finance_payroll_run_views')
    .select('id,owner_id,name,scope,filters,created_at,updated_at')
    .eq('id', req.id)
    .maybeSingle<RunViewRow>();
  if (fetchErr) throw Object.assign(new Error('updateRunView/fetch: ' + fetchErr.message), { status: 500 });
  if (!existing) throw Object.assign(new Error('Saved view not found.'), { status: 404 });

  // Ownership guard.
  const isOwner     = existing.owner_id === actorId;
  const isTeamView  = existing.scope === 'team';
  if (!isOwner && !(isTeamView && canManageTeam)) {
    throw Object.assign(new Error('You do not have permission to update this view.'), { status: 403 });
  }

  const patch: Record<string, unknown> = {};
  if (req.name !== undefined)    patch['name']    = req.name.trim();
  if (req.filters !== undefined) patch['filters'] = validateFilters(req.filters);

  if (Object.keys(patch).length === 0) {
    // Nothing to update — return the existing view.
    return toPayrollRunView(existing, actorId);
  }

  const { data: updated, error: updErr } = await sb
    .from('finance_payroll_run_views')
    .update(patch)
    .eq('id', req.id)
    .select('id,owner_id,name,scope,filters,created_at,updated_at')
    .single<RunViewRow>();
  if (updErr) {
    if (updErr.code === '23505') {
      throw Object.assign(new Error(`A ${existing.scope} view named "${String(patch['name'] ?? existing.name)}" already exists.`), { status: 409 });
    }
    throw Object.assign(new Error('updateRunView/update: ' + updErr.message), { status: 500 });
  }

  await writeHrAudit({
    submoduleKey:  'finance_payroll',
    recordId:      req.id,
    actorId,
    action:        'payroll_run_view.updated',
    previousState: { name: existing.name, filters: existing.filters },
    newState:      { name: updated.name,  filters: updated.filters  },
  });

  if (isTeamView) {
    await emitAppEvent({
      eventType:        'finance.payroll.run_view.team_updated',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run_view',
      sourceEntityId:   req.id,
      actorUserId:      actorId,
      severity:         'info',
      payload:          { viewId: req.id, name: updated.name },
    });
  }

  return toPayrollRunView(updated, actorId);
}

// ── Delete ────────────────────────────────────────────────────────────────────

/**
 * Delete a saved view.
 * Personal views: only the owner. Team views: owner OR canManageTeam.
 */
export async function deleteRunView(
  id:            string,
  actorId:       string,
  canManageTeam: boolean,
): Promise<void> {
  const { data: existing, error: fetchErr } = await sb
    .from('finance_payroll_run_views')
    .select('id,owner_id,name,scope,filters,created_at,updated_at')
    .eq('id', id)
    .maybeSingle<RunViewRow>();
  if (fetchErr) throw Object.assign(new Error('deleteRunView/fetch: ' + fetchErr.message), { status: 500 });
  if (!existing) throw Object.assign(new Error('Saved view not found.'), { status: 404 });

  const isOwner    = existing.owner_id === actorId;
  const isTeamView = existing.scope === 'team';
  if (!isOwner && !(isTeamView && canManageTeam)) {
    throw Object.assign(new Error('You do not have permission to delete this view.'), { status: 403 });
  }

  const { error: delErr } = await sb
    .from('finance_payroll_run_views')
    .delete()
    .eq('id', id);
  if (delErr) throw Object.assign(new Error('deleteRunView/delete: ' + delErr.message), { status: 500 });

  await writeHrAudit({
    submoduleKey:  'finance_payroll',
    recordId:      id,
    actorId,
    action:        'payroll_run_view.deleted',
    previousState: { name: existing.name, scope: existing.scope },
  });

  if (isTeamView) {
    await emitAppEvent({
      eventType:        'finance.payroll.run_view.team_deleted',
      sourceModule:     'finance_payroll',
      sourceEntityType: 'payroll_run_view',
      sourceEntityId:   id,
      actorUserId:      actorId,
      severity:         'info',
      payload:          { viewId: id, name: existing.name },
    });
  }
}
