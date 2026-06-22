/**
 * src/ui/components/ModuleTabs.tsx
 *
 * The white tab-container that sits under the page hero on every module page:
 * a header row (icon + title/sub + action buttons) above a tab bar with
 * per-tab icon, label, sublabel and optional count badge.
 *
 * This is the canonical "navigation tab" for the whole ERP. Promoted from the
 * HSE `_shared.tsx` `AreaTabs` (zero visual change — same `.hse-tabs-*` classes).
 *
 * Legacy alias: `AreaTabs`.
 */

import { type VNode } from 'preact';

export interface ModuleTab {
  key: string;
  label: string;
  sublabel?: string;
  icon: string;
  count?: number;
}

/**
 * Attach per-tab counts by key without losing required-field types that a spread
 * of an index-accessed element would erase under `noUncheckedIndexedAccess`.
 * Tabs not present in `counts` keep no count.
 */
export function withCounts(tabs: ModuleTab[], counts: Record<string, number | undefined>): ModuleTab[] {
  return tabs.map(t => (counts[t.key] === undefined ? t : { ...t, count: counts[t.key] }));
}

export interface ModuleTabsProps {
  icon: string;
  title: string;
  sub?: string;
  tabs: ModuleTab[];
  active: string;
  onSelect: (key: string) => void;
  actionLabel?: string;
  onAction?: () => void;
  headerRight?: VNode;
  /** Hide the built-in "Audit Log" button (shown by default). */
  hideAuditLog?: boolean;
}

export function ModuleTabs({
  icon, title, sub, tabs, active, onSelect, actionLabel, onAction, headerRight, hideAuditLog,
}: ModuleTabsProps): VNode {
  return (
    <div class="hse-tabs-container">
      <div class="hse-tabs-header">
        <div class="hse-tabs-header-left">
          <div class="hse-tabs-header-icon">
            <i class={`fas ${icon}`} />
          </div>
          <div class="hse-tabs-header-text">
            <div class="hse-tabs-header-title">{title}</div>
            {sub && <div class="hse-tabs-header-sub">{sub}</div>}
          </div>
        </div>
        <div class="hse-tabs-header-actions">
          {headerRight}
          {!hideAuditLog && (
            <button class="hse-tab-action-btn"><i class="fas fa-clock-rotate-left" /> Audit Log</button>
          )}
          {actionLabel && onAction && (
            <button class="hse-tab-action-btn" onClick={onAction}>
              <i class="fas fa-circle-plus" /> {actionLabel}
            </button>
          )}
        </div>
      </div>

      <div class="hse-tabs-bar" role="tablist">
        {tabs.map(t => (
          <button
            key={t.key}
            role="tab"
            aria-selected={t.key === active}
            class={`hse-tab${t.key === active ? ' active' : ''}`}
            onClick={() => onSelect(t.key)}
          >
            <i class={`fas ${t.icon}`} />
            <div class="hse-tab-label-wrap">
              <span class="hse-tab-label">{t.label}</span>
              {t.sublabel && <span class="hse-tab-sublabel">{t.sublabel}</span>}
            </div>
            {t.count !== undefined && (
              <span class="hse-tab-count">{t.count}</span>
            )}
          </button>
        ))}
      </div>
    </div>
  );
}

/** Legacy aliases used by HSE pages during migration. */
export const AreaTabs = ModuleTabs;
export type AreaTab = ModuleTab;
