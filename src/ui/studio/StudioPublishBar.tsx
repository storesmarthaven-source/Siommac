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

function revisionEntries(revision: DesignSystemRevision): Record<string, string> {
  return {
    ...revision.configuration.theme.tokens,
    ...revision.configuration.recipes.button.overrides,
    ...(revision.configuration.recipes.aiAction?.overrides ?? {}),
    'theme.savedColors': JSON.stringify(revision.configuration.theme.savedColors),
  };
}

function revisionChangeCount(revision: DesignSystemRevision, previous?: DesignSystemRevision): number {
  const current = revisionEntries(revision);
  if (!previous) return Object.keys(current).length;
  const before = revisionEntries(previous);
  return new Set([...Object.keys(current), ...Object.keys(before)])
    .size - [...new Set([...Object.keys(current), ...Object.keys(before)])]
      .filter(key => current[key] === before[key]).length;
}

/** One persistence surface for every Studio editor. Component pages own only
 * previews and controls; drafts, validation, history and publication belong to
 * the Studio configuration as a whole. */
export function StudioPublishBar({ draft }: { draft: GalleryDraft }): VNode {
  const [summary, setSummary] = useState('Design system update');
  const [review, setReview] = useState(false);
  const [historyOpen, setHistoryOpen] = useState(false);
  const [history, setHistory] = useState<DesignSystemRevision[]>([]);
  const [historyLoading, setHistoryLoading] = useState(false);
  const [historyError, setHistoryError] = useState<string | null>(null);
  const [notice, setNotice] = useState<string | null>(null);
  const blocked = draft.publishBlockers;
  const dirty = draft.dirtyCount > 0;
  const status = dirty
    ? `${draft.dirtyCount} draft change${draft.dirtyCount === 1 ? '' : 's'}`
    : draft.loading
      ? 'Loading Studio state…'
      : `Published v${draft.publishedVersion}`;
  const detail = draft.error
    ? friendlyError(draft.error)
    : dirty && blocked.length > 0
      ? `${blocked.length} critical contrast ${blocked.length === 1 ? 'issue blocks' : 'issues block'} publishing.`
      : notice ?? 'Your draft stays private until you review and publish it.';
  const detailIsError = draft.error !== null || (dirty && blocked.length > 0);

  const act = (operation: () => Promise<unknown>, message: string): void => {
    setNotice(null);
    void operation().then(() => setNotice(message)).catch(() => undefined);
  };
  const openHistory = (): void => {
    setHistoryOpen(true);
    setHistoryLoading(true);
    setHistoryError(null);
    void draft.history()
      .then(setHistory)
      .catch((reason: unknown) => setHistoryError(friendlyError(reason instanceof Error ? reason.message : 'Version history is unavailable.')))
      .finally(() => setHistoryLoading(false));
  };

  return (
    <>
      <section class={`sds-publish${dirty ? ' is-dirty' : ''}`} aria-label="Studio publishing">
        <div class="sds-publish__intro">
          <span><LucideIcon name="Layers3" size={18} /></span>
          <div>
            <strong>Design system draft</strong>
            <small class={detailIsError ? 'is-error' : undefined} role={draft.error ? 'alert' : 'status'}>{detail}</small>
          </div>
          <div class="sds-publish__status" aria-live="polite">
            <i aria-hidden="true" />
            <span>{status}</span>
            {draft.serverDraft && dirty ? <small>r{draft.serverDraft.revision}</small> : null}
          </div>
        </div>
        <div class="sds-publish__actions">
          <button type="button" class="is-quiet" onClick={openHistory} disabled={draft.loading || draft.saving}>History</button>
          <button type="button" onClick={draft.resetAll} disabled={!dirty || draft.saving}>Discard changes</button>
          <button type="button" onClick={() => act(draft.saveDraft, 'Draft saved.')} disabled={!dirty || draft.loading || draft.saving}>Save draft</button>
          <button type="button" class="is-primary" onClick={() => setReview(true)} disabled={!dirty || draft.loading || draft.saving || blocked.length > 0}>Review &amp; publish</button>
        </div>
      </section>

      {historyOpen && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="studio-history-title">
        <div class="sds-review__card sds-history">
          <header class="sds-history__head">
            <span><LucideIcon name="History" size={20} /></span>
            <div><h3 id="studio-history-title">Version history</h3><p>Review published Design System versions or restore an earlier configuration.</p></div>
            <strong>Current v{draft.publishedVersion}</strong>
          </header>
          {historyLoading ? <div class="sds-history__state"><LucideIcon name="LoaderCircle" size={20} /><strong>Loading version history</strong><span>Retrieving published revisions…</span></div>
            : historyError ? <div class="sds-history__state is-error"><LucideIcon name="TriangleAlert" size={20} /><strong>History could not be loaded</strong><span>{historyError}</span><button type="button" onClick={openHistory}>Try again</button></div>
              : history.length === 0 ? <div class="sds-history__state"><LucideIcon name="Archive" size={20} /><strong>No published versions yet</strong><span>Your first published Design System version will appear here.</span></div>
                : <div class="sds-history__list">{history.map((item, index) => {
                  const current = item.version === draft.publishedVersion;
                  const changes = revisionChangeCount(item, history[index + 1]);
                  return <article class={current ? 'is-current' : undefined} key={item.version}>
                    <span class="sds-history__marker" aria-hidden="true" />
                    <div class="sds-history__copy">
                      <div><strong>Version {item.version}</strong>{current && <em>Current</em>}</div>
                      <p>{item.summary ?? 'No change summary was provided.'}</p>
                      <small>{item.publishedAt ? new Date(item.publishedAt).toLocaleString() : 'Unknown date'}{item.publishedBy ? ` · ${item.publishedBy}` : ''}</small>
                    </div>
                    <span class="sds-history__changes">{changes} configuration change{changes === 1 ? '' : 's'}</span>
                    {!current && <button type="button" onClick={() => act(() => draft.rollback(item.version, `Rollback to v${item.version} from Studio`), `Restored v${item.version}.`)}>Restore</button>}
                  </article>;
                })}</div>}
          <footer class="sds-style__dialog-actions"><button type="button" onClick={() => setHistoryOpen(false)}>Close</button></footer>
        </div>
      </div>}

      {review && <div class="sds-review" role="dialog" aria-modal="true" aria-labelledby="studio-publish-title"><div class="sds-review__card"><h3 id="studio-publish-title">Publish Studio changes?</h3><p>{draft.dirtyCount} design-system change{draft.dirtyCount === 1 ? '' : 's'} will update canonical application consumers. Preview-only states, icons and examples will stay local.</p><div class="sds-review__checks"><span>✓ Draft validated before publish</span><span>✓ Published configuration is versioned</span><span>✓ Change is recorded in history</span><span>✓ Rollback remains available</span></div><label>Describe this change<input value={summary} onInput={event => setSummary((event.target as HTMLInputElement).value)} /></label><div class="sds-style__dialog-actions"><button type="button" onClick={() => setReview(false)}>Cancel</button><button type="button" class="is-primary" disabled={summary.trim().length === 0 || draft.saving} onClick={() => { act(() => draft.publish(summary), 'Published successfully.'); setReview(false); }}>Publish v{draft.publishedVersion + 1}</button></div></div></div>}
    </>
  );
}
