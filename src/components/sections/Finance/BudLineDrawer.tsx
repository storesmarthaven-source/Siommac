/**
 * src/components/sections/Finance/BudLineDrawer.tsx
 *
 * Tabbed detail drawer for a budget line — Aurora `.hrfin` style.
 * Tabs: Summary · Actuals Composition · Variance Trend · Related Transactions ·
 *       Approvals · Timeline · Audit · Attachments
 */

import { type VNode } from 'preact';
import { useState, useRef } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { Drawer } from '@ui';
import { HrfinPill, TrendArea, type HrfinTone } from '@ui';
import {
  useBudgetDetail,
  useBudgetLineActuals,
  useBudgetLineApprovals,
  useBudgetLineAuditLog,
  useBudgetLineAttachments,
  financeBudgetsApi,
  financeBudgetsKeys,
  type BudgetLine,
  type CostEntryRow,
  type BudgetActualsResult,
  type BudgetApprovalTask,
  type BudgetAuditEntry,
  type BudgetAttachmentDto,
} from '@api/finance/budgets';
import { money, moneyCompact } from './hrfinFormat';
import { EmployeeCell } from './_shared/EmployeeCell';

// ── Helpers ───────────────────────────────────────────────────────────────────

const MONTHS = ['Jan','Feb','Mar','Apr','May','Jun','Jul','Aug','Sep','Oct','Nov','Dec'];

