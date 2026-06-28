/**
 * tabs/SessionsTab.tsx
 *
 * Active session visibility + remote revoke (v2 Settings design). Lists every
 * logged-in user with device/browser, IP, and last-seen. Revoking force-logs the
 * user out (tokens invalidated) — they must re-authenticate (with 2FA where required).
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { confirm } from '@shared/ConfirmDialog';
import type { ActiveSession } from '@lib/superadminApi';
import { useActiveSessions, useRevokeSession } from '../hooks';
import { SwzStat } from '@/components/sections/Settings/swzPrimitives';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

/** Best-effort, dependency-free user-agent → "Browser on OS · Device". */
function describeDevice(ua: string): { label: string; icon: string } {
  if (!ua) return { label: 'Unknown device', icon: 'fa-circle-question' };
  const browser =
    /Edg\//.test(ua) ? 'Edge' : /OPR\/|Opera/.test(ua) ? 'Opera' : /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' : /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows/.test(ua) ? 'Windows' : /Mac OS X/.test(ua) ? 'macOS' : /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' : /Linux/.test(ua) ? 'Linux' : '';
  const mobile = /Mobile|Android|iPhone|iPad/.test(ua);
  return { label: os ? `${browser} on ${os}` : browser, icon: mobile ? 'fa-mobile-screen' : 'fa-display' };
}

function relativeTime(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

const initialsOf = (name: string) => (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();

export function SessionsTab(): VNode {
  const sessionsQ = useActiveSessions(true);
  const revoke    = useRevokeSession();
  const [search, setSearch] = useState('');

  const sessions = sessionsQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sessions.filter(s => !q || s.fullName.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || (s.ipAddress ?? '').includes(q));
  }, [sessions, search]);

  const stats = useMemo(() => ({
    active: sessions.length,
    uniqueUsers: new Set(sessions.map(s => s.userId)).size,
    mobile: sessions.filter(s => /Mobile|Android|iPhone|iPad/.test(s.userAgent)).length,
  }), [sessions]);

  if (sessionsQ.isLoading) return <div class="swz-loading"><i class="fas fa-spinner fa-spin" /> Loading sessions…</div>;
  if (sessionsQ.isError)   return <div class="swz-empty"><i class="fas fa-triangle-exclamation" /> Failed to load sessions. <button type="button" class="action-btn sm" style={{ marginTop: '10px' }} onClick={() => void sessionsQ.refetch()}>Retry</button></div>;

  const revokingId = revoke.isPending ? revoke.variables : null;

  return (
    <div>
      <div class="swz-stats">
        <SwzStat ico="fa-user-clock"    color="#2563eb" val={stats.active}      label="Active Sessions" />
        <SwzStat ico="fa-users"         color="#16a34a" val={stats.uniqueUsers} label="Unique Users" />
        <SwzStat ico="fa-mobile-screen" color="#7c3aed" val={stats.mobile}      label="Mobile Devices" />
      </div>

      <div class="swz-toolbar">
        <div class="swz-search">
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search by name or IP…" aria-label="Search sessions" />
        </div>
        <div class="swz-toolbar-spacer" />
        <button type="button" class="action-btn sm" onClick={() => void sessionsQ.refetch()}>
          <i class={sessionsQ.isFetching ? 'fas fa-spinner fa-spin' : 'fas fa-rotate'} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div class="swz-empty"><i class="fas fa-user-clock" /> No active sessions.</div>
      ) : (
        <div class="swz-tablecard">
          <table class="swz-table">
            <thead><tr><th>User</th><th>Device</th><th>IP address</th><th>Last seen</th><th class="center">Action</th></tr></thead>
            <tbody>
              {filtered.map(s => {
                const dev = describeDevice(s.userAgent);
                const busy = revokingId === s.userId;
                return (
                  <tr key={s.userId}>
                    <td>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                        <span class="swz-avatar">{initialsOf(s.fullName)}</span>
                        <div style={{ minWidth: 0 }}><b>{s.fullName}</b> <span class="swz-pill navy">{ROLE_LABEL[s.role] ?? s.role}</span></div>
                      </div>
                    </td>
                    <td><i class={`fas ${dev.icon}`} style={{ marginRight: '6px', color: '#7a8597' }} />{dev.label}</td>
                    <td>{s.ipAddress || '—'}</td>
                    <td>{relativeTime(s.lastSeenAt)}</td>
                    <td class="center">
                      <button type="button" class="action-btn sm danger" disabled={busy} title="Force this user to log out"
                        onClick={async () => {
                          const ok = await confirm({
                            title: `Revoke ${s.fullName}'s session?`,
                            message: 'They will be signed out immediately and must log in again (including a fresh 2FA code if required).',
                            variant: 'danger', confirmLabel: 'Revoke session',
                          });
                          if (ok) revoke.mutate(s.userId);
                        }}>
                        <i class={busy ? 'fas fa-spinner fa-spin' : 'fas fa-right-from-bracket'} /> Revoke
                      </button>
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      )}

      <div class="swz-note">
        <i class="fas fa-circle-info" />
        <span>Sessions reflect users with a valid refresh token. Revoking invalidates their access immediately; the list refreshes every 30 seconds.</span>
      </div>
    </div>
  );
}
