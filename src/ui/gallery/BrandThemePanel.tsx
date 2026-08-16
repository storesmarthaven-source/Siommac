/**
 * src/ui/gallery/BrandThemePanel.tsx — UI Kit ▸ Foundations ▸ Brand Theme.
 *
 * The logo-driven theming workspace:
 *
 *   Logo → palette extraction → primary/accent seeds → tonal scales →
 *   semantic mapping → contrast validation → DRAFT PREVIEW → Apply/Publish
 *
 * Two things it deliberately does NOT do:
 *
 * 1. It does not persist anything of its own. Generated values are written into
 *    the existing gallery draft, so they land on `[data-ui-preview-scope]` and
 *    reach `:root` + `app_theme` only through the Apply that already exists.
 *    There is no second theme store to keep in sync.
 * 2. It does not preview with mock components. The specimens below are the real
 *    canonical Button, TextInput, Badge, Card and Tabs. A mock would be styled
 *    by the panel's own CSS and could show a theme working that does not.
 *
 *    The one exception is the navigation strip, and it is labelled as such: the
 *    app rail has no canonical component yet (it is rebuilt from the chosen
 *    primitives in a later phase), so its block demonstrates the nav ROLES
 *    directly. Rendering a fake sidebar and calling it a component preview would
 *    be the dishonest option.
 */