function fmtDate(iso: string | null | undefined): string {
  if (!iso) return '—';
  return new Date(iso).toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtBytes(n: number | null | undefined): string {
  if (!n) return '';
  if (n < 1024) return `${n} B`;
  if (n < 1024 * 1024) return `${(n / 1024).toFixed(1)} KB`;
  return `${(n / (1024 * 1024)).toFixed(1)} MB`;
}

function varianceTone(line: BudgetLine): HrfinTone {
  if (!line.budgeted) return 'nu';
  const pct = line.variancePct ?? 0;
  if (pct >= 0) return 'ok';           // under budget — good
  if (pct >= -10) return 'wn';         // 0-10% over — warning
  return 'bad';                         // >10% over — danger
}

function varianceLabel(line: BudgetLine): string {
  const pct = line.variancePct;
  if (pct == null) return 'N/A';
  if (pct >= 0) return `${pct.toFixed(1)}% under`;
  return `${Math.abs(pct).toFixed(1)}% over`;
}

function approvalTone(status: string): HrfinTone {
  if (status === 'approved' || status === 'completed') return 'ok';
  if (status === 'rejected') return 'bad';
  if (status === 'pending') return 'wn';
  return 'nu';
}

// ── Tab definitions ───────────────────────────────────────────────────────────

type DrawerTab = 'summary' | 'actuals' | 'trend' | 'related' | 'approvals' | 'timeline' | 'audit' | 'attachments';
const TABS: { key: DrawerTab; label: string }[] = [
  { key: 'summary',     label: 'Summary' },
  { key: 'actuals',     label: 'Actuals' },
  { key: 'trend',       label: 'Variance Trend' },
  { key: 'related',     label: 'Related Txns' },
  { key: 'approvals',   label: 'Approvals' },
  { key: 'timeline',    label: 'Timeline' },
  { key: 'audit',       label: 'Audit' },
  { key: 'attachments', label: 'Attachments' },
];

// ── Sub-panels ────────────────────────────────────────────────────────────────

function SummaryTab({ line }: { line: BudgetLine }): VNode {
  const tone = varianceTone(line);
  return (
    <div class="hrfin-metric-list">
      <div class="hrfin-metric-row"><span>Cost centre</span><b>{line.costCenterName ?? line.costCenterId}</b></div>
      <div class="hrfin-metric-row"><span>Category</span><b>{line.category}</b></div>
      {line.label && <div class="hrfin-metric-row"><span>Label</span><b>{line.label}</b></div>}
      <div class="hrfin-metric-row"><span>Fiscal year</span><b>FY {line.fiscalYear}</b></div>
      {line.period && <div class="hrfin-metric-row"><span>Period</span><b>{line.period}</b></div>}
      <div class="hrfin-metric-row"><span>Currency</span><b>{line.currency}</b></div>
      <div class="hrfin-metric-row"><span>Budgeted</span><b style={{ fontSize: 16 }}>{money(line.budgeted)}</b></div>
      <div class="hrfin-metric-row"><span>Actual spend</span><b style={{ fontSize: 16 }}>{money(line.actual)}</b></div>
      <div class="hrfin-metric-row">
        <span>Variance</span>
        <b>
          <HrfinPill tone={tone}>{money(line.variance)} ({varianceLabel(line)})</HrfinPill>
        </b>
      </div>
      {line.notes && (
        <div style={{ marginTop: 12, padding: '10px 12px', background: 'var(--hrfin-surface-2)', borderRadius: 6 }}>
          <div style={{ fontSize: 11, color: 'var(--hrfin-muted)', marginBottom: 4 }}>Notes</div>
          <div style={{ fontSize: 13 }}>{line.notes}</div>
        </div>
      )}
      <div class="hrfin-metric-row" style={{ marginTop: 12 }}><span>Created</span><b>{fmtDate(line.createdAt)}</b></div>
      {line.createdBy && (
        <div class="hrfin-metric-row">
          <span>Created by</span>
          <b><EmployeeCell employeeId={line.createdBy} /></b>
        </div>
      )}
      {line.updatedAt && <div class="hrfin-metric-row"><span>Last updated</span><b>{fmtDate(line.updatedAt)}</b></div>}
    </div>
  );
}

function ActualsTab({ lineId, actualsQ }: {
  lineId: string;
  actualsQ: ReturnType<typeof useBudgetLineActuals>;
}): VNode {
  void lineId;
  if (actualsQ.isLoading) return <div class="hrfin-empty">Loading actuals…</div>;
  if (actualsQ.error) return <div class="hrfin-empty" style={{ color: 'var(--hrfin-danger)' }}>Failed to load actuals.</div>;
  const result = actualsQ.data;
  if (!result) return <div class="hrfin-empty">No actuals data.</div>;
  const { entries, totalActual } = result;
  if (!entries.length) return <div class="hrfin-empty">No approved cost entries found for this budget line.</div>;

  // Group by source module for summary
  const byModule = new Map<string, number>();
  for (const e of entries) byModule.set(e.sourceModule, (byModule.get(e.sourceModule) ?? 0) + e.amount);
  const moduleRows = [...byModule.entries()].sort((a, b) => b[1] - a[1]);

  return (
    <div>
      {/* Module breakdown */}
      <div style={{ marginBottom: 14 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          By Source Module
        </div>
        {moduleRows.map(([mod, amt]) => (
          <div key={mod} style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'center', padding: '6px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
            <span style={{ fontSize: 13 }}>{mod.replace(/_/g, ' ')}</span>
            <span style={{ fontSize: 13, fontWeight: 600 }}>{money(amt)}</span>
          </div>
        ))}
        <div style={{ display: 'flex', justifyContent: 'space-between', marginTop: 8, fontWeight: 500 }}>
          <span>Total</span>
          <span>{money(totalActual)}</span>
        </div>
      </div>

      {/* Entry table */}
      <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
        Cost Entries ({entries.length})
      </div>
      <div style={{ overflowX: 'auto' }}>
        <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
          <thead>
            <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
              <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--hrfin-muted)' }}>Ref</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Module</th>
              <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Date</th>
              <th style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--hrfin-muted)' }}>Amount</th>
            </tr>
          </thead>
          <tbody>
            {entries.map(e => (
              <tr key={e.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                <td style={{ padding: '5px 8px 5px 0', fontFamily: 'monospace', fontSize: 11 }}>{e.ref ?? e.id.slice(0, 8)}</td>
                <td style={{ padding: '5px 8px', color: 'var(--hrfin-muted)' }}>{e.sourceModule.replace(/_/g, ' ')}</td>
                <td style={{ padding: '5px 8px' }}>{fmtDate(e.createdAt)}</td>
                <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', fontWeight: 600 }}>{money(e.amount)}</td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function VarianceTrendTab({ line, actualsQ }: {
  line: BudgetLine;
  actualsQ: ReturnType<typeof useBudgetLineActuals>;
}): VNode {
  if (actualsQ.isLoading) return <div class="hrfin-empty">Loading trend data…</div>;
  const result = actualsQ.data;
  if (!result?.byMonth.length) {
    return <div class="hrfin-empty">No monthly data available for FY {line.fiscalYear}.</div>;
  }

  const { byMonth } = result;
  // Monthly budget = total budget / 12
  const monthlyBudget = line.budgeted / 12;
  // Only show months with data
  const relevantMonths = byMonth.map(m => m.month);
  const labels = relevantMonths.map(m => MONTHS[m - 1] ?? '');

  return (
    <div>
      <div style={{ marginBottom: 12 }}>
        <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 6, textTransform: 'uppercase', letterSpacing: '.05em' }}>
          Monthly Actual vs Budget (FY {line.fiscalYear})
        </div>
        <TrendArea
          labels={labels}
          seriesA={byMonth.map(m => m.amount)}
          seriesB={relevantMonths.map(() => monthlyBudget)}
          title="Monthly Actual vs Budget"
          seriesALabel="Actual"
          seriesBLabel="Budget/mo"
        />
      </div>

      <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12, marginTop: 8 }}>
        <thead>
          <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
            <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--hrfin-muted)' }}>Month</th>
            <th style={{ textAlign: 'right', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Actual</th>
            <th style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--hrfin-muted)' }}>Budget/mo</th>
          </tr>
        </thead>
        <tbody>
          {byMonth.map(m => (
            <tr key={m.month} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
              <td style={{ padding: '5px 8px 5px 0' }}>{MONTHS[m.month - 1]}</td>
              <td style={{ padding: '5px 8px', textAlign: 'right', fontWeight: 600 }}>{money(m.amount)}</td>
              <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', color: 'var(--hrfin-muted)' }}>{moneyCompact(monthlyBudget)}</td>
            </tr>
          ))}
        </tbody>
      </table>
    </div>
  );
}

/**
 * Related Transactions — live data from finance_cost_entries via useBudgetLineActuals.
 * Entries are grouped by sourceModule and surfaced as a real transaction table.
 */
function RelatedTransactionsTab({ actualsQ }: {
  actualsQ: ReturnType<typeof useBudgetLineActuals>;
}): VNode {
  if (actualsQ.isLoading) return <div class="hrfin-empty">Loading related transactions…</div>;
  if (actualsQ.error) return <div class="hrfin-empty" style={{ color: 'var(--hrfin-danger)' }}>Failed to load related transactions.</div>;

  const result = actualsQ.data;
  const entries: CostEntryRow[] = result?.entries ?? [];

  if (!entries.length) {
    return (
      <div class="hrfin-empty">
        No related cost entries are linked to this budget line yet.
      </div>
    );
  }

  // Group by sourceModule
  const byModule = new Map<string, CostEntryRow[]>();
  for (const e of entries) {
    const g = byModule.get(e.sourceModule) ?? [];
    g.push(e);
    byModule.set(e.sourceModule, g);
  }

  return (
    <div>
      {[...byModule.entries()].map(([mod, rows]) => (
        <div key={mod} style={{ marginBottom: 18 }}>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', textTransform: 'uppercase', letterSpacing: '.05em', marginBottom: 6 }}>
            {mod.replace(/_/g, ' ')} ({rows.length})
          </div>
          <div style={{ overflowX: 'auto' }}>
            <table style={{ width: '100%', borderCollapse: 'collapse', fontSize: 12 }}>
              <thead>
                <tr style={{ borderBottom: '2px solid var(--hrfin-border)' }}>
                  <th style={{ textAlign: 'left', padding: '4px 8px 4px 0', color: 'var(--hrfin-muted)' }}>Ref</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Type</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Status</th>
                  <th style={{ textAlign: 'left', padding: '4px 8px', color: 'var(--hrfin-muted)' }}>Date</th>
                  <th style={{ textAlign: 'right', padding: '4px 0 4px 8px', color: 'var(--hrfin-muted)' }}>Amount</th>
                </tr>
              </thead>
              <tbody>
                {rows.map(e => (
                  <tr key={e.id} style={{ borderBottom: '1px solid var(--hrfin-border)' }}>
                    <td style={{ padding: '5px 8px 5px 0', fontFamily: 'monospace', fontSize: 11 }}>{e.ref ?? e.id.slice(0, 8)}</td>
                    <td style={{ padding: '5px 8px', color: 'var(--hrfin-muted)' }}>{e.sourceEntityType}</td>
                    <td style={{ padding: '5px 8px' }}>
                      <HrfinPill tone={e.status === 'approved' ? 'ok' : e.status === 'rejected' ? 'bad' : 'wn'}>
                        {e.status}
                      </HrfinPill>
                    </td>
                    <td style={{ padding: '5px 8px' }}>{fmtDate(e.createdAt)}</td>
                    <td style={{ padding: '5px 0 5px 8px', textAlign: 'right', fontWeight: 600 }}>{money(e.amount)}</td>
                  </tr>
                ))}
              </tbody>
            </table>
          </div>
        </div>
      ))}
    </div>
  );
}

/**
 * Approvals — live workflow_tasks for this budget line via useBudgetLineApprovals.
 */
function ApprovalsTab({ lineId }: { lineId: string }): VNode {
  const approvalsQ = useBudgetLineApprovals(lineId);

  if (approvalsQ.isLoading) return <div class="hrfin-empty">Loading approvals…</div>;
  if (approvalsQ.error) return <div class="hrfin-empty" style={{ color: 'var(--hrfin-danger)' }}>Failed to load approvals.</div>;

  const tasks: BudgetApprovalTask[] = approvalsQ.data ?? [];

  if (!tasks.length) {
    return (
      <div class="hrfin-empty">
        No workflow approval tasks found for this budget line.
      </div>
    );
  }

  return (
    <div>
      {tasks.map(t => (
        <div key={t.id} style={{ padding: '10px 12px', border: '1px solid var(--hrfin-border)', borderRadius: 6, marginBottom: 8 }}>
          <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'flex-start', marginBottom: 4 }}>
            <span style={{ fontWeight: 600, fontSize: 13 }}>{t.stepName ?? t.stepKey}</span>
            <HrfinPill tone={approvalTone(t.status)}>{t.status}</HrfinPill>
          </div>
          {t.assignedRole && (
            <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginTop: 2 }}>
              Role: <strong>{t.assignedRole}</strong>
            </div>
          )}
          {t.assignedTo && (
            <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginTop: 2 }}>
              Assigned to: <EmployeeCell employeeId={t.assignedTo} />
            </div>
          )}
          <div style={{ display: 'flex', gap: 16, marginTop: 6, fontSize: 11, color: 'var(--hrfin-muted)' }}>
            <span>Created {fmtDate(t.createdAt)}</span>
            {t.dueAt && <span>Due {fmtDate(t.dueAt)}</span>}
            {t.updatedAt && <span>Updated {fmtDate(t.updatedAt)}</span>}
          </div>
        </div>
      ))}
    </div>
  );
}

