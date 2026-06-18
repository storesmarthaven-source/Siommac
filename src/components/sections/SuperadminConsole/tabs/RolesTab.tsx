/**
 * tabs/RolesTab.tsx
 *
 * Roles-as-data management. Superadmin creates/edits/deletes roles and sets each
 * role's DEFAULT permission set (role_permissions). Per-user overrides live in
 * the Permissions tab and still take priority at resolve time.
 *
 * System roles (superadmin, employee) are permanent floors — they can't be
 * deleted; superadmin's permissions are fixed (allow-all).
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { Modal } from '@shared/Modal';
import { confirm } from '@shared/ConfirmDialog';
import { toast } from '@store/ui';
import { permissionGroups } from '@lib/permissions';
import type { RoleRow, ConsoleUser } from '@lib/superadminApi';
import {
  useRoles, useRolePermissions, useCreateRole, useDeleteRole, useSetRolePermission,
  useConsoleUsers,
} from '../hooks';

function initialsOf(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}

const RESOURCE_LABEL: Record<string, string> = {
  employees: 'Employees', departments: 'Departments', attendance: 'Attendance',
  leaves: 'Leave', payroll: 'Payroll', hourly_rates: 'Hourly Rates',
  sites: 'Project Sites', map: 'Live Map', dashboard: 'Dashboard',
  reports: 'Reports', settings: 'Settings', permissions: 'User Management',
  sessions: 'Sessions', audit: 'Audit', roles: 'Roles',
};

// ── Create-role inline form ───────────────────────────────────────────────────

function CreateRoleForm({ onDone }: { onDone: () => void }): VNode {
  const [label, setLabel] = useState('');
  const [description, setDescription] = useState('');
  const create = useCreateRole();

  // Derive a machine name (snake_case) from the label.
  const name = label.trim().toLowerCase().replace(/[^a-z0-9]+/g, '_').replace(/^_+|_+$/g, '');

  return (
    <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', padding: '16px', marginBottom: '14px' }}>
      <div class="stg-switch-label" style={{ marginBottom: '10px' }}>New role</div>
      <div class="stg-form-row">
        <div class="stg-form-group">
          <label>Display name</label>
          <input type="text" value={label} onInput={e => setLabel((e.target as HTMLInputElement).value)} placeholder="e.g. HSE Manager" />
          {name && <small class="stg-switch-desc">id: <code>{name}</code></small>}
        </div>
        <div class="stg-form-group">
          <label>Description</label>
          <input type="text" value={description} onInput={e => setDescription((e.target as HTMLInputElement).value)} placeholder="Optional" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '8px', marginTop: '8px' }}>
        <button type="button" class="btn btn-danger-primary btn-sm" disabled={!name || create.isPending}
          onClick={() => {
            if (!name) { toast.error('Enter a name.'); return; }
            create.mutate({ name, label: label.trim(), description: description.trim() }, { onSuccess: r => { if (r.success) { setLabel(''); setDescription(''); onDone(); } } });
          }}>
          <i class={create.isPending ? 'fas fa-spinner fa-spin' : 'fas fa-plus'} /> Create role
        </button>
        <button type="button" class="btn btn-outline-secondary btn-sm has-label" onClick={onDone}>Cancel</button>
      </div>
    </div>
  );
}

// ── Per-role permission matrix ────────────────────────────────────────────────

function RolePermMatrix({ role }: { role: RoleRow }): VNode {
  const permsQ = useRolePermissions(role.name);
  const setPerm = useSetRolePermission();
  const groups = useMemo(() => permissionGroups(), []);

  if (permsQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading…</div>;
  if (permsQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load.</div>;

  const granted = new Set(permsQ.data ?? []);
  const locked = role.name === 'superadmin';   // allow-all, not editable
  const pendingKey = setPerm.isPending ? setPerm.variables?.permission : null;

  return (
    <div>
      {locked && (
        <div class="stg-switch-desc" style={{ marginBottom: '12px', padding: '8px 12px', background: 'rgba(27,45,84,0.06)', borderRadius: 'var(--radius-sm)' }}>
          <i class="fas fa-lock" style={{ marginRight: '6px' }} />Superadmin always has every permission — not editable.
        </div>
      )}
      {groups.map(group => (
        <div key={group.resource} style={{ marginBottom: '16px' }}>
          <div class="stg-switch-desc" style={{ fontWeight: '700', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '8px', color: 'var(--siomac-navy)' }}>
            {RESOURCE_LABEL[group.resource] ?? group.resource}
          </div>
          <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
            {group.keys.map((key, idx) => {
              const on = locked || granted.has(key);
              const busy = pendingKey === key;
              return (
                <div key={key} style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '9px 16px', borderBottom: idx < group.keys.length - 1 ? '1px solid var(--border)' : 'none' }}>
                  <div style={{ minWidth: 0 }}>
                    <div style={{ fontSize: '13px', color: 'var(--text-primary)', textTransform: 'capitalize' }}>{(key.split('.')[1] ?? key).replace(/_/g, ' ')}</div>
                    <div class="stg-switch-desc" style={{ marginTop: 0, fontFamily: 'monospace', fontSize: '11px' }}>{key}</div>
                  </div>
                  <label class="stg-toggle" style={{ opacity: busy ? 0.6 : 1 }}>
                    <input type="checkbox" checked={on} disabled={locked || busy}
                      onChange={() => setPerm.mutate({ roleName: role.name, permission: key, granted: !granted.has(key) })} />
                    <span class="stg-slider" />
                  </label>
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

// ── Role-summary card ─────────────────────────────────────────────────────────

function RoleSummaryCard({ role, members, onManage }: {
  role: RoleRow; members: ConsoleUser[]; onManage: () => void;
}): VNode {
  const top = members.slice(0, 2);
  return (
    <div class="vt-rolecard">
      <div class="vt-rolecard-head">
        <span class="vt-rolecard-title">
          {role.label}
          {role.isSystem && <span class="vt-rolecard-sys">system</span>}
        </span>
        <button type="button" class="vt-rolecard-seeall" onClick={onManage}>See all</button>
      </div>
      <div class="vt-rolecard-members">
        {top.length === 0
          ? <div class="vt-rolecard-empty">No users with this role.</div>
          : top.map(m => (
            <div class="vt-member" key={m.id}>
              <span class="vt-member-avatar">{m.profileImage ? <img src={m.profileImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(m.fullName)}</span>
              <span class="vt-member-info"><span class="vt-member-name">{m.fullName}</span></span>
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

// ── Tab root (VANTUS Roles layout) ────────────────────────────────────────────

export function RolesTab(): VNode {
  const rolesQ = useRoles(true);
  const usersQ = useConsoleUsers(true);
  const del = useDeleteRole();
  const [creating, setCreating]     = useState(false);
  const [manageRole, setManageRole] = useState<RoleRow | null>(null);
  const [search, setSearch]         = useState('');
  const [roleFilter, setRoleFilter] = useState<string>('all');

  // 'employee' is the fixed self-service baseline — never shown as a role here.
  const roles = (rolesQ.data ?? []).filter(r => r.name !== 'employee' && r.name !== 'superadmin');
  const users = usersQ.data ?? [];

  const byRole = useMemo(() => {
    const m = new Map<string, ConsoleUser[]>();
    for (const u of users) (m.get(u.role) ?? m.set(u.role, []).get(u.role)!).push(u);
    return m;
  }, [users]);

  const roleLabel = (name: string) => roles.find(r => r.name === name)?.label ?? name;

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter(u =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (!q || u.fullName.toLowerCase().includes(q) || u.email.toLowerCase().includes(q) || u.department.toLowerCase().includes(q)));
  }, [users, search, roleFilter]);

  if (rolesQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading roles…</div>;
  if (rolesQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load roles. <button type="button" onClick={() => void rolesQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  return (
    <div>
      {creating && <div style={{ marginBottom: '16px' }}><CreateRoleForm onDone={() => setCreating(false)} /></div>}

      {/* Roles & members */}
      <div class="vt-section">
        <div class="vt-section-head">
          <div class="vt-section-titlewrap">
            <span class="vt-section-icon"><i class="fas fa-user-shield" /></span>
            <div>
              <div class="vt-section-title">Roles &amp; members</div>
              <div class="vt-section-sub">Each role unlocks specific menus and permissions. System roles are permanent.</div>
            </div>
          </div>
          <button type="button" class="btn btn-danger-primary btn-sm" onClick={() => setCreating(v => !v)}>
            <i class="fas fa-plus" /> New role
          </button>
        </div>
        <div class="vt-rolecards">
          {roles.map(r => (
            <RoleSummaryCard key={r.name} role={r} members={byRole.get(r.name) ?? []}
              onManage={() => { setRoleFilter(r.name); setManageRole(r); }} />
          ))}
        </div>
      </div>

      {/* User accounts */}
      <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
        <span class="vt-section-icon"><i class="fas fa-users-gear" /></span>
        <div>
          <div class="vt-section-title">User accounts</div>
          <div class="vt-section-sub">Everyone with a configurable role.</div>
        </div>
      </div>

      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 260px' }}>
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Search by name, email or department…" aria-label="Search accounts" />
        </div>
      </div>

      <div class="vt-tabs">
        <button type="button" class={`vt-tab${roleFilter === 'all' ? ' active' : ''}`} onClick={() => setRoleFilter('all')}>
          All <span class="vt-tab-count">{users.length}</span>
        </button>
        {roles.map(r => (
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
              <tr><th>Account</th><th>Role</th><th>Department</th><th>Status</th></tr>
            </thead>
            <tbody>
              {filtered.length === 0 ? (
                <tr><td colspan={4} style={{ textAlign: 'center', color: 'var(--text-muted)', padding: '28px' }}>No accounts match.</td></tr>
              ) : filtered.map(u => (
                <tr key={u.id}>
                  <td>
                    <span class="vt-cell-account">
                      <span class="vt-cell-avatar">{u.profileImage ? <img src={u.profileImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} /> : initialsOf(u.fullName)}</span>
                      <span class="vt-cell-account-text">
                        <span class="vt-cell-name">{u.fullName}</span>
                        {u.position && <span class="vt-cell-subtext">{u.position}</span>}
                      </span>
                    </span>
                  </td>
                  <td>{roleLabel(u.role)}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{u.department || '—'}</td>
                  <td><span class={`vt-pill ${u.active ? 'is-on' : 'is-off'}`}>{u.active ? 'Enabled' : 'Disabled'}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Manage role permissions */}
      <Modal open={!!manageRole} onClose={() => setManageRole(null)} title={manageRole ? `Manage — ${manageRole.label}` : 'Manage role'} size="lg">
        {manageRole && (
          <div>
            <div class="stg-switch-group" style={{ padding: '0 0 12px', borderBottom: '1px solid var(--border)', marginBottom: '14px' }}>
              <div>
                <div class="stg-switch-label">{manageRole.label} {manageRole.isSystem && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>(system)</span>}</div>
                <div class="stg-switch-desc">{manageRole.description || 'No description'} · {manageRole.userCount} user{manageRole.userCount === 1 ? '' : 's'}</div>
              </div>
              {!manageRole.isSystem && !manageRole.protected && (
                <button type="button" class="btn btn-sm btn-danger has-label" disabled={del.isPending}
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete "${manageRole.label}"?`, message: manageRole.userCount > 0 ? `${manageRole.userCount} user(s) still have this role — reassign them first.` : 'This permanently deletes the role.', variant: 'danger', confirmLabel: 'Delete role' });
                    if (ok) del.mutate(manageRole.name, { onSuccess: r => { if (r.success) setManageRole(null); } });
                  }}>
                  <i class={del.isPending ? 'fas fa-spinner fa-spin' : 'fas fa-trash'} /> Delete
                </button>
              )}
            </div>
            <RolePermMatrix role={manageRole} />
          </div>
        )}
      </Modal>
    </div>
  );
}
