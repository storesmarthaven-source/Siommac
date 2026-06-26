/**
 * src/ui/components/EntityHead.tsx
 *
 * The identity header of a rich detail panel — avatar + name + reference line +
 * a meta line (position · department · site, etc.) — and the stat strip that
 * sits below it. Shared by HR ▸ Employee Master and the HSE Incident/Risk/CAPA
 * panels so every entity reads the same. Styled from tokens (`.ui-entity-*` /
 * `.ui-panel-stat*` in assets/styles/uikit-overlay.css).
 */

import { type VNode, type ComponentChildren } from 'preact';

function initialsOf(name: string): string {
  const parts = name.split(/\s+/).filter(Boolean).slice(0, 2);
  return parts.map(w => (w[0] ?? '').toUpperCase()).join('') || '?';
}

export interface EntityHeadProps {
  name: string;
  /** Avatar image URL; falls back to initials when absent. */
  avatarUrl?: string | null;
  /** Reference line under the name — e.g. an employee number + a status pill.
      (Named `reference`, not `ref`: Preact intercepts `ref` for forwarding.) */
  reference?: ComponentChildren;
  /** Meta items rendered on one line, separated by dots (nullish entries dropped). */
  meta?: (string | null | undefined)[];
}

export function EntityHead({ name, avatarUrl, reference, meta }: EntityHeadProps): VNode {
  const metaItems = (meta ?? []).filter((m): m is string => !!m);
  return (
    <div class="ui-entity-head">
      <div class="ui-entity-photo">
        {avatarUrl ? <img src={avatarUrl} alt={name} /> : <span>{initialsOf(name)}</span>}
      </div>
      <div class="ui-entity-name">
        <h2>{name}</h2>
        {reference && <div class="ui-entity-ref">{reference}</div>}
        {metaItems.length > 0 && (
          <div class="ui-entity-meta">
            {metaItems.map((m, i) => (
              <>
                {i > 0 && <span class="ui-entity-meta-sep">•</span>}
                <span>{m}</span>
              </>
            ))}
          </div>
        )}
      </div>
    </div>
  );
}

export interface PanelStatItem { label: string; value: ComponentChildren; }

/**
 * The label/value stat strip under the entity head. `plain` drops the outer
 * border/margin and enlarges numerals — use it inside an <InfoCard> (e.g. a
 * training snapshot); the bordered default is the standalone profile strip.
 */
export function PanelStats({ items, plain }: { items: PanelStatItem[]; plain?: boolean }): VNode {
  return (
    <div class={`ui-panel-stats${plain ? ' is-plain' : ''}`}>
      {items.map(s => (
        <div class="ui-panel-stat" key={s.label}>
          <small>{s.label}</small>
          <div class="ui-panel-stat-line">{s.value}</div>
        </div>
      ))}
    </div>
  );
}
