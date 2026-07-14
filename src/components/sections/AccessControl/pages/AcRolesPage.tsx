/**
 * src/components/sections/AccessControl/pages/AcRolesPage.tsx
 *
 * Access Control — Roles. Two views:
 *   • LIST     — searchable System/Custom role cards; pick one to open.
 *   • DETAIL   — full-width role editor: header + stat cards + quick-filter tabs
 *                (All / High Risk / top modules / Recently Updated) + Search/Risk/
 *                Category/Access filters + a flat, paginated capability table with
 *                expandable rows (real fields only). Toggles are BUFFERED — a floating
 *                action bar shows pending changes + affected members and commits on Save.
 *                Enabling a maker-checker (critical) capability routes to approval.
 *
 * Per-capability "Last Updated" is derived from activity_logs (role_perm_grant/revoke).
 */

import { type VNode } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import {
  useRoles, useRolePermissions, useSetRolePermission, useConsoleUsers, usePermissionApprovals, useAuditLogs,
} from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { CriticalGrantDialog } from '@sections/SuperadminConsole/CriticalGrantDialog';
import { AcCreateRolePage } from './AcCreateRolePage';
import { setRolePermissionWithReasonApi, type RoleRow } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META, type PermissionRisk } from '@lib/permissionMeta';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { TableSearch, FilterDropdown, useFilterDropdowns } from '@ui';
import { toast } from '@store/ui';

const ROLE_ICON: Record<string, { icon: LucideName; bg: string; fg: string }> = {
  superadmin:      { icon: 'ShieldAlert',  bg: 'var(--red-bg)',    fg: 'var(--red)' },
  admin:           { icon: 'SlidersHorizontal', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  manager:         { icon: 'Users',        bg: 'var(--green-bg)',  fg: 'var(--green)' },
  employee:        { icon: 'User',         bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  hr_manager:      { icon: 'Handshake',    bg: 'var(--green-bg)',  fg: 'var(--green)' },
  hr_staff:        { icon: 'UsersRound',   bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  finance_manager: { icon: 'Landmark',     bg: 'var(--amber-bg)',  fg: 'var(--amber)' },
  finance_staff:   { icon: 'Banknote',     bg: 'var(--amber-bg)',  fg: 'var(--amber)' },
  hse_staff:       { icon: 'HardHat',      bg: 'var(--purple-bg)', fg: 'var(--purple)' },
};
const roleStyle = (name: string) => ROLE_ICON[name] ?? { icon: 'UserCog' as LucideName, bg: '#f1f3f7', fg: 'var(--muted)' };
const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const cap = (s: string) => s ? s[0]!.toUpperCase() + s.slice(1) : s;

const PAGE_SIZES = [25, 50, 100];

export function AcRolesPage(): VNode {
  const qc = useQueryClient();
  const rolesQ = useRoles(true);
  const roles = rolesQ.data ?? [];

  const [selName, setSelName] = useState<string | null>(null);
  const [listTab, setListTab] = useState<'system' | 'custom'>('system');
  const [listSearch, setListSearch] = useState('');
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);

  const systemRoles = roles.filter(r => r.isSystem);
  const customRoles = roles.filter(r => !r.isSystem);
  const listRoles = useMemo(() => {
    const q = listSearch.trim().toLowerCase();
    return roles.filter(r => (listTab === 'system' ? r.isSystem : !r.isSystem) && (!q || r.label.toLowerCase().includes(q) || r.name.includes(q)));
  }, [roles, listTab, listSearch]);

  const selRole = roles.find(r => r.name === selName) ?? null;
  useEffect(() => { if (!selName && roles.length) setSelName(roles[0]!.name); }, [roles, selName]);

  return (
    <div class="acx">
      <div class="rl2-hd">
        <div>
          <h1 class="page-title">Roles</h1>
          <p class="page-sub">Manage roles and the default capabilities each one grants.</p>
        </div>
        <button type="button" class="acx-hdr-btn primary" onClick={() => setEditing('new')}><LucideIcon name="Plus" size={15} /> New Role</button>
      </div>

      <div class="rl2-layout">
        {/* LEFT RAIL — role list */}
        <div class="card rl2-rail">
          <div class="rl2-rail-search"><LucideIcon name="Search" size={15} /><input placeholder="Search roles…" value={listSearch} onInput={e => setListSearch((e.target as HTMLInputElement).value)} /></div>
          <div class="rl2-rail-tabs">
            <button class={`rl2-rtab${listTab === 'system' ? ' on' : ''}`} onClick={() => setListTab('system')}>System <span>{systemRoles.length}</span></button>
            <button class={`rl2-rtab${listTab === 'custom' ? ' on' : ''}`} onClick={() => setListTab('custom')}>Custom <span>{customRoles.length}</span></button>
          </div>
          <div class="rl2-rail-list">
            {rolesQ.isLoading ? <div class="ac-loading">Loading…</div>
             : listRoles.length === 0 ? <div class="ac-empty">{listTab === 'custom' ? 'No custom roles yet.' : 'No roles match.'}</div>
             : listRoles.map(r => {
              const rst = roleStyle(r.name);
              return (
                <button type="button" key={r.name} class={`rl2-ritem${r.name === selName ? ' on' : ''}`} onClick={() => setSelName(r.name)}>
                  <span class="rl2-ritem-ico" style={{ background: rst.bg, color: rst.fg }}><LucideIcon name={rst.icon} size={17} /></span>
                  <div class="rl2-ritem-main">
                    <div class="rl2-ritem-top"><span class="rl2-ritem-name">{r.label}</span><span class={`rl2-tag ${r.isSystem ? 'sys' : 'cust'}`}>{r.isSystem ? 'System' : 'Custom'}</span></div>
                    <div class="rl2-ritem-meta">{r.userCount} member{r.userCount === 1 ? '' : 's'}</div>
                  </div>
                </button>
              );
            })}
          </div>
        </div>

        {/* RIGHT — capability editor */}
        <div class="rl2-detail">
          {!selRole ? <div class="card"><div class="ac-empty">Select a role.</div></div> : (
            <RoleDetail role={selRole} qc={qc} onEdit={() => setEditing(selRole)} rolesRefetch={() => void rolesQ.refetch()} />
          )}
        </div>
      </div>

      {editing && <AcCreateRolePage role={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); void rolesQ.refetch(); }} />}
    </div>
  );
}

