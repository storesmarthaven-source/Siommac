/**
 * src/ui/components/WizardShell.tsx
 *
 * The app-wide rich wizard frame (v36 employee wizards: Start Onboarding, Import
 * Employees, Create Employee). A light modal with a dark navy left rail that
 * carries the section title, the step list, and one or more info panels
 * (Current Batch · Permissions & Audit); the right column hosts the numbered
 * content sections; a footer holds a note + the actions.
 *
 * Controlled: the caller owns `activeStep` and renders the matching content.
 * Styled by `.ui-wz-*` (assets/styles/uikit-overlay.css) — global classes, so it
 * works inside or outside a page scope without colliding with Bootstrap.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useOverlayA11y } from '../lib/useOverlayA11y';

export interface WizardStepDef { key: string; label: string; sub?: string; /** FontAwesome class. */ icon: string; }
export interface WizardInfoRow { label: string; value: ComponentChildren; highlight?: boolean; }
export interface WizardInfoPanel { title: string; rows: WizardInfoRow[]; }

export interface WizardShellProps {
  open: boolean;
  /** Header title, e.g. "Start Onboarding". */
  title: string;
  /** Uppercase rail title, e.g. "START ONBOARDING". */
  railTitle: string;
  railSubtitle?: string;
  steps: WizardStepDef[];
  activeStep: string;
  onStep?: (key: string) => void;
  /** Return false to disable jumping to a step. */
  stepEnabled?: (key: string) => boolean;
  /** Rail info panels (Current Batch, Permissions & Audit). */
  info?: WizardInfoPanel[];
  /** Footer left-aligned note. */
  footNote?: string;
  /** Footer actions (Cancel + primary). */
  footer: ComponentChildren;
  onClose: () => void;
  children: ComponentChildren;
}

export function WizardShell({
  open, title, railTitle, railSubtitle, steps, activeStep, onStep, stepEnabled,
  info, footNote, footer, onClose, children,
}: WizardShellProps): VNode | null {
  const panelRef = useOverlayA11y<HTMLDivElement>(open, onClose);
  if (!open) return null;
  return (
    <div class="ui-wz-backdrop" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div ref={panelRef} class="ui-wz-modal" role="dialog" aria-modal="true" aria-label={title}>
        <div class="ui-wz-head">
          <h3>{title}</h3>
          <button class="ui-wz-close" type="button" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>

        <div class="ui-wz-shell">
          <aside class="ui-wz-rail">
            <div class="ui-wz-rail-head">
              <span class="ui-wz-rail-dot" aria-hidden="true" />
              <div><strong>{railTitle}</strong>{railSubtitle && <span>{railSubtitle}</span>}</div>
            </div>

            <div class="ui-wz-steps" role="tablist">
              {steps.map(s => {
                const active = s.key === activeStep;
                const enabled = stepEnabled ? stepEnabled(s.key) : true;
                return (
                  <button
                    key={s.key} type="button" role="tab" aria-selected={active}
                    aria-current={active ? 'step' : undefined}
                    class={`ui-wz-step${active ? ' active' : ''}`} disabled={!enabled}
                    onClick={() => enabled && onStep?.(s.key)}
                  >
                    <span class="ui-wz-step-ico"><i class={`fas ${s.icon}`} /></span>
                    <div><strong>{s.label}</strong>{s.sub && <span class="ui-wz-step-sub">{s.sub}</span>}</div>
                  </button>
                );
              })}
            </div>

            {info && info.length > 0 && (
              <div class="ui-wz-info">
                {info.map(p => (
                  <div key={p.title}>
                    <div class="ui-wz-info-title"><span class="ui-wz-info-dot" aria-hidden="true" />{p.title}</div>
                    <div class="ui-wz-info-panel">
                      {p.rows.map(r => (
                        <div class="ui-wz-info-row" key={r.label}>
                          <span class="ui-wz-info-label">{r.label}</span>
                          <span class={`ui-wz-info-value${r.highlight ? ' highlight' : ''}`}>{r.value}</span>
                        </div>
                      ))}
                    </div>
                  </div>
                ))}
              </div>
            )}
          </aside>

          <div class="ui-wz-content">{children}</div>
        </div>

        <div class="ui-wz-foot">
          {footNote && <span class="ui-wz-foot-note">{footNote}</span>}
          {footer}
        </div>
      </div>
    </div>
  );
}
