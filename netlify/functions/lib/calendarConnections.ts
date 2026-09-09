import crypto from 'crypto';
import dns from 'dns/promises';
import net from 'net';

export type CalendarProvider = 'google' | 'microsoft' | 'apple' | 'exchange';

export interface RemoteCalendar {
  id: string;
  name: string;
  description: string | null;
  color: string | null;
  timeZone: string | null;
  accessRole: string | null;
  isPrimary: boolean;
  etag: string | null;
}

export interface RemoteCalendarEvent {
  providerEventId: string;
  title: string;
  notes: string | null;
  location: string | null;
  allDay: boolean;
  startsOn: string | null;
  endsOn: string | null;
  startsAt: string | null;
  endsAt: string | null;
  etag: string | null;
  updatedAt: string | null;
}

export interface ProviderIdentity {
  id: string;
  email: string | null;
  displayName: string;
}

interface OAuthCredentials {
  kind: 'oauth';
  accessToken: string;
  refreshToken: string;
  expiresAt: number;
  tokenType: string;
}

interface PasswordCredentials {
  kind: 'password';
  username: string;
  password: string;
  serverUrl: string;
}

export type ProviderCredentials = OAuthCredentials | PasswordCredentials;

export interface ConnectedProviderAccount {
  identity: ProviderIdentity;
  credentials: ProviderCredentials;
  scopes: string[];
  metadata: Record<string, unknown>;
  calendars: RemoteCalendar[];
}

export interface ProviderPullResult {
  credentials: ProviderCredentials;
  events: RemoteCalendarEvent[];
  deletedEventIds: string[];
  cursor: Record<string, unknown>;
  fullSnapshot: boolean;
}

interface GoogleEventDateValue {
  date?: string;
  dateTime?: string;
}

interface GoogleCalendarEventPayload {
  id?: string;
  status?: string;
  summary?: string;
  description?: string;
  location?: string;
  start?: GoogleEventDateValue;
  end?: GoogleEventDateValue;
  etag?: string;
  updated?: string;
}

interface MicrosoftEventDateValue {
  dateTime?: string;
}

interface MicrosoftCalendarEventPayload {
  id?: string;
  subject?: string;
  bodyPreview?: string;
  start?: MicrosoftEventDateValue;
  end?: MicrosoftEventDateValue;
  isAllDay?: boolean;
  isCancelled?: boolean;
  location?: { displayName?: string };
  lastModifiedDateTime?: string;
  '@removed'?: Record<string, unknown>;
  '@odata.etag'?: string;
}

export class CalendarProviderError extends Error {
  constructor(
    message: string,
    public readonly code: string,
    public readonly status = 502,
    public readonly reconnectRequired = false,
  ) {
    super(message);
  }
}

const ENCRYPTION_KEY_HEX = process.env.CALENDAR_CONNECTION_ENCRYPTION_KEY ?? '';
const GOOGLE_CLIENT_ID = process.env.GOOGLE_CALENDAR_CLIENT_ID ?? '';
const GOOGLE_CLIENT_SECRET = process.env.GOOGLE_CALENDAR_CLIENT_SECRET ?? '';
const MICROSOFT_CLIENT_ID = process.env.MICROSOFT_CALENDAR_CLIENT_ID ?? '';
const MICROSOFT_CLIENT_SECRET = process.env.MICROSOFT_CALENDAR_CLIENT_SECRET ?? '';
const configuredMicrosoftTenant = process.env.MICROSOFT_CALENDAR_TENANT?.trim();
const MICROSOFT_TENANT = configuredMicrosoftTenant && configuredMicrosoftTenant.length > 0 ? configuredMicrosoftTenant : 'common';
const configuredAppTimeZone = process.env.APP_TZ?.trim();
const APP_TZ = configuredAppTimeZone && configuredAppTimeZone.length > 0 ? configuredAppTimeZone : 'America/Port_of_Spain';

function encryptionKey(): Buffer {
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
    throw new CalendarProviderError('External calendar encryption is not configured.', 'encryption_not_configured', 503);
  }
  return Buffer.from(ENCRYPTION_KEY_HEX, 'hex');
}

export function encryptCalendarCredentials(value: ProviderCredentials | { codeVerifier: string }): string {
  const iv = crypto.randomBytes(12);
  const cipher = crypto.createCipheriv('aes-256-gcm', encryptionKey(), iv);
  const ciphertext = Buffer.concat([cipher.update(JSON.stringify(value), 'utf8'), cipher.final()]);
  const tag = cipher.getAuthTag();
  return `v1:${iv.toString('base64url')}:${tag.toString('base64url')}:${ciphertext.toString('base64url')}`;
}

export function decryptCalendarCredentials(stored: string): ProviderCredentials | { codeVerifier: string } {
  try {
    const [version, iv, tag, ciphertext] = stored.split(':');
    if (version !== 'v1' || !iv || !tag || !ciphertext) throw new Error('Malformed envelope');
    const decipher = crypto.createDecipheriv('aes-256-gcm', encryptionKey(), Buffer.from(iv, 'base64url'));
    decipher.setAuthTag(Buffer.from(tag, 'base64url'));
    const plaintext = Buffer.concat([decipher.update(Buffer.from(ciphertext, 'base64url')), decipher.final()]);
    return JSON.parse(plaintext.toString('utf8')) as ProviderCredentials | { codeVerifier: string };
  } catch (cause) {
    if (cause instanceof CalendarProviderError) throw cause;
    throw new CalendarProviderError('Stored calendar credentials could not be decrypted.', 'credential_decryption_failed', 500, true);
  }
}