// ── Role detail (full-width capability editor) ────────────────────────────────

type Tab = 'all' | 'highrisk' | 'recent' | `mod:${string}`;

function RoleDetail({ role, qc, onEdit, rolesRefetch }: {
  role: RoleRow; qc: ReturnType<typeof useQueryClient>; onEdit: () => void; rolesRefetch: () => void;
}): VNode {
  const isSuper = role.name === 'superadmin';
  const rolePermsQ = useRolePermissions(role.name);
  const usersQ     = useConsoleUsers(true);
  const approvalsQ = usePermissionApprovals('pending');
  const auditQ     = useAuditLogs({ entity_id: role.name, includeActions: ['role_perm_grant', 'role_perm_revoke'], limit: 500 }, !isSuper);
  const setRolePerm = useSetRolePermission();

  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [tab, setTab]     = useState<Tab>('all');
  const [search, setSearch] = useState('');
  const [risk, setRisk]   = useState<string[]>([]);
  const [modF, setModF]   = useState<string[]>([]);
  const [access, setAccess] = useState<string[]>([]);
  const [expanded, setExpanded] = useState<string | null>(null);
  const [page, setPage]   = useState(1);
  const [perPage, setPerPage] = useState(25);
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [saving, setSaving] = useState(false);
  const { openId, setOpenId } = useFilterDropdowns();

  useEffect(() => { setPending(new Map()); setPage(1); }, [role.name]);
  useEffect(() => { setPage(1); }, [tab, search, risk, modF, access]);

  const baseGranted = (k: string) => isSuper || (rolePermsQ.data ?? []).includes(k);
  const granted = (k: string) => pending.has(k) ? pending.get(k)! : baseGranted(k);

  // Per-capability last-updated from audit logs.
  const lastUpd = useMemo(() => {
    const m = new Map<string, { date: string; actor: string }>();
    for (const l of auditQ.data?.logs ?? []) {
      let p = ''; try { p = ((JSON.parse(l.details || '{}') as { permission?: string }).permission) ?? ''; } catch { /* plain */ }
      if (!p) continue;
      const prev = m.get(p);
      if (!prev || new Date(l.created_at) > new Date(prev.date)) m.set(p, { date: l.created_at, actor: l.actorName || l.username });
    }
    return m;
  }, [auditQ.data]);

  const allModules = useMemo(() => [...new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean))].sort() as string[], []);
  const topModules = useMemo(() => {
    const c = new Map<string, number>();
    for (const k of PERMISSION_KEYS) { const m = PERMISSION_META[k]?.module; if (m) c.set(m, (c.get(m) ?? 0) + 1); }
    return [...c.entries()].sort((a, b) => b[1] - a[1]).slice(0, 3);
  }, []);

  const criticalCount = useMemo(() => PERMISSION_KEYS.filter(k => CRITICAL_GRANT_KEYS.has(k)).length, []);

  // Filtered flat capability list.
  const filtered = useMemo(() => {
    const q = search.trim().toLowerCase();
    return PERMISSION_KEYS.filter(k => {
      const m = PERMISSION_META[k]; if (!m) return false;
      if (tab === 'highrisk' && !CRITICAL_GRANT_KEYS.has(k)) return false;
      if (tab === 'recent' && !lastUpd.has(k)) return false;
      if (tab.startsWith('mod:') && m.module !== tab.slice(4)) return false;
      if (risk.length && !risk.includes(m.risk)) return false;
      if (modF.length && !modF.includes(m.module)) return false;
      if (access.length && !access.includes(granted(k) ? 'enabled' : 'disabled')) return false;
      if (q && !m.label.toLowerCase().includes(q) && !m.description.toLowerCase().includes(q)) return false;
      return true;
    });
  }, [tab, search, risk, modF, access, lastUpd, pending, rolePermsQ.data]);

  const sorted = useMemo(() => {
    if (tab !== 'recent') return filtered;
    return [...filtered].sort((a, b) => new Date(lastUpd.get(b)?.date ?? 0).getTime() - new Date(lastUpd.get(a)?.date ?? 0).getTime());
  }, [filtered, tab, lastUpd]);

  const pageCount = Math.max(1, Math.ceil(sorted.length / perPage));
  const pageKeys = sorted.slice((page - 1) * perPage, page * perPage);

  // Stats.
  const enabledCount = useMemo(() => PERMISSION_KEYS.filter(k => granted(k)).length, [pending, rolePermsQ.data, isSuper]);
  const highRiskEnabled = useMemo(() => PERMISSION_KEYS.filter(k => granted(k) && CRITICAL_GRANT_KEYS.has(k)).length, [pending, rolePermsQ.data, isSuper]);
  const totalCaps = PERMISSION_KEYS.length;
  const lastOverall = useMemo(() => {
    let best: { date: string; actor: string } | null = null;
    for (const v of lastUpd.values()) if (!best || new Date(v.date) > new Date(best.date)) best = v;
    return best;
  }, [lastUpd]);

  // Toggle (buffered). Enabling a critical routes to maker-checker immediately.
  const onToggle = (k: string) => {
    if (isSuper) return;
    const next = !granted(k);
    if (next && CRITICAL_GRANT_KEYS.has(k)) { setCriticalKey(k); return; }
    setPending(prev => {
      const n = new Map(prev);
      if (next === baseGranted(k)) n.delete(k); else n.set(k, next);
      return n;
    });
  };

  const submitCritical = async (reason: string) => {
    const key = criticalKey; setCriticalKey(null);
    if (!key) return;
    const res = await setRolePermissionWithReasonApi(role.name, key, true, reason);
    if (!res.success) toast.error(res.message ?? 'Failed to submit request.');
    else if (res.pending) { void qc.invalidateQueries({ queryKey: consoleKeys.approvals('pending') }); toast.success("Submitted for a second superadmin's approval."); }
    else { toast.success('Granted.'); void rolePermsQ.refetch(); }
  };

  const save = async () => {
    if (!pending.size) return;
    setSaving(true);
    try {
      for (const [key, want] of pending) await setRolePerm.mutateAsync({ roleName: role.name, permission: key, granted: want });
      setPending(new Map());
      void rolePermsQ.refetch(); void auditQ.refetch(); rolesRefetch();
      toast.success('Role defaults saved.');
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const st = roleStyle(role.name);
  const pendCount = pending.size;

  const TABS: { id: Tab; label: string; count?: number }[] = [
    { id: 'all', label: 'All Capabilities', count: totalCaps },
    { id: 'highrisk', label: 'High Risk', count: criticalCount },
    ...topModules.map(([m, n]) => ({ id: `mod:${m}` as Tab, label: m, count: n })),
    { id: 'recent', label: 'Recently Updated' },
  ];

  return (
    <>
      {/* Header */}
      <div class="card rl2-detail-hd">
        <span class="rl2-hd-ico" style={{ background: st.bg, color: st.fg }}><LucideIcon name={st.icon} size={26} /></span>
        <div class="rl2-hd-main">
          <div class="rl2-hd-titlerow">
            <h1 class="rl2-hd-title">{role.label}</h1>
            <span class={`rl2-tag ${role.isSystem ? 'sys' : 'cust'}`}>{role.isSystem ? 'System Role' : 'Custom Role'}</span>
          </div>
          <div class="rl2-hd-desc">{role.description || (isSuper ? 'Full, unrestricted access. Permanent.' : 'Role default capability set.')}</div>
          <div class="rl2-hd-sub">{isSuper ? 'This role has all capabilities enabled by default and cannot be edited.' : 'Toggle the default access for each capability below.'}</div>
        </div>
        <div class="rl2-hd-right">
          <span class="rl2-assigned"><LucideIcon name="Users" size={14} /> {role.userCount} user{role.userCount === 1 ? '' : 's'} assigned</span>
          {!isSuper && <button type="button" class="acx-hdr-btn" onClick={onEdit}><LucideIcon name="Info" size={15} /> Role details</button>}
        </div>
      </div>

      {/* Stat cards */}
      <div class="rl2-stats">
        <div class="rl2-stat"><span class="rl2-stat-ic blue"><LucideIcon name="TableProperties" size={18} /></span><div><div class="rl2-stat-l">Total Capabilities</div><div class="rl2-stat-n">{isSuper ? totalCaps : enabledCount}</div><div class="rl2-stat-s">Enabled defaults</div></div></div>
        <div class="rl2-stat"><span class="rl2-stat-ic red"><LucideIcon name="ShieldAlert" size={18} /></span><div><div class="rl2-stat-l">High-Risk Capabilities</div><div class="rl2-stat-n">{highRiskEnabled}</div><div class="rl2-stat-s">Require approval</div></div></div>
        <div class="rl2-stat"><span class="rl2-stat-ic green"><LucideIcon name="CircleCheck" size={18} /></span><div><div class="rl2-stat-l">Default Access Enabled</div><div class="rl2-stat-n">{enabledCount} <span class="rl2-stat-pct">({Math.round((enabledCount / totalCaps) * 100)}%)</span></div><div class="rl2-stat-s">Across all capabilities</div></div></div>
        <div class="rl2-stat"><span class="rl2-stat-ic slate"><LucideIcon name="Clock" size={18} /></span><div><div class="rl2-stat-l">Last Updated</div><div class="rl2-stat-n rl2-stat-date">{lastOverall ? dateShort(lastOverall.date) : '—'}</div><div class="rl2-stat-s">{lastOverall ? `by ${lastOverall.actor}` : 'No changes yet'}</div></div></div>
      </div>

      {/* Capability table card */}
      <div class="card">
        <div class="rl2-tabs">
          {TABS.map(t => (
            <button key={t.id} class={`rl2-tab${tab === t.id ? ' on' : ''}`} onClick={() => setTab(t.id)}>
              {t.label}{t.count !== undefined && <span class={`rl2-tab-n${t.id === 'highrisk' ? ' hr' : ''}`}>{t.count}</span>}
            </button>
          ))}
        </div>

        <div class="rl2-filters">
          <div class="rl2-filters-search"><TableSearch value={search} onChange={setSearch} placeholder="Search capabilities…" /></div>
          <FilterDropdown id="rl-risk" label="Risk" openId={openId} setOpenId={setOpenId} options={['low', 'medium', 'high', 'critical']} selected={risk} onChange={setRisk} labelFn={cap} />
          <FilterDropdown id="rl-mod" label="Category" openId={openId} setOpenId={setOpenId} options={allModules} selected={modF} onChange={setModF} />
          <FilterDropdown id="rl-acc" label="Default access" openId={openId} setOpenId={setOpenId} options={['enabled', 'disabled']} selected={access} onChange={setAccess} labelFn={cap} />
        </div>

        <div class="rl2-count">{sorted.length} capabilit{sorted.length === 1 ? 'y' : 'ies'}{(risk.length || modF.length || access.length || search) ? <button type="button" class="rl2-clear" onClick={() => { setRisk([]); setModF([]); setAccess([]); setSearch(''); }}>Clear all</button> : null}</div>

        <table class="rl2-tbl">
          <thead><tr><th>Capability</th><th class="rl2-th-cat">Category</th><th class="rl2-th-risk">Risk Level</th><th class="rl2-th-acc">Default Access</th><th class="rl2-th-upd">Last Updated</th></tr></thead>
          <tbody>
            {auditQ.isLoading && !isSuper ? <tr><td colSpan={5}><div class="ac-loading">Loading…</div></td></tr>
             : pageKeys.length === 0 ? <tr><td colSpan={5}><div class="ac-empty">No capabilities match.</div></td></tr>
             : pageKeys.map(k => {
              const m = PERMISSION_META[k]!;
              const up = lastUpd.get(k);
              const open = expanded === k;
              const isCrit = CRITICAL_GRANT_KEYS.has(k);
              const dirty = pending.has(k);
              return (
                <>
                  <tr class={`rl2-row${open ? ' open' : ''}${dirty ? ' dirty' : ''}`} key={k} onClick={() => setExpanded(open ? null : k)}>
                    <td class="rl2-cap">
                      <LucideIcon name={open ? 'ChevronDown' : 'ChevronRight'} size={15} />
                      <div><div class="rl2-cap-name">{m.label}{isCrit && <span class="rl2-crit">Approval</span>}</div><div class="rl2-cap-desc">{m.description}</div></div>
                    </td>
                    <td class="rl2-cat"><span class="rl2-cat-pill">{m.module}</span></td>
                    <td><span class={`rl2-risk r-${m.risk}`}>{cap(m.risk)}</span></td>
                    <td class="rl2-acc" onClick={e => e.stopPropagation()}>
                      <button type="button" class={`rl2-tgl${granted(k) ? ' on' : ''}`} disabled={isSuper || saving} onClick={() => onToggle(k)} aria-pressed={granted(k)} aria-label={`${m.label} default access`}><span /></button>
                    </td>
                    <td class="rl2-upd">{up ? <><div>{dateShort(up.date)}</div><div class="rl2-upd-by">{up.actor}</div></> : <span class="rl2-upd-none">—</span>}</td>
                  </tr>
                  {open && (
                    <tr class="rl2-exp" key={`${k}-exp`}>
                      <td colSpan={5}>
                        <div class="rl2-exp-grid">
                          <div><div class="rl2-exp-h">What this allows</div><div class="rl2-exp-txt">{m.description}</div></div>
                          <div><div class="rl2-exp-h">Details</div><div class="rl2-exp-kv"><span>Module</span><strong>{m.module}{m.group && m.group !== m.module ? ` · ${m.group}` : ''}</strong></div><div class="rl2-exp-kv"><span>Risk level</span><strong class={`rl2-risk r-${m.risk}`}>{cap(m.risk)}</strong></div><div class="rl2-exp-kv"><span>Approval</span><strong>{isCrit ? 'Maker-checker required' : 'Not required'}</strong></div></div>
                          <div><div class="rl2-exp-h">Last change</div>{up ? <div class="rl2-exp-txt">{dateShort(up.date)} · by {up.actor}</div> : <div class="rl2-exp-txt rl2-upd-none">No changes recorded for this role.</div>}</div>
                        </div>
                      </td>
                    </tr>
                  )}
                </>
              );
            })}
          </tbody>
        </table>

        {pageCount > 1 && (
          <div class="rl2-pager">
            <label class="rl2-perpage">Rows per page
              <select value={String(perPage)} onChange={e => { setPerPage(Number((e.target as HTMLSelectElement).value)); setPage(1); }}>
                {PAGE_SIZES.map(n => <option key={n} value={String(n)}>{n}</option>)}
              </select>
            </label>
            <span class="rl2-pager-info">{(page - 1) * perPage + 1}–{Math.min(page * perPage, sorted.length)} of {sorted.length}</span>
            <span class="rl2-pager-btns">
              <button type="button" disabled={page === 1} onClick={() => setPage(p => Math.max(1, p - 1))}><LucideIcon name="ChevronLeft" size={15} /></button>
              <span class="rl2-pager-cur">{page} / {pageCount}</span>
              <button type="button" disabled={page === pageCount} onClick={() => setPage(p => Math.min(pageCount, p + 1))}><LucideIcon name="ChevronRight" size={15} /></button>
            </span>
          </div>
        )}
      </div>

      {/* Floating buffered action bar */}
      {pendCount > 0 && (
        <div class="rl2-actionbar">
          <span class="rl2-ab-ico"><LucideIcon name="TriangleAlert" size={17} /></span>
          <div class="rl2-ab-txt"><div class="rl2-ab-title">{pendCount} pending change{pendCount === 1 ? '' : 's'}</div><div class="rl2-ab-sub">Affects {role.userCount} member{role.userCount === 1 ? '' : 's'} with this role</div></div>
          <div class="rl2-ab-actions">
            <button type="button" class="acx-hdr-btn" disabled={saving} onClick={() => setPending(new Map())}>Discard</button>
            <button type="button" class="acx-hdr-btn primary" disabled={saving} onClick={() => void save()}>{saving ? 'Saving…' : 'Save changes'}</button>
          </div>
        </div>
      )}

      {criticalKey && <CriticalGrantDialog permKey={criticalKey} targetLabel={role.label} onConfirm={r => void submitCritical(r)} onCancel={() => setCriticalKey(null)} />}
    </>
  );
}
