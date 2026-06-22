/**
 * src/ui/components/Card.tsx
 *
 * Small content cards used inside area panels:
 *   • MiniCard  — an icon + value + label tile (`.ppe-mini-card`).
 *   • RecordRow — an icon + title/sub + status pill list row (`.ppe-record`).
 *
 * Promoted from HSE `_shared.tsx`. Legacy alias: `Record` (= RecordRow).
 */

import { type VNode } from 'preact';

export function MiniCard({ icon, value, label }: { icon: string; value: string; label: string }): VNode {
  return (
    <div class="ppe-mini-card">
      <i class={`fas ${icon}`} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

export function RecordRow({ icon, title, sub, pill, pillClass }: {
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

/** Legacy alias used by PPEManager during migration. */
export const Record = RecordRow;