export function providerAvailability(provider: CalendarProvider): { configured: boolean; connectionMethod: 'oauth' | 'credentials'; configurationMessage: string | null } {
  if (!/^[0-9a-fA-F]{64}$/.test(ENCRYPTION_KEY_HEX)) {
    return { configured: false, connectionMethod: provider === 'google' || provider === 'microsoft' ? 'oauth' : 'credentials', configurationMessage: 'Server credential encryption must be configured first.' };
  }
  if (provider === 'google') return { configured: Boolean(GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET), connectionMethod: 'oauth', configurationMessage: GOOGLE_CLIENT_ID && GOOGLE_CLIENT_SECRET ? null : 'Google OAuth credentials are not configured.' };
  if (provider === 'microsoft') return { configured: Boolean(MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET), connectionMethod: 'oauth', configurationMessage: MICROSOFT_CLIENT_ID && MICROSOFT_CLIENT_SECRET ? null : 'Microsoft Entra OAuth credentials are not configured.' };
  return { configured: true, connectionMethod: 'credentials', configurationMessage: null };
}

export function createPkce(): { state: string; stateHash: string; verifier: string; challenge: string } {
  const state = crypto.randomBytes(32).toString('base64url');
  const verifier = crypto.randomBytes(48).toString('base64url');
  return {
    state,
    stateHash: crypto.createHash('sha256').update(state).digest('hex'),
    verifier,
    challenge: crypto.createHash('sha256').update(verifier).digest('base64url'),
  };
}

export function hashOAuthState(state: string): string {
  return crypto.createHash('sha256').update(state).digest('hex');
}

export function buildOAuthUrl(provider: 'google' | 'microsoft', state: string, challenge: string, redirectUri: string): string {
  const availability = providerAvailability(provider);
  if (!availability.configured) throw new CalendarProviderError(availability.configurationMessage ?? 'Provider is not configured.', 'provider_not_configured', 503);
  if (provider === 'google') {
    const url = new URL('https://accounts.google.com/o/oauth2/v2/auth');
    url.searchParams.set('client_id', GOOGLE_CLIENT_ID);
    url.searchParams.set('redirect_uri', redirectUri);
    url.searchParams.set('response_type', 'code');
    url.searchParams.set('access_type', 'offline');
    url.searchParams.set('prompt', 'consent');
    url.searchParams.set('scope', 'openid email profile https://www.googleapis.com/auth/calendar.readonly');
    url.searchParams.set('state', state);
    url.searchParams.set('code_challenge', challenge);
    url.searchParams.set('code_challenge_method', 'S256');
    return url.toString();
  }
  const url = new URL(`https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_TENANT)}/oauth2/v2.0/authorize`);
  url.searchParams.set('client_id', MICROSOFT_CLIENT_ID);
  url.searchParams.set('redirect_uri', redirectUri);
  url.searchParams.set('response_type', 'code');
  url.searchParams.set('response_mode', 'query');
  url.searchParams.set('scope', 'openid profile email offline_access User.Read Calendars.Read');
  url.searchParams.set('state', state);
  url.searchParams.set('code_challenge', challenge);
  url.searchParams.set('code_challenge_method', 'S256');
  return url.toString();
}

async function fetchJson<T>(url: string, init: RequestInit, code: string): Promise<T> {
  let response: Response;
  try { response = await fetch(url, { ...init, signal: AbortSignal.timeout(20_000) }); }
  catch { throw new CalendarProviderError('The calendar provider could not be reached.', `${code}_unreachable`, 502); }
  if (!response.ok) {
    const reconnect = response.status === 401 || response.status === 403;
    throw new CalendarProviderError(reconnect ? 'The calendar connection needs to be authorised again.' : 'The calendar provider rejected the request.', `${code}_http_${response.status}`, 502, reconnect);
  }
  try { return await response.json() as T; }
  catch { throw new CalendarProviderError('The calendar provider returned an invalid response.', `${code}_invalid_response`, 502); }
}

function formBody(values: Record<string, string>): URLSearchParams {
  const body = new URLSearchParams();
  for (const [key, value] of Object.entries(values)) body.set(key, value);
  return body;
}

async function exchangeOAuthToken(provider: 'google' | 'microsoft', code: string, verifier: string, redirectUri: string): Promise<{ credentials: OAuthCredentials; scopes: string[] }> {
  const tokenUrl = provider === 'google'
    ? 'https://oauth2.googleapis.com/token'
    : `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_TENANT)}/oauth2/v2.0/token`;
  const clientId = provider === 'google' ? GOOGLE_CLIENT_ID : MICROSOFT_CLIENT_ID;
  const clientSecret = provider === 'google' ? GOOGLE_CLIENT_SECRET : MICROSOFT_CLIENT_SECRET;
  const scope = provider === 'google' ? '' : 'openid profile email offline_access User.Read Calendars.Read';
  const token = await fetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string; scope?: string }>(tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: clientId, client_secret: clientSecret, code, code_verifier: verifier, redirect_uri: redirectUri, grant_type: 'authorization_code', ...(scope ? { scope } : {}) }),
  }, `${provider}_oauth`);
  if (!token.access_token || !token.refresh_token || !Number.isFinite(token.expires_in)) {
    throw new CalendarProviderError('The calendar provider did not issue a reusable connection.', `${provider}_oauth_incomplete`, 502, true);
  }
  return {
    credentials: { kind: 'oauth', accessToken: token.access_token, refreshToken: token.refresh_token, expiresAt: Date.now() + Number(token.expires_in) * 1000, tokenType: token.token_type ?? 'Bearer' },
    scopes: (token.scope ?? scope).split(/\s+/).filter(Boolean),
  };
}

