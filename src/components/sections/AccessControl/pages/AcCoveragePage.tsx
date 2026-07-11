/**
 * src/components/sections/AccessControl/pages/AcCoveragePage.tsx
 *
 * Access Control — Module Coverage (reproduces rbac-mockups/finance-coverage.html):
 * a drill-down of one module's capability groups × role coverage (Full / Partial /
 * None, computed from ROLE_PERMISSIONS — orientation-only role defaults), plus
 * recent role-permission changes (audit) and the module's pending approvals.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { useAuditLogs, usePermissionApprovals } from '@sections/SuperadminConsole/hooks';
import { PERMISSION_KEYS, ROLE_PERMISSIONS, CRITICAL_GRANT_KEYS, type PermissionKey } from '@lib/permissions';
import { PERMISSION_META } from '@lib/permissionMeta';

type RoleKey = keyof typeof ROLE_PERMISSIONS;
const COV_ROLES: { key: RoleKey; label: string; badge: string }[] = [
  { key: 'superadmin', label: 'Superadmin', badge: 'blue' },
  { key: 'admin', label: 'Admin', badge: 'blue' },
  { key: 'manager', label: 'Manager', badge: 'purple' },
  { key: 'employee', label: 'Employee', badge: 'green' },
];

type Cov = 'full' | 'partial' | 'none';
function coverage(keys: PermissionKey[], role: RoleKey): Cov {
  if (role === 'superadmin') return 'full';
  const set = ROLE_PERMISSIONS[role]; const g = keys.filter(k => set.has(k)).length;
  return g === keys.length ? 'full' : g > 0 ? 'partial' : 'none';
}
const CovBadge = ({ c }: { c: Cov }): VNode =>
  c === 'full' ? <span class="acc-badge full"><i class="fas fa-check" /> Full Access</span>
  : c === 'partial' ? <span class="acc-badge partial"><i class="fas fa-circle-half-stroke" /> Partial Access</span>
  : <span class="acc-badge none"><i class="fas fa-minus" /> No Access</span>;

const initials = (s: string) => (s || '?').split(/[\s._-]+/).map(w => w[0]).join('').slice(0, 2).toUpperCase();
const ago = (iso: string) => { const s = Math.max(0, (Date.now() - new Date(iso).getTime()) / 1000); if (s < 3600) return `${Math.floor(s / 60)}m ago`; if (s < 86400) return `${Math.floor(s / 3600)}h ago`; return `${Math.floor(s / 86400)}d ago`; };
const goTo = (id: string) => { try { window.dispatchEvent(new CustomEvent('siomac:section', { detail: id })); } catch (_) { /* ignore */ } };

