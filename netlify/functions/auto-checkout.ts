// auto-checkout.ts — Netlify scheduled function
// Fires every 5 minutes. At or after work end time, auto-checks-out any
// employees who are still checked in.

import { schedule } from '@netlify/functions';
import { sb }       from './lib/db';
import { resolveOverride } from './lib/settings/resolveSetting';

const TZ = process.env.APP_TZ ?? 'America/Port_of_Spain';

const today24 = (): string =>
  new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());

const hhmm24 = (d: Date): string =>
  new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

interface WorkHours {
  start: string;
  end:   string;
}

interface ScheduleEvent {
  headers?: Record<string, string | undefined>;
}

// Guard: reject direct HTTP calls that are not from Netlify's scheduler.
function _isScheduledCall(event: ScheduleEvent): boolean {
  return event.headers?.['x-netlify-event'] === 'schedule';
}

function _utcOffsetMs(tz: string): number {
  const now   = new Date();
  const local = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc   = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return local.getTime() - utc.getTime();
}

export const handler = schedule('*/5 * * * *', async (event: ScheduleEvent) => {
  if (!_isScheduledCall(event)) {
    console.warn('auto-checkout: rejected non-scheduled call');
    return { statusCode: 401, body: 'Unauthorized' };
  }

  // 1. Read work hours setting
  const { data: whRow } = await sb
    .from('settings')
    .select('value')
    .eq('key', 'workHours')
    .maybeSingle<{ value: string }>();

  let wh: WorkHours = { start: '08:00', end: '17:00' };
  try {
    if (whRow?.value) wh = JSON.parse(whRow.value) as WorkHours;
  } catch { /* keep default */ }

  // Folded to the catalog: an explicit attendance.work_hours_* override wins.
  const ovStart = await resolveOverride<string>(sb, 'attendance.work_hours_start', { moduleKey: 'attendance' });
  const ovEnd   = await resolveOverride<string>(sb, 'attendance.work_hours_end',   { moduleKey: 'attendance' });
  if (ovStart != null) wh.start = String(ovStart);
  if (ovEnd   != null) wh.end   = String(ovEnd);

  const now      = new Date();
  const nowHHMM  = hhmm24(now);
  const workDate = today24();

  if (nowHHMM < wh.end) {
    return { statusCode: 200, body: `Not end time yet (${nowHHMM} < ${wh.end})` };
  }

  // 2. Find all open attendance rows for today
  const { data: openRows, error: fetchErr } = await sb
    .from('attendance')
    .select('id, user_id, username, check_in_time')
    .eq('work_date', workDate)
    .not('check_in_time', 'is', null)
    .is('check_out_time', null);

  if (fetchErr) {
    console.error('auto-checkout: fetch error', fetchErr.message);
    return { statusCode: 500, body: fetchErr.message };
  }

  if (!openRows || openRows.length === 0) {
    return { statusCode: 200, body: 'Nobody checked in — nothing to do' };
  }

  // 3. Build the nominal end-time as a Date for accurate hours calculation
  const [endH, endM] = wh.end.split(':').map(Number);
  const [y, mo, d]   = workDate.split('-').map(Number);
  const endTime = new Date(Date.UTC(y, mo - 1, d, endH, endM) - _utcOffsetMs(TZ));

  // 4. Auto-check-out each open row in parallel
  const updates = (openRows as Array<{ id: string; check_in_time: string }>).map(row => {
    const hours = Math.round(Math.max(0, (endTime.getTime() - new Date(row.check_in_time).getTime()) / 3_600_000) * 100) / 100;
    return sb.from('attendance').update({
      check_out_time: endTime.toISOString(),
      total_hours:    hours,
      notes:          `Auto-checked out at end of work hours (${wh.end})`,
      updated_at:     now.toISOString(),
    }).eq('id', row.id);
  });

  const results   = await Promise.allSettled(updates);
  const failed    = results.filter(r => r.status === 'rejected');
  const succeeded = openRows.length - failed.length;

  // 5. Log the activity
  await sb.from('activity_logs').insert({
    user_id: 'SYSTEM', username: 'system',
    action: 'auto_checkout', entity: 'attendance', entity_id: '',
    details: `Auto-checked out ${succeeded} employee(s) at ${wh.end} on ${workDate}`,
  }).then(() => {/* best-effort */}, () => {/* ignore errors */});

  console.log(`auto-checkout: checked out ${succeeded}/${openRows.length} employees at ${wh.end}`);
  return { statusCode: 200, body: `Checked out ${succeeded}/${openRows.length} employees` };
});
