import { sb } from './db';
import {
  CalendarProviderError,
  decryptCalendarCredentials,
  encryptCalendarCredentials,
  pullProviderCalendar,
  type CalendarProvider,
  type ProviderCredentials,
} from './calendarConnections';

interface SyncConnectionRow {
  id: string;
  owner_user_id: string;
  provider: CalendarProvider;
  credentials_encrypted: string | null;
  status: 'active' | 'error' | 'disconnected';
}

interface SyncCalendarRow {
  id: string;
  connection_id: string;
  provider_calendar_id: string;
  sync_cursor: Record<string, unknown> | null;
}

function dateOffset(days: number): string {
  const date = new Date();
  date.setUTCDate(date.getUTCDate() + days);
  return date.toISOString().slice(0, 10);
}

function safeProviderError(cause: unknown): CalendarProviderError {
  return cause instanceof CalendarProviderError
    ? cause
    : new CalendarProviderError('The external calendar operation failed.', 'provider_operation_failed', 500);
}

/**
 * Pull one account into its enabled SIOMAC calendars. A short-lived database
 * claim prevents a manual sync and the scheduled worker from rotating the same
 * refresh token concurrently. Every imported calendar is committed atomically
 * with its cursor, app event and audit record by the database RPC.
 */
export async function syncCalendarConnection(actorId: string, connectionId: string, onlyCalendarId?: string): Promise<{ imported: number; removed: number }> {
  const { data: connectionData, error: connectionError } = await sb.from('calendar_connections')
    .select('id,owner_user_id,provider,credentials_encrypted,status').eq('id', connectionId).eq('owner_user_id', actorId).in('status', ['active', 'error']).maybeSingle<SyncConnectionRow>();
  if (connectionError) throw new Error(`connection load failed: ${connectionError.message}`);
  if (!connectionData?.credentials_encrypted) throw new CalendarProviderError('Calendar connection not found.', 'connection_not_found', 404);
  const { data: calendarsData, error: calendarsError } = await sb.from('calendar_external_calendars')
    .select('id,connection_id,provider_calendar_id,sync_cursor').eq('connection_id', connectionId).eq('enabled', true)
    .order('is_primary', { ascending: false });
  if (calendarsError) throw new Error(`external calendars load failed: ${calendarsError.message}`);
  const calendars = (calendarsData as SyncCalendarRow[]).filter(calendar => !onlyCalendarId || calendar.id === onlyCalendarId);
  if (!calendars.length) return { imported: 0, removed: 0 };

  const claimToken = crypto.randomUUID();
  const { error: claimError } = await sb.rpc('calendar_connection_sync_claim_tx', {
    p_actor_id: actorId,
    p_connection_id: connectionId,
    p_claim_token: claimToken,
  });
  if (claimError) {
    if (claimError.code === '55P03') throw new CalendarProviderError('This calendar account is already syncing.', 'sync_in_progress', 409);
    if (claimError.code === 'P0002') throw new CalendarProviderError('Calendar connection not found.', 'connection_not_found', 404);
    throw new Error(`calendar sync claim failed: ${claimError.message}`);
  }

  let credentials: ProviderCredentials;
  let imported = 0;
  let removed = 0;
  const syncRunId = crypto.randomUUID();
  const from = dateOffset(-90);
  const to = dateOffset(365);

  try {
    const decryptedCredentials = decryptCalendarCredentials(connectionData.credentials_encrypted);
    if (!('kind' in decryptedCredentials)) {
      throw new CalendarProviderError('Stored calendar credentials are invalid.', 'credential_kind_invalid', 500, true);
    }
    credentials = decryptedCredentials;
    for (const calendar of calendars) {
      const result = await pullProviderCalendar(connectionData.provider, credentials, calendar.provider_calendar_id, from, to, calendar.sync_cursor ?? {});
      credentials = result.credentials;
      let deletedIds = [...new Set(result.deletedEventIds)];
      if (result.fullSnapshot) {
        const { data: existing, error: existingError } = await sb.from('calendar_external_event_links')
          .select('provider_event_id').eq('external_calendar_id', calendar.id);
        if (existingError) throw new Error(`external event link load failed: ${existingError.message}`);
        const received = new Set(result.events.map(event => event.providerEventId));
        const existingLinks = existing as { provider_event_id: string }[];
        deletedIds = [...new Set([...deletedIds, ...existingLinks.map(link => link.provider_event_id).filter(id => !received.has(id))])];
      }
      const importResponse = await sb.rpc('calendar_external_events_upsert_tx', {
        p_actor_id: actorId,
        p_external_calendar_id: calendar.id,
        p_events: result.events,
        p_deleted_event_ids: deletedIds,
        p_sync_cursor: result.cursor,
        p_sync_run_id: syncRunId,
        p_claim_token: claimToken,
      }) as { data: { upserted?: number; deleted?: number } | null; error: { message: string } | null };
      const { data, error } = importResponse;
      if (error) throw new Error(`external event import failed: ${error.message}`);
      const counts = data ?? {};
      imported += counts.upserted ?? 0;
      removed += counts.deleted ?? 0;
    }
    const { error: finishError } = await sb.rpc('calendar_connection_sync_finish_tx', {
      p_actor_id: actorId,
      p_connection_id: connectionId,
      p_claim_token: claimToken,
      p_credentials_encrypted: encryptCalendarCredentials(credentials),
    });
    if (finishError) throw new Error(`calendar sync completion failed: ${finishError.message}`);
    return { imported, removed };
  } catch (cause) {
    const safe = safeProviderError(cause);
    const { error } = await sb.rpc('calendar_connection_sync_failed_tx', {
      p_actor_id: actorId,
      p_connection_id: connectionId,
      p_error_code: safe.code,
      p_error_message: safe.message,
      p_sync_run_id: syncRunId,
      p_claim_token: claimToken,
    });
    if (error) throw new Error(`sync failure persistence failed: ${error.message}`, { cause });
    throw safe;
  }
}
