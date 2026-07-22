/**
 * src/components/sections/MyPayslips/module.ts
 *
 * "My Payslips" employee self-service feature module. A single top-level nav item
 * (flat 'overview' group) visible to EVERY role, so any staff member — and the
 * superadmin — can view/print their own payslips on login. The route + PDF download
 * are self-scoped server-side (finance.payroll.view_own), so this is safe for all.
 *
 * Previously "My Payslips" was buried inside the Finance module (roles admin/superadmin
 * only), which hid it from regular staff — this module fixes that. Self-registers at import.
 */

import { registerModule, type ModuleDefinition } from '@lib/moduleRegistry';
import { mountMyPayslips, unmountMyPayslips } from './mount';

const MY_PAYSLIPS_ROOT_ID = 'preact-my-payslips-root';

export const myPayslipsModule: ModuleDefinition = {
  id: 'my-payslips',
  navGroup: { id: 'overview', label: '' },   // flat top-level item (like Calendar / Tickets)
  navItems: [{
    id:   's-finance-my-payslips',            // stable id — keeps existing notification deep-links working
    label: 'My Payslips',
    icon: 'fa-file-invoice',
    sub:  'View and download your own payslips (employee self-service)',
  }],
  roles: ['superadmin', 'admin', 'manager', 'employee'],
  mount: {
    sectionId: 's-finance-my-payslips',
    rootId:    MY_PAYSLIPS_ROOT_ID,
    mount:   (root, ctx) => mountMyPayslips(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountMyPayslips(root),
  },
  visibilityNamespace: 'my-payslips',
};

registerModule(myPayslipsModule);
