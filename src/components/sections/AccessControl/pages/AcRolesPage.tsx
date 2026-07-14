/**
 * src/components/sections/AccessControl/pages/AcRolesPage.tsx
 *
 * Access Control — Roles. Designed as a SIBLING of the User Access page (same shell,
 * same visual language) so the two capability surfaces feel like one system:
 *
 *   • PageHeader (Access Control › Roles) + New Role.
 *   • LEFT RAIL — role directory: stat strip, System/Custom tabs, search, role list.
 *   • CENTER — navy Role Profile card (mirrors the Access Profile card) → kit toolbar
 *     (search + Module/Risk/State filters) → ONE capability table where every module is
 *     a collapsed summary row (icon · name · count · progress · enabled/total · state
 *     mark). Expanding shows sub-groups with per-group Enable/Disable-all and toggle
 *     rows (tree connectors, risk pill, last-changed from audit, toggle).
 *
 *   The collapsed table IS the overview — 16 calm rows instead of 423.
 *
 * Edits are BUFFERED: the User-Access-style action bar collects them; "Review & Save"
 * opens a diff (Added/Removed by module, approval flags) and commits on confirm with ONE
 * toast. Enabling a critical capability opens the rich maker-checker dialog for a reason
 * and is routed for approval on save, never applied directly. Superadmin is immutable.
 */

import { type VNode, Fragment } from 'preact';
import { useState, useMemo, useEffect } from 'preact/hooks';
import { createPortal } from 'preact/compat';
import { useQueryClient } from '@tanstack/preact-query';
import { useRoles, useRolePermissions, useAuditLogs } from '@sections/SuperadminConsole/hooks';
import { consoleKeys } from '@sections/SuperadminConsole/queryKeys';
import { AcCreateRolePage } from './AcCreateRolePage';
import { setRolePermissionApi, setRolePermissionWithReasonApi, type RoleRow } from '@lib/superadminApi';
import { PERMISSION_KEYS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META, type PermissionRisk } from '@lib/permissionMeta';
import { LucideIcon, type LucideName } from '@ui/LucideIcon';
import { TableSearch, FilterDropdown, useFilterDropdowns, PageHeader } from '@ui';
import { toast } from '@store/ui';

