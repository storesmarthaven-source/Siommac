/**
 * tabs/SessionsTab.tsx
 *
 * Active session visibility + remote revoke. Lists every logged-in user with
 * their device/browser, IP, and last-seen time. Revoking a session force-logs
 * the user out (their tokens are invalidated) — they must log in again, which
 * requires a fresh 2FA code for mandatory-2FA roles.
 */

import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { confirm } from '@shared/ConfirmDialog';
import type { ActiveSession } from '@lib/superadminApi';
import { useActiveSessions, useRevokeSession } from '../hooks';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

/** Best-effort, dependency-free user-agent → "Browser on OS · Device". */
function describeDevice(ua: string): { label: string; icon: string } {
  if (!ua) return { label: 'Unknown device', icon: 'fa-question-circle' };
  const browser =
    /Edg\//.test(ua) ? 'Edge' :
    /OPR\/|Opera/.test(ua) ? 'Opera' :
    /Chrome\//.test(ua) ? 'Chrome' :
    /Firefox\//.test(ua) ? 'Firefox' :
    /Safari\//.test(ua) ? 'Safari' : 'Browser';
  const os =
    /Windows NT 10/.test(ua) ? 'Windows' :
    /Windows/.test(ua) ? 'Windows' :
    /Mac OS X/.test(ua) ? 'macOS' :
    /Android/.test(ua) ? 'Android' :
    /iPhone|iPad|iOS/.test(ua) ? 'iOS' :
    /Linux/.test(ua) ? 'Linux' : '';
  const mobile = /Mobile|Android|iPhone|iPad/.test(ua);
  return {
    label: os ? `${browser} on ${os}` : browser,
    icon:  mobile ? 'fa-mobile-screen' : 'fa-display',
  };
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

function SessionRow({ s, busy, onRevoke }: { s: ActiveSession; busy: boolean; onRevoke: () => void }): VNode {
  const dev = describeDevice(s.userAgent);
  const initials = (s.fullName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
  return (
    <div style={{ display: 'flex', alignItems: 'center', gap: '14px', padding: '14px 18px', borderBottom: '1px solid var(--border)' }}>
      <div style={{ width: '38px', height: '38px', borderRadius: '50%', flexShrink: 0, background: 'var(--siomac-navy)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '13px', fontWeight: '700', color: '#fff' }}>{initials}</div>
      <div style={{ minWidth: 0, flex: 1 }}>
        <div style={{ fontSize: '14px', fontWeight: '600', color: 'var(--text-primary)' }}>
          {s.fullName}
          <span class="vt-pill is-info" style={{ marginLeft: '8px' }}>{ROLE_LABEL[s.role] ?? s.role}</span>
        </div>
        <div class="stg-switch-desc" style={{ marginTop: '2px', display: 'flex', alignItems: 'center', gap: '10px', flexWrap: 'wrap' }}>
          <span><i class={`fas ${dev.icon}`} style={{ marginRight: '5px' }} />{dev.label}</span>
          {s.ipAddress && <span><i class="fas fa-location-dot" style={{ marginRight: '4px' }} />{s.ipAddress}</span>}
          <span><i class="fas fa-clock" style={{ marginRight: '4px' }} />{relativeTime(s.lastSeenAt)}</span>
        </div>
      </div>
      <button type="button" class="btn btn-sm btn-danger has-label" disabled={busy} onClick={onRevoke} title="Force this user to log out">
        <i class={busy ? 'fas fa-spinner fa-spin' : 'fas fa-right-from-bracket'} /> Revoke
      </button>
    </div>
  );
}

export function SessionsTab(): VNode {
  const sessionsQ = useActiveSessions(true);
  const revoke    = useRevokeSession();
  const [search, setSearch] = useState('');

  const sessions = sessionsQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return sessions.filter(s => !q || s.fullName.toLowerCase().includes(q) || s.username.toLowerCase().includes(q) || (s.ipAddress ?? '').includes(q));
  }, [sessions, search]);

  const stats = useMemo(() => {
    const uniqueUsers = new Set(sessions.map(s => s.userId)).size;
    const mobile = sessions.filter(s => /Mobile|Android|iPhone|iPad/.test(s.userAgent)).length;
    return { active: sessions.length, uniqueUsers, mobile };
  }, [sessions]);

  if (sessionsQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading sessions…</div>;
  if (sessionsQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load sessions. <button type="button" onClick={() => void sessionsQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  const revokingId = revoke.isPending ? revoke.variables : null;

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard icon="fa-user-clock"     label="Active Sessions" value={stats.active}      color="#2563eb" loading={sessionsQ.isLoading} />
        <StatCard icon="fa-users"          label="Unique Users"    value={stats.uniqueUsers} color="#16a34a" loading={sessionsQ.isLoading} />
        <StatCard icon="fa-mobile-screen"  label="Mobile Devices"  value={stats.mobile}      color="#7c3aed" loading={sessionsQ.isLoading} />
      </div>

      <div class="vt-toolbar">
        <div class="vt-search" style={{ maxWidth: '280px' }}>
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search by name or IP…" aria-label="Search sessions" />
        </div>
        <div class="vt-toolbar-spacer" />
        <button type="button" class="btn btn-sm btn-outline-secondary has-label" onClick={() => void sessionsQ.refetch()}>
          <i class={sessionsQ.isFetching ? 'fas fa-spinner fa-spin' : 'fas fa-sync-alt'} /> Refresh
        </button>
      </div>

      {filtered.length === 0 ? (
        <div class="emp-empty"><i class="fas fa-user-clock" /><p>No active sessions.</p></div>
      ) : (
        <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
          {filtered.map(s => (
            <SessionRow
              key={s.userId}
              s={s}
              busy={revokingId === s.userId}
              onRevoke={async () => {
                const ok = await confirm({
                  title: `Revoke ${s.fullName}'s session?`,
                  message: 'They will be signed out immediately and must log in again (including a fresh 2FA code if required).',
                  variant: 'danger',
                  confirmLabel: 'Revoke session',
                });
                if (ok) revoke.mutate(s.userId);
              }}
            />
          ))}
        </div>
      )}

      <div style={{ marginTop: '16px', padding: '12px 16px', background: 'rgba(27,45,84,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <i class="fas fa-info-circle" style={{ marginTop: '1px', flexShrink: 0, color: 'var(--siomac-navy)' }} />
        <span>Sessions reflect users with a valid refresh token. Revoking invalidates their access immediately; the list refreshes every 30 seconds.</span>
      </div>
    </div>
  );
}
