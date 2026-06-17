/**
 * tabs/PermissionsTab.tsx
 *
 * Per-user RBAC grant matrix. Superadmin picks a user, then sees every
 * capability (PERMISSION_KEYS, grouped by resource) as a tri-state cell:
 *
 *   Default → inherits the user's role default (no override row)
 *   Grant   → explicit allow  (user_permissions.granted = true)
 *   Deny    → explicit deny    (user_permissions.granted = false)
 *
 * Clicking a cell cycles Default → Grant → Deny → Default, writing/clearing the
 * override via the backend (which is the real security boundary — see C2).
 *
 * The matrix is driven by the permission catalogue + resolver helpers, so it is
 * ready for roles-as-data (task F) without UI changes.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import {
  permissionGroups, roleDefaultGranted, permissionState,
  type PermissionState,
} from '@lib/permissions';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';
import type { ConsoleUser, UserPermissionRow } from '@lib/superadminApi';
import {
  useConsoleUsers, useUserPermissions, useSetUserPermission, useClearUserPermission,
  useRolePermissions,
} from '../hooks';

const ROLE_LABEL: Record<string, string> = {
  admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

const RESOURCE_LABEL: Record<string, string> = {
  employees: 'Employees', departments: 'Departments', attendance: 'Attendance',
  leaves: 'Leave', payroll: 'Payroll', hourly_rates: 'Hourly Rates',
  sites: 'Project Sites', map: 'Live Map', dashboard: 'Dashboard',
  reports: 'Reports', settings: 'Settings', permissions: 'User Management',
};

/** Convert override rows → the PermissionOverride[] shape the resolver expects. */
function toOverrides(userId: string, rows: UserPermissionRow[]): PermissionOverride[] {
  return rows.map(r => ({ user_id: userId, permission: r.permission, granted: r.granted, set_by: '', set_at: '' }));
}

// ── Tri-state cell ────────────────────────────────────────────────────────────

function StateCell({ state, roleDefault, busy, onCycle }: {
  state: PermissionState; roleDefault: boolean; busy: boolean; onCycle: () => void;
}): VNode {
  // Effective value shown for the 'default' state.
  const effective = state === 'default' ? roleDefault : state === 'grant';
  const cfg = {
    default: { label: roleDefault ? 'Default ✓' : 'Default ✕', bg: 'var(--bg-subtle)', color: 'var(--text-muted)', border: 'var(--border)' },
    grant:   { label: 'Grant',  bg: 'rgba(46,125,50,0.12)', color: '#1b5e20',           border: 'rgba(46,125,50,0.4)' },
    deny:    { label: 'Deny',   bg: 'rgba(228,12,12,0.10)', color: 'var(--siomac-red)', border: 'rgba(228,12,12,0.4)' },
  }[state];
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={busy}
      title={state === 'default' ? `Role default: ${roleDefault ? 'allowed' : 'denied'} — click to override` : `Explicit ${state} — click to change`}
      aria-label={`${state}${state === 'default' ? (effective ? ' (allowed)' : ' (denied)') : ''}`}
      style={{
        minWidth: '78px', padding: '4px 10px', borderRadius: '40px', cursor: busy ? 'wait' : 'pointer',
        fontSize: '11.5px', fontWeight: '600', background: cfg.bg, color: cfg.color,
        border: `1px solid ${cfg.border}`, opacity: busy ? 0.6 : 1, transition: 'all .12s',
      }}
    >
      {busy ? <i class="fas fa-spinner fa-spin" /> : cfg.label}
    </button>
  );
}

// ── Matrix for one user ───────────────────────────────────────────────────────

