/**
 * src/ui/gallery/FoundationsPanel.tsx — the global token editor.
 *
 * This is the old `ThemeEditor`, rebuilt on the draft layer. The behaviour that
 * changed is the important part: it used to write every keystroke straight to
 * `:root` and persist app-wide on save, which made it unusable as a playground —
 * dragging a colour re-themed production for every user mid-experiment.
 *
 * Now edits land on the preview scope and go nowhere until Apply. The token
 * MANIFEST is unchanged and still shared (`src/ui/theme/tokens.ts`), so there is
 * one list of editable tokens for the whole system.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { TextInput } from '../primitives/TextInput';
import { TOKEN_GROUPS, type TokenDef } from '../theme/tokens';
import { type GalleryDraft } from './galleryStore';

export function FoundationsPanel({ draft }: { draft: GalleryDraft }): VNode {
  const [filter, setFilter] = useState('');
  const q = filter.trim().toLowerCase();

  const groups = TOKEN_GROUPS
    .map(g => ({
      ...g,
      tokens: q
        ? g.tokens.filter(t => t.label.toLowerCase().includes(q) || t.name.toLowerCase().includes(q))
        : g.tokens,
    }))
    .filter(g => g.tokens.length > 0);

  return (
    <div style={{ display: 'grid', gap: 'var(--space-6)' }}>
      <div style={{ maxWidth: '320px' }}>
        <TextInput
          value={filter}
          onInput={setFilter}
          type="search"
          clearable
          iconLeft={<LucideIcon name="Search" />}
          placeholder="Filter tokens…"
          aria-label="Filter tokens"
        />
      </div>

      {groups.length === 0 && (
        <div class="ui-gallery-empty">
          <LucideIcon name="SearchX" size={20} />
          <span>No token matches &ldquo;{filter}&rdquo;.</span>
        </div>
      )}

      {groups.map(group => (
        <section key={group.id} style={{ display: 'grid', gap: 'var(--space-3)' }}>
          <div>
            <div style={{ color: 'var(--siomac-navy)', fontSize: 'var(--ui-font-size-body)', fontWeight: 'var(--font-weight-semibold)' }}>
              {group.label}
            </div>
            <div style={{ color: 'var(--text-muted)', fontSize: 'var(--ui-font-size-caption)', lineHeight: 'var(--ui-line-height-base)', maxWidth: '72ch' }}>
              {group.desc}
            </div>
          </div>

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(auto-fill, minmax(232px, 1fr))', gap: 'var(--space-3)' }}>
            {group.tokens.map(t => <TokenCard key={t.name} def={t} draft={draft} />)}
          </div>
        </section>
      ))}
    </div>
  );
}

function TokenCard({ def, draft }: { def: TokenDef; draft: GalleryDraft }): VNode {
  const dirty = def.name in draft.values;
  const value = draft.read(def.name);

  return (
    <div class={`ui-gallery-control${dirty ? ' ui-gallery-control--dirty' : ''}`}
      style={{
        padding: '10px 12px',
        border: `1px solid ${dirty ? 'var(--siomac-red)' : 'var(--border)'}`,
        borderRadius: 'var(--radius-sm)',
        background: 'var(--bg-card)',
      }}
    >
      <div class="ui-gallery-control-label">
        <span>{def.label}</span>
        {dirty && (
          <button type="button" class="ui-gallery-revert" aria-label={`Revert ${def.label}`} title="Revert to published value" onClick={() => draft.revert(def.name)}>
            <LucideIcon name="RotateCcw" />
          </button>
        )}
      </div>

      {(def.kind === 'color' || def.kind === 'color-alpha') && (
        <div class="ui-gallery-swatch-row">
          <input
            class="ui-gallery-swatch"
            type="color"
            value={hexOf(value)}
            aria-label={`${def.label} colour`}
            onInput={e => draft.set(def.name, (e.target as HTMLInputElement).value)}
          />
          {/* The text field stays authoritative: a native colour input cannot
              express rgba(), and several status tints are translucent. */}
          <TextInput size="sm" value={value} onInput={v => draft.set(def.name, v)} aria-label={def.label} />
        </div>
      )}

      {def.kind === 'select' && (
        <select
          class="ui-ctrl-input"
          style={{ border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', padding: '6px 8px', background: '#fff' }}
          value={value}
          aria-label={def.label}
          onChange={e => draft.set(def.name, (e.target as HTMLSelectElement).value)}
        >
          {def.options?.map(o => <option key={o.value} value={o.value}>{o.label}</option>)}
        </select>
      )}

      {def.kind === 'text' && (
        <TextInput size="sm" value={value} placeholder={def.hint} onInput={v => draft.set(def.name, v)} aria-label={def.label} />
      )}

      <div class="ui-gallery-var">{def.name}</div>
    </div>
  );
}

/** Best-effort hex for the native swatch; rgba() falls back to its RGB part. */
function hexOf(value: string): string {
  const v = value.trim();
  if (/^#[0-9a-f]{6}$/i.test(v)) return v;
  if (/^#[0-9a-f]{3}$/i.test(v)) return `#${v[1]}${v[1]}${v[2]}${v[2]}${v[3]}${v[3]}`;
  const m = /^rgba?\(\s*(\d+)[\s,]+(\d+)[\s,]+(\d+)/i.exec(v);
  if (m) {
    const hx = (n: string): string => Number(n).toString(16).padStart(2, '0');
    return `#${hx(m[1]!)}${hx(m[2]!)}${hx(m[3]!)}`;
  }
  return '#000000';
}
