/**
 * src/ui/components/PageHero.tsx
 *
 * The dark navy hero panel that crowns every module page: an icon chip + title,
 * a row of up to four dark stat cards, and an optional KPI footer strip.
 *
 * This is the canonical "four cards at the top" header for the whole ERP.
 * Promoted from the HSE `_shared.tsx` `AreaHero` (zero visual change — same
 * `.hse-area-hero` / `.stat-card-dark` / `.hero-footer` classes). Themed entirely
 * through existing tokens; edit the look in `assets/styles/uikit.css`.
 *
 * Legacy alias: `AreaHero` (kept for the HSE pages during migration).
 */

import { type VNode } from 'preact';

export interface HeroStatDef {
  icon: string;
  label: string;
  value: number | string;
  sub?: string;
  trend?: string;
  trendDown?: boolean;
  color?: 'blue' | 'red' | 'gold' | 'green';
}

export interface HeroFooterItem {
  icon: string;
  label: string;
  value: string;
  sub?: string;
  pill?: string;
  pillVariant?: 'green' | 'amber' | 'red';
  progress?: number;
  trend?: string;
  trendUp?: boolean;
}

export interface HeroMetric { label: string; value: string; highlight?: boolean; }
export interface HeroBadge  { icon: string; label: string; }

export interface PageHeroProps {
  icon: string;
  title: string;
  stats: HeroStatDef[];
  areaIcon?: string;
  watermarkClass?: string;
  footerItems?: HeroFooterItem[];
  /** Page-specific controls rendered in the topbar, left of the watermark icon. */
  controls?: VNode;
  /* legacy — accepted but not rendered (express via footerItems instead) */
  context?: [string, string?];
  badges?: HeroBadge[];
  sub?: string;
  crumb?: string;
  actions?: VNode;
  metrics?: HeroMetric[];
}

/**
 * The single shared page hero — one design, customised via props:
 *   • topbar:  icon chip + title + area watermark icon (+ optional controls slot)
 *   • stats:   up to four dark stat cards (icon + value + label + optional sub/trend)
 *   • footer:  KPI strip from `footerItems`
 */
export function PageHero({ icon, title, stats, areaIcon, watermarkClass, footerItems, controls }: PageHeroProps): VNode {
  return (
    <div class={`dash-overview-panel ppe-hero-panel hse-area-hero${watermarkClass ? ` ${watermarkClass}` : ''}`}>
      <div class="dash-panel-content">

        {/* Top bar */}
        <div class="hse-area-topbar">
          <div class="hse-area-title-block">
            <div class="hse-area-icon-chip">
              <i class={`fas ${icon}`} aria-hidden="true" />
            </div>
            <div class="hse-area-text">
              <div class="hse-area-title-row">
                <h2 class="hse-area-heading">{title}</h2>
              </div>
            </div>
          </div>
          <div class="hse-area-pill-zone">
            {controls}
            <i class={`fas ${areaIcon ?? icon} hse-hero-area-icon`} aria-hidden="true" />
          </div>
        </div>

        {/* Dark stat cards */}
        <div class="hse-area-stats-row">
          {stats.map(s => (
            <div class="stat-card stat-card-dark" key={s.label}>
              {s.trend && (
                <span class={`stat-card-trend${s.trendDown ? ' down' : ''}`}>
                  <i class={`fas fa-arrow-${s.trendDown ? 'down' : 'up'}`} /> {s.trend}
                </span>
              )}
              <div class={`stat-card-icon ${s.color ?? 'blue'}`}>
                <i class={`fas ${s.icon}`} />
              </div>
              <div class="stat-card-body">
                <div class="stat-card-value">{s.value}</div>
                <div class="stat-card-label">{s.label}</div>
                {s.sub && <div class="stat-card-sub">{s.sub}</div>}
              </div>
            </div>
          ))}
        </div>

      </div>

      {footerItems && footerItems.length > 0 && <HeroFooter items={footerItems} />}
    </div>
  );
}

/** Shared hero-footer KPI strip. */
export function HeroFooter({ items }: { items: HeroFooterItem[] }): VNode {
  return (
    <div class="hero-footer">
      {items.map((item, idx) => (
        <>
          {idx > 0 && <span class="hero-footer-divider" key={`div-${idx}`} />}
          <div class="hero-footer-item" key={item.label}>
            <span class="hero-footer-icon"><i class={`fas ${item.icon}`} /></span>
            <div class="hero-footer-content">
              <span class="hero-footer-label">{item.label}</span>
              <span class="hero-footer-value">
                {item.value}
                {item.sub && <small>{item.sub}</small>}
                {item.pill && (
                  <span class={`hero-footer-pill ${item.pillVariant ?? 'green'}`}>{item.pill}</span>
                )}
                {item.progress !== undefined && (
                  <div class="hero-footer-progress">
                    <span class="fill" style={{ width: `${item.progress}%` }} />
                  </div>
                )}
                {item.trend && (
                  <span class={`hero-footer-trend ${item.trendUp ? 'up' : 'down'}`}>
                    <i class={`fas fa-arrow-${item.trendUp ? 'up' : 'down'}`} /> {item.trend}
                  </span>
                )}
              </span>
            </div>
          </div>
        </>
      ))}
    </div>
  );
}

/** Legacy alias used by HSE pages during migration. */
export const AreaHero = PageHero;
