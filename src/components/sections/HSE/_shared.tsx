/**
 * src/components/sections/HSE/_shared.tsx
 *
 * Shared presentational primitives for every HSE area. Factored out so the
 * Incidents/Risk/Permits/etc. pages all share one hero, modal, drawer and the
 * small card helpers — instead of each area re-writing them.
 *
 *  • AreaHero   — the dark overview panel (ProfilePill + StatCards + breadcrumb)
 *  • HseModal   — centered overlay dialog for create/edit forms
 *  • HseDrawer  — slide-in detail panel (record drilldown)
 *  • SectionHead / MiniCard / Record — promoted from PPEManager
 *  • Field / Select / Textarea — form controls that match the .vt-* look
 */

import { type VNode, type ComponentChildren } from 'preact';
import { StatCard } from '../Employees/StatCard';
import { ProfilePill } from '@shared/ProfilePill';

// ── Hero ──────────────────────────────────────────────────────────────────────

export interface HeroStatDef { icon: string; label: string; value: number; color?: string; }
export interface HeroMetric  { label: string; value: string; highlight?: boolean; }
export interface HeroBadge   { icon: string; label: string; }

/**
 * Dark area hero — same skin as the PPE Manager / dashboard overview. Each HSE
 * page renders one at the top with its own icon, title, stat cards and crumb.
 *
 * `areaIcon`  — a second large FA icon rendered faded on the right as a visual
 *               motif. Defaults to the same `icon` if omitted.
 * `context`   — two short strings shown below the title as a subtitle + note
 *               (e.g. ["Trinidad & Tobago Operations", "2026 HSE Programme"]).
 */
export function AreaHero({ icon, title, sub, crumb, stats, actions, areaIcon, context, metrics, badges }: {
  icon: string; title: string; sub?: string; crumb: string;
  stats: HeroStatDef[]; actions?: VNode;
  areaIcon?: string;
  context?: [string, string?];
  metrics?: HeroMetric[];
  badges?: HeroBadge[];
}): VNode {
  return (
    <div class="dash-overview-panel ppe-hero-panel hse-area-hero">
      <div class="dash-panel-content">
        <div class="overview-top-bar">
          <div class="overview-title-section">
            <i class={`fas ${icon}`} />
            <div>
              <h2 style={{ lineHeight: 1.1 }}>{title}{sub && <span class="hse-hero-sub">{sub}</span>}</h2>
              {context && (
                <div class="hse-hero-context">
                  <span>{context[0]}</span>
                  {context[1] && <><i class="fas fa-circle" style={{ fontSize: '4px', opacity: .5 }} /><span>{context[1]}</span></>}
                </div>
              )}
              {badges && badges.length > 0 && (
                <div class="hse-hero-badges">
                  {badges.map(b => (
                    <span class="hse-hero-badge" key={b.label}><i class={`fas ${b.icon}`} />{b.label}</span>
                  ))}
                </div>
              )}
            </div>
          </div>
          <div class="hse-hero-right">
            <i class={`fas ${areaIcon ?? icon} hse-hero-area-icon`} aria-hidden="true" />
            <ProfilePill variant="onDark" />
          </div>
        </div>
        <div class="dash-stats-row">
          {stats.map(s => <StatCard key={s.label} icon={s.icon} label={s.label} value={s.value} color={s.color} />)}
        </div>
        {metrics && metrics.length > 0 && (
          <div class="hse-hero-metrics">
            {metrics.map((m, i) => (
              <div class="hse-hero-metric" key={m.label}>
                {i > 0 && <div class="hse-hero-metric-sep" />}
                <span class={`hse-hero-metric-val${m.highlight ? ' highlight' : ''}`}>{m.value}</span>
                <span class="hse-hero-metric-label">{m.label}</span>
              </div>
            ))}
          </div>
        )}
      </div>
      <div class="dash-panel-footer">
        <nav class="page-breadcrumb ppe-hero-crumb" aria-label="Breadcrumb">
          <span class="page-breadcrumb-root">HSE</span>
          <i class="fas fa-chevron-right page-breadcrumb-sep" aria-hidden="true" />
          <span class="page-breadcrumb-current">{crumb}</span>
        </nav>
        {actions ?? <button class="dash-layout-btn admin-only" type="button"><i class="fas fa-edit" /> Edit Layout</button>}
      </div>
    </div>
  );
}

// ── In-page tab bar (area sub-views) ──────────────────────────────────────────

export interface AreaTab { key: string; label: string; icon: string; }

/** Pill-style tab bar for an area's sub-views (Register / Report / …). */
export function AreaTabs({ tabs, active, onSelect }: {
  tabs: AreaTab[]; active: string; onSelect: (key: string) => void;
}): VNode {
  return (
    <div class="hse-area-tabs" role="tablist">
      {tabs.map(t => (
        <button
          key={t.key} role="tab" aria-selected={t.key === active}
          class={`hse-area-tab${t.key === active ? ' active' : ''}`}
          onClick={() => onSelect(t.key)}
        >
          <i class={`fas ${t.icon}`} /> {t.label}
        </button>
      ))}
    </div>
  );
}

