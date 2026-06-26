/**
 * src/ui/components/SystemActionsPanel.tsx
 *
 * The restricted, VIEW-ONLY "System Actions" governance panel shown in sensitive
 * change/status dialogs. It describes what the Workflow Engine WILL do once a
 * request is approved — it is NOT a control surface (normal users and approvers
 * can see the status but cannot run these actions manually; the engine executes
 * them). Rendered read-only on purpose: a collapsible navy panel listing the
 * downstream actions, never interactive checkboxes that do nothing.
 *
 * Styled by `.ui-sysact*` (assets/styles/uikit-overlay.css).
 */

import { type VNode } from 'preact';

export interface SystemActionsPanelProps {
  /** The downstream actions the engine performs after approval. */
  actions: string[];
  title?: string;
  subtitle?: string;
  /** Restriction label on the right of the summary. */
  lock?: string;
  note?: string;
  defaultOpen?: boolean;
}

export function SystemActionsPanel({
  actions,
  title = 'System Actions',
  subtitle = 'Created only after workflow approval and executed by the Workflow Engine.',
  lock = 'Restricted · System / Super Admin',
  note = 'Manual retry or override only appears for Super Admin, Workflow Admin, or HR System Admin when an automated action fails. Normal HR users and workflow approvers can view status but cannot run these actions manually.',
  defaultOpen = false,
}: SystemActionsPanelProps): VNode {
  return (
    <details class="ui-sysact" open={defaultOpen}>
      <summary class="ui-sysact-summary">
        <div class="ui-sysact-title">
          <span class="ui-sysact-ico"><i class="fas fa-gear" /></span>
          <span>
            <strong>{title}</strong>
            <span>{subtitle}</span>
          </span>
        </div>
        <span class="ui-sysact-lock">{lock}<i class="fas fa-chevron-down ui-sysact-chev" /></span>
      </summary>
      <div class="ui-sysact-body">
        <div class="ui-sysact-grid">
          {actions.map(a => (
            <div class="ui-sysact-row" key={a}><i class="fas fa-circle-check" /><span>{a}</span></div>
          ))}
        </div>
        {note && <div class="ui-sysact-note">{note}</div>}
      </div>
    </details>
  );
}
