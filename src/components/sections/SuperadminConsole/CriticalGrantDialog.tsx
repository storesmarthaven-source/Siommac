/**
 * CriticalGrantDialog.tsx — reason prompt for a CRITICAL permission grant.
 *
 * A critical capability is not applied on one actor's say-so: submitting this
 * dialog opens a maker-checker approval that a different authorized reviewer must
 * approve before it takes effect (backend routes/permissionApprovals.ts). Used by
 * both the Users tab (per-user override) and the Roles tab (role default).
 * `targetLabel` names what the grant is for — a role or a user — for the copy.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal } from '@shared/Modal';
import { PERMISSION_META } from '@lib/permissionMeta';

export function CriticalGrantDialog({ permKey, targetLabel, onConfirm, onCancel }: {
  permKey: string;
  targetLabel?: string;
  onConfirm: (reason: string) => void;
  onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const meta = PERMISSION_META[permKey as keyof typeof PERMISSION_META];
  const footer = (
    <>
      <button type="button" onClick={onCancel} style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
      <button type="button" onClick={() => reason.trim() && onConfirm(reason.trim())} disabled={!reason.trim()}
        style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', fontSize: '14px', fontWeight: '600', background: reason.trim() ? 'var(--siomac-navy, #1e3a5f)' : '#9ca3af', color: '#fff', cursor: reason.trim() ? 'pointer' : 'not-allowed' }}>Submit for approval</button>
    </>
  );
  return (
    <Modal open onClose={onCancel} title="Critical permission — approval required" size="sm" footer={footer}>
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        <div style={{ padding: '10px 14px', background: 'rgba(220,38,38,0.07)', border: '1px solid rgba(220,38,38,0.25)', borderRadius: '6px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '8px', marginBottom: '4px' }}>
            <i class="fas fa-shield-halved" style={{ color: 'var(--siomac-red, #dc2626)', fontSize: '14px' }} />
            <span style={{ fontWeight: 700, fontSize: '13px', color: 'var(--siomac-red, #dc2626)' }}>Critical permission</span>
          </div>
          <div style={{ fontSize: '12.5px', color: 'var(--text-secondary, #6b7280)', lineHeight: 1.5 }}>
            <strong style={{ color: 'var(--text-primary)' }}>{meta?.label ?? permKey}</strong> is a critical permission.
            Granting it{targetLabel ? ` to ${targetLabel}` : ''} requires a different authorized reviewer's approval before it takes effect.
          </div>
        </div>
        <div>
          <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
            Reason for granting this permission <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          <textarea value={reason} onInput={e => setReason((e.target as HTMLTextAreaElement).value)} rows={3} autoFocus
            placeholder="Describe why this grant is necessary and who authorised it…"
            style={{ width: '100%', boxSizing: 'border-box', padding: '8px 10px', border: '1px solid var(--border, #d1d5db)', borderRadius: '6px', fontSize: '13px', resize: 'vertical', fontFamily: 'inherit', background: 'var(--bg-input, #fff)', color: 'var(--text-primary)' }} />
          <div style={{ fontSize: '11.5px', color: 'var(--text-muted)', marginTop: '4px' }}>Shown to the authorized reviewer and recorded in the audit log.</div>
        </div>
      </div>
    </Modal>
  );
}