// ── Section head (icon + title + sub + actions) ───────────────────────────────

export function SectionHead({ icon, title, sub, actions }: {
  icon: string; title: string; sub: string; actions?: VNode;
}): VNode {
  return (
    <div class="ppe-section-head">
      <div class="ppe-section-title">
        <span class="ppe-title-icon"><i class={`fas ${icon}`} /></span>
        <div><h3>{title}</h3><p>{sub}</p></div>
      </div>
      {actions && <div class="ppe-section-actions">{actions}</div>}
    </div>
  );
}

export function MiniCard({ icon, value, label }: { icon: string; value: string; label: string }): VNode {
  return (
    <div class="ppe-mini-card">
      <i class={`fas ${icon}`} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function Record({ icon, title, sub, pill, pillClass }: {
  icon: string; title: string; sub: string; pill: string; pillClass?: string;
}): VNode {
  return (
    <div class="ppe-record">
      <i class={`fas ${icon}`} />
      <div><strong>{title}</strong><span>{sub}</span></div>
      <span class={pillClass ?? 'vt-pill is-info'}>{pill}</span>
    </div>
  );
}

// ── Modal ─────────────────────────────────────────────────────────────────────

/** Centered overlay dialog for create/edit forms. Submitting is the caller's. */
export function HseModal({ open, title, sub, children, onClose, onSubmit, submitLabel = 'Submit' }: {
  open: boolean; title: string; sub?: string; children: ComponentChildren;
  onClose: () => void; onSubmit?: () => void; submitLabel?: string;
}): VNode | null {
  if (!open) return null;
  return (
    <>
      <div class="hse-modal-backdrop show" onClick={onClose} />
      <section class="hse-modal show" role="dialog" aria-modal="true">
        <div class="hse-modal-head">
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>
        <div class="hse-modal-body">{children}</div>
        <div class="hse-modal-foot">
          <button class="hse-btn" onClick={onClose}>Cancel</button>
          {onSubmit && <button class="hse-btn primary" onClick={onSubmit}>{submitLabel}</button>}
        </div>
      </section>
    </>
  );
}

// ── Drawer ────────────────────────────────────────────────────────────────────

export interface DrawerDetail { label: string; value: VNode | string; }

/** Slide-in detail panel. `open` toggles the visible state. */
export function HseDrawer({ open, title, sub, details, children, onClose, foot }: {
  open: boolean; title: string; sub?: string; details?: DrawerDetail[];
  children?: ComponentChildren; onClose: () => void; foot?: VNode;
}): VNode {
  return (
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer${open ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>
        <div class="hse-drawer-head">
          <div><h3>{title}</h3>{sub && <p>{sub}</p>}</div>
          <button class="hse-icon-btn" onClick={onClose} aria-label="Close"><i class="fas fa-xmark" /></button>
        </div>
        <div class="hse-drawer-body">
          {details && (
            <div class="hse-drawer-grid">
              {details.map(d => <div class="hse-drawer-card" key={d.label}><span>{d.label}</span><strong>{d.value}</strong></div>)}
            </div>
          )}
          {children}
        </div>
        <div class="hse-drawer-foot">{foot ?? <button class="hse-btn" onClick={onClose}>Close</button>}</div>
      </aside>
    </>
  );
}

// ── Form controls (match the .vt-* surface) ───────────────────────────────────

export function Field({ label, children, wide }: { label: string; children: ComponentChildren; wide?: boolean }): VNode {
  return (
    <div class={`hse-form-group${wide ? ' wide' : ''}`}>
      <label>{label}</label>
      {children}
    </div>
  );
}

export function TextInput({ value, onInput, placeholder }: { value: string; onInput: (v: string) => void; placeholder?: string }): VNode {
  return <input class="hse-input" value={value} placeholder={placeholder} onInput={e => onInput((e.target as HTMLInputElement).value)} />;
}

export function SelectInput({ value, onInput, options }: { value: string; onInput: (v: string) => void; options: readonly string[] }): VNode {
  return (
    <select class="hse-input" value={value} onChange={e => onInput((e.target as HTMLSelectElement).value)}>
      {options.map(o => <option key={o} value={o}>{o}</option>)}
    </select>
  );
}

export function TextareaInput({ value, onInput, placeholder }: { value: string; onInput: (v: string) => void; placeholder?: string }): VNode {
  return <textarea class="hse-input hse-textarea" value={value} placeholder={placeholder} onInput={e => onInput((e.target as HTMLTextAreaElement).value)} />;
}
