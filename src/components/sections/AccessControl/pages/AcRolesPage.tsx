/**
 * src/components/sections/AccessControl/pages/AcRolesPage.tsx
 *
 * Access Control — Roles (reproduces rbac-mockups/roles.html): master-detail role
 * editor. Left rail = System/Custom role list; right = role header + mini-stats +
 * Capability Defaults accordion (toggle per capability, wired to the role grant
 * routes; critical grants → maker-checker) + members + pending approvals. "New
 * Role" / "Role settings" open the Create/Edit Role wizard (CreateRolePage).
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import {
  useRoles, useRolePermissions, useSetRolePermission, useConsoleUsers, usePermissionApprovals,
} from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { CriticalGrantDialog } from '@sections/SuperadminConsole/CriticalGrantDialog';
import { AcCreateRolePage } from './AcCreateRolePage';
import { setRolePermissionWithReasonApi, type RoleRow } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import { toast } from '@store/ui';

const ROLE_ICON: Record<string, { icon: string; bg: string; fg: string }> = {
  superadmin: { icon: 'fa-shield-halved', bg: 'var(--red-bg)', fg: 'var(--red)' },
  admin: { icon: 'fa-sliders', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  manager: { icon: 'fa-users', bg: 'var(--green-bg)', fg: 'var(--green)' },
  employee: { icon: 'fa-user', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  hr_manager: { icon: 'fa-handshake', bg: 'var(--green-bg)', fg: 'var(--green)' },
  hr_staff: { icon: 'fa-user-group', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  finance_manager: { icon: 'fa-dollar-sign', bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  finance_staff: { icon: 'fa-dollar-sign', bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  hse_staff: { icon: 'fa-helmet-safety', bg: 'var(--purple-bg)', fg: 'var(--purple)' },
};
const roleStyle = (name: string) => ROLE_ICON[name] ?? { icon: 'fa-user-shield', bg: '#f1f3f7', fg: 'var(--muted)' };
const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });

export function AcRolesPage(): VNode {
  const qc = useQueryClient();
  const rolesQ = useRoles(true);
  const roles = rolesQ.data ?? [];

  const [selName, setSelName] = useState<string | null>(null);
  const [tab, setTab]         = useState<'system' | 'custom'>('system');
  const [search, setSearch]   = useState('');
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);
  const [openMods, setOpen]   = useState<Set<string>>(new Set());
  const [criticalKey, setCriticalKey] = useState<string | null>(null);

  useEffect(() => { if (!selName && roles.length) setSelName(roles[0]!.name); }, [roles, selName]);

  const selRole   = roles.find(r => r.name === selName) ?? null;
  const rolePermsQ = useRolePermissions(selName);
  const usersQ    = useConsoleUsers(true);
  const approvalsQ = usePermissionApprovals('pending');

  const granted = (k: string) => selRole?.name === 'superadmin' || (rolePermsQ.data ?? []).includes(k);
  const isSuper = selRole?.name === 'superadmin';

  const filteredRoles = useMemo(() => {
    const q = search.trim().toLowerCase();
    return roles.filter(r => (tab === 'system' ? r.isSystem : !r.isSystem) && (!q || r.label.toLowerCase().includes(q) || r.name.includes(q)));
  }, [roles, tab, search]);

  const groups = useMemo(() => {
    const byMod = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      const m = PERMISSION_META[k]?.module ?? 'Other';
      (byMod.get(m) ?? byMod.set(m, []).get(m)!).push(k);
    }
    return byMod;
  }, []);

  const stats = useMemo(() => {
    const set = rolePermsQ.data ?? [];
    const total = isSuper ? PERMISSION_KEYS.length : set.length;
    const highRisk = PERMISSION_KEYS.filter(k => granted(k) && CRITICAL_GRANT_KEYS.has(k)).length;
    return { total, highRisk, members: selRole?.userCount ?? 0 };
  }, [rolePermsQ.data, isSuper, selRole]);

  const members = useMemo(() => (usersQ.data ?? []).filter(u => u.role === selName), [usersQ.data, selName]);
  const pending = useMemo(() => (approvalsQ.data ?? []).filter(a => a.requestType === 'role_permission' && a.targetRole === selName), [approvalsQ.data, selName]);

  const setRolePerm = useSetRolePermission();
  const onToggle = (key: string) => {
    if (!selName || isSuper) return;
    const next = !granted(key);
    if (next && CRITICAL_GRANT_KEYS.has(key)) { setCriticalKey(key); return; }
    setRolePerm.mutate({ roleName: selName, permission: key, granted: next });
  };
  const submitCritical = async (reason: string) => {
    const key = criticalKey; setCriticalKey(null);
    if (!key || !selName) return;
    const res = await setRolePermissionWithReasonApi(selName, key, true, reason);
    if (!res.success) toast.error(res.message ?? 'Failed to submit request.');
    else if (res.pending) { void qc.invalidateQueries({ queryKey: consoleKeys.approvals('pending') }); toast.success("Submitted for a second superadmin's approval."); }
    else { toast.success('Granted.'); void rolePermsQ.refetch(); }
  };
  const toggleMod = (m: string) => setOpen(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });

  const systemRoles = roles.filter(r => r.isSystem);
  const customRoles = roles.filter(r => !r.isSystem);

  return (
    <div class="acx">
      <div class="page-head">
        <h1 class="page-title">Roles</h1>
        <p class="page-sub">Manage and edit role defaults for access to capabilities.</p>
      </div>

      <div class="rl-layout">
        {/* LEFT RAIL */}
        <div class="card rl-rail">
          <div class="rl-searchbar">
            <div class="rl-searchwrap"><i class="fas fa-magnifying-glass" /><input class="input" placeholder="Search roles…" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} /></div>
          </div>
          <div class="rl-tabs">
            <div class={`rl-tab${tab === 'system' ? ' active' : ''}`} onClick={() => setTab('system')}>System Roles ({systemRoles.length})</div>
            <div class={`rl-tab${tab === 'custom' ? ' active' : ''}`} onClick={() => setTab('custom')}>Custom Roles ({customRoles.length})</div>
          </div>
          <div class="role-list">
            {rolesQ.isLoading ? <div class="ac-loading">Loading roles…</div>
             : filteredRoles.length === 0 ? <div class="ac-empty">{tab === 'custom' ? 'No custom roles yet.' : 'No roles match.'}</div>
             : filteredRoles.map(r => {
              const st = roleStyle(r.name);
              return (
                <div key={r.name} class={`role-item${r.name === selName ? ' selected' : ''}`} onClick={() => setSelName(r.name)}>
                  <span class="role-icon" style={{ background: st.bg, color: st.fg }}><i class={`fas ${st.icon}`} /></span>
                  <div class="role-info">
                    <div class="role-name-row"><span class="role-name">{r.label}</span><span class={`badge ${r.isSystem ? 'grey' : 'blue'}`} style={{ fontSize: '10.5px', padding: '1px 7px' }}>{r.isSystem ? 'System' : 'Custom'}</span></div>
                    <div class="role-desc">{r.description || '—'}</div>
                  </div>
                  <span class="role-count">{r.userCount} member{r.userCount === 1 ? '' : 's'}</span>
                </div>
              );
            })}
            {tab === 'custom' && (
              <div class="role-section-head">
                <span class="role-section-lbl">Custom Roles</span>
                <button class="btn sm primary" style={{ height: '30px', fontSize: '12px', padding: '0 11px' }} onClick={() => setEditing('new')}><i class="fas fa-plus" style={{ fontSize: '10px' }} /> New Role</button>
              </div>
            )}
          </div>
          <div class="rl-foot">Showing {filteredRoles.length} of {roles.length} roles</div>
        </div>

        {/* RIGHT DETAIL */}
        <div class="rl-detail">
          {!selRole ? <div class="card"><div class="ac-empty">Select a role.</div></div> : (
            <>
              <div class="card">
                <div style={{ padding: '20px 22px', display: 'flex', alignItems: 'flex-start', gap: '18px' }}>
                  <span class="rh-icon" style={{ background: roleStyle(selRole.name).bg, color: roleStyle(selRole.name).fg }}><i class={`fas ${roleStyle(selRole.name).icon}`} /></span>
                  <div class="grow">
                    <div class="row" style={{ gap: '10px', marginBottom: '5px' }}>
                      <span style={{ fontSize: '21px', fontWeight: 700 }}>{selRole.label}</span>
                      <span class={`badge ${selRole.isSystem ? 'grey' : 'blue'}`}>{selRole.isSystem ? 'System' : 'Custom'}</span>
                    </div>
                    <div style={{ fontSize: '14px', fontWeight: 500, color: 'var(--ink-2)', marginBottom: '3px' }}>{selRole.description || (isSuper ? 'Full system access with no restrictions.' : 'Role default capability set.')}</div>
                    <div style={{ fontSize: '13px', color: 'var(--muted)' }}>{isSuper ? 'This role has all capabilities enabled by default and cannot be edited.' : 'Toggle the default access for each capability below.'}</div>
                  </div>
                  {!isSuper && <button class="btn" style={{ flex: 'none', marginTop: '2px' }} onClick={() => setEditing(selRole)}>Role settings <i class="fas fa-chevron-down" style={{ fontSize: '10px' }} /></button>}
                </div>
              </div>

              <div class="mini-stats">
                <div class="mini-stat"><span class="stat-ico blue" style={{ width: '42px', height: '42px', fontSize: '16px' }}><i class="fas fa-table-cells-large" /></span><div><div class="stat-lbl">Total Capabilities</div><div class="mini-val">{stats.total}</div><div class="sub">Enabled defaults</div></div></div>
                <div class="mini-stat"><span class="stat-ico red" style={{ width: '42px', height: '42px', fontSize: '16px' }}><i class="fas fa-shield-halved" /></span><div><div class="stat-lbl">High-Risk Capabilities</div><div class="mini-val">{stats.highRisk}</div><div class="sub">Require approval</div></div></div>
                <div class="mini-stat"><span class="stat-ico green" style={{ width: '42px', height: '42px', fontSize: '16px' }}><i class="fas fa-users" /></span><div><div class="stat-lbl">Members</div><div class="mini-val">{stats.members}</div><div class="sub">Users assigned</div></div></div>
              </div>

              <div class="card">
                <div class="card-head" style={{ alignItems: 'flex-start', gap: '16px' }}>
                  <div><div class="card-title">Capability Defaults</div><div class="card-sub" style={{ maxWidth: '560px' }}>Set the default access for each capability. These defaults apply when users are assigned to this role.</div></div>
                  <button class="btn sm" style={{ flex: 'none', marginTop: '2px' }} onClick={() => setOpen(new Set(openMods.size === groups.size ? [] : groups.keys()))}>{openMods.size === groups.size ? 'Collapse All' : 'Expand All'}</button>
                </div>
                <table class="cap-tbl">
                  <thead><tr><th style={{ minWidth: '190px' }}>Capability</th><th>Description</th><th style={{ width: '105px' }}>Risk Level</th><th style={{ width: '115px', textAlign: 'center' }}>Default Access</th></tr></thead>
                  <tbody>
                    {[...groups.entries()].map(([mod, keys]) => {
                      const open = openMods.has(mod);
                      const enabled = keys.filter(k => granted(k)).length;
                      const hr = keys.filter(k => CRITICAL_GRANT_KEYS.has(k)).length;
                      const badge = enabled === keys.length ? { c: 'green', t: '✓ All Enabled' } : enabled === 0 ? { c: 'grey', t: 'None' } : { c: 'amber', t: `${enabled} Enabled` };
                      return (
                        <>
                          <tr class={`acc-head ${open ? 'acc-open' : 'acc-collapsed'}`} key={`g-${mod}`}>
                            <td colSpan={4}>
                              <div class="acc-head-inner" onClick={() => toggleMod(mod)}>
                                <i class={`fas fa-chevron-${open ? 'down' : 'right'} acc-chev${open ? ' open' : ''}`} />
                                <span class="acc-mod-name">{mod}</span>
                                <span class="muted" style={{ fontSize: '12.5px', fontWeight: 400 }}>— {keys.length} capabilities</span>
                                {hr > 0 && <span class="acc-risk-count">{hr} High-Risk</span>}
                                <span style={{ marginLeft: 'auto' }}><span class={`badge ${badge.c}`} style={{ fontSize: '11.5px' }}>{badge.t}</span></span>
                              </div>
                            </td>
                          </tr>
                          {open && keys.map(k => {
                            const meta = PERMISSION_META[k];
                            return (
                              <tr class="acc-row" key={k}>
                                <td class="cap-name">{meta.label}</td>
                                <td class="cap-desc">{meta.description}</td>
                                <td><span class={`risk ${meta.risk}`}>{meta.risk[0]!.toUpperCase() + meta.risk.slice(1)}</span></td>
                                <td class="toggle-cell"><button type="button" class={`toggle${granted(k) ? ' on' : ''}`} disabled={isSuper} onClick={() => onToggle(k)} aria-pressed={granted(k)} aria-label={`${meta.label} default access`} /></td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}
                  </tbody>
                </table>
              </div>

              <div class="grid-2">
                <div class="card">
                  <div class="card-head"><div class="card-title">Users with this role <span style={{ fontWeight: 400, color: 'var(--muted)' }}>({members.length})</span></div></div>
                  {members.length === 0 ? <div class="ac-empty" style={{ padding: '28px 16px' }}>No configurable-role users listed for this role.</div>
                   : members.slice(0, 6).map(u => (
                    <div class="um-row" key={u.id}>
                      <span class="avatar" style={{ width: '38px', height: '38px', fontSize: '13px', background: 'var(--green)' }}>{u.profileImage ? <img src={u.profileImage} alt="" /> : initials(u.fullName)}</span>
                      <div class="grow" style={{ minWidth: 0 }}><div style={{ fontWeight: 600, fontSize: '13.5px' }}>{u.fullName}</div><div class="sub">{u.email || u.username}</div></div>
                    </div>
                  ))}
                </div>

                <div class="card">
                  <div class="card-head"><div class="row" style={{ gap: '9px' }}><div class="card-title">Pending approval changes</div>{pending.length > 0 && <span class="badge red">{pending.length}</span>}</div></div>
                  {pending.length === 0 ? <div class="ac-empty" style={{ padding: '28px 16px' }}>No pending changes.</div>
                   : pending.map(a => (
                    <div class="pend-row" key={a.id}>
                      <span class="pend-ico"><i class="fas fa-triangle-exclamation" /></span>
                      <div class="grow" style={{ minWidth: 0 }}><div class="pend-cap">{PERMISSION_META[a.permissionKey as PermissionKey]?.label ?? a.permissionKey}</div><div class="sub">{PERMISSION_META[a.permissionKey as PermissionKey]?.module ?? ''} · Requested by {a.requestedByName}</div></div>
                      <div class="sub" style={{ whiteSpace: 'nowrap' }}>{dateShort(a.requestedAt)}</div>
                    </div>
                  ))}
                  {pending.length > 0 && <div class="pend-foot"><i class="fas fa-circle-info" style={{ color: 'var(--amber)', fontSize: '13px' }} /> Changes require approval due to high-risk capabilities.</div>}
                </div>
              </div>
            </>
          )}
        </div>
      </div>

      {criticalKey && <CriticalGrantDialog permKey={criticalKey} targetLabel={selRole?.label ?? ''} onConfirm={r => void submitCritical(r)} onCancel={() => setCriticalKey(null)} />}
      {editing && <AcCreateRolePage role={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); void rolesQ.refetch(); void rolePermsQ.refetch(); }} />}
    </div>
  );
}
