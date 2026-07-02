// lib/hr/leaveAccruals.ts — HR Leave accrual engine + balance adjustment

import { sb }           from '../db';
import { writeHrAudit } from './employeeCore';
import { recomputeBalance } from './leaveCore';
import type { RunAccrualsArgs, AdjustBalanceArgs } from '../../../../types/hrLeave';

const err = (status: number, msg: string): Error => Object.assign(new Error(msg), { status });

export async function runAccruals(actorId: string, args: RunAccrualsArgs): Promise<{ processed: number; skipped: number }> {
  // Determine cadence from period format: '2026' = annual, '2026-07' = monthly
  const isMonthly = args.period.length === 7;
  const cadence   = isMonthly ? 'monthly' : 'annual';
  const year      = Number(args.period.slice(0, 4));

  // Load all active leave types with matching cadence
  let ltq = sb.from('hr_leave_types').select('id, code, accrual_rate, accrual_cadence').eq('is_active', true).eq('accrual_cadence', cadence);
  if (args.leaveTypeId) ltq = ltq.eq('id', args.leaveTypeId);
  const { data: types, error: ltErr } = await ltq;
  if (ltErr) throw err(500, `Failed to load leave types: ${ltErr.message}`);

  // Load all active employees (app_users has no is_active column — status is the
  // lifecycle field; exclude the system superadmin from accrual runs).
  const { data: employees, error: empErr } = await sb.from('app_users')
    .select('id').eq('status', 'active').neq('role', 'superadmin');
  if (empErr) throw err(500, `Failed to load employees: ${empErr.message}`);

  let processed = 0; let skipped = 0;

  for (const lt of (types ?? [])) {
    const ltRow    = lt as Record<string, unknown>;
    const accrualRate = ltRow.accrual_rate != null ? Number(ltRow.accrual_rate) : null;
    if (!accrualRate) { skipped++; continue; }

    for (const emp of (employees ?? [])) {
      const empRow = emp as Record<string, unknown>;
      const empId  = empRow.id as string;
      const ltId   = ltRow.id as string;
      const key    = `hr.leave.accrual:${empId}:${ltId}:${args.period}`;

      const { error: insErr } = await sb.from('hr_leave_accruals').insert({
        employee_id:     empId,
        leave_type_id:   ltId,
        year,
        delta:           accrualRate,
        kind:            'accrual',
        idempotency_key: key,
        created_by:      actorId,
        note:            `Accrual for period ${args.period}`,
      });
      if (insErr && !insErr.code?.includes('23505')) {
        console.warn(`[leave] accrual insert failed for ${empId}/${ltId}:`, insErr.message);
        skipped++; continue;
      }
      if (!insErr) {
        await recomputeBalance(empId, ltId, year);
        processed++;
      } else {
        skipped++; // already existed
      }
    }
  }

  await writeHrAudit({
    submoduleKey: 'leave', actorId, action: 'hr.leave.accruals.run',
    newState: { period: args.period, processed, skipped, leaveTypeId: args.leaveTypeId ?? null },
  });

  return { processed, skipped };
}

export async function adjustBalance(actorId: string, args: AdjustBalanceArgs): Promise<void> {
  // Validate employee + leave type exist
  const { data: emp } = await sb.from('app_users').select('id').eq('id', args.employeeId).maybeSingle();
  if (!emp) throw err(404, 'Employee not found.');
  const { data: lt } = await sb.from('hr_leave_types').select('id').eq('id', args.leaveTypeId).maybeSingle();
  if (!lt) throw err(404, 'Leave type not found.');

  const key = `hr.leave.adjustment:${actorId}:${args.employeeId}:${args.leaveTypeId}:${args.year}:${Date.now()}`;

  const { error: insErr } = await sb.from('hr_leave_accruals').insert({
    employee_id:     args.employeeId,
    leave_type_id:   args.leaveTypeId,
    year:            args.year,
    delta:           args.delta,
    kind:            'adjustment',
    idempotency_key: key,
    created_by:      actorId,
    note:            args.reason,
  });
  if (insErr) throw err(500, `Failed to insert balance adjustment: ${insErr.message}`);

  await recomputeBalance(args.employeeId, args.leaveTypeId, args.year);

  await writeHrAudit({
    employeeId: args.employeeId, submoduleKey: 'leave', actorId, action: 'hr.leave.balance.adjusted',
    newState: { leaveTypeId: args.leaveTypeId, year: args.year, delta: args.delta, reason: args.reason },
  });
}
