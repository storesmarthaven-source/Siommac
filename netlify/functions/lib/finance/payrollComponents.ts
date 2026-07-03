// ============================================================================
// Finance — Pay-Component Catalogue (Phase 1)
// ============================================================================
// Finance owns the catalogue. HR employees reference active components when
// creating pay items (hr_employee_pay_items), but HR cannot create or retire
// components. Components are soft-deleted (retire = is_active false) — never
// hard-deleted (they may be referenced by historical run lines).
// Permissions: finance.payroll.components.{view,manage}
// ============================================================================

import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from '../hr/employeeCore';

export interface PayComponentRow {
  id: string;
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory: boolean;
  isTaxable: boolean;
  reducesChargeable: boolean;
  glAccountCode: string | null;
  costAllocationRequired: boolean;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

interface DbRow {
  id: string; code: string; name: string; kind: string;
  is_statutory: boolean; is_taxable: boolean; reduces_chargeable: boolean;
  gl_account_code: string | null; cost_allocation_required: boolean; is_active: boolean;
  created_by: string | null; updated_by: string | null;
  created_at: string; updated_at: string;
}

function toDto(r: DbRow): PayComponentRow {
  return {
    id: r.id, code: r.code, name: r.name, kind: r.kind as 'earning' | 'deduction',
    isStatutory: r.is_statutory, isTaxable: r.is_taxable, reducesChargeable: r.reduces_chargeable,
    glAccountCode: r.gl_account_code, costAllocationRequired: r.cost_allocation_required,
    isActive: r.is_active, createdBy: r.created_by, updatedBy: r.updated_by,
    createdAt: r.created_at, updatedAt: r.updated_at,
  };
}

// ── List ──────────────────────────────────────────────────────────────────────

export async function listPayComponents(opts: {
  activeOnly?: boolean;
  kind?: 'earning' | 'deduction';
  isStatutory?: boolean;
} = {}): Promise<PayComponentRow[]> {
  let q = sb.from('finance_pay_components').select('*').order('kind').order('name');
  if (opts.activeOnly !== false) q = q.eq('is_active', true);
  if (opts.kind) q = q.eq('kind', opts.kind);
  if (opts.isStatutory !== undefined) q = q.eq('is_statutory', opts.isStatutory);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error('listPayComponents: ' + error.message), { status: 500 });
  return ((data ?? []) as DbRow[]).map(toDto);
}

// ── Get single ────────────────────────────────────────────────────────────────

export async function getPayComponent(id: string): Promise<PayComponentRow | null> {
  const { data, error } = await sb.from('finance_pay_components').select('*').eq('id', id).maybeSingle<DbRow>();
  if (error) throw Object.assign(new Error('getPayComponent: ' + error.message), { status: 500 });
  return data ? toDto(data) : null;
}

// ── Create ────────────────────────────────────────────────────────────────────

export interface CreatePayComponentInput {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory?: boolean;
  isTaxable?: boolean;
  reducesChargeable?: boolean;
  glAccountCode?: string | null;
  costAllocationRequired?: boolean;
  actorId: string;
}

export async function createPayComponent(input: CreatePayComponentInput): Promise<PayComponentRow> {
  const patch = {
    code: input.code.toUpperCase().trim(),
    name: input.name.trim(),
    kind: input.kind,
    is_statutory: input.isStatutory ?? false,
    is_taxable: input.isTaxable ?? true,
    reduces_chargeable: input.reducesChargeable ?? false,
    gl_account_code: input.glAccountCode ?? null,
    cost_allocation_required: input.costAllocationRequired ?? false,
    is_active: true,
    created_by: input.actorId,
    updated_by: input.actorId,
  };

  const { data, error } = await sb.from('finance_pay_components').insert(patch).select().single<DbRow>();
  if (error) {
    if (error.code === '23505') throw Object.assign(new Error(`Pay component code "${input.code}" already exists.`), { status: 409 });
    throw Object.assign(new Error('createPayComponent: ' + error.message), { status: 500 });
  }

  const row = toDto(data);

  // Audit + event (§2 side-effects)
  await writeHrAudit({
    submoduleKey: 'finance_payroll_components', recordId: row.id,
    actorId: input.actorId, action: 'pay_component.created',
    previousState: null, newState: { code: row.code, name: row.name, kind: row.kind },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.component.created',
    sourceModule: 'finance_payroll_components',
    sourceEntityType: 'pay_component', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { code: row.code, name: row.name, kind: row.kind },
  });

  return row;
}

// ── Update ────────────────────────────────────────────────────────────────────

export interface UpdatePayComponentInput {
  id: string;
  name?: string;
  isStatutory?: boolean;
  isTaxable?: boolean;
  reducesChargeable?: boolean;
  glAccountCode?: string | null;
  costAllocationRequired?: boolean;
  actorId: string;
}

export async function updatePayComponent(input: UpdatePayComponentInput): Promise<PayComponentRow> {
  const existing = await getPayComponent(input.id);
  if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
  if (!existing.isActive) throw Object.assign(new Error('Cannot update a retired pay component.'), { status: 422 });

  const patch: Record<string, unknown> = { updated_by: input.actorId };
  if (input.name !== undefined) patch['name'] = input.name.trim();
  if (input.isStatutory !== undefined) patch['is_statutory'] = input.isStatutory;
  if (input.isTaxable !== undefined) patch['is_taxable'] = input.isTaxable;
  if (input.reducesChargeable !== undefined) patch['reduces_chargeable'] = input.reducesChargeable;
  if (input.glAccountCode !== undefined) patch['gl_account_code'] = input.glAccountCode;
  if (input.costAllocationRequired !== undefined) patch['cost_allocation_required'] = input.costAllocationRequired;

  const { data, error } = await sb.from('finance_pay_components').update(patch).eq('id', input.id).select().single<DbRow>();
  if (error) throw Object.assign(new Error('updatePayComponent: ' + error.message), { status: 500 });
  const row = toDto(data);

  await writeHrAudit({
    submoduleKey: 'finance_payroll_components', recordId: row.id,
    actorId: input.actorId, action: 'pay_component.updated',
    previousState: existing, newState: row,
  });
  void emitAppEvent({
    eventType: 'finance.payroll.component.updated',
    sourceModule: 'finance_payroll_components',
    sourceEntityType: 'pay_component', sourceEntityId: row.id,
    actorUserId: input.actorId, severity: 'info',
    payload: { code: row.code },
  });

  return row;
}

// ── Retire ────────────────────────────────────────────────────────────────────
// Soft-delete only: sets is_active=false. Never hard-deleted (historical refs).

export async function retirePayComponent(id: string, actorId: string): Promise<void> {
  const existing = await getPayComponent(id);
  if (!existing) throw Object.assign(new Error('Pay component not found.'), { status: 404 });
  if (!existing.isActive) throw Object.assign(new Error('Pay component is already retired.'), { status: 422 });

  const { error } = await sb.from('finance_pay_components')
    .update({ is_active: false, updated_by: actorId })
    .eq('id', id);
  if (error) throw Object.assign(new Error('retirePayComponent: ' + error.message), { status: 500 });

  await writeHrAudit({
    submoduleKey: 'finance_payroll_components', recordId: id,
    actorId, action: 'pay_component.retired',
    previousState: { isActive: true }, newState: { isActive: false },
  });
  void emitAppEvent({
    eventType: 'finance.payroll.component.retired',
    sourceModule: 'finance_payroll_components',
    sourceEntityType: 'pay_component', sourceEntityId: id,
    actorUserId: actorId, severity: 'info',
    payload: { code: existing.code },
  });
}
