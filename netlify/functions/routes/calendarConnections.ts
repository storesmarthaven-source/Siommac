import { Hono } from 'hono';
import { sb } from '../lib/db';
import { requirePermission } from '../lib/auth';
import { z, zv } from '../lib/validate';
import {
  CalendarProviderError,
  buildOAuthUrl,
  completeOAuthConnection,
  connectCredentialProvider,
  createPkce,
  decryptCalendarCredentials,
  encryptCalendarCredentials,
  hashOAuthState,
  providerAvailability,
  type CalendarProvider,
  type ConnectedProviderAccount,
  type RemoteCalendar,
} from '../lib/calendarConnections';
import { syncCalendarConnection } from '../lib/calendarConnectionSync';
import { CALENDAR_COLOR_KEYS } from '../../../types/calendar';
import type { HonoVariables } from '../../../types/api';
import type { CalendarConnectionDTO, CalendarConnectionsResponse, CalendarProviderAvailabilityDTO, ExternalCalendarDTO } from '../../../types/calendar';

const router = new Hono<{ Variables: HonoVariables }>();
const PROVIDERS = ['google', 'microsoft', 'apple', 'exchange'] as const;
const IDEMPOTENCY_KEY = z.string().trim().min(8).max(160);

interface ConnectionRow {
  id: string;
  owner_user_id: string;
  provider: CalendarProvider;
  provider_account_id: string;
  account_email: string | null;
  display_name: string;
  status: 'active' | 'error' | 'disconnected';
  sync_direction: 'import';
  last_synced_at: string | null;
  last_error_code: string | null;
  last_error_message: string | null;
}

interface ExternalCalendarRow {
  id: string;
  connection_id: string;
  provider_calendar_id: string;
  name: string;
  description: string | null;
  provider_color: string | null;
  time_zone: string | null;
  access_role: string | null;
  is_primary: boolean;
  enabled: boolean;
  calendar_collection_id: string | null;
  sync_cursor: Record<string, unknown> | null;
}

interface DatabaseError {
  code?: string;
  message: string;
}

interface RpcResponse<T> {
  data: T | null;
  error: DatabaseError | null;
}

function safeProviderError(cause: unknown): CalendarProviderError {
  return cause instanceof CalendarProviderError
    ? cause
    : new CalendarProviderError('The external calendar operation failed.', 'provider_operation_failed', 500);
}

function allowedApplicationOrigin(origin: string): boolean {
  if (/^http:\/\/(localhost|127\.0\.0\.1)(:\d+)?$/i.test(origin)) return true;
  if (!origin.startsWith('https://')) return false;
  const configured = (process.env.ALLOWED_ORIGINS ?? '').split(',').map(value => {
    try { return new URL(value.trim()).origin; } catch { return ''; }
  }).filter(Boolean);
  return configured.includes(origin);
}

function remoteCalendarPayload(calendars: RemoteCalendar[]): Record<string, unknown>[] {
  return calendars.map(calendar => ({
    id: calendar.id,
    name: calendar.name,
    description: calendar.description,
    color: calendar.color,
    timeZone: calendar.timeZone,
    accessRole: calendar.accessRole,
    isPrimary: calendar.isPrimary,
    etag: calendar.etag,
  }));
}

function providerColorKey(provider: CalendarProvider): 'blue' | 'slate' {
  return provider === 'apple' || provider === 'exchange' ? 'slate' : 'blue';
}

async function enablePrimaryCalendar(actorId: string, connectionId: string, provider: CalendarProvider): Promise<string | null> {
  const { data: primary, error } = await sb.from('calendar_external_calendars')
    .select('id').eq('connection_id', connectionId).order('is_primary', { ascending: false }).order('name').limit(1).maybeSingle<{ id: string }>();
  if (error) throw new Error(`primary calendar lookup failed: ${error.message}`);
  if (!primary) return null;
  const toggleResponse = await sb.rpc('calendar_external_calendar_toggle_tx', {
    p_actor_id: actorId,
    p_external_calendar_id: primary.id,
    p_enabled: true,
    p_color_key: providerColorKey(provider),
    p_idempotency_key: `connect-${connectionId}-${primary.id}`,
  }) as RpcResponse<{ externalCalendarId?: string }>;
  const { data, error: toggleError } = toggleResponse;
  if (toggleError) throw new Error(`primary calendar enable failed: ${toggleError.message}`);
  return data?.externalCalendarId ?? primary.id;
}

async function activateAccount(actorId: string, provider: CalendarProvider, account: ConnectedProviderAccount, idempotencyKey: string): Promise<{ connectionId: string; primaryCalendarId: string | null }> {
  const activationResponse = await sb.rpc('calendar_connection_activate_tx', {
    p_actor_id: actorId,
    p_provider: provider,
    p_provider_account_id: account.identity.id,
    p_account_email: account.identity.email,
    p_display_name: account.identity.displayName,
    p_credentials_encrypted: encryptCalendarCredentials(account.credentials),
    p_granted_scopes: account.scopes,
    p_provider_metadata: account.metadata,
    p_calendars: remoteCalendarPayload(account.calendars),
    p_idempotency_key: idempotencyKey,
  }) as RpcResponse<{ connectionId?: string }>;
  const { data, error } = activationResponse;
  if (error) throw new Error(`connection activation failed: ${error.message}`);
  const connectionId = data?.connectionId;
  if (!connectionId) throw new Error('connection activation returned no id');
  return { connectionId, primaryCalendarId: await enablePrimaryCalendar(actorId, connectionId, provider) };
}

