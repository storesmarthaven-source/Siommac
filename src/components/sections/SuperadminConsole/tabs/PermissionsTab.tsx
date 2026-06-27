/**
 * tabs/PermissionsTab.tsx
 *
 * Per-user RBAC grant matrix. Superadmin picks a user, then sees every
 * capability grouped by Module → Group, each row showing:
 *   - Human label + raw key (muted monospace)
 *   - Risk badge (low / medium / high / critical)
 *   - Tri-state override cell (Default / Grant / Deny)
 *
 * Filter controls: module selector, text search over key+label, risk filter.
 *
 * Clicking a cell cycles Default → Grant → Deny → Default, writing/clearing the
 * override via the backend (which is the real security boundary — see C2).
 *
 * The matrix is driven by PERMISSION_META + the permission catalogue so adding
 * a new key with metadata automatically appears here.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect, useRef, useCallback } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { Modal } from '@shared/Modal';
import {
  PERMISSION_KEYS,
  CRITICAL_GRANT_KEYS,
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

/** Convert override rows → the PermissionOverride[] shape the resolver expects. */
function toOverrides(userId: string, rows: UserPermissionRow[]): PermissionOverride[] {
  return rows.map(r => ({ user_id: userId, permission: r.permission, granted: r.granted, set_by: '', set_at: '' }));
}

// ── Risk badge ────────────────────────────────────────────────────────────────

const RISK_CONFIG: Record<PermissionRisk, { label: string; bg: string; color: string; border: string }> = {
  low:      { label: 'Low',      bg: 'rgba(22,163,74,0.10)',  color: '#14532d',           border: 'rgba(22,163,74,0.3)'  },
  medium:   { label: 'Medium',   bg: 'rgba(234,179,8,0.13)',  color: '#713f12',           border: 'rgba(234,179,8,0.35)' },
  high:     { label: 'High',     bg: 'rgba(234,88,12,0.12)',  color: '#7c2d12',           border: 'rgba(234,88,12,0.35)' },
  critical: { label: 'Critical', bg: 'rgba(220,38,38,0.12)',  color: 'var(--siomac-red)', border: 'rgba(220,38,38,0.4)'  },
};

function RiskBadge({ risk }: { risk: PermissionRisk }): VNode {
  const cfg = RISK_CONFIG[risk];
  return (
    <span style={{
      fontSize: '10.5px', fontWeight: 'var(--font-weight-bold)', padding: '2px 7px', borderRadius: '20px',
      background: cfg.bg, color: cfg.color, border: `1px solid ${cfg.border}`,
      textTransform: 'uppercase', letterSpacing: '0.04em', whiteSpace: 'nowrap', flexShrink: 0,
    }}>
      {cfg.label}
    </span>
  );
}

// ── Critical-grant reason dialog ──────────────────────────────────────────────

function CriticalGrantDialog({ permKey, onConfirm, onCancel }: {
  permKey: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const meta = PERMISSION_META[permKey as keyof typeof PERMISSION_META];

  const footer = (
    <>
      <button
        type="button"
        onClick={onCancel}
        style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}
      >
        Cancel
      </button>
      <button
        type="button"
        onClick={() => reason.trim() && onConfirm(reason.trim())}
        disabled={!reason.trim()}
        style={{
          padding: '8px 20px', borderRadius: '6px', border: 'none', fontSize: '14px', fontWeight: '600',
          background: reason.trim() ? 'var(--siomac-navy, #1e3a5f)' : '#9ca3af',
          color: '#fff', cursor: reason.trim() ? 'pointer' : 'not-allowed',
        }}
      >
        Submit for approval
      </button>
    </>
  );

  return (
    <Modal open onClose={onCancel} title="Critical permission — approval required" size="sm" footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <i class="fas fa-shield-exclamation" style={{ color: 'var(--siomac-red, #dc2626)', fontSize: '14px' }} />
            <span style={{ fontWeight: 'var(--font-weight-bold)', fontSize: '13px', color: 'var(--siomac-red, #dc2626)' }}>Critical permission</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary, #6b7280)', lineHeight: '1.5' }}>
            <strong style={{ color: 'var(--text-primary)' }}>{meta?.label ?? permKey}</strong> is a critical permission.
            Granting it requires a second superadmin's approval before it takes effect.
          </div>
        </div>

        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: '600', color: 'var(--text-primary)', marginBottom: '6px' }}>
            Reason for granting this permission <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          <textarea
            value={reason}
            onInput={e => setReason((e.target as HTMLTextAreaElement).value)}
            placeholder="Describe why this grant is necessary and who authorised it…"
            rows={3}
            style={{
              width: '100%', boxSizing: 'border-box', padding: '8px 10px',
              border: '1px solid var(--border, #d1d5db)', borderRadius: '6px',
              fontSize: '13px', resize: 'vertical', fontFamily: 'inherit',
              background: 'var(--bg-input, #fff)', color: 'var(--text-primary)',
            }}
            autoFocus
          />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>
            This reason will be shown to the approving superadmin and recorded in the audit log.
          </div>
        </div>
      </div>
    </Modal>
  );
}

