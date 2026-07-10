/**
 * tabs/ModulesTab.tsx — Access Control Overview
 *
 * Layout:
 *   Stat strip (4 cards): Roles · Users · High-Risk Capabilities · Active Overrides
 *   Two-column body (minmax(0,1fr) 330px):
 *     Left:  module × role access matrix (Full / Partial / None dots)
 *     Right: High-Risk Capabilities list
 *            Recent Access Changes (last 6 permission audit events)
 *            Access Summary donut (per-module rollup percentages)
 *
 * All stat strip values are live — computed from useRoles + useConsoleUsers + the
 * static permission catalogue. The matrix and High-Risk list are catalogue-only
 * (no network calls needed). Recent Changes uses useAuditLogs.
 *
 * Editing lives in the Roles tab (per role) and Users tab (per user) — this tab
 * is orientation-only; clicking "View module" navigates to the ModuleCoveragePage.
 */

import { type VNode } from 'preact';
import { useState, useMemo } from 'preact/hooks';
import { PERMISSION_META } from '@lib/permissionMeta';
import { ROLE_PERMISSIONS } from '@lib/permissions';
import type { PermissionKey } from '@lib/permissions';
import { useRoles, useConsoleUsers, useAuditLogs } from '../hooks';
import { ModuleCoveragePage } from './ModuleCoveragePage';
import '../ac.css';

// ── Constants ─────────────────────────────────────────────────────────────────

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager',
  hr_manager: 'HR Mgr', hr_staff: 'HR Staff', hse_staff: 'HSE Staff',
  finance_manager: 'Fin. Mgr', finance_staff: 'Fin. Staff', employee: 'Employee',
};
const ROLE_ORDER = ['superadmin', 'admin', 'manager', 'hr_manager', 'hr_staff', 'hse_staff', 'finance_manager', 'finance_staff', 'employee'];

const MODULE_ALIAS: Record<string, string> = { Workflows: 'Workflow', auth: 'Auth' };
const normModule = (m: string): string => MODULE_ALIAS[m] ?? m;

// Precompute high-risk capabilities (static — from catalogue)
const HIGH_RISK_KEYS = (Object.keys(PERMISSION_META) as PermissionKey[]).filter(k => {
  const m = PERMISSION_META[k];
  return m.risk === 'high' || m.risk === 'critical';
}).slice(0, 10); // show first 10

// Precompute matrix rows (static)
type Level = 'none' | 'partial' | 'full';
interface Cell { role: string; have: number; total: number; level: Level }
interface MatrixRow { module: string; total: number; cells: Cell[] }

function buildMatrix(): { roles: string[]; rows: MatrixRow[] } {
  const byModule = new Map<string, PermissionKey[]>();
  for (const key of Object.keys(PERMISSION_META) as PermissionKey[]) {
    const mod = normModule(PERMISSION_META[key].module);
    const list = byModule.get(mod) ?? [];
    if (!byModule.has(mod)) byModule.set(mod, list);
    list.push(key);
  }
  const roles = ROLE_ORDER.filter(r => r in ROLE_PERMISSIONS);
  const rows: MatrixRow[] = [...byModule.entries()].map(([module, keys]) => {
    const cells = roles.map(role => {
      const isSuper = role === 'superadmin';
      const set = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
      const have = isSuper ? keys.length : keys.filter(k => set.has(k)).length;
      const level: Level = have === 0 ? 'none' : have >= keys.length ? 'full' : 'partial';
      return { role, have, total: keys.length, level };
    });
    return { module, total: keys.length, cells };
  }).sort((a, b) => b.total - a.total);
  return { roles, rows };
}

const { roles: ROLES, rows: MATRIX_ROWS } = buildMatrix();
const TOTAL_CAPS = Object.keys(PERMISSION_META).length;
const HIGH_RISK_COUNT = HIGH_RISK_KEYS.length;

