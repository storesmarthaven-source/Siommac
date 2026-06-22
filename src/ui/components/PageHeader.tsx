/**
 * src/ui/components/PageHeader.tsx
 *
 * The standard, light page header for SUB-MODULE pages (Incidents, Risk & JSA,
 * Permits, …). Replaces both the dark hero and the plain text header. One header
 * per page — the tab bar sits directly beneath it (no second header).
 *
 *   breadcrumb (Module › Sub-module) · gradient icon chip · title ·
 *   meta chips (replaces "· All sites · 6 records") · right-aligned actions
 *
 * Styled by `.ui-page-header*` in assets/styles/uikit-layout.css.
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface PageMetaChip { icon?: string; label: string; }

export interface PageHeaderProps {
  icon: string;
  title: string;
  /** Breadcrumb root (the module), e.g. 'HSE'. */
  module?: string;
  /** Extra breadcrumb segments between the module and the title. */
  crumbs?: string[];
  /** Meta shown as chips beneath the title. */
  meta?: PageMetaChip[];
  /** Right-aligned action buttons. */
  actions?: ComponentChildren;
}

export function PageHeader({ icon, title, module, crumbs = [], meta = [], actions }: PageHeaderProps): VNode {
  const trail = [module, ...crumbs].filter(Boolean) as string[];
  return (
    <div class="ui-page-header">
      <div class="ui-page-head-main">
        <span class="ui-page-head-icon"><i class={`fas ${icon}`} /></span>
        <div class="ui-page-head-text">
          {trail.length > 0 && (
            <div class="ui-page-crumb">
              {trail.map((c, i) => (
                <>
                  {i > 0 && <i class="fas fa-chevron-right ui-page-crumb-sep" />}
                  <span key={c}>{c}</span>
                </>
              ))}
              <i class="fas fa-chevron-right ui-page-crumb-sep" />
              <span class="ui-page-crumb-current">{title}</span>
            </div>
          )}
          <div class="ui-page-title">{title}</div>
          {meta.length > 0 && (
            <div class="ui-page-meta">
              {meta.map((m, i) => (
                <span class="ui-page-meta-chip" key={i}>
                  {m.icon && <i class={`fas ${m.icon}`} />}{m.label}
                </span>
              ))}
            </div>
          )}
        </div>
      </div>
      {actions && <div class="ui-page-head-actions">{actions}</div>}
    </div>
  );
}
