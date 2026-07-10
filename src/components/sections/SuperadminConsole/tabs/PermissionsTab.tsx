/**
 * tabs/PermissionsTab.tsx — Access Control (Users)
 *
 * Subject-first master-detail: a user rail on the left, a capability editor on the
 * right. Every capability row shows the three things that were previously invisible —
 * the ROLE DEFAULT (baseline), the per-user OVERRIDE (if any), and the EFFECTIVE
 * result — with a segmented control to set it (Role default / Grant / Deny). Editing
 * writes a per-user override; "Role default" clears it. Critical grants route through
 * the maker-checker approval flow.
 *
 * Driven by PERMISSION_META + the catalogue, so a new key with metadata appears here.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useCallback } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { Modal } from '@shared/Modal';
import {
  PERMISSION_KEYS, CRITICAL_GRANT_KEYS,
  roleDefaultGranted, permissionState,
  type PermissionState,
} from '@lib/permissions';
import { PERMISSION_META, type PermissionRisk } from '@lib/permissionMeta';
import { toast } from '@store/ui';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';
import type { ConsoleUser, UserPermissionRow } from '@lib/superadminApi';
import { setUserPermissionWithReasonApi } from '@lib/superadminApi';
import {
  useConsoleUsers, useUserPermissions, useSetUserPermission, useClearUserPermission,
  useRolePermissions,
} from '../hooks';
import '../rbac.css';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager', employee: 'Employee',
  hr_manager: 'HR Manager', hr_staff: 'HR Staff', hse_staff: 'HSE Staff',
  finance_manager: 'Finance Manager', finance_staff: 'Finance Staff',
};
const roleLabel = (r: string): string => ROLE_LABEL[r] ?? r;

function initialsOf(name: string): string {
  return (name || '?').split(' ').map(w => w[0]).join('').slice(0, 2).toUpperCase();
}
function Avatar({ name, src, cls }: { name: string; src?: string; cls: string }): VNode {
  if (src) return <span class={cls}><img src={src} alt="" /></span>;
  return <span class={cls}>{initialsOf(name)}</span>;
}

function toOverrides(userId: string, rows: UserPermissionRow[]): PermissionOverride[] {
  return rows.map(r => ({ user_id: userId, permission: r.permission, granted: r.granted, set_by: '', set_at: '' }));
}

/** All distinct module names, in catalogue order. */
const ALL_MODULES: string[] = (() => {
  const seen = new Set<string>(); const out: string[] = [];
  for (const key of PERMISSION_KEYS) { const m = PERMISSION_META[key]?.module; if (m && !seen.has(m)) { seen.add(m); out.push(m); } }
  return out;
})();

type MatrixFilter = { module: string; search: string; risk: PermissionRisk | '' };

function buildMetaGroups(filter: MatrixFilter) {
  const q = filter.search.toLowerCase().trim();
  type GroupEntry = { group: string; keys: typeof PERMISSION_KEYS[number][] };
  const modules = new Map<string, Map<string, GroupEntry>>();
  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key];
    if (!meta) continue;
    if (filter.module && meta.module !== filter.module) continue;
    if (filter.risk && meta.risk !== filter.risk) continue;
    if (q && !key.includes(q) && !meta.label.toLowerCase().includes(q) && !meta.description.toLowerCase().includes(q)) continue;
    if (!modules.has(meta.module)) modules.set(meta.module, new Map());
    const groupMap = modules.get(meta.module)!;
    if (!groupMap.has(meta.group)) groupMap.set(meta.group, { group: meta.group, keys: [] });
    groupMap.get(meta.group)!.keys.push(key);
  }
  return [...modules.entries()].map(([module, groupMap]) => ({ module, groups: [...groupMap.values()] }));
}

// ── Critical-grant reason dialog ──────────────────────────────────────────────