// ── Tri-state cell ────────────────────────────────────────────────────────────

function StateCell({ state, roleDefault, busy, pending, onCycle }: {
  state: PermissionState; roleDefault: boolean; busy: boolean; pending?: boolean; onCycle: () => void;
}): VNode {
  const effective = state === 'default' ? roleDefault : state === 'grant';

  if (pending) {
    return (
      <button
        type="button"
        onClick={onCycle}
        title="Awaiting a second superadmin's approval — click to review"
        aria-label="Pending approval"
        style={{
          minWidth: '100px', padding: '4px 10px', borderRadius: '40px', cursor: 'default',
          fontSize: '11.5px', fontWeight: '600',
          background: 'rgba(234,179,8,0.13)', color: '#713f12',
          border: '1px solid rgba(234,179,8,0.35)', transition: 'all .12s',
          display: 'flex', alignItems: 'center', gap: '5px',
        }}
      >
        <i class="fas fa-clock" style={{ fontSize: '10px' }} />
        Pending approval
      </button>
    );
  }

  const cfg = {
    default: { label: roleDefault ? 'Default ✓' : 'Default ✕', bg: 'var(--bg-subtle)', color: 'var(--text-muted)', border: 'var(--border)' },
    grant:   { label: 'Grant',  bg: 'rgba(46,125,50,0.12)', color: '#1b5e20',           border: 'rgba(46,125,50,0.4)' },
    deny:    { label: 'Deny',   bg: 'rgba(228,12,12,0.10)', color: 'var(--siomac-red)', border: 'rgba(228,12,12,0.4)' },
  }[state];
  void effective;
  return (
    <button
      type="button"
      onClick={onCycle}
      disabled={busy}
      title={state === 'default' ? `Role default: ${roleDefault ? 'allowed' : 'denied'} — click to override` : `Explicit ${state} — click to change`}
      aria-label={`${state}${state === 'default' ? (roleDefault ? ' (allowed)' : ' (denied)') : ''}`}
      style={{
        minWidth: '80px', padding: '4px 10px', borderRadius: '40px', cursor: busy ? 'wait' : 'pointer',
        fontSize: '11.5px', fontWeight: '600', background: cfg.bg, color: cfg.color,
        border: `1px solid ${cfg.border}`, opacity: busy ? 0.6 : 1, transition: 'all .12s',
      }}
    >
      {busy ? <i class="fas fa-spinner fa-spin" /> : cfg.label}
    </button>
  );
}

// ── Matrix for one user ───────────────────────────────────────────────────────

type MatrixFilter = {
  module: string;       // '' = all
  search: string;
  risk: PermissionRisk | '';
};

/** Build module → group → keys from PERMISSION_META, preserving catalogue order. */
function buildMetaGroups(filter: MatrixFilter) {
  // Keep catalogue order; filter as we go
  const q = filter.search.toLowerCase().trim();

  type GroupEntry = { group: string; keys: typeof PERMISSION_KEYS[number][] };
  const modules = new Map<string, Map<string, GroupEntry>>();

  for (const key of PERMISSION_KEYS) {
    const meta = PERMISSION_META[key];
    if (!meta) continue;

    // Apply filters
    if (filter.module && meta.module !== filter.module) continue;
    if (filter.risk && meta.risk !== filter.risk) continue;
    if (q && !key.includes(q) && !meta.label.toLowerCase().includes(q) && !meta.description.toLowerCase().includes(q)) continue;

    if (!modules.has(meta.module)) modules.set(meta.module, new Map());
    const groupMap = modules.get(meta.module)!;
    if (!groupMap.has(meta.group)) groupMap.set(meta.group, { group: meta.group, keys: [] });
    groupMap.get(meta.group)!.keys.push(key);
  }

  return [...modules.entries()].map(([module, groupMap]) => ({
    module,
    groups: [...groupMap.values()],
  }));
}

/** All distinct module names in catalogue order. */
const ALL_MODULES: string[] = (() => {
  const seen = new Set<string>();
  const out: string[] = [];
  for (const key of PERMISSION_KEYS) {
    const m = PERMISSION_META[key]?.module;
    if (m && !seen.has(m)) { seen.add(m); out.push(m); }
  }
  return out;
})();

