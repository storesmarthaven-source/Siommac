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

// One-line "what to do next" per lifecycle stage — shown for the open design.
const STATUS_HINT: Record<string, string> = {
  draft:             'Submit it for approval when the layout is ready.',
  pending_approval:  'Waiting for the approver to review it.',
  changes_requested: 'Changes were requested — revise, then re-submit.',
  approved:          'Live. Set it as the default, edit as a new version, or retire it.',
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
  const [confirmRemoveId, setConfirmRemoveId] = useState<string | null>(null);
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

  // Delete (draft) or Retire/archive (approved) — same archive route; the backend
  // promotes the next approved template to default when an approved default retires.
  const remove = async (item: StoredTemplate) => {
    const retire = item.status === 'approved';
    setConfirmRemoveId(null);
    try {
      await templateStore.remove(item.id);
      if (active?.id === item.id) dispatch({ kind: 'setSavedRef', ref: null });
      refresh();
      showToast(`${retire ? 'Retired' : 'Deleted'} "${item.name}"`);
    } catch (e) {
      showToast((e as Error)?.message || `Could not ${retire ? 'retire' : 'delete'} the design.`, 'error');
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
          <div class="dz-header">
            <span class="dz-title">Payslip designs</span>
            <span class="dz-count">{items.length} {items.length === 1 ? 'design' : 'designs'}</span>
          </div>

          {active && openItem && (
            <div class="dz-opencard">
              <div class="dz-opencard-label">Currently open</div>
              <div class="dz-opencard-title">
                <span class="dz-opencard-name" title={active.name}>{active.name}</span>
                {openItem.version > 1 && <span class="dz-ver">v{openItem.version}</span>}
                <StatusBadge status={openItem.status ?? 'draft'} />
              </div>
              <p class="dz-hint">{STATUS_HINT[openItem.status ?? 'draft']}</p>
              <div class="dz-opencard-actions">
                {openItemEditable && dirty && (
                  <button class="dz-btn dz-btn-quiet" disabled={busy !== null} onClick={() => void updateActive()}>
                    {busy === 'update' ? 'Updating…' : 'Update this design'}
                  </button>
                )}
                {['draft', 'changes_requested'].includes(openItem.status ?? '') && (
                  <button class="dz-btn dz-btn-submit" disabled={busy !== null} onClick={() => void submitForApproval(openItem)}>
                    {busy === 'submit' ? 'Submitting…' : 'Submit for approval'}
                  </button>
                )}
                {openItem.status === 'approved' && (
                  <button class="dz-btn dz-btn-quiet" disabled={busy !== null}
                    title="Creates a new draft version — the approved design stays live until the new one is approved"
                    onClick={() => void createVersion(openItem)}>
                    {busy === 'create-version' ? 'Creating…' : 'Edit as new version'}
                  </button>
                )}
              </div>
            </div>
          )}

          <div class="dz-section">
            <div class="dz-head">All designs</div>
            {items.length === 0 ? (
              <div class="dz-empty">
                <span>No designs yet. Start from a template or save your current layout.</span>
                <button class="dz-btn dz-btn-quiet" onClick={() => void loadStarterTemplates()} disabled={busy !== null}>
                  {busy === 'seed' ? 'Loading…' : 'Load starter templates'}
                </button>
              </div>
            ) : (
              <div class="dz-list">
                {items.map((item) => {
                  const st = item.status ?? 'draft';
                  const removable = ['draft', 'changes_requested', 'approved'].includes(st);
                  return (
                    <div class={`dz-row dz-row-${st}${item.isDefault ? ' is-default' : ''}${active?.id === item.id ? ' is-open' : ''}`} key={item.id}>
                      <div class="dz-row-main">
                        <button
                          class={`dz-star${item.isDefault ? ' on' : ''}`}
                          title={st !== 'approved' ? 'Only approved designs can be the default' : item.isDefault ? 'Default design' : 'Set as default'}
                          onClick={() => st === 'approved' && void makeDefault(item)}
                          disabled={st !== 'approved'}
                          aria-label="Set as default"
                        >★</button>
                        <button class="dz-openbtn" onClick={() => openDesign(item)}>
                          <span class="dz-name">
                            {item.name}
                            {item.version > 1 && <span class="dz-ver">v{item.version}</span>}
                          </span>
                          <span class="dz-meta">{item.isDefault ? 'Default · ' : ''}{formatDate(item.updatedAt)}</span>
                        </button>
                        <StatusBadge status={st} />
                        <div class="dz-actions">
                          {['draft', 'changes_requested'].includes(st) && reviewingId !== item.id && confirmRemoveId !== item.id && (
                            <button class="dz-abtn dz-abtn-submit" disabled={busy !== null} onClick={() => void submitForApproval(item)}>
                              {busy === 'submit' ? '…' : 'Submit'}
                            </button>
                          )}
                          {st === 'pending_approval' && canApprove && reviewingId !== item.id && (
                            <button class="dz-abtn dz-abtn-review" onClick={() => { setReviewingId(item.id); setReviewComment(''); setConfirmRemoveId(null); }}>
                              Review
                            </button>
                          )}
                          {removable && reviewingId !== item.id && (
                            confirmRemoveId === item.id ? (
                              <span class="dz-confirm">
                                {st === 'approved' ? 'Retire?' : 'Delete?'}
                                <button class="dz-abtn dz-abtn-danger" disabled={busy !== null} onClick={() => void remove(item)}>Yes</button>
                                <button class="dz-abtn" onClick={() => setConfirmRemoveId(null)}>No</button>
                              </span>
                            ) : (
                              <button
                                class={`dz-abtn dz-abtn-ghost${st === 'approved' ? ' dz-abtn-retire' : ''}`}
                                title={st === 'approved' ? 'Retire (archive) this approved design' : 'Delete this draft'}
                                onClick={() => { setConfirmRemoveId(item.id); setReviewingId(null); }}>
                                {st === 'approved' ? 'Retire' : 'Delete'}
                              </button>
                            )
                          )}
                        </div>
                      </div>
                      {st === 'pending_approval' && canApprove && reviewingId === item.id && (
                        <div class="dz-review-panel">
                          <textarea
                            class="dz-review-comment"
                            placeholder="Reason (required to request changes)…"
                            value={reviewComment}
                            onInput={(e) => setReviewComment((e.target as HTMLTextAreaElement).value)}
                            rows={2}
                          />
                          <div class="dz-review-btns">
                            <button class="dz-abtn dz-abtn-approve" disabled={busy !== null} onClick={() => void approveTemplate(item)}>
                              {busy === 'approve' ? 'Approving…' : 'Approve'}
                            </button>
                            <button class="dz-abtn dz-abtn-changes" disabled={busy !== null || !reviewComment.trim()} onClick={() => void requestChanges(item)}>
                              {busy === 'request-changes' ? 'Sending…' : 'Request changes'}
                            </button>
                            <button class="dz-abtn" onClick={() => { setReviewingId(null); setReviewComment(''); }}>
                              Cancel
                            </button>
                          </div>
                        </div>
                      )}
                    </div>
                  );
                })}
              </div>
            )}
          </div>

          <div class="dz-footer">
            <input
              type="text"
              placeholder="Name a new design…"
              value={name}
              onInput={(e) => setName((e.target as HTMLInputElement).value)}
              onKeyDown={(e) => { if (e.key === 'Enter') void saveAsNew(); }}
            />
            <button class="dz-savebtn" onClick={() => void saveAsNew()} disabled={busy !== null}>
              {busy === 'save' ? 'Saving…' : active ? 'Save as new' : 'Save'}
            </button>
          </div>
        </div>
      )}
    </div>
  );
}