// Donut for access summary
function AccessDonut({ rows }: { rows: MatrixRow[] }): VNode {
  const cells = rows.flatMap(r => r.cells);
  const full    = cells.filter(c => c.level === 'full').length;
  const partial = cells.filter(c => c.level === 'partial').length;
  const none    = cells.filter(c => c.level === 'none').length;
  const total   = cells.length || 1;
  const pctFull    = Math.round((full    / total) * 100);
  const pctPartial = Math.round((partial / total) * 100);
  const pctNone    = 100 - pctFull - pctPartial;

  // SVG arc donut (cx=50, cy=50, r=36, stroke-width=16)
  const R = 36; const CX = 50; const CY = 50; const CIRC = 2 * Math.PI * R;
  function arc(pct: number, offset: number): { d: number; o: number } {
    return { d: (pct / 100) * CIRC, o: -(offset / 100) * CIRC };
  }
  const a1 = arc(pctFull, 0);
  const a2 = arc(pctPartial, pctFull);
  const a3 = arc(pctNone, pctFull + pctPartial);

  return (
    <div class="ac-donut-wrap">
      <svg width="100" height="100" viewBox="0 0 100 100" style={{ flex: 'none' }}>
        <circle cx={CX} cy={CY} r={R} fill="none" stroke="#eef0f6" strokeWidth="16" />
        {pctFull > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#16a34a" strokeWidth="16"
            strokeDasharray={`${a1.d} ${CIRC}`} strokeDashoffset={a1.o}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }} />
        )}
        {pctPartial > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#d97706" strokeWidth="16"
            strokeDasharray={`${a2.d} ${CIRC}`} strokeDashoffset={a2.o}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }} />
        )}
        {pctNone > 0 && (
          <circle cx={CX} cy={CY} r={R} fill="none" stroke="#e5e8f0" strokeWidth="16"
            strokeDasharray={`${a3.d} ${CIRC}`} strokeDashoffset={a3.o}
            style={{ transform: 'rotate(-90deg)', transformOrigin: '50px 50px' }} />
        )}
        <text x="50" y="45" textAnchor="middle" fontSize="13" fontWeight="700" fill="#111827">{pctFull}%</text>
        <text x="50" y="60" textAnchor="middle" fontSize="9" fill="#6b7280">Full</text>
      </svg>
      <div class="ac-donut-legend">
        <div class="ac-donut-legend-row">
          <span class="ac-donut-legend-lbl"><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#16a34a', display: 'inline-block', flexShrink: 0 }} /> Full access</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#16a34a' }}>{pctFull}%</span>
        </div>
        <div class="ac-donut-legend-row">
          <span class="ac-donut-legend-lbl"><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#d97706', display: 'inline-block', flexShrink: 0 }} /> Partial access</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#d97706' }}>{pctPartial}%</span>
        </div>
        <div class="ac-donut-legend-row">
          <span class="ac-donut-legend-lbl"><span style={{ width: '9px', height: '9px', borderRadius: '50%', background: '#e5e8f0', border: '1.5px solid #cbd3e0', display: 'inline-block', flexShrink: 0 }} /> No access</span>
          <span style={{ fontWeight: 700, fontSize: '13px', color: '#8a93a3' }}>{pctNone}%</span>
        </div>
        <div style={{ fontSize: '11px', color: '#9ca3af', marginTop: '4px' }}>Based on {total} role-module combinations</div>
      </div>
    </div>
  );
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
  if (action === 'permission_grant') return 'Permission granted';
  if (action === 'permission_deny')  return 'Permission denied';
  if (action === 'permission_clear') return 'Override cleared';
  return action.replace(/_/g, ' ');
}
function actionBadgeClass(action: string): string {
  if (action === 'permission_grant') return 'green';
  if (action === 'permission_deny')  return 'red';
  return 'grey';
}
// `details` is stored as JSON ({ permission, … }) for permission events — render the
// capability's human label. Falls back to the raw string for legacy/plain-text rows.
function detailText(details: string): string {
  try {
    const d = JSON.parse(details || '{}') as { permission?: string };
    if (d.permission) return PERMISSION_META[d.permission as PermissionKey]?.label ?? d.permission;
  } catch { /* not JSON — fall through */ }
  return details;
}

// ── Tab root ──────────────────────────────────────────────────────────────────

