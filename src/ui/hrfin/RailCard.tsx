/**
 * src/ui/hrfin/RailCard.tsx — Aurora card shell (1:1 with the mockup `.hrfin-card`):
 * a head with an h2 and an optional right slot (a muted label, an icon, a
 * mini-badge), a page-composed body, and an optional "View all →" link.
 */

import { type VNode, type ComponentChildren } from 'preact';

export interface RailCardProps {
  title: string;
  /** Right-of-title slot in the card head (a muted <span>, an icon, a badge). */
  right?: ComponentChildren;
  linkLabel?: string;
  onLink?: () => void;
  children: ComponentChildren;
}

export function RailCard({ title, right, linkLabel, onLink, children }: RailCardProps): VNode {
  return (
    <article class="hrfin-card">
      <div class="hrfin-card-head">
        <h2>{title}</h2>
        {right}
      </div>
      {children}
      {linkLabel && <button type="button" class="hrfin-card-link" onClick={onLink}>{linkLabel} →</button>}
    </article>
  );
}
