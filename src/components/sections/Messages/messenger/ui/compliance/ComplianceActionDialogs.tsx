/**
 * ComplianceActionDialogs.tsx
 *
 * The case/grant/export action dialogs: Decide (approve/reject), Close, Revoke,
 * Export. Each reuses the Messenger Dialog primitive, gates on server
 * capabilities at the call site, raises a toast, and (Decide/Export) runs the
 * application's step-up flow before a sensitive mutation. Idempotency keys are
 * generated once per opened submission (handoff §6.3/§6.6).
 */

import { useEffect, useState } from 'preact/hooks';
import { Dialog } from '../components/Dialog';
import { toast } from '@ui/toast';
import { useStepUp } from '@/hooks/useStepUp';
import {
  useDecideComplianceCase, useCloseComplianceCase,
  useRevokeComplianceGrant, useCreateComplianceExport,
} from '@api/communicationsCompliance';
import type { ComplianceExportFormat } from '../../../../../../../types/messagingCompliance';
import { ShieldCheck, ShieldX, Download, LockKeyhole } from '../components/icons';

function errText(e: unknown): string {
  return e instanceof Error ? e.message : 'The action could not be completed.';
}

// ── Decide (approve / reject) ────────────────────────────────────────────────
export function DecideComplianceCaseDialog(
  { open, caseId, caseNo, onClose }: { open: boolean; caseId: string; caseNo: string; onClose: () => void },
) {
  const { ensureStepUp } = useStepUp();
  const decide = useDecideComplianceCase();
  const [reason, setReason] = useState('');
  const [idemKey, setIdemKey] = useState('');

  useEffect(() => { if (open) { setReason(''); setIdemKey(crypto.randomUUID()); } }, [open]);

  async function submit(decision: 'approve' | 'reject') {
    if (decision === 'reject' && reason.trim().length < 4) { toast.error('A reason is required to reject.'); return; }
    if (!(await ensureStepUp())) { toast.error('Step-up verification is required to decide a case.'); return; }
    try {
      await decide.mutateAsync({ caseId, decision, reason: reason.trim(), idempotencyKey: idemKey });
      toast.success(decision === 'approve' ? `Case ${caseNo} approved.` : `Case ${caseNo} rejected.`);
      onClose();
    } catch (e) { toast.error(errText(e)); }
  }

  return (
    <Dialog open={open} title={`Decide ${caseNo}`} description="Approve or reject this investigation. This decision is audited." icon={<ShieldCheck />} onClose={onClose}>
      <div className="smc-form">
        <label className="smc-field">
          <span>Decision reason <em>(required to reject)</em></span>
          <textarea rows={3} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} placeholder="Rationale for the decision" />
        </label>
        <p className="smc-form__note"><LockKeyhole /> A fresh step-up verification is required before this takes effect.</p>
        <div className="smc-form__actions">
          <button type="button" className="smc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="smc-btn smc-btn--danger" disabled={decide.isPending} onClick={() => void submit('reject')}>Reject</button>
          <button type="button" className="smc-btn smc-btn--primary" disabled={decide.isPending} onClick={() => void submit('approve')}>Approve</button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Close ────────────────────────────────────────────────────────────────────
export function CloseComplianceCaseDialog(
  { open, caseId, caseNo, onClose }: { open: boolean; caseId: string; caseNo: string; onClose: () => void },
) {
  const close = useCloseComplianceCase();
  const [reason, setReason] = useState('');
  const [idemKey, setIdemKey] = useState('');
  useEffect(() => { if (open) { setReason(''); setIdemKey(crypto.randomUUID()); } }, [open]);

  async function submit() {
    if (reason.trim().length < 4) { toast.error('A closing reason is required.'); return; }
    try {
      await close.mutateAsync({ caseId, reason: reason.trim(), idempotencyKey: idemKey });
      toast.success(`Case ${caseNo} closed.`);
      onClose();
    } catch (e) { toast.error(errText(e)); }
  }

  return (
    <Dialog open={open} title={`Close ${caseNo}`} description="Closing ends active access. Legal holds are not released automatically." icon={<ShieldCheck />} onClose={onClose} size="small">
      <div className="smc-form">
        <label className="smc-field">
          <span>Closing reason <em>(required)</em></span>
          <textarea rows={3} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} placeholder="Why this investigation is being closed" />
        </label>
        <div className="smc-form__actions">
          <button type="button" className="smc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="smc-btn smc-btn--danger" disabled={close.isPending} onClick={() => void submit()}>Close case</button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Revoke grant ─────────────────────────────────────────────────────────────
export function RevokeComplianceGrantDialog(
  { open, grantId, conversationTitle, onClose }:
  { open: boolean; grantId: string; conversationTitle: string; onClose: () => void },
) {
  const revoke = useRevokeComplianceGrant();
  const [reason, setReason] = useState('');
  const [idemKey, setIdemKey] = useState('');
  useEffect(() => { if (open) { setReason(''); setIdemKey(crypto.randomUUID()); } }, [open]);

  async function submit() {
    if (reason.trim().length < 4) { toast.error('A revocation reason is required.'); return; }
    try {
      await revoke.mutateAsync({ grantId, reason: reason.trim(), idempotencyKey: idemKey });
      toast.success('Access revoked. Further reads and downloads are blocked.');
      onClose();
    } catch (e) { toast.error(errText(e)); }
  }

  return (
    <Dialog open={open} title="Revoke access" description={`Immediately end access to “${conversationTitle}”.`} icon={<ShieldX />} onClose={onClose} size="small">
      <div className="smc-form">
        <label className="smc-field">
          <span>Revocation reason <em>(required)</em></span>
          <textarea rows={3} value={reason} onInput={(e) => setReason((e.target as HTMLTextAreaElement).value)} placeholder="Why this access is being revoked" />
        </label>
        <div className="smc-form__actions">
          <button type="button" className="smc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="smc-btn smc-btn--danger" disabled={revoke.isPending} onClick={() => void submit()}>Revoke access</button>
        </div>
      </div>
    </Dialog>
  );
}

// ── Export ───────────────────────────────────────────────────────────────────
export function ComplianceExportDialog(
  { open, caseId, caseNo, threadId, conversationTitle, onClose }:
  { open: boolean; caseId: string; caseNo: string; threadId: string; conversationTitle: string; onClose: () => void },
) {
  const { ensureStepUp } = useStepUp();
  const createExport = useCreateComplianceExport();
  const [format, setFormat] = useState<ComplianceExportFormat>('pdf');
  const [purpose, setPurpose] = useState('');
  const [ack, setAck] = useState(false);
  const [idemKey, setIdemKey] = useState('');

  // One idempotency key per opened submission (reused across retries; regenerated on re-open).
  useEffect(() => {
    if (open) { setFormat('pdf'); setPurpose(''); setAck(false); setIdemKey(crypto.randomUUID()); }
  }, [open]);

  async function submit() {
    if (purpose.trim().length < 4) { toast.error('A purpose is required for the export.'); return; }
    if (!ack) { toast.error('Please acknowledge the chain-of-custody notice.'); return; }
    if (!(await ensureStepUp())) { toast.error('Step-up verification is required to export.'); return; }
    try {
      await createExport.mutateAsync({ caseId, threadId, format, purpose: purpose.trim(), acknowledgement: ack, idempotencyKey: idemKey });
      toast.success('Export queued. It will appear under the case when ready.');
      onClose();
    } catch (e) { toast.error(errText(e)); }
  }

  return (
    <Dialog open={open} title="Export conversation" description={`Case-scoped evidence export for ${caseNo}.`} icon={<Download />} onClose={onClose}>
      <div className="smc-form">
        <div className="smc-form__ro">
          <div><span>Case</span><strong>{caseNo}</strong></div>
          <div><span>Conversation</span><strong>{conversationTitle}</strong></div>
        </div>
        <fieldset className="smc-field smc-field--inline">
          <span>Format</span>
          <label><input type="radio" name="smc-exp-fmt" checked={format === 'pdf'} onChange={() => setFormat('pdf')} /> PDF report</label>
          <label><input type="radio" name="smc-exp-fmt" checked={format === 'json'} onChange={() => setFormat('json')} /> JSON manifest</label>
        </fieldset>
        <label className="smc-field">
          <span>Purpose <em>(required)</em></span>
          <input type="text" value={purpose} onInput={(e) => setPurpose((e.target as HTMLInputElement).value)} placeholder="e.g. Investigation evidence for INV-2026-0042" />
        </label>
        <label className="smc-field smc-field--check">
          <input type="checkbox" checked={ack} onChange={(e) => setAck((e.target as HTMLInputElement).checked)} />
          <span>I acknowledge this export is recorded in the chain of custody and is retained as immutable evidence.</span>
        </label>
        <p className="smc-form__note"><LockKeyhole /> Requires a fresh step-up. The download link is short-lived and audited.</p>
        <div className="smc-form__actions">
          <button type="button" className="smc-btn" onClick={onClose}>Cancel</button>
          <button type="button" className="smc-btn smc-btn--primary" disabled={createExport.isPending || !purpose.trim() || !ack} onClick={() => void submit()}>Queue export</button>
        </div>
      </div>
    </Dialog>
  );
}
