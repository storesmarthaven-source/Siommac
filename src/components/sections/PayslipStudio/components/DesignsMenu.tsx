import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { useDesigner } from '@payslip/state/DesignerContext';
import { templateStore, type StoredTemplate } from '@payslip/lib/store';
import { fitToView } from '@payslip/lib/fit';
import { reseedIds } from '@payslip/lib/id';
import { showToast } from '@payslip/lib/toast';
import { seedBuiltInTemplates } from '@payslip/templates/seed';
import { useCan } from '@lib/permissions';

function formatDate(ms: number): string {
  try {
    return new Date(ms).toLocaleString(undefined, { month: 'short', day: 'numeric', hour: '2-digit', minute: '2-digit' });
  } catch {
    return '';
  }
}

const STATUS_LABEL: Record<string, string> = {
  draft:             'Draft',
  pending_approval:  'Pending Approval',
  changes_requested: 'Changes Requested',
  approved:          'Approved',
};

function StatusBadge({ status }: { status: string }) {
  return (
    <span class={`dz-badge dz-status-${status}`}>
      {STATUS_LABEL[status] ?? status}
    </span>
  );
}

type BusyKind = 'update' | 'save' | 'seed' | 'submit' | 'approve' | 'request-changes' | 'create-version' | null;

export function DesignsMenu() {
  const { state, dispatch } = useDesigner();
  const active = state.savedRef;
  const [open, setOpen] = useState(false);
  const [name, setName] = useState('');
  const [items, setItems] = useState<StoredTemplate[]>([]);
  const [busy, setBusy] = useState<BusyKind>(null);
  const [reviewComment, setReviewComment] = useState('');
  const [reviewingId, setReviewingId] = useState<string | null>(null);
  const wrap = useRef<HTMLDivElement>(null);

  const canApprove = useCan('finance.payroll.templates.approve');

  const refresh = () => {
    void templateStore.list().then(setItems);
  };

  // Is the current canvas different from the saved copy of the open design?
  const currentJson = useMemo(() => JSON.stringify(state.design), [state.design]);
  const openItem = active ? items.find((i) => i.id === active.id) : undefined;
  const dirty = !!active && (!openItem || currentJson !== JSON.stringify(openItem.design));

  // Can the open template be edited in-place (draft/changes_requested)?
  const openItemEditable = openItem && ['draft', 'changes_requested'].includes(openItem.status ?? '');

  useEffect(() => {
    if (!open) return;
    refresh();
    const onDown = (e: PointerEvent) => {
      if (wrap.current && !wrap.current.contains(e.target as Node)) setOpen(false);
    };
    document.addEventListener('pointerdown', onDown, true);
    return () => document.removeEventListener('pointerdown', onDown, true);
  }, [open]);

  const updateActive = async () => {
    if (!active || busy || !dirty) return;
    setBusy('update');
    try {
      const updated = await templateStore.update(active.id, { design: state.design });
      if (updated) {
        refresh();
        showToast(`Updated "${active.name}"`);
      } else {
        showToast('Could not update — the design may have been removed.', 'error');
      }
    } catch (e) {
      showToast((e as Error)?.message || 'Could not update the design.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const saveAsNew = async () => {
    if (busy) return;
    const nm = (name || active?.name || 'Untitled').trim();
    setBusy('save');
    try {
      const entry = await templateStore.create(nm, state.design);
      dispatch({ kind: 'setSavedRef', ref: { id: entry.id, name: entry.name } });
      setName('');
      refresh();
      showToast(`Saved "${entry.name}" as draft — submit it for approval when ready.`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not save the design.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const openDesign = (item: StoredTemplate) => {
    reseedIds(item.design.elements.map((e) => e.id));
    dispatch({ kind: 'loadDesign', design: item.design, savedRef: { id: item.id, name: item.name } });
    fitToView((zoom) => dispatch({ kind: 'setView', patch: { zoom } }), item.design.page);
    setOpen(false);
    showToast(`Opened "${item.name}"`);
  };

  const remove = async (item: StoredTemplate) => {
    try {
      await templateStore.remove(item.id);
      if (active?.id === item.id) dispatch({ kind: 'setSavedRef', ref: null });
      refresh();
      showToast(`Deleted "${item.name}"`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not delete the design.', 'error');
    }
  };

  const makeDefault = async (item: StoredTemplate) => {
    try {
      await templateStore.setDefault(item.id);
      refresh();
      showToast(`"${item.name}" is now the default`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not set the default.', 'error');
    }
  };

  const submitForApproval = async (item: StoredTemplate) => {
    if (busy) return;
    setBusy('submit');
    try {
      await templateStore.submit(item.id);
      refresh();
      showToast(`"${item.name}" submitted for approval`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not submit for approval.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const approveTemplate = async (item: StoredTemplate) => {
    if (busy) return;
    setBusy('approve');
    try {
      await templateStore.approve(item.id);
      setReviewingId(null);
      setReviewComment('');
      refresh();
      showToast(`"${item.name}" approved`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not approve the template.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const requestChanges = async (item: StoredTemplate) => {
    if (busy) return;
    if (!reviewComment.trim()) {
      showToast('Please enter a reason for requesting changes.', 'error');
      return;
    }
    setBusy('request-changes');
    try {
      await templateStore.requestChanges(item.id, reviewComment.trim());
      setReviewingId(null);
      setReviewComment('');
      refresh();
      showToast(`Changes requested on "${item.name}"`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not request changes.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const createVersion = async (item: StoredTemplate) => {
    if (busy) return;
    setBusy('create-version');
    try {
      const newVer = await templateStore.createVersion(item.id);
      dispatch({ kind: 'setSavedRef', ref: { id: newVer.id, name: newVer.name } });
      refresh();
      showToast(`Created draft version ${newVer.version} of "${item.name}"`);
    } catch (e) {
      showToast((e as Error)?.message || 'Could not create a new version.', 'error');
    } finally {
      setBusy(null);
    }
  };

  const loadStarterTemplates = async () => {
    if (busy) return;
    setBusy('seed');
    try {
      await seedBuiltInTemplates();
      refresh();
      showToast('Starter templates loaded');
    } catch (e) {
      showToast((e as Error)?.message || 'Could not load starter templates.', 'error');
    } finally {
      setBusy(null);
    }
  };

  return (
    <div class="designs-menu" ref={wrap}>
      <button class={`tb-btn${open ? ' active' : ''}`} title="Saved designs" onClick={() => setOpen((o) => !o)}>
        Designs ▾
      </button>
      {open && (
        <div class="designs-pop">
          {active ? (
            <>
              <div class="dz-openrow">
                <span class="dz-openlabel">Open:</span>
                <span class="dz-openname" title={active.name}>{active.name}</span>
                {openItem && <StatusBadge status={openItem.status ?? 'draft'} />}
              </div>
              {/* Update: only for editable (draft / changes_requested) templates */}
              {openItemEditable && (
                <button
                  class="dz-update"
                  onClick={() => void updateActive()}
                  disabled={busy !== null || !dirty}
                >
                  {busy === 'update' ? 'Updating…' : dirty ? 'Update this design' : 'No changes to update'}
                </button>
              )}
              {/* Create new version: for approved templates */}
              {openItem?.status === 'approved' && (
                <button
                  class="dz-update"
                  onClick={() => void createVersion(openItem)}
                  disabled={busy !== null}
                  title="Creates a new draft version for editing — the approved template stays intact"
                >
                  {busy === 'create-version' ? 'Creating…' : 'Edit as new version'}
                </button>
              )}
              {/* Submit: for draft / changes_requested */}
              {openItem && ['draft', 'changes_requested'].includes(openItem.status ?? '') && (
                <button
                  class="dz-submit"
                  onClick={() => void submitForApproval(openItem)}
                  disabled={busy !== null}
                >
                  {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
                </button>
              )}
            </>
          ) : (
            <div class="dz-openrow dz-unsaved">Unsaved design</div>
          )}

          <div class="dz-save">
            <input
              type="text"
              placeholder={active ? 'Save as new name…' : 'Name this design…'}
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveAsNew(); }}
            />
            <button class="dz-savebtn" onClick={() => void saveAsNew()} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : active ? 'Save as new' : 'Save'}
            </button>
          </div>

          <div class="dz-head">My designs</div>
          <div class="dz-list">
            {items.length === 0 ? (
              <div class="dz-empty">
                <span>No saved designs yet.</span>
                <button
                  class="dz-seed-btn"
                  onClick={() => void loadStarterTemplates()}
                  disabled={busy !== null}
                >
                  {busy === 'seed' ? 'Loading…' : 'Load starter templates'}
                </button>
              </div>
            ) : (
              items.map((item) => (
                <div class={`dz-item${active?.id === item.id ? ' current' : ''}`} key={item.id}>
                  {/* Default star: only show/enable for approved templates */}
                  <button
                    class={`dz-star${item.isDefault ? ' on' : ''}`}
                    title={
                      item.status !== 'approved'
                        ? 'Only approved templates can be set as default'
                        : item.isDefault
                          ? 'Default template'
                          : 'Set as default'
                    }
                    onClick={() => item.status === 'approved' && void makeDefault(item)}
                    disabled={item.status !== 'approved'}
                  >
                    {item.isDefault ? '★' : '☆'}
                  </button>
                  <button class="dz-open" onClick={() => openDesign(item)}>
                    <span class="dz-name">
                      {item.name}
                      {item.version > 1 && <span class="dz-ver">v{item.version}</span>}
                      {item.isDefault && <span class="dz-badge default">default</span>}
                      {active?.id === item.id && <span class="dz-badge">open</span>}
                      <StatusBadge status={item.status ?? 'draft'} />
                    </span>
                    <span class="dz-date">{formatDate(item.updatedAt)}</span>
                  </button>
                  <div class="dz-actions">
                    {/* Submit: draft / changes_requested */}
                    {['draft', 'changes_requested'].includes(item.status ?? '') && (
                      <button
                        class="dz-action-btn dz-submit-sm"
                        title="Submit for approval"
                        disabled={busy !== null}
                        onClick={() => void submitForApproval(item)}
                      >
                        Submit
                      </button>
                    )}
                    {/* Approve / Request changes: pending_approval + user has approve perm */}
                    {item.status === 'pending_approval' && canApprove && (
                      reviewingId === item.id ? (
                        <div class="dz-review-panel">
                          <textarea
                            class="dz-review-comment"
                            placeholder="Reason for requesting changes (required for Request Changes)…"
                            value={reviewComment}
                            onInput={(e) => setReviewComment((e.target as HTMLTextAreaElement).value)}
                            rows={2}
                          />
                          <div class="dz-review-btns">
                            <button
                              class="dz-action-btn dz-approve-btn"
                              disabled={busy !== null}
                              onClick={() => void approveTemplate(item)}
                            >
                              {busy === 'approve' ? 'Approving…' : 'Approve'}
                            </button>
                            <button
                              class="dz-action-btn dz-changes-btn"
                              disabled={busy !== null || !reviewComment.trim()}
                              onClick={() => void requestChanges(item)}
                            >
                              {busy === 'request-changes' ? 'Sending…' : 'Request Changes'}
                            </button>
                            <button
                              class="dz-action-btn"
                              onClick={() => { setReviewingId(null); setReviewComment(''); }}
                            >
                              Cancel
                            </button>
                          </div>
                        </div>
                      ) : (
                        <button
                          class="dz-action-btn dz-review-btn"
                          onClick={() => setReviewingId(item.id)}
                        >
                          Review
                        </button>
                      )
                    )}
                    {/* Delete: only for draft / changes_requested (not approved/pending) */}
                    {['draft', 'changes_requested'].includes(item.status ?? '') && (
                      <button class="dz-del" title="Delete draft" onClick={() => void remove(item)}>
                        ✕
                      </button>
                    )}
                  </div>
                </div>
              ))
            )}
          </div>
        </div>
      )}
    </div>
  );
}