// Rail chip per role (pastel on the white rail).
const ROLE_ICON: Record<string, { icon: LucideName; bg: string; fg: string }> = {
  superadmin:      { icon: 'ShieldAlert',       bg: 'var(--red-bg)',    fg: 'var(--red)' },
  admin:           { icon: 'SlidersHorizontal', bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  manager:         { icon: 'Users',             bg: 'var(--green-bg)',  fg: 'var(--green)' },
  employee:        { icon: 'User',              bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  hr_manager:      { icon: 'UsersRound',        bg: 'var(--purple-bg)', fg: 'var(--purple)' },
  hr_staff:        { icon: 'UsersRound',        bg: 'var(--accent-bg)', fg: 'var(--accent)' },
  finance_manager: { icon: 'Landmark',          bg: 'var(--amber-bg)',  fg: 'var(--amber)' },
  finance_staff:   { icon: 'Banknote',          bg: 'var(--amber-bg)',  fg: 'var(--amber)' },
  hse_staff:       { icon: 'HardHat',           bg: 'var(--green-bg)',  fg: 'var(--green)' },
};
const roleStyle = (name: string) => ROLE_ICON[name] ?? { icon: 'UserCog' as LucideName, bg: '#f1f3f7', fg: 'var(--muted)' };

// Same module→Lucide map the User Access table uses (visual sibling).
const MODULE_LUCIDE: Record<string, LucideName> = {
  HR: 'Users', Employees: 'Contact', 'Attendance & Leave': 'CalendarCheck', Payroll: 'Banknote',
  Finance: 'Landmark', HSE: 'HardHat', 'Sites & Map': 'Map', Calendar: 'CalendarDays',
  Workflow: 'Workflow', Tickets: 'Ticket', Communications: 'MessageSquare', Auth: 'KeyRound',
  Settings: 'Settings', System: 'Server', 'User Management': 'UserCog', Dashboard: 'LayoutDashboard',
};
const moduleLucide = (m: string): LucideName => MODULE_LUCIDE[m] ?? 'Box';
const dateShort = (iso: string) => new Date(iso).toLocaleDateString('en-US', { month: 'short', day: '2-digit', year: 'numeric' });
const capz = (s: string) => (s ? s[0]!.toUpperCase() + s.slice(1) : s);

const RISKS: PermissionRisk[] = ['low', 'medium', 'high', 'critical'];

export function AcRolesPage(): VNode {
  const qc = useQueryClient();
  const rolesQ = useRoles(true);
  const roles = rolesQ.data ?? [];

  const [selName, setSelName] = useState<string | null>(() => {
    try { return localStorage.getItem('siomac_ac_roles_sel'); } catch { return null; }
  });
  const [railTab, setRailTab] = useState<'system' | 'custom'>('system');
  const [railSearch, setRailSearch] = useState('');
  const [editing, setEditing] = useState<RoleRow | 'new' | null>(null);

  const systemRoles = roles.filter(r => r.isSystem);
  const customRoles = roles.filter(r => !r.isSystem);
  const inUse = roles.filter(r => r.userCount > 0).length;
  const railRoles = useMemo(() => {
    const q = railSearch.trim().toLowerCase();
    return roles.filter(r => (railTab === 'system' ? r.isSystem : !r.isSystem) && (!q || r.label.toLowerCase().includes(q) || r.name.includes(q)));
  }, [roles, railTab, railSearch]);

  const selRole = roles.find(r => r.name === selName) ?? null;
  useEffect(() => { if ((!selName || !roles.some(r => r.name === selName)) && roles.length) setSelName(roles[0]!.name); }, [roles, selName]);
  const pickRole = (name: string) => {
    setSelName(name);
    // If the picked role lives on the other tab, follow it so the selection stays visible.
    const r = roles.find(x => x.name === name);
    if (r) setRailTab(r.isSystem ? 'system' : 'custom');
    try { localStorage.setItem('siomac_ac_roles_sel', name); } catch { /* ignore */ }
  };

  return (
    <div class="acx">
      <PageHeader
        icon={<LucideIcon name="ShieldCheck" size={22} />}
        module="Access Control"
        title="Roles"
        sub="Manage roles and the default capabilities each one grants. User-level exceptions live in User Access."
        actions={
          <button type="button" class="acx-hdr-btn primary" onClick={() => setEditing('new')}>
            <LucideIcon name="Plus" size={15} /> New Role
          </button>
        }
      />

      <div class="r2-layout">
        {/* ── LEFT RAIL — role directory ─────────────────────────────────── */}
        <div class="r2-left">
          <div class="card r2-rail">
            <div class="r2-rail-head">
              <span class="u-recent-title"><LucideIcon name="Layers" size={15} /> Role Directory <span class="muted" style={{ fontWeight: 500 }}>({roles.length})</span></span>
            </div>
            <div class="r2-rail-stats">
              <div class="r2-rst"><span class="r2-rst-n">{roles.length}</span><span class="r2-rst-l">Roles</span></div>
              <div class="r2-rst"><span class="r2-rst-n">{inUse}</span><span class="r2-rst-l">In Use</span></div>
              <div class="r2-rst"><span class="r2-rst-n">{roles.length - inUse}</span><span class="r2-rst-l">Empty</span></div>
            </div>
            <div class="r2-rail-search"><i class="fas fa-magnifying-glass" /><input class="input" placeholder="Search roles…" value={railSearch} onInput={e => setRailSearch((e.target as HTMLInputElement).value)} /></div>
            <div class="r2-rail-tabs">
              <button type="button" class={`r2-rtab${railTab === 'system' ? ' on' : ''}`} onClick={() => setRailTab('system')}>System <span>{systemRoles.length}</span></button>
              <button type="button" class={`r2-rtab${railTab === 'custom' ? ' on' : ''}`} onClick={() => setRailTab('custom')}>Custom <span>{customRoles.length}</span></button>
            </div>
            <div class="r2-rail-list">
              {rolesQ.isLoading ? <div class="ac-loading">Loading roles…</div>
               : railRoles.length === 0 ? <div class="ac-empty">{railTab === 'custom' ? 'No custom roles yet.' : 'No roles match.'}</div>
               : railRoles.map(r => {
                const st = roleStyle(r.name);
                return (
                  <button type="button" key={r.name} class={`r2-ritem${r.name === selName ? ' on' : ''}`} onClick={() => pickRole(r.name)}>
                    <span class="r2-ritem-ico" style={{ background: st.bg, color: st.fg }}><LucideIcon name={st.icon} size={17} /></span>
                    <span class="r2-ritem-main">
                      <span class="r2-ritem-name">{r.label}</span>
                      <span class="r2-ritem-meta">{r.isSystem ? 'System' : 'Custom'} · {r.userCount} member{r.userCount === 1 ? '' : 's'}</span>
                    </span>
                    <LucideIcon name="ChevronRight" size={15} />
                  </button>
                );
              })}
            </div>
          </div>
        </div>

        {/* ── CENTER — role profile + capability editor ───────────────────── */}
        <div class="r2-center">
          {!selRole ? <div class="card"><div class="ac-empty">Select a role to edit its default access.</div></div> : (
            <RoleEditor key={selRole.name} role={selRole} qc={qc} onEdit={() => setEditing(selRole)} rolesRefetch={() => void rolesQ.refetch()} />
          )}
        </div>
      </div>

      {editing && <AcCreateRolePage role={editing === 'new' ? undefined : editing} onDone={() => { setEditing(null); void rolesQ.refetch(); }} />}
    </div>
  );
}

// ── Rich maker-checker dialog (critical enable → reason) ──────────────────────

function ApprovalDialog({ roleLabel, permKey, onSubmit, onCancel }: {
  roleLabel: string; permKey: string; onSubmit: (reason: string) => void; onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const m = PERMISSION_META[permKey as PermissionKey];
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);
  return createPortal(
    <div class="acx r2-overlay" onClick={onCancel}>
      <div class="r2-modal" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Approval required">
        <div class="r2-modal-head">
          <span class="r2-modal-ico amber"><LucideIcon name="ShieldAlert" size={17} /></span>
          <div class="r2-modal-titles">
            <div class="r2-modal-title">Approval Required</div>
            <div class="r2-modal-sub">Critical capability — it will be routed to a second superadmin instead of applied immediately.</div>
          </div>
          <button type="button" class="r2-modal-x" onClick={onCancel} aria-label="Close"><LucideIcon name="X" size={17} /></button>
        </div>
        <div class="r2-modal-body">
          <div class="r2-facts">
            <div class="r2-kv"><span>Role</span><strong>{roleLabel}</strong></div>
            <div class="r2-kv"><span>Capability</span><strong>{m?.label ?? permKey}</strong></div>
            <div class="r2-kv"><span>Module</span><strong>{m?.module ?? '—'}{m?.group && m.group !== m.module ? ` · ${m.group}` : ''}</strong></div>
            <div class="r2-kv"><span>Risk Level</span><span class={`risk ${m?.risk ?? 'critical'}`}>{capz(m?.risk ?? 'critical')}</span></div>
          </div>
          {m?.description && <p class="r2-modal-desc">{m.description}</p>}
          <label class="r2-reason-lbl" for="r2-reason">Reason for request <span>(required)</span></label>
          <textarea id="r2-reason" class="r2-reason" maxLength={500} placeholder="Explain why this role needs this critical capability…" value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} />
          <div class="r2-reason-count">{reason.length} / 500</div>
        </div>
        <div class="r2-modal-foot">
          <button type="button" class="btn" onClick={onCancel}>Cancel</button>
          <button type="button" class="btn primary u-save" disabled={!reason.trim()} onClick={() => onSubmit(reason.trim())}>Submit for Approval</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Review & Save dialog (diff of buffered changes) ───────────────────────────

function ReviewDialog({ role, pending, saving, onCancel, onConfirm }: {
  role: RoleRow; pending: Map<string, boolean>; saving: boolean; onCancel: () => void; onConfirm: () => void;
}): VNode {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => { if (e.key === 'Escape') onCancel(); };
    window.addEventListener('keydown', onKey); return () => window.removeEventListener('keydown', onKey);
  }, [onCancel]);

  const byModule = useMemo(() => {
    const m = new Map<string, { k: PermissionKey; added: boolean }[]>();
    for (const [k, want] of pending) {
      const meta = PERMISSION_META[k as PermissionKey]; if (!meta) continue;
      (m.get(meta.module) ?? m.set(meta.module, []).get(meta.module)!).push({ k: k as PermissionKey, added: want });
    }
    return m;
  }, [pending]);
  const approvals = [...pending.entries()].filter(([k, want]) => want && CRITICAL_GRANT_KEYS.has(k)).length;

  return createPortal(
    <div class="acx r2-overlay" onClick={onCancel}>
      <div class="r2-modal r2-modal-wide" onClick={e => e.stopPropagation()} role="dialog" aria-modal="true" aria-label="Review changes">
        <div class="r2-modal-head">
          <span class="r2-modal-ico blue"><LucideIcon name="ListChecks" size={17} /></span>
          <div class="r2-modal-titles">
            <div class="r2-modal-title">Review Changes</div>
            <div class="r2-modal-sub">{pending.size} change{pending.size === 1 ? '' : 's'} to <strong>{role.label}</strong> · affects {role.userCount} member{role.userCount === 1 ? '' : 's'}</div>
          </div>
          <button type="button" class="r2-modal-x" onClick={onCancel} aria-label="Close"><LucideIcon name="X" size={17} /></button>
        </div>
        <div class="r2-modal-body r2-review-body">
          {[...byModule.entries()].map(([mod, recs]) => (
            <div class="r2-rev-grp" key={mod}>
              <div class="r2-rev-grp-head"><LucideIcon name={moduleLucide(mod)} size={14} /> {mod} <span class="r2-rev-grp-ct">{recs.length}</span></div>
              {recs.map(rec => {
                const meta = PERMISSION_META[rec.k]!;
                const needsApproval = rec.added && CRITICAL_GRANT_KEYS.has(rec.k);
                return (
                  <div class="r2-rev-row" key={rec.k}>
                    <span class={`r2-rev-badge ${rec.added ? 'add' : 'rem'}`}>{rec.added ? 'Enable' : 'Disable'}</span>
                    <span class="r2-rev-cap" title={meta.description}>{meta.label}</span>
                    <span class={`risk ${meta.risk}`}>{capz(meta.risk)}</span>
                    {needsApproval && <span class="r2-appr">Approval</span>}
                  </div>
                );
              })}
            </div>
          ))}
          {approvals > 0 && (
            <div class="r2-rev-note">
              <LucideIcon name="ShieldAlert" size={15} />
              {approvals} critical grant{approvals === 1 ? '' : 's'} will be sent for a second superadmin's approval instead of applied immediately.
            </div>
          )}
        </div>
        <div class="r2-modal-foot">
          <button type="button" class="btn" disabled={saving} onClick={onCancel}>Back</button>
          <button type="button" class="btn primary u-save" disabled={saving} onClick={onConfirm}>{saving ? 'Saving…' : 'Confirm & Save'}</button>
        </div>
      </div>
    </div>,
    document.body,
  );
}

// ── Role editor (navy profile card + capability table) ────────────────────────

function RoleEditor({ role, qc, onEdit, rolesRefetch }: {
  role: RoleRow; qc: ReturnType<typeof useQueryClient>; onEdit: () => void; rolesRefetch: () => void;
}): VNode {
  const isSuper = role.name === 'superadmin';
  const rolePermsQ = useRolePermissions(role.name);
  const auditQ = useAuditLogs({ entity_id: role.name, includeActions: ['role_perm_grant', 'role_perm_revoke'], limit: 500 }, !isSuper);

  const [pending, setPending] = useState<Map<string, boolean>>(new Map());
  const [reasons, setReasons] = useState<Map<string, string>>(new Map());
  const [filter, setFilter] = useState<{ modules: string[]; risks: string[]; state: string[]; search: string }>({ modules: [], risks: [], state: [], search: '' });
  const { openId, setOpenId } = useFilterDropdowns();
  const [collapsed, setCollapsed] = useState<Set<string>>(() => new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean) as string[]));
  const [critPrompt, setCritPrompt] = useState<string | null>(null);
  const [reviewing, setReviewing] = useState(false);
  const [saving, setSaving] = useState(false);

  const loaded = isSuper || !!rolePermsQ.data;
  const baseGranted = (k: string) => isSuper || (rolePermsQ.data ?? []).includes(k);
  const granted = (k: string) => (pending.has(k) ? pending.get(k)! : baseGranted(k));

  // Per-capability last-changed (from audit).
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

  // Catalogue shape: module → sub-group → keys (stable).
  const catalogue = useMemo(() => {
    const m = new Map<string, Map<string, PermissionKey[]>>();
    for (const k of PERMISSION_KEYS) {
      const meta = PERMISSION_META[k]; if (!meta) continue;
      const grp = meta.group || 'General';
      let g = m.get(meta.module); if (!g) { g = new Map(); m.set(meta.module, g); }
      (g.get(grp) ?? g.set(grp, []).get(grp)!).push(k);
    }
    return m;
  }, []);
  const allModules = useMemo(() => [...catalogue.keys()], [catalogue]);

  // Filtered view: module → group → keys after search/filters. Filtering force-expands.
  const q = filter.search.trim().toLowerCase();
  const filterActive = !!q || filter.modules.length > 0 || filter.risks.length > 0 || filter.state.length > 0;
  const view = useMemo(() => {
    const out = new Map<string, Map<string, PermissionKey[]>>();
    for (const [mod, grps] of catalogue) {
      if (filter.modules.length && !filter.modules.includes(mod)) continue;
      let gout: Map<string, PermissionKey[]> | null = null;
      for (const [grp, keys] of grps) {
        const kept = keys.filter(k => {
          const meta = PERMISSION_META[k]!;
          if (filter.risks.length && !filter.risks.includes(meta.risk)) return false;
          if (filter.state.length && !filter.state.includes(granted(k) ? 'enabled' : 'disabled')) return false;
          if (q && !meta.label.toLowerCase().includes(q) && !meta.description.toLowerCase().includes(q)) return false;
          return true;
        });
        if (!kept.length) continue;
        if (!gout) { gout = new Map(); out.set(mod, gout); }
        gout.set(grp, kept);
      }
    }
    return out;
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, [catalogue, filter, q, pending, rolePermsQ.data, isSuper]);

  const modKeys = (mod: string): PermissionKey[] => [...(view.get(mod)?.values() ?? [])].flat();
  const totalShown = [...view.values()].reduce((n, g) => n + [...g.values()].reduce((x, a) => x + a.length, 0), 0);

  // Header stats.
  const totalCaps = PERMISSION_KEYS.length;
  const enabledCount = useMemo(() => (loaded ? PERMISSION_KEYS.filter(k => granted(k)).length : 0), [pending, rolePermsQ.data, isSuper, loaded]);
  const highRiskEnabled = useMemo(() => (loaded ? PERMISSION_KEYS.filter(k => granted(k) && CRITICAL_GRANT_KEYS.has(k)).length : 0), [pending, rolePermsQ.data, isSuper, loaded]);

  // Buffered edits.
  const setBuf = (k: string, want: boolean) => setPending(prev => {
    const n = new Map(prev);
    if (want === baseGranted(k)) n.delete(k); else n.set(k, want);
    return n;
  });
  const onToggle = (k: string) => {
    if (isSuper || !loaded) return;
    const next = !granted(k);
    if (next && CRITICAL_GRANT_KEYS.has(k)) { setCritPrompt(k); return; }
    setBuf(k, next);
    if (!next) setReasons(prev => { if (!prev.has(k)) return prev; const n = new Map(prev); n.delete(k); return n; });
  };
  const confirmCritical = (reason: string) => {
    const k = critPrompt; setCritPrompt(null);
    if (!k) return;
    setBuf(k, true);
    setReasons(prev => new Map(prev).set(k, reason));
  };
  const bulk = (keys: readonly PermissionKey[], want: boolean) => {
    if (isSuper || !loaded) return;
    let skipped = 0;
    setPending(prev => {
      const n = new Map(prev);
      for (const k of keys) {
        if (want && CRITICAL_GRANT_KEYS.has(k) && !granted(k)) { skipped++; continue; }   // criticals need the reason dialog
        if (want === baseGranted(k)) n.delete(k); else n.set(k, want);
      }
      return n;
    });
    if (skipped) toast.info(`${skipped} critical capabilit${skipped === 1 ? 'y' : 'ies'} skipped — enable individually (approval required).`);
  };
  const discard = () => { setPending(new Map()); setReasons(new Map()); };

  const pendEnable  = [...pending.values()].filter(v => v).length;
  const pendDisable = pending.size - pendEnable;

  const save = async () => {
    if (!pending.size) return;
    setSaving(true);
    let applied = 0, submitted = 0;
    try {
      for (const [key, want] of pending) {
        if (want && CRITICAL_GRANT_KEYS.has(key)) {
          const res = await setRolePermissionWithReasonApi(role.name, key, true, reasons.get(key) ?? '');
          if (!res.success) throw new Error(res.message ?? `Failed to submit ${key}.`);
          submitted++;
        } else {
          const res = await setRolePermissionApi(role.name, key, want);
          if (!res.success) throw new Error(res.message ?? `Failed to update ${key}.`);
          applied++;
        }
      }
      setPending(new Map()); setReasons(new Map()); setReviewing(false);
      void qc.invalidateQueries({ queryKey: consoleKeys.rolePerms(role.name) });
      void qc.invalidateQueries({ queryKey: consoleKeys.approvals('pending') });
      void rolePermsQ.refetch(); void auditQ.refetch(); rolesRefetch();
      toast.success(submitted
        ? `Saved ${applied} change${applied === 1 ? '' : 's'} · ${submitted} sent for approval.`
        : `Saved ${applied} change${applied === 1 ? '' : 's'} to ${role.label}.`);
    } catch (e) { toast.error(e instanceof Error ? e.message : 'Failed to save.'); }
    finally { setSaving(false); }
  };

  const toggleMod = (m: string) => setCollapsed(prev => { const n = new Set(prev); n.has(m) ? n.delete(m) : n.add(m); return n; });
  const st = roleStyle(role.name);

  return (
    <>
      {/* Role Profile — navy sibling of the User Access "Access Profile" card */}
      <div class="u-prof-card">
        <div class="u-prof-top">
          <span class="u-prof-title"><LucideIcon name="ShieldCheck" size={19} /> Role Profile</span>
          {!isSuper && (
            <button type="button" class="r2-hd-btn" onClick={onEdit}><LucideIcon name="Settings2" size={14} /> Role Details</button>
          )}
        </div>
        <div class="u-prof-main">
          <div class="u-prof-entity">
            <span class="r2-role-ico" style={{ color: '#fff' }}><LucideIcon name={st.icon} size={26} /></span>
            <div class="u-prof-id">
              <div class="u-prof-name-line">
                <h2 class="u-prof-name">{role.label}</h2>
                <span class={`u-prof-badge${role.isSystem ? '' : ' r2-badge-cust'}`}><i class="fas fa-circle" /> {role.isSystem ? 'System Role' : 'Custom Role'}</span>
                {isSuper && <span class="u-prof-badge off"><i class="fas fa-circle" /> Immutable</span>}
              </div>
              <div class="u-prof-ref">{role.description || (isSuper ? 'Full, unrestricted access. Permanent.' : 'Role default capability set.')}</div>
              <div class="u-prof-meta">
                <span><LucideIcon name="Users" size={14} /> {role.userCount} member{role.userCount === 1 ? '' : 's'}</span>
                <span class="u-prof-sep">·</span>
                <span><LucideIcon name="ToggleRight" size={14} /> {loaded ? `${enabledCount} of ${totalCaps} enabled` : 'Loading…'}</span>
              </div>
            </div>
          </div>
          <div class="u-prof-stats">
            <div class="u-prof-stat"><span class="u-prof-stat-ic"><LucideIcon name="TableProperties" size={15} /></span><div><div class="u-prof-stat-n">{loaded ? enabledCount : '—'}</div><div class="u-prof-stat-l">Enabled</div></div></div>
            <div class="u-prof-stat"><span class="u-prof-stat-ic red"><LucideIcon name="ShieldAlert" size={15} /></span><div><div class="u-prof-stat-n">{loaded ? highRiskEnabled : '—'}</div><div class="u-prof-stat-l">High-Risk</div></div></div>
            <div class="u-prof-stat"><span class="u-prof-stat-ic green"><LucideIcon name="Gauge" size={15} /></span><div><div class="u-prof-stat-n">{loaded ? `${Math.round((enabledCount / totalCaps) * 100)}%` : '—'}</div><div class="u-prof-stat-l">Coverage</div></div></div>
          </div>
        </div>
      </div>

      {/* Immutable notice (superadmin only) */}
      {isSuper && (
        <div class="u-info-banner">
          <span class="u-info-ico"><LucideIcon name="Lock" size={16} strokeWidth={2.2} /></span>
          <div class="u-info-txt">
            <div class="u-info-title">Superadmin is immutable</div>
            <div class="u-info-sub">This system role has every capability enabled by default and cannot be edited.</div>
          </div>
        </div>
      )}

      {/* Toolbar — same kit as User Access */}
      <div class="r2-toolbar">
        <div class="r2-toolbar-search">
          <TableSearch value={filter.search} onChange={v => setFilter(f => ({ ...f, search: v }))} placeholder="Search capabilities…" />
        </div>
        <FilterDropdown id="r2-mod" label="Module" openId={openId} setOpenId={setOpenId}
          options={allModules} selected={filter.modules} onChange={v => setFilter(f => ({ ...f, modules: v }))} />
        <FilterDropdown id="r2-risk" label="Risk" openId={openId} setOpenId={setOpenId}
          options={RISKS} selected={filter.risks} onChange={v => setFilter(f => ({ ...f, risks: v }))} labelFn={capz} />
        <FilterDropdown id="r2-state" label="Access" openId={openId} setOpenId={setOpenId}
          options={['enabled', 'disabled']} selected={filter.state} onChange={v => setFilter(f => ({ ...f, state: v }))} labelFn={capz} />
      </div>

      {/* Capability table — sibling of the User Access override table */}
      <div class="card" style={{ overflow: 'hidden' }}>
        <div class="u-tbl-top">
          <span class="u-tbl-count">{view.size} module{view.size === 1 ? '' : 's'} · {totalShown} capabilities{filterActive ? ' shown' : ''}</span>
        </div>
        <table class="tbl" style={{ tableLayout: 'fixed' }}>
          <colgroup><col style={{ width: '46%' }} /><col style={{ width: '13%' }} /><col style={{ width: '20%' }} /><col style={{ width: '21%' }} /></colgroup>
          <thead><tr><th>Capability</th><th>Risk</th><th>Last Changed</th><th style={{ textAlign: 'right' }}>Default Access</th></tr></thead>
          <tbody>
            {!loaded ? (
              <tr><td colSpan={4}><div class="ac-loading">Loading role defaults…</div></td></tr>
            ) : view.size === 0 ? (
              <tr><td colSpan={4}><div class="ac-empty">No capabilities match.</div></td></tr>
            ) : [...view.entries()].map(([mod, grps]) => {
              const keys = modKeys(mod);
              const en = keys.filter(k => granted(k)).length;
              const catTotal = [...(catalogue.get(mod)?.values() ?? [])].flat().length;
              const open = filterActive || !collapsed.has(mod);
              const full = en === keys.length && keys.length > 0;
              const hasHot = keys.some(k => granted(k) && CRITICAL_GRANT_KEYS.has(k));
              const multiGroup = grps.size > 1;
              return (
                <Fragment key={mod}>
                  <tr class="grp">
                    <td colSpan={4} style={{ padding: '12px 18px', cursor: filterActive ? 'default' : 'pointer' }} onClick={() => { if (!filterActive) toggleMod(mod); }}>
                      <span style={{ display: 'flex', alignItems: 'center', gap: '11px' }}>
                        <span style={{ color: 'var(--faint)', width: '14px', display: 'inline-flex', flex: 'none' }}><LucideIcon name={open ? 'Minus' : 'Plus'} size={14} strokeWidth={2.5} /></span>
                        <span class="u-mod-ico"><LucideIcon name={moduleLucide(mod)} size={15} /></span>
                        <span class="u-mod-name">{mod}</span>
                        <span class="u-mod-count">{filterActive ? `${keys.length}/${catTotal}` : keys.length}</span>
                        <span class="r2-bar"><span class={`r2-bar-fill${full ? ' full' : ''}`} style={{ width: `${keys.length ? Math.round((en / keys.length) * 100) : 0}%` }} /></span>
                        <span class="r2-mod-en">{en}/{keys.length} enabled</span>
                        {full ? <span class="r2-mod-full"><LucideIcon name="CircleCheck" size={14} /></span>
                          : hasHot ? <span class="r2-mod-hot" title="High-risk capability enabled" /> : null}
                        {open && !isSuper && (
                          <span class="r2-bulk" onClick={e => e.stopPropagation()}>
                            <button type="button" onClick={() => bulk(keys, true)}>Enable All</button>
                            <span class="r2-bulk-sep">·</span>
                            <button type="button" class="off" onClick={() => bulk(keys, false)}>Disable All</button>
                          </span>
                        )}
                      </span>
                    </td>
                  </tr>
                  {open && [...grps.entries()].map(([grp, gkeys]) => (
                    <Fragment key={grp}>
                      {multiGroup && (
                        <tr class="u-sub r2-grp-row">
                          <td colSpan={4}>
                            <span class="r2-grp-inner">
                              <span class="r2-grp-name">{grp}</span>
                              {!isSuper && (
                                <span class="r2-bulk">
                                  <button type="button" onClick={() => bulk(gkeys, true)}>Enable All</button>
                                  <span class="r2-bulk-sep">·</span>
                                  <button type="button" class="off" onClick={() => bulk(gkeys, false)}>Disable All</button>
                                </span>
                              )}
                            </span>
                          </td>
                        </tr>
                      )}
                      {gkeys.map((k, i) => {
                        const meta = PERMISSION_META[k]!;
                        const isCrit = CRITICAL_GRANT_KEYS.has(k);
                        const dirty = pending.has(k);
                        const up = lastUpd.get(k);
                        const isLast = i === gkeys.length - 1;
                        return (
                          <tr key={k} class={`u-sub${dirty ? ' r2-dirty' : ''}`}>
                            <td class={`u-cap-cell${isLast ? ' is-last' : ''}`}>
                              <div class="u-cap-name">
                                {meta.label}
                                {isCrit && <span class="risk critical" style={{ marginLeft: '8px', fontSize: '10px' }}>Approval</span>}
                                {dirty && <span class="r2-edited">Edited</span>}
                              </div>
                              <div class="u-cap-desc">{meta.description}</div>
                            </td>
                            <td><span class={`risk ${meta.risk}`}>{capz(meta.risk)}</span></td>
                            <td class="r2-upd">{up ? <><span>{dateShort(up.date)}</span><span class="r2-upd-by">{up.actor}</span></> : <span class="r2-upd-none">—</span>}</td>
                            <td style={{ textAlign: 'right' }}>
                              <span class="r2-tgl-wrap">
                                {isSuper && <LucideIcon name="Lock" size={13} />}
                                <button type="button" class={`toggle${granted(k) ? ' on' : ''}`} disabled={isSuper || saving} onClick={() => onToggle(k)} aria-pressed={granted(k)} aria-label={`${meta.label} default access`} />
                              </span>
                            </td>
                          </tr>
                        );
                      })}
                    </Fragment>
                  ))}
                </Fragment>
              );
            })}
          </tbody>
        </table>
      </div>

      {/* Buffered action bar — same design as User Access */}
      {pending.size > 0 && (
        <div class="u-action-bar">
          <div class="u-ab-lead">
            <span class="u-ab-ico"><i class="fas fa-triangle-exclamation" /></span>
            <div>
              <div class="u-ab-title">{pending.size} Pending Change{pending.size === 1 ? '' : 's'}</div>
              <div class="u-ab-sub">Affects {role.userCount} member{role.userCount === 1 ? '' : 's'} with this role</div>
            </div>
          </div>
          <div class="u-ab-chips">
            <span class="u-ab-chip green">
              <span class="u-ab-num">{pendEnable}</span>
              <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Capabilit{pendEnable === 1 ? 'y' : 'ies'}</span><span class="u-ab-chip-val">Enable</span></span>
            </span>
            <span class="u-ab-chip red">
              <span class="u-ab-num">{pendDisable}</span>
              <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Capabilit{pendDisable === 1 ? 'y' : 'ies'}</span><span class="u-ab-chip-val">Disable</span></span>
            </span>
            <span class="u-ab-chip neutral">
              <span class="u-ab-num">{pending.size}</span>
              <span class="u-ab-chip-t"><span class="u-ab-chip-lbl">Total</span><span class="u-ab-chip-val">Changes</span></span>
            </span>
          </div>
          <div class="u-ab-actions">
            <button type="button" class="btn" disabled={saving} onClick={discard}>Discard Changes</button>
            <button type="button" class="btn primary u-save" disabled={saving} onClick={() => setReviewing(true)}>Review &amp; Save</button>
          </div>
        </div>
      )}

      {critPrompt && <ApprovalDialog roleLabel={role.label} permKey={critPrompt} onSubmit={confirmCritical} onCancel={() => setCritPrompt(null)} />}
      {reviewing && <ReviewDialog role={role} pending={pending} saving={saving} onCancel={() => setReviewing(false)} onConfirm={() => void save()} />}
    </>
  );
}
