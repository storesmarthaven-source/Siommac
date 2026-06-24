// hse-ptw-sweeps.ts — Netlify scheduled function
//
// Every-15-minute sweep covering three PTW safety conditions:
//
//   Sweep 1 — Permit expiring soon:
//     hse_permits where status='active' and end_datetime within the next 2 h.
//     Buckets: ≤15 min → '15min', ≤1 h → '1hr', ≤2 h → '2hr'.
//     Emits ptw.permit.expiring_soon (warning).
//     dedupeKey: ptw-expiring:<ref>:<bucket>  — one notification per bucket per user.
//
//   Sweep 2 — Permit expired:
//     hse_permits where status='active' and end_datetime < now.
//     Updates status → 'expired' in-place, then emits ptw.permit.expired (critical).
//     dedupeKey: ptw-expired:<ref>
//
// Idempotency: per-user notification deduplication is enforced by notify.ts on the
// (user_id, dedupe_key) unique index.  The per-bucket key for sweep 1 means each
// permit fires at most once per bucket transition even across many 15-min runs.

import { schedule } from '@netlify/functions';
import { sb }       from './lib/db';
import { emitAppEvent } from './lib/appEvents';


// ── Schedule guard type ───────────────────────────────────────────────────────
interface ScheduleEvent {
  headers?: Record<string, string | undefined>;
}

function _isScheduledCall(event: ScheduleEvent): boolean {
  return event.headers?.['x-netlify-event'] === 'schedule';
}

// ── Row shapes ────────────────────────────────────────────────────────────────
interface ActivePermit {
  id:                  string;
  ref:                 string;
  permit_type:         string | null;
  status:              string;
  end_datetime:        string | null;
  requester_id:        string | null;
  work_supervisor_id:  string | null;
  area_authority_id:   string | null;
  site_id:             string | null;
  department_id:       string | null;
}

// ── Deduplicate and filter falsy user IDs ─────────────────────────────────────
function uniqueUserIds(...ids: (string | null | undefined)[]): string[] {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const id of ids) {
    if (id && !seen.has(id)) {
      seen.add(id);
      out.push(id);
    }
  }
  return out;
}

