/** Finance's compact domain tones translated into the canonical Badge. */

import { type VNode, type ComponentChildren } from 'preact';
import { Badge, type BadgeTone } from '../primitives/Badge';

export type HrfinTone = 'ok' | 'bad' | 'wn' | 'nu' | 'dr';

const TONE: Record<HrfinTone, BadgeTone> = {
  ok: 'success', bad: 'danger', wn: 'warning', nu: 'info', dr: 'neutral',
};

export function HrfinPill({ tone, children }: { tone: HrfinTone; children: ComponentChildren }): VNode {
  return <Badge tone={TONE[tone]}>{children}</Badge>;
}
