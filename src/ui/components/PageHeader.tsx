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
  /** Short description shown under the title. */
  sub?: string;
  /** Breadcrumb root (the module), e.g. 'HSE'. */
  module?: string;
  /** Extra breadcrumb segments after the module (e.g. a parent area). */
  crumbs?: string[];
  /** Meta shown as chips beneath the title/description. */
  meta?: PageMetaChip[];
  /** Right-aligned action buttons. */
  actions?: ComponentChildren;
}

export function PageHeader({ icon, title, sub, module, crumbs = [], meta = [], actions }: PageHeaderProps): VNode {
  // Breadcrumb = the parent trail only (module › crumbs). The title is the H1
  // below it, so we don't repeat it as a crumb.
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
                  <span key={c} class={i === trail.length - 1 ? 'ui-page-crumb-current' : undefined}>{c}</span>
                </>
              ))}
            </div>
          )}
          <div class="ui-page-title">{title}</div>
          {sub && <div class="ui-page-sub">{sub}</div>}
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
