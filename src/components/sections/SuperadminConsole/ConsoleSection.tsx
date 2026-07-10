/**
 * ConsoleSection.tsx
 *
 * Superadmin administration console — a single expandable, tabbed shell that
 * hosts all superadmin tooling. Tabs are registered in a small registry so new
 * areas (Sessions, Audit Log, …) drop in without touching the shell.
 *
 * Current tabs:
 *   • Modules     — feature-module visibility per role and per manager
 *   • Permissions — per-user RBAC grants/denials (resource.action overrides)
 *
 * The shell uses the Settings `.stg-*` layout (left sub-nav + content pane).
 * Tab bodies render lazily on selection so their queries don't fire until shown.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode, type ComponentType } from 'preact';
import { useState } from 'preact/hooks';
import { ModulesTab }          from './tabs/ModulesTab';
import { RolesTab }            from './tabs/RolesTab';
import { PermissionsTab }      from './tabs/PermissionsTab';
import { SessionsTab }         from './tabs/SessionsTab';
import { AuditLogTab }         from './tabs/AuditLogTab';
import { UserSecurityPanel }   from './tabs/UserSecurityPanel';
import { ApprovalsTab }        from './tabs/ApprovalsTab';
import { UIKitPage }           from '@ui/examples/UIKitPage';
import { usePermissionApprovals } from './hooks';

// ── Tab registry ──────────────────────────────────────────────────────────────

export interface ConsoleTab {
  id:    string;
  label: string;
  icon:  string;           // Font Awesome class
  desc:  string;           // shown under the panel title
  body:  ComponentType;    // rendered when the tab is active
}

/**
 * Registry of console tabs. Add a tab here (id, label, icon, desc, body) and it
 * appears in the sub-nav automatically. Sessions (task D) and Audit Log (task E)
 * will register here.
 */
const TABS: ConsoleTab[] = [
  {
    id:    'roles',
    label: 'Roles',
    icon:  'fa-user-shield',
    desc:  'Create and manage roles and their default permission sets. System roles (superadmin, employee) are permanent; build custom roles like HSE Manager or Finance Officer on top.',
    body:  RolesTab,
  },
  {
    id:    'modules',
    label: 'Overview',
    icon:  'fa-th-large',
    desc:  'A read-only rollup of the permission catalogue — how much of each module every role can access. Edit capabilities in Users (per user) or Roles (per role).',
    body:  ModulesTab,
  },
  {
    id:    'permissions',
    label: 'Users',
    icon:  'fa-user-lock',
    desc:  'Pick a user to see and edit their effective capabilities — the role default, any per-user override, and the resulting access. Overrides take priority; "Role default" clears the override.',
    body:  PermissionsTab,
  },
  {
    id:    'approvals',
    label: 'Approvals',
    icon:  'fa-shield-check',
    desc:  'Maker-checker queue for critical permission grants. A second superadmin must approve any grant of a critical capability before it takes effect.',
    body:  ApprovalsTab,
  },
  {
    id:    'sessions',
    label: 'Sessions',
    icon:  'fa-user-clock',
    desc:  'See who is logged in and from which device. Revoking a session signs the user out immediately; they must re-authenticate (including 2FA).',
    body:  SessionsTab,
  },
  {
    id:    'audit',
    label: 'Audit Log',
    icon:  'fa-clipboard-list',
    desc:  'A tamper-evident, append-only record of every privileged action — who did what, when, and from where. Filter, search and export to CSV.',
    body:  AuditLogTab,
  },
  {
    id:    'user-security',
    label: 'User Security',
    icon:  'fa-user-shield',
    desc:  'Inspect and manage authentication factors for individual users. Revoke passkeys or trusted devices (requires step-up verification).',
    body:  UserSecurityPanel,
  },
  {
    id:    'uikit',
    label: 'UI Kit',
    icon:  'fa-palette',
    desc:  'The living catalog of the Siomac design system. Every shared @ui component with all its variants — the single reference for how the app looks. A token theme-editor will live here.',
    body:  UIKitPage,
  },
];

// ── Shell ─────────────────────────────────────────────────────────────────────

export function ConsoleSection(): VNode {
  const [activeId, setActiveId] = useState<string>(TABS[0]!.id);
  const active = TABS.find(t => t.id === activeId) ?? TABS[0]!;
  const Body = active.body;

  // Pending approvals count for the badge on the Approvals tab.
  const approvalsQ = usePermissionApprovals('pending');
  const pendingCount = approvalsQ.data?.length ?? 0;

  return (
    <div class="stg-layout">
      {/* Left sub-nav */}
      <nav class="stg-nav" aria-label="Console sections">
        <div class="stg-nav-group">
          <div class="stg-nav-group-label">Administration</div>
          {TABS.map(t => (
            <button
              key={t.id}
              type="button"
              class={`stg-nav-item${t.id === activeId ? ' active' : ''}`}
              onClick={() => setActiveId(t.id)}
              aria-current={t.id === activeId ? 'page' : undefined}
            >
              <span class="stg-nav-icon"><i class={`fas ${t.icon}`} aria-hidden="true" /></span>
              <span class="stg-nav-label">
                {t.label}
                {t.id === 'approvals' && pendingCount > 0 && (
                  <span style={{
                    marginLeft: '7px', fontSize: '10px', fontWeight: 'var(--font-weight-bold)',
                    padding: '1px 6px', borderRadius: '10px',
                    background: 'rgba(234,179,8,0.18)', color: '#713f12',
                    border: '1px solid rgba(234,179,8,0.35)',
                    lineHeight: '1.4',
                  }}>
                    {pendingCount}
                  </span>
                )}
              </span>
              <span class="stg-nav-arrow"><i class="fas fa-chevron-right" aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content pane */}
      <div class="stg-content">
        {/* VANTUS breadcrumb */}
        <nav class="page-breadcrumb" aria-label="Breadcrumb">
          <span class="page-breadcrumb-root">Console</span>
          <i class="fas fa-chevron-right page-breadcrumb-sep" aria-hidden="true" />
          <span class="page-breadcrumb-current">{active.label}</span>
        </nav>

        <div class="stg-panel-header">
          <span class="stg-panel-icon"><i class={`fas ${active.icon}`} aria-hidden="true" /></span>
          <div>
            <div class="stg-panel-title">{active.label}</div>
            <div class="stg-switch-desc" style={{ marginTop: '2px' }}>{active.desc}</div>
          </div>
        </div>

        <Body />
      </div>
    </div>
  );
}