async function refreshOAuth(provider: 'google' | 'microsoft', credentials: OAuthCredentials): Promise<OAuthCredentials> {
  if (credentials.expiresAt > Date.now() + 60_000) return credentials;
  const tokenUrl = provider === 'google' ? 'https://oauth2.googleapis.com/token' : `https://login.microsoftonline.com/${encodeURIComponent(MICROSOFT_TENANT)}/oauth2/v2.0/token`;
  const clientId = provider === 'google' ? GOOGLE_CLIENT_ID : MICROSOFT_CLIENT_ID;
  const clientSecret = provider === 'google' ? GOOGLE_CLIENT_SECRET : MICROSOFT_CLIENT_SECRET;
  const token = await fetchJson<{ access_token?: string; refresh_token?: string; expires_in?: number; token_type?: string }>(tokenUrl, {
    method: 'POST', headers: { 'content-type': 'application/x-www-form-urlencoded' },
    body: formBody({ client_id: clientId, client_secret: clientSecret, refresh_token: credentials.refreshToken, grant_type: 'refresh_token', ...(provider === 'microsoft' ? { scope: 'openid profile email offline_access User.Read Calendars.Read' } : {}) }),
  }, `${provider}_refresh`);
  if (!token.access_token || !Number.isFinite(token.expires_in)) throw new CalendarProviderError('The calendar connection needs to be authorised again.', `${provider}_refresh_incomplete`, 502, true);
  return { ...credentials, accessToken: token.access_token, refreshToken: token.refresh_token ?? credentials.refreshToken, expiresAt: Date.now() + Number(token.expires_in) * 1000, tokenType: token.token_type ?? credentials.tokenType };
}

async function googleCalendars(credentials: OAuthCredentials): Promise<RemoteCalendar[]> {
  const calendars: RemoteCalendar[] = [];
  let pageToken = '';
  do {
    const url = new URL('https://www.googleapis.com/calendar/v3/users/me/calendarList');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    const body = await fetchJson<{ items?: { id?: string; summary?: string; description?: string; backgroundColor?: string; timeZone?: string; accessRole?: string; primary?: boolean; etag?: string }[]; nextPageToken?: string }>(url.toString(), { headers: { authorization: `Bearer ${credentials.accessToken}` } }, 'google_calendar_list');
    for (const item of body.items ?? []) if (item.id && item.summary) calendars.push({ id: item.id, name: item.summary, description: item.description ?? null, color: item.backgroundColor ?? null, timeZone: item.timeZone ?? null, accessRole: item.accessRole ?? null, isPrimary: item.primary === true, etag: item.etag ?? null });
    pageToken = body.nextPageToken ?? '';
  } while (pageToken);
  return calendars;
}

async function microsoftCalendars(credentials: OAuthCredentials): Promise<RemoteCalendar[]> {
  const calendars: RemoteCalendar[] = [];
  let url: string | null = 'https://graph.microsoft.com/v1.0/me/calendars?$select=id,name,color,canEdit,isDefaultCalendar,owner';
  while (url) {
    const body: { value?: { id?: string; name?: string; color?: string; canEdit?: boolean; isDefaultCalendar?: boolean; owner?: { address?: string } }[]; '@odata.nextLink'?: string } = await fetchJson(url, { headers: { authorization: `Bearer ${credentials.accessToken}` } }, 'microsoft_calendar_list');
    for (const item of body.value ?? []) if (item.id && item.name) calendars.push({ id: item.id, name: item.name, description: null, color: item.color ?? null, timeZone: null, accessRole: item.canEdit ? 'writer' : 'reader', isPrimary: item.isDefaultCalendar === true, etag: null });
    url = body['@odata.nextLink'] ?? null;
  }
  return calendars;
}

export async function completeOAuthConnection(provider: 'google' | 'microsoft', code: string, verifier: string, redirectUri: string): Promise<ConnectedProviderAccount> {
  const exchanged = await exchangeOAuthToken(provider, code, verifier, redirectUri);
  const credentials = exchanged.credentials;
  if (provider === 'google') {
    const [identity, calendars] = await Promise.all([
      fetchJson<{ sub?: string; email?: string; name?: string }>('https://openidconnect.googleapis.com/v1/userinfo', { headers: { authorization: `Bearer ${credentials.accessToken}` } }, 'google_identity'),
      googleCalendars(credentials),
    ]);
    if (!identity.sub || calendars.length === 0) throw new CalendarProviderError('Google did not return a usable calendar account.', 'google_account_incomplete');
    return { identity: { id: identity.sub, email: identity.email ?? null, displayName: identity.name ?? identity.email ?? 'Google Calendar' }, credentials, scopes: exchanged.scopes, metadata: {}, calendars };
  }
  const [identity, calendars] = await Promise.all([
    fetchJson<{ id?: string; displayName?: string; mail?: string; userPrincipalName?: string }>('https://graph.microsoft.com/v1.0/me?$select=id,displayName,mail,userPrincipalName', { headers: { authorization: `Bearer ${credentials.accessToken}` } }, 'microsoft_identity'),
    microsoftCalendars(credentials),
  ]);
  if (!identity.id || calendars.length === 0) throw new CalendarProviderError('Microsoft did not return a usable calendar account.', 'microsoft_account_incomplete');
  const email = identity.mail ?? identity.userPrincipalName ?? null;
  return { identity: { id: identity.id, email, displayName: identity.displayName ?? email ?? 'Microsoft Calendar' }, credentials, scopes: exchanged.scopes, metadata: { tenant: MICROSOFT_TENANT }, calendars };
}

