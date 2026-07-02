/**
 * netlify/functions/lib/hr/documentsExpirySweep.ts
 *
 * Idempotent expiry reminder sweep. For each active doc with an expiry_date
 * within a configured window that hasn't already been notified (per the
 * hr_document_reminders ledger), inserts a ledger row and emits an app event.
 *
 * Called by POST /api/hr/documents/expiry/run-sweep (service-role only).
 * Windows from settings hr_documents.expiry_reminder_days (default [30,7,0]).
 */

import { sb } from '../db';
import { emitAppEvent } from '../appEvents';

export interface ExpirySweepResult {
  scanned: number;
  remindersSent: number;
}

interface ActiveDoc {
  id: string;
  employee_id: string;
  document_type: string;
  title: string;
  expiry_date: string;
  reminder_days?: number[] | null;  // per-requirement override (future); null = use global
}

interface ReminderRow {
  document_id: string;
  threshold_days: number;
  expiry_date: string;
}

/**
 * Run the expiry reminder sweep.
 *
 * @param windows - reminder window thresholds in days before expiry (e.g. [30,7,0])
 *   threshold 0 = notify on the day of expiry.
 */
export async function runExpirySweep(
  actorId: string | null,
  opts: { windows?: number[] } = {},
): Promise<ExpirySweepResult> {
  const today = new Date().toISOString().slice(0, 10);
  const windows = opts.windows ?? [30, 7, 0];

  // Max window to query — docs expiring within max(windows) days OR already expired within 1 day
  const maxDays = Math.max(...windows);
  const maxThreshold = new Date(today);
  maxThreshold.setDate(maxThreshold.getDate() + maxDays);
  const maxThresholdISO = maxThreshold.toISOString().slice(0, 10);

  // All active (non-archived) docs with an expiry_date within the max window
  const { data: docs, error: docsErr } = await sb
    .from('hr_employee_documents')
    .select('id, employee_id, document_type, title, expiry_date')
    .not('expiry_date', 'is', null)
    .lte('expiry_date', maxThresholdISO)
    .neq('status', 'archived');

  if (docsErr) throw Object.assign(new Error(docsErr.message), { status: 500 });

  const activeDocs = (docs ?? []) as ActiveDoc[];
  if (!activeDocs.length) return { scanned: 0, remindersSent: 0 };

  // Load existing ledger rows for these docs
  const docIds = activeDocs.map(d => d.id);
  const { data: existingReminders, error: remErr } = await sb
    .from('hr_document_reminders')
    .select('document_id, threshold_days, expiry_date')
    .in('document_id', docIds);

  if (remErr) throw Object.assign(new Error(remErr.message), { status: 500 });

  // Build a set of already-sent keys: `${doc_id}:${threshold_days}:${expiry_date}`
  const sentKeys = new Set<string>(
    ((existingReminders ?? []) as ReminderRow[]).map(
      r => `${r.document_id}:${r.threshold_days}:${r.expiry_date}`,
    ),
  );

  let remindersSent = 0;

  for (const doc of activeDocs) {
    for (const thresholdDays of windows) {
      const windowDate = new Date(today);
      windowDate.setDate(windowDate.getDate() + thresholdDays);
      const windowISO = windowDate.toISOString().slice(0, 10);

      // Fire if doc expires on or before the window date (i.e. within thresholdDays)
      if (doc.expiry_date > windowISO) continue;

      const key = `${doc.id}:${thresholdDays}:${doc.expiry_date}`;
      if (sentKeys.has(key)) continue; // already notified

      // Insert ledger row first — if it fails (race condition / dup), skip gracefully
      const { error: insertErr } = await sb
        .from('hr_document_reminders')
        .insert({
          document_id:    doc.id,
          threshold_days: thresholdDays,
          expiry_date:    doc.expiry_date,
        });

      if (insertErr) {
        // Unique constraint violation = already sent in a concurrent run — skip
        if (insertErr.code === '23505') continue;
        throw Object.assign(new Error(insertErr.message), { status: 500 });
      }

      sentKeys.add(key); // prevent duplicate in same sweep run

      // Emit notification event (fire-and-forget — sweep result must not depend on it)
      void emitAppEvent({
        eventType: 'hr.document.expiry_reminder',
        sourceModule: 'hr',
        sourceEntityType: 'hr_document',
        sourceEntityId: doc.id,
        actorUserId: actorId,
        severity: thresholdDays === 0 ? 'warning' : 'info',
        payload: {
          employeeId:    doc.employee_id,
          documentType:  doc.document_type,
          title:         doc.title,
          expiryDate:    doc.expiry_date,
          thresholdDays,
        },
        notification: {
          title: `Document expiry reminder: ${doc.title}`,
          body:  thresholdDays === 0
            ? `Document "${doc.title}" expires today.`
            : `Document "${doc.title}" expires in ${thresholdDays} day(s).`,
        },
      });

      remindersSent++;
    }
  }

  return { scanned: activeDocs.length, remindersSent };
}
