/**
 * netlify/functions/lib/hr/documentsRequirements.ts
 *
 * CRUD for hr_document_requirements (document policy).
 * Every mutation: emitAppEvent (fire-and-forget void) + writeHrAudit (awaited, throws).
 */

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';
import { writeHrAudit } from './employeeCore';

export interface DocumentRequirement {
  id: string;
  documentType: string;
  label: string;
  appliesToScope: 'all' | 'role' | 'employment_type' | 'department';
  appliesToValue: string | null;
  requiresExpiry: boolean;
  reminderDays: number[];
  minConfidentiality: string | null;
  isActive: boolean;
  /** When true, a missing/expired doc blocks onboarding case launch. Added in 20260707100000. */
  blocksOnboarding: boolean;
  /** When true, HR may waive this requirement with a written reason. Added in 20260707100000. */
  canWaive: boolean;
  createdBy: string | null;
  createdAt: string;
  updatedAt: string | null;
  metadata: Record<string, unknown>;
}

interface RawRequirement {
  id: string;
  document_type: string;
  label: string;
  applies_to_scope: string;
  applies_to_value: string | null;
  requires_expiry: boolean;
  reminder_days: number[];
  min_confidentiality: string | null;
  is_active: boolean;
  blocks_onboarding: boolean | null;
  can_waive: boolean | null;
  created_by: string | null;
  created_at: string;
  updated_at: string | null;
  metadata: Record<string, unknown>;
}

function toDto(r: RawRequirement): DocumentRequirement {
  return {
    id: r.id,
    documentType: r.document_type,
    label: r.label,
    appliesToScope: r.applies_to_scope as DocumentRequirement['appliesToScope'],
    appliesToValue: r.applies_to_value,
    requiresExpiry: r.requires_expiry,
    reminderDays: r.reminder_days ?? [30, 7, 0],
    minConfidentiality: r.min_confidentiality,
    isActive: r.is_active,
    blocksOnboarding: r.blocks_onboarding ?? false,
    canWaive: r.can_waive ?? false,
    createdBy: r.created_by,
    createdAt: r.created_at,
    updatedAt: r.updated_at,
    metadata: r.metadata ?? {},
  };
}

export async function listRequirements(activeOnly = true): Promise<DocumentRequirement[]> {
  let q = sb
    .from('hr_document_requirements')
    .select('*')
    .order('document_type');
  if (activeOnly) q = q.eq('is_active', true);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(error.message), { status: 500 });
  return ((data ?? []) as RawRequirement[]).map(toDto);
}

export interface CreateRequirementArgs {
  documentType: string;
  label: string;
  appliesToScope: 'all' | 'role' | 'employment_type' | 'department';
  appliesToValue?: string | null;
  requiresExpiry?: boolean;
  reminderDays?: number[];
  minConfidentiality?: string | null;
  metadata?: Record<string, unknown>;
}

export async function createRequirement(
  actor: { id: string },
  args: CreateRequirementArgs,
): Promise<DocumentRequirement> {
  const { data, error } = await sb
    .from('hr_document_requirements')
    .insert({
      document_type:    args.documentType,
      label:            args.label,
      applies_to_scope: args.appliesToScope,
      applies_to_value: args.appliesToValue ?? null,
      requires_expiry:  args.requiresExpiry ?? false,
      reminder_days:    args.reminderDays ?? [30, 7, 0],
      min_confidentiality: args.minConfidentiality ?? null,
      created_by:       actor.id,
      metadata:         args.metadata ?? {},
    })
    .select('*')
    .single<RawRequirement>();

  if (error) {
    // unique constraint → 409
    if (error.code === '23505') {
      throw Object.assign(
        new Error('A requirement for this document type and scope already exists.'),
        { status: 409 },
      );
    }
    throw Object.assign(new Error(error.message), { status: 500 });
  }

  const dto = toDto(data);

  void emitAppEvent({
    eventType: 'hr.document_requirement.created',
    sourceModule: 'hr',
    sourceEntityType: 'document_requirement',
    sourceEntityId: dto.id,
    actorUserId: actor.id,
    severity: 'info',
    payload: { documentType: dto.documentType, scope: dto.appliesToScope },
  });

  await writeHrAudit({
    submoduleKey: 'documents',
    recordId: dto.id,
    actorId: actor.id,
    action: 'hr.document_requirement.created',
    newState: args,
  });

  return dto;
}

export interface UpdateRequirementArgs {
  requirementId: string;
  label?: string;
  requiresExpiry?: boolean;
  reminderDays?: number[];
  minConfidentiality?: string | null;
  metadata?: Record<string, unknown>;
}

export async function updateRequirement(
  actor: { id: string },
  args: UpdateRequirementArgs,
): Promise<DocumentRequirement> {
  const { data: existing } = await sb
    .from('hr_document_requirements')
    .select('*')
    .eq('id', args.requirementId)
    .maybeSingle<RawRequirement>();
  if (!existing) throw Object.assign(new Error('Requirement not found.'), { status: 404 });

  const patch: Record<string, unknown> = { updated_at: new Date().toISOString() };
  if (args.label             !== undefined) patch['label']               = args.label;
  if (args.requiresExpiry    !== undefined) patch['requires_expiry']     = args.requiresExpiry;
  if (args.reminderDays      !== undefined) patch['reminder_days']       = args.reminderDays;
  if (args.minConfidentiality !== undefined) patch['min_confidentiality'] = args.minConfidentiality;
  if (args.metadata          !== undefined) patch['metadata']            = args.metadata;

  const { data, error } = await sb
    .from('hr_document_requirements')
    .update(patch)
    .eq('id', args.requirementId)
    .select('*')
    .single<RawRequirement>();

  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  const dto = toDto(data);

  void emitAppEvent({
    eventType: 'hr.document_requirement.updated',
    sourceModule: 'hr',
    sourceEntityType: 'document_requirement',
    sourceEntityId: dto.id,
    actorUserId: actor.id,
    severity: 'info',
    payload: { documentType: dto.documentType },
  });

  await writeHrAudit({
    submoduleKey: 'documents',
    recordId: dto.id,
    actorId: actor.id,
    action: 'hr.document_requirement.updated',
    previousState: toDto(existing),
    newState: patch,
  });

  return dto;
}

export async function retireRequirement(
  actor: { id: string },
  args: { requirementId: string },
): Promise<void> {
  const { data: existing } = await sb
    .from('hr_document_requirements')
    .select('*')
    .eq('id', args.requirementId)
    .maybeSingle<RawRequirement>();
  if (!existing) throw Object.assign(new Error('Requirement not found.'), { status: 404 });
  if (!existing.is_active) throw Object.assign(new Error('Requirement is already retired.'), { status: 409 });

  const { error } = await sb
    .from('hr_document_requirements')
    .update({ is_active: false, updated_at: new Date().toISOString() })
    .eq('id', args.requirementId);
  if (error) throw Object.assign(new Error(error.message), { status: 500 });

  void emitAppEvent({
    eventType: 'hr.document_requirement.retired',
    sourceModule: 'hr',
    sourceEntityType: 'document_requirement',
    sourceEntityId: existing.id,
    actorUserId: actor.id,
    severity: 'info',
    payload: { documentType: existing.document_type },
  });

  await writeHrAudit({
    submoduleKey: 'documents',
    recordId: existing.id,
    actorId: actor.id,
    action: 'hr.document_requirement.retired',
    previousState: toDto(existing),
    newState: { is_active: false },
  });
}
