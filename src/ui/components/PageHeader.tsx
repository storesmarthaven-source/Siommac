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
  /** FontAwesome class string (e.g. 'fa-users'), OR a custom icon node (e.g. a Lucide SVG). */
  icon: string | ComponentChildren;
  title: string;
  /** Short description shown under the title. */
  sub?: string;
  /** Breadcrumb root (the module), e.g. 'HSE'. */
  module?: string;
  /** Extra breadcrumb segments after the module (e.g. a parent area). */
  crumbs?: string[];
  /** @deprecated No-op — the standard header shows no meta chips (kept clean, like
   *  the reference AC header). Surface counts/dates inside the page, not the header. */
  meta?: PageMetaChip[];
  /** Right-aligned action buttons. */
  actions?: ComponentChildren;
  /** @deprecated No-op — the account pill now lives only in the global UserPill top bar. */
  hidePill?: boolean;
  /** Hide the title/subtext (e.g. when a global top bar already shows them). */
  hideTitle?: boolean;
}

export function PageHeader({ icon, title, sub, module, crumbs = [], actions, hideTitle }: PageHeaderProps): VNode {
  // Breadcrumb = the parent trail only (module › crumbs). The title is the H1
  // below it, so we don't repeat it as a crumb.
  const trail = [module, ...crumbs].filter(Boolean) as string[];
  return (
    <div class="ui-page-header">
      <div class="ui-page-head-main">
        <span class="ui-page-head-icon">{typeof icon === 'string' ? <i class={`fas ${icon}`} /> : icon}</span>
        <span class="ui-page-head-rule" aria-hidden="true" />
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
          {!hideTitle && <div class="ui-page-title">{title}</div>}
          {!hideTitle && sub && <div class="ui-page-sub">{sub}</div>}
        </div>
      </div>
      <div class="ui-page-head-actions">
        {actions}
      </div>
    </div>
  );
}
