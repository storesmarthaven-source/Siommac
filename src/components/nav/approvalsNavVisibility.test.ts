/**
 * approvalsNavVisibility.test.ts — integration coverage for the Approvals nav item.
 *
 * The Approvals page is gated ONLY on the durable communications.compliance_approve
 * capability. This walks the real sequence through the actual buildSidebar +
 * permission resolver + badge renderer (not just resolver units) and asserts
 * s-ac-approvals stays in the DOM throughout:
 *   durable grant → build → permission refresh (read/export grants EXPIRE) →
 *   sidebar rebuild → badge acknowledgement.
 */

import { describe, it, expect, beforeEach } from 'vitest';
import { registerModule } from '@lib/moduleRegistry';
import { buildSidebar, setNavSectionBadge } from './navCore';
import { useSessionStore } from '@store/session';
import type { PermissionOverride } from '@api/schemas/auth';

const APPROVE = 'communications.compliance_approve';
const approvalsButton = () =>
  document.querySelector('#sidebarMenu button[data-section="s-ac-approvals"]');

function registerApprovalsModule(): void {
  registerModule({
    id:    'test-ac-approvals',
    roles: ['manager', 'admin', 'superadmin'],
    // Same gate as the real AccessControl module: permission-only, no roles fallback.
    navItems: [{ id: 's-ac-approvals', label: 'Approvals', icon: 'fa-clipboard-check', permission: APPROVE }],
    mount: { sectionId: 's-ac-approvals', rootId: 'preact-ac-approvals-root', mount: () => { /* test stub */ } },
  });
}

function expiredCompliance(permission: string): PermissionOverride {
  const now = Date.now();
  return {
    user_id:     'u1',
    permission,
    granted:     true,
    valid_from:  new Date(now - 2 * 60 * 60_000).toISOString(),
    valid_until: new Date(now - 60_000).toISOString(),   // window already ended
    revoked_at:  null,
  };
}

describe('Approvals nav stays visible through the full lifecycle (integration)', () => {
  beforeEach(() => {
    document.body.innerHTML = '<ul id="sidebarMenu"></ul>';
    registerApprovalsModule();
    // Durable compliance_approve via role default (manager holds it here).
    useSessionStore.setState({
      role:                'manager',
      rolePermissions:     [APPROVE],
      permissionOverrides: [],
      isAuthenticated:     true,
    });
  });

  it('remains in the DOM: durable grant → refresh + expired read/export → rebuild → badge ack', () => {
    // 1. Durable compliance_approve → sidebar build → Approvals present + accessible.
    buildSidebar('manager');
    const btn = approvalsButton();
    expect(btn, 'after initial build').not.toBeNull();
    expect(btn!.getAttribute('data-section')).toBe('s-ac-approvals');

    // 2. Permission refresh: the time-boxed read + export grants EXPIRE (grantee-side
    //    access lapsing). The durable reviewer capability is unaffected.
    useSessionStore.getState().setPermissionOverrides([
      expiredCompliance('communications.compliance_read'),
      expiredCompliance('communications.compliance_export'),
    ]);
    // 3. Sidebar rebuild after the refresh (what NavController does on a perm change).
    buildSidebar('manager');
    expect(approvalsButton(), 'after refresh + rebuild with expired read/export').not.toBeNull();

    // 4. Badge acknowledgement (unseen → 0): clears the badge, keeps the nav item.
    setNavSectionBadge('s-ac-approvals', 3);
    expect(approvalsButton()!.querySelector('.sb-nav-badge')?.textContent).toBe('3');
    setNavSectionBadge('s-ac-approvals', 0);
    expect(approvalsButton()!.querySelector('.sb-nav-badge'), 'badge cleared').toBeNull();
    expect(approvalsButton(), 'nav item still present + accessible after ack').not.toBeNull();
  });

  it('is removed only when the durable capability itself is lost', () => {
    buildSidebar('manager');
    expect(approvalsButton()).not.toBeNull();
    // Remove the durable capability (e.g. role change / explicit deny) → gate closes.
    useSessionStore.setState({ rolePermissions: [] });
    buildSidebar('manager');
    expect(approvalsButton(), 'gate closes only when compliance_approve is lost').toBeNull();
  });
});
