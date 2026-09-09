/**
 * Zoom Meetings provider adapter.
 *
 * Credentials and access tokens never cross the backend boundary. SIOMAC uses
 * Zoom Server-to-Server OAuth for its own account and stores only the provider
 * meeting id and attendee join URL. The short-lived host start URL is never
 * persisted because Zoom expires it and recommends fetching a fresh value.
 */

import jwt from 'jsonwebtoken';

const ZOOM_API = 'https://api.zoom.us/v2';
const ZOOM_TOKEN_URL = 'https://zoom.us/oauth/token';
const REQUEST_TIMEOUT_MS = 15_000;

interface ZoomConfig {
  accountId: string;
  clientId: string;
  clientSecret: string;
  hostUserId: string;
}

interface CachedToken { value: string; expiresAt: number }
let tokenCache: CachedToken | null = null;

export interface ZoomMeetingInput {
  topic: string;
  agenda?: string | null;
  startsAt: string;
  durationMinutes: number;
  timezone: string;
  waitingRoom?: boolean;
}

export interface ZoomMeetingResult {
  providerMeetingId: string;
  joinUrl: string;
  hostEmail: string | null;
}

export interface ZoomSdkSignatureResult {
  signature: string;
  sdkKey: string;
  expiresAt: string;
}

export class ZoomProviderError extends Error {
  constructor(message: string, readonly status: number, readonly retryable: boolean) {
    super(message);
    this.name = 'ZoomProviderError';
  }
}

function env(name: string): string {
  const value = process.env[name]?.trim();
  if (!value) throw new ZoomProviderError(`Zoom integration is not configured (${name}).`, 503, false);
  return value;
}

function config(): ZoomConfig {
  return {
    accountId: env('ZOOM_ACCOUNT_ID'),
    clientId: env('ZOOM_CLIENT_ID'),
    clientSecret: env('ZOOM_CLIENT_SECRET'),
    hostUserId: env('ZOOM_HOST_USER_ID'),
  };
}

async function zoomFetch<T>(url: string, init: RequestInit): Promise<T> {
  const controller = new AbortController();
  const timeout = setTimeout(() => controller.abort(), REQUEST_TIMEOUT_MS);
  try {
    const response = await fetch(url, { ...init, signal: controller.signal });
    const body = await response.json().catch(() => null) as { message?: string; code?: number } | T | null;
    if (!response.ok) {
      const providerMessage = body && typeof body === 'object' && 'message' in body ? body.message : undefined;
      throw new ZoomProviderError(providerMessage && providerMessage.length > 0 ? providerMessage : `Zoom request failed with HTTP ${response.status}.`, response.status, response.status === 429 || response.status >= 500);
    }
    return body as T;
  } catch (cause) {
    if (cause instanceof ZoomProviderError) throw cause;
    if (cause instanceof Error && cause.name === 'AbortError') throw new ZoomProviderError('Zoom request timed out.', 504, true);
    throw new ZoomProviderError('Zoom could not be reached.', 502, true);
  } finally {
    clearTimeout(timeout);
  }
}

async function accessToken(): Promise<string> {
  if (tokenCache && tokenCache.expiresAt > Date.now() + 60_000) return tokenCache.value;
  const cfg = config();
  const url = new URL(ZOOM_TOKEN_URL);
  url.searchParams.set('grant_type', 'account_credentials');
  url.searchParams.set('account_id', cfg.accountId);
  const result = await zoomFetch<{ access_token: string; expires_in: number }>(url.toString(), {
    method: 'POST',
    headers: {
      authorization: `Basic ${Buffer.from(`${cfg.clientId}:${cfg.clientSecret}`).toString('base64')}`,
      'content-type': 'application/x-www-form-urlencoded',
    },
  });
  if (!result.access_token || !Number.isFinite(result.expires_in)) throw new ZoomProviderError('Zoom returned an invalid OAuth response.', 502, true);
  tokenCache = { value: result.access_token, expiresAt: Date.now() + result.expires_in * 1000 };
  return tokenCache.value;
}

