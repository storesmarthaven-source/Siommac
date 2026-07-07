/**
 * src/ui/hrfin/HrfinPill.tsx — Aurora status pill (1:1 with the mockup
 * `.hrfin-status`). Tones map to the mockup's is-* classes.
 */

import { type VNode, type ComponentChildren } from 'preact';

export type HrfinTone = 'ok' | 'bad' | 'wn' | 'nu' | 'dr';

const CLS: Record<HrfinTone, string> = { ok: 'is-success', bad: 'is-danger', wn: 'is-warning', nu: 'is-info', dr: 'is-muted' };

export function HrfinPill({ tone, children }: { tone: HrfinTone; children: ComponentChildren }): VNode {
  return <span class={`hrfin-status ${CLS[tone]}`}>{children}</span>;
}
