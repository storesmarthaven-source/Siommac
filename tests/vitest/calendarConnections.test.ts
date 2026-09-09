import { afterEach, describe, expect, it, vi } from 'vitest';

const ORIGINAL_ENV = { ...process.env };

async function loadProviderModule(env: Record<string, string>) {
  vi.resetModules();
  process.env = { ...ORIGINAL_ENV, ...env };
  return import('../../netlify/functions/lib/calendarConnections');
}

describe('calendar connection provider security', () => {
  afterEach(() => { process.env = { ...ORIGINAL_ENV }; vi.restoreAllMocks(); });

  it('encrypts provider credentials with a versioned authenticated envelope', async () => {
    const provider = await loadProviderModule({ CALENDAR_CONNECTION_ENCRYPTION_KEY: 'ab'.repeat(32) });
    const stored = provider.encryptCalendarCredentials({ kind: 'password', username: 'pat@example.com', password: 'secret-value', serverUrl: 'https://calendar.example.com/' });
    expect(stored).toMatch(/^v1:/);
    expect(stored).not.toContain('secret-value');
    expect(provider.decryptCalendarCredentials(stored)).toEqual({ kind: 'password', username: 'pat@example.com', password: 'secret-value', serverUrl: 'https://calendar.example.com/' });
    const parts = stored.split(':');
    parts[3] = `${parts[3]![0] === 'A' ? 'B' : 'A'}${parts[3]!.slice(1)}`;
    expect(() => provider.decryptCalendarCredentials(parts.join(':'))).toThrow('Stored calendar credentials could not be decrypted.');
  });

  it('exposes provider availability without leaking configuration and requests read-only OAuth scopes', async () => {
    const provider = await loadProviderModule({
      CALENDAR_CONNECTION_ENCRYPTION_KEY: 'cd'.repeat(32),
      GOOGLE_CALENDAR_CLIENT_ID: 'google-client',
      GOOGLE_CALENDAR_CLIENT_SECRET: 'google-secret',
      MICROSOFT_CALENDAR_CLIENT_ID: 'microsoft-client',
      MICROSOFT_CALENDAR_CLIENT_SECRET: 'microsoft-secret',
    });
    expect(provider.providerAvailability('google')).toEqual({ configured: true, connectionMethod: 'oauth', configurationMessage: null });
    const google = new URL(provider.buildOAuthUrl('google', 'state-token', 'pkce-challenge', 'https://siomac.example/calendar/oauth/callback'));
    expect(google.searchParams.get('scope')).toContain('calendar.readonly');
    expect(google.searchParams.get('scope')).not.toContain('calendar.events');
    expect(google.searchParams.get('code_challenge_method')).toBe('S256');
    const microsoft = new URL(provider.buildOAuthUrl('microsoft', 'state-token', 'pkce-challenge', 'https://siomac.example/calendar/oauth/callback'));
    expect(microsoft.searchParams.get('scope')).toContain('Calendars.Read');
    expect(microsoft.searchParams.get('scope')).not.toContain('Calendars.ReadWrite');
  });
});
