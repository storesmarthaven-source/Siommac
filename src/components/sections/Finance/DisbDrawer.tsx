/**
 * src/components/sections/Finance/DisbDrawer.tsx
 *
 * Tabbed detail drawer for a Disbursement record.
 * Tabs: Summary · Lines · Bank File · Bank Accounts · Approvals · Payments · Timeline · Audit · Related Payroll Run
 *
 * Lifecycle actions live in the footer, state-aware + permission-gated.
 */

import { type VNode } from 'preact';
import { useState, useEffect } from 'preact/hooks';
import { toast } from '@store';
import { Drawer, HrfinPill, type HrfinTone } from '@ui';
import {
  useDisbursement,
  useDisbursementLinesDetail,
  useDisbursementBankFiles,
  useDisbursementMutation,
  useDisbursementAuditLog,
  financeDisbursementsApi,
  type Disbursement,
  type DisbursementStatus,
} from '@api/finance/disbursements';
import { usePayrollRun } from '@api/finance/payroll';
import {
  useFinanceAttachments,
  useFinanceAttachmentUploadUrl,
  useCompleteFinanceAttachment,
  useFinanceAttachmentSignedUrl,
  useDeleteFinanceAttachment,
} from '@api/finance/attachments';
import { EmployeeCell, EmployeeCellResolved } from './_shared/EmployeeCell';
import { useEmployeeNames } from '@api/finance/lookups';
import { money } from './hrfinFormat';
import { HrfinIcon } from '@ui';

// ── Date helpers ─────────────────────────────────────────────────────────────

const fmtDate = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }) : '—';
const fmtDateTime = (iso: string | null | undefined): string =>
  iso ? new Date(iso).toLocaleString('en-GB', { day: '2-digit', month: 'short', hour: '2-digit', minute: '2-digit' }) : '—';
const humanize = (s: string): string =>
  s.replace(/[_]/g, ' ').replace(/\b\w/g, m => m.toUpperCase());

// ── Status → pill tone ────────────────────────────────────────────────────────

function statusTone(s: DisbursementStatus): HrfinTone {
  switch (s) {
    case 'paid': return 'ok';
    case 'approved': return 'ok';
    case 'file_generated': return 'nu';
    case 'submitted': return 'wn';
    case 'draft': return 'dr';
    case 'cancelled': return 'bad';
    default: return 'dr';
  }
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

export type DisbDrawerTab = 'summary' | 'lines' | 'bank-file' | 'bank-accounts' | 'approvals' | 'payments' | 'timeline' | 'audit' | 'payroll-run';
type Tab = DisbDrawerTab;
const TABS: { key: Tab; label: string }[] = [
  { key: 'summary',       label: 'Summary' },
  { key: 'lines',         label: 'Lines' },
  { key: 'bank-file',     label: 'Bank File' },
  { key: 'bank-accounts', label: 'Bank Accounts' },
  { key: 'approvals',     label: 'Approvals' },
  { key: 'payments',      label: 'Payments' },
  { key: 'timeline',      label: 'Timeline' },
  { key: 'audit',         label: 'Audit' },
  { key: 'payroll-run',   label: 'Related Run' },
];

// ── Summary tab ───────────────────────────────────────────────────────────────

function SummaryTab({ d }: { d: Disbursement }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Reference</span><b>{d.disbursementNo}</b></div>
      <div class="hrfin-metric-row"><span>Status</span><HrfinPill tone={statusTone(d.status)}>{humanize(d.status)}</HrfinPill></div>
      <div class="hrfin-metric-row"><span>Total amount</span><b>{money(d.totalAmount)}</b></div>
      <div class="hrfin-metric-row"><span>Currency</span><b>{d.currency}</b></div>
      <div class="hrfin-metric-row"><span>Employees</span><b>{d.employeeCount}</b></div>
      <div class="hrfin-metric-row"><span>Created</span><b>{fmtDate(d.createdAt)}</b></div>
      {d.createdBy && (
        <div class="hrfin-metric-row"><span>Created by</span><EmployeeCell employeeId={d.createdBy} /></div>
      )}
      {d.approvedBy && (
        <div class="hrfin-metric-row"><span>Approved by</span><EmployeeCell employeeId={d.approvedBy} /></div>
      )}
      {d.cancelReason && (
        <div class="hrfin-metric-row"><span>Cancel reason</span><b style={{ color: 'var(--danger, #d33)' }}>{d.cancelReason}</b></div>
      )}
      {d.bankFilePath && (
        <div class="hrfin-metric-row"><span>Bank file</span><b style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all' }}>{d.bankFilePath}</b></div>
      )}
    </div>
  );
}