export function ModulesTab(): VNode {
  const rolesQ  = useRoles(true);
  const usersQ  = useConsoleUsers(true);
  const auditQ  = useAuditLogs({ entity: 'user', limit: 6 }, true);

  const [drillModule, setDrillModule] = useState<string | null>(null);

  const activeOverrides = useMemo(() =>
    (usersQ.data ?? []).reduce((n, u) => n + u.overrideCount, 0),
  [usersQ.data]);

  // If drill-down
  if (drillModule) {
    return (
      <div class="ac-scope">
        <ModuleCoveragePage module={drillModule} onBack={() => setDrillModule(null)} />
      </div>
    );
  }

  return (
    <div class="ac-scope">
      {/* Stat strip */}
      <div class="ac-stats">
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico blue"><i class="fas fa-user-shield" /></span>
            <div>
              <div class="ac-stat-lbl">Roles</div>
              <div class="ac-stat-val">{rolesQ.isLoading ? '—' : (rolesQ.data?.length ?? ROLES.length)}</div>
              <div class="ac-stat-sub">system + custom</div>
            </div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico green"><i class="fas fa-users" /></span>
            <div>
              <div class="ac-stat-lbl">Users</div>
              <div class="ac-stat-val">{usersQ.isLoading ? '—' : (usersQ.data?.length ?? 0)}</div>
              <div class="ac-stat-sub">active accounts</div>
            </div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico red"><i class="fas fa-shield-halved" /></span>
            <div>
              <div class="ac-stat-lbl">High-Risk Capabilities</div>
              <div class="ac-stat-val">{HIGH_RISK_COUNT}</div>
              <div class="ac-stat-sub">of {TOTAL_CAPS} total</div>
            </div>
          </div>
        </div>
        <div class="ac-stat">
          <div class="ac-stat-top">
            <span class="ac-stat-ico amber"><i class="fas fa-sliders" /></span>
            <div>
              <div class="ac-stat-lbl">Active Overrides</div>
              <div class="ac-stat-val">{usersQ.isLoading ? '—' : activeOverrides}</div>
              <div class="ac-stat-sub">per-user capability changes</div>
            </div>
          </div>
        </div>
      </div>

      {/* Two-column body */}
      <div class="ac-ov-layout">
        {/* Left: module × role matrix */}
        <div class="ac-card">
          <div class="ac-card-head">
            <div>
              <div class="ac-card-title">Module Access Matrix</div>
              <div class="ac-card-sub">Which roles can access each module, and to what extent.</div>
            </div>
            <span style={{ display: 'inline-flex', gap: '14px', font: 'inherit', fontSize: '12px' }}>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span class="ac-acc-dot full" /> Full
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span class="ac-acc-dot partial" /> Partial
              </span>
              <span style={{ display: 'flex', alignItems: 'center', gap: '5px' }}>
                <span class="ac-acc-dot none" /> None
              </span>
            </span>
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table class="ac-mc-tbl" style={{ tableLayout: 'fixed' }}>
              <colgroup>
                <col style={{ width: '180px' }} />
                {ROLES.map(r => <col key={r} style={{ width: '82px' }} />)}
              </colgroup>
              <thead>
                <tr>
                  <th style={{ textAlign: 'left', paddingLeft: '18px' }}>Module</th>
                  {ROLES.map(r => (
                    <th key={r} style={{ textAlign: 'center', fontSize: '11px' }}>
                      {ROLE_LABEL[r] ?? r}
                    </th>
                  ))}
                </tr>
              </thead>
              <tbody>
                {MATRIX_ROWS.map(row => (
                  <tr key={row.module} style={{ cursor: 'pointer' }} onClick={() => setDrillModule(row.module)}>
                    <td style={{ paddingLeft: '18px' }}>
                      <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                        <span style={{ fontWeight: 600, fontSize: '13px', color: 'var(--ac-ink)' }}>{row.module}</span>
                        <span style={{ fontSize: '10.5px', color: 'var(--ac-faint)' }}>{row.total}</span>
                      </div>
                    </td>
                    {row.cells.map(c => {
                      const tip = `${ROLE_LABEL[c.role] ?? c.role} · ${row.module} — ${
                        c.level === 'full' ? `Full (${c.have}/${c.total})`
                        : c.level === 'partial' ? `Partial (${c.have}/${c.total})`
                        : 'No access'}`;
                      return (
                        <td key={c.role} class="ac-mc-cell">
                          <span class={`ac-acc-dot ${c.level}`} title={tip} role="img" aria-label={tip} />
                        </td>
                      );
                    })}
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
          <div style={{ padding: '10px 18px', borderTop: '1px solid var(--ac-line2)', fontSize: '12px', color: 'var(--ac-muted)' }}>
            Click any row for a full capability breakdown by group and role.
          </div>
        </div>

        {/* Right column */}
        <div style={{ display: 'flex', flexDirection: 'column', gap: '16px' }}>
          {/* High-Risk Capabilities */}
          <div class="ac-card">
            <div class="ac-card-head">
              <div>
                <div class="ac-card-title" style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  High-Risk Capabilities <span class="ac-badge red">{HIGH_RISK_COUNT}</span>
                </div>
                <div class="ac-card-sub">Capabilities requiring elevated trust.</div>
              </div>
            </div>
            {HIGH_RISK_KEYS.map(k => {
              const meta = PERMISSION_META[k];
              return (
                <div key={k} class="ac-hr-item">
                  <span class="ac-hr-ico"><i class="fas fa-shield-halved" /></span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="ac-hr-name">{meta.label}</div>
                    <div class="ac-hr-mod">{meta.module} · {meta.group}</div>
                  </div>
                  <span class={`ac-risk ${meta.risk}`}>{meta.risk}</span>
                </div>
              );
            })}
          </div>

          {/* Recent Access Changes */}
          <div class="ac-card">
            <div class="ac-card-head">
              <div class="ac-card-title">Recent Access Changes</div>
            </div>
            {auditQ.isLoading ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
                <i class="fas fa-spinner fa-spin" /> Loading…
              </div>
            ) : (auditQ.data?.logs ?? []).length === 0 ? (
              <div style={{ padding: '20px', textAlign: 'center', color: 'var(--ac-muted)', fontSize: '13px' }}>
                No recent permission changes.
              </div>
            ) : (
              (auditQ.data?.logs ?? []).map(log => (
                <div key={log.id} class="ac-rc-item">
                  <span class={`ac-badge ${actionBadgeClass(log.action)}`} style={{ flexShrink: 0, fontSize: '10.5px' }}>
                    {actionLabel(log.action)}
                  </span>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div class="ac-rc-name">{log.username}</div>
                    <div class="ac-rc-action" style={{ fontSize: '11.5px', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{detailText(log.details)}</div>
                  </div>
                  <div class="ac-rc-time">{timeAgo(log.created_at)}</div>
                </div>
              ))
            )}
          </div>

          {/* Access Summary donut */}
          <div class="ac-card">
            <div class="ac-card-head">
              <div class="ac-card-title">Access Summary</div>
            </div>
            <AccessDonut rows={MATRIX_ROWS} />
          </div>
        </div>
      </div>
    </div>
  );
}
