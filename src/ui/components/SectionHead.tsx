/**
 * src/ui/components/SectionHead.tsx
 *
 * An icon + title + subtitle on the left, action buttons on the right. Two looks:
 *   • variant="area" (default) → `.ppe-section-head` — the section header used at
 *     the top of area panels (Risk & JSA, PPE Manager, …).
 *   • variant="register"       → `.vt-section-*` — the tighter header used at the
 *     top of register tables (Incidents / Investigations / CAPA).
 *
 * Accepts `sub` (preferred) or `subtitle` (alias). Unifies the old `@ui` and HSE
 * `_shared.tsx` SectionHead — zero visual change for existing callers.
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface SectionHeadProps {
  icon: string;
  title: string;
  sub?: string;
  /** Alias for `sub`. */
  subtitle?: string;
  actions?: ComponentChildren;
  variant?: 'area' | 'register';
}

export function SectionHead({ icon, title, sub, subtitle, actions, variant = 'area' }: SectionHeadProps): VNode {
  const subText = sub ?? subtitle;

  if (variant === 'register') {
    return (
      <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
        <div class="vt-section-titlewrap">
          <span class="vt-section-icon"><i class={`fas ${icon}`} /></span>
          <div>
            <div class="vt-section-title">{title}</div>
            {subText && <div class="vt-section-sub">{subText}</div>}
          </div>
        </div>
        {actions && <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{actions}</div>}
      </div>
    );
  }

  return (
    <div class="ppe-section-head">
      <div class="ppe-section-title">
        <span class="ppe-title-icon"><i class={`fas ${icon}`} /></span>
        <div><h3>{title}</h3>{subText && <p>{subText}</p>}</div>
      </div>
      {actions && <div class="ppe-section-actions">{actions}</div>}
    </div>
  );
}