// ── Lines tab ─────────────────────────────────────────────────────────────────

function LinesTab({ disbursementId }: { disbursementId: string }): VNode {
  const linesQ = useDisbursementLinesDetail(disbursementId);
  const lines = linesQ.data ?? [];
  const allIds = lines.map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allIds);

  if (linesQ.isLoading) return <div class="hrfin-empty">Loading lines…</div>;
  if (linesQ.error) return <div class="hrfin-callout is-danger"><HrfinIcon name="alert" /><span>{(linesQ.error).message}</span></div>;
  if (lines.length === 0) return <div class="hrfin-empty">No lines found.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-alt, rgba(255,255,255,.04))' }}>
            <th style={{ padding: '7px 12px', textAlign: 'left' }}>Employee</th>
            <th style={{ padding: '7px 12px', textAlign: 'left' }}>Bank / Account</th>
            <th style={{ padding: '7px 12px', textAlign: 'right' }}>Net Pay</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px' }}>
                <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>
                {l.bankName ? (
                  <span>{l.bankName}{l.accountNumberMasked ? ` · ${l.accountNumberMasked}` : ''}</span>
                ) : (
                  <HrfinPill tone="bad">No bank account</HrfinPill>
                )}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                {money(l.netAmount)}
              </td>
            </tr>
          ))}
        </tbody>
        <tfoot>
          <tr style={{ borderTop: '2px solid var(--border)' }}>
            <td colSpan={2} style={{ padding: '8px 12px', fontWeight: 600 }}>Total</td>
            <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 500 }}>
              {money(lines.reduce((s, l) => s + l.netAmount, 0))}
            </td>
          </tr>
        </tfoot>
      </table>
    </div>
  );
}

// ── Bank File tab ─────────────────────────────────────────────────────────────

