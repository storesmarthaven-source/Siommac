/**
 * src/components/sections/AccessControl/pages/AcSessionsPage.tsx
 *
 * Access Control — Sessions. Live view of who is logged in and from which device,
 * in the `.acx` design system. Revoking a session signs the user out immediately
 * (they must re-authenticate, incl. 2FA). Wired to useActiveSessions / useRevokeSession.
 */

import { type VNode } from 'preact';
import { useActiveSessions, useRevokeSession } from '@sections/SuperadminConsole/hooks';
import { useSessionStore } from '@store/session';
import { dialog } from '@lib/dialog';

const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); if (s < 60) return 'just now'; if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };

function device(ua: string): { icon: string; label: string } {
  const u = (ua || '').toLowerCase();
  const os = u.includes('windows') ? 'Windows' : u.includes('mac') ? 'macOS' : u.includes('android') ? 'Android' : u.includes('iphone') || u.includes('ipad') ? 'iOS' : u.includes('linux') ? 'Linux' : 'Unknown';
  const br = u.includes('edg') ? 'Edge' : u.includes('chrome') ? 'Chrome' : u.includes('firefox') ? 'Firefox' : u.includes('safari') ? 'Safari' : 'Browser';
  const icon = os === 'Android' || os === 'iOS' ? 'fa-mobile-screen' : 'fa-display';
  return { icon, label: `${br} · ${os}` };
}

export function AcSessionsPage(): VNode {
  const meId = useSessionStore(s => s.userId);
  const q = useActiveSessions(true);
  const revoke = useRevokeSession();
  const rows = q.data ?? [];

  const doRevoke = async (userId: string, name: string) => {
    const ok = await dialog.confirm({ title: 'Revoke session', text: `Sign ${name} out of all devices? They must re-authenticate (including 2FA).`, confirmText: 'Revoke', danger: true });
    if (ok) revoke.mutate(userId);
  };

  return (
    <div class="acx">
      <div class="page-head"><h1 class="page-title">Sessions</h1><p class="page-sub">See who is logged in and from which device. Revoking a session signs the user out immediately.</p></div>

      <div class="stats" style={{ gridTemplateColumns: 'repeat(3,1fr)' }}>
        <div class="stat"><div class="stat-top"><span class="stat-ico green"><i class="fas fa-user-clock" /></span><div><div class="stat-lbl">Active Sessions</div><div class="stat-val">{q.isLoading ? '—' : rows.length}</div></div></div></div>
        <div class="stat"><div class="stat-top"><span class="stat-ico blue"><i class="fas fa-users" /></span><div><div class="stat-lbl">Distinct Users</div><div class="stat-val">{new Set(rows.map(r => r.userId)).size}</div></div></div></div>
        <div class="stat"><div class="stat-top"><span class="stat-ico purple"><i class="fas fa-mobile-screen" /></span><div><div class="stat-lbl">Refreshes every</div><div class="stat-val" style={{ fontSize: '18px', marginTop: '6px' }}>30s</div></div></div></div>
      </div>

      <div class="card" style={{ overflow: 'hidden' }}>
        <div class="card-head"><div class="card-title">Active sessions</div></div>
        {q.isLoading && !q.data ? <div class="ac-loading">Loading…</div>
         : rows.length === 0 ? <div class="ac-empty">No active sessions.</div>
         : (
          <table class="tbl">
            <thead><tr><th>User</th><th>Role</th><th>Device</th><th>IP address</th><th>Last seen</th><th style={{ textAlign: 'right' }}>Action</th></tr></thead>
            <tbody>
              {rows.map(s => {
                const d = device(s.userAgent); const isMe = s.userId === meId;
                return (
                  <tr key={s.userId + s.createdAt}>
                    <td><span class="row" style={{ gap: '10px' }}><span class="avatar" style={{ width: '34px', height: '34px', fontSize: '12px', background: 'var(--accent)' }}>{initials(s.fullName)}</span><span><div style={{ fontWeight: 600 }}>{s.fullName}{isMe && <span class="muted"> (you)</span>}</div><div class="sub">{s.username}</div></span></span></td>
                    <td><span class="badge grey">{s.role}</span></td>
                    <td class="muted"><i class={`fas ${d.icon}`} style={{ marginRight: '7px', color: 'var(--faint)' }} />{d.label}</td>
                    <td class="sub mono">{s.ipAddress || '—'}</td>
                    <td class="sub">{ago(s.lastSeenAt)}</td>
                    <td style={{ textAlign: 'right' }}>
                      {isMe ? <span class="sub">current</span> : <button class="btn sm danger" disabled={revoke.isPending} onClick={() => doRevoke(s.userId, s.fullName)}>Revoke</button>}
                    </td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        )}
      </div>
    </div>
  );
}