import { type VNode } from 'preact';
import { useCallback, useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { TextInput } from '../primitives/TextInput';
import { Badge } from '../primitives/Badge';
import { Card, CardHeader } from '../containers/Card/Card';
import { Tabs } from '../navigation/Tabs';
import { Select } from '../forms/Select';
import { DataTable } from '../data/DataTable';
import { Dialog } from '../overlays/Dialog';
import { type GalleryDraft } from './galleryStore';
import { decodeImage, extractSeeds, fileToDataUrl } from '../theme/brand/palette';
import { TONAL_STEPS } from '../theme/brand/tonal';
import {
  brandThemeToTokens, brandTokenNames, brandThemeFromTokens, isDistinctAccent,
  NEUTRAL_BY_POLICY, SEED_PRIMARY_TOKEN, SEED_ACCENT_TOKEN, type BrandSeeds,
} from '../theme/brand/brandTheme';
import { evaluatePairings, publishBlocked, type PairingResult } from '../theme/brand/contrast';
import { SEMANTIC_GROUPS, semanticRolesIn } from '../theme/semanticTokens';
import './brandTheme.css';
import './professionalTheme.css';

/** Seeds used when nothing has been extracted yet — the current SIOMAC brand. */
const DEFAULT_SEEDS: BrandSeeds = { primary: '#1b2d54', accent: '#E40C0C' };
/** Roles the engine may emit; anything else it writes is a policy bug. */


export interface BrandThemePanelProps {
  draft: GalleryDraft;
  /** The company logo already on file, if any. */
  logoUrl?: string | null;
  /** Persist a new company logo. Injected so the panel owns no transport. */
  onUploadLogo?: (dataUrl: string) => Promise<string>;
}

export function BrandThemePanel({ draft, logoUrl, onUploadLogo }: BrandThemePanelProps): VNode {
  /* Seeds come from the draft when a brand is already drafted or published, so
     reopening the panel shows the theme in force rather than resetting to
     SIOMAC red and silently offering to overwrite the customer's brand. */
  const publishedSeeds = brandThemeFromTokens({
    [SEED_PRIMARY_TOKEN]: draft.read(SEED_PRIMARY_TOKEN),
    [SEED_ACCENT_TOKEN]:  draft.read(SEED_ACCENT_TOKEN),
  })?.seeds;

  const [seeds, setSeeds]         = useState<BrandSeeds>(publishedSeeds ?? DEFAULT_SEEDS);
  const [candidates, setCandidates] = useState<string[]>([]);
  const [previewLogo, setPreviewLogo] = useState<string | null>(logoUrl ?? null);
  const [pendingFile, setPendingFile] = useState<{ name: string; dataUrl: string } | null>(null);
  const [busy, setBusy]           = useState<'extracting' | 'uploading' | null>(null);
  const [error, setError]         = useState<string | null>(null);

  const built = useMemo(() => brandThemeToTokens(seeds), [seeds]);
  const accentIsDistinct = isDistinctAccent(seeds.primary, seeds.accent);

  /* The seeds are mirrored in a ref because `apply` takes a PATCH and must
     merge it into the newest value. Reading `seeds` from the closure instead
     meant that setting the accent immediately after the primary merged into the
     PRE-primary seeds and silently reverted it — two edits in one tick, one
     surviving. Browser-caught; the unit test now pins it. */
  const seedsRef = useRef(seeds);

  /**
   * Merge a seed patch and write the whole generated map into the draft.
   *
   * `accent: undefined` in the patch CLEARS the accent — spreading it over the
   * previous value is what makes 'no second brand colour' expressible at all.
   */
  const apply = useCallback((patch: Partial<BrandSeeds>) => {
    const next: BrandSeeds = { ...seedsRef.current, ...patch };
    if ('accent' in patch && patch.accent === undefined) delete next.accent;
    seedsRef.current = next;
    setSeeds(next);
    const { tokens } = brandThemeToTokens(next);
    /* REPLACE, don't merge. A single-colour brand emits no accent scale and no
       accent seed; merging left the previous brand's accent in the draft, where
       `brandThemeFromTokens` would resurrect it on the next mount and the stale
       colour kept driving links, selection and the nav indicator. */
    draft.replaceGroup(brandTokenNames(), tokens);
  }, [draft]);

  const extractFrom = useCallback(async (src: Blob | string) => {
    setBusy('extracting');
    setError(null);
    try {
      const found = extractSeeds(await decodeImage(src));
      if (found.length === 0) {
        setError('That image has no colour to theme from — it reads as greyscale or fully transparent.');
        setCandidates([]);
        return;
      }
      setCandidates(found);
      // Two distinct seeds when the mark offers them; a single-colour logo uses
      // its one colour for both rather than inventing a second hue.
      // A second colour only becomes the accent if it is genuinely distinct;
      // the engine re-checks, and `undefined` means 'the logo had one colour'.
      apply({ primary: found[0]!, accent: found[1] });
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not read that image.');
    } finally {
      setBusy(null);
    }
  }, [apply]);

  const onFile = useCallback(async (file: File) => {
    const dataUrl = await fileToDataUrl(file);
    setPendingFile({ name: file.name, dataUrl });
    setPreviewLogo(dataUrl);
    await extractFrom(dataUrl);
  }, [extractFrom]);

  const saveLogo = useCallback(async () => {
    if (!pendingFile || !onUploadLogo) return;
    setBusy('uploading');
    setError(null);
    try {
      const url = await onUploadLogo(pendingFile.dataUrl);
      setPreviewLogo(url);
      setPendingFile(null);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Could not save that logo.');
    } finally {
      setBusy(null);
    }
  }, [pendingFile, onUploadLogo]);

  const restoreDefaults = useCallback(() => {
    /* `revert` means "use the published value", which may itself be a
       logo-generated brand. An empty owned-group replacement instead records
       those published overrides for removal, allowing the built-in SIOMAC
       declarations to show through in preview and in the next saved revision. */
    draft.replaceGroup(brandTokenNames(), {});
    seedsRef.current = DEFAULT_SEEDS;
    setSeeds(DEFAULT_SEEDS);
    setCandidates([]);
    setPendingFile(null);
    setPreviewLogo(logoUrl ?? null);
    setError(null);
  }, [draft, logoUrl]);

  /* Pairings are measured against the LIVE draft, not the freshly generated
     map: a hand edit made in Foundations after generating must be judged too,
     or the panel would certify a theme the user has since broken. */
  const results = useMemo(
    () => evaluatePairings(role => draft.read(role) || null),
    // eslint-disable-next-line react-hooks/exhaustive-deps -- re-measure whenever the draft changes
    [draft.values, seeds],
  );
  const blocked = publishBlocked(results);
  const blockedIds = blocked.map(result => result.id).join('|');
  useEffect(() => {
    draft.setPublishBlockers('brand-contrast', blocked.map(result => `${result.label} does not meet its required contrast ratio.`));
    // eslint-disable-next-line react-hooks/exhaustive-deps -- stable ids represent the blocker set
  }, [blockedIds, draft.setPublishBlockers]);

  const professionalGenerator = (
    <ProfessionalThemeGenerator
      draft={draft}
      previewLogo={previewLogo}
      pendingFile={pendingFile}
      busy={busy}
      error={error}
      candidates={candidates}
      seeds={seeds}
      built={built}
      results={results}
      blocked={blocked}
      accentIsDistinct={accentIsDistinct}
      canSaveLogo={Boolean(onUploadLogo)}
      onFile={onFile}
      onExtract={extractFrom}
      onSaveLogo={saveLogo}
      onApply={apply}
      onRestore={restoreDefaults}
    />
  );

  if (draft.read('--ui-studio-brand-editor') !== 'legacy') return professionalGenerator;

  /* Previous implementation retained temporarily below while the new workspace
     is verified against every persisted workflow. It is unreachable. */
  return (
    <div class="ui-brand">
      <header class="ui-brand-hero">
        <div class="ui-brand-hero__identity">
          <div class="ui-brand-hero__logo" aria-hidden="true">
            {previewLogo ? <img src={previewLogo} alt="" /> : <LucideIcon name="Palette" size={22} />}
          </div>
          <div>
            <span class="ui-brand-hero__eyebrow">SIOMAC company theme</span>
            <h1>Build your company theme</h1>
            <p>Upload a logo or choose your colours. The generator turns them into an accessible theme for the whole app.</p>
          </div>
        </div>
        <div class="ui-brand-hero__meta">
          <strong>{pendingFile ? 'Logo ready to save' : previewLogo ? 'Logo connected' : 'Using SIOMAC defaults'}</strong>
          <span>{draft.dirtyCount > 0 ? `${draft.dirtyCount} unpublished ${draft.dirtyCount === 1 ? 'change' : 'changes'}` : 'No unpublished changes'}</span>
        </div>
      </header>
      <p class="ui-brand-intro">
        Generates the semantic colour roles from your logo. Operational colours —
        success, warning, danger, info — are never derived from a brand: a
        green-branded company still needs red to mean “this destroys data”.
      </p>

      {error && (
        <div class="ui-brand-error" role="alert">
          <LucideIcon name="TriangleAlert" size={15} />
          <span>{error}</span>
        </div>
      )}

      <section class="ui-brand-stepper" aria-label="Theme generator steps">
        <span class="is-active"><b>1</b> Choose colours</span>
        <span><b>2</b> Check the result</span>
        <span><b>3</b> Save or publish</span>
      </section>

      <div class="ui-brand-builder">
      <section class="ui-brand-role-board" aria-labelledby="theme-roles-heading">
        <div class="ui-brand-role-board__head">
          <div>
            <span class="ui-brand-hero__eyebrow">Theme roles</span>
            <h2 id="theme-roles-heading">Where your colours will appear</h2>
          </div>
          <p>These are the key roles the generator updates. Status colours remain independent so their meaning stays clear.</p>
        </div>
        <ThemeRoleBoard tokens={built.tokens} />
      </section>

      <div class="ui-brand-grid">
        <Card variant="panel">
          <CardHeader title="Your logo" description="We use it to suggest a starting palette. It is not changed until you save." />
          <div class="ui-brand-logo-row">
            <div class="ui-brand-logo-frame">
              {previewLogo
                ? <img src={previewLogo} alt="Company logo" />
                : <LucideIcon name="Image" size={22} />}
            </div>
            <div class="ui-brand-logo-ctrls">
              <label class="ui-brand-file">
                <input
                  type="file"
                  accept="image/png,image/jpeg,image/svg+xml,image/webp"
                  onChange={e => {
                    const f = (e.target as HTMLInputElement).files?.[0];
                    if (f) void onFile(f);
                  }}
                />
                <span class="ui-btn ui-btn--outline ui-btn--sm">
                  <LucideIcon name="Upload" />
                  {previewLogo ? 'Replace logo' : 'Upload logo'}
                </span>
              </label>
              {previewLogo && (
                <Button
                  variant="ghost"
                  size="sm"
                  loading={busy === 'extracting'}
                  onClick={() => { void extractFrom(pendingFile?.dataUrl ?? previewLogo); }}
                >
                  Re-extract colours
                </Button>
              )}
              {pendingFile && onUploadLogo && (
                <Button variant="secondary" size="sm" loading={busy === 'uploading'} onClick={() => { void saveLogo(); }}>
                  Save as company logo
                </Button>
              )}
              {pendingFile && (
                <p class="ui-brand-note">
                  {pendingFile.name} — used for colour extraction only until you save it.
                </p>
              )}
            </div>
          </div>
        </Card>

        <Card variant="panel">
          <CardHeader title="Colours from your logo" description="Pick one as your main colour, then optionally choose a supporting colour." />
          {candidates.length === 0
            ? <p class="ui-brand-note">Upload a logo to extract its palette. Until then the seeds below are editable directly.</p>
            : (
              <div class="ui-brand-swatches">
                {candidates.map(c => (
                  <div key={c} class="ui-brand-swatch-col">
                    <span class="ui-brand-swatch" style={{ background: c }} title={c} />
                    <code>{c}</code>
                    <div class="ui-brand-swatch-actions">
                      <button type="button" onClick={() => apply({ primary: c })}>Primary</button>
                      <button type="button" onClick={() => apply({ accent: c })}>Accent</button>
                    </div>
                  </div>
                ))}
              </div>
            )}
        </Card>
      </div>

      <div class="ui-brand-grid">
        <SeedCard
          label="Main colour"
          hint="Used for primary buttons, links, focus and the active page."
          value={seeds.primary}
          onChange={v => apply({ primary: v })}
        />
        <Card variant="panel">
          <CardHeader
            title="Supporting colour"
            description="Optional. Only set this when the logo genuinely has a second colour — a darker copy of the primary is not an accent."
          />
          {seeds.accent === undefined
            ? (
              <div class="ui-brand-seed">
                <p class="ui-brand-note" style={{ flex: '1 1 auto' }}>
                  None. The primary carries links, focus and selection.
                  {candidates.length > 1 && ' Suggestions from the logo are below.'}
                </p>
                <Button size="sm" variant="outline" onClick={() => apply({ accent: candidates[1] ?? '#1b2d54' })}>
                  Choose accent
                </Button>
              </div>
            )
            : (
              <>
                <div class="ui-brand-seed">
                  <input
                    type="color"
                    value={seeds.accent}
                    aria-label="Accent seed colour"
                    onInput={e => apply({ accent: (e.target as HTMLInputElement).value })}
                  />
                  <TextInput
                    size="sm"
                    value={seeds.accent}
                    onInput={v => { if (/^#[0-9a-fA-F]{6}$/.test(v)) apply({ accent: v }); }}
                    aria-label="Accent seed hex"
                  />
                  <Button size="sm" variant="ghost" onClick={() => apply({ accent: undefined })}>Clear</Button>
                </div>
                {!accentIsDistinct && (
                  <p class="ui-brand-note ui-brand-note--warn">
                    Too close to the primary to read as a second colour — it is ignored, and the
                    primary carries the accent roles. That is deliberate: manufacturing an accent
                    from a darker copy of the brand is what produced dark-red menus.
                  </p>
                )}
              </>
            )}
        </Card>
      </div>

      </div>

      <details class="ui-brand-advanced">
        <summary>
          <span>Advanced theme details</span>
          <small>Scales, role mapping and accessibility</small>
        </summary>
        <div class="ui-brand-advanced__body">
      <Card variant="panel">
        <CardHeader
          title="Generated scales"
          description="Eleven tones per seed, generated in HCT so each step is an equal perceived lightness change. Step 500 IS the seed."
        />
        <ScaleRow label="Primary" scale={built.primaryScale} />
        {built.accentScale && <ScaleRow label="Accent" scale={built.accentScale} />}
      </Card>

      {built.movement.length > 0 && (
        <Card variant="panel">
          <CardHeader
            title="Adjusted for legibility"
            description="Where the brand colour could not be used exactly as supplied, and how far it had to move."
          />
          <table class="ui-brand-table">
            <thead><tr><th>Role</th><th>Seed</th><th>Used</th><th>Tone shift</th></tr></thead>
            <tbody>
              {built.movement.map(m => (
                <tr key={m.role}>
                  <td><code>{m.role.replace('--ui-color-', '')}</code></td>
                  <td><span class="ui-brand-chip"><i style={{ background: m.from }} /><code>{m.from}</code></span></td>
                  <td><span class="ui-brand-chip"><i style={{ background: m.to }} /><code>{m.to}</code></span></td>
                  <td><code>{m.toneDelta > 0 ? `+${m.toneDelta}` : m.toneDelta}</code> {m.toneDelta > 0 ? 'lighter' : 'darker'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </Card>
      )}

      <Card variant="panel">
        <CardHeader
          title="Role mapping"
          description="Every semantic role and where its colour comes from. Surfaces stay neutral by policy — this is where you can see why (or why not) a brand colour appears somewhere."
        />
        <RoleMapping tokens={built.tokens} hasAccent={built.accentScale !== undefined} />
      </Card>

      <Card variant="panel">
        <CardHeader
          title="Accessibility checks"
          description="WCAG 2.1 contrast on the pairs a user actually reads. A failing critical pair blocks publishing."
        />
        <PairingTable results={results} />
        {built.compromised.length > 0 && (
          <p class="ui-brand-note ui-brand-note--warn">
            No tone on the generated ramp could carry an accessible {built.compromised.join(', ')} —
            the closest available value was used and must be adjusted by hand.
          </p>
        )}
      </Card>

        </div>
      </details>

      <section class="ui-brand-result" aria-labelledby="theme-preview-heading">
        <div class="ui-brand-result__bar">
          <div>
            <span class="ui-brand-hero__eyebrow">Live application preview</span>
            <h2 id="theme-preview-heading">See the theme in context</h2>
          </div>
          <span class="ui-brand-result__status"><i /> Draft preview</span>
        </div>
        <div class="ui-brand-result__canvas">
          <LivePreview />
        </div>
      </section>

      <div class="ui-brand-actions">
        <Button variant="outline" onClick={restoreDefaults} iconLeft={<LucideIcon name="RotateCcw" />}>Restore SIOMAC defaults</Button>
        <Button variant="outline" onClick={() => apply({})} iconLeft={<LucideIcon name="RefreshCw" />}>Regenerate</Button>
        <div class="ui-brand-actions-spacer" />
        {blocked.length > 0 && (
          <span class="ui-brand-block" role="status">
            <LucideIcon name="ShieldAlert" size={15} />
            {blocked.length} critical contrast {blocked.length === 1 ? 'failure' : 'failures'} — fix before publishing
          </span>
        )}
        <span class="ui-brand-note">Save or publish from the Studio bar above.</span>
      </div>
    </div>
  );
}

/* ── Pieces ────────────────────────────────────────────────────────────────*/

interface ProfessionalThemeGeneratorProps {
  draft: GalleryDraft;
  previewLogo: string | null;
  pendingFile: { name: string; dataUrl: string } | null;
  busy: 'extracting' | 'uploading' | null;
  error: string | null;
  candidates: readonly string[];
  seeds: BrandSeeds;
  built: ReturnType<typeof brandThemeToTokens>;
  results: readonly PairingResult[];
  blocked: readonly PairingResult[];
  accentIsDistinct: boolean;
  canSaveLogo: boolean;
  onFile: (file: File) => Promise<void>;
  onExtract: (source: Blob | string) => Promise<void>;
  onSaveLogo: () => Promise<void>;
  onApply: (patch: Partial<BrandSeeds>) => void;
  onRestore: () => void;
}

function ProfessionalThemeGenerator({
  draft, previewLogo, pendingFile, busy, error, candidates, seeds, built,
  results, blocked, accentIsDistinct, canSaveLogo, onFile, onExtract,
  onSaveLogo, onApply, onRestore,
}: ProfessionalThemeGeneratorProps): VNode {
  const [previewPage, setPreviewPage] = useState<'dashboard' | 'form'>('dashboard');
  const [previewName, setPreviewName] = useState('North Terminal inspection');
  const passedChecks = results.filter(result => result.pass).length;

  return (
    <div class="theme-pro">
      <header class="theme-pro__header">
        <div><span class="theme-pro__kicker">Company theme</span><h1>Create a theme that feels like your brand</h1><p>Choose the identity colours once. SIOMAC creates accessible states and applies them across the application.</p></div>
        <div class="theme-pro__header-status"><span class={draft.dirtyCount > 0 ? 'is-dirty' : ''}><i />{draft.dirtyCount > 0 ? 'Draft in progress' : 'Published theme'}</span><small>{draft.dirtyCount > 0 ? `${draft.dirtyCount} unpublished ${draft.dirtyCount === 1 ? 'change' : 'changes'}` : 'Everything is up to date'}</small></div>
      </header>

      {error && <div class="theme-pro__error" role="alert"><LucideIcon name="TriangleAlert" size={17} /><span>{error}</span></div>}

      <div class="theme-pro__workspace">
        <aside class="theme-pro__controls" aria-label="Theme controls">
          <section class="theme-pro__section">
            <div class="theme-pro__section-head"><span>01</span><div><h2>Brand source</h2><p>Start with a logo, or choose colours manually.</p></div></div>
            <label class="theme-pro__upload">
              <input type="file" accept="image/png,image/jpeg,image/svg+xml,image/webp" onChange={event => { const file = (event.target as HTMLInputElement).files?.[0]; if (file) void onFile(file); }} />
              <div class="theme-pro__upload-logo">{previewLogo ? <img src={previewLogo} alt="Company logo preview" /> : <LucideIcon name="ImagePlus" size={25} />}</div>
              <div><strong>{previewLogo ? 'Replace company logo' : 'Upload company logo'}</strong><small>PNG, JPG, SVG or WebP</small></div><LucideIcon name="Upload" size={18} />
            </label>
            {previewLogo && <div class="theme-pro__source-actions"><Button variant="ghost" size="sm" loading={busy === 'extracting'} onClick={() => { void onExtract(pendingFile?.dataUrl ?? previewLogo); }}>Read colours again</Button>{pendingFile && canSaveLogo && <Button variant="outline" size="sm" loading={busy === 'uploading'} onClick={() => { void onSaveLogo(); }}>Save logo</Button>}</div>}
          </section>

          <section class="theme-pro__section">
            <div class="theme-pro__section-head"><span>02</span><div><h2>Brand colours</h2><p>Select the colours that should carry your identity.</p></div></div>
            {candidates.length > 0 && <div class="theme-pro__palette" aria-label="Colours extracted from logo">{candidates.map(colour => <button key={colour} type="button" style={{ background: colour }} aria-label={`Use ${colour} as main colour`} title={colour} onClick={() => onApply({ primary: colour })} />)}</div>}
            <div class="theme-pro__colour-field"><label><span>Main colour</span><small>Buttons, active navigation and key actions</small></label><div><input type="color" value={seeds.primary} aria-label="Main colour" onInput={event => onApply({ primary: (event.target as HTMLInputElement).value })} /><TextInput value={seeds.primary} aria-label="Main colour hex" onInput={value => { if (/^#[0-9a-fA-F]{6}$/.test(value)) onApply({ primary: value }); }} /></div></div>
            <div class="theme-pro__colour-field"><label><span>Supporting colour</span><small>Links, focus and selected items</small></label>{seeds.accent ? <div><input type="color" value={seeds.accent} aria-label="Supporting colour" onInput={event => onApply({ accent: (event.target as HTMLInputElement).value })} /><TextInput value={seeds.accent} aria-label="Supporting colour hex" onInput={value => { if (/^#[0-9a-fA-F]{6}$/.test(value)) onApply({ accent: value }); }} /><button type="button" class="theme-pro__clear" aria-label="Remove supporting colour" onClick={() => onApply({ accent: undefined })}><LucideIcon name="X" size={15} /></button></div> : <Button variant="outline" size="sm" onClick={() => onApply({ accent: candidates[1] ?? '#E40C0C' })}>Add supporting colour</Button>}{seeds.accent && !accentIsDistinct && <p class="theme-pro__warning">Choose a colour that is more distinct from the main colour.</p>}</div>
          </section>

          <section class="theme-pro__section theme-pro__quality">
            <div class="theme-pro__section-head"><span>03</span><div><h2>Theme quality</h2><p>Automatic checks protect readability before publishing.</p></div></div>
            <div class="theme-pro__quality-row"><div class="theme-pro__quality-score">{passedChecks}<small>of {results.length}</small></div><div><strong>{blocked.length === 0 ? 'Ready to review' : 'Needs attention'}</strong><p>{blocked.length === 0 ? 'All critical colour pairs are readable.' : `${blocked.length} critical contrast ${blocked.length === 1 ? 'check needs' : 'checks need'} adjustment.`}</p></div></div>
            <details><summary>View technical details</summary><div class="theme-pro__details"><ScaleRow label="Main" scale={built.primaryScale} />{built.accentScale && <ScaleRow label="Supporting" scale={built.accentScale} />}<PairingTable results={results} /></div></details>
          </section>
        </aside>

        <main class="theme-pro__preview" aria-label="Live theme preview">
          <div class="theme-pro__preview-head"><div><span class="theme-pro__kicker">Live preview</span><h2>Your SIOMAC workspace</h2></div><div class="theme-pro__preview-tabs"><button type="button" class={previewPage === 'dashboard' ? 'is-active' : ''} onClick={() => setPreviewPage('dashboard')}>Dashboard</button><button type="button" class={previewPage === 'form' ? 'is-active' : ''} onClick={() => setPreviewPage('form')}>Form</button></div></div>
          <div class="theme-pro__screen">
            <div class="theme-pro__appbar"><div class="theme-pro__appmark">{previewLogo ? <img src={previewLogo} alt="" /> : <span>S</span>}<strong>SIOMAC</strong></div><div class="theme-pro__app-actions"><button type="button" aria-label="Search"><LucideIcon name="Search" size={16} /></button><button type="button" aria-label="Notifications"><LucideIcon name="Bell" size={16} /></button><span>AM</span></div></div>
            <div class="theme-pro__appbody"><nav class="theme-pro__rail"><span>Workspace</span><a class="is-active"><LucideIcon name="LayoutDashboard" size={16} />Dashboard</a><a><LucideIcon name="ClipboardList" size={16} />Inspections</a><a><LucideIcon name="Users" size={16} />People</a><a><LucideIcon name="BarChart3" size={16} />Reports</a></nav><div class="theme-pro__content">{previewPage === 'dashboard' ? <ThemeDashboardPreview /> : <ThemeFormPreview name={previewName} onNameChange={setPreviewName} />}</div></div>
          </div>
          <div class="theme-pro__roles"><ThemeRoleBoard tokens={built.tokens} /></div>
        </main>
      </div>

      <footer class="theme-pro__footer"><div><strong>Theme changes remain in this draft</strong><span>Nothing reaches the application until it is reviewed and published.</span></div><Button variant="ghost" onClick={onRestore} iconLeft={<LucideIcon name="RotateCcw" />}>Restore SIOMAC defaults</Button></footer>
    </div>
  );
}

function ThemeDashboardPreview(): VNode {
  const items = [
    { name: 'North Terminal inspection', meta: 'Updated 12 minutes ago', icon: 'ClipboardCheck', tone: 'success', status: 'Complete' },
    { name: 'Equipment maintenance review', meta: 'Updated 1 hour ago', icon: 'Wrench', tone: 'warning', status: 'In progress' },
    { name: 'Safety permit renewal', meta: 'Updated yesterday', icon: 'ShieldCheck', tone: 'success', status: 'Complete' },
  ] as const;
  return <><div class="theme-pro__page-title"><div><span>Operations</span><h3>Good morning, Aaliyah</h3><p>Here is what needs your attention today.</p></div><Button variant="primary" iconLeft={<LucideIcon name="Plus" />}>New inspection</Button></div><div class="theme-pro__metrics"><article><span>Open inspections</span><strong>24</strong><small>4 due today</small></article><article><span>Actions completed</span><strong>86%</strong><small>Up 12% this month</small></article><article><span>Active locations</span><strong>12</strong><small>All systems online</small></article></div><section class="theme-pro__activity"><div class="theme-pro__activity-head"><div><h4>Recent activity</h4><p>Latest updates across your locations</p></div><Button variant="outline" size="sm">View all</Button></div>{items.map((item, index) => <div class="theme-pro__activity-row" key={item.name}><span class={`theme-pro__activity-icon is-${index + 1}`}><LucideIcon name={item.icon} size={16} /></span><div><strong>{item.name}</strong><small>{item.meta}</small></div><Badge tone={item.tone} variant="soft" size="sm">{item.status}</Badge></div>)}</section></>;
}

function ThemeFormPreview({ name, onNameChange }: { name: string; onNameChange: (value: string) => void }): VNode {
  return <><div class="theme-pro__page-title"><div><span>New record</span><h3>Create inspection</h3><p>Complete the details below to begin a new inspection.</p></div></div><section class="theme-pro__form"><label><span>Inspection name</span><TextInput value={name} onInput={onNameChange} /></label><label><span>Location</span><Select value="north" onChange={() => undefined} options={[{ value: 'north', label: 'North Terminal' }, { value: 'south', label: 'South Yard' }]} /></label><label class="is-wide"><span>Notes</span><textarea rows={4} placeholder="Add instructions for the inspection team" /></label><div class="theme-pro__form-actions"><Button variant="outline">Cancel</Button><Button variant="primary">Create inspection</Button></div></section></>;
}

function SeedCard(
  { label, hint, value, onChange }:
  { label: string; hint: string; value: string; onChange: (v: string) => void },
): VNode {
  return (
    <Card variant="panel">
      <CardHeader title={label} description={hint} />
      <div class="ui-brand-seed">
        <input
          type="color"
          value={value}
          aria-label={`${label} seed colour`}
          onInput={e => onChange((e.target as HTMLInputElement).value)}
        />
        <TextInput
          size="sm"
          value={value}
          onInput={v => { if (/^#[0-9a-fA-F]{6}$/.test(v)) onChange(v); }}
          aria-label={`${label} seed hex`}
        />
      </div>
    </Card>
  );
}

function ScaleRow({ label, scale }: { label: string; scale: Record<number, string> }): VNode {
  return (
    <div class="ui-brand-scale">
      <span class="ui-brand-scale-label">{label}</span>
      <div class="ui-brand-scale-strip">
        {TONAL_STEPS.map(step => (
          <div key={step} class="ui-brand-scale-cell" title={`${label} ${step} — ${scale[step]}`}>
            <span style={{ background: scale[step] }} />
            <em>{step}</em>
          </div>
        ))}
      </div>
    </div>
  );
}

/** A plain-language summary of the roles that receive a brand value. */
function ThemeRoleBoard({ tokens }: { tokens: Record<string, string> }): VNode {
  const groups = [
    { label: 'Actions', items: [['Primary action', '--ui-color-action-primary'], ['Action hover', '--ui-color-action-primary-hover']] },
    { label: 'Selection & focus', items: [['Selected item', '--ui-color-selection-background'], ['Focus ring', '--ui-color-focus-ring']] },
    { label: 'Navigation', items: [['Active page', '--ui-color-nav-active-background'], ['Active indicator', '--ui-color-nav-active-indicator']] },
    { label: 'Content', items: [['Links', '--ui-color-text-link'], ['Accent text', '--ui-color-action-secondary']] },
  ] as const;

  return (
    <div class="ui-brand-role-board__grid">
      {groups.map(group => (
        <article key={group.label} class="ui-brand-role-card">
          <h3>{group.label}</h3>
          {group.items.map(([label, token]) => (
            <div key={token} class="ui-brand-role-card__item">
              <span class="ui-brand-role-card__swatch" style={{ background: tokens[token] }} />
              <span>{label}</span>
            </div>
          ))}
        </article>
      ))}
    </div>
  );
}

/**
 * EVERY role, not just the generated ones.
 *
 * The question this answers is "why is there a dark red here?" — which a table
 * of only the roles the engine wrote cannot answer, because the answer is
 * usually a role it did NOT write. Each row says where its colour comes from.
 */
function RoleMapping({ tokens, hasAccent }: { tokens: Record<string, string>; hasAccent: boolean }): VNode {
  const neutralByPolicy = new Set<string>(NEUTRAL_BY_POLICY);

  function source(name: string, brandDriven: boolean): { label: string; tone: 'brand' | 'neutral' | 'locked' } {
    if (name in tokens) return { label: hasAccent && ACCENT_ROLES.has(name) ? 'Accent' : 'Primary', tone: 'brand' };
    if (neutralByPolicy.has(name)) return { label: 'Neutral — by policy', tone: 'neutral' };
    if (!brandDriven) return { label: 'Neutral — never brand', tone: 'locked' };
    return { label: 'Neutral — app default', tone: 'neutral' };
  }

  return (
    <table class="ui-brand-table">
      <thead>
        <tr><th>Role</th><th>Source</th><th>Value</th></tr>
      </thead>
      <tbody>
        {SEMANTIC_GROUPS.map(g => (
          <>
            <tr key={g.id} class="ui-brand-table-group">
              <td colSpan={3}>{g.label}</td>
            </tr>
            {semanticRolesIn(g.id).map(r => {
              const src = source(r.name, r.brandDriven);
              const value = tokens[r.name];
              return (
                <tr key={r.name}>
                  <td><code>{r.name.replace('--ui-color-', '')}</code><small>{r.label}</small></td>
                  <td><span class={`ui-brand-src ui-brand-src--${src.tone}`}>{src.label}</span></td>
                  <td>
                    {value
                      ? <span class="ui-brand-chip"><i style={{ background: value }} /><code>{value}</code></span>
                      : <code class="ui-brand-dim">{r.defaultsFrom}</code>}
                  </td>
                </tr>
              );
            })}
          </>
        ))}
      </tbody>
    </table>
  );
}

/** Roles that follow the ACCENT seed when one exists. */
const ACCENT_ROLES = new Set([
  '--ui-color-text-link', '--ui-color-focus-ring',
  '--ui-color-selection-background', '--ui-color-selection-border',
  '--ui-color-nav-active-background', '--ui-color-nav-active-text',
  '--ui-color-nav-active-indicator',
]);

function PairingTable({ results }: { results: readonly PairingResult[] }): VNode {
  return (
    <table class="ui-brand-table">
      <thead>
        <tr><th>Pairing</th><th>Ratio</th><th>Required</th><th>Result</th></tr>
      </thead>
      <tbody>
        {results.map(r => (
          <tr key={r.id} class={r.pass ? '' : r.critical ? 'is-fail' : 'is-warn'}>
            <td>
              <span class="ui-brand-pair" style={{ background: r.bgValue, color: r.fgValue }}>Aa</span>
              {r.label}
              <small>{r.why}</small>
            </td>
            <td><code>{r.ratio.toFixed(2)}:1</code></td>
            <td><code>{r.threshold}:1</code></td>
            <td>
              <Badge tone={r.pass ? 'success' : r.critical ? 'danger' : 'warning'} variant="soft" size="sm">
                {r.pass ? 'Pass' : r.critical ? 'Blocks publish' : 'Warning'}
              </Badge>
            </td>
          </tr>
        ))}
      </tbody>
    </table>
  );
}

interface Crew { id: string; name: string; role: string; status: 'Active' | 'On leave' }

const CREW: Crew[] = [
  { id: 'c1', name: 'A. Mohammed',  role: 'Site Supervisor', status: 'Active' },
  { id: 'c2', name: 'R. Persad',    role: 'Technician',      status: 'On leave' },
  { id: 'c3', name: 'K. Baptiste',  role: 'Safety Officer',  status: 'Active' },
];

/**
 * The judgement surface.
 *
 * Every specimen that HAS a canonical component is the real component — Button,
 * Badge, TextInput, Select, Tabs, Card, DataTable — because a mock is styled by
 * this file's CSS and could show a theme working that does not.
 *
 * Two blocks are explicitly labelled role demonstrations rather than component
 * previews: the navigation rail and the menu surface. Neither has a canonical
 * component yet (the app shell and Menu are rebuilt in a later phase), and
 * dressing a div up as one would misrepresent what is being verified. They read
 * the semantic roles directly, which is exactly what the real components will do.
 */
function LivePreview(): VNode {
  const [tab, setTab] = useState('overview');
  const [sample, setSample] = useState('Focus me to see the ring');
  const [site, setSite] = useState<string>('north');
  const [dialogOpen, setDialogOpen] = useState(false);
  const [selected, setSelected] = useState<readonly string[]>(['c2']);

  return (
    <div class="ui-brand-preview">
      <div class="ui-brand-preview-row">
        <Button variant="primary">Primary action</Button>
        <Button variant="secondary">Secondary</Button>
        <Button variant="outline">Outline</Button>
        <Button variant="ghost">Ghost</Button>
        <Button variant="danger">Delete</Button>
      </div>

      <div class="ui-brand-preview-row">
        <Badge tone="accent" variant="soft">Accent</Badge>
        <Badge tone="success" variant="soft">Approved</Badge>
        <Badge tone="warning" variant="soft">Pending</Badge>
        <Badge tone="danger" variant="soft">Rejected</Badge>
      </div>

      <div class="ui-brand-preview-row">
        <div style={{ maxWidth: '260px', flex: '1 1 200px' }}>
          <TextInput value={sample} onInput={setSample} aria-label="Preview input" />
        </div>
        <div style={{ maxWidth: '220px', flex: '0 1 200px' }}>
          <Select
            /* Searchable so it renders the kit's PORTALLED listbox rather than
               the native OS picker. The portalled surface is the one that used
               to escape the preview scope, so it has to be reachable here. */
            searchable
            value={site}
            onChange={v => setSite(v)}
            options={[
              { value: 'north', label: 'North Yard' },
              { value: 'south', label: 'South Terminal' },
              { value: 'depot', label: 'Central Depot' },
            ]}
            aria-label="Preview select"
          />
        </div>
        <a class="ui-brand-link" href="#preview" onClick={e => e.preventDefault()}>An inline link</a>
      </div>

      <Tabs
        id="brand-preview-tabs"
        label="Brand preview"
        items={[
          { id: 'overview', label: 'Overview' },
          { id: 'details',  label: 'Details' },
          { id: 'history',  label: 'History' },
        ]}
        value={tab}
        onChange={setTab}
      />

      <Card variant="surface">
        <CardHeader title="Card surface" description="Cards stay neutral whatever the brand is." />
        <DataTable<Crew>
          label="Crew preview"
          rows={CREW}
          columns={[
            { id: 'name',   header: 'Name',   cell: r => r.name, sortable: true },
            { id: 'role',   header: 'Role',   cell: r => r.role },
            { id: 'status', header: 'Status', cell: r => (
              <Badge tone={r.status === 'Active' ? 'success' : 'warning'} variant="soft" size="sm">{r.status}</Badge>
            ) },
          ]}
          getRowId={r => r.id}
          selection={{ selectedIds: selected, onChange: setSelected }}
        />
      </Card>

      <div class="ui-brand-preview-row ui-brand-preview-row--top">
        {/* Role demonstrations — no canonical component owns these yet. */}
        <div class="ui-brand-nav" aria-label="Navigation role preview">
          <div class="ui-brand-nav-title">Navigation roles</div>
          <div class="ui-brand-nav-item">Dashboard</div>
          <div class="ui-brand-nav-item is-active"><i /> Employees</div>
          <div class="ui-brand-nav-item">Payroll</div>
        </div>

        <div class="ui-brand-menu" aria-label="Menu surface role preview">
          <div class="ui-brand-menu-title">Menu / dropdown surface</div>
          <div class="ui-brand-menu-item">Open record</div>
          <div class="ui-brand-menu-item is-selected">Assign to crew</div>
          <div class="ui-brand-menu-item">Export CSV</div>
          <div class="ui-brand-menu-item is-danger">Delete</div>
        </div>

        <div class="ui-brand-dialog" aria-label="Dialog surface role preview">
          <div class="ui-brand-dialog-head">Dialog surface</div>
          <p>Overlays stay neutral. The brand appears in the action, not the panel.</p>
          <div class="ui-brand-preview-row">
            <Button variant="outline" size="sm">Cancel</Button>
            <Button variant="primary" size="sm">Confirm</Button>
          </div>
        </div>
      </div>

      {/*
        The REAL portalled overlays. They are the reason this section exists:
        a Select trigger and a Dialog invoker both re-themed correctly while the
        surfaces they open did not, because those portal out of the preview
        scope. Open them here and the propagation is inspectable rather than
        assumed.
      */}
      <div class="ui-brand-preview-row">
        <Button variant="outline" onClick={() => setDialogOpen(true)}>Open real Dialog</Button>
        <span class="ui-brand-note">
          Opens the canonical <code>Dialog</code>; the Select above opens the canonical listbox.
          Both are portalled, and both must still pick up the drafted theme.
        </span>
      </div>

      <Dialog open={dialogOpen} onClose={() => setDialogOpen(false)}>
        <Dialog.Header
          title="Confirm assignment"
          sub="A real portalled Dialog, rendered inside the preview's portal root."
          onClose={() => setDialogOpen(false)}
        />
        <Dialog.Body>
          <p style={{ margin: 0 }}>
            The panel stays neutral; the primary action and the accent carry the brand.
          </p>
        </Dialog.Body>
        <Dialog.Footer>
          <Button variant="outline" onClick={() => setDialogOpen(false)}>Cancel</Button>
          <Button variant="primary" onClick={() => setDialogOpen(false)}>Confirm</Button>
        </Dialog.Footer>
      </Dialog>
    </div>
  );
}