function CriticalGrantDialog({ permKey, onConfirm, onCancel }: {
  permKey: string; onConfirm: (reason: string) => void; onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const meta = PERMISSION_META[permKey as keyof typeof PERMISSION_META];
  const footer = (
    <>
      <button type="button" onClick={onCancel} style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
      <button type="button" onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim()}
        style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', fontSize: '14px', fontWeight: '600', background: reason.trim() ? 'var(--siomac-navy, #1e3a5f)' : '#9ca3af', color: '#fff', cursor: reason.trim() ? 'pointer' : 'not-allowed' }}>Submit for approval</button>
    </>
  );
  return (
    <Modal open onClose={onCancel} title="Critical permission — approval required" size="sm" footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <i class="fas fa-shield-halved" style={{ color: 'var(--siomac-red, #dc2626)', fontSize: '14px' }} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--siomac-red, #dc2626)' }}>Critical permission</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary, #6b7280)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{meta?.label ?? permKey}</strong> is a critical permission. Granting it requires a second superadmin's approval before it takes effect.
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Reason for granting this permission <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          <textarea value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} rows={3} autoFocus
            placeholder="Describe why this grant is necessary and who authorised it…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--border, #d1d5db)', borderRadius: '6px', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg-input, #fff)', color: 'var(--text-primary)' }} />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Shown to the approving superadmin and recorded in the audit log.</div>
        </div>
      </div>
    </Modal>
  );
}

// ── Capability editor (detail pane) ───────────────────────────────────────────

