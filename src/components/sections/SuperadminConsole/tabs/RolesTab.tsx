/**
 * tabs/RolesTab.tsx  —  Redesigned master-detail Roles view
 *
 * Layout: [left rail 310px] [right detail 1fr]
 *
 * Left rail:
 *   - Search + filter button
 *   - System / Custom tabs
 *   - Role list (scrollable, selected role highlighted)
 *   - Footer with count
 *
 * Right detail (when a role is selected):
 *   - Role header card (icon, name, description, "Edit Role" button)
 *   - Mini stats row (Total Capabilities / High-Risk / Members)
 *   - Capability Defaults accordion table (grouped by module from PERMISSION_META)
 *   - Bottom grid-2: Users with this role + Pending approval changes
 *
 * Vocabulary:
 *   Role level: capability is "Granted" / "Not granted" (toggle)
 *   Risk tiers: low / medium / high / critical
 *
 * "New Role" and "Edit Role" → full-page CreateRolePage (NOT a modal).
 * "Delete Role" → confirm dialog (existing pattern).
 */

import { type VNode, Fragment } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { confirm } from '@shared/ConfirmDialog';
import { toast } from '@store/ui';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import type { RoleRow, ConsoleUser } from '@lib/superadminApi';
import { setRolePermissionWithReasonApi } from '@lib/superadminApi';
import {
  useRoles, useRolePermissions, useDeleteRole, useSetRolePermission,
  useConsoleUsers, usePermissionApprovals,
} from '../hooks';
import { consoleKeys } from '../queryKeys';
import { CreateRolePage } from './CreateRolePage';
import { CriticalGrantDialog } from '../CriticalGrantDialog';
import '../ac.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

function initialsOf(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}

// Icon/colour per role name (for the role icon pill)
const ROLE_ICON: Record<string, { icon: string; bg: string; clr: string }> = {
  superadmin:      { icon: 'fa-shield-halved',     bg: 'var(--ac-red-bg)',    clr: 'var(--ac-red)' },
  admin:           { icon: 'fa-sliders',            bg: 'var(--ac-accent-bg)', clr: 'var(--ac-accent)' },
  manager:         { icon: 'fa-users',              bg: 'var(--ac-green-bg)',  clr: 'var(--ac-green)' },
  hr_manager:      { icon: 'fa-user-tie',           bg: 'var(--ac-green-bg)',  clr: 'var(--ac-green)' },
  hr_staff:        { icon: 'fa-user',               bg: 'var(--ac-accent-bg)', clr: 'var(--ac-accent)' },
  hse_staff:       { icon: 'fa-hard-hat',           bg: 'var(--ac-amber-bg)',  clr: 'var(--ac-amber)' },
  finance_manager: { icon: 'fa-dollar-sign',        bg: 'var(--ac-amber-bg)',  clr: 'var(--ac-amber)' },
  finance_staff:   { icon: 'fa-calculator',         bg: 'var(--ac-amber-bg)',  clr: 'var(--ac-amber)' },
  employee:        { icon: 'fa-user',               bg: 'var(--ac-accent-bg)', clr: 'var(--ac-accent)' },
};
function roleStyle(name: string) {
  return ROLE_ICON[name] ?? { icon: 'fa-circle-user', bg: 'var(--ac-purple-bg)', clr: 'var(--ac-purple)' };
}

// Module icon map (mirrors CreateRolePage)
const MODULE_ICON: Record<string, string> = {
  HR: 'fa-user', Finance: 'fa-dollar-sign', HSE: 'fa-shield-halved',
  Communications: 'fa-comment', Workflow: 'fa-diagram-project',
  Settings: 'fa-gear', Auth: 'fa-lock',
};
const MODULE_COLOR: Record<string, { bg: string; clr: string }> = {
  HR:             { bg: 'var(--ac-accent-bg)', clr: 'var(--ac-accent)' },
  Finance:        { bg: 'var(--ac-green-bg)',  clr: 'var(--ac-green)' },
  HSE:            { bg: 'var(--ac-amber-bg)',  clr: 'var(--ac-amber)' },
  Communications: { bg: 'var(--ac-purple-bg)', clr: 'var(--ac-purple)' },
};
function modStyle(m: string) { return MODULE_COLOR[m] ?? { bg: '#f1f3f7', clr: '#566074' }; }