function BankFileTab({ d }: { d: Disbursement }): VNode {
  const getUrl = useDisbursementMutation(financeDisbursementsApi.bankFileUrl);
  const getFileUrl = useDisbursementMutation(financeDisbursementsApi.bankFileDownload);
  const bankFilesQ = useDisbursementBankFiles(d.bankFilePath ? d.id : null);
  const bankFiles = bankFilesQ.data ?? [];
  const attachQ = useFinanceAttachments('disbursement', d.id, !!d.id);
  const uploadUrlMut = useFinanceAttachmentUploadUrl();
  const completeMut = useCompleteFinanceAttachment();
  const signedUrlMut = useFinanceAttachmentSignedUrl();
  const deleteMut = useDeleteFinanceAttachment();

  async function handleDownload(): Promise<void> {
    try {
      const res = await getUrl.mutateAsync({ disbursementId: d.id });
      window.open(res.signedUrl, '_blank');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to generate download link.');
    }
  }

  async function handleDownloadBankFile(bankFileId: string): Promise<void> {
    try {
      const res = await getFileUrl.mutateAsync({ bankFileId });
      window.open(res.signedUrl, '_blank');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to generate download link.');
    }
  }

  async function handleUploadSupport(file: File): Promise<void> {
    try {
      const urlRes = await uploadUrlMut.mutateAsync({
        entityType: 'disbursement',
        entityId: d.id,
        fileName: file.name,
        mimeType: file.type || 'application/octet-stream',
      });
      await fetch(urlRes.uploadUrl, { method: 'PUT', body: file, headers: { 'Content-Type': file.type || 'application/octet-stream' } });
      await completeMut.mutateAsync({
        entityType: 'disbursement',
        entityId: d.id,
        fileName: file.name,
        storagePath: urlRes.path,
        mimeType: file.type,
        fileSize: file.size,
      });
      toast('Support document attached.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Upload failed.');
    }
  }

  async function handleViewAttachment(storagePath: string): Promise<void> {
    try {
      const url = await signedUrlMut.mutateAsync({ entityType: 'disbursement', entityId: d.id, storagePath });
      window.open(url, '_blank');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Failed to generate link.');
    }
  }

  if (!d.bankFilePath) {
    return (
      <div class="hrfin-empty" style={{ textAlign: 'center', padding: 24 }}>
        <HrfinIcon name="file" />
        <p>No bank file generated yet. Generate the bank file from the Disbursements tab once this disbursement is approved.</p>
      </div>
    );
  }

  const fileName = d.bankFilePath.split('/').pop() ?? d.bankFilePath;

  return (
    <div>
      {/* Manifest card — index of every per-bank file */}
      <div class="hrfin-callout is-info" style={{ marginBottom: 16 }}>
        <HrfinIcon name="file" />
        <div style={{ flex: 1 }}>
          <strong>{fileName}</strong>
          <div style={{ fontSize: 11, color: 'var(--muted)', marginTop: 2 }}>
            Manifest (index of per-bank files) · Status: {humanize(d.status)}
          </div>
        </div>
        <button
          type="button"
          class="hrfin-action is-primary"
          onClick={() => void handleDownload()}
          disabled={getUrl.isPending}
        >
          <HrfinIcon name="download" />
          {getUrl.isPending ? 'Generating link…' : 'Download manifest'}
        </button>
      </div>

      {/* Per-bank direct-credit files */}
      <div style={{ marginBottom: 8 }}>
        <p class="hrfin-wiz-label" style={{ marginBottom: 8 }}>Per-bank direct-credit files</p>
      </div>
      {bankFilesQ.isLoading && <div class="hrfin-empty">Loading bank files…</div>}
      {!bankFilesQ.isLoading && bankFiles.length === 0 && (
        <p class="hse-muted" style={{ fontSize: 12, marginBottom: 16 }}>No per-bank files recorded for this disbursement.</p>
      )}
      {bankFiles.length > 0 && (
        <div style={{ overflowX: 'auto', marginBottom: 16 }}>
          <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
            <thead>
              <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-alt, rgba(255,255,255,.04))' }}>
                <th style={{ padding: '7px 12px', textAlign: 'left' }}>Bank</th>
                <th style={{ padding: '7px 12px', textAlign: 'center' }}>Employees</th>
                <th style={{ padding: '7px 12px', textAlign: 'right' }}>Total</th>
                <th style={{ padding: '7px 12px', textAlign: 'right' }}>Action</th>
              </tr>
            </thead>
            <tbody>
              {bankFiles.map(bf => (
                <tr key={bf.id} style={{ borderBottom: '1px solid var(--border)' }}>
                  <td style={{ padding: '8px 12px' }}>
                    <strong>{bf.bankName}</strong>
                    <span style={{ color: 'var(--muted)', fontSize: 11, marginLeft: 6 }}>{bf.bankCode}</span>
                    {bf.checksum && (
                      <div style={{ fontSize: 10, color: 'var(--muted)', fontFamily: 'monospace' }}>
                        sha256 {bf.checksum.slice(0, 12)}…
                      </div>
                    )}
                  </td>
                  <td style={{ padding: '8px 12px', textAlign: 'center', color: 'var(--muted)' }}>{bf.employeeCount}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>{money(bf.totalAmount)}</td>
                  <td style={{ padding: '8px 12px', textAlign: 'right' }}>
                    <button
                      type="button"
                      class="hrfin-action"
                      onClick={() => void handleDownloadBankFile(bf.id)}
                      disabled={getFileUrl.isPending}
                    >
                      <HrfinIcon name="download" /> Download
                    </button>
                  </td>
                </tr>
              ))}
            </tbody>
            <tfoot>
              <tr style={{ borderTop: '2px solid var(--border)' }}>
                <td style={{ padding: '8px 12px', fontWeight: 600 }}>Total</td>
                <td style={{ padding: '8px 12px', textAlign: 'center', fontWeight: 600 }}>
                  {bankFiles.reduce((s, bf) => s + bf.employeeCount, 0)}
                </td>
                <td style={{ padding: '8px 12px', textAlign: 'right', fontWeight: 600 }}>
                  {money(bankFiles.reduce((s, bf) => s + bf.totalAmount, 0))}
                </td>
                <td />
              </tr>
            </tfoot>
          </table>
        </div>
      )}

      {/* Support attachments */}
      <div style={{ marginBottom: 8 }}>
        <p class="hrfin-wiz-label" style={{ marginBottom: 8 }}>Support documents</p>
        <label class="hrfin-action" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center', gap: 6 }}>
          <HrfinIcon name="upload" />
          <span>Attach document</span>
          <input
            type="file"
            style={{ display: 'none' }}
            accept=".pdf,.csv,.xlsx,.png,.jpg"
            onChange={e => {
              const f = (e.currentTarget).files?.[0];
              if (f) void handleUploadSupport(f);
            }}
          />
        </label>
      </div>

      {attachQ.isLoading && <div class="hrfin-empty">Loading attachments…</div>}
      {!attachQ.isLoading && (attachQ.data ?? []).length === 0 && (
        <p class="hse-muted" style={{ fontSize: 12, marginTop: 8 }}>No support documents attached.</p>
      )}
      {(attachQ.data ?? []).map(att => (
        <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--border)' }}>
          <HrfinIcon name="file" />
          <span style={{ flex: 1, fontSize: 13 }}>{att.fileName}</span>
          <button
            type="button"
            class="hrfin-action"
            onClick={() => void handleViewAttachment(att.storagePath)}
            disabled={signedUrlMut.isPending}
          >
            View
          </button>
          <button
            type="button"
            class="hrfin-action is-danger"
            onClick={() => void deleteMut.mutateAsync({ id: att.id, entityType: 'disbursement', entityId: d.id })}
            disabled={deleteMut.isPending}
          >
            Remove
          </button>
        </div>
      ))}
    </div>
  );
}

