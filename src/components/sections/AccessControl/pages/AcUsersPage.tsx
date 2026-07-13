/**
 * src/components/sections/AccessControl/pages/AcUsersPage.tsx
 *
 * Access Control — Users (reproduces rbac-mockups/users.html): per-user capability
 * overrides. Three columns — user rail · capability editor (Role Default / User
 * Override / Effective / Source, buffered saves) · recent-override timeline. Wired
 * to the real console hooks; critical ALLOW grants route through maker-checker.
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect, useCallback } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import {
  useConsoleUsers, useUserPermissions, useRolePermissions,
  useSetUserPermission, useClearUserPermission, useAuditLogs,
} from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { CriticalGrantDialog } from '@sections/SuperadminConsole/CriticalGrantDialog';
import { setUserPermissionWithReasonApi } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META, type PermissionRisk } from '@lib/permissionMeta';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { TableSearch, FilterDropdown, AdvancedFilter, useFilterDropdowns, PageHeader } from '@ui';
import { toast } from '@store/ui';
import { AcExportDrawer } from './AcExportDrawer';
import { AcCreateRolePage } from './AcCreateRolePage';

// Lucide glyph per capability module; a single neutral chip colour for all (set in CSS).
const MODULE_LUCIDE: Record<string, LucideName> = {
  HR: 'Users', Employees: 'Contact', 'Attendance & Leave': 'CalendarCheck', Payroll: 'Banknote',
  Finance: 'Landmark', HSE: 'HardHat', 'Sites & Map': 'Map', Calendar: 'CalendarDays',
  Workflow: 'Workflow', Tickets: 'Ticket', Communications: 'MessageSquare', Auth: 'KeyRound',
  Settings: 'Settings', System: 'Server', 'User Management': 'UserCog', Dashboard: 'LayoutDashboard',
};
const moduleLucide = (m: string): LucideName => MODULE_LUCIDE[m] ?? 'Box';

type OvState = 'inherit' | 'allow' | 'deny';
const PAGE = 8;

const AVATAR_BG = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#16a34a', '#6b7280'];
const bgFor = (s: string) => AVATAR_BG[Array.from(s).reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_BG.length]!;
const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();

// Compact relative time for the override feed (e.g. "just now", "12m", "3h", "2d", else a date).
const timeAgo = (iso: string): string => {
  const then = new Date(iso).getTime();
  if (!Number.isFinite(then)) return '';
  const s = Math.max(0, Math.round((Date.now() - then) / 1000));
  if (s < 45) return 'just now';
  const m = Math.round(s / 60); if (m < 60) return `${m}m ago`;
  const h = Math.round(m / 60); if (h < 24) return `${h}h ago`;
  const d = Math.round(h / 24); if (d < 7) return `${d}d ago`;
  return new Date(iso).toLocaleDateString('en-US', { month: 'short', day: 'numeric' });
};


const CapCell = ({ allow }: { allow: boolean }): VNode =>
  allow ? <span class="cap-allow"><i class="fas fa-check" /> Allow</span>
        : <span class="cap-deny"><i class="fas fa-xmark" /> Deny</span>;

export function AcUsersPage(): VNode {
  const qc = useQueryClient();
  const usersQ = useConsoleUsers(true);
  const users = usersQ.data ?? [];

  const [selId, setSelId]       = useState<string | null>(null);
  const [railSearch, setRail]   = useState('');
  const [page, setPage]         = useState(1);
  const [filter, setFilter]     = useState<{ modules: string[]; risks: string[]; effective: string[]; overridden: string[]; search: string }>({ modules: [], risks: [], effective: [], overridden: [], search: '' });
  const { openId, setOpenId }   = useFilterDropdowns();
  const [pending, setPending]   = useState<Map<string, OvState>>(new Map());
  const [localPending, setLocal] = useState<Set<string>>(new Set());
  // Start with every module collapsed.
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean) as string[]));
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [showExport, setShowExport] = useState(false);
  const [creatingRole, setCreatingRole] = useState(false);

  useEffect(() => { if (!selId && users.length) setSelId(users[0]!.id); }, [users, selId]);
  useEffect(() => { setPending(new Map()); setLocal(new Set()); }, [selId]);

  // Resolve an audit actor (by username) → their profile photo / display name for the feed.
  const usersByUsername = useMemo(() => {
    const m = new Map<string, typeof users[number]>();
    for (const u of users) m.set(u.username.toLowerCase(), u);
    return m;
  }, [users]);

  const user   = users.find(u => u.id === selId) ?? null;
  const permsQ = useUserPermissions(selId);
  const roleQ  = useRolePermissions(user?.role ?? null);
  const auditQ = useAuditLogs(selId ? { entity_id: selId, limit: 40 } : {}, !!selId);

  const roleSet = roleQ.data ?? [];
  const dbOverride = useCallback((k: string): boolean | undefined => permsQ.data?.find(p => p.permission === k)?.granted, [permsQ.data]);
  const roleDefault = useCallback((k: string) => user?.role === 'superadmin' || roleSet.includes(k), [user?.role, roleSet]);
  const target = useCallback((k: string): OvState => {
    const p = pending.get(k); if (p) return p;
    const o = dbOverride(k); return o === true ? 'allow' : o === false ? 'deny' : 'inherit';
  }, [pending, dbOverride]);
  const effGranted = useCallback((k: string) => { const t = target(k); return t === 'inherit' ? roleDefault(k) : t === 'allow'; }, [target, roleDefault]);

  // Filtered user rail
  const railUsers = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    return users.filter(u => !q || u.fullName.toLowerCase().includes(q) || u.role.toLowerCase().includes(q));
  }, [users, railSearch]);
  const pageCount = Math.max(1, Math.ceil(railUsers.length / PAGE));
  const pageUsers = railUsers.slice((page - 1) * PAGE, page * PAGE);
  useEffect(() => { if (page > pageCount) setPage(1); }, [pageCount, page]);

  // Capabilities grouped by module (filtered)
  const groups = useMemo(() => {
    const byMod = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      const m = PERMISSION_META[k]; if (!m) continue;
      if (filter.modules.length && !filter.modules.includes(m.module)) continue;
      if (filter.risks.length && !filter.risks.includes(m.risk)) continue;
      if (filter.effective.length && !filter.effective.includes(effGranted(k) ? 'allow' : 'deny')) continue;
      if (filter.overridden.length && !filter.overridden.includes(target(k) !== 'inherit' ? 'overridden' : 'default')) continue;
      if (filter.search && !m.label.toLowerCase().includes(filter.search.toLowerCase())) continue;
      (byMod.get(m.module) ?? byMod.set(m.module, []).get(m.module)!).push(k);
    }
    return byMod;
  }, [filter, effGranted, target]);
  const allModules = useMemo(() => [...new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean))] as string[], []);

  const stats = useMemo(() => ({
    overrides: PERMISSION_KEYS.filter(k => target(k) !== 'inherit').length,
    highRisk:  PERMISSION_KEYS.filter(k => effGranted(k) && CRITICAL_GRANT_KEYS.has(k)).length,
    effective: PERMISSION_KEYS.filter(k => effGranted(k)).length,
  }), [target, effGranted]);

  // Pending-changes tallies for the action-bar chips.
  const pendAllow = [...pending.values()].filter(v => v === 'allow').length;
  const pendDeny  = [...pending.values()].filter(v => v === 'deny').length;

  const onSelect = (key: string, value: OvState) => {
    if (value === 'allow' && CRITICAL_GRANT_KEYS.has(key) && !effGranted(key)) { setCriticalKey(key); return; }
    setPending(prev => {
      const n = new Map(prev);
      const o = dbOverride(key); const dbState: OvState = o === true ? 'allow' : o === false ? 'deny' : 'inherit';
      if (value === dbState) n.delete(key); else n.set(key, value);
      return n;
    });
  };

  const setPerm = useSetUserPermission();
  const clearPerm = useClearUserPermission();
  const save = async () => {
    if (!selId || !pending.size) return;
    setSaving(true);
    try {
      for (const [key, val] of pending) {
        if (val === 'inherit') await clearPerm.mutateAsync({ userId: selId, permission: key });
        else await setPerm.mutateAsync({ userId: selId, permission: key, granted: val === 'allow' });
      }
      setPending(new Map()); void permsQ.refetch(); void usersQ.refetch();
    } finally { setSaving(false); }
  };

  const submitCritical = async (reason: string) => {
    const key = criticalKey; setCriticalKey(null);
    if (!key || !selId) return;
    const res = await setUserPermissionWithReasonApi(selId, key, true, reason);
    if (!res.success) toast.error(res.message ?? 'Failed to submit request.');
    else if (res.pending) { setLocal(prev => new Set([...prev, key])); void qc.invalidateQueries({ queryKey: consoleKeys.approvals('pending') }); toast.success("Submitted for a second superadmin's approval."); }
    else { toast.success(`${key} granted.`); void permsQ.refetch(); }
  };

  const toggleMod = (m: string) => setCollapsed(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });

  return (
    <div class="acx">
      <PageHeader
        icon={<LucideIcon name="UserRoundCog" size={22} />}
        module="Access Control"
        title="User Access"
        sub="Manage per-user access exceptions. Changes apply only to this user and do not modify role permissions."
        actions={<>
          <button type="button" class="acx-hdr-btn" disabled title="Export coming soon">
            <LucideIcon name="Download" size={15} /> Export
          </button>
          <button type="button" class="acx-hdr-btn primary" onClick={() => setCreatingRole(true)}>
            <LucideIcon name="Plus" size={15} /> New Role
          </button>
        </>}
      />

      <div class="u-layout">
        {/* LEFT COLUMN — user rail + Recent Override Changes stacked below it */}
        <div class="u-left">
        {/* LEFT RAIL */}
        <div class="card u-rail">
          <div class="u-rail-head">
            <span style={{ fontSize: '14px', fontWeight: 700, display: 'inline-flex', alignItems: 'center', gap: '8px' }}>
              <LucideIcon name="BookUser" size={16} strokeWidth={2} />
              Directory <span class="muted" style={{ fontWeight: 500 }}>({users.length})</span>
            </span>
          </div>
          <div class="u-rail-search"><i class="fas fa-magnifying-glass" /><input class="input" placeholder="Search directory…" value={railSearch} onInput={e => { setRail((e.target as HTMLInputElement).value); setPage(1); }} /></div>
          <div class="u-user-list">
            {usersQ.isLoading ? <div class="ac-loading">Loading users…</div>
             : pageUsers.length === 0 ? <div class="ac-empty">No users match.</div>
             : pageUsers.map(u => (
              <div key={u.id} class={`u-user-item${u.id === selId ? ' selected' : ''}`} onClick={() => setSelId(u.id)}>
                <span class="avatar" style={{ width: '36px', height: '36px', fontSize: '12px', background: bgFor(u.fullName) }}>{u.profileImage ? <img src={u.profileImage} alt="" /> : initials(u.fullName)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div class="u-user-name">{u.fullName}</div>
                  <div class="u-user-sub">{u.role.replace(/_/g, ' ')}{u.department ? ` · ${u.department}` : ''}</div>
                </div>
                <div class={`u-ovr${u.overrideCount === 0 ? ' zero' : ''}`}>
                  <span class="u-ovr-num">{u.overrideCount}</span>
                  <span class="u-ovr-lbl">Override{u.overrideCount === 1 ? '' : 's'}</span>
                </div>
              </div>
            ))}
          </div>
          {pageCount > 1 && (
            <div class="u-pager">
              <button class="u-pager-btn" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}>‹</button>
              {Array.from({ length: pageCount }, (_, i) => i + 1).slice(0, 5).map(n => (
                <button key={n} class={`u-pager-btn${n === page ? ' active' : ''}`} onClick={() => setPage(n)}>{n}</button>
              ))}
              {pageCount > 5 && <span class="u-pager-ell">…</span>}
              <button class="u-pager-btn" disabled={page === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}>›</button>
            </div>
          )}
        </div>

        {/* Recent Override Changes — same design as Overview's Recent Access Changes */}
        <div class="card">
          <div class="card-head">
            <div class="u-recent-title"><LucideIcon name="History" size={15} /> Recent Override Changes</div>
            <span class="link" onClick={() => { try { window.dispatchEvent(new CustomEvent('siomac:section', { detail: 's-ac-audit' })); } catch (_) { /* ignore */ } }}>View all</span>
          </div>
          {auditQ.isLoading ? <div class="ac-loading">Loading…</div>
           : (auditQ.data?.logs ?? []).length === 0 ? <div class="ac-empty">No recent override changes.</div>
           : (
            <div class="rc2-scroll">
              {(auditQ.data!.logs as { id: string; username: string; action: string; details: string; created_at: string; actorName?: string; actorPhoto?: string; actorTitle?: string }[]).map(l => {
                let d: { permission?: string; reason?: string } = {}; try { d = JSON.parse(l.details || '{}') as typeof d; } catch { /* plain text */ }
                const perm = d.permission ?? '';
                const reason = d.reason ?? '';
                const meta = perm ? PERMISSION_META[perm as PermissionKey] : undefined;
                const label = meta ? meta.label : perm;
                const actor = usersByUsername.get(l.username.toLowerCase());
                const name = l.actorName || actor?.fullName || l.username;
                const photo = l.actorPhoto || actor?.profileImage || '';
                const subtitle = l.actorTitle || actor?.position || (actor ? actor.role.replace(/_/g, ' ') : '');
                const k = l.action === 'permission_grant' ? { tone: 'green', icon: 'Check' as LucideName, verb: 'Allowed' }
                        : l.action === 'permission_deny'  ? { tone: 'red',   icon: 'X' as LucideName, verb: 'Denied' }
                        : { tone: 'slate', icon: 'RotateCcw' as LucideName, verb: 'Reset' };
                return (
                  <div class="rc2-item" key={l.id}>
                    <span class="rc2-avwrap">
                      {photo
                        ? <img class="rc2-photo" src={photo} alt="" loading="lazy" />
                        : <span class="rc2-photo rc2-photo--init">{initials(name)}</span>}
                      <span class={`rc2-badge tone-${k.tone}`}><LucideIcon name={k.icon} size={10} strokeWidth={2.6} /></span>
                    </span>
                    <div class="rc2-body">
                      <div class="rc2-top"><span class="rc2-nm" title={name}>{name}</span><span class="rc2-time">{timeAgo(l.created_at)}</span></div>
                      {subtitle && <div class="rc2-role">{subtitle}</div>}
                      <div class={`rc2-act tone-${k.tone}`} title={label}>{k.verb}{label ? ` · ${label}` : ''}</div>
                      {meta && (
                        <div class="rc2-meta">
                          <span class="rc2-mod">{meta.module}</span>
                          <span class={`rc2-risk r-${meta.risk}`}>{meta.risk} risk</span>
                        </div>
                      )}
                      {reason && <div class="rc2-reason" title={reason}>“{reason}”</div>}
                    </div>
                  </div>
                );
              })}
            </div>
          )}
        </div>
        </div>{/* end u-left */}

        {/* CENTER */}
        <div class="u-center">
          {!user ? <div class="card"><div class="ac-empty">Select a user to edit their access.</div></div> : (
            <>
              <div class="u-prof-card">
                <div class="u-prof-top">
                  <span class="u-prof-title"><LucideIcon name="ShieldCheck" size={16} /> Access Profile</span>
                </div>
                <div class="u-prof-main">
                  <div class="u-prof-entity">
                    <span class="u-prof-photo" style={user.profileImage ? undefined : { background: bgFor(user.fullName) }}>
                      {user.profileImage ? <img src={user.profileImage} alt="" /> : initials(user.fullName)}
                    </span>
                    <div class="u-prof-id">
                      <div class="u-prof-name-line">
                        <h2 class="u-prof-name">{user.fullName}</h2>
                        <span class={`u-prof-badge${user.active ? '' : ' off'}`}><i class="fas fa-circle" /> {user.active ? 'Active' : 'Disabled'}</span>
                      </div>
                      <div class="u-prof-ref">{user.role.replace(/_/g, ' ')}</div>
                      <div class="u-prof-meta">
                        {user.position && <span><LucideIcon name="Briefcase" size={14} /> {user.position}</span>}
                        {(user.email || user.username) && <span><LucideIcon name="Mail" size={14} /> {user.email || user.username}</span>}
                      </div>
                    </div>
                  </div>
                  <div class="u-prof-stats">
                    <div class="u-prof-stat"><span class="u-prof-stat-ic"><LucideIcon name="TableProperties" size={15} /></span><div><div class="u-prof-stat-n">{stats.overrides}</div><div class="u-prof-stat-l">Overrides</div></div></div>
                    <div class="u-prof-stat"><span class="u-prof-stat-ic red"><LucideIcon name="ShieldAlert" size={15} /></span><div><div class="u-prof-stat-n">{stats.highRisk}</div><div class="u-prof-stat-l">High-Risk</div></div></div>
                    <div class="u-prof-stat"><span class="u-prof-stat-ic green"><LucideIcon name="CircleCheck" size={15} /></span><div><div class="u-prof-stat-n">{stats.effective}</div><div class="u-prof-stat-l">Effective</div></div></div>
                  </div>
                </div>
              </div>

              <div class="u-info-banner">
                <span class="u-info-ico"><LucideIcon name="Info" size={18} strokeWidth={2.2} /></span>
                <div class="u-info-txt">
                  <div class="u-info-title">You're editing user-level overrides</div>
                  <div class="u-info-sub">Changes apply only to this user — the underlying role is unchanged.</div>
                </div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <TableSearch value={filter.search} onChange={v => setFilter(f => ({ ...f, search: v }))} placeholder="Search capabilities…" />
                </div>
                <FilterDropdown id="u-mod" label="Module" openId={openId} setOpenId={setOpenId}
                  options={allModules} selected={filter.modules} onChange={v => setFilter(f => ({ ...f, modules: v }))} />
                <FilterDropdown id="u-risk" label="Risk" openId={openId} setOpenId={setOpenId}
                  options={['low', 'medium', 'high', 'critical']} selected={filter.risks} onChange={v => setFilter(f => ({ ...f, risks: v }))}
                  labelFn={r => r[0]!.toUpperCase() + r.slice(1)} />
                <AdvancedFilter openId={openId} setOpenId={setOpenId}
                  onReset={() => setFilter(f => ({ ...f, effective: [], overridden: [] }))}
                  tabs={[{ name: 'Access', blurb: 'Filter by effective result and override status.', sections: [
                    { type: 'checklist', title: 'Effective result', options: ['allow', 'deny'], selected: filter.effective, onChange: v => setFilter(f => ({ ...f, effective: v })), labelFn: v => v[0]!.toUpperCase() + v.slice(1) },
                    { type: 'checklist', title: 'Override status', options: ['overridden', 'default'], selected: filter.overridden, onChange: v => setFilter(f => ({ ...f, overridden: v })), labelFn: v => v === 'overridden' ? 'User override' : 'Role default' },
                  ] }]} />
              </div>

              <div class="card" style={{ overflow: 'hidden' }}>
                <div class="u-tbl-top">
                  <span class="u-tbl-count">{groups.size} module{groups.size === 1 ? '' : 's'} · {[...groups.values()].reduce((n, a) => n + a.length, 0)} capabilities</span>
                </div>
                <table class="tbl" style={{ tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: '30%' }} /><col style={{ width: '14%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /><col style={{ width: '52px' }} /></colgroup>
                  <thead><tr><th>Capability</th><th>Role Default</th><th>User Override</th><th>Effective Result</th><th>Source</th><th style={{ textAlign: 'center' }}>Reset</th></tr></thead>
                  <tbody>
                    {[...groups.entries()].map(([mod, keys]) => {
                      const open = !collapsed.has(mod);
                      return (
                        <>
                          <tr class="grp" key={`g-${mod}`}>
                            <td colSpan={6} style={{ padding: '12px 18px', cursor: 'pointer' }} onClick={() => toggleMod(mod)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                                <span style={{ color: 'var(--faint)', width: '14px', display: 'inline-flex', flex: 'none' }}><LucideIcon name={open ? 'Minus' : 'Plus'} size={14} strokeWidth={2.5} /></span>
                                <span class="u-mod-ico"><LucideIcon name={moduleLucide(mod)} size={15} /></span>
                                <span class="u-mod-name">{mod}</span>
                                <span class="u-mod-count">{keys.length}</span>
                              </span>
                            </td>
                          </tr>
                          {open && keys.map((k, i) => {
                            const t = target(k); const ov = t !== 'inherit'; const submitted = localPending.has(k);
                            return (
                              <tr key={k} class={`u-sub${ov ? ' u-row-override' : ''}`}>
                                <td class={`u-cap-cell${i === keys.length - 1 ? ' is-last' : ''}`}>
                                  <div class="u-cap-name">{PERMISSION_META[k].label}{CRITICAL_GRANT_KEYS.has(k) && <span class="risk critical" style={{ marginLeft: '8px', fontSize: '10px' }}>Critical</span>}</div>
                                  <div class="u-cap-desc">{PERMISSION_META[k].description}</div>
                                </td>
                                <td><CapCell allow={roleDefault(k)} /></td>
                                <td>
                                  {submitted ? <span class="badge amber" style={{ fontSize: '11px' }}>Pending approval</span> : (
                                    <select class={`u-cap-sel${t === 'allow' ? ' u-cap-sel--allow' : t === 'deny' ? ' u-cap-sel--deny' : ''}`} value={t} onChange={e => onSelect(k, (e.target as HTMLSelectElement).value as OvState)}>
                                      <option value="inherit">Inherit</option>
                                      <option value="allow">Allow</option>
                                      <option value="deny">Deny</option>
                                    </select>
                                  )}
                                </td>
                                <td><span class="cap-eff"><CapCell allow={effGranted(k)} />{ov && <span class="cap-eff-you" title="User override"><i class="fas fa-user" style={{ fontSize: '11px' }} /></span>}</span></td>
                                <td><span class={`u-src${ov ? ' ovr' : ''}`}>{ov ? 'User Override (You)' : 'Role Default'}</span></td>
                                <td style={{ textAlign: 'center' }}><button class={`u-reset-btn${ov ? ' u-reset-btn-ovr' : ''}`} disabled={!ov || submitted} onClick={() => onSelect(k, 'inherit')}><i class="fas fa-rotate-right" style={{ fontSize: '12px' }} /></button></td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}
                    {groups.size === 0 && <tr><td colSpan={6}><div class="ac-empty">No capabilities match the filters.</div></td></tr>}
                  </tbody>
                </table>
              </div>

              <div class="u-action-bar">
                <div class="u-ab-lead">
                  <span class="u-ab-ico"><i class="fas fa-triangle-exclamation" /></span>
                  <div>
                    <div class="u-ab-title">{pending.size} Pending Change{pending.size === 1 ? '' : 's'}</div>
                    <div class="u-ab-sub">Review and save your changes</div>
                  </div>
                </div>
                <div class="u-ab-chips">
                  <span class="u-ab-chip green">
                    <span class="u-ab-num">{pendAllow}</span>
                    <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Permission{pendAllow === 1 ? '' : 's'}</span><span class="u-ab-chip-val">Allow</span></span>
                  </span>
                  <span class="u-ab-chip red">
                    <span class="u-ab-num">{pendDeny}</span>
                    <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Permission{pendDeny === 1 ? '' : 's'}</span><span class="u-ab-chip-val">Deny</span></span>
                  </span>
                  <span class="u-ab-chip neutral">
                    <span class="u-ab-num">{pending.size}</span>
                    <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Total</span><span class="u-ab-chip-val">Changes</span></span>
                  </span>
                </div>
                <div class="u-ab-actions">
                  <button class="btn" disabled={!pending.size || saving} onClick={() => setPending(new Map())}>Discard Changes</button>
                  <button class="btn primary u-save" disabled={!pending.size || saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save Changes'}</button>
                </div>
              </div>
            </>
          )}
        </div>

      </div>{/* end u-layout */}

      {criticalKey && (
        <CriticalGrantDialog
          permKey={criticalKey}
          targetLabel={user?.fullName ?? ''}
          onConfirm={r => void submitCritical(r)}
          onCancel={() => setCriticalKey(null)}
        />
      )}

      <AcExportDrawer open={showExport} onClose={() => setShowExport(false)} user={user} />

      {creatingRole && <AcCreateRolePage onDone={() => setCreatingRole(false)} />}
    </div>
  );
}
