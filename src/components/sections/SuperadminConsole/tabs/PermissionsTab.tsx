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
import { useState, useMemo, useEffect, useRef } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { Modal } from '@shared/Modal';
import {
  permissionGroups, roleDefaultGranted, permissionState,
  type PermissionState,
} from '@lib/permissions';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';
import type { ConsoleUser, UserPermissionRow } from '@lib/superadminApi';
import {
  useConsoleUsers, useUserPermissions, useSetUserPermission, useClearUserPermission,
  useRolePermissions, useRoles,
} from '../hooks';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', employee: 'Employee',
};

type SortKey = 'name' | 'role' | 'status';

function initialsOf(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

/** Avatar: shows the profile photo if present, else initials. */
function Avatar({ name, src, cls }: { name: string; src: string; cls: string }): VNode {
  if (src) return <span class={cls}><img src={src} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /></span>;
  return <span class={cls}>{initialsOf(name)}</span>;
}

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

// ── Role-summary card ─────────────────────────────────────────────────────────

function RoleSummaryCard({ label, isSystem, members, onSeeAll, onManage }: {
  label: string; isSystem: boolean; members: ConsoleUser[];
  onSeeAll: () => void; onManage: () => void;
}): VNode {
  const top = members.slice(0, 3);
  return (
    <div class="vt-rolecard">
      <div class="vt-rolecard-head">
        <span class="vt-rolecard-title">
          {label}
          {isSystem && <span class="vt-rolecard-sys">system</span>}
        </span>
        <button type="button" class="vt-rolecard-seeall" onClick={onSeeAll}>See All</button>
      </div>
      <div class="vt-rolecard-members">
        {top.length === 0
          ? <div class="vt-rolecard-empty">No users with this role.</div>
          : top.map(m => (
            <div class="vt-member" key={m.id}>
              <Avatar name={m.fullName} src={m.profileImage} cls="vt-member-avatar" />
              <span class="vt-member-info">
                <span class="vt-member-name">{m.fullName}</span>
                {m.position && <span class="vt-member-email">{m.position}</span>}
              </span>
              <span class={`vt-pill ${m.active ? 'is-on' : 'is-off'}`}>{m.active ? 'Enabled' : 'Disabled'}</span>
            </div>
          ))}
      </div>
      <button type="button" class="vt-rolecard-manage" onClick={onManage}>
        <i class="fas fa-gear" /> Manage
      </button>
    </div>
  );
}

// ── Row actions menu ──────────────────────────────────────────────────────────

function RowMenu({ onManage }: { onManage: () => void }): VNode {
  const [open, setOpen] = useState(false);
  const ref = useRef<HTMLDivElement>(null);
  useEffect(() => {
    if (!open) return;
    function onDoc(e: MouseEvent) { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); }
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);
  return (
    <div class="vt-row-actions" ref={ref}>
      <button type="button" class="vt-row-actions-btn" aria-label="Row actions" onClick={() => setOpen(o => !o)}><i class="fas fa-ellipsis-vertical" /></button>
      {open && (
        <div class="vt-row-menu">
          <div class="vt-row-menu-label">Actions</div>
          <button type="button" onClick={() => { setOpen(false); onManage(); }}><i class="fas fa-user-lock" /> Manage permissions</button>
        </div>
      )}
    </div>
  );
}

// ── Tab root (VANTUS Administrators layout) ───────────────────────────────────

export function PermissionsTab(): VNode {
  const usersQ = useConsoleUsers(true);
  const rolesQ = useRoles(true);
  const [search, setSearch]     = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');
  const [sortBy, setSortBy]     = useState<SortKey>('name');
  const [manageUser, setManageUser] = useState<ConsoleUser | null>(null);

  const users = usersQ.data ?? [];
  const roles = rolesQ.data ?? [];

  // Users grouped by role (for the summary cards), in role sort order.
  const byRole = useMemo(() => {
    const m = new Map<string, ConsoleUser[]>();
    for (const u of users) (m.get(u.role) ?? m.set(u.role, []).get(u.role)!).push(u);
    return m;
  }, [users]);

  // Roles that actually have members, ordered by the roles table (fallback: name).
  const summaryRoles = useMemo(() => {
    const present = [...byRole.keys()];
    const known = roles.filter(r => r.name !== 'superadmin' && present.includes(r.name))
      .map(r => ({ name: r.name, label: r.label, isSystem: r.isSystem }));
    const knownNames = new Set(known.map(r => r.name));
    const extra = present.filter(n => !knownNames.has(n)).map(n => ({ name: n, label: ROLE_LABEL[n] ?? n, isSystem: false }));
    return [...known, ...extra];
  }, [byRole, roles]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    const rows = users.filter(u =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (!q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || u.email.toLowerCase().includes(q)));
    const cmp: Record<SortKey, (a: ConsoleUser, b: ConsoleUser) => number> = {
      name:   (a, b) => a.fullName.localeCompare(b.fullName),
      role:   (a, b) => a.role.localeCompare(b.role) || a.fullName.localeCompare(b.fullName),
      status: (a, b) => Number(b.active) - Number(a.active) || a.fullName.localeCompare(b.fullName),
    };
    return [...rows].sort(cmp[sortBy]);
  }, [users, search, roleFilter, sortBy]);

  const stats = useMemo(() => ({
    total:     users.length,
    enabled:   users.filter(u => u.active).length,
    overrides: users.filter(u => u.overrideCount > 0).length,
    roles:     summaryRoles.length,
  }), [users, summaryRoles]);

  if (usersQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading users…</div>;
  if (usersQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load users. <button type="button" onClick={() => void usersQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  return (
    <div>
      {/* Stat cards */}
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard icon="fa-users"          label="Total Accounts" value={stats.total}     color="#2563eb" loading={usersQ.isLoading} />
        <StatCard icon="fa-user-check"     label="Enabled"        value={stats.enabled}   color="#16a34a" loading={usersQ.isLoading} />
        <StatCard icon="fa-user-lock"      label="With Overrides" value={stats.overrides} color="#d97706" loading={usersQ.isLoading} />
        <StatCard icon="fa-user-shield"    label="Roles in Use"   value={stats.roles}     color="#7c3aed" loading={usersQ.isLoading} />
      </div>

      {/* Role-summary cards */}
      <div class="vt-section">
        <div class="vt-section-head">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-user-shield" /></span>
            <div>
              <div class="vt-section-title">Accounts by role</div>
              <div class="vt-section-sub">Access is based on role. Each role unlocks specific sections and permissions; per-user overrides take priority.</div>
            </div>
          </div>
        </div>
        <div class="vt-rolecards">
          {summaryRoles.map(r => (
            <RoleSummaryCard
              key={r.name}
              label={r.label}
              isSystem={r.isSystem}
              members={byRole.get(r.name) ?? []}
              onSeeAll={() => { setRoleFilter(r.name); }}
              onManage={() => { setRoleFilter(r.name); }}
            />
          ))}
        </div>
      </div>

      {/* Accounts table */}
      <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
        <span class="vt-section-icon"><i class="fas fa-users-gear" /></span>
        <div>
          <div class="vt-section-title">User accounts</div>
          <div class="vt-section-sub">Manage each user's effective permissions.</div>
        </div>
      </div>

      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 260px' }}>
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search by name, username or email…" aria-label="Search users" />
        </div>
        <label class="vt-chip" style={{ cursor: 'default' }}>
          <i class="fas fa-arrow-down-short-wide vt-chip-icon" />
          <select
            value={sortBy}
            onChange={e => setSortBy((e.target as HTMLSelectElement).value as SortKey)}
            aria-label="Sort accounts"
            style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', outline: 'none' }}
          >
            <option value="name">Sort by: Name</option>
            <option value="role">Sort by: Role</option>
            <option value="status">Sort by: Status</option>
          </select>
        </label>
      </div>

      {/* Tab-count filters */}
      <div class="vt-tabs">
        <button type="button" class={`vt-tab${roleFilter === 'all' ? ' active' : ''}`} onClick={() => setRoleFilter('all')}>
          All <span class="vt-tab-count">{users.length}</span>
        </button>
        {summaryRoles.map(r => (
          <button key={r.name} type="button" class={`vt-tab${roleFilter === r.name ? ' active' : ''}`} onClick={() => setRoleFilter(r.name)}>
            {r.label} <span class="vt-tab-count">{byRole.get(r.name)?.length ?? 0}</span>
          </button>
        ))}
      </div>

      <div class="vt-result-count">Showing {filtered.length} of {users.length} account{users.length === 1 ? '' : 's'}</div>

      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th>Account</th><th>Email Address</th><th>Role</th><th>Access</th><th>Status</th><th aria-label="Actions" />
              </tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colspan={6} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No accounts match.</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id}>
                  <td>
                    <span class="vt-cell-account">
                      <Avatar name={u.fullName} src={u.profileImage} cls="vt-cell-avatar" />
                      <span class="vt-cell-account-text">
                        <span class="vt-cell-name">{u.fullName}</span>
                        {u.position && <span class="vt-cell-subtext">{u.position}</span>}
                      </span>
                    </span>
                  </td>
                  <td style={{ color: 'var(--text-muted)' }}>{u.email || '—'}</td>
                  <td style={{ textTransform: 'capitalize' }}>{ROLE_LABEL[u.role] ?? u.role}</td>
                  <td>{u.access}{u.overrideCount > 0 ? <span class="vt-cell-mono" style={{ marginLeft: '6px' }}>({u.overrideCount})</span> : null}</td>
                  <td><span class={`vt-pill ${u.active ? 'is-on' : 'is-off'}`}>{u.active ? 'Enabled' : 'Disabled'}</span></td>
                  <td style={{ textAlign: 'right' }}><RowMenu onManage={() => setManageUser(u)} /></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Per-user override editor */}
      <Modal open={!!manageUser} onClose={() => setManageUser(null)} title={manageUser ? `Permissions — ${manageUser.fullName}` : 'Permissions'} size="lg">
        {manageUser && <UserMatrix key={manageUser.id} user={manageUser} />}
      </Modal>
    </div>
  );
}
