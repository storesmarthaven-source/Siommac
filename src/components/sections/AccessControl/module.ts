/**
 * src/components/sections/AccessControl/module.ts
 *
 * Access Control feature module — the RBAC console, moved OUT of Settings into a
 * top-level "Access Control" sidebar group with sub-menus. Superadmin-only.
 * Self-registers at import. All the wiring (hooks/superadminApi + maker-checker)
 * is reused from SuperadminConsole; this is the presentation + navigation layer.
 */

import { registerModule, type ModuleDefinition, type ModuleNavItem } from '@lib/moduleRegistry';
import { mountAccessControlSection, unmountAccessControlSection } from './mount';

const AC_ROOT_ID = 'preact-access-control-root';

// The 7 screens are navigated from the SIOMAC sidebar (a collapsible "Access Control"
// group). Each item routes to the one AC panel; the section renders the matching page.
const ITEMS: ModuleNavItem[] = [
  { id: 's-ac-overview',   label: 'Overview',        icon: 'fa-table-columns',   sub: 'Roles, users and module-by-role coverage at a glance' },
  { id: 's-ac-users',      label: 'Users',           icon: 'fa-user-lock',       sub: 'Per-user capability overrides (role default / allow / deny)' },
  { id: 's-ac-roles',      label: 'Roles',           icon: 'fa-user-shield',     sub: 'Create and manage roles and their default permission sets' },
  { id: 's-ac-coverage',   label: 'Module Coverage', icon: 'fa-layer-group',     sub: 'Capability breakdown by module group × role' },
  { id: 's-ac-approvals',  label: 'Approvals',       icon: 'fa-clipboard-check', sub: 'Maker-checker queue for critical permission grants' },
  { id: 's-ac-audit',      label: 'Audit Log',       icon: 'fa-clipboard-list',  sub: 'Append-only record of every privileged action' },
  { id: 's-ac-sessions',   label: 'Sessions',        icon: 'fa-user-clock',      sub: 'Active sessions with device context + remote revoke' },
  { id: 's-ac-payslip-designer', label: 'Payslip Designer', icon: 'fa-file-invoice', sub: 'Design and manage the payslip layout templates used across payroll' },
];

export const accessControlModule: ModuleDefinition = {
  id: 'access-control',
  navGroup: { id: 'access-control', label: 'Access Control' },
  navItems: ITEMS,
  roles: ['superadmin'],
  mount: {
    sectionId: 's-access-control',
    rootId:    AC_ROOT_ID,
    mount:   (root, ctx) => mountAccessControlSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountAccessControlSection(root),
  },
  visibilityNamespace: 'access-control',
};

registerModule(accessControlModule);
