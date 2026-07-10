/**
 * tabs/ModuleCoveragePage.tsx — Per-module access drill-down
 *
 * Shows the capability-group × role coverage table (Full/Partial/None badges)
 * plus recent permission changes for capabilities in this module (from audit log).
 * Reached from ModulesTab by clicking any module row.
 *
 * Note: Module Notes from the mockup (finance-coverage.html) are omitted — no backend.
 */

import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { PERMISSION_META } from '@lib/permissionMeta';
import { ROLE_PERMISSIONS } from '@lib/permissions';
import type { PermissionKey } from '@lib/permissions';
import { useAuditLogs } from '../hooks';
import '../ac.css';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager',
  hr_manager: 'HR Mgr', hr_staff: 'HR Staff', hse_staff: 'HSE Staff',
  finance_manager: 'Fin. Mgr', finance_staff: 'Fin. Staff', employee: 'Employee',
};
const ROLE_ORDER = ['superadmin', 'admin', 'manager', 'hr_manager', 'hr_staff', 'hse_staff', 'finance_manager', 'finance_staff', 'employee'];

type Level = 'none' | 'partial' | 'full';

function coverageLevel(role: string, keys: PermissionKey[]): Level {
  if (role === 'superadmin') return 'full';
  const set = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
  if (!set) return 'none';
  const count = keys.filter(k => set.has(k)).length;
  if (count === 0) return 'none';
  if (count >= keys.length) return 'full';
  return 'partial';
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

function actionLabel(action: string): string {
  if (action === 'permission_grant') return 'Granted';
  if (action === 'permission_deny')  return 'Denied';
  if (action === 'permission_clear') return 'Cleared';
  return action.replace(/_/g, ' ');
}
function actionBadgeClass(action: string): string {
  if (action === 'permission_grant') return 'green';
  if (action === 'permission_deny')  return 'red';
  return 'grey';
}

export interface ModuleCoveragePageProps {
  module: string;
  onBack: () => void;
}

export function ModuleCoveragePage({ module, onBack }: ModuleCoveragePageProps): VNode {
  const auditQ = useAuditLogs({ entity: 'user', limit: 10 }, true);

  const { roles, groups } = useMemo(() => {
    const roles = ROLE_ORDER.filter(r => r in ROLE_PERMISSIONS);

    // Build group → keys map for this module
    const byGroup = new Map<string, PermissionKey[]>();
    for (const key of Object.keys(PERMISSION_META) as PermissionKey[]) {
      const meta = PERMISSION_META[key];
      if (meta.module !== module) continue;
      const list = byGroup.get(meta.group) ?? [];
      if (!byGroup.has(meta.group)) byGroup.set(meta.group, list);
      list.push(key);
    }

    const groups = [...byGroup.entries()].map(([group, keys]) => ({
      group,
      keys,
      highRiskCount: keys.filter(k => {
        const m = PERMISSION_META[k]; return m.risk === 'high' || m.risk === 'critical';
      }).length,
      roleLevels: roles.map(role => ({
        role,
        level: coverageLevel(role, keys),
        count: role === 'superadmin' ? keys.length : keys.filter(k => {
          const set = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
          return set?.has(k);
        }).length,
        total: keys.length,
      })),
    })).sort((a, b) => b.keys.length - a.keys.length);

    return { roles, groups };
  }, [module]);

  const totalKeys = groups.reduce((n, g) => n + g.keys.length, 0);
  const highRiskTotal = groups.reduce((n, g) => n + g.highRiskCount, 0);

  // Filter recent audit events relevant to this module's capabilities
  const moduleCapKeys = new Set(groups.flatMap(g => g.keys));
  const recentLogs = (auditQ.data?.logs ?? []).filter(log => {
    try {
      const details = JSON.parse(log.details || '{}');
      return details.permission && moduleCapKeys.has(details.permission as PermissionKey);
    } catch { return false; }
  }).slice(0, 8);

  return (
    <div>
      {/* Breadcrumb */}
      <div class="ac-mc-crumb">
        <button type="button" class="ac-link" onClick={onBack}>
          <i class="fas fa-chevron-left" style={{ fontSize: '11px', marginRight: '4px' }} />Overview
        </button>
        <span class="sep">›</span>
        <span style={{ color: 'var(--ac-ink)', fontWeight: 600 }}>{module}</span>
      </div>

      {/* Page header */}
      <div class="ac-card" style={{ marginBottom: '18px' }}>
        <div style={{ padding: '18px 22px', display: 'flex', alignItems: 'flex-start', gap: '16px' }}>
          <span class="ac-mc-page-icon"><i class="fas fa-cube" /></span>
          <div style={{ flex: 1 }}>
            <div style={{ fontSize: '20px', fontWeight: 700, color: 'var(--ac-ink)', marginBottom: '3px' }}>{module}</div>
            <div style={{ fontSize: '13px', color: 'var(--ac-muted)', marginBottom: '10px' }}>
              {totalKeys} capabilities across {groups.length} group{groups.length !== 1 ? 's' : ''}{highRiskTotal > 0 ? ` · ${highRiskTotal} high-risk` : ''}
            </div>
            <div class="ac-mc-legend">
              <span class="ac-mc-legend-item green"><span class="ac-acc-dot full" /> Full</span>
              <span class="ac-mc-legend-item amber"><span class="ac-acc-dot partial" /> Partial</span>
              <span class="ac-mc-legend-item grey"><span class="ac-acc-dot none" /> None</span>
            </div>
          </div>
        </div>
      </div>

      {/* Coverage table */}
      <div class="ac-card" style={{ marginBottom: '18px', overflow: 'hidden' }}>
        <div class="ac-card-head">
          <div>
            <div class="ac-card-title">Capability Coverage by Role</div>
            <div class="ac-card-sub">Shows how many capabilities in each group are granted per role.</div>
          </div>
        </div>
        <div style={{ overflowX: 'auto' }}>
          <table class="ac-mc-tbl">
            <colgroup>
              <col style={{ minWidth: '200px' }} />
              {roles.map(r => <col key={r} style={{ width: '80px' }} />)}
            </colgroup>
            <thead>
              <tr>
                <th>Group</th>
                {roles.map(r => (
                  <th key={r} style={{ fontSize: '11px' }}>{ROLE_LABEL[r] ?? r}</th>
                ))}
              </tr>
            </thead>
            <tbody>
              {groups.map(g => (
                <tr key={g.group}>
                  <td style={{ paddingLeft: '16px' }}>
                    <div style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                      <span class={`ac-mc-grp-ico${g.highRiskCount > 0 ? ' red' : ''}`}>
                        <i class={`fas ${g.highRiskCount > 0 ? 'fa-shield-halved' : 'fa-key'}`} />
                      </span>
                      <div>
                        <div class="ac-mc-grp-name">{g.group}</div>
                        <div class="ac-mc-grp-ct">{g.keys.length} cap{g.keys.length !== 1 ? 's' : ''}{g.highRiskCount > 0 ? ` · ${g.highRiskCount} high-risk` : ''}</div>
                      </div>
                    </div>
                  </td>
                  {g.roleLevels.map(rl => (
                    <td key={rl.role} class="ac-mc-cell">
                      <div style={{ display: 'flex', flex: 'column', alignItems: 'center', gap: '3px' }}>
                        <span class={`ac-acc-dot ${rl.level}`} title={`${ROLE_LABEL[rl.role] ?? rl.role}: ${rl.count}/${rl.total}`} />
                        <span style={{ fontSize: '10px', color: 'var(--ac-faint)' }}>{rl.count}/{rl.total}</span>
                      </div>
                    </td>
                  ))}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>

      {/* Bottom: recent changes */}
      <div class="ac-card">
        <div class="ac-card-head">
          <div class="ac-card-title">Recent Access Changes — {module}</div>
        </div>
        {auditQ.isLoading ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
            <i class="fas fa-spinner fa-spin" /> Loading…
          </div>
        ) : recentLogs.length === 0 ? (
          <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
            No recent access changes for {module} capabilities.
          </div>
        ) : (
          recentLogs.map(log => {
            let details: Record<string, string> = {};
            try { details = JSON.parse(log.details || '{}'); } catch { /* no-op */ }
            const capKey = details['permission'] ?? '';
            const capMeta = capKey ? PERMISSION_META[capKey as PermissionKey] : null;
            return (
              <div key={log.id} class="ac-tl-row">
                <span class={`ac-badge ${actionBadgeClass(log.action)}`} style={{ fontSize: '10.5px', flexShrink: 0 }}>
                  {actionLabel(log.action)}
                </span>
                <div style={{ flex: 1, minWidth: 0 }}>
                  <div class="ac-tl-name">{log.username}</div>
                  <div class="ac-tl-cap">{capMeta?.label ?? capKey}</div>
                </div>
                <div class="ac-tl-meta">
                  <span class="ac-tl-time">{timeAgo(log.created_at)}</span>
                </div>
              </div>
            );
          })
        )}
      </div>
    </div>
  );
}
