/**
 * The global foundation-token editor. The manifest remains the single source
 * of truth; this file only gives that manifest a calm, non-technical editing
 * experience. Changes still land in the scoped GalleryDraft until publish.
 */

import { type CSSProperties, type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { Badge, type BadgeTone } from '../primitives/Badge';
import { Button } from '../primitives/Button';
import { TextInput } from '../primitives/TextInput';
import { StudioColorControl } from '../studio/RecipeStyleEditor';
import { TOKEN_GROUPS, type TokenDef, type TokenGroup } from '../theme/tokens';
import { type GalleryDraft } from './galleryStore';
import './FoundationsPanel.css';

export type FoundationSectionId = 'colours' | 'type' | 'spacing' | 'shape' | 'controls' | 'states';

export interface FoundationSection {
  id: FoundationSectionId;
  label: string;
  description: string;
  icon: LucideName;
  includes: (group: TokenGroup) => boolean;
}

const COLOUR_GROUPS = new Set(['brand', 'surface', 'text', 'status', 'status-strong', 'status-tint']);
const TYPE_GROUPS = new Set(['weight', 'type', 'typescale']);
export const FOUNDATION_SECTIONS: readonly FoundationSection[] = [
  {
    id: 'colours', label: 'Colours', icon: 'Palette',
    description: 'Brand, semantic roles, surfaces, text and operational status colours.',
    includes: group => group.id.startsWith('semantic-') || COLOUR_GROUPS.has(group.id),
  },
  {
    id: 'type', label: 'Typography', icon: 'Type',
    description: 'Font families, weights, sizes and line-height used throughout SIOMAC.',
    includes: group => TYPE_GROUPS.has(group.id),
  },
  {
    id: 'spacing', label: 'Spacing', icon: 'BetweenVerticalEnd',
    description: 'The shared spacing rhythm used for padding, gaps and page structure.',
    includes: group => group.id === 'spacing',
  },
  {
    id: 'shape', label: 'Shape & borders', icon: 'Scan',
    description: 'Corner radius, border weight and keyboard-focus geometry.',
    includes: group => group.id === 'radius' || group.id === 'focus',
  },
  {
    id: 'controls', label: 'Controls & icons', icon: 'SlidersHorizontal',
    description: 'Canonical control heights, padding and icon geometry.',
    includes: group => group.id === 'control' || group.id === 'icon',
  },
  {
    id: 'states', label: 'Interaction', icon: 'MousePointer2',
    description: 'Focus, hover, disabled, validation and motion behaviour.',
    includes: group => ['interaction', 'motion', 'inert', 'validation'].includes(group.id),
  },
];

export function FoundationsPanel({ draft, activeSection = 'colours', activeGroupId = null }: {
  draft: GalleryDraft;
  activeSection?: FoundationSectionId;
  activeGroupId?: string | null;
}): VNode {
  const [filter, setFilter] = useState('');
  const query = filter.trim().toLowerCase();
  const section = FOUNDATION_SECTIONS.find(item => item.id === activeSection) ?? FOUNDATION_SECTIONS[0]!;
  const baseGroups = TOKEN_GROUPS.filter(group => section.includes(group) && (!activeGroupId || group.id === activeGroupId));
  const groups = baseGroups
    .map(group => ({
      ...group,
      tokens: query
        ? group.tokens.filter(token => token.label.toLowerCase().includes(query)
          || token.name.toLowerCase().includes(query)
          || token.hint?.toLowerCase().includes(query))
        : group.tokens,
    }))
    .filter(group => group.tokens.length > 0);
  const visibleCount = groups.reduce((total, group) => total + group.tokens.length, 0);
  const changedCount = Object.keys(draft.values).filter(name => TOKEN_GROUPS.some(group => group.tokens.some(token => token.name === name))).length;

  return (
    <div class="sds-foundations">
      <header class="sds-foundations__hero">
        <div>
          <span class="sds-foundations__eyebrow">System foundations</span>
          <h1>Design tokens</h1>
          <p>Use Theme Generator for the brand. Use this page to tune the shared colours, typography, spacing and behaviour used by every canonical component.</p>
        </div>
        <div class="sds-foundations__summary" aria-label="Token summary">
          <span><strong>{TOKEN_GROUPS.reduce((total, group) => total + group.tokens.length, 0)}</strong> settings</span>
          <span class={changedCount > 0 ? 'is-dirty' : ''}><strong>{changedCount}</strong> changed</span>
        </div>
      </header>

      <div class="sds-foundations__editor">
          <header class="sds-foundations__editor-head">
            <div><span>Editing {activeGroupId ? 'subcategory' : 'module'}</span><h2>{activeGroupId ? cleanGroupLabel(baseGroups[0]?.label ?? section.label) : section.label}</h2><p>{activeGroupId ? baseGroups[0]?.desc : section.description}</p></div>
            <strong>{visibleCount} {visibleCount === 1 ? 'setting' : 'settings'}</strong>
          </header>

          <div class="sds-foundations__toolbar">
            <div><strong>Settings</strong><small>Open a group, then change only what you need.</small></div>
            <div class="sds-foundations__search">
              <TextInput value={filter} onInput={setFilter} type="search" clearable
                iconLeft={<LucideIcon name="Search" />} placeholder={`Search ${section.label.toLowerCase()}…`}
                aria-label={`Search ${section.label.toLowerCase()} tokens`} />
            </div>
          </div>

          {groups.length === 0 ? (
            <div class="sds-foundations__empty">
              <LucideIcon name="SearchX" />
              <strong>No matching settings</strong>
              <span>Try a different word or choose another module.</span>
              <button type="button" onClick={() => setFilter('')}>Clear search</button>
            </div>
          ) : (
            <div class="sds-foundations__groups">
              {groups.map((group, index) => <TokenGroupPanel key={group.id} group={group} draft={draft} open={query.length > 0 || index === 0} />)}
            </div>
          )}
      </div>
    </div>
  );
}

function TokenGroupPanel({ group, draft, open }: { group: TokenGroup; draft: GalleryDraft; open: boolean }): VNode {
  const changed = group.tokens.filter(token => token.name in draft.values).length;
  const [expanded, setExpanded] = useState(open);

  useEffect(() => {
    if (open) setExpanded(true);
  }, [open]);

  return (
    <details class="sds-token-group" open={expanded}
      onToggle={event => setExpanded(event.currentTarget.open)}>
      <summary>
        <span><strong>{cleanGroupLabel(group.label)}</strong><small>{group.desc}</small></span>
        <span class="sds-token-group__meta">
          {changed > 0 && <em>{changed} changed</em>}
          <b>{group.tokens.length}</b>
          <LucideIcon name="ChevronDown" />
        </span>
      </summary>
      <div class="sds-token-group__body">
        {group.tokens.map(token => <TokenRow key={token.name} def={token} draft={draft} />)}
      </div>
    </details>
  );
}

function TokenRow({ def, draft }: { def: TokenDef; draft: GalleryDraft }): VNode {
  const dirty = def.name in draft.values;
  const value = draft.read(def.name);
  const color = def.kind === 'color' || def.kind === 'color-alpha';

  return (
    <div class={`sds-token-row${dirty ? ' is-dirty' : ''}`}>
      <div class="sds-token-row__copy">
        <span>{cleanTokenLabel(def.label)}</span>
        {def.hint && <small>{cleanHint(def.hint)}</small>}
      </div>
      <TokenImpactPreview def={def} value={value} />
      <div class="sds-token-row__control">
        {color && <StudioColorControl id={`token-${def.name}`} label={def.label} value={value}
          savedColors={draft.savedColors} onSaveColor={draft.addSavedColor} onRemoveSavedColor={draft.removeSavedColor}
          onChange={next => draft.set(def.name, next)} />}
        {def.kind === 'select' && <select value={value} aria-label={def.label}
          onChange={event => draft.set(def.name, event.currentTarget.value)}>
          {def.options?.map(option => <option key={option.value} value={option.value}>{option.label}</option>)}
        </select>}
        {def.kind === 'text' && <TextInput size="sm" value={value} placeholder={def.hint}
          onInput={next => draft.set(def.name, next)} aria-label={def.label} />}
      </div>
      <div class="sds-token-row__status">
        {dirty ? <button type="button" aria-label={`Reset ${def.label}`} title="Reset this setting"
          onClick={() => draft.revert(def.name)}><LucideIcon name="RotateCcw" /></button> : <span>Theme</span>}
      </div>
    </div>
  );
}

function TokenImpactPreview({ def, value }: { def: TokenDef; value: string }): VNode {
  const name = def.name;
  const color = def.kind === 'color' || def.kind === 'color-alpha';

  if (name.startsWith('--ui-color-action-primary')) {
    const hover = name.includes('hover') || name.endsWith('-dark');
    const style = name.endsWith('-text')
      ? previewVars({ '--ui-button-primary-fg': value })
      : hover
        ? previewVars({ '--ui-button-primary-bg-hover': value })
        : previewVars({ '--ui-button-primary-bg': value, '--ui-button-primary-border': value });
    return <div class="sds-token-impact sds-token-impact--component"><Button variant="primary" forceState={hover ? 'hover' : undefined} style={style}>Continue</Button></div>;
  }
  if (name.startsWith('--ui-color-action-secondary')) {
    const style = name.endsWith('-text')
      ? previewVars({ '--ui-button-outline-fg': value })
      : previewVars({ '--ui-button-outline-border': value, '--ui-button-outline-fg': value });
    return <div class="sds-token-impact sds-token-impact--component"><Button variant="outline" style={style}>View details</Button></div>;
  }
  if (/^--ui-color-(danger|warning|success|info)$/.test(name)) {
    const tone = statusTone(name);
    const badgeTone = `--ui-badge-${tone}`;
    return <div class="sds-token-impact sds-token-impact--component"><Badge tone={tone} variant="solid" dot style={previewVars({ [`${badgeTone}-solid`]: value, [`${badgeTone}-soft`]: value, [`${badgeTone}-fg`]: value })}>{statusLabel(tone)}</Badge></div>;
  }
  if (/^--st-(danger|warning|success|info|neutral|purple)(?:-|$)/.test(name)) {
    const tone = statusTone(name);
    return <div class="sds-token-impact sds-token-impact--component"><Badge tone={tone} dot>{statusLabel(tone)}</Badge></div>;
  }
  if (/^--ui-validation-(error|warning|success)/.test(name)) {
    const validation = name.includes('error') ? 'error' : name.includes('warning') ? 'warning' : 'success';
    return <div class="sds-token-impact sds-token-impact--component sds-token-impact--field"><TextInput value="Employee name" validation={validation} readOnly aria-label={`${validation} field preview`} style={previewVars({ [name]: value })} /></div>;
  }
  if (/^--ui-(disabled|readonly)-/.test(name)) {
    const disabled = name.includes('disabled');
    return <div class="sds-token-impact sds-token-impact--component sds-token-impact--field"><TextInput value={disabled ? 'Unavailable' : 'Employee ID'} disabled={disabled} readOnly aria-label={`${disabled ? 'Disabled' : 'Read-only'} field preview`} style={previewVars({ [name]: value })} /></div>;
  }
  if (name.startsWith('--ui-focus-') || name.startsWith('--ui-border-width')) {
    return <div class="sds-token-impact sds-token-impact--component sds-token-impact--field"><TextInput value="Focused field" forceState="focus" readOnly aria-label="Focus and border preview" style={previewVars({ [name]: value })} /></div>;
  }
  if (/border|focus|ring/.test(name) && color) {
    return <div class="sds-token-impact sds-token-impact--component sds-token-impact--field"><TextInput value="Focused field" forceState="focus" readOnly aria-label="Field border preview" style={previewVars({ [name]: value })} /></div>;
  }
  if (name.startsWith('--siomac-')) {
    return <BrandFoundationPreview name={name} value={value} />;
  }

  if (color) {
    if (/text|fg|icon|contrast/.test(name)) {
      const inverse = /inverse|primary-text|secondary-text/.test(name);
      return <div class={`sds-token-impact sds-token-impact--text${inverse ? ' is-inverse' : ''}`} style={{ color: value }}><strong>Aa</strong><span>Sample text</span></div>;
    }
    if (/bg|surface|hover|readonly|disabled/.test(name)) return <div class="sds-token-impact sds-token-impact--surface"><i style={{ background: value }} /><span style={{ background: value }} /></div>;
    return <div class="sds-token-impact sds-token-impact--colour"><i style={{ background: value }} /><span style={{ background: value }}>Action</span></div>;
  }
  if (/font|type|line-height/.test(name)) {
    const style = name.includes('weight') ? { fontWeight: value }
      : name.includes('line-height') ? { lineHeight: value }
        : name.includes('size') ? { fontSize: value } : { fontFamily: value };
    return <div class="sds-token-impact sds-token-impact--type" style={style}><strong>Aa</strong><span>Employee</span></div>;
  }
  if (name.startsWith('--space-')) return <div class="sds-token-impact sds-token-impact--spacing" style={{ gap: value }}><i /><i /><i /></div>;
  if (name.startsWith('--radius-')) return <div class="sds-token-impact sds-token-impact--radius"><span style={{ borderRadius: value }} /></div>;
  if (name.startsWith('--ui-control-')) {
    const style = name.includes('pad') ? { paddingInline: value } : { height: value };
    return <div class="sds-token-impact sds-token-impact--control"><span style={style}>Button</span></div>;
  }
  if (name.startsWith('--ui-icon-')) {
    const style = name.includes('stroke') ? undefined : { width: value, height: value };
    return <div class="sds-token-impact sds-token-impact--icon"><span style={style}><LucideIcon name="Sparkles" /></span><small>{value}</small></div>;
  }
  if (name.startsWith('--ui-motion-') || name.startsWith('--ui-ease-')) {
    const style = name.startsWith('--ui-motion-') ? { animationDuration: value } : { animationTimingFunction: value };
    return <div class="sds-token-impact sds-token-impact--motion"><i style={style} /><span /></div>;
  }
  return <div class="sds-token-impact sds-token-impact--measure"><span>{value}</span></div>;
}

function BrandFoundationPreview({ name, value }: { name: string; value: string }): VNode {
  const hover = name.endsWith('-dark') || name.endsWith('-light');
  const label = name.includes('gold') ? 'Highlight' : name.includes('blue') ? 'Accent' : hover ? 'Hover' : 'Brand';
  return <div class="sds-token-impact sds-token-impact--brand">
    <span class={hover ? 'is-hover' : ''} style={{ backgroundColor: value, borderColor: value }}>{label}</span>
    <i style={{ backgroundColor: value }} />
  </div>;
}

function previewVars(values: Record<string, string>): CSSProperties {
  return values;
}

function statusTone(name: string): BadgeTone {
  if (name.includes('danger')) return 'danger';
  if (name.includes('warning')) return 'warning';
  if (name.includes('success')) return 'success';
  if (name.includes('info')) return 'info';
  if (name.includes('purple')) return 'accent';
  return 'neutral';
}

function statusLabel(tone: BadgeTone): string {
  if (tone === 'danger') return 'Critical';
  if (tone === 'warning') return 'Pending';
  if (tone === 'success') return 'Approved';
  if (tone === 'info') return 'In progress';
  if (tone === 'accent') return 'In review';
  return 'Draft';
}

function cleanGroupLabel(label: string): string {
  return label.replace(/^Semantic\s*[—-]\s*/i, '');
}

function cleanTokenLabel(label: string): string {
  return label.replace(/\s*\([^)]*\)\s*$/, '').replace(/\s+[—-]\s+/g, ' · ');
}

function cleanHint(hint: string): string {
  if (/^defaults from\s+/i.test(hint)) return /not brand-driven/i.test(hint) ? 'System role' : 'Linked to brand theme';
  return hint;
}
