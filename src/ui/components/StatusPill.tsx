/**
 * src/ui/components/StatusPill.tsx
 *
 * The one status chip. Wraps the existing `.vt-pill` classes and routes every
 * colour decision through @ui/status/statusTokens — so no page ever writes its
 * own status→colour logic again.
 *
 * Give it EITHER:
 *   - `tone`   → explicit semantic tone (positive/caution/negative/critical/info/neutral)
 *   - `status` → free-text status; tone is derived via toneFromText()
 * Label defaults to the status string (or children).
 */

import { type VNode, type ComponentChildren } from 'preact';
import { type Tone, toneClass, toneFromText } from '@ui/status/statusTokens';

interface StatusPillProps {
  tone?: Tone;
  status?: string;
  class?: string;
  children?: ComponentChildren;
}

export function StatusPill({ tone, status, class: extra, children }: StatusPillProps): VNode {
  const resolved: Tone = tone ?? (status ? toneFromText(status) : 'info');
  const cls = `${toneClass(resolved)}${extra ? ' ' + extra : ''}`;
  return <span class={cls}>{children ?? status}</span>;
}