function CapabilityEditor({ user }: { user: ConsoleUser }): VNode {
  const permsQ    = useUserPermissions(user.id);
  const roleQ     = useRolePermissions(user.role);
  const setPerm   = useSetUserPermission();
  const clearPerm = useClearUserPermission();
  const role      = user.role as UserRole;

  const [filter, setFilter] = useState<MatrixFilter>({ module: '', search: '', risk: '' });
  const [localPending, setLocalPending] = useState<Set<string>>(new Set());
  const [criticalKey, setCriticalKey]   = useState<string | null>(null);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const handleCriticalGrant = useCallback(async (key: string, reason: string) => {
    setCriticalKey(null); setSubmittingKey(key);
    try {
      const res = await setUserPermissionWithReasonApi(user.id, key, true, reason);
      if (!res.success) toast.error(res.message ?? 'Failed to submit permission request.');
      else if (res.pending) { setLocalPending(prev => new Set([...prev, key])); toast.success("Submitted for a second superadmin's approval."); }
      else { toast.success(`${key} granted.`); void permsQ.refetch(); }
    } catch { toast.error('Network error. Try again.'); }
    finally { setSubmittingKey(null); }
  }, [user.id, permsQ]);

  if (permsQ.isLoading || roleQ.isLoading) return <div class="rbac-loading"><i class="fas fa-spinner fa-spin" /> Loading capabilities…</div>;
  if (permsQ.isError) return <div class="rbac-loading"><i class="fas fa-triangle-exclamation" /> Failed to load capabilities.</div>;

  const roleSet   = roleQ.data ?? [];
  const overrides = toOverrides(user.id, permsQ.data ?? []);
  const busyKey = (setPerm.isPending && setPerm.variables?.permission) || (clearPerm.isPending && clearPerm.variables?.permission) || null;

  const set = (key: string, target: PermissionState): void => {
    if (localPending.has(key)) return;
    if (permissionState(key, overrides) === target) return; // already in this state — no-op
    if (target === 'default') { clearPerm.mutate({ userId: user.id, permission: key }); return; }
    if (target === 'grant') {
      if (CRITICAL_GRANT_KEYS.has(key)) setCriticalKey(key);
      else setPerm.mutate({ userId: user.id, permission: key, granted: true });
      return;
    }
    setPerm.mutate({ userId: user.id, permission: key, granted: false });
  };

  // Summary across the whole catalogue (not the filtered view).
  let fromRole = 0, highRisk = 0;
  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key]; if (!meta) continue;
    const st = permissionState(key, overrides);
    const rd = roleDefaultGranted(roleSet, key, role);
    if (rd) fromRole++;
    const eff = st === 'default' ? rd : st === 'grant';
    if (eff && (meta.risk === 'high' || meta.risk === 'critical')) highRisk++;
  }
  const overrideCount = (permsQ.data ?? []).length;

  const metaGroups = buildMetaGroups(filter);
  const hasFilter = !!(filter.module || filter.search || filter.risk);

  return (
    <div>
      {criticalKey && <CriticalGrantDialog permKey={criticalKey} onConfirm={reason => void handleCriticalGrant(criticalKey, reason)} onCancel={() => setCriticalKey(null)} />}

      <div class="rbac-head">
        <Avatar name={user.fullName} src={user.profileImage} cls="rbac-head-avatar" />
        <div class="rbac-head-text">
          <div class="rbac-head-name">{user.fullName}<span class="rbac-head-role">{roleLabel(user.role)}</span></div>
          <div class="rbac-head-note">@{user.username} · changes here create a per-user override, not a role change.</div>
        </div>
      </div>

      <div class="rbac-summary">
        <div class="rbac-tile"><div class="rbac-tile-lbl">From role</div><div class="rbac-tile-val">{fromRole}</div></div>
        <div class="rbac-tile"><div class="rbac-tile-lbl">Overrides</div><div class="rbac-tile-val">{overrideCount}</div></div>
        <div class="rbac-tile"><div class="rbac-tile-lbl">High-risk held</div><div class="rbac-tile-val">{highRisk}</div></div>
      </div>

      <div class="rbac-filters">
        <div class="rbac-fsearch">
          <i class="fas fa-search" aria-hidden="true" />
          <input type="search" value={filter.search} onInput={e => setFilter(f => ({ ...f, search: (e.target as HTMLInputElement).value }))} placeholder="Search capability or key…" aria-label="Search capabilities" />
        </div>
        <select class="rbac-fsel" value={filter.module} onChange={e => setFilter(f => ({ ...f, module: (e.target as HTMLSelectElement).value }))} aria-label="Filter by module">
          <option value="">All modules</option>
          {ALL_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
        </select>
        <select class="rbac-fsel" value={filter.risk} onChange={e => setFilter(f => ({ ...f, risk: (e.target as HTMLSelectElement).value as PermissionRisk | '' }))} aria-label="Filter by risk">
          <option value="">All risk</option>
          <option value="low">Low</option><option value="medium">Medium</option><option value="high">High</option><option value="critical">Critical</option>
        </select>
        {hasFilter && <button type="button" class="rbac-fclear" onClick={() => setFilter({ module: '', search: '', risk: '' })}><i class="fas fa-times" /> Clear</button>}
      </div>

      {metaGroups.length === 0 ? (
        <div class="rbac-empty"><i class="fas fa-filter" style={{ display: 'block', fontSize: '18px', marginBottom: '6px' }} />No capabilities match the filters.</div>
      ) : (
        <div class="rbac-caps">
          {metaGroups.map(({ module, groups }) => {
            const count = groups.reduce((n, g) => n + g.keys.length, 0);
            return (
              <div key={module} class="rbac-mod">
                <div class="rbac-mod-head">{module}<span class="rbac-mod-count">{count} shown</span></div>
                {groups.map(({ group, keys }) => (
                  <div key={group}>
                    <div class="rbac-grp-head">{group}</div>
                    {keys.map(key => {
                      const meta = PERMISSION_META[key];
                      const st   = permissionState(key, overrides);
                      const rd   = roleDefaultGranted(roleSet, key, role);
                      const eff  = st === 'default' ? rd : st === 'grant';
                      const pending = localPending.has(key);
                      const busy = busyKey === key || submittingKey === key;
                      return (
                        <div key={key} class={`rbac-row${st !== 'default' ? ' is-override' : ''}`}>
                          <div>
                            <div class="rbac-cap-name">{meta?.label ?? key}{meta && <span class={`rbac-risk ${meta.risk}`}>{meta.risk}</span>}</div>
                            {meta?.description && <div class="rbac-cap-desc">{meta.description}</div>}
                            <div class="rbac-cap-key">{key}</div>
                          </div>
                          <div class="rbac-res">
                            <span class={`rbac-eff ${eff ? 'allowed' : 'denied'}`}><i class={`fas ${eff ? 'fa-circle-check' : 'fa-circle-minus'}`} />{eff ? 'Allowed' : 'Denied'}</span>
                            <span class={`rbac-src ${st === 'grant' ? 'grant' : st === 'deny' ? 'deny' : 'role'}`}>
                              {st === 'grant' ? 'Override · grant' : st === 'deny' ? 'Override · deny' : 'Role default'}
                            </span>
                            {pending ? (
                              <span class="rbac-pending"><i class="fas fa-clock" /> Pending approval</span>
                            ) : (
                              <span class="rbac-seg" role="group" aria-label="Set access">
                                <button type="button" class={`role${st === 'default' ? ' on' : ''}`} disabled={busy} onClick={() => set(key, 'default')} title={`Role default: ${rd ? 'allowed' : 'denied'}`}>Role {rd ? '✓' : '✕'}</button>
                                <button type="button" class={`grant${st === 'grant' ? ' on' : ''}`} disabled={busy} onClick={() => set(key, 'grant')}>Grant</button>
                                <button type="button" class={`deny${st === 'deny' ? ' on' : ''}`} disabled={busy} onClick={() => set(key, 'deny')}>Deny</button>
                              </span>
                            )}
                          </div>
                        </div>
                      );
                    })}
                  </div>
                ))}
              </div>
            );
          })}
        </div>
      )}
    </div>
  );
}

