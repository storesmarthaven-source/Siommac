import { afterEach, beforeEach, describe, expect, it, jest } from '@jest/globals';
import jwt from 'jsonwebtoken';
import { createZoomMeeting, createZoomMeetingSdkSignature, zoomIntegrationConfigured } from '../../netlify/functions/lib/meetings/zoomProvider';

const ENV_KEYS = ['ZOOM_ACCOUNT_ID', 'ZOOM_CLIENT_ID', 'ZOOM_CLIENT_SECRET', 'ZOOM_HOST_USER_ID', 'ZOOM_MEETING_SDK_CLIENT_ID', 'ZOOM_MEETING_SDK_CLIENT_SECRET'] as const;
const original = Object.fromEntries(ENV_KEYS.map(key => [key, process.env[key]]));

describe('Zoom provider', () => {
  beforeEach(() => {
    process.env.ZOOM_ACCOUNT_ID = 'account'; process.env.ZOOM_CLIENT_ID = 'client';
    process.env.ZOOM_CLIENT_SECRET = 'secret'; process.env.ZOOM_HOST_USER_ID = 'host@example.test';
    process.env.ZOOM_MEETING_SDK_CLIENT_ID = 'sdk-client'; process.env.ZOOM_MEETING_SDK_CLIENT_SECRET = 'sdk-secret';
  });
  afterEach(() => {
    jest.restoreAllMocks();
    for (const key of ENV_KEYS) original[key] === undefined ? delete process.env[key] : process.env[key] = original[key];
  });

  it('reports whether all server-side credentials are present', () => {
    expect(zoomIntegrationConfigured()).toBe(true);
    delete process.env.ZOOM_CLIENT_SECRET;
    expect(zoomIntegrationConfigured()).toBe(false);
  });

  it('obtains an account token and creates a scheduled Zoom meeting', async () => {
    const fetchMock = jest.spyOn(globalThis, 'fetch')
      .mockResolvedValueOnce(new Response(JSON.stringify({ access_token: 'token', expires_in: 3600 }), { status: 200 }))
      .mockResolvedValueOnce(new Response(JSON.stringify({ id: 1234, join_url: 'https://zoom.us/j/1234', host_email: 'host@example.test' }), { status: 201 }));
    const result = await createZoomMeeting({ topic: 'Safety review', startsAt: '2026-09-10T13:00:00.000Z', durationMinutes: 45, timezone: 'America/Port_of_Spain' });
    expect(result).toEqual({ providerMeetingId: '1234', joinUrl: 'https://zoom.us/j/1234', hostEmail: 'host@example.test' });
    expect(fetchMock.mock.calls[0]?.[0]).toContain('grant_type=account_credentials');
    expect(fetchMock.mock.calls[1]?.[0]).toBe('https://api.zoom.us/v2/users/host%40example.test/meetings');
    expect(JSON.parse(String(fetchMock.mock.calls[1]?.[1]?.body))).toMatchObject({ type: 2, settings: { waiting_room: true, join_before_host: false } });
  });

  it('fails closed without exposing secret values when configuration is missing', async () => {
    delete process.env.ZOOM_CLIENT_ID;
    await expect(createZoomMeeting({ topic: 'Review', startsAt: '2026-09-10T13:00:00.000Z', durationMinutes: 30, timezone: 'UTC' }))
      .rejects.toMatchObject({ status: 503, retryable: false });
  });

  it('signs the embedded component-view authorization only on the server', () => {
    const result = createZoomMeetingSdkSignature('1234567890', 0);
    const decoded = jwt.verify(result.signature, 'sdk-secret') as jwt.JwtPayload;
    expect(result.sdkKey).toBe('sdk-client');
    expect(decoded).toMatchObject({ appKey: 'sdk-client', mn: '1234567890', role: 0 });
    expect(decoded.exp).toBe(decoded.tokenExp);
  });
});
