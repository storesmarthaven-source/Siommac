/**
 * tabs/PermissionsTab.tsx — User-level Access Control (Users tab)
 *
 * 3-column layout:
 *   [left rail 280px] [center capability editor 1fr] [right audit timeline 280px]
 *
 * Key changes from previous version:
 *   Vocabulary (canonical model):
 *     Segmented control: "Inherit" (= role default) | "Allow" | "Deny"
 *     Effective badge: "Allowed" | "Denied"
 *     Source badge: "Role Default" | "Override · Allow" | "Override · Deny"
 *     "Restricted" vocabulary dropped entirely.
 *
 *   Buffered saves:
 *     Changes are staged locally (pending map) and NOT written to the DB until
 *     "Save N changes" is clicked. "Discard" reverts to DB state. The sticky action
 *     bar shows the pending count and the Save / Discard buttons.
 *
 *   Per-user audit timeline (right sidebar):
 *     Shows the last 12 permission audit events for the selected user (entity_id filter
 *     added to the backend and AuditLogFilters type).
 *
 * Critical grants still route through the maker-checker flow (immediate — not buffered),
 * to preserve the approval handoff. Non-critical changes are buffered.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useCallback, useEffect } from 'preact/hooks';
import {
  PERMISSION_KEYS, CRITICAL_GRANT_KEYS,
  roleDefaultGranted, permissionState,
  type PermissionState,
} from '@lib/permissions';
import { PERMISSION_META, type PermissionRisk } from '@lib/permissionMeta';
import { toast } from '@store/ui';
import type { UserRole, PermissionOverride } from '@api/schemas/auth';
import type { ConsoleUser, UserPermissionRow, AuditLogRow } from '@lib/superadminApi';
import { setUserPermissionWithReasonApi } from '@lib/superadminApi';
import {
  useConsoleUsers, useUserPermissions, useSetUserPermission, useClearUserPermission,
  useRolePermissions, useAuditLogs,
} from '../hooks';
import { CriticalGrantDialog } from '../CriticalGrantDialog';
import '../ac.css';
import '../rbac.css';

// ── Helpers ───────────────────────────────────────────────────────────────────

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
function timeAgo(iso: string): string {
  const diff = Date.now() - new Date(iso).getTime();
  const m = Math.floor(diff / 60000);
  if (m < 1) return 'Just now';
  if (m < 60) return `${m}m ago`;
  const h = Math.floor(m / 60);
  if (h < 24) return `${h}h ago`;
  return `${Math.floor(h / 24)}d ago`;
}
function auditActionLabel(action: string): string {
  if (action === 'permission_grant') return 'Override · Allow';
  if (action === 'permission_deny')  return 'Override · Deny';
  if (action === 'permission_clear') return 'Override cleared';
  return action.replace(/_/g, ' ');
}
function auditBadgeClass(action: string): string {
  if (action === 'permission_grant') return 'green';
  if (action === 'permission_deny')  return 'red';
  return 'grey';
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

// ── Audit Timeline (right sidebar) ────────────────────────────────────────────

function AuditTimeline({ userId }: { userId: string }): VNode {
  const auditQ = useAuditLogs({ entity: 'user', entity_id: userId, limit: 12 }, !!userId);

  const logs: AuditLogRow[] = auditQ.data?.logs ?? [];

  return (
    <div class="ac-card" style={{ position: 'sticky', top: '8px', maxHeight: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
      <div class="ac-card-head" style={{ flexShrink: 0 }}>
        <div>
          <div class="ac-card-title">Access Changes</div>
          <div class="ac-card-sub">Most recent permission events</div>
        </div>
      </div>
      <div class="ac-ut-timeline">
        {auditQ.isLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
            <i class="fas fa-spinner fa-spin" /> Loading…
          </div>
        ) : logs.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
            <i class="fas fa-circle-info" style={{ display: 'block', fontSize: '18px', color: '#cbd3e0', marginBottom: '6px' }} />
            No permission changes on record for this user.
          </div>
        ) : (
          <div class="ac-ut-tl-group">
            {logs.map(log => {
              let details: Record<string, string> = {};
              try { details = JSON.parse(log.details || '{}'); } catch { /* no-op */ }
              const capKey = details['permission'] ?? '';
              const capMeta = capKey ? PERMISSION_META[capKey as keyof typeof PERMISSION_META] : null;
              return (
                <div key={log.id} class="ac-ut-tl-entry">
                  <div class="ac-ut-tl-meta">
                    <span class={`ac-badge ${auditBadgeClass(log.action)}`} style={{ fontSize: '10px', padding: '1px 6px' }}>
                      {auditActionLabel(log.action).split(' · ')[0]}
                    </span>
                    <span class="ac-ut-tl-time">{timeAgo(log.created_at)}</span>
                  </div>
                  <div class="ac-ut-tl-body">
                    <div class="ac-ut-tl-name">{capMeta?.label ?? capKey}</div>
                    <div class="ac-ut-tl-action">by {log.username}</div>
                    {capMeta && <div class="ac-ut-tl-module">{capMeta.module} · {capMeta.group}</div>}
                  </div>
                </div>
              );
            })}
          </div>
        )}
      </div>
      <div class="ac-ut-audit-info">
        <i class="fas fa-circle-info" style={{ marginRight: '5px' }} />
        Changes here create per-user overrides, not role changes.
      </div>
    </div>
  );
}

