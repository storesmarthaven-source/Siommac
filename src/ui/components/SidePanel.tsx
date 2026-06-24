/**
 * src/ui/components/SidePanel.tsx
 *
 * The standard right-side panel for register/detail pages — the kit version of
 * the old `.ppe-signals-panel` rail, rebuilt on the `owq-panel` design system.
 * Header is `owq-panel-header`: title + icon + count badge + optional tab row.
 * Pass `navy` for the dark rail look. Body is a scrollable list of
 * `<SidePanelItem>` (or any children); optional footer button.
 *
 *   <SidePanel navy title="Signals" icon="fa-bell" count={8}
 *     tabs={[{ key:'all', label:'All', count:8 }, …]} activeTab={tab} onTab={setTab}>
 *     <SidePanelItem refLabel="PTW-9001" title="Welding repair" action="Review" … />
 *   </SidePanel>
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface SidePanelTab { key: string; label: string; count?: number; }

export interface SidePanelProps {
  title: string;
  /** Font Awesome class for the header icon. */
  icon?: string;
  /** Header count badge. */
  count?: number;
  /** Dark navy gradient rail variant. */
  navy?: boolean;
  tabs?: SidePanelTab[];
  activeTab?: string;
  onTab?: (key: string) => void;
  footer?: { label: string; icon?: string; onClick: () => void };
  class?: string;
  children: ComponentChildren;
}

export function SidePanel({ title, icon, count, navy, tabs, activeTab, onTab, footer, class: cls, children }: SidePanelProps): VNode {
  return (
    <aside class={`owq-panel${navy ? ' owq-panel-navy' : ''}${cls ? ' ' + cls : ''}`}>
      <div class="owq-panel-header">
        <div class="owq-panel-title">
          {icon && <i class={`fas ${icon}`} aria-hidden="true" />}
          <span>{title}</span>
          {count !== undefined && <span class="owq-panel-count">{count}</span>}
        </div>
        {tabs && tabs.length > 0 && (
          <div class="owq-panel-tabs" role="tablist">
            {tabs.map(t => (
              <button key={t.key} type="button" role="tab" aria-selected={activeTab === t.key}
                class={`owq-tab${activeTab === t.key ? ' active' : ''}`} onClick={() => onTab?.(t.key)}>
                {t.label}{t.count !== undefined && <span class="owq-tab-count">{t.count}</span>}
              </button>
            ))}
          </div>
        )}
      </div>
      <div class="owq-panel-list">{children}</div>
      {footer && (
        <button type="button" class="owq-panel-footer" onClick={footer.onClick}>
          {footer.icon && <i class={`fas ${footer.icon}`} aria-hidden="true" />}{footer.label}
        </button>
      )}
    </aside>
  );
}

export type SidePanelTone = 'critical' | 'overdue' | 'invest' | 'capa' | 'ok';

export interface SidePanelItemProps {
  /** Leading icon (Font Awesome class). */
  icon?: string;
  /** Icon chip tone. */
  iconTone?: SidePanelTone;
  /** Left-border accent. */
  accent?: 'critical' | 'overdue' | 'normal';
  /** Small mono reference line above the title. */
  refLabel?: string;
  title: string;
  meta?: Array<{ icon?: string; text: string }>;
  /** Right-side action tag. */
  action?: string;
  onClick?: () => void;
}

export function SidePanelItem({ icon, iconTone, accent = 'normal', refLabel, title, meta, action, onClick }: SidePanelItemProps): VNode {
  return (
    <div class={`owq-item owq-item-${accent}`} onClick={onClick}>
      {icon && (
        <div class={`owq-item-icon${iconTone ? ' owq-icon-' + iconTone : ''}`}>
          <i class={`fas ${icon}`} aria-hidden="true" />
        </div>
      )}
      <div class="owq-item-body">
        {refLabel && <div class="owq-item-ref">{refLabel}</div>}
        <div class="owq-item-title">{title}</div>
        {meta && meta.length > 0 && (
          <div class="owq-item-meta">
            {meta.map((m, i) => <span key={i}>{m.icon && <i class={`fas ${m.icon}`} aria-hidden="true" />}{m.text}</span>)}
          </div>
        )}
      </div>
      {action && (
        <div class="owq-item-right">
          <span class="owq-item-action">{action}</span>
          {onClick && <i class="fas fa-chevron-right owq-item-chevron" aria-hidden="true" />}
        </div>
      )}
    </div>
  );
}