// ── Main handler ──────────────────────────────────────────────────────────────
// Runs every 15 minutes. The 15-min cadence ensures expiry-soon buckets
// (≤15 min, ≤1 h, ≤2 h) fire at least once per bucket boundary.
export const handler = schedule('*/15 * * * *', async (event: ScheduleEvent) => {
  if (!_isScheduledCall(event)) {
    console.warn('hse-ptw-sweeps: rejected non-scheduled call');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const now        = new Date();
  const nowIso     = now.toISOString();
  const in15m      = new Date(now.getTime() + 15 * 60 * 1000).toISOString();
  const in1h       = new Date(now.getTime() + 60 * 60 * 1000).toISOString();
  const in2h       = new Date(now.getTime() + 2  * 60 * 60 * 1000).toISOString();

  // ────────────────────────────────────────────────────────────────────────────
  // SWEEP 1: Permits expiring soon (active, end_datetime within 2 hours)
  // ────────────────────────────────────────────────────────────────────────────
  const { data: expiringSoon, error: err1 } = await sb
    .from('hse_permits')
    .select('id, ref, permit_type, status, end_datetime, requester_id, work_supervisor_id, area_authority_id, site_id, department_id')
    .eq('status', 'active')
    .gt('end_datetime', nowIso)   // not yet expired
    .lte('end_datetime', in2h)    // within next 2 hours
    .limit(1000);

  if (err1) {
    console.error('hse-ptw-sweeps sweep1 fetch error:', err1.message);
  }

  let sweep1Ok = 0;
  let sweep1Total = 0;

  if (expiringSoon && expiringSoon.length > 0) {
    const permits = expiringSoon as ActivePermit[];
    sweep1Total = permits.length;

    const sweep1Results = await Promise.allSettled(permits.map(permit => {
      const endMs  = new Date(permit.end_datetime!).getTime();
      const diffMs = endMs - now.getTime();

      // Tightest bucket the permit currently falls in
      const bucket =
        diffMs <= 15 * 60 * 1000  ? '15min' :
        diffMs <= 60 * 60 * 1000  ? '1hr'   :
                                    '2hr';

      const endLabel = new Date(permit.end_datetime!).toISOString().replace('T', ' ').slice(0, 16) + ' UTC';

      const recipients = uniqueUserIds(
        permit.requester_id,
        permit.work_supervisor_id,
        permit.area_authority_id,
      ).map(userId => ({ userId, reason: 'explicit' as const }));

      return emitAppEvent({
        eventType:        'ptw.permit.expiring_soon',
        sourceModule:     'hse',
        sourceEntityType: 'permit',
        sourceEntityId:   permit.ref,
        actorUserId:      null,
        siteId:           permit.site_id,
        departmentId:     permit.department_id,
        severity:         'warning',
        payload:          { bucket, endDatetime: permit.end_datetime },
        dedupeKey:        `ptw-expiring:${permit.ref}:${bucket}`,
        explicitRecipients: recipients.length > 0 ? recipients : undefined,
        notification: {
          title:          'Permit expiring soon',
          body:           `${permit.ref} expires at ${endLabel} — ensure work is completed safely.`,
          actionRoute:    'hse/permits',
          actionRequired: true,
          dueAt:          permit.end_datetime,
        },
      });
    }));

    sweep1Ok = sweep1Results.filter(r => r.status === 'fulfilled').length;
    console.log(`hse-ptw-sweeps sweep1 (expiring soon): ${sweep1Ok}/${sweep1Total}`);
  }

  // ────────────────────────────────────────────────────────────────────────────
  // SWEEP 2: Permits that have expired (active, end_datetime < now)
  // ────────────────────────────────────────────────────────────────────────────
  const { data: expired, error: err2 } = await sb
    .from('hse_permits')
    .select('id, ref, permit_type, status, end_datetime, requester_id, work_supervisor_id, area_authority_id, site_id, department_id')
    .eq('status', 'active')
    .lt('end_datetime', nowIso)
    .limit(1000);

  if (err2) {
    console.error('hse-ptw-sweeps sweep2 fetch error:', err2.message);
  }

  let sweep2Ok = 0;
  let sweep2Total = 0;

  if (expired && expired.length > 0) {
    const permits = expired as ActivePermit[];
    sweep2Total = permits.length;

    const sweep2Results = await Promise.allSettled(permits.map(async permit => {
      // Transition status active → expired; set expired_at if the column exists.
      // Using .update() with upsert=false — only touches this one row.
      const updatePayload: Record<string, unknown> = { status: 'expired', updated_at: nowIso };
      // expired_at column is defined in the PTW migration (closed_at / cancelled_at pattern).
      // We add it here defensively; Supabase silently ignores unknown columns.
      updatePayload['expired_at'] = nowIso;

      const { error: updateErr } = await sb
        .from('hse_permits')
        .update(updatePayload)
        .eq('id', permit.id)
        .eq('status', 'active'); // guard: only transition if still active

      if (updateErr) {
        console.warn(`hse-ptw-sweeps sweep2: failed to expire permit ${permit.ref}:`, updateErr.message);
      }

      const recipients = uniqueUserIds(
        permit.requester_id,
        permit.work_supervisor_id,
        permit.area_authority_id,
      ).map(userId => ({ userId, reason: 'explicit' as const }));

      return emitAppEvent({
        eventType:        'ptw.permit.expired',
        sourceModule:     'hse',
        sourceEntityType: 'permit',
        sourceEntityId:   permit.ref,
        actorUserId:      null,
        siteId:           permit.site_id,
        departmentId:     permit.department_id,
        severity:         'critical',
        payload:          { expiredAt: nowIso, previousStatus: 'active' },
        dedupeKey:        `ptw-expired:${permit.ref}`,
        explicitRecipients: recipients.length > 0 ? recipients : undefined,
        notification: {
          title:          'Permit expired',
          body:           `${permit.ref} has expired — work must stop immediately.`,
          actionRoute:    'hse/permits',
          actionRequired: true,
        },
      });
    }));

    sweep2Ok = sweep2Results.filter(r => r.status === 'fulfilled').length;
    console.log(`hse-ptw-sweeps sweep2 (expired): ${sweep2Ok}/${sweep2Total}`);
  }


  const summary =
    `sweep1(expiring)=${sweep1Ok}/${sweep1Total} ` +
    `sweep2(expired)=${sweep2Ok}/${sweep2Total}`;

  console.log(`hse-ptw-sweeps complete: ${summary}`);
  return { statusCode: 200, body: summary };
});
