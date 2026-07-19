/**
 * ComplianceRevokeDialog.tsx — reason prompt for REVOKING compliance access.
 *
 * Compliance read/export are grant/revoke capabilities, not allow/deny toggles.
 * Revoking one is a sensitive action: the backend requires a reason AND fresh
 * step-up verification (routes/superadmin.ts clearUserPermission compliance
 * branch). This dialog collects the reason; the caller wraps the submit in
 * step-up. The backend guard remains the security boundary.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal } from '@shared/Modal';
import { PERMISSION_META } from '@lib/permissionMeta';

export function ComplianceRevokeDialog({ permKey, targetLabel, onConfirm, onCancel }: {
  permKey: string;
  targetLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const meta = PERMISSION_META[permKey as keyof typeof PERMISSION_META] as
    | (typeof PERMISSION_META)[keyof typeof PERMISSION_META] | undefined;

  const canSubmit = reason.trim().length > 0;
  const footer = (
    <>
      <button type="button" onClick={onCancel} style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
      <button type="button" onClick={() => canSubmit && onConfirm(reason.trim())} disabled={!canSubmit}
        style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', fontSize: '14px', fontWeight: '600', background: canSubmit ? 'var(--siomac-red, #dc2626)' : '#9ca3af', color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed' }}>Revoke access</button>
    </>
  );
  return (
    <Modal open onClose={onCancel} title="Revoke compliance access" size="sm" footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <i class="fas fa-shield-halved" style={{ color: 'var(--siomac-red, #dc2626)', fontSize: '14px' }} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--siomac-red, #dc2626)' }}>Revoke compliance access</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary, #6b7280)', lineHeight: 1.5 }}>
            Revoking <strong style={{ color: 'var(--text-primary)' }}>{meta?.label ?? permKey}</strong>
            {targetLabel ? ` from ${targetLabel}` : ''} takes effect immediately and requires step-up
            verification. This is audited.
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Reason for revoking <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          <textarea value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} rows={3} autoFocus
            placeholder="Describe why this access is being revoked…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--border, #d1d5db)', borderRadius: '6px', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg-input, #fff)', color: 'var(--text-primary)' }} />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Recorded in the audit log and shown on the revocation.</div>
        </div>
      </div>
    </Modal>
  );
}