export function AcCoveragePage(): VNode {
  const modules = useMemo(() => [...new Set(PERMISSION_KEYS.map(k => PERMISSION_META[k]?.module).filter(Boolean))].sort() as string[], []);
  const [module, setModule] = useState<string>(() => modules[0] ?? 'HR');
  const [open, setOpen] = useState<Set<string>>(new Set());

  const auditQ = useAuditLogs({ limit: 10 }, true);
  const approvalsQ = usePermissionApprovals('pending');

  const moduleKeys = useMemo(() => PERMISSION_KEYS.filter(k => PERMISSION_META[k]?.module === module), [module]);
  const groups = useMemo(() => {
    const byGrp = new Map<string, PermissionKey[]>();
    for (const k of moduleKeys) { const g = PERMISSION_META[k]!.group; (byGrp.get(g) ?? byGrp.set(g, []).get(g)!).push(k); }
    return byGrp;
  }, [moduleKeys]);

  const stats = useMemo(() => {
    const highRisk = moduleKeys.filter(k => CRITICAL_GRANT_KEYS.has(k)).length;
    const fully = COV_ROLES.filter(r => coverage(moduleKeys, r.key) === 'full');
    return { total: moduleKeys.length, groups: groups.size, highRisk, fully };
  }, [moduleKeys, groups]);

  const modApprovals = useMemo(() => (approvalsQ.data ?? []).filter(a => PERMISSION_META[a.permissionKey as PermissionKey]?.module === module), [approvalsQ.data, module]);
  const roleChanges = useMemo(() => (auditQ.data?.logs ?? []).filter((l: { action: string }) => l.action === 'role_perm_grant' || l.action === 'role_perm_revoke').slice(0, 6), [auditQ.data]);

  const exportCsv = () => {
    const head = ['Group', ...COV_ROLES.map(r => r.label)].join(',');
    const rows = [...groups.entries()].map(([g, keys]) => [g, ...COV_ROLES.map(r => coverage(keys, r.key))].join(','));
    const blob = new Blob([[head, ...rows].join('\n')], { type: 'text/csv' });
    const a = document.createElement('a'); a.href = URL.createObjectURL(blob); a.download = `${module}-coverage.csv`; a.click(); URL.revokeObjectURL(a.href);
  };
  const toggle = (g: string) => setOpen(prev => { const n = new Set(prev); n.has(g) ? n.delete(g) : n.add(g); return n; });

  return (
    <div class="acx">
      <div class="crumb"><span class="link" onClick={() => goTo('s-ac-overview')}>Access Control Overview</span><span class="sep">›</span><span>{module}</span></div>

      <div class="page-head between" style={{ alignItems: 'center' }}>
        <div style={{ display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <span class="fc-page-icon"><i class="fas fa-chart-bar" /></span>
          <div>
            <h1 class="page-title">{module} Capability Coverage</h1>
            <p class="page-sub">Drill-down view of access coverage for the {module} module.</p>
          </div>
        </div>
        <div class="row" style={{ gap: '10px' }}>
          <select class="select" style={{ width: '190px', height: '40px' }} value={module} onChange={e => { setModule((e.target as HTMLSelectElement).value); setOpen(new Set()); }}>
            {modules.map(m => <option key={m} value={m}>{m}</option>)}
          </select>
          <button class="btn" onClick={exportCsv}><i class="fas fa-download" /> Export Report</button>
        </div>
      </div>

      <div class="stats">
        <div class="stat"><div class="stat-top"><span class="stat-ico blue"><i class="fas fa-shield-halved" /></span><div><div class="stat-lbl">Total Capabilities</div><div class="stat-val">{stats.total}</div><div class="stat-sub">Across {stats.groups} capability groups</div></div></div></div>
        <div class="stat"><div class="stat-top"><span class="stat-ico red"><i class="fas fa-shield-halved" /></span><div><div class="stat-lbl">High-Risk Capabilities</div><div class="stat-val">{stats.highRisk}</div><div class="stat-sub">Require attention</div></div></div></div>
        <div class="stat"><div class="stat-top"><span class="stat-ico green"><i class="fas fa-users" /></span><div><div class="stat-lbl">Fully Granted Roles</div><div class="stat-val">{stats.fully.length}</div><div class="stat-sub">{stats.fully.map(r => r.label).join(', ') || '—'}</div></div></div></div>
        <div class="stat"><div class="stat-top"><span class="stat-ico purple"><i class="fas fa-clock" /></span><div><div class="stat-lbl">Pending Approvals</div><div class="stat-val">{modApprovals.length}</div><div class="stat-sub">Affecting this module</div></div></div></div>
      </div>

      <div class="card" style={{ marginBottom: '20px' }}>
        <div class="card-head">
          <div class="card-title">{module} Capabilities by Group</div>
          <div class="row" style={{ gap: '16px' }}>
            <span class="fc-legend-item green"><i class="fas fa-check" /> Full Access</span>
            <span class="fc-legend-item amber"><i class="fas fa-circle-half-stroke" /> Partial Access</span>
            <span class="fc-legend-item grey"><i class="fas fa-minus" /> No Access</span>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table class="tbl fc-tbl">
            <thead><tr>
              <th style={{ textAlign: 'left', minWidth: '230px' }}>Capability Group</th>
              {COV_ROLES.map(r => <th key={r.key}><span class={`badge ${r.badge}`}>{r.label}</span></th>)}
              <th style={{ width: '36px' }} />
            </tr></thead>
            <tbody>
              {[...groups.entries()].map(([grp, keys]) => {
                const hr = keys.some(k => CRITICAL_GRANT_KEYS.has(k)); const isOpen = open.has(grp);
                return (
                  <>
                    <tr class="fc-grp-row" key={`g-${grp}`} onClick={() => toggle(grp)}>
                      <td>
                        <span class="row" style={{ gap: '9px' }}>
                          <i class={`fas fa-chevron-${isOpen ? 'down' : 'right'} fc-chev`} />
                          <span class={`fc-grp-ico${hr ? ' fc-grp-ico-red' : ''}`}><i class="fas fa-layer-group" /></span>
                          <span class="fc-grp-name">{grp}</span>
                          {hr && <i class="fas fa-triangle-exclamation" style={{ color: 'var(--red)', fontSize: '12px' }} />}
                          <span class="fc-cap-ct">{keys.length} capabilities</span>
                        </span>
                      </td>
                      {COV_ROLES.map(r => <td key={r.key} class="fc-cell"><CovBadge c={coverage(keys, r.key)} /></td>)}
                      <td class="fc-drill"><i class={`fas fa-chevron-${isOpen ? 'down' : 'right'}`} style={{ color: 'var(--faint)' }} /></td>
                    </tr>
                    {isOpen && keys.map(k => (
                      <tr class="fc-cap-sub" key={k}>
                        <td class="fc-cap-item">{PERMISSION_META[k]!.label}{CRITICAL_GRANT_KEYS.has(k) && <span class="risk critical" style={{ marginLeft: '8px', fontSize: '10px' }}>Critical</span>}</td>
                        {COV_ROLES.map(r => <td key={r.key} class="fc-cell">{r.key === 'superadmin' || ROLE_PERMISSIONS[r.key].has(k) ? <span class="acc-dot full" style={{ width: '20px', height: '20px' }}><i class="fas fa-check" style={{ fontSize: '10px' }} /></span> : <span class="acc-dot none" style={{ width: '20px', height: '20px' }}><i class="fas fa-minus" style={{ fontSize: '10px' }} /></span>}</td>)}
                        <td />
                      </tr>
                    ))}
                  </>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>

      <div class="fc-btm">
        <div class="card">
          <div class="card-head"><div class="card-title">Recent Role-Permission Changes</div><span class="link" onClick={() => goTo('s-ac-audit')}>View All</span></div>
          <div>
            {auditQ.isLoading ? <div class="ac-loading">Loading…</div>
             : roleChanges.length === 0 ? <div class="ac-empty" style={{ padding: '28px 16px' }}>No recent role changes.</div>
             : (roleChanges as Array<{ id: string; username: string; action: string; entity_id: string; details: string; created_at: string }>).map((l, i) => {
              let perm = ''; try { perm = (JSON.parse(l.details || '{}').permission as string) ?? ''; } catch { /* ignore */ }
              const grant = l.action === 'role_perm_grant';
              return (
                <div class={`fc-tl-row${i === roleChanges.length - 1 ? ' fc-tl-last' : ''}`} key={l.id}>
                  <span class="avatar" style={{ width: '34px', height: '34px', fontSize: '12px' }}>{initials(l.username)}</span>
                  <div class="grow"><div class="fc-tl-name">{l.username}</div><div class="sub">{l.entity_id} role updated</div><div class="fc-tl-cap">{perm && PERMISSION_META[perm as PermissionKey] ? `${PERMISSION_META[perm as PermissionKey]!.module}: ${PERMISSION_META[perm as PermissionKey]!.label}` : perm}</div></div>
                  <div class="fc-tl-meta"><span class={`badge ${grant ? 'green' : 'red'}`}>{grant ? 'Granted' : 'Revoked'}</span><span class="sub">{ago(l.created_at)}</span></div>
                </div>
              );
            })}
          </div>
        </div>

        <div class="card" style={{ display: 'flex', flexDirection: 'column' }}>
          <div class="card-head"><div class="card-title">Approval-Required Changes</div><span class="link" onClick={() => goTo('s-ac-approvals')}>View All</span></div>
          <div style={{ flex: 1 }}>
            {approvalsQ.isLoading ? <div class="ac-loading">Loading…</div>
             : modApprovals.length === 0 ? <div class="ac-empty" style={{ padding: '28px 16px' }}>No pending approvals for {module}.</div>
             : modApprovals.map((a, i) => {
              const meta = PERMISSION_META[a.permissionKey as PermissionKey];
              return (
                <div class={`fc-apv-row${i === modApprovals.length - 1 ? ' fc-apv-last' : ''}`} key={a.id}>
                  <span class="fc-apv-ico"><i class="fas fa-shield-halved" /></span>
                  <div class="grow"><div class="fc-apv-title">Grant {meta?.label ?? a.permissionKey}</div><div class="sub" style={{ margin: '3px 0 1px' }}>{a.targetRole ? `${a.targetRole} role` : 'User override'}</div><div class="sub">Requested by {a.requestedByName}</div></div>
                  <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'flex-end', gap: '6px', flex: 'none' }}><span class={`risk ${meta?.risk === 'critical' ? 'high' : (meta?.risk ?? 'medium')}`}>{meta?.risk === 'critical' ? 'Critical' : (meta?.risk ?? 'medium')}</span><span class="sub">{ago(a.requestedAt)}</span></div>
                </div>
              );
            })}
          </div>
          <div style={{ padding: '14px 20px', borderTop: '1px solid var(--line)' }}><span class="link" onClick={() => goTo('s-ac-approvals')}>Go to Approvals <i class="fas fa-arrow-right" style={{ fontSize: '11px' }} /></span></div>
        </div>

        <div class="card">
          <div class="card-head"><div class="card-title">Module Summary</div></div>
          <div class="card-pad" style={{ display: 'flex', flexDirection: 'column', gap: '10px', fontSize: '13px' }}>
            <div class="between"><span class="muted">Capability groups</span><b>{stats.groups}</b></div>
            <div class="between"><span class="muted">Total capabilities</span><b>{stats.total}</b></div>
            <div class="between"><span class="muted">High-risk (approval-gated)</span><b style={{ color: 'var(--red)' }}>{stats.highRisk}</b></div>
            <div class="between"><span class="muted">Roles with full access</span><b>{stats.fully.length}</b></div>
            <div class="between"><span class="muted">Pending approvals</span><b>{modApprovals.length}</b></div>
          </div>
        </div>
      </div>
    </div>
  );
}
