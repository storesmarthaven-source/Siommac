/**
 * src/components/shared/AppTopBar.tsx
 *
 * Horizontal page top bar (prototype). A navy bar pinned to the top of the page:
 *   main row  — page title/subtext · global search (hosts the AI assistant button
 *               on its right edge) · profile/notifications cluster in the corner.
 *   footer strip — breadcrumb trail · meta chips, capped by a thin brand-accent
 *               line along the bar's bottom edge.
 * Search opens the command palette (⌘K).
 *
 * Currently rendered on Employee Master only, to evaluate the look before making
 * it the global top bar across every page.
 */

import { type VNode } from 'preact';
import { dialog } from '@lib/dialog';
import type { PageMetaChip } from '@ui/components/PageHeader';
import { ProfilePill } from './ProfilePill';

function openSearch(): void {
  (window as unknown as { openCommandPalette?: () => void }).openCommandPalette?.();
}

function openAI(): void {
  // Placeholder until the AI assistant is built — honest notice, not a faked feature.
  void dialog.info('AI Assistant', 'The AI assistant is coming soon.');
}

export interface AppTopBarProps {
  /** Icon shown next to the title, e.g. 'fa-users'. */
  icon?: string;
  /** Page title, shown at the bar's left edge (replaces the page header's title). */
  title?: string;
  /** Short description shown under the title. */
  sub?: string;
  /** Breadcrumb root (the module), e.g. 'HR'. Shown in the footer strip. */
  module?: string;
  /** Extra breadcrumb segments after the module (e.g. a parent area). */
  crumbs?: string[];
  /** Meta shown as chips in the footer strip, alongside the breadcrumb. */
  meta?: PageMetaChip[];
}

export function AppTopBar({ icon, title, sub, module, crumbs = [], meta = [] }: AppTopBarProps): VNode {
  // Breadcrumb trail ends at the current page (title) — the footer strip is now
  // the dedicated "where am I" row, so it repeats the title as the final, current segment.
  const trail = [module, ...crumbs, title].filter(Boolean) as string[];

  return (
    <header class="app-topbar">
      <div class="app-topbar-main">
        {(title || sub) && (
          <div class="app-topbar-title">
            {title && (
              <div class="app-topbar-title-text">
                {icon && <i class={`fas ${icon} app-topbar-title-icon`} aria-hidden="true" />}
                {title}
              </div>
            )}
            {sub && <div class="app-topbar-sub-text">{sub}</div>}
          </div>
        )}
        <div class="app-topbar-search">
          <button type="button" class="app-topbar-search-trigger" onClick={openSearch} title="Search & jump to (Ctrl/⌘K)">
            <i class="fas fa-search" aria-hidden="true" />
            <span class="app-topbar-search-text">Search &amp; jump to…</span>
          </button>
          <kbd class="app-topbar-kbd">⌘K</kbd>
          <button type="button" class="app-topbar-ai" onClick={openAI} title="AI Assistant" aria-label="AI Assistant">
            <span class="app-topbar-ai-glyph" aria-hidden="true" />
          </button>
        </div>
        <div class="app-topbar-pill"><ProfilePill iconsFirst /></div>
      </div>

      {(trail.length > 0 || meta.length > 0) && (
        <div class="app-topbar-footer">
          {trail.length > 0 && (
            <div class="app-topbar-crumb">
              {trail.map((c, i) => (
                <>
                  {i > 0 && <i class="fas fa-chevron-right app-topbar-crumb-sep" aria-hidden="true" />}
                  <span key={c} class={i === trail.length - 1 ? 'app-topbar-crumb-current' : undefined}>{c}</span>
                </>
              ))}
            </div>
          )}
          <div class="app-topbar-footer-spacer" />
          {meta.length > 0 && (
            <div class="app-topbar-meta">
              {meta.map((m, i) => (
                <span class="app-topbar-meta-chip" key={i}>
                  {m.icon && <i class={`fas ${m.icon}`} aria-hidden="true" />}{m.label}
                </span>
              ))}
            </div>
          )}
        </div>
      )}
    </header>
  );
}