function TimelineTab({ line }: { line: BudgetLine }): VNode {
  const events = [
    { date: line.createdAt, label: 'Budget line created', detail: `${line.category} · ${money(line.budgeted)} budgeted` },
    ...(line.updatedAt ? [{ date: line.updatedAt, label: 'Line updated', detail: `Budgeted: ${money(line.budgeted)}` }] : []),
  ].sort((a, b) => b.date.localeCompare(a.date));

  return (
    <div class="hrfin-timeline">
      {events.map((ev, i) => (
        <div key={i} class="hrfin-tl-item" style={{ display: 'flex', gap: 10, paddingBottom: 12, borderBottom: i < events.length - 1 ? '1px solid var(--hrfin-border)' : 'none', marginBottom: i < events.length - 1 ? 12 : 0 }}>
          <div style={{ width: 8, height: 8, borderRadius: '50%', background: 'var(--hrfin-accent)', marginTop: 5, flexShrink: 0 }} />
          <div>
            <div style={{ fontSize: 12, fontWeight: 600 }}>{ev.label}</div>
            <div style={{ fontSize: 11, color: 'var(--hrfin-muted)' }}>{fmtDate(ev.date)}</div>
            <div style={{ fontSize: 12, marginTop: 2 }}>{ev.detail}</div>
          </div>
        </div>
      ))}
      {events.length === 0 && <div class="hrfin-empty">No timeline events.</div>}
    </div>
  );
}

