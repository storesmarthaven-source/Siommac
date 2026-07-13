/**
 * src/ui/components/PanelTabs.tsx
 *
 * The tab strip for a rich detail panel: a row of primary tabs plus an optional
 * "More" overflow menu for secondary tabs. The selected overflow tab is shown on
 * the More button so the active tab is always visible. Styled by `.ui-panel-tab*`
 * (assets/styles/uikit-overlay.css); the overflow uses the shared <Menu>.
 */

import { type VNode } from 'preact';
import { Menu } from './Menu';
import { type LucideName } from '../LucideIcon';

export interface PanelTabsProps {
  /** Always-visible tabs. */
  primary: string[];
  /** Tabs tucked into the "More" overflow menu. */
  more?: string[];
  /** Optional Lucide icon per More-tab label (falls back to a chevron). */
  moreIcons?: Record<string, LucideName>;
  active: string;
  onChange: (tab: string) => void;
}

export function PanelTabs({ primary, more = [], moreIcons, active, onChange }: PanelTabsProps): VNode {
  const activeInMore = more.includes(active);
  return (
    <div class="ui-panel-tabs">
      <div class="ui-panel-tab-list">
        {primary.map(t => (
          <button key={t} type="button" class={`ui-panel-tab${active === t ? ' active' : ''}`} onClick={() => onChange(t)}>
            {t}
          </button>
        ))}
      </div>
      {more.length > 0 && <span class="ui-panel-tab-sep" aria-hidden="true" />}
      {more.length > 0 && (
        <Menu
          align="right"
          items={more.map(t => ({ label: t, lucide: moreIcons?.[t], icon: moreIcons?.[t] ? undefined : 'fa-angle-right', onSelect: () => onChange(t) }))}
          trigger={({ toggle }) => (
            <button type="button" class={`ui-panel-tab${activeInMore ? ' active' : ''}`} onClick={toggle}>
              <span>{activeInMore ? active : 'More'}</span>
              <span class="ui-panel-tab-caret" aria-hidden="true">▾</span>
            </button>
          )}
        />
      )}
    </div>
  );
}