// ── Pending change type ───────────────────────────────────────────────────────

interface PendingChange {
  key: string;
  target: PermissionState;
  /** Previous effective DB state (so discard can show what's being reverted). */
  wasState: PermissionState;
}

// ── Capability editor (center pane) ──────────────────────────────────────────

function CapabilityEditor({ user, pendingChanges, setPendingChange }: {
  user: ConsoleUser;
  pendingChanges: Map<string, PendingChange>;
  setPendingChange: (key: string, change: PendingChange | null) => void;
}): VNode {
  const permsQ    = useUserPermissions(user.id);
  const roleQ     = useRolePermissions(user.role);
  const role      = user.role as UserRole;

  const [filter, setFilter] = useState<MatrixFilter>({ module: '', search: '', risk: '' });
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  // Pending locally-submitted critical grants (not yet approved)
  const [localPending, setLocalPending] = useState<Set<string>>(new Set());

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

  // Resolve effective state (pending changes override DB state for display)
  const effState = (key: string): PermissionState => {
    const pending = pendingChanges.get(key);
    return pending ? pending.target : permissionState(key, overrides);
  };
  const effGranted = (key: string): boolean => {
    const st = effState(key);
    if (st === 'default') return roleDefaultGranted(roleSet, key, role);
    return st === 'grant';
  };

  const stage = (key: string, target: PermissionState): void => {
    if (localPending.has(key)) return;
    const wasState = permissionState(key, overrides);
    if (wasState === target) {
      // Back to original DB state — remove the pending change
      setPendingChange(key, null);
      return;
    }
    setPendingChange(key, { key, target, wasState });
  };

  const triggerSet = (key: string, target: PermissionState): void => {
    if (target === 'grant' && CRITICAL_GRANT_KEYS.has(key)) {
      setCriticalKey(key);
      return;
    }
    stage(key, target);
  };

  // Summary (uses effective state for overrides count)
  let fromRole = 0, highRisk = 0;
  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key]; if (!meta) continue;
    const rd = roleDefaultGranted(roleSet, key, role);
    if (rd) fromRole++;
    if (effGranted(key) && (meta.risk === 'high' || meta.risk === 'critical')) highRisk++;
  }
  const overrideCount = (permsQ.data ?? []).length + pendingChanges.size;

  const metaGroups = buildMetaGroups(filter);
  const hasFilter = !!(filter.module || filter.search || filter.risk);

  return (
    <div>
      {criticalKey && (
        <CriticalGrantDialog
          permKey={criticalKey}
          onConfirm={reason => void handleCriticalGrant(criticalKey, reason)}
          onCancel={() => setCriticalKey(null)}
        />
      )}

      {/* User header */}
      <div class="rbac-head" style={{ marginBottom: '16px' }}>
        <Avatar name={user.fullName} src={user.profileImage} cls="rbac-head-avatar" />
        <div class="rbac-head-text">
          <div class="rbac-head-name">{user.fullName}<span class="rbac-head-role">{roleLabel(user.role)}</span></div>
          <div class="rbac-head-note">@{user.username}</div>
        </div>
      </div>

      <div class="rbac-summary" style={{ marginBottom: '14px' }}>
        <div class="rbac-tile"><div class="rbac-tile-lbl">From role</div><div class="rbac-tile-val">{fromRole}</div></div>
        <div class="rbac-tile"><div class="rbac-tile-lbl">Overrides</div><div class="rbac-tile-val">{overrideCount}</div></div>
        <div class="rbac-tile"><div class="rbac-tile-lbl">High-risk held</div><div class="rbac-tile-val">{highRisk}</div></div>
      </div>

      <div class="rbac-filters" style={{ marginBottom: '14px' }}>
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
                      const st   = effState(key);
                      const rd   = roleDefaultGranted(roleSet, key, role);
                      const eff  = effGranted(key);
                      const isPending = localPending.has(key);
                      const isChanged = pendingChanges.has(key);
                      const isBusy = submittingKey === key;
                      return (
                        <div key={key} class={`rbac-row${st !== 'default' ? ' is-override' : ''}${isChanged ? ' is-staged' : ''}`}>
                          <div>
                            <div class="rbac-cap-name">
                              {meta?.label ?? key}
                              {meta && <span class={`rbac-risk ${meta.risk}`}>{meta.risk}</span>}
                              {isChanged && <span class="ac-badge blue" style={{ fontSize: '10px', marginLeft: '5px' }}>Staged</span>}
                            </div>
                            {meta?.description && <div class="rbac-cap-desc">{meta.description}</div>}
                            <div class="rbac-cap-key">{key}</div>
                          </div>
                          <div class="rbac-res">
                            <span class={`rbac-eff ${eff ? 'allowed' : 'denied'}`}>
                              <i class={`fas ${eff ? 'fa-circle-check' : 'fa-circle-minus'}`} />{eff ? 'Allowed' : 'Denied'}
                            </span>
                            <span class={`rbac-src ${st === 'grant' ? 'grant' : st === 'deny' ? 'deny' : 'role'}`}>
                              {st === 'grant' ? 'Override · Allow' : st === 'deny' ? 'Override · Deny' : `Role Default${rd ? ' ✓' : ' ✕'}`}
                            </span>
                            {isPending ? (
                              <span class="rbac-pending"><i class="fas fa-clock" /> Pending approval</span>
                            ) : (
                              <span class="rbac-seg" role="group" aria-label="Set access">
                                <button
                                  type="button"
                                  class={`role${st === 'default' ? ' on' : ''}`}
                                  disabled={isBusy}
                                  onClick={() => triggerSet(key, 'default')}
                                  title={`Role default: ${rd ? 'allowed' : 'denied'}`}
                                >Inherit</button>
                                <button
                                  type="button"
                                  class={`grant${st === 'grant' ? ' on' : ''}`}
                                  disabled={isBusy}
                                  onClick={() => triggerSet(key, 'grant')}
                                >Allow</button>
                                <button
                                  type="button"
                                  class={`deny${st === 'deny' ? ' on' : ''}`}
                                  disabled={isBusy}
                                  onClick={() => triggerSet(key, 'deny')}
                                >Deny</button>
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

// ── Tab root ──────────────────────────────────────────────────────────────────

export function PermissionsTab(): VNode {
  const usersQ = useConsoleUsers(true);
  const [search, setSearch]       = useState('');
  const [roleFilter, setRoleFilter] = useState('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);

  // Buffered changes: Map<permKey, PendingChange>
  const [pendingChanges, setPendingChanges] = useState<Map<string, PendingChange>>(new Map());
  const [saving, setSaving] = useState(false);

  const setPerm   = useSetUserPermission();
  const clearPerm = useClearUserPermission();

  const permsQ = useUserPermissions(selectedId);

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

  // Clear pending changes when user selection changes
  useEffect(() => { setPendingChanges(new Map()); }, [selectedId]);

  const setPendingChange = useCallback((key: string, change: PendingChange | null) => {
    setPendingChanges(prev => {
      const next = new Map(prev);
      if (change === null) next.delete(key);
      else next.set(key, change);
      return next;
    });
  }, []);

  const discard = useCallback(() => {
    setPendingChanges(new Map());
  }, []);

  const saveAll = useCallback(async () => {
    if (!selected || pendingChanges.size === 0 || saving) return;
    setSaving(true);
    const changes = [...pendingChanges.values()];
    try {
      const results = await Promise.allSettled(
        changes.map(c => {
          if (c.target === 'default') {
            return clearPerm.mutateAsync({ userId: selected.id, permission: c.key });
          }
          return setPerm.mutateAsync({ userId: selected.id, permission: c.key, granted: c.target === 'grant' });
        }),
      );
      const failed = results.filter(r => r.status === 'rejected' || (r.status === 'fulfilled' && !r.value.success)).length;
      if (failed > 0) {
        toast.error(`${failed} of ${changes.length} changes failed. Please retry.`);
      } else {
        toast.success(`${changes.length} permission change${changes.length !== 1 ? 's' : ''} saved.`);
        setPendingChanges(new Map());
      }
    } catch {
      toast.error('Failed to save changes. Please retry.');
    } finally {
      setSaving(false);
    }
  }, [selected, pendingChanges, saving, setPerm, clearPerm]);

  if (usersQ.isLoading) return <div class="rbac-loading"><i class="fas fa-spinner fa-spin" /> Loading users…</div>;
  if (usersQ.isError) return (
    <div class="rbac-loading">
      <i class="fas fa-triangle-exclamation" /> Failed to load users.
      <button type="button" onClick={() => void usersQ.refetch()} style={{ color: 'var(--siomac-navy)', textDecoration: 'underline', background: 'none', border: 'none', cursor: 'pointer' }}>Retry</button>
    </div>
  );

  return (
    <div class="ac-scope">
      {/* Stat strip */}
      <div class="ac-stats">
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico blue"><i class="fas fa-users" /></span>
            <div><div class="ac-stat-lbl">Users</div><div class="ac-stat-val">{stats.total}</div><div class="ac-stat-sub">in system</div></div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico green"><i class="fas fa-user-check" /></span>
            <div><div class="ac-stat-lbl">Active</div><div class="ac-stat-val">{stats.enabled}</div><div class="ac-stat-sub">accounts</div></div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico amber"><i class="fas fa-user-lock" /></span>
            <div><div class="ac-stat-lbl">With Overrides</div><div class="ac-stat-val">{stats.overrides}</div><div class="ac-stat-sub">per-user changes</div></div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico purple"><i class="fas fa-user-shield" /></span>
            <div><div class="ac-stat-lbl">Roles in Use</div><div class="ac-stat-val">{stats.roles}</div><div class="ac-stat-sub">distinct roles</div></div>
          </div>
        </div>
      </div>

      {/* 3-column layout */}
      <div class="ac-ut-layout">
        {/* Left: user rail */}
        <div class="ac-card" style={{ position: 'sticky', top: '8px', maxHeight: 'calc(100vh - 200px)', display: 'flex', flexDirection: 'column' }}>
          <div class="rbac-rail-search" style={{ margin: '11px 12px 8px', flex: 'none' }}>
            <i class="fas fa-search" aria-hidden="true" />
            <input type="search" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} placeholder="Find a user…" aria-label="Find a user" />
          </div>
          <div class="rbac-rail-roles" style={{ padding: '0 10px 8px', flex: 'none' }}>
            <button type="button" class={`rbac-rolechip${roleFilter === 'all' ? ' on' : ''}`} onClick={() => setRoleFilter('all')}>All</button>
            {rolesInUse.map(r => <button key={r} type="button" class={`rbac-rolechip${roleFilter === r ? ' on' : ''}`} onClick={() => setRoleFilter(r)}>{roleLabel(r)}</button>)}
          </div>
          <div class="rbac-rail-list" style={{ flex: 1, overflowY: 'auto' }}>
            {filtered.length === 0 ? <div class="rbac-rail-empty">No users match.</div> : filtered.map(u => (
              <button key={u.id} type="button" class={`rbac-rail-item${selectedId === u.id ? ' active' : ''}`}
                onClick={() => setSelectedId(u.id)}>
                <Avatar name={u.fullName} src={u.profileImage} cls="rbac-rail-avatar" />
                <span class="rbac-rail-text">
                  <span class="rbac-rail-name">{u.fullName}</span>
                  <span class="rbac-rail-sub">{roleLabel(u.role)}</span>
                </span>
                <span class="ac-ovr-chip">
                  <span class={`ac-ovr-num${u.overrideCount === 0 ? ' zero' : ''}`}>{u.overrideCount}</span>
                  <span class="ac-ovr-lbl">overrides</span>
                </span>
              </button>
            ))}
          </div>
          <div class="ac-rl-foot">
            {filtered.length} of {users.length} user{users.length !== 1 ? 's' : ''}
          </div>
        </div>

        {/* Center: capability editor */}
        <div>
          {selected ? (
            <>
              <CapabilityEditor
                key={selected.id}
                user={selected}
                pendingChanges={pendingChanges}
                setPendingChange={setPendingChange}
              />
              {/* Sticky action bar */}
              {pendingChanges.size > 0 && (
                <div class="ac-ut-action-bar">
                  <div class="ac-ut-change-count">
                    <span class="ac-badge blue">{pendingChanges.size}</span>
                    unsaved change{pendingChanges.size !== 1 ? 's' : ''}
                  </div>
                  <div style={{ display: 'flex', gap: '8px', alignItems: 'center' }}>
                    <button type="button" class="ac-btn sm" onClick={discard} disabled={saving}>Discard</button>
                    <button type="button" class="ac-btn sm primary" onClick={() => void saveAll()} disabled={saving}>
                      {saving ? <><i class="fas fa-spinner fa-spin" /> Saving…</> : `Save ${pendingChanges.size} change${pendingChanges.size !== 1 ? 's' : ''}`}
                    </button>
                  </div>
                </div>
              )}
            </>
          ) : (
            <div class="rbac-detail-empty"><i class="fas fa-user-shield" /><div>Select a user to view and edit their capabilities.</div></div>
          )}
        </div>

        {/* Right: audit timeline */}
        <div>
          {selected ? (
            <AuditTimeline userId={selected.id} />
          ) : (
            <div class="ac-card" style={{ padding: '24px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
              <i class="fas fa-clock" style={{ fontSize: '20px', color: '#cbd3e0', display: 'block', marginBottom: '6px' }} />
              Select a user to see their access history.
            </div>
          )}
        </div>
      </div>
    </div>
  );
}
