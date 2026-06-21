/**
 * src/ui/components/SectionHead.tsx
 *
 * The register-page card header: an icon chip + title + subtitle on the left,
 * action buttons on the right. Wraps the existing `.vt-section-*` classes used
 * identically at the top of the Incidents / Investigations / CAPA tables.
 */

import { type VNode, type ComponentChildren } from 'preact';

interface SectionHeadProps {
  /** FontAwesome icon class, e.g. "fa-list-ul". */
  icon: string;
  title: string;
  subtitle?: string;
  /** Right-aligned action buttons. */
  actions?: ComponentChildren;
}

export function SectionHead({ icon, title, subtitle, actions }: SectionHeadProps): VNode {
  return (
    <div style={{ display: 'flex', alignItems: 'center', justifyContent: 'space-between', gap: 'var(--space-3)' }}>
      <div class="vt-section-titlewrap">
        <span class="vt-section-icon"><i class={`fas ${icon}`} /></span>
        <div>
          <div class="vt-section-title">{title}</div>
          {subtitle && <div class="vt-section-sub">{subtitle}</div>}
        </div>
      </div>
      {actions && <div style={{ display: 'flex', gap: 'var(--space-2)', flexShrink: 0 }}>{actions}</div>}
    </div>
  );
}
