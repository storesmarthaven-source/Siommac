import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  useCalendarConnections,
  useConnectCalendarCredentials,
  useDisconnectCalendarConnection,
  useStartCalendarOAuth,
  useSyncCalendarConnection,
  useToggleExternalCalendar,
  type CalendarConnectionDTO,
  type CalendarProvider,
} from '@api/calendar';
import { Button, FormField, LucideIcon, Switch, TextInput } from '@ui';
import { CalendarProviderMark } from './CalendarProviderMark';

const PROVIDERS: readonly CalendarProvider[] = ['google', 'microsoft', 'apple', 'exchange'];
const PROVIDER_COPY: Record<CalendarProvider, { name: string; short: string; method: string }> = {
  google: { name: 'Google Calendar', short: 'Google', method: 'Google Workspace and Gmail' },
  microsoft: { name: 'Microsoft 365 Calendars', short: 'Microsoft', method: 'Microsoft 365 and Outlook.com' },
  apple: { name: 'Apple Calendar', short: 'Apple', method: 'iCloud and Apple Calendar' },
  exchange: { name: 'Exchange Server Calendars', short: 'Exchange', method: 'Exchange Server 2013 and later' },
};

function requestKey(prefix: string): string {
  return typeof crypto.randomUUID === 'function' ? `${prefix}-${crypto.randomUUID()}` : `${prefix}-${Date.now()}-${Math.random().toString(16).slice(2)}`;
}

function formatSyncDate(value: string | null): string {
  if (!value) return 'Not synced yet';
  const date = new Date(value);
  return Number.isNaN(date.valueOf()) ? 'Sync time unavailable' : `Synced ${new Intl.DateTimeFormat(undefined, { dateStyle: 'medium', timeStyle: 'short' }).format(date)}`;
}

function ConnectionCalendars({ connection }: { connection: CalendarConnectionDTO }): VNode {
  const toggle = useToggleExternalCalendar();
  const [error, setError] = useState<string | null>(null);
  const change = async (externalCalendarId: string, enabled: boolean): Promise<void> => {
    setError(null);
    try {
      const response = await toggle.mutateAsync({ externalCalendarId, enabled, idempotencyKey: requestKey('calendar-toggle') });
      if (!response.success) setError(response.message ?? 'The calendar could not be updated.');
      else if (response.syncWarning) setError(response.syncWarning);
    } catch (cause) {
      setError(cause instanceof Error ? cause.message : 'The calendar could not be updated.');
    }
  };
  return (
    <div class="cal-connection-calendars">
      <div class="cal-connection-calendars-head"><span>Calendars to import</span><small>Imported calendars are read-only in SIOMAC.</small></div>
      {error ? <div class="cal-connection-inline-error" role="alert"><LucideIcon name="TriangleAlert" size={15} />{error}</div> : null}
      <div class="cal-connection-calendar-list">
        {connection.calendars.map(calendar => (
          <div class="cal-connection-calendar-row" key={calendar.id}>
            <span class="cal-connection-calendar-dot" style={{ background: calendar.providerColor ?? undefined }} />
            <span class="cal-connection-calendar-copy"><strong>{calendar.name}</strong><small>{[calendar.isPrimary ? 'Primary' : null, calendar.timeZone].filter(Boolean).join(' · ') || 'Provider calendar'}</small></span>
            <Switch size="sm" checked={calendar.enabled} pending={toggle.isPending} onChange={enabled => void change(calendar.id, enabled)} aria-label={`${calendar.enabled ? 'Stop importing' : 'Import'} ${calendar.name}`} />
          </div>
        ))}
      </div>
    </div>
  );
}

