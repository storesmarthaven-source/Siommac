// Crew movements (CP5, spec §14.6/§14.8) — embark/disembark/transfer/mobilize/demobilize
// records over hr_crew_movements. Import is idempotent by (source_system, source_reference);
// a correction NEVER overwrites an approved historical event — it inserts a NEW record that
// links to the original via corrects_movement_id (so an already-snapshotted run stays
// explainable). Every mutation emits app_events + audit_logs via emitAppEvent.
// Contract: docs/module-contracts/CREW_PAYROLL_DELIVERY_CONTRACT.md.

import { randomUUID } from 'node:crypto';
import { sb } from '../db';
import { nextRef } from '../refGenerator';
import { emitAppEvent } from '../appEvents';

const fail = (msg: string, status = 400): Error => Object.assign(new Error(msg), { status });

export type CrewMovementType = 'embark' | 'disembark' | 'transfer' | 'mobilize' | 'demobilize';

export interface CrewMovementDto {
  id: string;
  movementNo: string;
  employeeId: string;
  movementType: CrewMovementType;
  occurredAt: string;
  operationalTimezone: string;
  assetId: string | null;
  sourceSystem: string;
  sourceReference: string;
  approvalState: 'pending' | 'approved' | 'rejected';
  approvedBy: string | null;
  approvedAt: string | null;
  correctsMovementId: string | null;
  correctionReason: string | null;
  createdBy: string;
  createdAt: string;
}

type Row = Record<string, unknown>;
function mapRow(r: Row): CrewMovementDto {
  return {
    id: r['id'] as string, movementNo: r['movement_no'] as string,
    employeeId: r['employee_id'] as string, movementType: r['movement_type'] as CrewMovementType,
    occurredAt: r['occurred_at'] as string, operationalTimezone: r['operational_timezone'] as string,
    assetId: (r['asset_id'] as string) ?? null,
    sourceSystem: r['source_system'] as string, sourceReference: r['source_reference'] as string,
    approvalState: r['approval_state'] as CrewMovementDto['approvalState'],
    approvedBy: (r['approved_by'] as string) ?? null, approvedAt: (r['approved_at'] as string) ?? null,
    correctsMovementId: (r['corrects_movement_id'] as string) ?? null,
    correctionReason: (r['correction_reason'] as string) ?? null,
    createdBy: r['created_by'] as string, createdAt: r['created_at'] as string,
  };
}

export interface CrewMovementFilter {
  employeeId?: string; assetId?: string; movementType?: CrewMovementType; correctionsOnly?: boolean;
}
export async function listCrewMovements(f: CrewMovementFilter): Promise<CrewMovementDto[]> {
  let q = sb.from('hr_crew_movements').select('*').order('occurred_at', { ascending: false }).limit(1000);
  if (f.employeeId) q = q.eq('employee_id', f.employeeId);
  if (f.assetId) q = q.eq('asset_id', f.assetId);
  if (f.movementType) q = q.eq('movement_type', f.movementType);
  if (f.correctionsOnly) q = q.not('corrects_movement_id', 'is', null);
  const { data, error } = await q;
  if (error) throw fail('listCrewMovements: ' + error.message, 500);
  return (data ?? []).map(mapRow);
}

export interface RecordCrewMovementInput {
  employeeId: string; movementType: CrewMovementType; occurredAt: string;
  operationalTimezone?: string; assetId?: string | null;
  sourceSystem?: string; sourceReference: string;
}
/** Idempotent import: a replay with the same (source_system, source_reference) returns the
 *  existing record and emits NO new event (CPE-05). */