function isPrivateAddress(address: string): boolean {
  if (net.isIP(address) === 4) {
    const octets = address.split('.').map(Number);
    return octets[0] === 10 || octets[0] === 127 || (octets[0] === 169 && octets[1] === 254) || (octets[0] === 172 && (octets[1] ?? 0) >= 16 && (octets[1] ?? 0) <= 31) || (octets[0] === 192 && octets[1] === 168) || octets[0] === 0;
  }
  const lower = address.toLowerCase();
  return lower === '::1' || lower.startsWith('fc') || lower.startsWith('fd') || lower.startsWith('fe80:') || lower === '::';
}

async function assertSafeHttpsUrl(raw: string): Promise<URL> {
  let url: URL;
  try { url = new URL(raw); } catch { throw new CalendarProviderError('Enter a valid HTTPS server address.', 'invalid_server_url', 400); }
  if (url.protocol !== 'https:' || url.username || url.password) throw new CalendarProviderError('The calendar server must use HTTPS and must not contain credentials in the URL.', 'unsafe_server_url', 400);
  const addresses = await dns.lookup(url.hostname, { all: true });
  if (!addresses.length || addresses.some(result => isPrivateAddress(result.address))) throw new CalendarProviderError('The calendar server address is not publicly routable.', 'unsafe_server_address', 400);
  return url;
}

async function fetchSafeHttps(raw: string, init: RequestInit): Promise<Response> {
  let target = await assertSafeHttpsUrl(raw);
  for (let redirects = 0; redirects <= 5; redirects += 1) {
    const response = await fetch(target, { ...init, redirect: 'manual', signal: AbortSignal.timeout(20_000) });
    if (![301, 302, 303, 307, 308].includes(response.status)) return response;
    const location = response.headers.get('location');
    if (!location || redirects === 5) throw new CalendarProviderError('The calendar server returned an unsafe redirect.', 'calendar_server_redirect', 502);
    target = await assertSafeHttpsUrl(new URL(location, target).toString());
  }
  throw new CalendarProviderError('The calendar server returned too many redirects.', 'calendar_server_redirect', 502);
}

function xmlDecode(value: string): string {
  return value.replace(/&lt;/g, '<').replace(/&gt;/g, '>').replace(/&quot;/g, '"').replace(/&apos;/g, "'").replace(/&amp;/g, '&').trim();
}

function xmlTag(block: string, localName: string): string | null {
  const match = new RegExp(`<(?:[A-Za-z0-9_-]+:)?${localName}(?:\\s[^>]*)?>([\\s\\S]*?)<\\/(?:[A-Za-z0-9_-]+:)?${localName}>`, 'i').exec(block);
  return match?.[1] ? xmlDecode(match[1].replace(/<[^>]+>/g, '')) : null;
}

function xmlBlocks(xml: string, localName: string): string[] {
  return [...xml.matchAll(new RegExp(`<(?:[A-Za-z0-9_-]+:)?${localName}(?:\\s[^>]*)?>[\\s\\S]*?<\\/(?:[A-Za-z0-9_-]+:)?${localName}>`, 'gi'))].map(match => match[0]);
}

