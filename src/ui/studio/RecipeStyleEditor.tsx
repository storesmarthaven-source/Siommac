import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { propsForVariant, type ComponentDef, type PropValues, type StyleControl } from '../registry';
import { type GalleryDraft } from '../gallery/galleryStore';
import {
  BUTTON_STATES, BUTTON_VARIANTS, type ButtonRecipeState, type CanonicalButtonVariant,
} from '../../../types/designSystem';
import { PreviewScope } from './PreviewScope';
import { LUCIDE_NAMES, LucideIcon, type LucideName } from '../LucideIcon';

type Target = CanonicalButtonVariant;

const COLOR_SWATCHES = ['#1b2d54', '#2f4a7d', '#2563eb', '#0f766e', '#15803d', '#d97706', '#dc2626', '#7c3aed', '#111827', '#64748b', '#e2e8f0', '#ffffff'] as const;

interface HslColor { h: number; s: number; l: number }

function hexToHsl(hex: string): HslColor {
  const clean = /^#[0-9a-f]{6}$/i.test(hex) ? hex.slice(1) : '000000';
  const [r, g, b] = [0, 2, 4].map(index => parseInt(clean.slice(index, index + 2), 16) / 255) as [number, number, number];
  const max = Math.max(r, g, b); const min = Math.min(r, g, b); const delta = max - min;
  let h = 0;
  if (delta) {
    if (max === r) h = 60 * (((g - b) / delta) % 6);
    else if (max === g) h = 60 * (((b - r) / delta) + 2);
    else h = 60 * (((r - g) / delta) + 4);
  }
  const l = (max + min) / 2;
  const s = delta === 0 ? 0 : delta / (1 - Math.abs(2 * l - 1));
  return { h: Math.round((h + 360) % 360), s: Math.round(s * 100), l: Math.round(l * 100) };
}

function hslToHex({ h, s, l }: HslColor): string {
  const saturation = s / 100; const lightness = l / 100;
  const chroma = (1 - Math.abs(2 * lightness - 1)) * saturation;
  const x = chroma * (1 - Math.abs(((h / 60) % 2) - 1));
  const offset = lightness - chroma / 2;
  let channels: [number, number, number];
  if (h < 60) channels = [chroma, x, 0]; else if (h < 120) channels = [x, chroma, 0];
  else if (h < 180) channels = [0, chroma, x]; else if (h < 240) channels = [0, x, chroma];
  else if (h < 300) channels = [x, 0, chroma]; else channels = [chroma, 0, x];
  return `#${channels.map(channel => Math.round((channel + offset) * 255).toString(16).padStart(2, '0')).join('')}`;
}

function friendly(value: string): string {
  return value.replace(/[-_]/g, ' ').replace(/^./, first => first.toUpperCase());
}

function friendlyGroup(value: string): string {
  if (value === 'Geometry') return 'Size and shape';
  if (value === 'Interaction states') return 'States';
  if (value === 'Danger, link & toggle') return 'Special styles';
  return value;
}

function belongs(control: StyleControl, target: Target, state: ButtonRecipeState): boolean {
  const prefix = `--ui-button-${target}-`;
  if (state === 'default') return control.name.startsWith(prefix) && !control.state && !control.name.includes('-hover') && !control.name.includes('-active');
  if (state === 'hover' || state === 'active') return control.name.startsWith(prefix) && control.name.includes(`-${state}`);
  return control.name.startsWith(prefix) && control.state === state;
}

const SIZE_FALLBACKS: Readonly<Record<string, string>> = {
  '--ui-button-height-md': '40px',
  '--ui-button-pad-x-md': '14px',
  '--ui-button-radius': '8px',
  '--ui-button-border-width': '1px',
  '--ui-button-gap': '8px',
  '--ui-button-icon-size': '16px',
  '--ui-button-font-size-md': '13px',
  '--ui-button-focus-ring-width': '3px',
};

type SizeUnit = 'px' | 'rem' | 'em' | '%';
interface SizeValue { amount: string; unit: SizeUnit }

