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
import { ModulesTab }     from './tabs/ModulesTab';
import { PermissionsTab } from './tabs/PermissionsTab';

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
    id:    'modules',
    label: 'Modules',
    icon:  'fa-th-large',
    desc:  'Control which feature modules are visible to each role and individual manager. Changes take effect at next login.',
    body:  ModulesTab,
  },
  {
    id:    'permissions',
    label: 'Permissions',
    icon:  'fa-user-lock',
    desc:  'Grant or revoke individual capabilities per user. Overrides take priority over role defaults; clearing an override reverts to the role default.',
    body:  PermissionsTab,
  },
];

// ── Shell ─────────────────────────────────────────────────────────────────────

export function ConsoleSection(): VNode {
  const [activeId, setActiveId] = useState<string>(TABS[0]!.id);
  const active = TABS.find(t => t.id === activeId) ?? TABS[0]!;
  const Body = active.body;

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
              <span class="stg-nav-label">{t.label}</span>
              <span class="stg-nav-arrow"><i class="fas fa-chevron-right" aria-hidden="true" /></span>
            </button>
          ))}
        </div>
      </nav>

      {/* Content pane */}
      <div class="stg-content">
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