async function davRequest(url: string, credentials: PasswordCredentials, method: 'PROPFIND' | 'REPORT', body: string, depth: string): Promise<{ text: string; url: string }> {
  const target = await assertSafeHttpsUrl(url);
  let response: Response;
  try {
    response = await fetchSafeHttps(target.toString(), { method, headers: { authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`, depth, 'content-type': 'application/xml; charset=utf-8' }, body });
  } catch { throw new CalendarProviderError('The calendar server could not be reached.', 'calendar_server_unreachable', 502); }
  if (!response.ok && response.status !== 207) throw new CalendarProviderError(response.status === 401 || response.status === 403 ? 'The calendar server rejected the supplied credentials.' : 'The calendar server rejected the request.', `calendar_server_http_${response.status}`, response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403);
  return { text: await response.text(), url: response.url || target.toString() };
}

function absoluteDavUrl(base: string, href: string): string {
  try { return new URL(href, base).toString(); } catch { throw new CalendarProviderError('The calendar server returned an invalid collection address.', 'invalid_calendar_href'); }
}

async function discoverCalDav(credentials: PasswordCredentials): Promise<RemoteCalendar[]> {
  const principalResponse = await davRequest(credentials.serverUrl, credentials, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:"><d:prop><d:current-user-principal/></d:prop></d:propfind>', '0');
  const principalHref = xmlTag(principalResponse.text, 'href');
  if (!principalHref) throw new CalendarProviderError('The CalDAV server did not provide an account principal.', 'caldav_principal_missing');
  const principalUrl = absoluteDavUrl(principalResponse.url, principalHref);
  const homeResponse = await davRequest(principalUrl, credentials, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><c:calendar-home-set/></d:prop></d:propfind>', '0');
  const homeHref = xmlTag(homeResponse.text, 'href');
  if (!homeHref) throw new CalendarProviderError('The CalDAV server did not provide a calendar home.', 'caldav_home_missing');
  const homeUrl = absoluteDavUrl(homeResponse.url, homeHref);
  const list = await davRequest(homeUrl, credentials, 'PROPFIND', '<?xml version="1.0"?><d:propfind xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav" xmlns:a="http://apple.com/ns/ical/"><d:prop><d:displayname/><d:resourcetype/><a:calendar-color/><c:calendar-description/><d:getetag/></d:prop></d:propfind>', '1');
  const calendars: RemoteCalendar[] = [];
  for (const response of xmlBlocks(list.text, 'response')) {
    if (!/<(?:[A-Za-z0-9_-]+:)?calendar\b/i.test(response)) continue;
    const href = xmlTag(response, 'href');
    if (!href) continue;
    calendars.push({ id: absoluteDavUrl(list.url, href), name: xmlTag(response, 'displayname') ?? 'Calendar', description: xmlTag(response, 'calendar-description'), color: xmlTag(response, 'calendar-color'), timeZone: null, accessRole: 'reader', isPrimary: calendars.length === 0, etag: xmlTag(response, 'getetag') });
  }
  if (!calendars.length) throw new CalendarProviderError('No calendars were found for this CalDAV account.', 'caldav_no_calendars');
  return calendars;
}

function ewsEnvelope(body: string): string {
  return `<?xml version="1.0" encoding="utf-8"?><soap:Envelope xmlns:soap="http://schemas.xmlsoap.org/soap/envelope/" xmlns:t="http://schemas.microsoft.com/exchange/services/2006/types" xmlns:m="http://schemas.microsoft.com/exchange/services/2006/messages"><soap:Header><t:RequestServerVersion Version="Exchange2013"/></soap:Header><soap:Body>${body}</soap:Body></soap:Envelope>`;
}

async function ewsRequest(credentials: PasswordCredentials, body: string): Promise<string> {
  const target = await assertSafeHttpsUrl(credentials.serverUrl);
  let response: Response;
  try { response = await fetchSafeHttps(target.toString(), { method: 'POST', headers: { authorization: `Basic ${Buffer.from(`${credentials.username}:${credentials.password}`).toString('base64')}`, 'content-type': 'text/xml; charset=utf-8' }, body: ewsEnvelope(body) }); }
  catch { throw new CalendarProviderError('Exchange Server could not be reached.', 'exchange_unreachable'); }
  const text = await response.text();
  if (!response.ok || /ResponseClass="Error"/i.test(text)) throw new CalendarProviderError(response.status === 401 || response.status === 403 ? 'Exchange Server rejected the supplied credentials.' : 'Exchange Server rejected the calendar request.', `exchange_http_${response.status}`, response.status === 401 || response.status === 403 ? 401 : 502, response.status === 401 || response.status === 403);
  return text;
}

async function discoverExchange(credentials: PasswordCredentials): Promise<RemoteCalendar[]> {
  const response = await ewsRequest(credentials, '<m:GetFolder><m:FolderShape><t:BaseShape>Default</t:BaseShape></m:FolderShape><m:FolderIds><t:DistinguishedFolderId Id="calendar"/></m:FolderIds></m:GetFolder>');
  const name = xmlTag(response, 'DisplayName') ?? 'Calendar';
  return [{ id: 'calendar', name, description: 'Exchange Server calendar', color: '#0078d4', timeZone: null, accessRole: 'reader', isPrimary: true, etag: null }];
}

export async function connectCredentialProvider(provider: 'apple' | 'exchange', username: string, password: string, serverUrl?: string): Promise<ConnectedProviderAccount> {
  const availability = providerAvailability(provider);
  if (!availability.configured) throw new CalendarProviderError(availability.configurationMessage ?? 'Provider is not configured.', 'provider_not_configured', 503);
  const resolvedUrl = provider === 'apple' ? 'https://caldav.icloud.com/' : serverUrl ?? '';
  if (!resolvedUrl) throw new CalendarProviderError('Enter the Exchange Web Services URL.', 'exchange_url_required', 400);
  const credentials: PasswordCredentials = { kind: 'password', username, password, serverUrl: (await assertSafeHttpsUrl(resolvedUrl)).toString() };
  const calendars = provider === 'apple' ? await discoverCalDav(credentials) : await discoverExchange(credentials);
  return { identity: { id: username.trim().toLowerCase(), email: username.includes('@') ? username.trim().toLowerCase() : null, displayName: username.trim() }, credentials, scopes: ['calendar.read'], metadata: provider === 'exchange' ? { serverUrl: credentials.serverUrl } : {}, calendars };
}

function isoDateOnly(value: string | undefined): string | null {
  if (!value) return null;
  const compact = value.replace(/-/g, '').slice(0, 8);
  return /^\d{8}$/.test(compact) ? `${compact.slice(0, 4)}-${compact.slice(4, 6)}-${compact.slice(6, 8)}` : null;
}

function previousDate(date: string): string {
  const value = new Date(`${date}T00:00:00Z`); value.setUTCDate(value.getUTCDate() - 1); return value.toISOString().slice(0, 10);
}

function localDateTimeToIso(value: string, timeZone = APP_TZ): string | null {
  const normalized = value.replace(/[-:]/g, '');
  const match = /^(\d{4})(\d{2})(\d{2})T(\d{2})(\d{2})(\d{2})(Z)?$/.exec(normalized);
  if (!match) return null;
  const base = Date.UTC(Number(match[1]), Number(match[2]) - 1, Number(match[3]), Number(match[4]), Number(match[5]), Number(match[6]));
  if (match[7]) return new Date(base).toISOString();
  try {
    let candidate = base;
    for (let i = 0; i < 2; i++) {
      const parts = new Intl.DateTimeFormat('en-CA', { timeZone, year: 'numeric', month: '2-digit', day: '2-digit', hour: '2-digit', minute: '2-digit', second: '2-digit', hourCycle: 'h23' }).formatToParts(new Date(candidate));
      const values = Object.fromEntries(parts.map(part => [part.type, part.value]));
      const shown = Date.UTC(Number(values.year), Number(values.month) - 1, Number(values.day), Number(values.hour), Number(values.minute), Number(values.second));
      candidate -= shown - base;
    }
    return new Date(candidate).toISOString();
  } catch { return new Date(base).toISOString(); }
}

function unfoldIcs(value: string): string[] {
  return value.replace(/\r\n[ \t]/g, '').replace(/\n[ \t]/g, '').split(/\r?\n/);
}

function icsValue(lines: string[], name: string): { value: string; params: string } | null {
  const line = lines.find(candidate => candidate.toUpperCase().startsWith(`${name}:`) || candidate.toUpperCase().startsWith(`${name};`));
  if (!line) return null;
  const colon = line.indexOf(':');
  return colon < 0 ? null : { params: line.slice(name.length, colon), value: line.slice(colon + 1).replace(/\\n/gi, '\n').replace(/\\,/g, ',').replace(/\\;/g, ';').replace(/\\\\/g, '\\') };
}

function parseIcsEvents(ics: string): { events: RemoteCalendarEvent[]; deleted: string[] } {
  const result: RemoteCalendarEvent[] = [];
  const deleted: string[] = [];
  for (const block of ics.match(/BEGIN:VEVENT[\s\S]*?END:VEVENT/gi) ?? []) {
    const lines = unfoldIcs(block);
    const uid = icsValue(lines, 'UID')?.value;
    const recurrenceId = icsValue(lines, 'RECURRENCE-ID')?.value;
    if (!uid) continue;
    const id = recurrenceId ? `${uid}::${recurrenceId}` : uid;
    if (icsValue(lines, 'STATUS')?.value.toUpperCase() === 'CANCELLED') { deleted.push(id); continue; }
    const start = icsValue(lines, 'DTSTART');
    const end = icsValue(lines, 'DTEND');
    if (!start) continue;
    const allDay = /VALUE=DATE/i.test(start.params) || /^\d{8}$/.test(start.value);
    const tzid = (/TZID=([^;:]+)/i.exec(start.params))?.[1] ?? APP_TZ;
    const startsOn = allDay ? isoDateOnly(start.value) : null;
    const exclusiveEnd = allDay ? isoDateOnly(end?.value) : null;
    const startsAt = allDay ? null : localDateTimeToIso(start.value, tzid);
    const endsAt = allDay ? null : end ? localDateTimeToIso(end.value, (/TZID=([^;:]+)/i.exec(end.params))?.[1] ?? tzid) : startsAt;
    if ((allDay && !startsOn) || (!allDay && !startsAt)) continue;
    const summary = icsValue(lines, 'SUMMARY')?.value.trim();
    result.push({ providerEventId: id, title: summary && summary.length > 0 ? summary : 'Untitled event', notes: icsValue(lines, 'DESCRIPTION')?.value ?? null, location: icsValue(lines, 'LOCATION')?.value ?? null, allDay, startsOn, endsOn: exclusiveEnd && startsOn && exclusiveEnd > startsOn ? previousDate(exclusiveEnd) : startsOn, startsAt, endsAt, etag: null, updatedAt: localDateTimeToIso(icsValue(lines, 'LAST-MODIFIED')?.value ?? '') });
  }
  return { events: result, deleted };
}

async function pullGoogle(credentials: OAuthCredentials, calendarId: string, from: string, to: string, cursor: Record<string, unknown>): Promise<ProviderPullResult> {
  const refreshed = await refreshOAuth('google', credentials);
  const events: RemoteCalendarEvent[] = []; const deletedEventIds: string[] = [];
  let pageToken = ''; let syncToken = typeof cursor.syncToken === 'string' ? cursor.syncToken : '';
  do {
    const url = new URL(`https://www.googleapis.com/calendar/v3/calendars/${encodeURIComponent(calendarId)}/events`);
    url.searchParams.set('showDeleted', 'true'); url.searchParams.set('maxResults', '2500');
    if (pageToken) url.searchParams.set('pageToken', pageToken);
    if (syncToken) url.searchParams.set('syncToken', syncToken);
    else { url.searchParams.set('timeMin', `${from}T00:00:00Z`); url.searchParams.set('timeMax', `${to}T23:59:59Z`); url.searchParams.set('singleEvents', 'true'); }
    let body: { items?: GoogleCalendarEventPayload[]; nextPageToken?: string; nextSyncToken?: string };
    try { body = await fetchJson(url.toString(), { headers: { authorization: `Bearer ${refreshed.accessToken}` } }, 'google_events'); }
    catch (error) {
      if (syncToken && error instanceof CalendarProviderError && error.code === 'google_events_http_410') return pullGoogle(refreshed, calendarId, from, to, {});
      throw error;
    }
    for (const item of body.items ?? []) {
      const itemId = item.id;
      if (!itemId) continue;
      if (item.status === 'cancelled') { deletedEventIds.push(itemId); continue; }
      const startDate = item.start?.date;
      const allDay = Boolean(startDate);
      const startOn = allDay ? startDate ?? null : null;
      const exclusiveEnd = allDay ? item.end?.date : undefined;
      const summary = item.summary?.trim();
      events.push({ providerEventId: itemId, title: summary && summary.length > 0 ? summary : 'Untitled event', notes: item.description ?? null, location: item.location ?? null, allDay, startsOn: startOn, endsOn: allDay && exclusiveEnd && startOn && exclusiveEnd > startOn ? previousDate(exclusiveEnd) : startOn, startsAt: allDay ? null : item.start?.dateTime ?? null, endsAt: allDay ? null : item.end?.dateTime ?? item.start?.dateTime ?? null, etag: item.etag ?? null, updatedAt: item.updated ?? null });
    }
    pageToken = body.nextPageToken ?? '';
    if (body.nextSyncToken) syncToken = body.nextSyncToken;
  } while (pageToken);
  return { credentials: refreshed, events, deletedEventIds, cursor: syncToken ? { syncToken } : {}, fullSnapshot: typeof cursor.syncToken !== 'string' };
}

async function pullMicrosoft(credentials: OAuthCredentials, calendarId: string, from: string, to: string, cursor: Record<string, unknown>): Promise<ProviderPullResult> {
  const refreshed = await refreshOAuth('microsoft', credentials);
  const events: RemoteCalendarEvent[] = []; const deletedEventIds: string[] = [];
  let url: string | null = typeof cursor.deltaLink === 'string' ? cursor.deltaLink : `https://graph.microsoft.com/v1.0/me/calendars/${encodeURIComponent(calendarId)}/calendarView/delta?startDateTime=${encodeURIComponent(`${from}T00:00:00Z`)}&endDateTime=${encodeURIComponent(`${to}T23:59:59Z`)}&$select=id,subject,bodyPreview,start,end,isAllDay,location,lastModifiedDateTime,isCancelled`;
  let deltaLink = '';
  while (url) {
    let body: { value?: MicrosoftCalendarEventPayload[]; '@odata.nextLink'?: string; '@odata.deltaLink'?: string };
    try { body = await fetchJson(url, { headers: { authorization: `Bearer ${refreshed.accessToken}`, Prefer: 'outlook.timezone="UTC"' } }, 'microsoft_events'); }
    catch (error) {
      if (typeof cursor.deltaLink === 'string' && error instanceof CalendarProviderError && error.code === 'microsoft_events_http_410') return pullMicrosoft(refreshed, calendarId, from, to, {});
      throw error;
    }
    for (const item of body.value ?? []) {
      const itemId = item.id;
      if (!itemId) continue;
      if (item['@removed'] || item.isCancelled) { deletedEventIds.push(itemId); continue; }
      const allDay = item.isAllDay === true;
      const startValue = item.start?.dateTime;
      const endValue = item.end?.dateTime;
      const startOn = allDay && startValue ? startValue.slice(0, 10) : null;
      const exclusiveEnd = allDay && endValue ? endValue.slice(0, 10) : null;
      const subject = item.subject?.trim();
      events.push({ providerEventId: itemId, title: subject && subject.length > 0 ? subject : 'Untitled event', notes: item.bodyPreview ?? null, location: item.location?.displayName ?? null, allDay, startsOn: startOn, endsOn: startOn && exclusiveEnd && exclusiveEnd > startOn ? previousDate(exclusiveEnd) : startOn, startsAt: allDay ? null : startValue ? new Date(`${startValue}${/[zZ]|[+-]\d\d:\d\d$/.test(startValue) ? '' : 'Z'}`).toISOString() : null, endsAt: allDay ? null : endValue ? new Date(`${endValue}${/[zZ]|[+-]\d\d:\d\d$/.test(endValue) ? '' : 'Z'}`).toISOString() : null, etag: item['@odata.etag'] ?? null, updatedAt: item.lastModifiedDateTime ?? null });
    }
    url = body['@odata.nextLink'] ?? null; if (body['@odata.deltaLink']) deltaLink = body['@odata.deltaLink'];
  }
  return { credentials: refreshed, events: events.filter(event => event.allDay ? event.startsOn : event.startsAt), deletedEventIds, cursor: deltaLink ? { deltaLink } : cursor, fullSnapshot: typeof cursor.deltaLink !== 'string' };
}

async function pullCalDav(credentials: PasswordCredentials, calendarUrl: string, from: string, to: string): Promise<ProviderPullResult> {
  const start = from.replace(/-/g, '') + 'T000000Z'; const end = to.replace(/-/g, '') + 'T235959Z';
  const response = await davRequest(calendarUrl, credentials, 'REPORT', `<?xml version="1.0"?><c:calendar-query xmlns:d="DAV:" xmlns:c="urn:ietf:params:xml:ns:caldav"><d:prop><d:getetag/><c:calendar-data><c:expand start="${start}" end="${end}"/></c:calendar-data></d:prop><c:filter><c:comp-filter name="VCALENDAR"><c:comp-filter name="VEVENT"><c:time-range start="${start}" end="${end}"/></c:comp-filter></c:comp-filter></c:filter></c:calendar-query>`, '1');
  const events: RemoteCalendarEvent[] = []; const deletedEventIds: string[] = [];
  for (const block of xmlBlocks(response.text, 'response')) {
    const dataMatch = /<(?:[A-Za-z0-9_-]+:)?calendar-data(?:\s[^>]*)?>([\s\S]*?)<\/(?:[A-Za-z0-9_-]+:)?calendar-data>/i.exec(block);
    if (!dataMatch?.[1]) continue;
    const parsed = parseIcsEvents(xmlDecode(dataMatch[1]));
    const etag = xmlTag(block, 'getetag');
    events.push(...parsed.events.map(event => ({ ...event, etag }))); deletedEventIds.push(...parsed.deleted);
  }
  return { credentials, events, deletedEventIds, cursor: { fullSnapshotAt: new Date().toISOString(), from, to }, fullSnapshot: true };
}

async function pullExchange(credentials: PasswordCredentials, from: string, to: string): Promise<ProviderPullResult> {
  const response = await ewsRequest(credentials, `<m:FindItem Traversal="Shallow"><m:ItemShape><t:BaseShape>Default</t:BaseShape><t:AdditionalProperties><t:FieldURI FieldURI="item:Body"/><t:FieldURI FieldURI="calendar:Start"/><t:FieldURI FieldURI="calendar:End"/><t:FieldURI FieldURI="calendar:IsAllDayEvent"/><t:FieldURI FieldURI="calendar:IsCancelled"/><t:FieldURI FieldURI="item:LastModifiedTime"/></t:AdditionalProperties></m:ItemShape><m:CalendarView StartDate="${from}T00:00:00Z" EndDate="${to}T23:59:59Z"/><m:ParentFolderIds><t:DistinguishedFolderId Id="calendar"/></m:ParentFolderIds></m:FindItem>`);
  const events: RemoteCalendarEvent[] = []; const deletedEventIds: string[] = [];
  for (const block of xmlBlocks(response, 'CalendarItem')) {
    const itemTag = /<(?:[A-Za-z0-9_-]+:)?ItemId\s+[^>]*Id="([^"]+)"[^>]*\/>/i.exec(block);
    const id = itemTag?.[1]; if (!id) continue;
    const changeKey = /ChangeKey="([^"]+)"/i.exec(itemTag[0])?.[1] ?? null;
    if (xmlTag(block, 'IsCancelled')?.toLowerCase() === 'true') { deletedEventIds.push(id); continue; }
    const allDay = xmlTag(block, 'IsAllDayEvent')?.toLowerCase() === 'true'; const start = xmlTag(block, 'Start'); const end = xmlTag(block, 'End');
    const startOn = allDay && start ? start.slice(0, 10) : null; const exclusiveEnd = allDay && end ? end.slice(0, 10) : null;
    events.push({ providerEventId: id, title: xmlTag(block, 'Subject') ?? 'Untitled event', notes: xmlTag(block, 'Body'), location: xmlTag(block, 'Location'), allDay, startsOn: startOn, endsOn: startOn && exclusiveEnd && exclusiveEnd > startOn ? previousDate(exclusiveEnd) : startOn, startsAt: allDay ? null : start, endsAt: allDay ? null : end ?? start, etag: changeKey, updatedAt: xmlTag(block, 'LastModifiedTime') });
  }
  return { credentials, events: events.filter(event => event.allDay ? event.startsOn : event.startsAt), deletedEventIds, cursor: { fullSnapshotAt: new Date().toISOString(), from, to }, fullSnapshot: true };
}

export async function pullProviderCalendar(provider: CalendarProvider, storedCredentials: ProviderCredentials, providerCalendarId: string, from: string, to: string, cursor: Record<string, unknown>): Promise<ProviderPullResult> {
  if (provider === 'google') {
    if (storedCredentials.kind !== 'oauth') throw new CalendarProviderError('Google credentials are invalid.', 'credential_kind_invalid', 500, true);
    return pullGoogle(storedCredentials, providerCalendarId, from, to, cursor);
  }
  if (provider === 'microsoft') {
    if (storedCredentials.kind !== 'oauth') throw new CalendarProviderError('Microsoft credentials are invalid.', 'credential_kind_invalid', 500, true);
    return pullMicrosoft(storedCredentials, providerCalendarId, from, to, cursor);
  }
  if (storedCredentials.kind !== 'password') throw new CalendarProviderError('Calendar credentials are invalid.', 'credential_kind_invalid', 500, true);
  return provider === 'apple' ? pullCalDav(storedCredentials, providerCalendarId, from, to) : pullExchange(storedCredentials, from, to);
}
