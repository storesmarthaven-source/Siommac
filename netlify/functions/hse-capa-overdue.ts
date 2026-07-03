// hse-capa-overdue.ts — Netlify scheduled function
//
// Daily sweep that flags overdue CAPA actions. For every CAPA whose due date
// has passed and that is not yet closed/cancelled, it emits hse.capa.overdue.
// The event routes to the CAPA owner (explicit) and HSE managers (event_rule)
// and lands as an action-required notification.
//
// Idempotency: each emit carries dedupeKey `capa-overdue:<id>:<yyyy-mm-dd>`, so
// a CAPA that stays overdue produces exactly one notification per user per day
// (notify.ts dedupes on the per-user unique index), not one every run.

import './lib/bootstrapEnv'; // must be first — see that module for why
import { schedule } from '@netlify/functions';
import { sb }       from './lib/db';
import { emitAppEvent } from './lib/appEvents';

const TZ = process.env.APP_TZ ?? 'America/Port_of_Spain';

const todayInTz = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

interface ScheduleEvent {
  headers?: Record<string, string | undefined>;
}

// Guard: reject direct HTTP calls that are not from Netlify's scheduler.
function _isScheduledCall(event: ScheduleEvent): boolean {
  return event.headers?.['x-netlify-event'] === 'schedule';
}

interface OverdueCapa {
  id:            string;
  ref:           string;
  title:         string;
  owner_user_id: string | null;
  due_at:        string | null;
  department_id: string | null;
  site_id:       string | null;
}

// 10:00 UTC ≈ 06:00 in America/Port_of_Spain — a morning digest before the shift.
export const handler = schedule('0 10 * * *', async (event: ScheduleEvent) => {
  if (!_isScheduledCall(event)) {
    console.warn('hse-capa-overdue: rejected non-scheduled call');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  const nowIso = new Date().toISOString();
  const today  = todayInTz();

  const { data, error } = await sb
    .from('hse_capa_actions')
    .select('id, ref, title, owner_user_id, due_at, department_id, site_id')
    .lt('due_at', nowIso)
    .not('status', 'in', '(closed,cancelled)')
    .limit(1000);

  if (error) {
    console.error('hse-capa-overdue: fetch error', error.message);
    return { statusCode: 500, body: error.message };
  }

  const overdue = (data ?? []) as OverdueCapa[];
  if (overdue.length === 0) {
    return { statusCode: 200, body: 'No overdue CAPAs' };
  }

  const results = await Promise.allSettled(overdue.map(capa =>
    emitAppEvent({
      eventType:        'hse.capa.overdue',
      sourceModule:     'hse',
      sourceEntityType: 'capa',
      sourceEntityId:   capa.ref,
      actorUserId:      null, // system event
      departmentId:     capa.department_id,
      siteId:           capa.site_id,
      severity:         'warning',
      payload:          { dueAt: capa.due_at },
      dedupeKey:        `capa-overdue:${capa.id}:${today}`,
      ...(capa.owner_user_id ? {
        explicitRecipients: [{ userId: capa.owner_user_id, reason: 'owner' as const }],
      } : {}),
      notification: {
        title:          'CAPA overdue',
        body:           `${capa.ref} (${capa.title}) is past its due date and requires action.`,
        actionRoute:    'hse/incidents',
        actionRequired: true,
        dueAt:          capa.due_at,
      },
    }),
  ));

  const failed = results.filter(r => r.status === 'rejected').length;
  const ok     = overdue.length - failed;
  console.log(`hse-capa-overdue: emitted ${ok}/${overdue.length} overdue events (${today})`);
  return { statusCode: 200, body: `Flagged ${ok}/${overdue.length} overdue CAPAs` };
});
