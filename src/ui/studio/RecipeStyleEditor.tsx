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
import { converter, formatHex, parse } from 'culori';
import { BackActionArtwork } from '../patterns/BackActionButton';
import { StudioSelect } from './StudioSelect';
import { StudioInspector, StudioInspectorBody } from './StudioInspector';

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

const THEME_TOKEN_LABELS: Record<string, string> = {
  '--ui-color-nav-background': 'Navigation background',
  '--ui-color-text-inverse': 'Text on brand colour',
  '--ui-color-primary': 'Primary brand colour',
  '--ui-color-surface': 'Page surface',
  '--ui-color-border': 'Default border',
};

function _readableTokenName(value: string): string | undefined {
  const token = cssVariableName(value) ?? (/^--[a-z0-9-]+$/i.test(value.trim()) ? value.trim() : undefined);
  if (!token) return undefined;
  return THEME_TOKEN_LABELS[token] ?? token
    .replace(/^--ui-/, '')
    .replace(/-/g, ' ')
    .replace(/^./, first => first.toUpperCase());
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
  /* Theme values can resolve to rgb()/hsl() as well as hex. Falling back to
     black for every non-hex value made the inspector misrepresent valid theme
     colours such as SIOMAC navy. */
  const parsedColor = parse(value);
  const pickerColor = parsedColor ? formatHex(parsedColor) : '#000000';
  const swatchColor = typeof CSS !== 'undefined' && CSS.supports('color', value) ? value : pickerColor;

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
        <span class="sds-color-trigger__swatch" style={{ backgroundColor: swatchColor }} />
        <span>{value}</span><span class="sds-color-trigger__chevron" aria-hidden="true"><LucideIcon name="ChevronDown" size={15} /></span>
      </button>
      {pickerOpen && portalHost && createPortal(
        <div ref={pickerRef} class="sds-color-picker" id={`picker-${id}`} role="group" aria-label={`${label} color picker`} style={pickerStyle}>
          <ColorPicker value={pickerColor} onChange={onChange} alpha savedColors={savedColors} savedColorsLabel="Saved colors"
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
                <StudioSelect class="sds-edit-field__unit" aria-label={`${control.label} unit`} value={size.unit}
                  onChange={event => studio.set(control.name, `${size.amount}${(event.target as HTMLSelectElement).value}`)}>
                  <option value="px">px</option><option value="rem">rem</option><option value="em">em</option><option value="%">%</option>
                </StudioSelect>
              </div>
          : <div class="sds-edit-field__control"><input id={`style-${control.name}`} type="text" value={value}
            onInput={event => studio.set(control.name, (event.target as HTMLInputElement).value)} /></div>
      ) : (
        <div class="sds-edit-field__theme">
          <span>Theme controlled</span>
        </div>
      )}
    </div>
  );
}

/** Schema-driven styling shared by every component editor. */
export function GeneratedStyleControls({ def, draft: studio }: { def: ComponentDef; draft: GalleryDraft }): VNode {
  const groups = def.style ?? [];
  const hoverControls = groups.flatMap(group => group.controls.filter(control => control.name.endsWith('-hover')));
  const standardGroups = groups.map(group => ({
    ...group,
    controls: group.controls.filter(control => !control.name.endsWith('-hover')),
  })).filter(group => group.controls.length > 0);
  return (
    <>
      {hoverControls.length > 0 && <section class="sds-style-hover-section">
        {hoverControls.map(control => <HoverColorControl key={control.name} control={control} studio={studio} />)}
      </section>}
      {standardGroups.map(group => (
        <section key={group.label}>
          <h4>{friendlyGroup(group.label)}</h4>
          {group.controls.map(control => <TokenControl key={control.name} control={control} studio={studio} />)}
        </section>
      ))}
    </>
  );
}

type HoverColorMode = 'automatic' | 'lighter' | 'darker' | 'manual';

const toRgb = converter('rgb');

function hoverBaseName(name: string): string {
  if (name.includes('-outline-bg-hover') || name.includes('-ghost-bg-hover')) return '--ui-color-surface-default';
  return name.replace(/-hover$/, '');
}

function automaticHoverDirection(value: string): 'lighter' | 'darker' {
  const color = toRgb(parse(value));
  if (!color) return 'lighter';
  const channel = (item: number): number => item <= 0.04045 ? item / 12.92 : ((item + 0.055) / 1.055) ** 2.4;
  const luminance = 0.2126 * channel(color.r) + 0.7152 * channel(color.g) + 0.0722 * channel(color.b);
  return luminance < 0.42 ? 'lighter' : 'darker';
}