// ── Bank Accounts tab ─────────────────────────────────────────────────────────

function BankAccountsTab({ d }: { d: Disbursement }): VNode {
  const linesQ = useDisbursementLinesDetail(d.id);
  const lines = linesQ.data ?? [];
  const allEmpIds = lines.map(l => l.employeeId);
  const { data: nameMap } = useEmployeeNames(allEmpIds);

  if (linesQ.isLoading) return <div class="hrfin-empty">Loading…</div>;
  if (lines.length === 0) return <div class="hrfin-empty">No disbursement lines found.</div>;

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 13 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-alt, rgba(255,255,255,.04))' }}>
            <th style={{ padding: '7px 12px', textAlign: 'left' }}>Employee</th>
            <th style={{ padding: '7px 12px', textAlign: 'left' }}>Bank</th>
            <th style={{ padding: '7px 12px', textAlign: 'left' }}>Masked Account</th>
            <th style={{ padding: '7px 12px', textAlign: 'center' }}>Status</th>
          </tr>
        </thead>
        <tbody>
          {lines.map(l => (
            <tr key={l.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '8px 12px' }}>
                <EmployeeCellResolved resolved={nameMap?.get(l.employeeId)} fallbackId={l.employeeId} />
              </td>
              <td style={{ padding: '8px 12px', color: 'var(--muted)', fontSize: 12 }}>
                {l.bankName ?? '—'}
              </td>
              <td style={{ padding: '8px 12px', fontFamily: 'monospace', fontSize: 12 }}>
                {l.accountNumberMasked ?? '—'}
              </td>
              <td style={{ padding: '8px 12px', textAlign: 'center' }}>
                {l.bankAccountId
                  ? <HrfinPill tone="ok">Ready</HrfinPill>
                  : <HrfinPill tone="bad">Missing</HrfinPill>
                }
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Approvals tab ─────────────────────────────────────────────────────────────

function ApprovalsTab({ d }: { d: Disbursement }): VNode {
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row">
        <span>Created by</span>
        <EmployeeCell employeeId={d.createdBy} />
      </div>
      <div class="hrfin-metric-row">
        <span>Created at</span>
        <b>{fmtDateTime(d.createdAt)}</b>
      </div>
      <div class="hrfin-metric-row">
        <span>Approved by</span>
        {d.approvedBy
          ? <EmployeeCell employeeId={d.approvedBy} />
          : <span class="hse-muted">Pending</span>
        }
      </div>
      {d.cancelledBy && (
        <div class="hrfin-metric-row">
          <span>Cancelled by</span>
          <EmployeeCell employeeId={d.cancelledBy} />
        </div>
      )}
      {d.cancelReason && (
        <div class="hrfin-metric-row">
          <span>Cancel reason</span>
          <b>{d.cancelReason}</b>
        </div>
      )}
      {d.workflowId && (
        <div class="hrfin-metric-row">
          <span>Workflow</span>
          <b style={{ fontSize: 11, fontFamily: 'monospace' }}>{d.workflowId.slice(0, 8)}…</b>
        </div>
      )}
      <div style={{ marginTop: 16 }}>
        <p class="hrfin-wiz-label" style={{ marginBottom: 8 }}>Approval workflow (Separation of Duties)</p>
        <div class="hrfin-callout is-info">
          <HrfinIcon name="check" />
          <span>
            The creator and approver must be different finance managers. Creator submits →
            a different finance_manager approves. This is enforced server-side on every approval.
          </span>
        </div>
      </div>
    </div>
  );
}

// ── Payments tab ──────────────────────────────────────────────────────────────

function PaymentsTab({ d }: { d: Disbursement }): VNode {
  return (
    <div>
      {d.status === 'paid' ? (
        <div class="hrfin-callout is-info">
          <HrfinIcon name="check" />
          <span>This disbursement has been marked as paid. Bank file was processed and employees have been paid.</span>
        </div>
      ) : d.status === 'file_generated' ? (
        <div class="hrfin-callout is-warning">
          <HrfinIcon name="clock" />
          <span>Bank file generated — awaiting bank processing confirmation. Mark as paid once confirmed.</span>
        </div>
      ) : (
        <div class="hrfin-empty">
          Payments recorded here once the disbursement reaches <strong>paid</strong> status.
        </div>
      )}

      {(d.status === 'paid' || d.status === 'file_generated') && (
        <div class="hrfin-metric-list" style={{ marginTop: 16 }}>
          <div class="hrfin-metric-row"><span>Total paid</span><b>{money(d.totalAmount)}</b></div>
          <div class="hrfin-metric-row"><span>Currency</span><b>{d.currency}</b></div>
          <div class="hrfin-metric-row"><span>Employees paid</span><b>{d.employeeCount}</b></div>
        </div>
      )}
    </div>
  );
}

// ── Timeline tab ──────────────────────────────────────────────────────────────

function TimelineTab({ d }: { d: Disbursement }): VNode {
  // Real timestamps are stored in metadata at each state transition (server-side).
  const meta = d.metadata as Record<string, string | null | undefined>;
  const events: { label: string; date: string | null; active: boolean }[] = [
    { label: 'Created (Draft)',     date: d.createdAt,                active: true },
    { label: 'Submitted',           date: meta.submittedAt ?? null,   active: ['submitted', 'approved', 'file_generated', 'paid'].includes(d.status) },
    { label: 'Approved',            date: meta.approvedAt ?? null,    active: ['approved', 'file_generated', 'paid'].includes(d.status) },
    { label: 'Bank File Generated', date: meta.fileGeneratedAt ?? null, active: ['file_generated', 'paid'].includes(d.status) },
    { label: 'Paid',                date: meta.paidAt ?? null,        active: d.status === 'paid' },
  ];

  return (
    <div>
      {events.map((ev, i) => (
        <div key={i} style={{ display: 'flex', gap: 12, marginBottom: 12 }}>
          <div style={{ display: 'flex', flexDirection: 'column', alignItems: 'center' }}>
            <div style={{ width: 12, height: 12, borderRadius: '50%', background: ev.active ? 'var(--ok, #2c9e5b)' : 'var(--muted)', flexShrink: 0, marginTop: 3 }} />
            {i < events.length - 1 && <div style={{ width: 2, flex: 1, background: 'var(--border)', marginTop: 2 }} />}
          </div>
          <div style={{ paddingBottom: 12 }}>
            <div style={{ fontWeight: ev.active ? 600 : 400, color: ev.active ? 'var(--text)' : 'var(--muted)' }}>{ev.label}</div>
            {ev.date && <div style={{ fontSize: 11, color: 'var(--muted)' }}>{fmtDateTime(ev.date)}</div>}
          </div>
        </div>
      ))}
    </div>
  );
}

// ── Audit tab ─────────────────────────────────────────────────────────────────

function AuditTab({ d }: { d: Disbursement }): VNode {
  const auditQ = useDisbursementAuditLog(d.id);
  const entries = auditQ.data ?? [];

  if (auditQ.isLoading) return <div class="hrfin-empty">Loading audit log…</div>;
  if (auditQ.error) return (
    <div class="hrfin-callout is-danger">
      <HrfinIcon name="alert" />
      <span>{(auditQ.error).message}</span>
    </div>
  );
  if (entries.length === 0) return <div class="hrfin-empty">No audit entries yet.</div>;

  const humanizeAction = (a: string) =>
    a.replace(/^disbursement\./, '').replace(/\./g, ' → ').replace(/_/g, ' ')
     .replace(/\b\w/g, m => m.toUpperCase());

  return (
    <div style={{ overflowX: 'auto' }}>
      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
        <thead>
          <tr style={{ borderBottom: '1px solid var(--border)', background: 'var(--surface-alt, rgba(255,255,255,.04))' }}>
            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Date / Time</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Action</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Changed By</th>
            <th style={{ padding: '6px 10px', textAlign: 'left', fontWeight: 600 }}>Notes</th>
          </tr>
        </thead>
        <tbody>
          {entries.map(e => (
            <tr key={e.id} style={{ borderBottom: '1px solid var(--border)' }}>
              <td style={{ padding: '7px 10px', color: 'var(--muted)', whiteSpace: 'nowrap' }}>
                {fmtDateTime(e.createdAt)}
              </td>
              <td style={{ padding: '7px 10px', fontWeight: 500 }}>
                {humanizeAction(e.action)}
              </td>
              <td style={{ padding: '7px 10px' }}>
                <EmployeeCell employeeId={e.actorId} />
              </td>
              <td style={{ padding: '7px 10px', color: 'var(--muted)', fontSize: 11 }}>
                {e.reason ?? '—'}
              </td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

// ── Related Payroll Run tab ───────────────────────────────────────────────────

function RelatedRunTab({ d }: { d: Disbursement }): VNode {
  const runQ = usePayrollRun(d.payrollRunId);
  const run  = runQ.data;

  if (runQ.isLoading) return <div class="hrfin-empty">Loading payroll run…</div>;
  if (runQ.error) return (
    <div class="hrfin-callout is-danger">
      <HrfinIcon name="alert" />
      <span>{(runQ.error).message}</span>
    </div>
  );
  if (!run) return <div class="hrfin-empty">Payroll run not found.</div>;

  const fmtMonth = (m: string) =>
    m ? new Date(m + 'T00:00:00').toLocaleDateString('en-GB', { month: 'long', year: 'numeric' }) : '—';

  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Run reference</span><b style={{ fontFamily: 'monospace' }}>{run.runNo}</b></div>
      <div class="hrfin-metric-row"><span>Period</span><b>{fmtMonth(run.periodMonth)}</b></div>
      <div class="hrfin-metric-row">
        <span>Status</span>
        <HrfinPill tone={run.status === 'approved' || run.status === 'locked' ? 'ok' : 'dr'}>
          {humanize(run.status)}
        </HrfinPill>
      </div>
      <div class="hrfin-metric-row"><span>Employees</span><b>{run.employeeCount}</b></div>
      {run.lockedAt && (
        <div class="hrfin-metric-row"><span>Locked at</span><b>{fmtDateTime(run.lockedAt)}</b></div>
      )}
      {run.exportedAt && (
        <div class="hrfin-metric-row"><span>Exported at</span><b>{fmtDateTime(run.exportedAt)}</b></div>
      )}
      <div class="hrfin-metric-row">
        <span>Run ID</span>
        <b style={{ fontSize: 11, fontFamily: 'monospace', wordBreak: 'break-all', color: 'var(--muted)' }}>
          {d.payrollRunId}
        </b>
      </div>
    </div>
  );
}

// ── DisbDrawer ────────────────────────────────────────────────────────────────

export interface DisbDrawerActions {
  onSubmit:       (d: Disbursement) => void;
  onApprove:      (d: Disbursement) => void;
  onGenerateFile: (d: Disbursement) => void;
  onMarkPaid:     (d: Disbursement) => void;
  onCancel:       (d: Disbursement) => void;
}

export function DisbDrawer({
  disbursementId,
  open,
  onClose,
  canManage,
  canApprove,
  actions,
  initialTab = 'summary',
}: {
  disbursementId: string | null;
  open: boolean;
  onClose: () => void;
  canManage: boolean;
  canApprove: boolean;
  actions: DisbDrawerActions;
  initialTab?: Tab;
}): VNode {
  const [tab, setTab] = useState<Tab>(initialTab);
  // When the drawer (re)opens for a record, honour the requested initial tab.
  useEffect(() => { if (open) setTab(initialTab); }, [open, disbursementId, initialTab]);
  const dQ = useDisbursement(open ? disbursementId : null);
  const d = dQ.data;

  return (
    <Drawer
      open={open}
      onClose={onClose}
      panelClass="hrfin"
      title={d?.disbursementNo ?? 'Disbursement'}
      sub={d ? `${d.employeeCount} employees · ${d.currency} · ${humanize(d.status)}` : ''}
      foot={d ? (
        <div style={{ display: 'flex', gap: 9, width: '100%', flexWrap: 'wrap' }}>
          {canManage && d.status === 'draft' && (
            <button class="hrfin-action is-primary" onClick={() => actions.onSubmit(d)}>
              <HrfinIcon name="send" /> Submit
            </button>
          )}
          {canApprove && d.status === 'submitted' && (
            <button class="hrfin-action is-primary" onClick={() => actions.onApprove(d)}>
              <HrfinIcon name="check" /> Approve
            </button>
          )}
          {canApprove && d.status === 'approved' && (
            <button class="hrfin-action is-primary" onClick={() => actions.onGenerateFile(d)}>
              <HrfinIcon name="file" /> Generate Bank File
            </button>
          )}
          {canApprove && d.status === 'file_generated' && (
            <button class="hrfin-action is-primary" onClick={() => actions.onMarkPaid(d)}>
              <HrfinIcon name="check" /> Mark Paid
            </button>
          )}
          {canManage && ['draft', 'submitted'].includes(d.status) && (
            <button
              class="hrfin-action is-danger"
              style={{ marginLeft: 'auto' }}
              onClick={() => actions.onCancel(d)}
            >
              Cancel
            </button>
          )}
        </div>
      ) : undefined}
    >
      {!d ? (
        <div class="hrfin"><div class="hrfin-empty">Loading…</div></div>
      ) : (
        <div class="hrfin">
          {/* Amount + status header */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <strong style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-.035em' }}>
              {money(d.totalAmount)}
            </strong>
            <HrfinPill tone={statusTone(d.status)}>{humanize(d.status)}</HrfinPill>
          </div>

          {/* Tab bar */}
          <div class="hrfin-tabs" style={{ marginBottom: 14, flexWrap: 'wrap' }}>
            {TABS.map(t => (
              <button
                key={t.key}
                type="button"
                class={t.key === tab ? 'is-active' : ''}
                onClick={() => setTab(t.key)}
              >
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'summary'       && <SummaryTab d={d} />}
          {tab === 'lines'         && <LinesTab disbursementId={d.id} />}
          {tab === 'bank-file'     && <BankFileTab d={d} />}
          {tab === 'bank-accounts' && <BankAccountsTab d={d} />}
          {tab === 'approvals'     && <ApprovalsTab d={d} />}
          {tab === 'payments'      && <PaymentsTab d={d} />}
          {tab === 'timeline'      && <TimelineTab d={d} />}
          {tab === 'audit'         && <AuditTab d={d} />}
          {tab === 'payroll-run'   && <RelatedRunTab d={d} />}
        </div>
      )}
    </Drawer>
  );
}
