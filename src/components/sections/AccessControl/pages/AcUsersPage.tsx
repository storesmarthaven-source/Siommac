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
import { toast } from '@store/ui';

type OvState = 'inherit' | 'allow' | 'deny';
const PAGE = 8;

const AVATAR_BG = ['#2563eb', '#7c3aed', '#0d9488', '#d97706', '#db2777', '#16a34a', '#6b7280'];
const bgFor = (s: string) => AVATAR_BG[[...s].reduce((n, c) => n + c.charCodeAt(0), 0) % AVATAR_BG.length]!;
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

const MOD_STYLE: Record<string, { icon: string; bg: string; fg: string }> = {
  Finance: { icon: 'fa-dollar-sign', bg: 'var(--green-bg)', fg: 'var(--green)' },
  Payroll: { icon: 'fa-money-check-dollar', bg: 'var(--green-bg)', fg: 'var(--green)' },
  HR: { icon: 'fa-user-group', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  HSE: { icon: 'fa-helmet-safety', bg: 'var(--amber-bg)', fg: 'var(--amber)' },
  Operations: { icon: 'fa-gear', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  Communications: { icon: 'fa-comments', bg: 'var(--purple-bg)', fg: 'var(--purple)' },
  Messages: { icon: 'fa-comments', bg: 'var(--purple-bg)', fg: 'var(--purple)' },
  Workflow: { icon: 'fa-diagram-project', bg: 'var(--purple-bg)', fg: 'var(--purple)' },
  Calendar: { icon: 'fa-calendar-days', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
};
const modStyle = (m: string) => MOD_STYLE[m] ?? { icon: 'fa-cube', bg: '#eef1f7', fg: '#64748b' };

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
  const [filter, setFilter]     = useState({ module: '', risk: '', search: '' });
  const [pending, setPending]   = useState<Map<string, OvState>>(new Map());
  const [localPending, setLocal] = useState<Set<string>>(new Set());
  const [collapsed, setCollapsed] = useState<Set<string>>(new Set());
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [saving, setSaving]     = useState(false);
  const [recentPage, setRecentPage] = useState(0);

  useEffect(() => { if (!selId && users.length) setSelId(users[0]!.id); }, [users, selId]);
  useEffect(() => { setPending(new Map()); setLocal(new Set()); setRecentPage(0); }, [selId]);

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
      if (filter.module && m.module !== filter.module) continue;
      if (filter.risk && m.risk !== filter.risk) continue;
      if (filter.search && !m.label.toLowerCase().includes(filter.search.toLowerCase())) continue;
      (byMod.get(m.module) ?? byMod.set(m.module, []).get(m.module)!).push(k);
    }
    return byMod;
  }, [filter]);
  const allModules = useMemo(() => [...new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean))] as string[], []);

  const stats = useMemo(() => ({
    overrides: PERMISSION_KEYS.filter(k => target(k) !== 'inherit').length,
    highRisk:  PERMISSION_KEYS.filter(k => effGranted(k) && CRITICAL_GRANT_KEYS.has(k)).length,
    effective: PERMISSION_KEYS.filter(k => effGranted(k)).length,
  }), [target, effGranted]);

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
      <div class="page-head">
        <h1 class="page-title">Users <span class="tag">User Access Overrides</span></h1>
        <p class="page-sub">Manage per-user access exceptions. Changes here apply only to this user and do not modify role permissions.</p>
      </div>

      <div class="u-layout">
        {/* LEFT COLUMN — user rail + Recent Override Changes stacked below it */}
        <div class="u-left">
        {/* LEFT RAIL */}
        <div class="card u-rail">
          <div class="u-rail-head">
            <span style={{ fontSize: '14px', fontWeight: 700 }}>Users <span class="muted" style={{ fontWeight: 500 }}>({users.length})</span></span>
          </div>
          <div class="u-rail-search"><i class="fas fa-magnifying-glass" /><input class="input" placeholder="Search users…" value={railSearch} onInput={e => { setRail((e.target as HTMLInputElement).value); setPage(1); }} /></div>
          <div class="u-user-list">
            {usersQ.isLoading ? <div class="ac-loading">Loading users…</div>
             : pageUsers.length === 0 ? <div class="ac-empty">No users match.</div>
             : pageUsers.map(u => (
              <div key={u.id} class={`u-user-item${u.id === selId ? ' selected' : ''}`} onClick={() => setSelId(u.id)}>
                <span class="avatar" style={{ width: '36px', height: '36px', fontSize: '12px', background: bgFor(u.fullName) }}>{u.profileImage ? <img src={u.profileImage} alt="" /> : initials(u.fullName)}</span>
                <div style={{ minWidth: 0, flex: 1 }}>
                  <div class="u-user-name">{u.fullName}</div>
                  <div class="u-user-sub">{u.role}{u.department ? ` · ${u.department}` : ''}</div>
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

        {/* Recent Override Changes — under the users card, 5 per page */}
        <div class="card u-recent">
          <div class="card-head" style={{ padding: '13px 16px' }}>
            <div style={{ fontSize: '14px', fontWeight: 700 }}>Recent Override Changes</div>
            <span class="link" style={{ fontSize: '12px' }} onClick={() => { try { window.dispatchEvent(new CustomEvent('siomac:section', { detail: 's-ac-audit' })); } catch (_) { /* ignore */ } }}>Audit log →</span>
          </div>
          {auditQ.isLoading ? <div class="ac-loading">Loading…</div>
           : (auditQ.data?.logs ?? []).length === 0 ? <div class="ac-empty">No recent override changes.</div>
           : (
            <div class="u-ovr-list">
              {(auditQ.data!.logs as { id: string; username: string; action: string; details: string; created_at: string }[]).slice(recentPage * 5, recentPage * 5 + 5).map(l => {
                let perm = ''; try { perm = (JSON.parse(l.details || '{}').permission as string) ?? ''; } catch { /* plain text */ }
                const meta = perm ? PERMISSION_META[perm as PermissionKey] : undefined;
                const label = meta ? meta.label : perm;
                const actor = usersByUsername.get(l.username.toLowerCase());
                const name = actor?.fullName || l.username;
                const kind = l.action === 'permission_grant' ? { t: 'Allow', cls: 'allow', ico: 'fa-check' }
                           : l.action === 'permission_deny'  ? { t: 'Deny',  cls: 'deny',  ico: 'fa-xmark' }
                           : { t: 'Reset', cls: 'reset', ico: 'fa-rotate-left' };
                const ms = meta ? modStyle(meta.module) : null;
                return (
                  <div class="u-ovr-card" key={l.id}>
                    <div class="u-ovr-top">
                      <span class="avatar" style={{ width: '30px', height: '30px', fontSize: '10.5px', background: actor?.profileImage ? undefined : bgFor(name) }}>
                        {actor?.profileImage ? <img src={actor.profileImage} alt="" /> : initials(name)}
                      </span>
                      <span class="u-ovr-name" title={name}>{name}</span>
                      <span class="u-ovr-when">{timeAgo(l.created_at)}</span>
                    </div>
                    <div class="u-ovr-tags">
                      <span class={`u-ovr-tag ${kind.cls}`}><i class={`fas ${kind.ico}`} /> {kind.t}</span>
                      {meta && ms && (
                        <span class="u-ovr-mod" style={{ background: ms.bg, color: ms.fg }}>
                          <i class={`fas ${ms.icon}`} /> {meta.module}
                        </span>
                      )}
                    </div>
                    {label && <div class="u-ovr-perm" title={label}>{label}</div>}
                  </div>
                );
              })}
            </div>
          )}
          {(() => {
            const totalRecent = auditQ.data?.logs?.length ?? 0;
            const recentPages = Math.max(1, Math.ceil(totalRecent / 5));
            if (recentPages <= 1) return null;
            return (
              <div class="u-tbl-foot">
                <span class="muted" style={{ fontSize: '12px' }}>{totalRecent} change{totalRecent === 1 ? '' : 's'}</span>
                <span class="row" style={{ gap: '4px', marginLeft: 'auto' }}>
                  <button class="u-pager-btn" disabled={recentPage === 0} onClick={() => setRecentPage(p => Math.max(0, p - 1))}>‹</button>
                  <span class="sub" style={{ padding: '0 8px' }}>Page {recentPage + 1} of {recentPages}</span>
                  <button class="u-pager-btn" disabled={recentPage + 1 >= recentPages} onClick={() => setRecentPage(p => p + 1)}>›</button>
                </span>
              </div>
            );
          })()}
        </div>
        </div>{/* end u-left */}

        {/* CENTER */}
        <div class="u-center">
          {!user ? <div class="card"><div class="ac-empty">Select a user to edit their access.</div></div> : (
            <>
              <div class="card">
                <div style={{ padding: '18px 20px', display: 'flex', alignItems: 'center', gap: '18px', flexWrap: 'wrap' }}>
                  <span class="avatar" style={{ width: '56px', height: '56px', fontSize: '18px', background: bgFor(user.fullName) }}>{user.profileImage ? <img src={user.profileImage} alt="" /> : initials(user.fullName)}</span>
                  <div style={{ minWidth: 0, flex: 1 }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px', marginBottom: '5px' }}>
                      <span style={{ fontSize: '19px', fontWeight: 700, lineHeight: 1 }}>{user.fullName}</span>
                      <span class={`badge ${user.active ? 'green' : 'grey'}`}><i class="fas fa-circle" style={{ fontSize: '6px' }} /> {user.active ? 'Active' : 'Disabled'}</span>
                    </div>
                    <div style={{ fontSize: '13.5px', color: 'var(--ink-2)', marginBottom: '3px' }}>{user.role}{user.department ? ` · ${user.department}` : ''}</div>
                    <div style={{ fontSize: '12.5px', color: 'var(--faint)' }}>{user.email || user.username}{user.position ? ` · ${user.position}` : ''}</div>
                  </div>
                  <div style={{ display: 'flex', gap: '12px', flex: 'none' }}>
                    <div class="u-mini-stat"><div class="u-mini-ico blue"><i class="fas fa-table-cells-large" /></div><div class="u-mini-val">{stats.overrides}</div><div class="u-mini-lbl">Overrides</div></div>
                    <div class="u-mini-stat"><div class="u-mini-ico red"><i class="fas fa-shield-halved" /></div><div class="u-mini-val" style={{ color: 'var(--red)' }}>{stats.highRisk}</div><div class="u-mini-lbl">High-Risk Access</div></div>
                    <div class="u-mini-stat"><div class="u-mini-ico green"><i class="fas fa-circle-check" /></div><div class="u-mini-val" style={{ color: 'var(--green)' }}>{stats.effective}</div><div class="u-mini-lbl">Effective Capabilities</div></div>
                  </div>
                </div>
              </div>

              <div class="u-info-banner">
                <div style={{ flex: 1, fontSize: '13.5px', color: 'var(--ink-2)' }}><strong>You are editing user-level overrides.</strong> Changes you make here create exceptions for this user only and do not affect the underlying role.</div>
              </div>

              <div style={{ display: 'flex', gap: '10px', alignItems: 'center' }}>
                <select class="select" style={{ width: '158px', height: '38px', fontSize: '13px' }} value={filter.module} onChange={e => setFilter(f => ({ ...f, module: (e.target as HTMLSelectElement).value }))}>
                  <option value="">All Modules</option>
                  {allModules.map(m => <option key={m} value={m}>{m}</option>)}
                </select>
                <select class="select" style={{ width: '158px', height: '38px', fontSize: '13px' }} value={filter.risk} onChange={e => setFilter(f => ({ ...f, risk: (e.target as HTMLSelectElement).value }))}>
                  <option value="">All Risk Levels</option>
                  {(['low', 'medium', 'high', 'critical'] as PermissionRisk[]).map(r => <option key={r} value={r}>{r[0]!.toUpperCase() + r.slice(1)}</option>)}
                </select>
                <input class="input" placeholder="Search capabilities…" style={{ flex: 1, height: '38px', fontSize: '13px' }} value={filter.search} onInput={e => setFilter(f => ({ ...f, search: (e.target as HTMLInputElement).value }))} />
              </div>

              <div class="card" style={{ overflow: 'hidden' }}>
                <table class="tbl" style={{ tableLayout: 'fixed' }}>
                  <colgroup><col style={{ width: '30%' }} /><col style={{ width: '14%' }} /><col style={{ width: '15%' }} /><col style={{ width: '15%' }} /><col style={{ width: '14%' }} /><col style={{ width: '52px' }} /></colgroup>
                  <thead><tr><th>Capability</th><th>Role Default</th><th>User Override</th><th>Effective Result</th><th>Source</th><th style={{ textAlign: 'center' }}>Reset</th></tr></thead>
                  <tbody>
                    {[...groups.entries()].map(([mod, keys]) => {
                      const st = modStyle(mod); const open = !collapsed.has(mod);
                      return (
                        <>
                          <tr class="grp" key={`g-${mod}`}>
                            <td colSpan={6} style={{ padding: '9px 16px', background: '#f9fafb', cursor: 'pointer' }} onClick={() => toggleMod(mod)}>
                              <span style={{ display: 'flex', alignItems: 'center', gap: '9px' }}>
                                <span style={{ width: '22px', height: '22px', borderRadius: '6px', background: st.bg, color: st.fg, display: 'inline-grid', placeItems: 'center', fontSize: '11px', flex: 'none' }}><i class={`fas ${st.icon}`} /></span>
                                <span style={{ fontSize: '13px', fontWeight: 700 }}>{mod}</span>
                                <span class="badge grey" style={{ fontSize: '10.5px', padding: '1px 8px' }}>{keys.length}</span>
                                <i class={`fas fa-chevron-${open ? 'up' : 'right'}`} style={{ color: 'var(--faint)', fontSize: '10px', marginLeft: 'auto' }} />
                              </span>
                            </td>
                          </tr>
                          {open && keys.map(k => {
                            const t = target(k); const ov = t !== 'inherit'; const submitted = localPending.has(k);
                            return (
                              <tr key={k} class={ov ? 'u-row-override' : undefined}>
                                <td style={{ fontWeight: 500 }}>{PERMISSION_META[k].label}{CRITICAL_GRANT_KEYS.has(k) && <span class="risk critical" style={{ marginLeft: '8px', fontSize: '10px' }}>Critical</span>}</td>
                                <td><CapCell allow={roleDefault(k)} /></td>
                                <td>
                                  {submitted ? <span class="badge amber" style={{ fontSize: '11px' }}>Pending approval</span> : (
                                    <select class={`u-cap-sel${ov ? ' u-cap-sel-ovr' : ''}`} value={t} onChange={e => onSelect(k, (e.target as HTMLSelectElement).value as OvState)}>
                                      <option value="inherit">Inherit</option>
                                      <option value="allow">Allow</option>
                                      <option value="deny">Deny</option>
                                    </select>
                                  )}
                                </td>
                                <td><CapCell allow={effGranted(k)} /></td>
                                <td><span class={`badge ${ov ? 'amber' : 'grey'}`} style={{ fontSize: '11px' }}>{ov ? 'Override' : 'Role Default'}</span></td>
                                <td style={{ textAlign: 'center' }}><button class={`u-reset-btn${ov ? ' u-reset-btn-ovr' : ''}`} disabled={!ov || submitted} onClick={() => onSelect(k, 'inherit')}><i class="fas fa-rotate-right" style={{ fontSize: '11px' }} /></button></td>
                              </tr>
                            );
                          })}
                        </>
                      );
                    })}
                    {groups.size === 0 && <tr><td colSpan={6}><div class="ac-empty">No capabilities match the filters.</div></td></tr>}
                  </tbody>
                </table>
                <div class="u-tbl-foot">
                  <span style={{ display: 'flex', alignItems: 'center', gap: '14px', fontSize: '12px' }}>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--green)', fontWeight: 600 }}><i class="fas fa-circle" style={{ fontSize: '7px' }} /> Allow</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--red)', fontWeight: 600 }}><i class="fas fa-circle" style={{ fontSize: '7px' }} /> Deny</span>
                    <span style={{ display: 'flex', alignItems: 'center', gap: '5px', color: 'var(--faint)', fontWeight: 600 }}><i class="fas fa-circle" style={{ fontSize: '7px' }} /> Inherit</span>
                  </span>
                  <span class="muted" style={{ fontSize: '12px', marginLeft: 'auto' }}>{groups.size} module{groups.size === 1 ? '' : 's'} · {[...groups.values()].reduce((n, a) => n + a.length, 0)} capabilities</span>
                </div>
              </div>

              <div class="u-action-bar">
                <button class="btn" disabled={!pending.size || saving} onClick={() => setPending(new Map())}>Discard Changes</button>
                <span style={{ display: 'flex', alignItems: 'center', gap: '7px', fontSize: '13.5px', fontWeight: 600, color: pending.size ? 'var(--amber)' : 'var(--faint)' }}>
                  {pending.size > 0 && <i class="fas fa-triangle-exclamation" />}
                  <span style={{ color: 'var(--ink-2)' }}>{pending.size} unsaved change{pending.size === 1 ? '' : 's'}</span>
                </span>
                <button class="btn primary" disabled={!pending.size || saving} onClick={save}>{saving ? 'Saving…' : 'Save Changes'}</button>
              </div>
            </>
          )}
        </div>

      </div>{/* end u-layout */}

      {criticalKey && (
        <CriticalGrantDialog
          permKey={criticalKey}
          targetLabel={user?.fullName ?? ''}
          onConfirm={submitCritical}
          onCancel={() => setCriticalKey(null)}
        />
      )}
    </div>
  );
}
