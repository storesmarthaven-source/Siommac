import { type VNode } from 'preact';
import { Button } from '../primitives/Button';
import { type GalleryDraft } from '../gallery/galleryStore';

/**
 * The Brand landing page is intentionally an orientation page, not a second
 * theme editor. Logo upload, palette extraction and token decisions belong in
 * Theme Generator so there is one clear place to make a change.
 */
export function BrandOverview({ draft, logoUrl, onOpenThemeGenerator }: {
  draft: GalleryDraft;
  logoUrl?: string | null;
  onOpenThemeGenerator: () => void;
}): VNode {
  const primary = draft.read('--ui-color-action-primary');
  const accent = draft.read('--ui-color-selection-border');
  const hasDraft = draft.dirtyCount > 0;

  return (
    <div class="sds-brand-home">
      <header class="sds-brand-home__hero">
        <div>
          <span>Brand</span>
          <h1>Company theme</h1>
          <p>Set the logo, extract its palette, and prepare a theme for the SIOMAC application.</p>
        </div>
        <Button variant="primary" onClick={onOpenThemeGenerator}>Open Theme Generator</Button>
      </header>

      <section class="sds-brand-home__status" aria-label="Brand theme status">
        <div class="sds-brand-home__logo">
          {logoUrl ? <img src={logoUrl} alt="Company logo" /> : <span>No logo</span>}
        </div>
        <div>
          <strong>{hasDraft ? 'Theme draft in progress' : 'Current company theme'}</strong>
          <p>{hasDraft
            ? `${draft.dirtyCount} change${draft.dirtyCount === 1 ? '' : 's'} ready to review and publish.`
            : 'No unpublished changes. Start in Theme Generator when you are ready to update the brand.'}</p>
        </div>
      </section>

      <section class="sds-brand-home__summary" aria-label="Current brand summary">
        <article>
          <span class="sds-brand-home__eyebrow">Logo</span>
          <strong>{logoUrl ? 'Company logo saved' : 'No logo uploaded'}</strong>
          <p>{logoUrl ? 'Used as the source for palette extraction.' : 'Upload a logo in Theme Generator to begin.'}</p>
        </article>
        <article>
          <span class="sds-brand-home__eyebrow">Primary colour</span>
          <div class="sds-brand-home__colour"><i style={{ background: primary }} /><strong>{primary}</strong></div>
          <p>Primary actions, links and focus.</p>
        </article>
        <article>
          <span class="sds-brand-home__eyebrow">Accent colour</span>
          <div class="sds-brand-home__colour"><i style={{ background: accent }} /><strong>{accent}</strong></div>
          <p>Selection and supporting emphasis.</p>
        </article>
      </section>
    </div>
  );
}