/**
 * Audit — live hr_audit_log rows via useBudgetLineAuditLog, falling back to
 * budget line metadata when the log is empty.
 */
function AuditTab({ line }: { line: BudgetLine }): VNode {
  const auditQ = useBudgetLineAuditLog(line.id);
  const entries: BudgetAuditEntry[] = auditQ.data ?? [];

  return (
    <div>
      <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginBottom: 10 }}>
        Audit trail · submodule: <code style={{ fontSize: 10 }}>finance_budgets</code> · record:{' '}
        <code style={{ fontSize: 10 }}>{line.id}</code>
      </div>

      {auditQ.isLoading ? (
        <div class="hrfin-empty">Loading audit log…</div>
      ) : entries.length === 0 ? (
        <div>
          <div class="hrfin-metric-list">
            <div class="hrfin-metric-row"><span>Created</span><b>{fmtDate(line.createdAt)}</b></div>
            {line.createdBy && (
              <div class="hrfin-metric-row">
                <span>Created by</span>
                <b><EmployeeCell employeeId={line.createdBy} /></b>
              </div>
            )}
            {line.updatedAt && (
              <div class="hrfin-metric-row"><span>Last modified</span><b>{fmtDate(line.updatedAt)}</b></div>
            )}
          </div>
          <div style={{ marginTop: 10, fontSize: 12, color: 'var(--hrfin-muted)' }}>
            No detailed audit entries recorded yet.
          </div>
        </div>
      ) : (
        <div>
          {entries.map((e, i) => (
            <div key={e.id} style={{ padding: '8px 0', borderBottom: i < entries.length - 1 ? '1px solid var(--hrfin-border)' : 'none' }}>
              <div style={{ display: 'flex', justifyContent: 'space-between', alignItems: 'baseline' }}>
                <span style={{ fontWeight: 600, fontSize: 13 }}>{e.action.replace(/_/g, ' ')}</span>
                <span style={{ fontSize: 11, color: 'var(--hrfin-muted)' }}>{fmtDate(e.createdAt)}</span>
              </div>
              {e.actorId && (
                <div style={{ fontSize: 12, color: 'var(--hrfin-muted)', marginTop: 2 }}>
                  <EmployeeCell employeeId={e.actorId} />
                </div>
              )}
              {e.reason && (
                <div style={{ fontSize: 12, marginTop: 2 }}>{e.reason}</div>
              )}
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

/**
 * Attachments — upload / list / download / delete via the budget attachment
 * endpoints. Upload flow: uploadUrl → PUT to presigned URL → complete.
 */
function AttachmentsTab({ lineId }: { lineId: string }): VNode {
  const qc = useQueryClient();
  const attachQ = useBudgetLineAttachments(lineId);
  const [uploading, setUploading] = useState(false);
  const [uploadErr, setUploadErr] = useState<string | null>(null);
  const [deleteErr, setDeleteErr] = useState<string | null>(null);
  const fileRef = useRef<HTMLInputElement>(null);

  const attachments: BudgetAttachmentDto[] = attachQ.data ?? [];

  async function handleFileChange(e: Event): Promise<void> {
    const file = (e.target as HTMLInputElement).files?.[0];
    if (!file) return;
    setUploading(true);
    setUploadErr(null);
    try {
      const mime = file.type || 'application/octet-stream';
      const { uploadUrl, path } = await financeBudgetsApi.attachments.uploadUrl({
        budgetLineId: lineId,
        fileName: file.name,
        mimeType: mime,
      });
      // PUT directly to storage presigned URL (browser-side, no auth header needed)
      const putRes = await fetch(uploadUrl, {
        method: 'PUT',
        body: file,
        headers: { 'Content-Type': mime },
      });
      if (!putRes.ok) throw new Error(`Storage upload failed: ${putRes.status}`);
      await financeBudgetsApi.attachments.complete({
        budgetLineId: lineId,
        fileName: file.name,
        storagePath: path,
        mimeType: mime,
        fileSize: file.size,
      });
      void qc.invalidateQueries({ queryKey: financeBudgetsKeys.attachments(lineId) });
      if (fileRef.current) fileRef.current.value = '';
    } catch (err) {
      setUploadErr(err instanceof Error ? err.message : 'Upload failed.');
    } finally {
      setUploading(false);
    }
  }

  async function handleDownload(storagePath: string): Promise<void> {
    try {
      const { signedUrl } = await financeBudgetsApi.attachments.signedUrl({ storagePath });
      window.open(signedUrl, '_blank');
    } catch {
      // Non-fatal; user can retry
    }
  }

  async function handleDelete(id: string): Promise<void> {
    setDeleteErr(null);
    try {
      await financeBudgetsApi.attachments.delete({ id, budgetLineId: lineId });
      void qc.invalidateQueries({ queryKey: financeBudgetsKeys.attachments(lineId) });
    } catch (err) {
      setDeleteErr(err instanceof Error ? err.message : 'Delete failed.');
    }
  }

  return (
    <div>
      {/* Upload control */}
      <div style={{ marginBottom: 16, padding: '10px 12px', border: '1px dashed var(--hrfin-border)', borderRadius: 6 }}>
        <label style={{ display: 'block', fontSize: 12, fontWeight: 600, marginBottom: 6 }}>
          Attach a file
        </label>
        <input
          ref={fileRef}
          type="file"
          disabled={uploading}
          style={{ fontSize: 13 }}
          onChange={(e) => { void handleFileChange(e); }}
        />
        {uploading && (
          <div style={{ fontSize: 12, color: 'var(--hrfin-accent)', marginTop: 6 }}>Uploading…</div>
        )}
        {uploadErr && (
          <div style={{ fontSize: 12, color: 'var(--hrfin-danger)', marginTop: 6 }}>{uploadErr}</div>
        )}
      </div>

      {deleteErr && (
        <div style={{ fontSize: 12, color: 'var(--hrfin-danger)', marginBottom: 8 }}>{deleteErr}</div>
      )}

      {/* Attachment list */}
      {attachQ.isLoading ? (
        <div class="hrfin-empty">Loading attachments…</div>
      ) : attachments.length === 0 ? (
        <div class="hrfin-empty">No attachments yet. Use the control above to upload one.</div>
      ) : (
        <div>
          <div style={{ fontSize: 11, fontWeight: 600, color: 'var(--hrfin-muted)', marginBottom: 8, textTransform: 'uppercase', letterSpacing: '.05em' }}>
            {attachments.length} attachment{attachments.length !== 1 ? 's' : ''}
          </div>
          {attachments.map((att) => (
            <div key={att.id} style={{ display: 'flex', alignItems: 'center', gap: 8, padding: '8px 0', borderBottom: '1px solid var(--hrfin-border)' }}>
              <span style={{ flex: 1, fontSize: 13, wordBreak: 'break-all' }}>{att.fileName}</span>
              {att.fileSize != null && (
                <span style={{ fontSize: 11, color: 'var(--hrfin-muted)', flexShrink: 0 }}>{fmtBytes(att.fileSize)}</span>
              )}
              <button
                class="hrfin-action"
                style={{ fontSize: 11, flexShrink: 0 }}
                onClick={() => { void handleDownload(att.storagePath); }}
              >
                Download
              </button>
              <button
                class="hrfin-action is-danger"
                style={{ fontSize: 11, flexShrink: 0 }}
                onClick={() => { void handleDelete(att.id); }}
              >
                Delete
              </button>
            </div>
          ))}
        </div>
      )}
    </div>
  );
}

// ── Main Drawer ───────────────────────────────────────────────────────────────

export interface BudLineDrawerProps {
  lineId: string | null;
  open: boolean;
  onClose: () => void;
  onEdit?: (line: BudgetLine) => void;
  onDelete?: (line: BudgetLine) => void;
}

export function BudLineDrawer({ lineId, open, onClose, onEdit, onDelete }: BudLineDrawerProps): VNode {
  const [tab, setTab] = useState<DrawerTab>('summary');
  const detailQ  = useBudgetDetail(open ? lineId : null);
  // Fetch actuals for Actuals Composition, Variance Trend, and Related Transactions tabs
  const actualsQ = useBudgetLineActuals(
    open && (tab === 'actuals' || tab === 'trend' || tab === 'related') ? lineId : null,
  );

  const line = detailQ.data;

  const drawerTitle = line
    ? `${line.category} · FY ${line.fiscalYear}`
    : 'Budget Line';
  const drawerSub = line
    ? `${line.costCenterName ?? 'Unknown cost centre'} · ${money(line.budgeted)} budgeted`
    : '';

  return (
    <Drawer
      open={open}
      onClose={onClose}
      panelClass="hrfin"
      title={drawerTitle}
      sub={drawerSub}
      noFooter
    >
      {!line ? (
        <div class="hrfin">
          <div class="hrfin-empty">{detailQ.isLoading ? 'Loading…' : 'Budget line not found.'}</div>
        </div>
      ) : (
        <div class="hrfin">
          {/* Amount + variance badge header */}
          <div style={{ display: 'flex', alignItems: 'baseline', justifyContent: 'space-between', marginBottom: 14 }}>
            <strong style={{ fontSize: 28, fontWeight: 650, letterSpacing: '-.035em' }}>
              {money(line.budgeted)}
            </strong>
            <HrfinPill tone={varianceTone(line)}>
              {varianceLabel(line)}
            </HrfinPill>
          </div>

          {/* Tab bar */}
          <div class="hrfin-tabs" style={{ marginBottom: 14 }}>
            {TABS.map(t => (
              <button key={t.key} type="button" class={t.key === tab ? 'is-active' : ''} onClick={() => setTab(t.key)}>
                {t.label}
              </button>
            ))}
          </div>

          {/* Tab content */}
          {tab === 'summary'     && <SummaryTab line={line} />}
          {tab === 'actuals'     && <ActualsTab lineId={line.id} actualsQ={actualsQ} />}
          {tab === 'trend'       && <VarianceTrendTab line={line} actualsQ={actualsQ} />}
          {tab === 'related'     && <RelatedTransactionsTab actualsQ={actualsQ} />}
          {tab === 'approvals'   && <ApprovalsTab lineId={line.id} />}
          {tab === 'timeline'    && <TimelineTab line={line} />}
          {tab === 'audit'       && <AuditTab line={line} />}
          {tab === 'attachments' && <AttachmentsTab lineId={line.id} />}

          {/* Inline actions */}
          {(onEdit ?? onDelete) && (
            <div style={{ display: 'flex', gap: 8, marginTop: 20, paddingTop: 14, borderTop: '1px solid var(--hrfin-border)' }}>
              {onEdit && (
                <button class="hrfin-action is-primary" onClick={() => onEdit(line)}>
                  Edit line
                </button>
              )}
              {onDelete && (
                <button class="hrfin-action is-danger" style={{ marginLeft: 'auto' }} onClick={() => onDelete(line)}>
                  Delete
                </button>
              )}
            </div>
          )}
        </div>
      )}
    </Drawer>
  );
}