function cssVariableName(value: string): string | undefined {
  return /^var\(\s*(--[^,\s)]+)(?:\s*,[^)]*)?\s*\)$/.exec(value.trim())?.[1];
}

function resolveThemeValue(value: string, studio: GalleryDraft): string {
  let resolved = value;
  const visited = new Set<string>();

  for (let depth = 0; depth < 6; depth += 1) {
    const token = cssVariableName(resolved);
    if (!token || visited.has(token)) break;
    visited.add(token);
    const next = studio.read(token);
    resolved = next.length > 0 && next !== resolved ? next : (SIZE_FALLBACKS[token] ?? resolved);
  }

  return resolved;
}

function parseSizeValue(value: string): SizeValue {
  const match = /^(-?\d*\.?\d+)\s*(px|rem|em|%)$/.exec(value.trim());
  return match
    ? { amount: match[1] ?? '0', unit: (match[2] ?? 'px') as SizeUnit }
    : { amount: '0', unit: 'px' };
}

function readableThemeValue(value: string, kind: StyleControl['kind']): string {
  if (kind !== 'size') return value;
  const size = parseSizeValue(value);
  return `${size.amount} ${size.unit}`;
}

export function StudioColorControl({ id, label, value, onChange }: { id: string; label: string; value: string; onChange: (value: string) => void }): VNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  const displayColor = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';
  const hsl = hexToHsl(displayColor);

  return (
    <div class="sds-edit-field__control sds-edit-field__control--color">
      <button type="button" class="sds-color-trigger" aria-label={`Choose ${label} color`} aria-expanded={pickerOpen}
        aria-controls={`picker-${id}`} onClick={() => setPickerOpen(open => !open)}>
        <span class="sds-color-trigger__swatch" style={{ backgroundColor: displayColor }} />
        <span>{value}</span><span aria-hidden="true">⌄</span>
      </button>
      {pickerOpen && (
        <div class="sds-color-picker" id={`picker-${id}`} role="group" aria-label={`${label} color picker`}>
          <div class="sds-color-picker__swatches" aria-label="Suggested colors">
            {COLOR_SWATCHES.map(color => <button type="button" key={color} aria-label={`Set color to ${color}`} aria-pressed={displayColor.toLowerCase() === color}
              style={{ backgroundColor: color }} onClick={() => onChange(color)} />)}
          </div>
          <label class="sds-color-picker__native"><span>Pick any color</span><input type="color" value={displayColor}
            aria-label={`Pick custom ${label} color`} onInput={event => onChange((event.target as HTMLInputElement).value)}
            onChange={event => onChange((event.target as HTMLInputElement).value)} /></label>
          <label class="sds-color-picker__hex"><span>Hex</span><input id={id} value={value}
            onInput={event => onChange((event.target as HTMLInputElement).value)} /></label>
          <div class="sds-color-picker__sliders">
            <label><span>Hue <b>{hsl.h}°</b></span><input class="is-hue" type="range" min="0" max="360" value={hsl.h}
              onInput={event => onChange(hslToHex({ ...hsl, h: Number((event.target as HTMLInputElement).value) }))} /></label>
            <label><span>Saturation <b>{hsl.s}%</b></span><input type="range" min="0" max="100" value={hsl.s}
              onInput={event => onChange(hslToHex({ ...hsl, s: Number((event.target as HTMLInputElement).value) }))} /></label>
            <label><span>Lightness <b>{hsl.l}%</b></span><input type="range" min="0" max="100" value={hsl.l}
              onInput={event => onChange(hslToHex({ ...hsl, l: Number((event.target as HTMLInputElement).value) }))} /></label>
          </div>
        </div>
      )}
    </div>
  );
}

