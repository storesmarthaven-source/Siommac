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
//   Sweep 3 — Gas test due / overdue:
//     hse_permit_gas_tests with result='pending' whose parent permit is still active.
//     Emits ptw.permit.gas_test_expiring (warning) to requester + work_supervisor.
//     dedupeKey: gas-test-expiring:<gas_test_id>:<yyyy-mm-dd-HH>  — hourly re-ping.
//
// Idempotency: per-user notification deduplication is enforced by notify.ts on the
// (user_id, dedupe_key) unique index.  The per-bucket key for sweep 1 means each
// permit fires at most once per bucket transition even across many 15-min runs.

import { schedule } from '@netlify/functions';
import { sb }       from './lib/db';
import { emitAppEvent } from './lib/appEvents';

// ── Timezone helper (used only for gas-test hour bucket) ─────────────────────
const TZ = process.env.APP_TZ ?? 'America/Port_of_Spain';

/** Returns 'yyyy-mm-dd-HH' in the configured timezone. */
function hourBucketInTz(): string {
  const now = new Date();
  const date = new Intl.DateTimeFormat('en-CA', {
    timeZone: TZ,
    year:   'numeric',
    month:  '2-digit',
    day:    '2-digit',
  }).format(now);
  const hour = new Intl.DateTimeFormat('en-US', {
    timeZone: TZ,
    hour:     '2-digit',
    hour12:   false,
  }).format(now).replace(/\D/g, '').padStart(2, '0');
  return `${date}-${hour}`;
}

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

interface PermitInfo {
  ref:                string;
  status:             string;
  requester_id:       string | null;
  work_supervisor_id: string | null;
  department_id:      string | null;
  site_id:            string | null;
}

interface PendingGasTest {
  id:                  string;
  permit_id:           string;
  test_sequence:       number | null;
  result:              string;
  // Supabase returns joined rows as an array even with !inner
  hse_permits:         PermitInfo[] | PermitInfo | null;
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
  const hourBucket = hourBucketInTz();

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

  // ────────────────────────────────────────────────────────────────────────────
  // SWEEP 3: Gas tests pending (result='pending') on active permits
  //
  // 'pending' result means the gas test record has been created but the test
  // reading has not yet been recorded — i.e. the test is due/overdue.
  // We join to hse_permits to confirm the parent permit is still active.
  // dedupeKey uses an hourly bucket so the alert re-fires each hour (not every
  // 15 min) until the test result is filled in.
  // ────────────────────────────────────────────────────────────────────────────
  const { data: pendingTests, error: err3 } = await sb
    .from('hse_permit_gas_tests')
    .select(`
      id,
      permit_id,
      test_sequence,
      result,
      hse_permits!inner (
        ref,
        status,
        requester_id,
        work_supervisor_id,
        department_id,
        site_id
      )
    `)
    .eq('result', 'pending')
    .limit(1000);

  if (err3) {
    console.error('hse-ptw-sweeps sweep3 fetch error:', err3.message);
  }

  let sweep3Ok = 0;
  let sweep3Total = 0;

  if (pendingTests && pendingTests.length > 0) {
    // Filter down to those whose parent permit is active.
    // Supabase may return the !inner join as an array; normalise to single object.
    const rows = (pendingTests as PendingGasTest[]).map(r => {
      const permit = Array.isArray(r.hse_permits) ? r.hse_permits[0] : r.hse_permits;
      return { ...r, _permit: permit as PermitInfo | null };
    }).filter(r => r._permit?.status === 'active');
    sweep3Total = rows.length;

    const sweep3Results = await Promise.allSettled(rows.map(row => {
      const p = row._permit!;
      const seqLabel = row.test_sequence != null ? `#${row.test_sequence}` : '';

      const recipients = uniqueUserIds(
        p.requester_id,
        p.work_supervisor_id,
      ).map(userId => ({ userId, reason: 'explicit' as const }));

      return emitAppEvent({
        eventType:        'ptw.permit.gas_test_expiring',
        sourceModule:     'hse',
        sourceEntityType: 'gas_test',
        sourceEntityId:   row.id,
        actorUserId:      null,
        siteId:           p.site_id,
        departmentId:     p.department_id,
        severity:         'warning',
        payload:          { permitRef: p.ref, testSequence: row.test_sequence },
        dedupeKey:        `gas-test-expiring:${row.id}:${hourBucket}`,
        explicitRecipients: recipients.length > 0 ? recipients : undefined,
        notification: {
          title:          'Gas test due',
          body:           `Gas test ${seqLabel} for permit ${p.ref} is pending — re-test before work continues.`,
          actionRoute:    'hse/permits',
          actionRequired: true,
        },
      });
    }));

    sweep3Ok = sweep3Results.filter(r => r.status === 'fulfilled').length;
    console.log(`hse-ptw-sweeps sweep3 (gas tests pending): ${sweep3Ok}/${sweep3Total}`);
  }

  const summary =
    `sweep1(expiring)=${sweep1Ok}/${sweep1Total} ` +
    `sweep2(expired)=${sweep2Ok}/${sweep2Total} ` +
    `sweep3(gas-test)=${sweep3Ok}/${sweep3Total}`;

  console.log(`hse-ptw-sweeps complete: ${summary}`);
  return { statusCode: 200, body: summary };
});
