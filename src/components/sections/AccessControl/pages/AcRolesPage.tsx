/**
 * src/components/sections/AccessControl/pages/AcRolesPage.tsx
 *
 * Access Control — Roles. Master-detail:
 *   • LEFT RAIL — searchable System/Custom role list.
 *   • RIGHT     — role header + a "one module at a time" capability editor: a compact
 *                 module menu (each with its enabled/total count + a high-risk dot) and
 *                 a panel showing only the picked module's capabilities as toggle rows.
 *                 A search box jumps across all modules (grouped results). Edits are
 *                 BUFFERED into a floating action bar that commits on Save; enabling a
 *                 maker-checker (critical) capability routes to approval. Per-capability
 *                 "last updated" is derived from activity_logs (role_perm_grant/revoke).
 */

import { type VNode, Fragment } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { useRoles, useRolePermissions, useSetRolePermission, useAuditLogs } from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { CriticalGrantDialog } from '@sections/SuperadminConsole/CriticalGrantDialog';
import { AcCreateRolePage } from './AcCreateRolePage';
import { setRolePermissionWithReasonApi, type RoleRow } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
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

const MODULE_LUCIDE: Record<string, LucideName> = {
  HR: 'Users', Employees: 'Contact', 'Attendance & Leave': 'CalendarCheck', Payroll: 'Banknote',
  Finance: 'Landmark', HSE: 'HardHat', 'Sites & Map': 'Map', Calendar: 'CalendarDays',
  Workflow: 'Workflow', Tickets: 'Ticket', Communications: 'MessageSquare', Auth: 'KeyRound',
  Settings: 'Settings', System: 'Server', 'User Management': 'UserCog', Dashboard: 'LayoutDashboard',
};
const moduleLucide = (m: string): LucideName => MODULE_LUCIDE[m] ?? 'Box';
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const cap = (s: string) => s ? s[0]!.toUpperCase() + s.slice(1) : s;

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

// ── Role detail — "one module at a time" capability editor ────────────────────