export function CalendarConnectionsPanel({
  enabled = true,
}: {
  enabled?: boolean;
}): VNode {
  const query = useCalendarConnections(enabled);
  const oauth = useStartCalendarOAuth();
  const credentials = useConnectCalendarCredentials();
  const sync = useSyncCalendarConnection();
  const disconnect = useDisconnectCalendarConnection();
  const [expandedProvider, setExpandedProvider] = useState<CalendarProvider | null>(null);
  const [credentialsProvider, setCredentialsProvider] = useState<'apple' | 'exchange' | null>(null);
  const [username, setUsername] = useState('');
  const [password, setPassword] = useState('');
  const [serverUrl, setServerUrl] = useState('');
  const [credentialRequestKey, setCredentialRequestKey] = useState(() => requestKey('calendar-connect'));
  const [confirmDisconnect, setConfirmDisconnect] = useState<string | null>(null);
  const [error, setError] = useState<string | null>(null);
  const connectionsByProvider = useMemo(() => new Map(PROVIDERS.map(provider => [provider, (query.data?.connections ?? []).filter(connection => connection.provider === provider)])), [query.data?.connections]);

  const beginOAuth = async (provider: 'google' | 'microsoft'): Promise<void> => {
    setError(null);
    try {
      const response = await oauth.mutateAsync(provider);
      if (!response.success || !response.authorizationUrl) { setError(response.message ?? `${PROVIDER_COPY[provider].name} could not be opened.`); return; }
      window.location.assign(response.authorizationUrl);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The provider could not be opened.'); }
  };

  const connectCredentials = async (): Promise<void> => {
    if (!credentialsProvider || !username.trim() || !password || (credentialsProvider === 'exchange' && !serverUrl.trim())) return;
    setError(null);
    try {
      const response = await credentials.mutateAsync({ provider: credentialsProvider, username: username.trim(), password, ...(credentialsProvider === 'exchange' ? { serverUrl: serverUrl.trim() } : {}), idempotencyKey: credentialRequestKey });
      if (!response.success) { setError(response.message ?? 'The calendar account could not be connected.'); return; }
      setPassword(''); setUsername(''); setServerUrl(''); setCredentialsProvider(null); setExpandedProvider(credentialsProvider);
      if (response.syncWarning) setError(response.syncWarning);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The calendar account could not be connected.'); }
  };

  const syncNow = async (connectionId: string): Promise<void> => {
    setError(null);
    try {
      const response = await sync.mutateAsync({ connectionId });
      if (!response.success) setError(response.message ?? 'The calendar could not be synced.');
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The calendar could not be synced.'); }
  };

  const removeConnection = async (connectionId: string): Promise<void> => {
    if (confirmDisconnect !== connectionId) { setConfirmDisconnect(connectionId); return; }
    setError(null);
    try {
      const response = await disconnect.mutateAsync({ connectionId, idempotencyKey: requestKey('calendar-disconnect') });
      if (!response.success) { setError(response.message ?? 'The calendar account could not be disconnected.'); return; }
      setConfirmDisconnect(null);
    } catch (cause) { setError(cause instanceof Error ? cause.message : 'The calendar account could not be disconnected.'); }
  };

  const addProviderAccount = (provider: CalendarProvider): void => {
    if (provider === 'google' || provider === 'microsoft') { void beginOAuth(provider); return; }
    setCredentialsProvider(provider);
    setCredentialRequestKey(requestKey('calendar-connect'));
  };

  const renderProvider = (provider: CalendarProvider): VNode => {
    const meta = PROVIDER_COPY[provider];
    const availability = query.data?.providers.find(item => item.provider === provider);
    const providerConnections = connectionsByProvider.get(provider) ?? [];
    const active = providerConnections[0] ?? null;
    const needsAttention = providerConnections.some(connection => connection.status === 'error');
    const expanded = expandedProvider === provider && Boolean(active);
    const busy = oauth.isPending || credentials.isPending || sync.isPending || disconnect.isPending;
    return (
      <section class={`cal-provider-option is-${provider}${active ? ' is-connected' : ''}`} key={provider}>
        <div class="cal-provider-option-main">
          <CalendarProviderMark provider={provider} />
          <div class="cal-provider-option-copy">
            <div><h3>{meta.name}</h3>{active ? <span class={`cal-provider-status${needsAttention ? ' is-error' : ''}`}><i />{needsAttention ? 'Needs attention' : 'Connected'}</span> : null}</div>
            <p>{active ? (providerConnections.length > 1 ? `${providerConnections.length} accounts connected` : active.accountEmail ?? active.displayName) : meta.method}</p>
            {active ? <small>{providerConnections.length > 1 ? `${providerConnections.reduce((total, connection) => total + connection.calendars.filter(calendar => calendar.enabled).length, 0)} calendars in My Calendars` : formatSyncDate(active.lastSyncedAt)}</small> : !availability?.configured ? <small class="is-unavailable">{availability?.configurationMessage ?? 'Provider configuration is unavailable.'}</small> : null}
          </div>
          {active ? <Button variant="ghost" size="sm" onClick={() => setExpandedProvider(expanded ? null : provider)} aria-expanded={expanded}>{expanded ? 'Close' : 'Manage'}</Button>
            : <Button class="cal-provider-connect" variant="ghost" size="sm" iconOnly aria-label={`Connect ${meta.name}`} title={availability?.configured ? `Connect ${meta.name}` : `${meta.name} is unavailable`} disabled={!availability?.configured || busy} iconLeft={<LucideIcon name="Plus" size={21} />} onClick={() => addProviderAccount(provider)} />}
        </div>
        {expanded && active ? <div class="cal-provider-option-details">
          {providerConnections.map(connection => <section class="cal-provider-account" key={connection.id}>
            <div class="cal-provider-account-head"><span><strong>{connection.accountEmail ?? connection.displayName}</strong><small>{formatSyncDate(connection.lastSyncedAt)}</small></span>{providerConnections.length > 1 ? <span class={`cal-provider-status is-${connection.status}`}><i />{connection.status === 'active' ? 'Connected' : 'Attention'}</span> : null}</div>
            {connection.status === 'error' && connection.lastErrorMessage ? <div class="cal-provider-sync-alert"><LucideIcon name="TriangleAlert" size={15} /><span>{connection.lastErrorMessage}</span></div> : null}
            <ConnectionCalendars connection={connection} />
            <div class="cal-provider-actions">
              <Button size="sm" variant="secondary" loading={sync.isPending} loadingText="Syncing…" iconLeft={<LucideIcon name="RefreshCw" size={14} />} onClick={() => void syncNow(connection.id)}>Sync now</Button>
              <Button size="sm" variant="ghost" tone="danger" disabled={busy} onClick={() => void removeConnection(connection.id)}>{confirmDisconnect === connection.id ? 'Confirm disconnect' : 'Disconnect'}</Button>
            </div>
          </section>)}
          <Button class="cal-provider-add-account" variant="ghost" size="sm" disabled={!availability?.configured || busy} iconLeft={<LucideIcon name="Plus" size={13} />} onClick={() => addProviderAccount(provider)}>Connect another account</Button>
        </div> : null}
      </section>
    );
  };

  if (!enabled) return (
    <div class="cal-connections-unavailable">
      <LucideIcon name="CloudOff" size={22} />
      <div><strong>Connected calendars use live data</strong><span>Turn off staged preview to connect or manage an external account.</span></div>
    </div>
  );

  return (
    <div class="cal-connections-panel">
      {error ? <div class="cal-connection-error" role="alert"><LucideIcon name="CircleAlert" size={16} /><span>{error}</span><button type="button" onClick={() => setError(null)} aria-label="Dismiss error"><LucideIcon name="X" size={14} /></button></div> : null}
      {query.isLoading ? <div class="cal-connections-loading"><span class="ui-ctrl-spinner" />Loading calendar providers…</div> : query.isError ? (
        <div class="cal-connections-unavailable"><LucideIcon name="CloudAlert" size={22} /><div><strong>Connections could not be loaded</strong><span>{query.error instanceof Error ? query.error.message : 'Try again.'}</span></div><Button size="sm" variant="secondary" onClick={() => void query.refetch()}>Try again</Button></div>
      ) : <div class="cal-provider-directory">
        {PROVIDERS.map(renderProvider)}
      </div>}

      {credentialsProvider ? <section class="cal-provider-credentials" aria-label={`Connect ${PROVIDER_COPY[credentialsProvider].name}`}>
        <div class="cal-provider-credentials-head"><CalendarProviderMark provider={credentialsProvider} /><div><strong>Connect {PROVIDER_COPY[credentialsProvider].name}</strong><span>{credentialsProvider === 'apple' ? 'Use your Apple ID and an app-specific password—not your normal Apple ID password.' : 'Use the HTTPS URL for your organisation’s Exchange Web Services endpoint.'}</span></div><Button variant="ghost" iconOnly aria-label="Close credentials form" iconLeft={<LucideIcon name="X" size={16} />} onClick={() => { setCredentialsProvider(null); setPassword(''); }} /></div>
        <div class={`cal-provider-credentials-fields${credentialsProvider === 'exchange' ? ' has-server' : ''}`}>
          <FormField label={credentialsProvider === 'apple' ? 'Apple ID' : 'Username'} required><TextInput value={username} onInput={setUsername} autoComplete="username" placeholder={credentialsProvider === 'apple' ? 'name@icloud.com' : 'DOMAIN\\username'} /></FormField>
          {credentialsProvider === 'exchange' ? <FormField label="EWS URL" required><TextInput type="url" value={serverUrl} onInput={setServerUrl} placeholder="https://mail.company.com/EWS/Exchange.asmx" /></FormField> : null}
          <FormField label="Password" required><TextInput type="password" value={password} onInput={setPassword} autoComplete="current-password" placeholder={credentialsProvider === 'apple' ? 'xxxx-xxxx-xxxx-xxxx' : 'Enter password'} /></FormField>
        </div>
        <div class="cal-provider-credentials-foot"><span><LucideIcon name="LockKeyhole" size={13} />Credentials are encrypted before storage.</span><Button variant="primary" size="sm" loading={credentials.isPending} loadingText="Connecting…" disabled={!username.trim() || !password || (credentialsProvider === 'exchange' && !serverUrl.trim())} onClick={() => void connectCredentials()}>Connect account</Button></div>
      </section> : null}
    </div>
  );
}
