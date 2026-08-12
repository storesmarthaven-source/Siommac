/**
 * src/ui/components/StatusPill.tsx
 *
 * A thin DOMAIN adapter over the canonical Badge — not a second badge system.
 *
 * It exists for one reason: its callers speak the ERP's status vocabulary
 * (free-text statuses, and the `positive/caution/negative/critical/info/neutral`
 * tone model), while Badge speaks the design system's
 * `success/warning/danger/info/neutral/accent`. This translates, then renders
 * the real component. It owns no colours, no geometry and no classes of its own.
 *
 * Give it EITHER:
 *   - `tone`   → explicit domain tone
 *   - `status` → free-text status; tone is derived via toneFromText()
 * Label defaults to the status string (or children).
 *
 * ⚠ Deprecated as a NAME: new code should call `<Badge tone={badgeTone(t)}>`
 * directly. It stays only so the 17 existing call sites migrate to the canonical
 * rendering without 17 separate edits; delete it once they are converted.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { type Tone, badgeTone, toneFromText } from '@ui/status/statusTokens';
import { Badge } from '../primitives/Badge';

interface StatusPillProps {
  tone?: Tone;
  status?: string;
  class?: string;
  children?: ComponentChildren;
}

export function StatusPill({ tone, status, class: extra, children }: StatusPillProps): VNode {
  const resolved: Tone = tone ?? (status ? toneFromText(status) : 'info');
  return (
    <Badge tone={badgeTone(resolved)} variant="soft" class={extra}>
      {children ?? status}
    </Badge>
  );
}