function HoverColorControl({ control, studio }: { control: StyleControl; studio: GalleryDraft }): VNode {
  const value = studio.read(control.name);
  const baseName = hoverBaseName(control.name);
  const modeName = `${control.name}-mode`;
  const storedMode = studio.values[modeName];
  const mode: HoverColorMode = storedMode === 'automatic' || storedMode === 'lighter' || storedMode === 'darker' || storedMode === 'manual'
    ? storedMode
    : Object.prototype.hasOwnProperty.call(studio.values, control.name)
      ? value.includes('#fff') ? 'lighter' : value.includes('#000') ? 'darker' : 'manual'
      : 'automatic';
  const resolvedBase = resolveThemeValue(studio.read(baseName), studio);
  const autoDirection = automaticHoverDirection(resolvedBase);
  const expression = (direction: 'lighter' | 'darker'): string =>
    `color-mix(in srgb, var(${baseName}) 88%, ${direction === 'lighter' ? '#fff' : '#000'})`;
  const setMode = (next: HoverColorMode): void => {
    studio.set(modeName, next);
    if (next === 'automatic') studio.set(control.name, expression(autoDirection));
    else if (next === 'lighter') studio.set(control.name, expression('lighter'));
    else if (next === 'darker') studio.set(control.name, expression('darker'));
    else {
      const parsed = parse(resolveThemeValue(value, studio)) ?? parse(resolvedBase);
      studio.set(control.name, parsed ? formatHex(parsed) : '#1b2d54');
    }
  };

  useEffect(() => {
    if (storedMode !== 'automatic') return;
    const next = expression(autoDirection);
    if (studio.values[control.name] !== next) studio.set(control.name, next);
  }, [autoDirection, baseName, control.name, storedMode, studio]);

  return (
    <div class="sds-hover-color">
      <div class="sds-hover-color__head"><label>Hover color</label><span>Choose how the button responds when someone points to it.</span></div>
      <div class="sds-hover-color__modes" role="radiogroup" aria-label="Hover color behavior">
        {(['automatic', 'lighter', 'darker', 'manual'] as const).map(option => <button type="button" role="radio" aria-checked={mode === option}
          class={mode === option ? 'is-on' : ''} onClick={() => setMode(option)}>
            <strong>{option === 'automatic' ? 'Automatic' : option === 'manual' ? 'Custom' : friendly(option)}</strong>
            <small>{option === 'automatic' ? 'Best contrast' : option === 'lighter' ? 'Lift the color' : option === 'darker' ? 'Deepen the color' : 'Choose a color'}</small>
          </button>)}
      </div>
      {mode === 'manual'
        ? <TokenControl control={control} studio={studio} />
        : <div class="sds-hover-color__derived"><i style={{ background: value }} /><span>{mode === 'automatic' ? `Using the ${autoDirection} treatment for this background.` : `Always uses a ${mode} treatment.`}</span></div>}
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

export function IconPicker({ id, label, value, variant, position, recommendations: customRecommendations, allowClear = true, onChange }: {
  id: string;
  label: string;
  value: string;
  variant: CanonicalButtonVariant;
  position: 'leading' | 'trailing';
  recommendations?: readonly LucideName[];
  /** A dropdown affordance must always remain visible; content icons may be removed. */
  allowClear?: boolean;
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
        {allowClear && value !== 'None' && <button type="button" class="sds-icon-trigger__clear" aria-label={`Clear ${label}`} onClick={() => choose('None')}><LucideIcon name="X" size={13} /></button>}
        <button type="button" class="sds-icon-trigger__menu" aria-label={`Open ${label} menu`} aria-expanded={open} onClick={() => setOpen(value => !value)}><LucideIcon name="ChevronDown" size={14} /></button>
      </div>
      {open && (
        <div class="sds-icon-browser" role="group" aria-label={`${label} Lucide icon browser`}>
          <div class="sds-icon-browser__head"><div><strong>Choose an icon</strong><span>{LUCIDE_NAMES.length.toLocaleString()} Lucide icons</span></div></div>
          <label class="sds-icon-search"><span aria-hidden="true">⌕</span><input value={query} placeholder="Search icons…" aria-label="Search Lucide icons" onInput={event => { setQuery((event.target as HTMLInputElement).value); setVisibleCount(72); }} /></label>
          <section><h5>Recommended for {friendly(variant)}</h5><div class="sds-icon-grid sds-icon-grid--recommended">
            {allowClear && (
            <button type="button" aria-label="Use no icon" class={value === 'None' ? 'is-on' : ''} onClick={() => choose('None')}><span>—</span><small>None</small></button>
            )}
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
  const hoverControls = useMemo(() => target === 'primary'
    ? groups.flatMap(group => group.controls.filter(control => control.name.endsWith('-bg-hover')))
    : [], [groups, target]);
  const standardGroups = useMemo(() => groups.map(group => ({
    ...group,
    controls: group.controls.filter(control => !(target === 'primary' && control.name.endsWith('-bg-hover'))),
  })).filter(group => group.controls.length > 0), [groups, target]);
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
                    <span class="sds-button-picker__preview">
                      {variant === 'ghost'
                        ? <span class="ui-btn ui-btn--ghost ui-back-action-button" aria-hidden="true"><BackActionArtwork icon={String(variantPreview.iconLeft ?? 'ArrowLeft') === 'None' ? null : String(variantPreview.iconLeft ?? 'ArrowLeft') as LucideName} iconTreatment={String(variantPreview.iconTreatment ?? 'outline') as never} iconColor={String(variantPreview.iconColor ?? '#5e6f8d')} /></span>
                        : <span class={`ui-btn ui-btn--${variant}`} aria-hidden="true">{String(variantPreview.label ?? sample?.props.label ?? friendly(variant))}</span>}
                    </span>
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
            {(def.examples ?? []).map(example => <article key={example.id}><span class="ctx-kicker">{example.title}</span><div class="sds-use-context__spec">{example.render()}</div></article>)}
          </div>
        </section>

      </PreviewScope>

      <StudioInspector ariaLabel="Button settings" title={`Try the ${selectedSample?.title ?? friendly(target)} button`}>

        <section class="sds-button-settings__example" aria-labelledby="button-preview-title">
            <div class="sds-button-settings__example-head"><div><h4 id="button-preview-title">Preview options</h4><p>Only this {friendly(target).toLowerCase()} preview changes.</p></div><button type="button" onClick={() => setPreviewByVariant(previous => ({ ...previous, [target]: undefined }))}>Reset</button></div>
            <div class="sds-button-settings__state">
              <label for="button-state">State</label>
              <StudioSelect id="button-state" class="sds-ctl__input" value={state} onChange={event => setState((event.target as HTMLSelectElement).value as ButtonRecipeState)}>
                {BUTTON_STATES.map(item => <option value={item}>{friendly(item)}</option>)}
              </StudioSelect>
            </div>
        </section>

        <StudioInspectorBody>
          <section>
            <h4>Content</h4>
            <div class="sds-button-settings__example-icons">
              <div><span>Leading icon</span><IconPicker id={`leading-icon-${target}`} label="Leading icon" value={String(previewProps.iconLeft ?? 'None')} variant={target} position="leading" onChange={value => setPreviewProp('iconLeft', value)} /></div>
              <div><span>Trailing icon</span><IconPicker id={`trailing-icon-${target}`} label="Trailing icon" value={String(previewProps.iconRight ?? 'None')} variant={target} position="trailing" onChange={value => setPreviewProp('iconRight', value)} /></div>
            </div>
          </section>
          <section>
            <h4>Appearance</h4>
            {target === 'ghost' && <div class="sds-button-settings__icon-style"><span>Back content</span><div role="radiogroup" aria-label="Back content">
              <button type="button" role="radio" aria-checked={previewProps.iconLeft !== 'None'} class={previewProps.iconLeft !== 'None' ? 'is-on' : ''} onClick={() => setPreviewProp('iconLeft', previewProps.iconLeft === 'None' ? 'ArrowLeft' : String(previewProps.iconLeft ?? 'ArrowLeft'))}>Text + icon</button>
              <button type="button" role="radio" aria-checked={previewProps.iconLeft === 'None'} class={previewProps.iconLeft === 'None' ? 'is-on' : ''} onClick={() => setPreviewProp('iconLeft', 'None')}>Text only</button>
            </div></div>}
            <div class="sds-button-settings__icon-style"><span>Icon treatment</span><div role="radiogroup" aria-label="Icon treatment">{(['outline', 'circle', 'filled-circle'] as const).map(treatment => <button type="button" role="radio" aria-checked={previewProps.iconTreatment === treatment} class={previewProps.iconTreatment === treatment ? 'is-on' : ''} onClick={() => setPreviewProp('iconTreatment', treatment)}>{target === 'ghost' ? treatment === 'outline' ? 'Plain' : treatment === 'circle' ? 'Outline circle' : 'Filled circle' : friendly(treatment)}</button>)}</div></div>
            <div class="sds-button-settings__icon-color"><span>Icon color</span><StudioColorControl id={`preview-icon-color-${target}`} label="Icon" value={String(previewProps.iconColor ?? '#1b2d54')} savedColors={studio.savedColors}
              onSaveColor={studio.addSavedColor} onRemoveSavedColor={studio.removeSavedColor} onChange={value => setPreviewProp('iconColor', value)} /></div>
          </section>
          <details class="sds-button-settings__style">
            <summary><span><strong>Component style</strong><small>Shape, colours and interaction states</small></span><em>{groups.reduce((total, group) => total + group.controls.length, 0)} settings</em></summary>
            <div>
              {hoverControls.length > 0 && <section class="sds-style-hover-section">
                {hoverControls.map(control => <HoverColorControl key={control.name} control={control} studio={studio} />)}
              </section>}
              {standardGroups.length ? standardGroups.map(group => (
                <section key={group.label}><h4>{friendlyGroup(group.label)}</h4>{group.controls
                  .map(control => <TokenControl key={control.name} control={control} studio={studio} />)}</section>
              )) : <div class="sds-button-settings__empty"><strong>This state uses the default style</strong><p>There is nothing extra to change here.</p></div>}
            </div>
          </details>
        </StudioInspectorBody>

        <p class="sds-button-settings__inherit">Dropdown and Split Button use these styles automatically.</p>
      </StudioInspector>
    </section>
  );
}
