/**
 * src/components/sections/HSE/ptw/dialogs/PermitLifecycleDialogs.tsx
 *
 * All PTW lifecycle action dialogs in one file (they are small).
 * Mirrors the Risk/JSA DrawerActions pattern: Modal + usePermitTransition.
 *
 * Exported:
 *   ApprovePermitDialog, RejectPermitDialog, RequestChangesDialog,
 *   ActivatePermitDialog, SuspendPermitDialog, RevalidateDialog,
 *   ExtensionRequestDialog, CloseoutDialog, CancelPermitDialog
 */

import { useState } from 'preact/hooks';
import { type VNode } from 'preact';
import { Modal, Field, TextInput, TextareaInput, FormGrid } from '@ui';
import { usePermitTransition } from '@api/hse/ptw';

// ── Shared helper ─────────────────────────────────────────────────────────────

function DialogError({ message }: { message: string }): VNode {
  return (
    <div style={{ color: 'var(--siomac-red)', fontSize: '0.78rem', marginTop: '8px', padding: '8px 10px', background: 'rgba(220,38,38,.08)', borderRadius: '6px', border: '1px solid rgba(220,38,38,.18)' }}>
      <i class="fas fa-exclamation-triangle" style={{ marginRight: '6px' }} />{message}
    </div>
  );
}

// ── Approve ───────────────────────────────────────────────────────────────────

export interface ApprovePermitDialogProps {
  open:      boolean;
  onClose:   () => void;
  permitId:  string;
  permitNo:  string;
}