export async function recordCrewMovement(actorId: string, input: RecordCrewMovementInput): Promise<{ movement: CrewMovementDto; deduped: boolean }> {
  const sourceSystem = input.sourceSystem ?? 'manual';
  const existing = await sb.from('hr_crew_movements').select('*')
    .eq('source_system', sourceSystem).eq('source_reference', input.sourceReference).maybeSingle();
  if (existing.error) throw fail('recordCrewMovement/dedupe: ' + existing.error.message, 500);
  if (existing.data) return { movement: mapRow(existing.data as Row), deduped: true };

  const movementNo = await nextRef('CRWM');
  const { data, error } = await sb.from('hr_crew_movements').insert({
    movement_no: movementNo, employee_id: input.employeeId, movement_type: input.movementType,
    occurred_at: input.occurredAt, operational_timezone: input.operationalTimezone ?? 'America/Port_of_Spain',
    asset_id: input.assetId ?? null, source_system: sourceSystem, source_reference: input.sourceReference,
    created_by: actorId,
  }).select('*').single();
  if (error) {
    // A racing importer inserted the same business key between our check and insert.
    if (/source_key_uq|duplicate key|unique/i.test(error.message)) {
      const again = await sb.from('hr_crew_movements').select('*')
        .eq('source_system', sourceSystem).eq('source_reference', input.sourceReference).single();
      return { movement: mapRow(again.data as Row), deduped: true };
    }
    throw fail('recordCrewMovement: ' + error.message, 500);
  }
  const dto = mapRow(data);
  await emitAppEvent({
    eventType: 'hr.crew.movement.recorded', sourceModule: 'hr', sourceEntityType: 'crew_movement',
    sourceEntityId: dto.id, actorUserId: actorId, severity: 'info',
    dedupeKey: `hr.crew.movement.recorded:${dto.id}`,
    payload: { movementNo, employeeId: dto.employeeId, movementType: dto.movementType, occurredAt: dto.occurredAt, assetId: dto.assetId, sourceSystem, sourceReference: input.sourceReference },
  });
  return { movement: dto, deduped: false };
}

export interface CorrectCrewMovementInput {
  correctsMovementId: string; reason: string;
  // corrected values (default to the original where omitted)
  movementType?: CrewMovementType; occurredAt?: string; assetId?: string | null; operationalTimezone?: string;
}
/** Records a correction as a NEW movement linked to the original. The original approved
 *  event is never mutated (CPE-06). */
export async function correctCrewMovement(actorId: string, input: CorrectCrewMovementInput): Promise<CrewMovementDto> {
  const orig = await sb.from('hr_crew_movements').select('*').eq('id', input.correctsMovementId).maybeSingle();
  if (orig.error) throw fail('correctCrewMovement/read: ' + orig.error.message, 500);
  if (!orig.data) throw fail('Original crew movement not found.', 404);
  const o = orig.data as Row;
  if ((o['corrects_movement_id'] as string | null)) throw fail('Cannot correct a correction — correct the original movement.', 422);

  const movementNo = await nextRef('CRWM');
  const { data, error } = await sb.from('hr_crew_movements').insert({
    movement_no: movementNo, employee_id: o['employee_id'],
    movement_type: input.movementType ?? o['movement_type'],
    occurred_at: input.occurredAt ?? o['occurred_at'],
    operational_timezone: input.operationalTimezone ?? o['operational_timezone'],
    asset_id: input.assetId !== undefined ? input.assetId : o['asset_id'],
    source_system: 'manual_correction', source_reference: `corr:${input.correctsMovementId}:${randomUUID()}`,
    corrects_movement_id: input.correctsMovementId, correction_reason: input.reason,
    created_by: actorId,
  }).select('*').single();
  if (error) throw fail('correctCrewMovement: ' + error.message, 500);
  const dto = mapRow(data);
  await emitAppEvent({
    eventType: 'hr.crew.movement.corrected', sourceModule: 'hr', sourceEntityType: 'crew_movement',
    sourceEntityId: dto.id, actorUserId: actorId, severity: 'warning',
    payload: { movementNo, corrects: input.correctsMovementId, reason: input.reason, employeeId: dto.employeeId },
  });
  return dto;
}
