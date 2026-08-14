import { type CSSProperties, type VNode } from 'preact';
import { createPortal } from 'preact/compat';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { propsForVariant, type ComponentDef, type PropValues, type StyleControl } from '../registry';
import { type GalleryDraft } from '../gallery/galleryStore';
import {
  BUTTON_STATES, BUTTON_VARIANTS, type ButtonRecipeState, type CanonicalButtonVariant,
} from '../../../types/designSystem';
import { PreviewScope } from './PreviewScope';
import { LUCIDE_NAMES, LucideIcon, type LucideName } from '../LucideIcon';
import { ColorPicker } from '../forms/ColorPicker';

type Target = CanonicalButtonVariant;

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

export function StudioColorControl({ id, label, value, savedColors = [], onChange, onSaveColor, onRemoveSavedColor }: {
  id: string; label: string; value: string; savedColors?: readonly string[];
  onChange: (value: string) => void; onSaveColor?: (color: string) => void; onRemoveSavedColor?: (color: string) => void;
}): VNode {
  const [pickerOpen, setPickerOpen] = useState(false);
  const triggerRef = useRef<HTMLButtonElement>(null);
  const pickerRef = useRef<HTMLDivElement>(null);
  const [pickerStyle, setPickerStyle] = useState<CSSProperties>({});
  const [portalHost, setPortalHost] = useState<Element | null>(null);
  const displayColor = /^#[0-9a-f]{6}$/i.test(value) ? value : '#000000';

  useEffect(() => {
    setPortalHost(triggerRef.current?.closest('.sds') ?? document.body);
  }, []);

  useEffect(() => {
    if (!pickerOpen) return;
    const position = (): void => {
      const anchor = triggerRef.current?.getBoundingClientRect();
      if (!anchor) return;
      const gap = 7;
      const edge = 12;
      const width = Math.min(286, window.innerWidth - edge * 2);
      const below = window.innerHeight - anchor.bottom - edge - gap;
      const above = anchor.top - edge - gap;
      const desiredHeight = 320;
      const flip = below < desiredHeight && above > below;
      const maxHeight = Math.max(220, Math.min(desiredHeight, flip ? above : below));
      const left = Math.min(window.innerWidth - width - edge, Math.max(edge, anchor.right - width));
      const top = flip ? Math.max(edge, anchor.top - maxHeight - gap) : anchor.bottom + gap;
      setPickerStyle({ width: `${width}px`, maxHeight: `${maxHeight}px`, left: `${left}px`, top: `${top}px` });
    };
    const closeOnOutside = (event: PointerEvent): void => {
      const target = event.target as Node;
      if (!triggerRef.current?.contains(target) && !pickerRef.current?.contains(target)) setPickerOpen(false);
    };
    const closeOnEscape = (event: KeyboardEvent): void => {
      if (event.key !== 'Escape') return;
      setPickerOpen(false);
      triggerRef.current?.focus();
    };
    position();
    window.addEventListener('resize', position);
    document.addEventListener('scroll', position, true);
    document.addEventListener('pointerdown', closeOnOutside, true);
    document.addEventListener('keydown', closeOnEscape, true);
    return () => {
      window.removeEventListener('resize', position);
      document.removeEventListener('scroll', position, true);
      document.removeEventListener('pointerdown', closeOnOutside, true);
      document.removeEventListener('keydown', closeOnEscape, true);
    };
  }, [pickerOpen]);

  return (
    <div class="sds-edit-field__control sds-edit-field__control--color">
      <button ref={triggerRef} type="button" class="sds-color-trigger" aria-label={`Choose ${label} color`} aria-expanded={pickerOpen}
        aria-controls={`picker-${id}`} onClick={() => setPickerOpen(open => !open)}>
        <span class="sds-color-trigger__swatch" style={{ backgroundColor: displayColor }} />
        <span>{value}</span><span aria-hidden="true">⌄</span>
      </button>
      {pickerOpen && portalHost && createPortal(
        <div ref={pickerRef} class="sds-color-picker" id={`picker-${id}`} role="group" aria-label={`${label} color picker`} style={pickerStyle}>
          <ColorPicker value={displayColor} onChange={onChange} alpha savedColors={savedColors} savedColorsLabel="Saved colors"
            onSaveColor={onSaveColor} onRemoveSavedColor={onRemoveSavedColor} aria-label={`${label} color controls`} />
        </div>, portalHost,
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
          ? <StudioColorControl id={`style-${control.name}`} label={control.label} value={value} savedColors={studio.savedColors}
              onSaveColor={studio.addSavedColor} onRemoveSavedColor={studio.removeSavedColor} onChange={next => studio.set(control.name, next)} />
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

type HoverColorMode = 'lighter' | 'darker' | 'manual';

function HoverColorControl({ control, studio }: { control: StyleControl; studio: GalleryDraft }): VNode {
  const value = studio.read(control.name);
  const baseName = control.name.replace(/-hover$/, '');
  const mode: HoverColorMode = value.includes('#fff') ? 'lighter' : value.includes('#000') ? 'darker' : 'manual';
  const setMode = (next: HoverColorMode): void => {
    if (next === 'lighter') studio.set(control.name, `color-mix(in srgb, var(${baseName}) 88%, #fff)`);
    else if (next === 'darker') studio.set(control.name, `color-mix(in srgb, var(${baseName}) 88%, #000)`);
    else {
      const resolved = resolveThemeValue(value, studio);
      studio.set(control.name, /^#[0-9a-f]{6}$/i.test(resolved) ? resolved : '#162646');
    }
  };

  return (
    <div class="sds-hover-color">
      <div class="sds-hover-color__head"><label>Hover color behavior</label><span>Follows this variant’s background</span></div>
      <div class="sds-hover-color__modes" role="radiogroup" aria-label="Hover color behavior">
        {(['lighter', 'darker', 'manual'] as const).map(option => <button type="button" role="radio" aria-checked={mode === option}
          class={mode === option ? 'is-on' : ''} onClick={() => setMode(option)}>{friendly(option)}</button>)}
      </div>
      {mode === 'manual'
        ? <TokenControl control={control} studio={studio} />
        : <div class="sds-hover-color__derived"><i style={{ background: value }} /><span>Automatically updates when the background changes.</span></div>}
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
      <PreviewScope class="sds-button-editor__main" attach={studio.attachScope}>
        <section class="sds-button-preview sds-button-preview--with-variants">
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
        </section>

        <section class="sds-button-use" aria-labelledby="button-use-title">
          <header><h3 id="button-use-title">Common application use</h3><p>Real examples of how this control appears in SIOMAC.</p></header>
          <div class="sds-use-context">
            {(def.examples ?? []).map(example => <article key={example.id}><span class="ctx-kicker">{example.title}</span><div>{example.render()}</div></article>)}
          </div>
        </section>

      </PreviewScope>

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
            <div class="sds-button-settings__icon-color"><span>Icon color</span><StudioColorControl id={`preview-icon-color-${target}`} label="Icon" value={String(previewProps.iconColor ?? '#1b2d54')} savedColors={studio.savedColors}
              onSaveColor={studio.addSavedColor} onRemoveSavedColor={studio.removeSavedColor} onChange={value => setPreviewProp('iconColor', value)} /></div>
        </section>

        <div class="sds-button-settings__body">
          {groups.length ? groups.map(group => (
            <section key={group.label}><h4>{friendlyGroup(group.label)}</h4>{group.controls.map(control => control.name.endsWith('-bg-hover')
              ? <HoverColorControl key={control.name} control={control} studio={studio} />
              : <TokenControl key={control.name} control={control} studio={studio} />)}</section>
          )) : <div class="sds-button-settings__empty"><strong>This state uses the default style</strong><p>There is nothing extra to change here.</p></div>}
        </div>

        <p class="sds-button-settings__inherit">Dropdown and Split Button use these styles automatically.</p>
      </aside>
    </section>
  );
}