// ── Build module groups from the permission catalogue ─────────────────────────

interface ModuleSection {
  module: string;
  keys: string[];
  total: number;
  highRiskCount: number;
}

const ALL_MODULE_SECTIONS: ModuleSection[] = (() => {
  const byModule = new Map<string, string[]>();
  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key as keyof typeof PERMISSION_META];
    if (!meta) continue;
    const list = byModule.get(meta.module) ?? [];
    if (!byModule.has(meta.module)) byModule.set(meta.module, list);
    list.push(key);
  }
  return [...byModule.entries()].map(([module, keys]) => ({
    module,
    keys,
    total: keys.length,
    highRiskCount: keys.filter(k => {
      const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
      return m?.risk === 'high' || m?.risk === 'critical';
    }).length,
  })).sort((a, b) => b.total - a.total);
})();

const TOTAL_CAPS = PERMISSION_KEYS.length;
const HIGH_RISK_TOTAL = PERMISSION_KEYS.filter(k => {
  const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
  return m?.risk === 'high' || m?.risk === 'critical';
}).length;

// ── Capability accordion (right detail) ───────────────────────────────────────

function CapabilityAccordion({ role, granted }: { role: RoleRow; granted: Set<string> }): VNode {
  const setPerm = useSetRolePermission();
  const qc = useQueryClient();
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [all, setAll] = useState(false);
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [busyReason, setBusyReason] = useState<string | null>(null);

  const locked = role.name === 'superadmin';
  const pendingKey = setPerm.isPending ? setPerm.variables?.permission : null;

  // Toggle a capability. A CRITICAL grant is not applied directly — it opens the reason
  // dialog and requests a maker-checker approval; everything else applies immediately.
  const onToggle = (key: string, next: boolean): void => {
    if (next && CRITICAL_GRANT_KEYS.has(key)) { setCriticalKey(key); return; }
    setPerm.mutate({ roleName: role.name, permission: key, granted: next });
  };
  const submitCritical = async (reason: string): Promise<void> => {
    const key = criticalKey; setCriticalKey(null);
    if (!key) return;
    setBusyReason(key);
    try {
      const res = await setRolePermissionWithReasonApi(role.name, key, true, reason);
      if (!res.success) { toast.error(res.message ?? 'Failed to submit the request.'); return; }
      if (res.pending) {
        toast.success("Submitted for a second superadmin's approval.");
        void qc.invalidateQueries({ queryKey: consoleKeys.approvals('pending') });
      } else {
        toast.success('Capability granted.');
        void qc.invalidateQueries({ queryKey: consoleKeys.rolePerms(role.name) });
      }
    } catch { toast.error('Network error. Try again.'); }
    finally { setBusyReason(null); }
  };

  const toggleExpand = (mod: string) => {
    setExpanded(prev => {
      const next = new Set(prev);
      if (next.has(mod)) next.delete(mod); else next.add(mod);
      return next;
    });
  };

  const toggleAll = () => {
    if (all) setExpanded(new Set());
    else setExpanded(new Set(ALL_MODULE_SECTIONS.map(s => s.module)));
    setAll(v => !v);
  };

  return (
    <div class="ac-card">
      {criticalKey && (
        <CriticalGrantDialog
          permKey={criticalKey}
          targetLabel={`the ${role.label} role`}
          onConfirm={r => void submitCritical(r)}
          onCancel={() => setCriticalKey(null)}
        />
      )}
      <div class="ac-card-head" style={{ alignItems: 'flex-start', gap: '14px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <div class="ac-card-title">Capability Defaults</div>
          <div class="ac-card-sub" style={{ maxWidth: '520px' }}>
            Set the default access for each capability. Applies when users are assigned to this role.
          </div>
        </div>
        <button type="button" class="ac-btn sm" onClick={toggleAll} style={{ flex: 'none', marginTop: '2px' }}>
          {all ? 'Collapse All' : 'Expand All'}
        </button>
      </div>

      {locked && (
        <div style={{ padding: '12px 16px', background: 'rgba(27,45,84,.05)', borderBottom: '1px solid var(--ac-line)', fontSize: '13px', color: 'var(--ac-muted)', display: 'flex', alignItems: 'center', gap: '8px' }}>
          <i class="fas fa-lock" style={{ color: 'var(--ac-red)' }} />
          Superadmin always has every capability — not editable.
        </div>
      )}

      <table class="ac-cap-tbl">
        <thead>
          <tr>
            <th style={{ width: '30px', paddingLeft: '16px' }} />
            <th style={{ minWidth: '180px' }}>Capability</th>
            <th>Description</th>
            <th style={{ width: '100px' }}>Risk</th>
            <th style={{ width: '100px', textAlign: 'center' }}>Granted</th>
          </tr>
        </thead>
        <tbody>
          {ALL_MODULE_SECTIONS.map(sec => {
            const isOpen = expanded.has(sec.module);
            const enabledCount = locked ? sec.total : sec.keys.filter(k => granted.has(k)).length;
            const style = modStyle(sec.module);
            const allEnabled = enabledCount === sec.total;
            return (
              <Fragment key={sec.module}>
                {/* Module accordion header */}
                <tr class={`ac-acc-head${isOpen ? '' : ' collapsed'}`}>
                  <td colSpan={5}>
                    <div class="ac-acc-head-inner" onClick={() => toggleExpand(sec.module)}>
                      <i class={`fas fa-chevron-${isOpen ? 'down ac-acc-chev open' : 'right ac-acc-chev'}`} />
                      <span class="ac-acc-ico" style={{ width: '28px', height: '28px', borderRadius: '7px', background: style.bg, color: style.clr, display: 'inline-grid', placeItems: 'center', fontSize: '12px', flex: 'none' }}>
                        <i class={`fas ${MODULE_ICON[sec.module] ?? 'fa-cube'}`} />
                      </span>
                      <span class="ac-acc-mod-name">{sec.module}</span>
                      <span style={{ fontSize: '12.5px', color: 'var(--ac-muted)', fontWeight: 400 }}>— {sec.total} capabilities</span>
                      {sec.highRiskCount > 0 && (
                        <span class="ac-acc-risk-count">{sec.highRiskCount} High-Risk</span>
                      )}
                      <span style={{ marginLeft: 'auto' }}>
                        <span class={`ac-badge ${allEnabled ? 'green' : enabledCount > 0 ? 'amber' : 'grey'}`} style={{ fontSize: '11.5px' }}>
                          {locked ? '✓ All Granted' : allEnabled ? '✓ All Granted' : enabledCount > 0 ? `${enabledCount} Granted` : 'None Granted'}
                        </span>
                      </span>
                    </div>
                  </td>
                </tr>

                {/* Capability rows */}
                {isOpen && sec.keys.map((key, idx) => {
                  const meta = PERMISSION_META[key as keyof typeof PERMISSION_META];
                  if (!meta) return null;
                  const on = locked || granted.has(key);
                  const busy = pendingKey === key || busyReason === key;
                  const isLast = idx === sec.keys.length - 1;
                  return (
                    <tr key={key} class="ac-cap-row" style={{ borderBottom: isLast ? '2px solid var(--ac-line)' : undefined }}>
                      <td style={{ paddingLeft: '16px', width: '30px' }} />
                      <td>
                        <div class="ac-cap-name">{meta.label}</div>
                        <div class="ac-cap-key">{key}</div>
                      </td>
                      <td class="ac-cap-desc">{meta.description}</td>
                      <td><span class={`ac-risk ${meta.risk}`}>{meta.risk}</span></td>
                      <td class="ac-toggle-cell">
                        <button
                          type="button"
                          role="switch"
                          aria-checked={on}
                          aria-label={`${meta.label}: ${on ? 'Granted' : 'Not granted'}`}
                          class={`ac-toggle${on ? ' on' : ''}`}
                          disabled={locked || busy}
                          onClick={() => onToggle(key, !on)}
                          style={{ opacity: busy ? .6 : 1 }}
                        />
                      </td>
                    </tr>
                  );
                })}
              </Fragment>
            );
          })}
        </tbody>
      </table>
    </div>
  );
}

// ── Role detail pane ──────────────────────────────────────────────────────────

function RoleDetail({ role, members, onEdit, onDelete }: {
  role: RoleRow;
  members: ConsoleUser[];
  onEdit: () => void;
  onDelete: () => void;
}): VNode {
  const permsQ = useRolePermissions(role.name);
  const approvalsQ = usePermissionApprovals('pending');

  const granted = useMemo(() => new Set(permsQ.data ?? []), [permsQ.data]);
  const highRiskGranted = useMemo(() => [...granted].filter(k => {
    const m = PERMISSION_META[k as keyof typeof PERMISSION_META];
    return m?.risk === 'high' || m?.risk === 'critical';
  }).length, [granted]);

  // Filter pending approvals to this role
  const pendingForRole = useMemo(() => {
    return (approvalsQ.data ?? []).filter(a => a.targetRole === role.name);
  }, [approvalsQ.data, role.name]);

  const style = roleStyle(role.name);
  const memberCount = members.length;
  const totalGranted = role.name === 'superadmin' ? TOTAL_CAPS : granted.size;
  const isLocked = role.name === 'superadmin';

  return (
    <div class="ac-rl-detail">
      {/* Role header */}
      <div class="ac-card">
        <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <span class="ac-rh-icon" style={{ background: style.bg, color: style.clr }}>
            <i class={`fas ${style.icon}`} />
          </span>
          <div style={{ flex: 1, minWidth: 0 }}>
            <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
              <span style={{ fontSize: '20px', fontWeight: 700, letterSpacing: '-.01em', color: 'var(--ac-ink)' }}>{role.label}</span>
              <span class={`ac-badge ${role.isSystem ? 'grey' : 'blue'}`}>{role.isSystem ? 'System' : 'Custom'}</span>
              {role.protected && <span class="ac-badge amber">Protected</span>}
            </div>
            <div style={{ fontSize: '13.5px', fontWeight: 500, color: 'var(--ac-ink2)', marginBottom: '3px' }}>
              {role.description || 'No description provided.'}
            </div>
            {isLocked && (
              <div style={{ fontSize: '12.5px', color: 'var(--ac-muted)' }}>
                This role has all capabilities granted by default.
              </div>
            )}
          </div>
          <div style={{ display: 'flex', gap: '8px', flexShrink: 0 }}>
            {!isLocked && (
              <button type="button" class="ac-btn sm" onClick={onEdit}>
                <i class="fas fa-pen" style={{ fontSize: '11px' }} /> Edit Role
              </button>
            )}
            {!role.isSystem && !role.protected && (
              <button type="button" class="ac-btn sm" onClick={onDelete}
                style={{ color: 'var(--ac-red)', borderColor: 'rgba(220,38,38,.3)' }}>
                <i class="fas fa-trash" style={{ fontSize: '11px' }} />
              </button>
            )}
          </div>
        </div>
      </div>

      {/* Mini stats */}
      <div class="ac-mini-stats">
        <div class="ac-mini-stat">
          <span class="ac-mini-ico blue"><i class="fas fa-table-cells-large" /></span>
          <div>
            <div class="ac-mini-lbl">Granted Capabilities</div>
            <div class="ac-mini-val">{totalGranted}</div>
            <div class="ac-mini-sub">of {TOTAL_CAPS} total</div>
          </div>
        </div>
        <div class="ac-mini-stat">
          <span class="ac-mini-ico red"><i class="fas fa-shield-halved" /></span>
          <div>
            <div class="ac-mini-lbl">High-Risk Granted</div>
            <div class="ac-mini-val">{isLocked ? HIGH_RISK_TOTAL : highRiskGranted}</div>
            <div class="ac-mini-sub">of {HIGH_RISK_TOTAL} high-risk</div>
          </div>
        </div>
        <div class="ac-mini-stat">
          <span class="ac-mini-ico green"><i class="fas fa-users" /></span>
          <div>
            <div class="ac-mini-lbl">Members</div>
            <div class="ac-mini-val">{memberCount}</div>
            <div class="ac-mini-sub">user{memberCount !== 1 ? 's' : ''} assigned</div>
          </div>
        </div>
      </div>

      {/* Capability defaults accordion */}
      {permsQ.isLoading ? (
        <div class="ac-card" style={{ padding: '32px', textAlign: 'center', color: 'var(--ac-muted)' }}>
          <i class="fas fa-spinner fa-spin" /> Loading capabilities…
        </div>
      ) : permsQ.isError ? (
        <div class="ac-card" style={{ padding: '20px', color: 'var(--ac-red)', textAlign: 'center' }}>
          <i class="fas fa-exclamation-triangle" /> Failed to load capabilities.
        </div>
      ) : (
        <CapabilityAccordion role={role} granted={granted} />
      )}

      {/* Bottom row: users + pending */}
      <div class="ac-grid-2">
        {/* Users with this role */}
        <div class="ac-card">
          <div class="ac-card-head">
            <div>
              <div class="ac-card-title">
                Users with this role
                <span style={{ fontWeight: 400, color: 'var(--ac-muted)', marginLeft: '6px' }}>({memberCount})</span>
              </div>
            </div>
          </div>
          {memberCount === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
              No users assigned to this role.
            </div>
          ) : (
            <>
              {members.slice(0, 5).map(u => (
                <div key={u.id} class="ac-um-row">
                  <span class="ac-avatar" style={{ width: '36px', height: '36px', fontSize: '13px' }}>
                    {u.profileImage
                      ? <img src={u.profileImage} alt="" style={{ width: '100%', height: '100%', objectFit: 'cover' }} />
                      : initialsOf(u.fullName)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="ac-um-name">{u.fullName}</div>
                    <div class="ac-um-sub">{u.email || u.username}</div>
                  </div>
                  <span class={`ac-badge ${u.active ? 'green' : 'grey'}`} style={{ fontSize: '11px', flexShrink: 0 }}>
                    {u.active ? 'Active' : 'Inactive'}
                  </span>
                </div>
              ))}
              {memberCount > 5 && (
                <div style={{ padding: '10px 18px', textAlign: 'center', borderTop: '1px solid var(--ac-line2)', fontSize: '12.5px', color: 'var(--ac-muted)' }}>
                  +{memberCount - 5} more user{memberCount - 5 !== 1 ? 's' : ''}
                </div>
              )}
            </>
          )}
        </div>

        {/* Pending approval changes */}
        <div class="ac-card">
          <div class="ac-card-head">
            <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
              <div class="ac-card-title">Pending approval changes</div>
              {pendingForRole.length > 0 && (
                <span class="ac-badge red">{pendingForRole.length}</span>
              )}
            </div>
          </div>
          {pendingForRole.length === 0 ? (
            <div style={{ padding: '24px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
              <i class="fas fa-circle-check" style={{ color: 'var(--ac-green)', marginRight: '6px' }} />
              No pending changes for this role.
            </div>
          ) : (
            <>
              {pendingForRole.map(a => {
                const meta = PERMISSION_META[a.permissionKey as keyof typeof PERMISSION_META];
                return (
                  <div key={a.id} class="ac-pend-row">
                    <span class="ac-pend-ico"><i class="fas fa-triangle-exclamation" /></span>
                    <div style={{ flex: 1, minWidth: 0 }}>
                      <div class="ac-pend-cap">{meta?.label ?? a.permissionKey}</div>
                      <div class="ac-pend-sub">
                        {meta?.module ?? '—'}
                        {a.requestedByName ? ` · Requested by ${a.requestedByName}` : ''}
                      </div>
                    </div>
                    <div class="ac-pend-date">{timeAgo(a.requestedAt)}</div>
                  </div>
                );
              })}
              <div class="ac-pend-foot">
                <i class="fas fa-circle-info" style={{ color: 'var(--ac-amber)', fontSize: '13px' }} />
                Changes require approval due to high-risk capabilities.
              </div>
            </>
          )}
        </div>
      </div>
    </div>
  );
}

// ── Tab root ──────────────────────────────────────────────────────────────────

type RolesView = 'list' | 'create' | 'edit';

export function RolesTab(): VNode {
  const rolesQ   = useRoles(true);
  const usersQ   = useConsoleUsers(true);
  const del      = useDeleteRole();

  const [view, setView]           = useState<RolesView>('list');
  const [editRole, setEditRole]   = useState<RoleRow | null>(null);
  const [selectedRole, setSelectedRole] = useState<RoleRow | null>(null);
  const [search, setSearch]       = useState('');
  const [activeTab, setActiveTab] = useState<'system' | 'custom'>('system');

  const roles = rolesQ.data ?? [];
  const users = usersQ.data ?? [];

  const byRole = useMemo(() => {
    const m = new Map<string, ConsoleUser[]>();
    for (const u of users) {
      const arr = m.get(u.role) ?? [];
      if (!m.has(u.role)) m.set(u.role, arr);
      arr.push(u);
    }
    return m;
  }, [users]);

  const systemRoles  = useMemo(() => roles.filter(r => r.isSystem),  [roles]);
  const customRoles  = useMemo(() => roles.filter(r => !r.isSystem), [roles]);

  const filteredSystem = useMemo(() => {
    const q = search.toLowerCase().trim();
    return systemRoles.filter(r => !q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [systemRoles, search]);

  const filteredCustom = useMemo(() => {
    const q = search.toLowerCase().trim();
    return customRoles.filter(r => !q || r.label.toLowerCase().includes(q) || r.name.toLowerCase().includes(q));
  }, [customRoles, search]);

  const visibleRoles = activeTab === 'system' ? filteredSystem : filteredCustom;
  const totalCount   = activeTab === 'system' ? filteredSystem.length : filteredCustom.length;

  const handleDelete = useCallback(async (role: RoleRow) => {
    const count = byRole.get(role.name)?.length ?? 0;
    const ok = await confirm({
      title: `Delete "${role.label}"?`,
      message: count > 0
        ? `${count} user(s) still have this role — reassign them first.`
        : 'This permanently deletes the role and all its capability defaults.',
      variant: 'danger',
      confirmLabel: count > 0 ? 'OK' : 'Delete role',
    });
    if (!ok || count > 0) return;
    del.mutate(role.name, {
      onSuccess: res => {
        if (res.success && selectedRole?.name === role.name) setSelectedRole(null);
      },
    });
  }, [byRole, del, selectedRole]);

  // Full-page views
  if (view === 'create') {
    return (
      <div class="ac-scope">
        <CreateRolePage onDone={() => { setView('list'); void rolesQ.refetch(); }} />
      </div>
    );
  }
  if (view === 'edit' && editRole) {
    return (
      <div class="ac-scope">
        <CreateRolePage
          role={editRole}
          onDone={() => { setView('list'); setEditRole(null); void rolesQ.refetch(); }}
        />
      </div>
    );
  }

  // List view
  if (rolesQ.isLoading) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--text-muted)' }}>
        <i class="fas fa-spinner fa-spin" /> Loading roles…
      </div>
    );
  }
  if (rolesQ.isError) {
    return (
      <div style={{ padding: '40px', textAlign: 'center', color: 'var(--ac-red)' }}>
        <i class="fas fa-exclamation-triangle" /> Failed to load roles.
        <button type="button" onClick={() => void rolesQ.refetch()} style={{ marginLeft: '8px', background: 'none', border: 'none', color: 'var(--ac-accent)', cursor: 'pointer', textDecoration: 'underline' }}>Retry</button>
      </div>
    );
  }

  return (
    <div class="ac-scope">
      <div class="ac-rl-layout">

        {/* ── Left rail ── */}
        <div class="ac-card ac-rl-rail">
          {/* Search */}
          <div class="ac-rl-searchbar">
            <div class="ac-rl-searchwrap">
              <i class="fas fa-magnifying-glass" />
              <input
                value={search}
                onInput={e => setSearch((e.target as HTMLInputElement).value)}
                placeholder="Search roles…"
                aria-label="Search roles"
              />
            </div>
          </div>

          {/* System / Custom tabs */}
          <div class="ac-rl-tabs">
            <div class={`ac-rl-tab${activeTab === 'system' ? ' active' : ''}`} onClick={() => setActiveTab('system')}>
              System <span style={{ fontSize: '11px', color: activeTab === 'system' ? 'inherit' : 'var(--ac-faint)', marginLeft: '4px' }}>({systemRoles.length})</span>
            </div>
            <div class={`ac-rl-tab${activeTab === 'custom' ? ' active' : ''}`} onClick={() => setActiveTab('custom')}>
              Custom <span style={{ fontSize: '11px', color: activeTab === 'custom' ? 'inherit' : 'var(--ac-faint)', marginLeft: '4px' }}>({customRoles.length})</span>
            </div>
          </div>

          {/* Role list */}
          <div class="ac-role-list">
            {activeTab === 'custom' && (
              <div class="ac-role-sec-head">
                <span class="ac-role-sec-lbl">Custom Roles</span>
                <button type="button" class="ac-btn sm primary" style={{ height: '28px', fontSize: '12px', padding: '0 10px' }} onClick={() => setView('create')}>
                  <i class="fas fa-plus" style={{ fontSize: '10px' }} /> New Role
                </button>
              </div>
            )}

            {visibleRoles.length === 0 ? (
              <div class="ac-rl-empty">
                {search ? 'No roles match the search.' : activeTab === 'custom' ? 'No custom roles yet. Create one.' : 'No system roles found.'}
              </div>
            ) : visibleRoles.map(r => {
              const style = roleStyle(r.name);
              const count = byRole.get(r.name)?.length ?? r.userCount;
              const isSelected = selectedRole?.name === r.name;
              return (
                <div
                  key={r.name}
                  class={`ac-role-item${isSelected ? ' selected' : ''}`}
                  onClick={() => setSelectedRole(r)}
                >
                  <span class="ac-role-icon" style={{ background: style.bg, color: style.clr }}>
                    <i class={`fas ${style.icon}`} />
                  </span>
                  <div class="ac-role-info">
                    <div class="ac-role-name-row">
                      <span class="ac-role-name">{r.label}</span>
                      <span class={`ac-badge ${r.isSystem ? 'grey' : 'blue'}`} style={{ fontSize: '10.5px', padding: '1px 7px' }}>
                        {r.isSystem ? 'System' : 'Custom'}
                      </span>
                    </div>
                    <div class="ac-role-desc">{r.description || '—'}</div>
                  </div>
                  <span class="ac-role-count">{count} member{count !== 1 ? 's' : ''}</span>
                </div>
              );
            })}
          </div>

          <div class="ac-rl-foot">
            Showing {totalCount} of {roles.length} role{roles.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* ── Right detail ── */}
        {selectedRole ? (
          <RoleDetail
            key={selectedRole.name}
            role={selectedRole}
            members={byRole.get(selectedRole.name) ?? []}
            onEdit={() => { setEditRole(selectedRole); setView('edit'); }}
            onDelete={() => void handleDelete(selectedRole)}
          />
        ) : (
          <div class="ac-rl-empty-detail">
            <i class="fas fa-users-gear" />
            <div style={{ fontWeight: 600, fontSize: '14px', color: 'var(--ac-ink2)', marginTop: '4px' }}>Select a role</div>
            <div style={{ fontSize: '13px' }}>Choose a role from the list to view and manage its capabilities.</div>
          </div>
        )}
      </div>
    </div>
  );
}
