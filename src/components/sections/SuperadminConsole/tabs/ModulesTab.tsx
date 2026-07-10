/**
 * tabs/ModulesTab.tsx — Access map (Overview)
 *
 * A read-only module × role grid answering one question at a glance: which roles can
 * access each module, and to what extent — Full (all of a module's capabilities),
 * Partial (some), or None. Computed client-side from PERMISSION_META (module grouping)
 * + ROLE_PERMISSIONS (role defaults); superadmin is always Full. Editing lives in the
 * Roles tab (per role) and Users tab (per user) — this view is orientation only.
 */

import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import { StatCard } from '../../Employees/StatCard';
import { PERMISSION_META } from '@lib/permissionMeta';
import { ROLE_PERMISSIONS } from '@lib/permissions';
import type { PermissionKey } from '@lib/permissions';
import '../rbac.css';

const ROLE_LABEL: Record<string, string> = {
  superadmin: 'Superadmin', admin: 'Admin', manager: 'Manager',
  hr_manager: 'HR Manager', hr_staff: 'HR Staff', hse_staff: 'HSE Staff',
  finance_manager: 'Finance Manager', finance_staff: 'Finance Staff', employee: 'Employee',
};
const ROLE_ORDER = ['superadmin', 'admin', 'manager', 'hr_manager', 'hr_staff', 'hse_staff', 'finance_manager', 'finance_staff', 'employee'];

// Merge obvious label variants so a module isn't split across rows. (PERMISSION_META
// module strings should be normalised at source — tracked as a follow-up cleanup.)
const MODULE_ALIAS: Record<string, string> = { Workflows: 'Workflow', auth: 'Auth' };
const normModule = (m: string): string => MODULE_ALIAS[m] ?? m;

type Level = 'none' | 'partial' | 'full';
interface Cell { role: string; have: number; total: number; level: Level }
interface Row { module: string; total: number; cells: Cell[] }

export function ModulesTab(): VNode {
  const { roles, rows, totalCaps } = useMemo(() => {
    const byModule = new Map<string, PermissionKey[]>();
    for (const key of Object.keys(PERMISSION_META) as PermissionKey[]) {
      const mod = normModule(PERMISSION_META[key].module);
      const list = byModule.get(mod) ?? [];
      if (!byModule.has(mod)) byModule.set(mod, list);
      list.push(key);
    }
    const roles = ROLE_ORDER.filter(r => r in ROLE_PERMISSIONS);
    const rows: Row[] = [...byModule.entries()].map(([module, keys]) => {
      const cells = roles.map(role => {
        const isSuper = role === 'superadmin';
        const set = ROLE_PERMISSIONS[role as keyof typeof ROLE_PERMISSIONS];
        const have = isSuper ? keys.length : keys.filter(k => set.has(k)).length;
        const level: Level = have === 0 ? 'none' : have >= keys.length ? 'full' : 'partial';
        return { role, have, total: keys.length, level };
      });
      return { module, total: keys.length, cells };
    }).sort((a, b) => b.total - a.total);
    return { roles, rows, totalCaps: Object.keys(PERMISSION_META).length };
  }, []);

  const levelText = (c: Cell): string =>
    c.level === 'full' ? (c.role === 'superadmin' ? 'Full access' : `Full access (${c.have}/${c.total})`)
      : c.level === 'partial' ? `Partial access (${c.have}/${c.total})`
        : 'No access';

  return (
    <div class="rbac">
      <div class="rbac-stats">
        <StatCard icon="fa-th-large"    label="Modules"      value={rows.length}  color="#2563eb" />
        <StatCard icon="fa-key"         label="Capabilities" value={totalCaps}    color="#16a34a" />
        <StatCard icon="fa-user-shield" label="Roles"        value={roles.length} color="#d97706" />
      </div>

      <div class="rbac-map-intro">
        <i class="fas fa-circle-info" aria-hidden="true" />
        <p>Which roles can access each module. Access comes from the permission catalogue — edit it in <strong>Roles</strong> (per role) or <strong>Users</strong> (per user).</p>
        <span class="rbac-map-legend">
          <span><i class="rbac-dot full" aria-hidden="true" /> Full</span>
          <span><i class="rbac-dot partial" aria-hidden="true" /> Partial</span>
          <span><i class="rbac-dot none" aria-hidden="true" /> None</span>
        </span>
      </div>

      <div class="rbac-map-scroll">
        <table class="rbac-map">
          <thead>
            <tr>
              <th class="rbac-map-corner" scope="col">Module</th>
              {roles.map(r => <th key={r} scope="col" title={ROLE_LABEL[r] ?? r}>{ROLE_LABEL[r] ?? r}</th>)}
            </tr>
          </thead>
          <tbody>
            {rows.map(row => (
              <tr key={row.module}>
                <td class="rbac-map-mod">{row.module}<span class="rbac-map-modcount">{row.total} capabilit{row.total === 1 ? 'y' : 'ies'}</span></td>
                {row.cells.map(c => (
                  <td key={c.role} class="rbac-map-cell" title={`${ROLE_LABEL[c.role] ?? c.role} · ${row.module} — ${levelText(c)}`}>
                    <i class={`rbac-dot ${c.level}`} aria-label={levelText(c)} role="img" />
                  </td>
                ))}
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}
