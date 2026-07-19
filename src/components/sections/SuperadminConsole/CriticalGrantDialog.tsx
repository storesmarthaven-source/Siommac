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
import { COMPLIANCE_GATED_KEYS } from '@lib/permissions';

/** Grant validity a compliance capability carries; passed back on confirm. */
export interface GrantValidity { validFrom: string; validUntil: string }

/** Format a Date as a `datetime-local` value (local wall-clock, minute precision). */
function toLocalInput(d: Date): string {
  const pad = (n: number) => String(n).padStart(2, '0');
  return `${d.getFullYear()}-${pad(d.getMonth() + 1)}-${pad(d.getDate())}T${pad(d.getHours())}:${pad(d.getMinutes())}`;
}

export function CriticalGrantDialog({ permKey, targetLabel, onConfirm, onCancel }: {
  permKey: string;
  targetLabel?: string;
  onConfirm: (reason: string, validity?: GrantValidity) => void;
  onCancel: () => void;
}): VNode {
  const [reason, setReason] = useState('');
  const meta = PERMISSION_META[permKey as keyof typeof PERMISSION_META] as
    | (typeof PERMISSION_META)[keyof typeof PERMISSION_META] | undefined;

  // Compliance capabilities are time-boxed — the backend REQUIRES a start/end
  // window (valid_from >= now-5m, <= now+30d; window <= 90d), so collect it here.
  const isCompliance = COMPLIANCE_GATED_KEYS.has(permKey);
  const [validFromL, setValidFromL] = useState(() => toLocalInput(new Date()));
  const [validUntilL, setValidUntilL] = useState(() => toLocalInput(new Date(Date.now() + 7 * 24 * 60 * 60 * 1000)));

  // Render-pure validation only (no clock reads during render): required + end>start.
  // The exact window bounds (start not in the past, <=30d out, window <=90d) are
  // enforced server-side and surfaced as an error toast on submit.
  const fromMs = new Date(validFromL).getTime();
  const untilMs = new Date(validUntilL).getTime();
  const windowError: string | null = !isCompliance ? null
    : !validFromL || !validUntilL ? 'A start and end time are required.'
    : !Number.isFinite(fromMs) || !Number.isFinite(untilMs) ? 'Enter a valid start and end time.'
    : untilMs <= fromMs ? 'The end time must be after the start time.'
    : null;

  const canSubmit = reason.trim().length > 0 && !windowError;
  const submit = () => {
    if (!canSubmit) return;
    onConfirm(
      reason.trim(),
      isCompliance
        ? { validFrom: new Date(validFromL).toISOString(), validUntil: new Date(validUntilL).toISOString() }
        : undefined,
    );
  };

  const footer = (
    <>
      <button type="button" onClick={onCancel} style={{ padding: '8px 20px', background: '#f3f4f6', color: '#374151', border: '1px solid #d1d5db', borderRadius: '6px', cursor: 'pointer', fontSize: '14px', fontWeight: '500' }}>Cancel</button>
      <button type="button" onClick={submit} disabled={!canSubmit}
        style={{ padding: '8px 20px', borderRadius: '6px', border: 'none', fontSize: '14px', fontWeight: '600', background: canSubmit ? 'var(--siomac-navy, #1e3a5f)' : '#9ca3af', color: '#fff', cursor: canSubmit ? 'pointer' : 'not-allowed' }}>Submit for approval</button>
    </>
  );
  const inputStyle = { width: '100%', boxSizing: 'border-box' as const, padding: '8px 10px', border: '1px solid var(--border, #d1d5db)', borderRadius: '6px', fontSize: '13px', fontFamily: 'inherit', background: 'var(--bg-input, #fff)', color: 'var(--text-primary)' };
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

        {isCompliance && (
          <div>
            <label style={{ display: 'block', fontSize: '13px', fontWeight: 600, color: 'var(--text-primary)', marginBottom: '6px' }}>
              Access window <span style={{ color: 'var(--siomac-red)' }}>*</span>
            </label>
            <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '10px' }}>
              <div>
                <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '3px' }}>Start</span>
                <input type="datetime-local" value={validFromL} onInput={e => setValidFromL((e.target as HTMLInputElement).value)} style={inputStyle} />
              </div>
              <div>
                <span style={{ display: 'block', fontSize: '11.5px', color: 'var(--text-muted)', marginBottom: '3px' }}>End</span>
                <input type="datetime-local" value={validUntilL} onInput={e => setValidUntilL((e.target as HTMLInputElement).value)} style={inputStyle} />
              </div>
            </div>
            <div style={{ fontSize: '11.5px', color: windowError ? 'var(--siomac-red, #dc2626)' : 'var(--text-muted)', marginTop: '4px' }}>
              {windowError ?? 'Compliance access is time-boxed; it auto-expires at the end time (max 90 days).'}
            </div>
          </div>
        )}
      </div>
    </Modal>
  );
}