router.post('/calendar/connections/list', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const { data, error } = await sb.from('calendar_connections')
    .select('id,owner_user_id,provider,provider_account_id,account_email,display_name,status,sync_direction,last_synced_at,last_error_code,last_error_message')
    .eq('owner_user_id', user.id).in('status', ['active', 'error']).order('created_at');
  if (error) return c.json({ success: false, message: 'Calendar connections could not be loaded.' }, 500);
  const connections = data as ConnectionRow[];
  const ids = connections.map(connection => connection.id);
  const { data: calendarRows, error: calendarError } = ids.length
    ? await sb.from('calendar_external_calendars').select('*').in('connection_id', ids).order('is_primary', { ascending: false }).order('name')
    : { data: [], error: null };
  if (calendarError) return c.json({ success: false, message: 'Connected calendars could not be loaded.' }, 500);
  const calendarsByConnection = new Map<string, ExternalCalendarDTO[]>();
  for (const row of calendarRows as ExternalCalendarRow[]) {
    const values = calendarsByConnection.get(row.connection_id) ?? [];
    values.push({ id: row.id, providerCalendarId: row.provider_calendar_id, name: row.name, description: row.description, providerColor: row.provider_color, timeZone: row.time_zone, accessRole: row.access_role, isPrimary: row.is_primary, enabled: row.enabled, collectionId: row.calendar_collection_id });
    calendarsByConnection.set(row.connection_id, values);
  }
  const providerRows: CalendarProviderAvailabilityDTO[] = PROVIDERS.map(provider => ({ provider, ...providerAvailability(provider) }));
  const connectionDtos: CalendarConnectionDTO[] = connections.map(connection => ({ id: connection.id, provider: connection.provider, displayName: connection.display_name, accountEmail: connection.account_email, status: connection.status as 'active' | 'error', syncDirection: 'import', lastSyncedAt: connection.last_synced_at, lastErrorCode: connection.last_error_code, lastErrorMessage: connection.last_error_message, calendars: calendarsByConnection.get(connection.id) ?? [], canSync: true, canDisconnect: true }));
  const response: CalendarConnectionsResponse = { success: true, providers: providerRows, connections: connectionDtos };
  return c.json(response);
});

router.post('/calendar/connections/oauth/start', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ provider: z.enum(['google', 'microsoft']) }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const origin = c.req.header('origin') ?? '';
  if (!allowedApplicationOrigin(origin)) return c.json({ success: false, message: 'The application origin is not allowed for calendar authorisation.' }, 400);
  try {
    const availability = providerAvailability(v.data.provider);
    if (!availability.configured) throw new CalendarProviderError(availability.configurationMessage ?? 'Calendar provider is not configured.', 'provider_not_configured', 503);
    const pkce = createPkce();
    const redirectUri = `${origin}/calendar/oauth/callback`;
    const { error } = await sb.rpc('calendar_oauth_state_create', {
      p_state_hash: pkce.stateHash,
      p_actor_id: user.id,
      p_provider: v.data.provider,
      p_code_verifier_encrypted: encryptCalendarCredentials({ codeVerifier: pkce.verifier }),
      p_redirect_uri: redirectUri,
      p_expires_at: new Date(Date.now() + 10 * 60_000).toISOString(),
    });
    if (error) throw new Error(`oauth state persistence failed: ${error.message}`);
    return c.json({ success: true, authorizationUrl: buildOAuthUrl(v.data.provider, pkce.state, pkce.challenge, redirectUri) });
  } catch (cause) {
    const safe = safeProviderError(cause);
    return c.json({ success: false, message: safe.message, code: safe.code }, safe.status as 400);
  }
});

