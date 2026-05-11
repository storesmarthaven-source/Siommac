// auto-checkout.js — Netlify scheduled function
// Fires every 5 minutes. At or after work end time, auto-checks-out any
// employees who are still checked in.

const { schedule } = require('@netlify/functions');
const { createClient } = require('@supabase/supabase-js');

const SUPABASE_URL             = process.env.SUPABASE_URL;
const SUPABASE_SERVICE_ROLE_KEY = process.env.SUPABASE_SERVICE_ROLE_KEY;
const TZ = process.env.APP_TZ || 'America/Port_of_Spain';

const today24  = () => new Intl.DateTimeFormat('en-CA', { timeZone: TZ, year: 'numeric', month: '2-digit', day: '2-digit' }).format(new Date());
const hhmm24   = d  => new Intl.DateTimeFormat('en-GB', { timeZone: TZ, hour: '2-digit', minute: '2-digit', hour12: false }).format(d);

exports.handler = schedule('*/5 * * * *', async () => {
  if (!SUPABASE_URL || !SUPABASE_SERVICE_ROLE_KEY) {
    console.error('auto-checkout: missing Supabase env vars');
    return { statusCode: 500, body: 'missing env vars' };
  }

  const sb = createClient(SUPABASE_URL, SUPABASE_SERVICE_ROLE_KEY, { auth: { persistSession: false } });

  // 1. Read work hours setting
  const { data: whRow } = await sb.from('settings').select('value').eq('key', 'workHours').maybeSingle();
  let wh = { start: '08:00', end: '17:00' };
  try { if (whRow && whRow.value) wh = JSON.parse(whRow.value); } catch (_) {}

  const now      = new Date();
  const nowHHMM  = hhmm24(now);
  const workDate = today24();

  // Only process at or after the work end time
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
  // Use current date in TZ to build the end-time Date
  const [y, mo, d] = workDate.split('-').map(Number);
  const endTime = new Date(Date.UTC(y, mo - 1, d, endH, endM) - (getUtcOffsetMs(TZ)));

  // 4. Auto-check-out each open row
  const updates = openRows.map(row => {
    const checkInMs  = new Date(row.check_in_time).getTime();
    const checkOutMs = endTime.getTime();
    const hours      = Math.round(Math.max(0, (checkOutMs - checkInMs) / 3600000) * 100) / 100;
    return sb.from('attendance').update({
      check_out_time:  endTime.toISOString(),
      total_hours:     hours,
      notes:           `Auto-checked out at end of work hours (${wh.end})`,
      updated_at:      now.toISOString()
    }).eq('id', row.id);
  });

  const results = await Promise.allSettled(updates);
  const failed  = results.filter(r => r.status === 'rejected' || r.value?.error);
  const succeeded = openRows.length - failed.length;

  // 5. Log the activity
  await sb.from('activity_logs').insert({
    user_id:    'SYSTEM',
    username:   'system',
    action:     'auto_checkout',
    entity:     'attendance',
    entity_id:  '',
    details:    `Auto-checked out ${succeeded} employee(s) at ${wh.end} on ${workDate}`
  }).catch(() => {});

  console.log(`auto-checkout: checked out ${succeeded}/${openRows.length} employees at ${wh.end}`);
  return { statusCode: 200, body: `Checked out ${succeeded}/${openRows.length} employees` };
});

// Helper: get UTC offset in ms for a given IANA timezone at the current moment
function getUtcOffsetMs(tz) {
  const now = new Date();
  const local   = new Date(now.toLocaleString('en-US', { timeZone: tz }));
  const utc     = new Date(now.toLocaleString('en-US', { timeZone: 'UTC' }));
  return local - utc;
}