async function authorized<T>(path: string, init: RequestInit): Promise<T> {
  const token = await accessToken();
  const headers = new Headers(init.headers);
  headers.set('authorization', `Bearer ${token}`);
  headers.set('content-type', 'application/json');
  return zoomFetch<T>(`${ZOOM_API}${path}`, {
    ...init,
    headers,
  });
}

export async function createZoomMeeting(input: ZoomMeetingInput): Promise<ZoomMeetingResult> {
  const cfg = config();
  const agenda = input.agenda?.trim();
  const result = await authorized<{ id: number | string; join_url: string; host_email?: string }>(`/users/${encodeURIComponent(cfg.hostUserId)}/meetings`, {
    method: 'POST',
    body: JSON.stringify({
      topic: input.topic,
      agenda: agenda && agenda.length > 0 ? agenda : undefined,
      type: 2,
      start_time: input.startsAt,
      duration: input.durationMinutes,
      timezone: input.timezone,
      settings: {
        waiting_room: input.waitingRoom ?? true,
        join_before_host: false,
        mute_upon_entry: true,
        approval_type: 2,
      },
    }),
  });
  if (!result.id || !result.join_url) throw new ZoomProviderError('Zoom returned an incomplete meeting response.', 502, true);
  return { providerMeetingId: String(result.id), joinUrl: result.join_url, hostEmail: result.host_email ?? null };
}

export async function updateZoomMeeting(providerMeetingId: string, input: ZoomMeetingInput): Promise<void> {
  const agenda = input.agenda?.trim();
  await authorized<unknown>(`/meetings/${encodeURIComponent(providerMeetingId)}`, {
    method: 'PATCH',
    body: JSON.stringify({ topic: input.topic, agenda: agenda && agenda.length > 0 ? agenda : undefined, start_time: input.startsAt, duration: input.durationMinutes, timezone: input.timezone }),
  });
}

export async function deleteZoomMeeting(providerMeetingId: string): Promise<void> {
  await authorized<unknown>(`/meetings/${encodeURIComponent(providerMeetingId)}`, { method: 'DELETE' });
}

/** Fetch a fresh host URL only at the point the authorised organizer starts. */
export async function getZoomHostStartUrl(providerMeetingId: string): Promise<string> {
  const result = await authorized<{ start_url?: string }>(`/meetings/${encodeURIComponent(providerMeetingId)}`, { method: 'GET' });
  if (!result.start_url) throw new ZoomProviderError('Zoom did not return a host start URL.', 502, true);
  return result.start_url;
}

export function zoomIntegrationConfigured(): boolean {
  return ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_HOST_USER_ID'].every(name => Boolean(process.env[name]?.trim()));
}

/**
 * Authorize Zoom Meeting SDK component view without exposing its signing
 * secret. Participant role is the safe default; organizer host mode additionally
 * needs a fresh ZAK and is handled by the start command, never by this helper.
 */
export function createZoomMeetingSdkSignature(meetingNumber: string, role: 0 | 1): ZoomSdkSignatureResult {
  if (!/^\d{9,13}$/.test(meetingNumber)) throw new ZoomProviderError('A valid Zoom meeting number is required.', 400, false);
  const sdkKey = env('ZOOM_MEETING_SDK_CLIENT_ID');
  const sdkSecret = env('ZOOM_MEETING_SDK_CLIENT_SECRET');
  const issuedAt = Math.floor(Date.now() / 1000) - 30;
  const expiresAt = issuedAt + 60 * 60 * 2;
  const signature = jwt.sign({ appKey: sdkKey, mn: meetingNumber, role, iat: issuedAt, exp: expiresAt, tokenExp: expiresAt }, sdkSecret, { algorithm: 'HS256', header: { alg: 'HS256', typ: 'JWT' } });
  return { signature, sdkKey, expiresAt: new Date(expiresAt * 1000).toISOString() };
}

export function zoomMeetingSdkConfigured(): boolean {
  return ['ZOOM_MEETING_SDK_CLIENT_ID', 'ZOOM_MEETING_SDK_CLIENT_SECRET'].every(name => Boolean(process.env[name]?.trim()));
}