router.post('/calendar/connections/oauth/complete', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ code: z.string().min(1).max(4096), state: z.string().min(32).max(512) }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  try {
    const consumeResponse = await sb.rpc('calendar_oauth_state_consume', { p_state_hash: hashOAuthState(v.data.state), p_actor_id: user.id }) as RpcResponse<{ provider?: CalendarProvider; codeVerifierEncrypted?: string; redirectUri?: string }>;
    const { data, error } = consumeResponse;
    if (error) throw new CalendarProviderError('The calendar authorisation expired or was already used.', 'oauth_state_invalid', 400);
    const consumed = data ?? {};
    if (!consumed.provider || !consumed.codeVerifierEncrypted || !consumed.redirectUri) throw new CalendarProviderError('The calendar authorisation state is incomplete.', 'oauth_state_incomplete', 400);
    const decryptedState = decryptCalendarCredentials(consumed.codeVerifierEncrypted);
    if (!('codeVerifier' in decryptedState) || !decryptedState.codeVerifier) throw new CalendarProviderError('The calendar authorisation state is invalid.', 'oauth_state_incomplete', 400);
    const verifier = decryptedState.codeVerifier;
    const account = await completeOAuthConnection(consumed.provider as 'google' | 'microsoft', v.data.code, verifier, consumed.redirectUri);
    const activated = await activateAccount(user.id, consumed.provider, account, `oauth-${hashOAuthState(v.data.state)}`);
    try {
      const sync = activated.primaryCalendarId ? await syncCalendarConnection(user.id, activated.connectionId, activated.primaryCalendarId) : { imported: 0, removed: 0 };
      return c.json({ success: true, connectionId: activated.connectionId, ...sync });
    } catch (cause) {
      const safe = safeProviderError(cause);
      return c.json({ success: true, connectionId: activated.connectionId, imported: 0, removed: 0, syncWarning: safe.message });
    }
  } catch (cause) {
    const safe = safeProviderError(cause);
    return c.json({ success: false, message: safe.message, code: safe.code }, safe.status as 400);
  }
});

router.post('/calendar/connections/credentials/connect', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ provider: z.enum(['apple', 'exchange']), username: z.string().trim().min(1).max(320), password: z.string().min(1).max(512), serverUrl: z.url().max(2000).optional(), idempotencyKey: IDEMPOTENCY_KEY }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  try {
    const account = await connectCredentialProvider(v.data.provider, v.data.username, v.data.password, v.data.serverUrl);
    const activated = await activateAccount(user.id, v.data.provider, account, v.data.idempotencyKey);
    try {
      const sync = activated.primaryCalendarId ? await syncCalendarConnection(user.id, activated.connectionId, activated.primaryCalendarId) : { imported: 0, removed: 0 };
      return c.json({ success: true, connectionId: activated.connectionId, ...sync });
    } catch (cause) {
      const safe = safeProviderError(cause);
      return c.json({ success: true, connectionId: activated.connectionId, imported: 0, removed: 0, syncWarning: safe.message });
    }
  } catch (cause) {
    const safe = safeProviderError(cause);
    return c.json({ success: false, message: safe.message, code: safe.code }, safe.status as 400);
  }
});

router.post('/calendar/connections/calendar/toggle', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ externalCalendarId: z.uuid(), enabled: z.boolean(), colorKey: z.enum(CALENDAR_COLOR_KEYS).optional(), idempotencyKey: IDEMPOTENCY_KEY }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const toggleResponse = await sb.rpc('calendar_external_calendar_toggle_tx', { p_actor_id: user.id, p_external_calendar_id: v.data.externalCalendarId, p_enabled: v.data.enabled, p_color_key: v.data.colorKey ?? 'blue', p_idempotency_key: v.data.idempotencyKey }) as RpcResponse<Record<string, unknown>>;
  const { data, error } = toggleResponse;
  if (error) return c.json({ success: false, message: error.code === 'P0002' ? 'Connected calendar not found.' : 'Connected calendar could not be updated.' }, error.code === 'P0002' ? 404 : 500);
  let sync = { imported: 0, removed: 0 };
  if (v.data.enabled) {
    const { data: external } = await sb.from('calendar_external_calendars').select('connection_id').eq('id', v.data.externalCalendarId).maybeSingle<{ connection_id: string }>();
    if (external?.connection_id) {
      try { sync = await syncCalendarConnection(user.id, external.connection_id, v.data.externalCalendarId); }
      catch (cause) {
        const safe = safeProviderError(cause);
        return c.json({ success: true, ...(data ?? {}), ...sync, syncWarning: safe.message });
      }
    }
  }
  return c.json({ success: true, ...(data ?? {}), ...sync });
});

router.post('/calendar/connections/sync', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ connectionId: z.uuid() }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  try { return c.json({ success: true, ...(await syncCalendarConnection(user.id, v.data.connectionId)) }); }
  catch (cause) { const safe = safeProviderError(cause); return c.json({ success: false, message: safe.message, code: safe.code }, safe.status as 400); }
});

router.post('/calendar/connections/disconnect', async c => {
  const user = await requirePermission(c, 'calendar.view');
  const v = zv(c, z.object({ connectionId: z.uuid(), idempotencyKey: IDEMPOTENCY_KEY }).strict(), c.get('body').args ?? {});
  if (!v.ok) return v.response;
  const disconnectResponse = await sb.rpc('calendar_connection_disconnect_tx', { p_actor_id: user.id, p_connection_id: v.data.connectionId, p_idempotency_key: v.data.idempotencyKey }) as RpcResponse<Record<string, unknown>>;
  const { data, error } = disconnectResponse;
  if (error) return c.json({ success: false, message: error.code === 'P0002' ? 'Calendar connection not found.' : 'Calendar connection could not be disconnected.' }, error.code === 'P0002' ? 404 : 500);
  return c.json({ success: true, ...(data ?? {}) });
});

export default router;