function UserMatrix({ user }: { user: ConsoleUser }): VNode {
  const permsQ    = useUserPermissions(user.id);
  const roleQ     = useRolePermissions(user.role);
  const setPerm   = useSetUserPermission();
  const clearPerm = useClearUserPermission();
  const role      = user.role as UserRole;

  const [mFilter, setMFilter]  = useState<MatrixFilter>({ module: '', search: '', risk: '' });

  // Keys that have a pending critical-grant approval (submitted this session).
  const [localPending, setLocalPending] = useState<Set<string>>(new Set());
  // When set, shows the CriticalGrantDialog for the given key.
  const [criticalKey, setCriticalKey]   = useState<string | null>(null);
  // Whether a critical grant is being submitted (after reason entered).
  const [submittingKey, setSubmittingKey] = useState<string | null>(null);

  const handleCriticalGrant = useCallback(async (key: string, reason: string) => {
    setCriticalKey(null);
    setSubmittingKey(key);
    try {
      const res = await setUserPermissionWithReasonApi(user.id, key, true, reason);
      if (!res.success) {
        toast.error(res.message ?? 'Failed to submit permission request.');
      } else if (res.pending) {
        setLocalPending(prev => new Set([...prev, key]));
        toast.success('Submitted for a second superadmin\'s approval.');
      } else {
        // Applied immediately (shouldn't happen for critical, but handle gracefully).
        toast.success(`${key} granted.`);
        void permsQ.refetch();
      }
    } catch {
      toast.error('Network error. Try again.');
    } finally {
      setSubmittingKey(null);
    }
  }, [user.id, permsQ]);

  if (permsQ.isLoading || roleQ.isLoading) return <div class="emp-loading"><i class="fas fa-spinner fa-spin" /> Loading permissions…</div>;
  if (permsQ.isError)   return <div class="emp-loading emp-err"><i class="fas fa-exclamation-triangle" /> Failed to load permissions.</div>;

  const roleSet   = roleQ.data ?? [];
  const overrides = toOverrides(user.id, permsQ.data ?? []);
  const mutPendingKey = (setPerm.isPending && setPerm.variables?.permission)
    || (clearPerm.isPending && clearPerm.variables?.permission) || null;

  function cycle(key: string, cur: PermissionState) {
    // If this key already has a pending approval, don't allow another cycle.
    if (localPending.has(key)) return;

    if (cur === 'default') {
      // Granting — check if critical.
      if (CRITICAL_GRANT_KEYS.has(key)) {
        setCriticalKey(key);
      } else {
        setPerm.mutate({ userId: user.id, permission: key, granted: true });
      }
    } else if (cur === 'grant') {
      // Denying — never critical, proceed directly.
      setPerm.mutate({ userId: user.id, permission: key, granted: false });
    } else {
      // Clearing override — always safe.
      clearPerm.mutate({ userId: user.id, permission: key });
    }
  }

  const metaGroups = buildMetaGroups(mFilter);
  const totalVisible = metaGroups.reduce((n, m) => n + m.groups.reduce((g, gr) => g + gr.keys.length, 0), 0);
  const overrideCount = (permsQ.data ?? []).length;

  return (
    <div>
      {/* Critical-grant reason dialog */}
      {criticalKey && (
        <CriticalGrantDialog
          permKey={criticalKey}
          onConfirm={reason => void handleCriticalGrant(criticalKey, reason)}
          onCancel={() => setCriticalKey(null)}
        />
      )}

      {/* User header */}
      <div class="stg-switch-group" style={{ padding: '12px 0', borderBottom: '1px solid var(--border)', marginBottom: '12px' }}>
        <div>
          <div class="stg-switch-label">
            {user.fullName}
            <span style={{ marginLeft: '8px', fontSize: '11px', background: 'rgba(27,45,84,0.08)', color: 'var(--siomac-navy)', padding: '2px 8px', borderRadius: '10px', fontWeight: '600' }}>
              {ROLE_LABEL[user.role] ?? user.role}
            </span>
          </div>
          <div class="stg-switch-desc">@{user.username} — {overrideCount > 0 ? `${overrideCount} explicit override${overrideCount === 1 ? '' : 's'}` : 'No explicit overrides — all permissions follow role defaults.'}</div>
        </div>
      </div>

      {/* Matrix filters */}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap', marginBottom: '14px', alignItems: 'center' }}>
        <div class="vt-search" style={{ flex: '1 1 180px' }}>
          <i class="fas fa-search" aria-hidden="true" />
          <input
            type="search"
            value={mFilter.search}
            onInput={e => setMFilter(f => ({ ...f, search: (e.target as HTMLInputElement).value }))}
            placeholder="Search key or label…"
            aria-label="Search permissions"
          />
        </div>
        <label class="vt-chip" style={{ cursor: 'default' }}>
          <i class="fas fa-layer-group vt-chip-icon" />
          <select
            value={mFilter.module}
            onChange={e => setMFilter(f => ({ ...f, module: (e.target as HTMLSelectElement).value }))}
            aria-label="Filter by module"
            style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">All Modules</option>
            {ALL_MODULES.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
        </label>
        <label class="vt-chip" style={{ cursor: 'default' }}>
          <i class="fas fa-shield-halved vt-chip-icon" />
          <select
            value={mFilter.risk}
            onChange={e => setMFilter(f => ({ ...f, risk: (e.target as HTMLSelectElement).value as PermissionRisk | '' }))}
            aria-label="Filter by risk"
            style={{ border: 'none', background: 'transparent', font: 'inherit', color: 'inherit', cursor: 'pointer', outline: 'none' }}
          >
            <option value="">All Risk Levels</option>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        {(mFilter.module || mFilter.search || mFilter.risk) && (
          <button type="button" class="btn btn-sm btn-outline-secondary" onClick={() => setMFilter({ module: '', search: '', risk: '' })}>
            <i class="fas fa-times" /> Clear
          </button>
        )}
      </div>

      {metaGroups.length === 0 ? (
        <div class="emp-empty" style={{ padding: '24px', textAlign: 'center', color: 'var(--text-muted)' }}>
          <i class="fas fa-filter" style={{ fontSize: '20px', marginBottom: '8px', display: 'block' }} />
          No permissions match the current filters.
        </div>
      ) : (
        <>
          <div class="stg-switch-desc" style={{ marginBottom: '10px' }}>
            Showing {totalVisible} permission{totalVisible === 1 ? '' : 's'}
          </div>
          {metaGroups.map(({ module, groups }) => (
            <div key={module} style={{ marginBottom: '24px' }}>
              {/* Module header */}
              <div style={{
                display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '10px',
                paddingBottom: '6px', borderBottom: '2px solid var(--border)',
              }}>
                <span style={{
                  fontSize: '11px', fontWeight: '800', textTransform: 'uppercase', letterSpacing: '0.07em',
                  color: 'var(--siomac-navy)',
                }}>{module}</span>
              </div>

              {groups.map(({ group, keys }) => (
                <div key={group} style={{ marginBottom: '12px' }}>
                  {/* Group subheader */}
                  <div class="stg-switch-desc" style={{
                    fontWeight: '600', textTransform: 'uppercase', letterSpacing: '0.05em',
                    marginBottom: '6px', fontSize: '10.5px', color: 'var(--text-muted)',
                  }}>
                    {group}
                  </div>
                  <div style={{ background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: 'var(--radius-md)', overflow: 'hidden' }}>
                    {keys.map((key, idx) => {
                      const meta    = PERMISSION_META[key];
                      const st      = permissionState(key, overrides);
                      const def     = roleDefaultGranted(roleSet, key, role);
                      const isPendingApproval = localPending.has(key);
                      return (
                        <div
                          key={key}
                          style={{
                            display: 'flex', alignItems: 'center', gap: '10px', padding: '9px 14px',
                            borderBottom: idx < keys.length - 1 ? '1px solid var(--border)' : 'none',
                            background: isPendingApproval ? 'rgba(234,179,8,0.05)' : undefined,
                          }}
                        >
                          {/* Label + key */}
                          <div style={{ flex: 1, minWidth: 0 }}>
                            <div style={{ fontSize: '13px', color: 'var(--text-primary)', fontWeight: '500' }}>
                              {meta?.label ?? key}
                            </div>
                            {meta?.description && (
                              <div class="stg-switch-desc" style={{ marginTop: '1px', fontSize: '11.5px' }}>
                                {meta.description}
                              </div>
                            )}
                            <div style={{ fontFamily: 'monospace', fontSize: '10.5px', color: 'var(--text-muted)', marginTop: '2px' }}>
                              {key}
                            </div>
                          </div>
                          {/* Risk badge */}
                          {meta && <RiskBadge risk={meta.risk} />}
                          {/* Override cell */}
                          <StateCell
                            state={st}
                            roleDefault={def}
                            busy={mutPendingKey === key || submittingKey === key}
                            pending={isPendingApproval}
                            onCycle={() => cycle(key, st)}
                          />
                        </div>
                      );
                    })}
                  </div>
                </div>
              ))}
            </div>
          ))}
        </>
      )}
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