function TokenControl({ control, studio }: { control: StyleControl; studio: GalleryDraft }): VNode {
  const custom = Object.prototype.hasOwnProperty.call(studio.values, control.name);
  const read = studio.read(control.name);
  const linkedValue = resolveThemeValue(control.linkedTo ?? read, studio);
  const value = custom ? read : linkedValue;
  const isColor = control.kind.startsWith('color');
  const size = parseSizeValue(value);

  return (
    <div class="sds-edit-field">
      <div class="sds-edit-field__head">
        <label for={`style-${control.name}`}>{control.label}</label>
        <label class="sds-theme-switch">
          <input type="checkbox" checked={!custom} onChange={() => {
            if (custom) studio.link(control.name, control.linkedTo ?? 'initial');
            else studio.set(control.name, linkedValue.length > 0 ? linkedValue : 'initial');
          }} />
          <span>Use brand theme</span>
        </label>
      </div>
      {custom ? (
        isColor
          ? <StudioColorControl id={`style-${control.name}`} label={control.label} value={value} onChange={next => studio.set(control.name, next)} />
          : control.kind === 'size'
            ? <div class="sds-edit-field__control sds-size-control">
                <input id={`style-${control.name}`} type="number" min="0" step="0.5" value={size.amount}
                  aria-label={`${control.label} value`}
                  onInput={event => studio.set(control.name, `${(event.target as HTMLInputElement).value}${size.unit}`)} />
                <select aria-label={`${control.label} unit`} value={size.unit}
                  onChange={event => studio.set(control.name, `${size.amount}${(event.target as HTMLSelectElement).value}`)}>
                  <option value="px">px</option><option value="rem">rem</option><option value="em">em</option><option value="%">%</option>
                </select>
              </div>
          : <div class="sds-edit-field__control"><input id={`style-${control.name}`} type="text" value={value}
            onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} /></div>
      ) : (
        <div class="sds-edit-field__theme">
          <span>From brand theme</span>
          <strong class={isColor ? 'is-color' : ''}>
            {isColor && value.length > 0 ? <i aria-hidden="true" style={{ backgroundColor: value }} /> : null}
            <em>{value.length > 0 ? readableThemeValue(value, control.kind) : 'Brand default'}</em>
          </strong>
        </div>
      )}
    </div>
  );
}

const ICON_RECOMMENDATIONS: Record<CanonicalButtonVariant, readonly LucideName[]> = {
  primary: ['ArrowRight', 'Check', 'Plus', 'Send'],
  secondary: ['X', 'ArrowLeft', 'RotateCcw', 'Eye'],
  outline: ['Eye', 'Download', 'Pencil', 'ExternalLink'],
  ghost: ['ArrowLeft', 'ChevronLeft', 'X', 'MoreHorizontal'],
  danger: ['Trash2', 'AlertTriangle', 'Ban', 'X'],
  link: ['ArrowRight', 'ExternalLink', 'Link', 'ChevronRight'],
};

