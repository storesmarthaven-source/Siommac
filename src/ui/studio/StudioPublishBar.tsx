import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { type GalleryDraft } from '../gallery/galleryStore';
import { LucideIcon } from '../LucideIcon';
import { type DesignSystemRevision } from '../../../types/designSystem';

function friendlyError(error: string): string {
  return /unauthorized/i.test(error)
    ? 'Sign in with Design System permissions to save or publish changes.'
    : error;
}

/** One persistence surface for every Studio editor. Component pages own only
 * previews and controls; drafts, validation, history and publication belong to
 * the Studio configuration as a whole. */
export function StudioPublishBar({ draft }: { draft: GalleryDraft }): VNode {
  const [summary, setSummary] = useState('Design system update');
  const [review, setReview] = useState(false);
  const [history, setHistory] = useState<DesignSystemRevision[] | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = draft.publishBlockers;
  const dirty = draft.dirtyCount > 0;
  const status = dirty
    ? `${draft.dirtyCount} unpublished change${draft.dirtyCount === 1 ? '' : 's'}`
    : draft.loading
      ? 'Loading Studio state…'
      : `Published v${draft.publishedVersion}`;

  const act = (operation: () => Promise<unknown>, message: string): void => {
    setNotice(null);
    void operation().then(() => setNotice(message)).catch(() => undefined);
  };

  return (
    <>
      <section class={`sds-publish${dirty ? ' is-dirty' : ''}`} aria-label="Studio publishing">
        <div class="sds-publish__intro">
          <span><LucideIcon name="Save" size={18} /></span>
          <div><strong>Design system changes</strong><small>Save a private draft, then review and publish it across SIOMAC.</small></div>
        </div>
        <div class="sds-publish__status" aria-live="polite">
          <i aria-hidden="true" />
          <span>{status}</span>
          {draft.serverDraft && dirty ? <small>Draft r{draft.serverDraft.revision}</small> : null}
        </div>
        <div class="sds-publish__actions">
          <button type="button" class="is-quiet" onClick={() => act(async () => { setHistory(await draft.history()); }, 'Version history loaded.')} disabled={draft.loading || draft.saving}>History</button>
          <button type="button" onClick={draft.resetAll} disabled={!dirty || draft.saving}>Discard changes</button>
          <button type="button" onClick={() => act(draft.saveDraft, 'Draft saved.')} disabled={!dirty || draft.loading || draft.saving}>Save draft</button>
          <button type="button" class="is-primary" onClick={() => setReview(true)} disabled={!dirty || draft.loading || draft.saving || blocked.length > 0}>Review &amp; publish</button>
        </div>
        {(draft.error !== null || notice !== null || (dirty && blocked.length > 0)) && (
          <span class={`sds-publish__message${draft.error || blocked.length > 0 ? ' is-error' : ''}`} role={draft.error ? 'alert' : 'status'}>
            {draft.error ? friendlyError(draft.error) : blocked.length > 0 ? `${blocked.length} critical contrast ${blocked.length === 1 ? 'issue blocks' : 'issues block'} publishing.` : notice}
          </span>
        )}
      </section>

      {history && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="studio-history-title"><div class="sds-review__card"><h3 id="studio-history-title">Version history</h3><div class="sds-history__list">{history.map(item => <article key={item.version}><div><strong>v{item.version}</strong><span>{item.summary ?? 'No summary'}</span><small>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Unknown date'}</small></div>{item.version !== draft.publishedVersion && <button type="button" onClick={() => act(() => draft.rollback(item.version, `Rollback to v${item.version} from Studio`), `Restored v${item.version}.`)}>Restore</button>}</article>)}</div><div class="sds-style__dialog-actions"><button type="button" onClick={() => setHistory(null)}>Close</button></div></div></div>}

      {review && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="studio-publish-title"><div class="sds-review__card"><h3 id="studio-publish-title">Publish Studio changes?</h3><p>{draft.dirtyCount} design-system change{draft.dirtyCount === 1 ? '' : 's'} will update canonical application consumers. Preview-only states, icons and examples will stay local.</p><div class="sds-review__checks"><span>✓ Draft validated before publish</span><span>✓ Published configuration is versioned</span><span>✓ Change is recorded in history</span><span>✓ Rollback remains available</span></div><label>Describe this change<input value={summary} onInput={event => setSummary((event.target as HTMLInputElement).value)} /></label><div class="sds-style__dialog-actions"><button type="button" onClick={() => setReview(false)}>Cancel</button><button type="button" class="is-primary" disabled={summary.trim().length === 0 || draft.saving} onClick={() => { act(() => draft.publish(summary), 'Published successfully.'); setReview(false); }}>Publish v{draft.publishedVersion + 1}</button></div></div></div>}
    </>
  );
}