// ── Tab root — master-detail ──────────────────────────────────────────────────

export function PermissionsTab(): VNode {
  const usersQ = useConsoleUsers(true);
  const [search, setSearch] = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  const users = usersQ.data ?? [];

  const rolesInUse = useMemo(() => {
    const seen = new Set<string>(); const out: string[] = [];
    for (const u of users) if (!seen.has(u.role)) { seen.add(u.role); out.push(u.role); }
    return out.sort((a, b) => roleLabel(a).localeCompare(roleLabel(b)));
  }, [users]);

  const filtered = useMemo(() => {
    const q = search.toLowerCase().trim();
    return users.filter(u =>
      (roleFilter === 'all' || u.role === roleFilter) &&
      (!q || u.fullName.toLowerCase().includes(q) || u.username.toLowerCase().includes(q) || (u.email ?? '').toLowerCase().includes(q)),
    ).sort((a, b) => a.fullName.localeCompare(b.fullName));
  }, [users, search, roleFilter]);

  const selected = useMemo(() => users.find(u => u.id === selectedId) ?? null, [users, selectedId]);

  const stats = useMemo(() => ({
    total: users.length,
    enabled: users.filter(u => u.active).length,
    overrides: users.filter(u => u.overrideCount > 0).length,
    roles: rolesInUse.length,
  }), [users, rolesInUse]);

  if (usersQ.isLoading) return <div class="rbac-loading"><i class="fas fa-spinner fa-spin" /> Loading users…</div>;
  if (usersQ.isError) return <div class="rbac-loading"><i class="fas fa-triangle-exclamation" /> Failed to load users. <button type="button" onClick={() => void usersQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button></div>;

  return (
    <div class="rbac">
      <div class="rbac-stats">
        <StatCard icon="fa-users"       label="Users"          value={stats.total}     color="#2563eb" />
        <StatCard icon="fa-user-check"  label="Enabled"        value={stats.enabled}   color="#16a34a" />
        <StatCard icon="fa-user-lock"   label="With overrides" value={stats.overrides} color="#d97706" />
        <StatCard icon="fa-user-shield" label="Roles in use"   value={stats.roles}     color="#7c3aed" />
      </div>

      <div class="rbac-shell">
        <div class="rbac-rail">
          <div class="rbac-rail-search">
            <i class="fas fa-search" aria-hidden="true" />
            <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Find a user…" aria-label="Find a user" />
          </div>
          <div class="rbac-rail-roles">
            <button type="button" class={`rbac-rolechip${roleFilter === 'all' ? ' on' : ''}`} onClick={() => setRoleFilter('all')}>All</button>
            {rolesInUse.map(r => <button key={r} type="button" class={`rbac-rolechip${roleFilter === r ? ' on' : ''}`} onClick={() => setRoleFilter(r)}>{roleLabel(r)}</button>)}
          </div>
          <div class="rbac-rail-list">
            {filtered.length === 0 ? <div class="rbac-rail-empty">No users match.</div> : filtered.map(u => (
              <button key={u.id} type="button" class={`rbac-rail-item${selectedId === u.id ? ' active' : ''}`} onClick={() => setSelectedId(u.id)}>
                <Avatar name={u.fullName} src={u.profileImage} cls="rbac-rail-avatar" />
                <span class="rbac-rail-text">
                  <span class="rbac-rail-name">{u.fullName}</span>
                  <span class="rbac-rail-sub">{roleLabel(u.role)}{u.overrideCount > 0 ? ` · ${u.overrideCount} override${u.overrideCount === 1 ? '' : 's'}` : ''}</span>
                </span>
              </button>
            ))}
          </div>
        </div>

        <div class="rbac-detail">
          {selected
            ? <CapabilityEditor key={selected.id} user={selected} />
            : <div class="rbac-detail-empty"><i class="fas fa-user-shield" /><div>Select a user to view and edit their capabilities.</div></div>}
        </div>
      </div>
    </div>
  );
}
