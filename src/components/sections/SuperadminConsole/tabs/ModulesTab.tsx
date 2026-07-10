/**
 * tabs/ModulesTab.tsx
 *
 * Module access rollup — READ ONLY.
 *
 * Module access is governed by ONE system: the permission catalogue. This tab is a
 * read-only rollup of what each role can do, grouped by module — derived directly from
 * PERMISSION_META (module grouping) + ROLE_PERMISSIONS (role defaults). There is no coarse
 * per-module on/off switch any more (that legacy `module_permissions` matrix enforced
 * nothing at runtime — the sidebar already gates on catalogue permissions).
 *
 * Editing lives where it belongs: per-capability in the Permissions tab, per-role in the
 * Roles tab.
 */

import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { PERMISSION_META } from '@lib/permissionMeta';
import { ROLE_PERMISSIONS } from '@lib/permissions';
import type { PermissionKey } from '@lib/permissions';

// Human labels + a broad→specific display order for the 9 roles.
const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager',
  hr_manager: 'HR Manager', hr_staff: 'HR Staff', hse_staff: 'HSE Staff',
  finance_manager: 'Finance Manager', finance_staff: 'Finance Staff', employee: 'Employee',
};
const ROLE_ORDER = ['superadmin', 'admin', 'manager', 'hr_manager', 'hr_staff', 'hse_staff', 'finance_manager', 'finance_staff', 'employee'];

// Merge a couple of obvious label variants so the rollup doesn't split into duplicate
// cards. (The underlying PERMISSION_META module strings should be normalised at source —
// tracked as a follow-up cleanup.)
const MODULE_ALIAS: Record<string, string> = { Workflows: 'Workflow', auth: 'Auth', System: 'System' };
const normModule = (m: string): string => MODULE_ALIAS[m] ?? m;

interface RoleCoverage { role: string; have: number; total: number; full: boolean }
interface ModuleRollup { module: string; total: number; perRole: RoleCoverage[] }

function coverageColor(pct: number): string {
  if (pct >= 90) return '#16a34a';
  if (pct >= 40) return '#2563eb';
  return '#d97706';
}

export function ModulesTab(): VNode {
  const rollup = useMemo(() => {
    // 1. Group every catalogue key by its (normalised) top-level module.
    const byModule = new Map<string, PermissionKey[]>();
    for (const key of Object.keys(PERMISSION_META) as PermissionKey[]) {
      const mod = normModule(PERMISSION_META[key].module);
      const list = byModule.get(mod) ?? [];
      if (!byModule.has(mod)) byModule.set(mod, list);
      list.push(key);
    }
    // 2. For each module, how much of it each role can do (superadmin = full/allow-all).
    const roles = ROLE_ORDER.filter(r => r in ROLE_PERMISSIONS);
    const modules: ModuleRollup[] = [...byModule.entries()].map(([module, keys]) => {
      const perRole = roles.map(role => {
        const isSuper = role === 'superadmin';
        const set = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
        const have = isSuper ? keys.length : keys.filter(k => set.has(k)).length;
        return { role, have, total: keys.length, full: isSuper };
      }).filter(r => r.have > 0);
      return { module, total: keys.length, perRole };
    }).sort((a, b) => b.total - a.total);

    return { modules, totalCaps: Object.keys(PERMISSION_META).length, roleCount: roles.length };
  }, []);

  return (
    <div>
      <div style={{ display: 'flex', gap: '16px', flexWrap: 'wrap', marginBottom: '20px' }}>
        <StatCard icon="fa-th-large"     label="Modules"      value={rollup.modules.length} color="#2563eb" />
        <StatCard icon="fa-key"          label="Capabilities" value={rollup.totalCaps}      color="#16a34a" />
        <StatCard icon="fa-user-shield"  label="Roles"        value={rollup.roleCount}      color="#d97706" />
      </div>

      <div style={{ marginBottom: '18px', padding: '12px 16px', background: 'rgba(27,45,84,0.05)', borderRadius: 'var(--radius-sm)', border: '1px solid var(--border)', fontSize: '13px', color: 'var(--text-muted)', display: 'flex', alignItems: 'flex-start', gap: '8px' }}>
        <i class="fas fa-circle-info" style={{ marginTop: '1px', flexShrink: 0, color: 'var(--siomac-navy)' }} />
        <span>Module access is governed by the permission catalogue — this is a read-only rollup of what each role can do per module. Edit capabilities in the <strong>Permissions</strong> tab (per user) or the <strong>Roles</strong> tab (per role). Superadmin always has full access.</span>
      </div>

      <div style={{ display: 'grid', gap: '12px' }}>
        {rollup.modules.map(m => (
          <div key={m.module} style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden', background: 'var(--surface, #fff)' }}>
            <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', padding: '12px 16px', borderBottom: '1px solid var(--border)', background: 'rgba(27,45,84,0.03)' }}>
              <div class="stg-switch-label" style={{ fontSize: '14px' }}>{m.module}</div>
              <div class="stg-switch-desc" style={{ margin: 0 }}>{m.total} capabilit{m.total === 1 ? 'y' : 'ies'}</div>
            </div>
            <div style={{ padding: '10px 16px', display: 'grid', gap: '8px' }}>
              {m.perRole.map(r => {
                const pct = Math.round((r.have / r.total) * 100);
                return (
                  <div key={r.role} style={{ display: 'grid', gridTemplateColumns: '150px 1fr 64px', alignItems: 'center', gap: '12px' }}>
                    <span style={{ fontSize: '13px', color: 'var(--text-primary)', whiteSpace: 'nowrap', overflow: 'hidden', textOverflow: 'ellipsis' }}>{ROLE_LABEL[r.role] ?? r.role}</span>
                    <div style={{ height: '7px', borderRadius: '999px', background: 'rgba(27,45,84,0.08)', overflow: 'hidden' }}>
                      <div style={{ height: '100%', width: `${pct}%`, borderRadius: '999px', background: coverageColor(pct) }} />
                    </div>
                    <span style={{ fontSize: '12px', color: 'var(--text-muted)', textAlign: 'right', fontVariantNumeric: 'tabular-nums' }}>{r.full ? 'Full' : `${r.have}/${r.total}`}</span>
                  </div>
                );
              })}
            </div>
          </div>
        ))}
      </div>
    </div>
  );
}