function RoleDetail({ role, qc, onEdit, rolesRefetch }: {
  role: RoleRow; qc: ReturnType<typeof useQueryClient>; onEdit: () => void; rolesRefetch: () => void;
}): VNode {
  const isSuper = role.name === 'superadmin';
  const rolePermsQ = useRolePermissions(role.name);
  const auditQ     = useAuditLogs({ entity_id: role.name, includeActions: ['role_perm_grant', 'role_perm_revoke'], limit: 500 }, !isSuper);
  const setRolePerm = useSetRolePermission();

  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [selMod, setSelMod]   = useState<string>('');
  const [search, setSearch]   = useState('');
  const [criticalKey, setCriticalKey] = useState<string | null>(null);
  const [saving, setSaving]   = useState(false);

  useEffect(() => { setPending(new Map()); setSearch(''); }, [role.name]);

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

  // Modules → capability keys.
  const byMod = useMemo(() => {
    const m = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) { const mod = PERMISSION_META[k]?.module; if (!mod) continue; (m.get(mod) ?? m.set(mod, []).get(mod)!).push(k); }
    return m;
  }, []);
  const modules = useMemo(() => [...byMod.keys()].sort(), [byMod]);
  useEffect(() => { if ((!selMod || !byMod.has(selMod)) && modules.length) setSelMod(modules[0]!); }, [modules, selMod, byMod]);

  const totalCaps = PERMISSION_KEYS.length;
  const enabledCount = useMemo(() => PERMISSION_KEYS.filter(k => granted(k)).length, [pending, rolePermsQ.data, isSuper]);
  const highRiskEnabled = useMemo(() => PERMISSION_KEYS.filter(k => granted(k) && CRITICAL_GRANT_KEYS.has(k)).length, [pending, rolePermsQ.data, isSuper]);

  const q = search.trim().toLowerCase();
  const searchResults = useMemo(() => {
    if (!q) return null;
    const m = new Map<string, PermissionKey[]>();
    for (const k of PERMISSION_KEYS) {
      const meta = PERMISSION_META[k]; if (!meta) continue;
      if (!meta.label.toLowerCase().includes(q) && !meta.description.toLowerCase().includes(q)) continue;
      (m.get(meta.module) ?? m.set(meta.module, []).get(meta.module)!).push(k);
    }
    return m;
  }, [q]);
  const searchCount = searchResults ? [...searchResults.values()].reduce((n, a) => n + a.length, 0) : 0;

  const onToggle = (k: string) => {
    if (isSuper) return;
    const next = !granted(k);
    if (next && CRITICAL_GRANT_KEYS.has(k)) { setCriticalKey(k); return; }
    setPending(prev => { const n = new Map(prev); if (next === baseGranted(k)) n.delete(k); else n.set(k, next); return n; });
  };
  const bulk = (keys: readonly PermissionKey[], want: boolean) => {
    if (isSuper) return;
    setPending(prev => {
      const n = new Map(prev);
      for (const k of keys) {
        if (want && CRITICAL_GRANT_KEYS.has(k)) continue;   // criticals need maker-checker individually
        if (want === baseGranted(k)) n.delete(k); else n.set(k, want);
      }
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
  const panelKeys = byMod.get(selMod) ?? [];
  const modInfo = (mod: string) => {
    const keys = byMod.get(mod) ?? [];
    return { total: keys.length, en: keys.filter(k => granted(k)).length, hr: keys.some(k => granted(k) && CRITICAL_GRANT_KEYS.has(k)) };
  };

  const CapRow = (k: PermissionKey): VNode => {
    const meta = PERMISSION_META[k]!;
    const isCrit = CRITICAL_GRANT_KEYS.has(k);
    const up = lastUpd.get(k);
    return (
      <div class={`rl2-caprow${pending.has(k) ? ' dirty' : ''}`} key={k}>
        <div class="rl2-caprow-main">
          <div class="rl2-caprow-name">{meta.label}{isCrit && <span class="rl2-crit">Approval</span>}</div>
          <div class="rl2-caprow-desc">{meta.description}</div>
        </div>
        {up && <span class="rl2-caprow-upd" title={`Last changed ${dateShort(up.date)} by ${up.actor}`}>{dateShort(up.date)}</span>}
        <span class={`rl2-risk r-${meta.risk}`}>{cap(meta.risk)}</span>
        <button type="button" class={`rl2-tgl${granted(k) ? ' on' : ''}`} disabled={isSuper || saving} onClick={() => onToggle(k)} aria-pressed={granted(k)} aria-label={`${meta.label} default access`}><span /></button>
      </div>
    );
  };

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
          <div class="rl2-hd-sub">{isSuper ? 'This role has all capabilities enabled by default and cannot be edited.' : 'Toggle the default access for each capability, one module at a time.'}</div>
        </div>
        <div class="rl2-hd-right">
          <span class="rl2-assigned"><LucideIcon name="Users" size={14} /> {role.userCount} user{role.userCount === 1 ? '' : 's'} assigned</span>
          {!isSuper && <button type="button" class="acx-hdr-btn" onClick={onEdit}><LucideIcon name="Info" size={15} /> Role details</button>}
        </div>
      </div>

      {/* Editor: module menu + capability panel */}
      <div class="card rl2-ed">
        <div class="rl2-ed-top">
          <div class="rl2-ed-search">
            <LucideIcon name="Search" size={15} />
            <input placeholder="Search all capabilities…" value={search} onInput={e => setSearch((e.target as HTMLInputElement).value)} />
            {search && <button type="button" class="rl2-ed-clear" onClick={() => setSearch('')} aria-label="Clear search"><LucideIcon name="X" size={14} /></button>}
          </div>
          <div class="rl2-ed-summary"><strong>{isSuper ? totalCaps : enabledCount}</strong>/{totalCaps} enabled · <strong>{highRiskEnabled}</strong> high-risk</div>
        </div>

        <div class="rl2-ed-body">
          {/* Module menu */}
          <div class="rl2-modnav">
            {modules.map(mod => {
              const mi = modInfo(mod);
              return (
                <button type="button" key={mod} class={`rl2-modli${!search && selMod === mod ? ' on' : ''}`} onClick={() => { setSearch(''); setSelMod(mod); }}>
                  <span class="rl2-modli-ico"><LucideIcon name={moduleLucide(mod)} size={16} /></span>
                  <span class="rl2-modli-name">{mod}</span>
                  {mi.hr && <span class="rl2-modli-hr" title="High-risk capability enabled" />}
                  <span class="rl2-modli-ct">{mi.en}/{mi.total}</span>
                </button>
              );
            })}
          </div>

          {/* Capability panel */}
          <div class="rl2-modpanel">
            {searchResults ? (
              searchCount === 0 ? <div class="ac-empty" style={{ padding: '40px 16px' }}>No capabilities match “{search}”.</div> : (
                <>
                  <div class="rl2-panel-head"><span class="rl2-panel-title">{searchCount} result{searchCount === 1 ? '' : 's'} <span class="rl2-panel-sub">for “{search}”</span></span></div>
                  {[...searchResults.entries()].map(([mod, keys]) => (
                    <Fragment key={mod}>
                      <div class="rl2-panel-grp">{mod}</div>
                      {keys.map(CapRow)}
                    </Fragment>
                  ))}
                </>
              )
            ) : (
              <>
                <div class="rl2-panel-head">
                  <span class="rl2-panel-title"><LucideIcon name={moduleLucide(selMod)} size={16} /> {selMod} <span class="rl2-panel-sub">· {panelKeys.length} capabilit{panelKeys.length === 1 ? 'y' : 'ies'}</span></span>
                  {!isSuper && <span class="rl2-panel-bulk"><button type="button" onClick={() => bulk(panelKeys, true)}>Enable all</button><span class="rl2-panel-bulk-sep">·</span><button type="button" class="off" onClick={() => bulk(panelKeys, false)}>Disable all</button></span>}
                </div>
                {auditQ.isLoading && !isSuper ? <div class="ac-loading">Loading…</div> : panelKeys.map(CapRow)}
              </>
            )}
          </div>
        </div>
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