export function ApprovePermitDialog({ open, onClose, permitId, permitNo }: ApprovePermitDialogProps): VNode | null {
  const [note, setNote] = useState('');
  const [error, setError] = useState('');
  const t = usePermitTransition();

  function handleClose() { setNote(''); setError(''); onClose(); }

  async function handleSubmit() {
    setError('');
    try {
      await t.mutateAsync({ action: 'approve', permitId, note: note || undefined });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to approve permit.');
    }
  }

  return (
    <Modal open={open} title={`Approve ${permitNo}`} icon="fa-circle-check" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Approving…' : 'Approve Permit'} submitDisabled={t.isPending}>
      <FormGrid>
        <Field label="Approval note (optional)" wide>
          <TextareaInput value={note} onInput={setNote} rows={3} placeholder="Approval conditions or comments…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Reject ────────────────────────────────────────────────────────────────────

export interface RejectPermitDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function RejectPermitDialog({ open, onClose, permitId, permitNo }: RejectPermitDialogProps): VNode | null {
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');
  const t = usePermitTransition();

  function handleClose() { setReason(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required to reject this permit.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'reject', permitId, note: reason });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to reject permit.');
    }
  }

  return (
    <Modal open={open} title={`Reject ${permitNo}`} icon="fa-ban" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Rejecting…' : 'Reject Permit'} submitDisabled={t.isPending}>
      <FormGrid>
        <Field label="Reason for rejection *" wide>
          <TextareaInput value={reason} onInput={setReason} rows={3} placeholder="State clearly why this permit cannot be approved…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Request Changes ───────────────────────────────────────────────────────────

export interface RequestChangesDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function RequestChangesDialog({ open, onClose, permitId, permitNo }: RequestChangesDialogProps): VNode | null {
  const [note,  setNote]  = useState('');
  const [error, setError] = useState('');
  const t = usePermitTransition();

  function handleClose() { setNote(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!note.trim()) { setError('Please describe what changes are required.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'request-changes', permitId, note });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request changes.');
    }
  }

  return (
    <Modal open={open} title={`Request Changes — ${permitNo}`} icon="fa-rotate-left" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Sending…' : 'Send Back for Changes'} submitDisabled={t.isPending}>
      <FormGrid>
        <Field label="Required changes *" wide>
          <TextareaInput value={note} onInput={setNote} rows={3} placeholder="What must be updated or corrected before re-submission…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Activate (with activation-gate failure handling) ──────────────────────────

/** Each missing requirement returned by the backend on gate failure. */
interface MissingReq { requirement: string; detail?: string | null; }

export interface ActivatePermitDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function ActivatePermitDialog({ open, onClose, permitId, permitNo }: ActivatePermitDialogProps): VNode | null {
  const [note,       setNote]       = useState('');
  const [error,      setError]      = useState('');
  const [missing,    setMissing]    = useState<MissingReq[]>([]);
  const [override,   setOverride]   = useState(false);
  const t = usePermitTransition();

  function handleClose() { setNote(''); setError(''); setMissing([]); setOverride(false); onClose(); }

  async function handleSubmit() {
    setError(''); setMissing([]);
    try {
      const res = await t.mutateAsync({ action: 'activate', permitId, note: note || undefined });
      // Backend may return a failure payload (success=false) with missing requirements
      const data = res as unknown as { success: boolean; missing?: MissingReq[]; message?: string };
      if (!data.success) {
        if (data.missing && data.missing.length > 0) {
          setMissing(data.missing);
        } else {
          setError(data.message ?? 'Activation gate check failed.');
        }
        return;
      }
      handleClose();
    } catch (e) {
      // Try to parse structured error from backend
      const msg = e instanceof Error ? e.message : '';
      try {
        const parsed = JSON.parse(msg) as { missing?: MissingReq[]; message?: string };
        if (parsed.missing && parsed.missing.length > 0) {
          setMissing(parsed.missing);
          return;
        }
      } catch { /* not JSON */ }
      setError(msg || 'Failed to activate permit.');
    }
  }

  const hasMissing = missing.length > 0;

  return (
    <Modal open={open} title={`Activate ${permitNo}`} icon="fa-circle-play" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Activating…' : hasMissing && override ? 'Activate with Override' : 'Activate Permit'}
      submitDisabled={t.isPending || (hasMissing && !override)}>
      <FormGrid>
        {!hasMissing && (
          <>
            <Field label="Activation note (optional)" wide>
              <TextareaInput value={note} onInput={setNote} rows={2} placeholder="Final pre-activation checks confirmed…" />
            </Field>
            <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
              <i class="fas fa-circle-check" style={{ marginRight: '6px', color: 'var(--color-success)' }} />
              Activating this permit authorises work to commence. Ensure all pre-conditions are met.
            </div>
          </>
        )}

        {hasMissing && (
          <div style={{ gridColumn: '1 / -1' }}>
            <div style={{ fontWeight: 700, fontSize: '0.82rem', marginBottom: '8px', color: 'var(--siomac-red)' }}>
              <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
              Activation gate failed — missing requirements:
            </div>
            <div style={{ display: 'grid', gap: '6px', marginBottom: '12px' }}>
              {missing.map((m, i) => (
                <div key={i} style={{ padding: '8px 12px', background: 'rgba(220,38,38,.07)', borderRadius: '6px', border: '1px solid rgba(220,38,38,.2)', fontSize: '0.82rem' }}>
                  <div style={{ fontWeight: 600, color: 'var(--siomac-red)' }}>{m.requirement}</div>
                  {m.detail && <div style={{ fontSize: '0.75rem', color: 'var(--text-muted)', marginTop: '2px' }}>{m.detail}</div>}
                </div>
              ))}
            </div>
            <label style={{ display: 'flex', alignItems: 'flex-start', gap: '8px', cursor: 'pointer', fontSize: '0.82rem', padding: '10px 12px', background: 'rgba(245,158,11,.08)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.25)' }}>
              <input type="checkbox" checked={override} onChange={e => setOverride((e.target as HTMLInputElement).checked)} style={{ marginTop: '2px', flexShrink: 0 }} />
              <div>
                <strong style={{ color: '#92400e' }}>Override and activate anyway</strong>
                <div style={{ color: 'var(--text-muted)', fontSize: '0.73rem', marginTop: '2px' }}>
                  This override is recorded in the audit trail. Only authorised personnel may override activation gates.
                </div>
              </div>
            </label>
            {override && (
              <div style={{ marginTop: '10px' }}>
                <Field label="Override justification *" wide>
                  <TextareaInput value={note} onInput={setNote} rows={2} placeholder="State the reason for overriding the activation gate…" />
                </Field>
              </div>
            )}
          </div>
        )}

        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Suspend ───────────────────────────────────────────────────────────────────

export interface SuspendPermitDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function SuspendPermitDialog({ open, onClose, permitId, permitNo }: SuspendPermitDialogProps): VNode | null {
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');
  const t = usePermitTransition();

  function handleClose() { setReason(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required to suspend this permit.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'suspend', permitId, note: reason });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to suspend permit.');
    }
  }

  return (
    <Modal open={open} title={`Suspend ${permitNo}`} icon="fa-circle-pause" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Suspending…' : 'Suspend Permit'} submitDisabled={t.isPending}>
      <FormGrid>
        <Field label="Reason for suspension *" wide>
          <TextareaInput value={reason} onInput={setReason} rows={3} placeholder="Describe the condition or event requiring work suspension…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Revalidate ────────────────────────────────────────────────────────────────

export interface RevalidateDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function RevalidateDialog({ open, onClose, permitId, permitNo }: RevalidateDialogProps): VNode | null {
  const [note,  setNote]  = useState('');
  const [error, setError] = useState('');
  const t = usePermitTransition();

  function handleClose() { setNote(''); setError(''); onClose(); }

  async function handleSubmit() {
    setError('');
    try {
      await t.mutateAsync({ action: 'revalidate', permitId, note: note || undefined });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to revalidate permit.');
    }
  }

  return (
    <Modal open={open} title={`Revalidate ${permitNo}`} icon="fa-rotate" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Revalidating…' : 'Revalidate Permit'} submitDisabled={t.isPending}>
      <FormGrid>
        <div style={{ gridColumn: '1 / -1', fontSize: '0.82rem', color: 'var(--text-muted)', padding: '8px 10px', background: 'var(--surface-alt)', borderRadius: '8px' }}>
          <i class="fas fa-rotate" style={{ marginRight: '6px' }} />
          Revalidating will restore the permit to <strong>active</strong> status. Confirm all conditions that led to suspension have been resolved.
        </div>
        <Field label="Revalidation note (optional)" wide>
          <TextareaInput value={note} onInput={setNote} rows={2} placeholder="Conditions resolved, work may safely recommence…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Extension Request ─────────────────────────────────────────────────────────

export interface ExtensionRequestDialogProps {
  open:          boolean;
  onClose:       () => void;
  permitId:      string;
  permitNo:      string;
  currentEndDt?: string | null;
}

export function ExtensionRequestDialog({ open, onClose, permitId, permitNo, currentEndDt }: ExtensionRequestDialogProps): VNode | null {
  const [newEndDt, setNewEndDt] = useState('');
  const [reason,   setReason]   = useState('');
  const [error,    setError]    = useState('');
  const t = usePermitTransition();

  function handleClose() { setNewEndDt(''); setReason(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!newEndDt) { setError('A new end date/time is required.'); return; }
    if (!reason.trim()) { setError('A reason for extension is required.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'request-extension', permitId, note: JSON.stringify({ newEndDatetime: new Date(newEndDt).toISOString(), reason }) });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to request extension.');
    }
  }

  return (
    <Modal open={open} title={`Request Extension — ${permitNo}`} icon="fa-clock-rotate-left" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Submitting…' : 'Submit Extension Request'} submitDisabled={t.isPending}>
      <FormGrid>
        {currentEndDt && (
          <div style={{ gridColumn: '1 / -1', fontSize: '0.8rem', color: 'var(--text-muted)' }}>
            Current expiry: <strong>{new Date(currentEndDt).toLocaleString()}</strong>
          </div>
        )}
        <Field label="New end date/time *">
          <TextInput type="datetime-local" value={newEndDt} onInput={setNewEndDt} />
        </Field>
        <Field label="Reason for extension *" wide>
          <TextareaInput value={reason} onInput={setReason} rows={3} placeholder="Why is additional time required…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Closeout ──────────────────────────────────────────────────────────────────

export interface CloseoutDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function CloseoutDialog({ open, onClose, permitId, permitNo }: CloseoutDialogProps): VNode | null {
  const [siteRestored,    setSiteRestored]    = useState(false);
  const [isolationsRemoved, setIsolationsRemoved] = useState(false);
  const [toolsAccounted,  setToolsAccounted]  = useState(false);
  const [personnelExited, setPersonnelExited] = useState(false);
  const [completionNote,  setCompletionNote]  = useState('');
  const [error,           setError]           = useState('');
  const t = usePermitTransition();

  const allChecked = siteRestored && isolationsRemoved && toolsAccounted && personnelExited;

  function handleClose() {
    setSiteRestored(false); setIsolationsRemoved(false);
    setToolsAccounted(false); setPersonnelExited(false);
    setCompletionNote(''); setError(''); onClose();
  }

  async function handleSubmit() {
    if (!allChecked) { setError('All closeout items must be confirmed before closing.'); return; }
    if (!completionNote.trim()) { setError('Completion notes are required to close out the permit.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'close', permitId, note: completionNote });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to close permit.');
    }
  }

  const checkItem = (label: string, checked: boolean, onChange: (v: boolean) => void) => (
    <label style={{ display: 'flex', alignItems: 'center', gap: '10px', cursor: 'pointer', padding: '8px 10px', borderRadius: '6px', border: `1px solid ${checked ? 'rgba(34,197,94,.3)' : 'var(--border)'}`, background: checked ? 'rgba(34,197,94,.06)' : 'transparent', fontSize: '0.82rem', transition: 'all .15s' }}>
      <input type="checkbox" checked={checked} onChange={e => onChange((e.target as HTMLInputElement).checked)} style={{ accentColor: 'var(--color-success)', width: '15px', height: '15px', flexShrink: 0 }} />
      <span style={{ color: checked ? 'var(--color-success)' : 'var(--text-body)' }}>{label}</span>
    </label>
  );

  return (
    <Modal open={open} title={`Close Out ${permitNo}`} icon="fa-flag-checkered" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Closing…' : 'Close Permit'} submitDisabled={t.isPending || !allChecked}>
      <FormGrid>
        <div style={{ gridColumn: '1 / -1', display: 'grid', gap: '6px' }}>
          <div style={{ fontSize: '0.72rem', fontWeight: 700, color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '0.05em', marginBottom: '4px' }}>
            Closeout Checklist
          </div>
          {checkItem('Work site restored to safe condition', siteRestored, setSiteRestored)}
          {checkItem('All isolations removed / de-energised', isolationsRemoved, setIsolationsRemoved)}
          {checkItem('All tools and equipment accounted for', toolsAccounted, setToolsAccounted)}
          {checkItem('All personnel have exited the work area', personnelExited, setPersonnelExited)}
        </div>
        <Field label="Completion notes *" wide>
          <TextareaInput value={completionNote} onInput={setCompletionNote} rows={3} placeholder="Summary of work completed, conditions at closeout…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}

// ── Cancel ────────────────────────────────────────────────────────────────────

export interface CancelPermitDialogProps {
  open:     boolean;
  onClose:  () => void;
  permitId: string;
  permitNo: string;
}

export function CancelPermitDialog({ open, onClose, permitId, permitNo }: CancelPermitDialogProps): VNode | null {
  const [reason, setReason] = useState('');
  const [error,  setError]  = useState('');
  const t = usePermitTransition();

  function handleClose() { setReason(''); setError(''); onClose(); }

  async function handleSubmit() {
    if (!reason.trim()) { setError('A reason is required to cancel this permit.'); return; }
    setError('');
    try {
      await t.mutateAsync({ action: 'cancel', permitId, note: reason });
      handleClose();
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Failed to cancel permit.');
    }
  }

  return (
    <Modal open={open} title={`Cancel ${permitNo}`} icon="fa-xmark-circle" size="sm"
      onClose={handleClose} onSubmit={() => void handleSubmit()}
      submitLabel={t.isPending ? 'Cancelling…' : 'Cancel Permit'} submitDisabled={t.isPending}>
      <FormGrid>
        <div style={{ gridColumn: '1 / -1', fontSize: '0.82rem', color: '#92400e', padding: '8px 12px', background: 'rgba(245,158,11,.08)', borderRadius: '8px', border: '1px solid rgba(245,158,11,.2)' }}>
          <i class="fas fa-triangle-exclamation" style={{ marginRight: '6px' }} />
          Cancelling is permanent. The permit can no longer be worked on.
        </div>
        <Field label="Reason for cancellation *" wide>
          <TextareaInput value={reason} onInput={setReason} rows={3} placeholder="Why is this permit being cancelled…" />
        </Field>
        {error && <DialogError message={error} />}
      </FormGrid>
    </Modal>
  );
}
