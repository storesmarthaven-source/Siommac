/**
 * src/components/sections/Settings/swzPrimitives.tsx
 *
 * Small shared presentational primitives for the v2 Settings data tools
 * (Administration). Keeps the look consistent across Sessions / Audit Log /
 * Permissions / Modules without duplicating markup.
 */
import { type VNode } from 'preact';

/** A compact stat tile (icon + value + label). */
export function SwzStat({ ico, color, val, label }: {
  ico: string; color: string; val: number | string; label: string;
}): VNode {
  return (
    <div class="swz-stat">
      <div class="swz-stat-ico" style={{ background: `${color}1a`, color }}><i class={`fas ${ico}`} /></div>
      <div class="swz-stat-main">
        <div class="swz-stat-val">{val}</div>
        <div class="swz-stat-label">{label}</div>
      </div>
    </div>
  );
}
