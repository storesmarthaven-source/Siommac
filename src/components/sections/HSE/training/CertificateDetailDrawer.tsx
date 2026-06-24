/**
 * src/components/sections/HSE/training/CertificateDetailDrawer.tsx
 * Certificate detail: Overview · Evidence · Verification · Timeline, with
 * verify / reject / revoke / renew + evidence upload. Wired to the live API.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, DetailGrid, Tabs, type TabDef } from '@ui';
import { useCertificate, useCertificateAction, useUploadCertEvidence } from '@api/hse/training';
import { RenewCertificateDialog } from './TrainingDialogs';

type TabKey = 'overview' | 'evidence' | 'verification' | 'timeline';
const TABS: TabDef<TabKey>[] = [
  { key: 'overview', label: 'Overview' }, { key: 'evidence', label: 'Evidence' },
  { key: 'verification', label: 'Verification' }, { key: 'timeline', label: 'Timeline' },
];
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const fmtT = (iso?: string | null) => iso ? new Date(iso).toLocaleString(undefined, { day: '2-digit', month: 'short', year: '2-digit', hour: '2-digit', minute: '2-digit' }) : '—';
const CERT_PILL: Record<string, string> = {
  current: 'is-on', due_soon: 'is-warn', pending_verification: 'is-info', expired: 'is-critical',
  rejected: 'is-critical', revoked: 'is-off', archived: 'is-off', draft: 'is-off',
};
const pill = (s: string): VNode => <span class={`vt-pill ${CERT_PILL[s] ?? 'is-info'}`}>{s.replace(/_/g, ' ')}</span>;

export function CertificateDetailDrawer({ certificateId, onClose }: { certificateId: string | null; onClose: () => void }): VNode {
  const { data, isLoading } = useCertificate(certificateId);
  const action = useCertificateAction();
  const upload = useUploadCertEvidence();
  const [tab, setTab] = useState<TabKey>('overview');
  const [renewOpen, setRenewOpen] = useState(false);
  const [reasonFor, setReasonFor] = useState<'reject' | 'revoke' | null>(null);
  const [reason, setReason] = useState('');

  const d = data?.data;
  const cert = d?.certificate;
  const status = cert?.status ?? '';

  const doReason = () => {
    if (!certificateId || !reasonFor || !reason.trim()) return;
    action.mutate({ action: reasonFor, certificateId, reason: reason.trim() }, { onSuccess: () => { setReasonFor(null); setReason(''); } });
  };

  const foot = (
    <div style={{ display: 'grid', gap: '8px' }}>
      {reasonFor && (
        <div style={{ display: 'flex', gap: '6px' }}>
          <input class="ui-input" style={{ flex: 1 }} placeholder={`Reason to ${reasonFor}…`} value={reason} onInput={e => setReason((e.target as HTMLInputElement).value)} />
          <button class="hse-btn primary" disabled={!reason.trim() || action.isPending} onClick={doReason}>Confirm</button>
          <button class="hse-btn" onClick={() => { setReasonFor(null); setReason(''); }}>×</button>
        </div>
      )}
      <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
        {status === 'pending_verification' && <button class="hse-btn primary" disabled={action.isPending} onClick={() => certificateId && action.mutate({ action: 'verify', certificateId })}><i class="fas fa-check" /> Verify</button>}
        {status === 'pending_verification' && <button class="hse-btn" onClick={() => setReasonFor('reject')}><i class="fas fa-xmark" /> Reject</button>}
        {['current', 'due_soon', 'expired'].includes(status) && <button class="hse-btn primary" onClick={() => setRenewOpen(true)}><i class="fas fa-rotate" /> Renew</button>}
        {['current', 'due_soon'].includes(status) && <button class="hse-btn" onClick={() => setReasonFor('revoke')}><i class="fas fa-ban" /> Revoke</button>}
        <button class="hse-btn" onClick={onClose}>Close</button>
      </div>
    </div>
  );

  return (
    <>
      <Drawer open={!!certificateId} onClose={onClose} title={cert?.course_name ?? (isLoading ? 'Loading…' : 'Certificate')} sub={cert?.certificate_no ?? undefined} foot={foot}>
        <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>{cert ? pill(status) : null}</div>
        <Tabs<TabKey> tabs={TABS} active={tab} onChange={setTab} />

        {tab === 'overview' && cert && (
          <div style={{ marginTop: '12px' }}>
            <DetailGrid items={[
              { icon: 'fa-hashtag', label: 'Reference', value: cert.certificate_no ?? '—' },
              { icon: 'fa-user', label: 'Worker', value: cert.worker_name ?? cert.worker_id },
              { icon: 'fa-graduation-cap', label: 'Course', value: cert.course_name },
              { icon: 'fa-building', label: 'Provider', value: cert.provider ?? '—' },
              { icon: 'fa-id-card', label: 'Cert number', value: cert.certificate_number ?? '—' },
              { icon: 'fa-calendar', label: 'Issued', value: fmt(cert.issued_at) },
              { icon: 'fa-calendar-xmark', label: 'Expires', value: fmt(cert.expires_at) },
              { icon: 'fa-user-check', label: 'Verified by', value: cert.verified_by ?? '—' },
              { icon: 'fa-clock', label: 'Verified at', value: fmtT(cert.verified_at) },
            ]} hideEmpty />
          </div>
        )}

        {tab === 'evidence' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
            {certificateId && (
              <label class="hse-btn primary" style={{ justifySelf: 'start', cursor: 'pointer' }}>
                <i class="fas fa-upload" /> {upload.isPending ? 'Uploading…' : 'Attach Evidence'}
                <input type="file" style={{ display: 'none' }} accept="image/*,.pdf,.doc,.docx"
                  onChange={e => { const f = (e.target as HTMLInputElement).files?.[0]; if (f) upload.mutate({ file: f, certificateId }); (e.target as HTMLInputElement).value = ''; }} />
              </label>
            )}
            {upload.isError && <div style={{ color: 'var(--siomac-red)', fontSize: '0.78rem' }}>{(upload.error as Error)?.message ?? 'Upload failed'}</div>}
            {(d?.evidence ?? []).length === 0 && <div class="hse-muted">No evidence attached.</div>}
            {(d?.evidence ?? []).map(ev => (
              <div key={ev.id} class="vt-table-card" style={{ padding: '8px 12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
                <i class="fas fa-paperclip" style={{ color: 'var(--text-muted)' }} />
                <div style={{ flex: 1, minWidth: 0 }}><div style={{ fontSize: '0.8rem' }}>{ev.file_name}</div><div class="vt-cell-subtext">{ev.evidence_type} · {fmtT(ev.uploaded_at)}</div></div>
                {ev.url ? <a class="hse-btn" style={{ padding: '4px 10px' }} href={ev.url} target="_blank" rel="noreferrer"><i class="fas fa-download" /></a> : null}
              </div>
            ))}
          </div>
        )}

        {tab === 'verification' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
            {(d?.verifications ?? []).length === 0 && <div class="hse-muted">No verification decisions yet.</div>}
            {(d?.verifications ?? []).map(v => (
              <div key={v.id} class="vt-table-card" style={{ padding: '8px 12px' }}>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}>
                  <span class={`vt-pill ${v.decision === 'approved' ? 'is-on' : v.decision === 'rejected' ? 'is-critical' : 'is-warn'}`}>{v.decision.replace(/_/g, ' ')}</span>
                  <span class="hse-muted">{fmtT(v.verified_at)}</span>
                </div>
                {v.comments ? <div class="vt-cell-subtext" style={{ marginTop: '4px' }}>{v.comments}</div> : null}
              </div>
            ))}
          </div>
        )}

        {tab === 'timeline' && (
          <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
            {(d?.audit ?? []).length === 0 && <div class="hse-muted">No activity yet.</div>}
            {(d?.audit ?? []).map(e => (
              <div key={e.id} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.78rem', padding: '6px 0', borderBottom: '1px solid var(--border)' }}>
                <span style={{ textTransform: 'capitalize' }}>{e.action.replace(/_/g, ' ')}</span><span class="hse-muted">{fmtT(e.created_at)}</span>
              </div>
            ))}
          </div>
        )}
      </Drawer>

      {certificateId && <RenewCertificateDialog certificateId={certificateId} open={renewOpen} onClose={() => setRenewOpen(false)} />}
    </>
  );
}