export function IconPicker({ id, label, value, variant, position, recommendations: customRecommendations, onChange }: {
  id: string;
  label: string;
  value: string;
  variant: CanonicalButtonVariant;
  position: 'leading' | 'trailing';
  recommendations?: readonly LucideName[];
  onChange: (value: string) => void;
}): VNode {
  const [open, setOpen] = useState(false);
  const [query, setQuery] = useState('');
  const [visibleCount, setVisibleCount] = useState(72);
  const baseRecommendations = customRecommendations ?? ICON_RECOMMENDATIONS[variant];
  const recommendations = position === 'trailing'
    ? [...baseRecommendations].sort(name => /Right|External|Chevron/.test(name) ? -1 : 1)
    : baseRecommendations;
  const normalized = query.trim().toLowerCase();
  const matches = normalized.length > 0
    ? LUCIDE_NAMES.filter(name => name.toLowerCase().includes(normalized))
    : LUCIDE_NAMES;
  const visible = matches.slice(0, visibleCount);

  const choose = (name: string): void => { onChange(name); setOpen(false); };

  return (
    <div class="sds-icon-picker">
      <div class="sds-icon-trigger">
        <button id={id} type="button" class="sds-icon-trigger__main" aria-label={`Choose ${label}`} aria-expanded={open} onClick={() => setOpen(value => !value)}>
          <span class="sds-icon-trigger__preview">{value === 'None' ? '—' : <LucideIcon name={value as LucideName} size={16} />}</span>
          <span>{value === 'None' ? 'No icon' : friendly(value)}</span>
        </button>
        {value !== 'None' && <button type="button" class="sds-icon-trigger__clear" aria-label={`Clear ${label}`} onClick={() => choose('None')}><LucideIcon name="X" size={13} /></button>}
        <button type="button" class="sds-icon-trigger__menu" aria-label={`Open ${label} menu`} aria-expanded={open} onClick={() => setOpen(value => !value)}><LucideIcon name="ChevronDown" size={14} /></button>
      </div>
      {open && (
        <div class="sds-icon-browser" role="group" aria-label={`${label} Lucide icon browser`}>
          <div class="sds-icon-browser__head"><div><strong>Choose an icon</strong><span>{LUCIDE_NAMES.length.toLocaleString()} Lucide icons</span></div><button type="button" onClick={() => setOpen(false)} aria-label="Close icon browser">×</button></div>
          <label class="sds-icon-search"><span aria-hidden="true">⌕</span><input value={query} placeholder="Search icons…" aria-label="Search Lucide icons" onInput={event => { setQuery((event.target as HTMLInputElement).value); setVisibleCount(72); }} /></label>
          <section><h5>Recommended for {friendly(variant)}</h5><div class="sds-icon-grid sds-icon-grid--recommended">
            <button type="button" aria-label="Use no icon" class={value === 'None' ? 'is-on' : ''} onClick={() => choose('None')}><span>—</span><small>None</small></button>
            {recommendations.map(name => <button type="button" key={name} aria-label={`Use recommended ${name}`} class={value === name ? 'is-on' : ''} onClick={() => choose(name)}><LucideIcon name={name} size={18} /><small>{friendly(name)}</small></button>)}
          </div></section>
          <section><h5>{normalized ? `${matches.length} results` : 'All icons'}</h5><div class="sds-icon-grid">
            {visible.map(name => <button type="button" key={name} aria-label={`Choose ${name}`} class={value === name ? 'is-on' : ''} onClick={() => choose(name)}><LucideIcon name={name} size={18} /><small>{friendly(name)}</small></button>)}
          </div>{visible.length < matches.length && <button type="button" class="sds-icon-more" onClick={() => setVisibleCount(count => count + 72)}>Load more</button>}</section>
        </div>
      )}
    </div>
  );
}

