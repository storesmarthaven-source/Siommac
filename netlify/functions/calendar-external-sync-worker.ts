import './lib/bootstrapEnv';
import { schedule } from '@netlify/functions';
import { sb } from './lib/db';
import { syncCalendarConnection } from './lib/calendarConnectionSync';

interface ScheduleEvent { headers?: Record<string, string | undefined> }
interface DueConnection { id: string; owner_user_id: string }

/**
 * Refreshes a bounded batch of connected accounts every 15 minutes. The shared
 * sync service acquires a database claim, so a scheduled run cannot race a
 * user's Sync now request or another worker invocation.
 */
export const handler = schedule('*/15 * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') return { statusCode: 403, body: 'Scheduled invocation only' };
  const cutoff = new Date(Date.now() - 10 * 60_000).toISOString();
  const { data, error } = await sb.from('calendar_connections')
    .select('id,owner_user_id')
    .in('status', ['active', 'error'])
    .not('credentials_encrypted', 'is', null)
    .or(`last_synced_at.is.null,last_synced_at.lt.${cutoff}`)
    .order('last_synced_at', { ascending: true, nullsFirst: true })
    .limit(20);
  if (error) {
    console.error('[calendar-external-sync-worker] connection load failed:', error.message);
    return { statusCode: 500, body: JSON.stringify({ success: false, message: 'Connection load failed.' }) };
  }

  let synced = 0;
  let failed = 0;
  let imported = 0;
  let removed = 0;
  const connections = data as DueConnection[];
  for (const connection of connections) {
    try {
      const result = await syncCalendarConnection(connection.owner_user_id, connection.id);
      synced += 1;
      imported += result.imported;
      removed += result.removed;
    } catch (cause) {
      failed += 1;
      console.error('[calendar-external-sync-worker] account sync failed:', connection.id, cause instanceof Error ? cause.message : 'Unknown error');
    }
  }
  return { statusCode: failed ? 207 : 200, body: JSON.stringify({ success: failed === 0, inspected: connections.length, synced, failed, imported, removed }) };
});
