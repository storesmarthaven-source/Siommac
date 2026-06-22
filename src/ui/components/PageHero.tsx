/**
 * src/ui/components/PageHero.tsx
 *
 * The dark navy hero panel that crowns every module page: an icon chip + title,
 * a row of up to four dark stat cards, and an optional KPI footer strip.
 *
 * This is the canonical "four cards at the top" header for the whole ERP.
 * Promoted from the HSE `_shared.tsx` `AreaHero` (zero visual change — same
 * `.hse-area-hero` / `.stat-card-dark` / `.hero-footer` classes). Themed entirely
 * through existing tokens; edit the look in `assets/styles/uikit-layout.css`.
 *
 * Pass `pageKey` to make the four stat cards REARRANGEABLE: an "Arrange" toggle
 * lets the user drag cards into their preferred order, persisted app-wide via the
 * backend (user override → org default → page order). Admins can publish the
 * current order as the org-wide default. See useModuleLayout.
 *
 * Legacy alias: `AreaHero`.
 */

import { type VNode } from 'preact';
import { useCardReorder, ArrangeControls } from './reorder';

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
  controls?: VNode;
  /**
   * Enables rearrangeable stat cards persisted to the backend, keyed by this
   * stable page id (e.g. 'hse.risk'). Omit to keep the cards fixed.
   */
  pageKey?: string;
  /* legacy — accepted but not rendered (express via footerItems instead) */
  context?: [string, string?];
  badges?: HeroBadge[];
  sub?: string;
  crumb?: string;
  actions?: VNode;
  metrics?: HeroMetric[];
}

function StatCard({ s, draggable, dragging, onDragStart, onDragOver, onDrop, onDragEnd }: {
  s: HeroStatDef; draggable: boolean; dragging: boolean;
  onDragStart?: () => void; onDragOver?: (e: DragEvent) => void; onDrop?: () => void; onDragEnd?: () => void;
}): VNode {
  return (
    <div
      class="stat-card stat-card-dark"
      draggable={draggable}
      onDragStart={onDragStart}
      onDragOver={onDragOver}
      onDrop={onDrop}
      onDragEnd={onDragEnd}
      style={draggable ? { cursor: 'grab', outline: '1px dashed rgba(255,255,255,.35)', opacity: dragging ? 0.4 : 1 } : undefined}
    >
      {draggable && (
        <span style={{ position: 'absolute', top: '8px', left: '8px', color: 'rgba(255,255,255,.5)', fontSize: '0.7rem' }}>
          <i class="fas fa-grip-vertical" />
        </span>
      )}
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
  );
}

export function PageHero({ icon, title, stats, areaIcon, watermarkClass, footerItems, controls, pageKey }: PageHeroProps): VNode {
  const r = useCardReorder(pageKey, stats.map(s => s.label));
  const byKey = new Map(stats.map(s => [s.label, s]));
  const ordered = r.enabled ? r.order.map(k => byKey.get(k)).filter((s): s is HeroStatDef => !!s) : stats;

  return (
    <div class={`dash-overview-panel ppe-hero-panel hse-area-hero${watermarkClass ? ` ${watermarkClass}` : ''}`}>
      <div class="dash-panel-content">

        <div class="hse-area-topbar">
          <div class="hse-area-title-block">
            <div class="hse-area-icon-chip"><i class={`fas ${icon}`} aria-hidden="true" /></div>
            <div class="hse-area-text">
              <div class="hse-area-title-row"><h2 class="hse-area-heading">{title}</h2></div>
            </div>
          </div>
          <div class="hse-area-pill-zone">
            <ArrangeControls reorder={r} variant="onDark" />
            {controls}
            <i class={`fas ${areaIcon ?? icon} hse-hero-area-icon`} aria-hidden="true" />
          </div>
        </div>

        <div class="hse-area-stats-row">
          {ordered.map(s => (
            <StatCard key={s.label} s={s} dragging={r.dragKey === s.label} {...r.dragHandlers(s.label)} />
          ))}
        </div>

      </div>

      {footerItems && footerItems.length > 0 && <HeroFooter items={footerItems} />}
    </div>
  );
}

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
                {item.pill && <span class={`hero-footer-pill ${item.pillVariant ?? 'green'}`}>{item.pill}</span>}
                {item.progress !== undefined && (
                  <div class="hero-footer-progress"><span class="fill" style={{ width: `${item.progress}%` }} /></div>
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