function UserMatrix({ user }: { user: ConsoleUser }): VNode {
  const permsQ    = useUserPermissions(user.id);
  const roleQ     = useRolePermissions(user.role);
  const setPerm   = useSetUserPermission();
  const clearPerm = useClearUserPermission();
  const groups    = useMemo(() => permissionGroups(), []);
  const role      = user.role as UserRole;

  if (permsQ.isLoading || roleQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading permissions…</div>;
  if (permsQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load permissions.</div>;

  const roleSet   = roleQ.data ?? [];
  const overrides = toOverrides(user.id, permsQ.data ?? []);
  const pendingKey = (setPerm.isPending && setPerm.variables?.permission)
    || (clearPerm.isPending && clearPerm.variables?.permission) || null;

  // Default → Grant → Deny → Default
  function cycle(key: string, cur: PermissionState) {
    if (cur === 'default')    setPerm.mutate({ userId: user.id, permission: key, granted: true });
    else if (cur === 'grant') setPerm.mutate({ userId: user.id, permission: key, granted: false });
    else                      clearPerm.mutate({ userId: user.id, permission: key });
  }

  return (
    <div>
      <div class="stg-switch-group" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', marginBottom: '12px' }}>
        <div>
          <div class="stg-switch-label">{user.fullName} <span style={{ marginLeft: '8px', fontSize: '11px', background: 'rgba(27,45,84,0.08)', color: 'var(--siomac-navy)', padding: '2px 8px', borderRadius: '10px', fontWeight: '600' }}>{ROLE_LABEL[user.role] ?? user.role}</span></div>
          <div class="stg-switch-desc">@{user.username} — cells show the role default unless explicitly overridden.</div>
        </div>
      </div>

      {groups.map(group => (
        <div key={group.resource} style={{ marginBottom: '18px' }}>
          <div class="stg-switch-desc" style={{ fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', color: 'var(--siomac-navy)' }}>
            {RESOURCE_LABEL[group.resource] ?? group.resource}
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {group.keys.map((key, idx) => {
              const st  = permissionState(key, overrides);
              const def = roleDefaultGranted(roleSet, key, role);
              const action = (key.split('.')[1] ?? key).replace(/_/g, ' ');
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: idx < group.keys.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{action}</div>
                    <div class="stg-switch-desc" style={{ marginTop: 0, fontFamily: 'monospace', fontSize: '11px' }}>{key}</div>
                  </div>
                  <StateCell state={st} roleDefault={def} busy={pendingKey === key} onCycle={() => cycle(key, st)} />
                </div>
              );
            })}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export function PermissionsTab(): VNode {
  const usersQ = useConsoleUsers(true);
  const [search, setSearch] = useState('');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const users = usersQ.data ?? [];
  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter(u => !q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q));
  }, [users, search]);
  const selected = users.find(u => u.id === selectedId) ?? null;

  if (usersQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading users…</div>;
  if (usersQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load users. <button type="button" onClick={() => void usersQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  return (
    <div style={{ display: 'flex', gap: '16px', minHeight: '420px' }}>
      {/* User list */}
      <div style={{ width: '240px', flexShrink: 0, background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', display: 'flex', flexDirection: 'column' }}>
        <div style={{ padding: '10px 12px', borderBottom: '1px solid var(--border)', background: 'var(--bg-subtle)' }}>
          <div class="emp-search-box" style={{ margin: 0 }}>
            <i class="fas fa-search" aria-hidden="true" />
            <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search users…" aria-label="Search users" />
          </div>
        </div>
        <div style={{ overflowY: 'auto', flex: 1 }}>
          {filtered.length === 0 ? (
            <div class="stg-switch-desc" style={{ padding: '16px', textAlign: 'center' }}>No users match.</div>
          ) : filtered.map(u => {
            const isSel = u.id === selectedId;
            const initials = (u.fullName || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
            return (
              <button key={u.id} type="button" onClick={() => setSelectedId(u.id)} style={{ width: '100%', textAlign: 'left', padding: '11px 12px', background: isSel ? 'rgba(27,45,84,0.06)' : 'transparent', borderBottom: '1px solid var(--border)', border: 'none', borderLeft: isSel ? '3px solid var(--siomac-navy)' : '3px solid transparent', cursor: 'pointer', display: 'flex', alignItems: 'center', gap: '10px' }}>
                <div style={{ width: '30px', height: '30px', borderRadius: '50%', flexShrink: 0, background: isSel ? 'var(--siomac-navy)' : 'var(--border)', display: 'flex', alignItems: 'center', justifyContent: 'center', fontSize: '11px', fontWeight: '700', color: isSel ? '#fff' : 'var(--text-muted)' }}>{initials}</div>
                <div style={{ minWidth: 0 }}>
                  <div style={{ fontSize: '13px', fontWeight: isSel ? '700' : '500', color: isSel ? 'var(--siomac-navy)' : 'var(--text-primary)', overflow: 'hidden', textOverflow: 'ellipsis', whiteSpace: 'nowrap' }}>{u.fullName}</div>
                  <div class="stg-switch-desc" style={{ marginTop: 0, textTransform: 'capitalize' }}>{ROLE_LABEL[u.role] ?? u.role}</div>
                </div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Matrix */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {!selected
          ? <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)', fontSize: '14px' }}>Select a user to manage their permissions</div>
          : <UserMatrix key={selected.id} user={selected} />}
      </div>
    </div>
  );
}