export function RecipeStyleEditor({ def, draft: studio }: { def: ComponentDef; draft: GalleryDraft }): VNode {
  const [target, setTarget] = useState<Target>('primary');
  const [state, setState] = useState<ButtonRecipeState>('default');
  const [previewByVariant, setPreviewByVariant] = useState<Partial<Record<CanonicalButtonVariant, PropValues>>>({});
  const groups = useMemo(() => (def.style ?? []).map(group => ({
    ...group,
    controls: group.controls.filter(control => belongs(control, target, state)),
  })).filter(group => group.controls.length > 0), [def, target, state]);
  const selectedSample = def.variantSamples?.find(sample => sample.value === target);
  const previewPropsFor = (variant: CanonicalButtonVariant): PropValues => ({
    ...propsForVariant(def, variant),
    ...(previewByVariant[variant] ?? {}),
  });
  const previewProps = previewPropsFor(target);

  const setPreviewProp = (name: string, value: string): void => {
    setPreviewByVariant(previous => ({
      ...previous,
      [target]: { ...(previous[target] ?? {}), [name]: value },
    }));
  };

  return (
    <section class="sds-button-editor" aria-label="Button editor">
      <div class="sds-button-editor__main">
        <PreviewScope class="sds-button-preview sds-button-preview--with-variants" attach={studio.attachScope}>
          <header><div><span>Live preview</span><strong>{selectedSample?.title ?? friendly(target)} button</strong></div><small>Updates instantly</small></header>
          <div class="sds-button-preview__single">
            {def.render?.(previewProps, state === 'default' ? 'default' : state)}
          </div>
          <section class="sds-button-preview__variants" aria-labelledby="button-variants-title">
            <header class="sds-button-editor__intro">
              <div><h3 id="button-variants-title">Variants</h3><p>Select a style to preview and edit it.</p></div>
            </header>
            <div class="sds-button-picker" role="radiogroup" aria-label="Button to edit">
              {BUTTON_VARIANTS.map(variant => {
                const sample = def.variantSamples?.find(item => item.value === variant);
                const variantPreview = previewPropsFor(variant);
                return (
                  <button type="button" role="radio" aria-checked={target === variant} class={target === variant ? 'is-on' : ''}
                    onClick={() => { setTarget(variant); setState('default'); }}>
                    <span class="sds-button-picker__preview"><span class={`ui-btn ui-btn--${variant}`} aria-hidden="true">{String(variantPreview.label ?? sample?.props.label ?? friendly(variant))}</span></span>
                    <span class="sds-button-picker__copy"><strong>{sample?.title ?? friendly(variant)}</strong></span>
                  </button>
                );
              })}
            </div>
          </section>
        </PreviewScope>

        <section class="sds-button-use" aria-labelledby="button-use-title">
          <header><h3 id="button-use-title">Common application use</h3><p>Real examples of how these variants work together in SIOMAC.</p></header>
          <div class="sds-use-context">
            {(def.examples ?? []).map(example => <article key={example.id}><span class="ctx-kicker">{example.title}</span><div>{example.render()}</div></article>)}
          </div>
        </section>

      </div>

      <aside class="sds-button-settings" aria-label="Button settings">
        <header class="sds-button-settings__head">
          <div><span>Preview settings</span><strong>Try the {selectedSample?.title ?? friendly(target)} button</strong></div>
        </header>

        <section class="sds-button-settings__example" aria-labelledby="button-preview-title">
            <div class="sds-button-settings__example-head"><div><h4 id="button-preview-title">Preview options</h4><p>Try states and icons without changing the app.</p></div><button type="button" onClick={() => setPreviewByVariant(previous => ({ ...previous, [target]: undefined }))}>Reset</button></div>
            <div class="sds-button-settings__state">
              <label for="button-state">State</label>
              <select id="button-state" value={state} onChange={event => setState((event.target as HTMLSelectElement).value as ButtonRecipeState)}>
                {BUTTON_STATES.map(item => <option value={item}>{friendly(item)}</option>)}
              </select>
            </div>
            <div class="sds-button-settings__example-icons">
              <div><span>Leading icon</span><IconPicker id={`leading-icon-${target}`} label="Leading icon" value={String(previewProps.iconLeft ?? 'None')} variant={target} position="leading" onChange={value => setPreviewProp('iconLeft', value)} /></div>
              <div><span>Trailing icon</span><IconPicker id={`trailing-icon-${target}`} label="Trailing icon" value={String(previewProps.iconRight ?? 'None')} variant={target} position="trailing" onChange={value => setPreviewProp('iconRight', value)} /></div>
            </div>
            <div class="sds-button-settings__icon-style"><span>Icon treatment</span><div role="radiogroup" aria-label="Icon treatment">{(['outline', 'circle', 'filled-circle'] as const).map(treatment => <button type="button" role="radio" aria-checked={previewProps.iconTreatment === treatment} class={previewProps.iconTreatment === treatment ? 'is-on' : ''} onClick={() => setPreviewProp('iconTreatment', treatment)}>{friendly(treatment)}</button>)}</div></div>
            <div class="sds-button-settings__icon-color"><span>Icon color</span><StudioColorControl id={`preview-icon-color-${target}`} label="Icon" value={String(previewProps.iconColor ?? '#1b2d54')} onChange={value => setPreviewProp('iconColor', value)} /></div>
        </section>

        <div class="sds-button-settings__body">
          {groups.length ? groups.map(group => (
            <section key={group.label}><h4>{friendlyGroup(group.label)}</h4>{group.controls.map(control => <TokenControl key={control.name} control={control} studio={studio} />)}</section>
          )) : <div class="sds-button-settings__empty"><strong>This state uses the default style</strong><p>There is nothing extra to change here.</p></div>}
        </div>

        <p class="sds-button-settings__inherit">Dropdown and Split Button use these styles automatically.</p>
      </aside>
    </section>
  );
}
