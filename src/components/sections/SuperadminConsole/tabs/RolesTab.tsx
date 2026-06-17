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
import { useState, useMemo, useEffect } from 'preact/hooks';
import { confirm } from '@shared/ConfirmDialog';
import { toast } from '@store/ui';
import { permissionGroups } from '@lib/permissions';
import type { RoleRow } from '@lib/superadminApi';
import {
  useRoles, useRolePermissions, useCreateRole, useDeleteRole, useSetRolePermission,
} from '../hooks';

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

export function RolesTab(): VNode {
  const rolesQ = useRoles(true);
  const del = useDeleteRole();
  const [selected, setSelected] = useState<string | null>(null);
  const [creating, setCreating] = useState(false);

  const roles = rolesQ.data ?? [];
  useEffect(() => { if (roles.length && !selected) setSelected(roles[0]?.name ?? null); }, [roles, selected]);
  const role = roles.find(r => r.name === selected) ?? null;

  if (rolesQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading roles…</div>;
  if (rolesQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load roles. <button type="button" onClick={() => void rolesQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  return (
    <div style={{ display: 'flex', gap: '16px', minHeight: '440px' }}>
      {/* Roles list */}
      <div style={{ width: '240px', flexShrink: 0, display: 'flex', flexDirection: 'column' }}>
        <button type="button" class="btn btn-danger-primary btn-sm" style={{ marginBottom: '10px' }} onClick={() => setCreating(v => !v)}>
          <i class="fas fa-plus" /> New role
        </button>
        <div style={{ background: 'var(--bg-card)', borderRadius: 'var(--radius-md)', border: '1px solid var(--border)', overflow: 'hidden', flex: 1 }}>
          {roles.map(r => {
            const isSel = r.name === selected;
            return (
              <button key={r.name} type="button" onClick={() => setSelected(r.name)} style={{ width: '100%', textAlign: 'left', padding: '11px 14px', background: isSel ? 'rgba(27,45,84,0.06)' : 'transparent', borderBottom: '1px solid var(--border)', border: 'none', borderLeft: isSel ? '3px solid var(--siomac-navy)' : '3px solid transparent', cursor: 'pointer' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <span style={{ fontSize: '13px', fontWeight: isSel ? '700' : '500', color: isSel ? 'var(--siomac-navy)' : 'var(--text-primary)' }}>{r.label}</span>
                  {r.isSystem && <span style={{ fontSize: '10px', background: 'rgba(27,45,84,0.1)', color: 'var(--siomac-navy)', padding: '1px 6px', borderRadius: '8px' }}>system</span>}
                  {r.protected && !r.isSystem && <i class="fas fa-lock" style={{ fontSize: '10px', color: 'var(--text-muted)' }} title="Protected" />}
                </div>
                <div class="stg-switch-desc" style={{ marginTop: '1px' }}>{r.userCount} user{r.userCount === 1 ? '' : 's'}</div>
              </button>
            );
          })}
        </div>
      </div>

      {/* Detail / matrix */}
      <div style={{ flex: 1, minWidth: 0 }}>
        {creating && <CreateRoleForm onDone={() => setCreating(false)} />}
        {!role ? (
          <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'center', height: '100%', color: 'var(--text-muted)' }}>Select a role</div>
        ) : (
          <>
            <div class="stg-switch-group" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', marginBottom: '14px' }}>
              <div>
                <div class="stg-switch-label">{role.label} {role.isSystem && <span style={{ marginLeft: '6px', fontSize: '11px', color: 'var(--text-muted)' }}>(system)</span>}</div>
                <div class="stg-switch-desc">{role.description || 'No description'} · {role.userCount} user{role.userCount === 1 ? '' : 's'}</div>
              </div>
              {!role.isSystem && !role.protected && (
                <button type="button" class="btn btn-sm btn-danger has-label" disabled={del.isPending}
                  onClick={async () => {
                    const ok = await confirm({ title: `Delete "${role.label}"?`, message: role.userCount > 0 ? `${role.userCount} user(s) still have this role — reassign them first.` : 'This permanently deletes the role.', variant: 'danger', confirmLabel: 'Delete role' });
                    if (ok) del.mutate(role.name, { onSuccess: r => { if (r.success) setSelected(null); } });
                  }}>
                  <i class={del.isPending ? 'fas fa-spinner fa-spin' : 'fas fa-trash'} /> Delete
                </button>
              )}
            </div>
            <RolePermMatrix role={role} />
          </>
        )}
      </div>
    </div>
  );
}
