/**
 * src/components/sections/HR/HRDocumentsOverview.tsx
 *
 * HR Documents page — functional-only (plain .obx-* tables + @ui components).
 * NO widget board, NO registry KPI tiles.
 *
 * Tabs:
 *   Register      — cross-employee document table (search + filters + pagination)
 *   Expiring      — docs expiring soon / already expired + Run Sweep button
 *   Requirements  — requirement policy table + compliance overview
 *
 * Row actions reuse existing hooks from employees.ts via documents.ts re-exports:
 *   Verify (verify perm), Archive (archive perm), Download (download perm).
 * Upload uses the Upload modal → existing useUploadHrDocument hook.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { useCan } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import {
  PageHeader, Tabs, type TabDef, Modal, EmptyState, TableSkeleton,
  Field, TextInput, SelectInput, FormGrid,
  exportCsv,
} from '@ui';

import {
  useDocumentsList, useDocumentsStats, useDocumentsExpiring,
  useDocumentRequirements, useCreateRequirement, useUpdateRequirement,
  useRetireRequirement, useComplianceOverview, useRunExpirySweep,
  // reused from employees.ts (re-exported in documents.ts)
  useUploadHrDocument, useVerifyHrDocument, useArchiveHrDocument,
  getHrDocumentDownloadUrl,
  type UploadDocArgs,
} from '@api/hr/documents';

import type { DocumentFilters, DocumentRequirement, CreateRequirementArgs } from '../../../../types/hrDocuments';

// ── Helpers ────────────────────────────────────────────────────────────────────

const CONFIDENTIALITY_LABELS: Record<string, string> = {
  internal: 'Internal', confidential: 'Confidential',
  restricted_hr: 'Restricted HR', legal: 'Legal', medical: 'Medical',
};
const STATUS_LABELS: Record<string, string> = {
  uploaded: 'Pending Review', verified: 'Verified',
  rejected: 'Rejected', archived: 'Archived',
};
const EXPIRY_LABELS: Record<string, string> = {
  valid: 'Valid', expiring: 'Expiring Soon', expired: 'Expired', none: 'No Expiry',
};

function fmtDate(d: string | null | undefined): string {
  if (!d) return '—';
  return new Date(d).toLocaleDateString(undefined, { year: 'numeric', month: 'short', day: 'numeric' });
}

function ExpiryBadge({ state }: { state: string }): VNode {
  const cls = state === 'expired'  ? 'vt-pill vt-pill--danger'  :
              state === 'expiring' ? 'vt-pill vt-pill--warning' :
              state === 'valid'    ? 'vt-pill vt-pill--success' : 'vt-pill vt-pill--muted';
  return <span class={cls}>{EXPIRY_LABELS[state] ?? state}</span>;
}

function StatusBadge({ status }: { status: string }): VNode {
  const cls = status === 'verified' ? 'vt-pill vt-pill--success' :
              status === 'rejected' ? 'vt-pill vt-pill--danger'  :
              status === 'archived' ? 'vt-pill vt-pill--muted'   : 'vt-pill vt-pill--warning';
  return <span class={cls}>{STATUS_LABELS[status] ?? status}</span>;
}

// ── Register Tab ───────────────────────────────────────────────────────────────

function RegisterTab(): VNode {
  const [filters, setFilters] = useState<DocumentFilters>({ page: 1, pageSize: 50 });
  const [search, setSearch]         = useState('');
  const [statusFilter, setStatus]   = useState('');
  const [expiryFilter, setExpiry]   = useState('');
  const [uploadOpen, setUploadOpen] = useState(false);

  const canUpload   = useCan('hr.employee_documents.upload');
  const canVerify   = useCan('hr.employee_documents.verify');
  const canArchive  = useCan('hr.employee_documents.archive');
  const canDownload = useCan('hr.employee_documents.download');

  const activeFilters: DocumentFilters = {
    ...filters,
    q: search || undefined,
    status: statusFilter || undefined,
    expiryState: (expiryFilter as DocumentFilters['expiryState']) || undefined,
  };
  const { data, isLoading } = useDocumentsList(activeFilters);
  const rows  = data?.rows ?? [];
  const total = data?.total ?? 0;
  const page     = activeFilters.page     ?? 1;
  const pageSize = activeFilters.pageSize ?? 50;

  const verify  = useVerifyHrDocument(null);
  const archive = useArchiveHrDocument(null);

  async function handleDownload(docId: string): Promise<void> {
    try {
      const url = await getHrDocumentDownloadUrl(docId);
      window.open(url, '_blank', 'noopener');
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Download failed', icon: 'error' });
    }
  }

  async function handleVerify(docId: string): Promise<void> {
    const ok = await dialog.confirm({ title: 'Verify document?', text: 'Approve this document as verified?', confirmText: 'Approve' });
    if (!ok) return;
    try {
      await verify.mutateAsync({ documentId: docId, decision: 'approve' });
      void dialog.toast({ text: 'Document verified.', icon: 'success' });
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Verification failed', icon: 'error' });
    }
  }

  async function handleArchive(docId: string): Promise<void> {
    const ok = await dialog.confirm({ title: 'Archive document?', text: 'This will archive the document. Continue?', confirmText: 'Archive' });
    if (!ok) return;
    try {
      await archive.mutateAsync(docId);
      void dialog.toast({ text: 'Document archived.', icon: 'success' });
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Archive failed', icon: 'error' });
    }
  }

  function handleExport(): void {
    exportCsv(rows, [
      { header: 'Employee',       value: r => r.employeeName ?? r.employeeId },
      { header: 'Department',     value: r => r.departmentName ?? '' },
      { header: 'Type',           value: r => r.documentType },
      { header: 'Title',          value: r => r.title },
      { header: 'Status',         value: r => r.status },
      { header: 'Confidentiality',value: r => r.confidentiality },
      { header: 'Expiry Date',    value: r => r.expiryDate ?? '' },
      { header: 'Expiry State',   value: r => r.expiryState },
      { header: 'Uploaded',       value: r => r.uploadedAt },
    ], 'hr-documents');
  }

  return (
    <div class="obx-tab-panel">
      {/* Toolbar */}
      <div class="obx-toolbar">
        <input
          class="obx-search" type="text" placeholder="Search title, type or employee…"
          value={search}
          onInput={e => {
            setSearch((e.target as HTMLInputElement).value);
            setFilters((f: DocumentFilters) => ({ ...f, page: 1 }));
          }}
        />
        <select
          class="obx-select" value={statusFilter}
          onChange={e => { setStatus((e.target as HTMLSelectElement).value); setFilters((f: DocumentFilters) => ({ ...f, page: 1 })); }}
        >
          <option value="">All statuses</option>
          {Object.entries(STATUS_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <select
          class="obx-select" value={expiryFilter}
          onChange={e => { setExpiry((e.target as HTMLSelectElement).value); setFilters((f: DocumentFilters) => ({ ...f, page: 1 })); }}
        >
          <option value="">Any expiry state</option>
          {Object.entries(EXPIRY_LABELS).map(([v, l]) => <option key={v} value={v}>{l}</option>)}
        </select>
        <div class="obx-toolbar-spacer" />
        {canUpload && <button class="obx-btn obx-btn--primary" onClick={() => setUploadOpen(true)}>Upload Document</button>}
        <button class="obx-btn" onClick={handleExport} title="Export as CSV">Export CSV</button>
      </div>

      {/* Table */}
      {isLoading && !data ? (
        <table class="obx-table vt-table"><tbody><TableSkeleton rows={8} cols={8} /></tbody></table>
      ) : rows.length === 0 ? (
        <EmptyState icon="fa-folder-open" title="No documents found" text="Adjust filters or upload a document." />
      ) : (
        <table class="obx-table vt-table">
          <thead>
            <tr>
              <th>Employee</th><th>Department</th><th>Type</th><th>Title</th>
              <th class="center">Status</th><th class="center">Confidentiality</th>
              <th class="center">Expiry</th><th>Actions</th>
            </tr>
          </thead>
          <tbody>
            {rows.map(r => (
              <tr key={r.id}>
                <td>{r.employeeName ?? r.employeeId}</td>
                <td><span class="hse-muted">{r.departmentName ?? '—'}</span></td>
                <td>{r.documentType}</td>
                <td>{r.title}</td>
                <td class="center"><StatusBadge status={r.status} /></td>
                <td class="center">
                  <span class="vt-pill vt-pill--default">
                    {CONFIDENTIALITY_LABELS[r.confidentiality] ?? r.confidentiality}
                  </span>
                </td>
                <td class="center">
                  {r.expiryDate
                    ? <><ExpiryBadge state={r.expiryState} />{' '}<span class="hse-muted">{fmtDate(r.expiryDate)}</span></>
                    : <span class="hse-muted">—</span>}
                </td>
                <td>
                  <div class="obx-action-row">
                    {canVerify && r.status === 'uploaded' && (
                      <button class="obx-btn obx-btn--xs obx-btn--success" onClick={() => void handleVerify(r.id)}>Verify</button>
                    )}
                    {canDownload && r.status !== 'archived' && (
                      <button class="obx-btn obx-btn--xs" onClick={() => void handleDownload(r.id)}>Download</button>
                    )}
                    {canArchive && r.status !== 'archived' && (
                      <button class="obx-btn obx-btn--xs obx-btn--muted" onClick={() => void handleArchive(r.id)}>Archive</button>
                    )}
                  </div>
                </td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Pagination */}
      {total > pageSize && (
        <div class="obx-pagination">
          <button class="obx-btn obx-btn--xs" disabled={page <= 1}
            onClick={() => setFilters((f: DocumentFilters) => ({ ...f, page: (f.page ?? 1) - 1 }))}>Prev</button>
          <span class="hse-muted">Page {page} of {Math.ceil(total / pageSize)}</span>
          <button class="obx-btn obx-btn--xs" disabled={page >= Math.ceil(total / pageSize)}
            onClick={() => setFilters((f: DocumentFilters) => ({ ...f, page: (f.page ?? 1) + 1 }))}>Next</button>
        </div>
      )}

      {uploadOpen && <UploadModal onClose={() => setUploadOpen(false)} />}
    </div>
  );
}

// ── Upload Modal ───────────────────────────────────────────────────────────────

function UploadModal({ onClose }: { onClose: () => void }): VNode {
  const [employeeId, setEmployeeId]           = useState('');
  const [documentType, setDocumentType]       = useState('');
  const [title, setTitle]                     = useState('');
  const [confidentiality, setConfidentiality] = useState('internal');
  const [expiryDate, setExpiryDate]           = useState('');
  const [file, setFile]                       = useState<File | null>(null);
  const upload = useUploadHrDocument();

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!file || !employeeId || !documentType || !title) {
      void dialog.toast({ text: 'All fields marked * are required.', icon: 'error' });
      return;
    }
    const args: UploadDocArgs = {
      employeeId, file, documentType, title,
      confidentiality, expiryDate: expiryDate || undefined,
    };
    try {
      await upload.mutateAsync(args);
      void dialog.toast({ text: 'Document uploaded successfully.', icon: 'success' });
      onClose();
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Upload failed', icon: 'error' });
    }
  }

  return (
    <Modal open title="Upload Document" onClose={onClose} size="md">
      <form onSubmit={e => void handleSubmit(e)}>
        <FormGrid>
          <Field label="Employee ID *">
            <TextInput value={employeeId} onInput={setEmployeeId} placeholder="Employee ID (app_users.id)" />
          </Field>
          <Field label="Document Type *">
            <TextInput value={documentType} onInput={setDocumentType} placeholder="e.g. passport, contract" />
          </Field>
          <Field label="Title *">
            <TextInput value={title} onInput={setTitle} placeholder="Document title" />
          </Field>
          <Field label="Confidentiality">
            <SelectInput value={confidentiality} onInput={setConfidentiality}
              options={Object.entries(CONFIDENTIALITY_LABELS).map(([v, l]) => ({ value: v, label: l }))} />
          </Field>
          <Field label="Expiry Date">
            <TextInput type="date" value={expiryDate} onInput={setExpiryDate} />
          </Field>
          <Field label="File *">
            <input type="file" class="obx-file-input"
              onChange={e => setFile((e.target as HTMLInputElement).files?.[0] ?? null)} />
          </Field>
        </FormGrid>
        <div class="obx-modal-footer">
          <button type="button" class="obx-btn" onClick={onClose}>Cancel</button>
          <button type="submit" class="obx-btn obx-btn--primary" disabled={upload.isPending}>
            {upload.isPending ? 'Uploading…' : 'Upload'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Expiring Tab ───────────────────────────────────────────────────────────────

function ExpiringTab(): VNode {
  const { data: rows, isLoading } = useDocumentsExpiring(30);
  const canSweep = useCan('hr.employee_documents.view');
  const sweep    = useRunExpirySweep();

  async function handleSweep(): Promise<void> {
    const ok = await dialog.confirm({
      title:       'Run Expiry Reminder Sweep?',
      text:        'Sends reminder notifications for all documents expiring within the configured windows. Duplicates are suppressed.',
      confirmText: 'Run Sweep',
    });
    if (!ok) return;
    try {
      const res = await sweep.mutateAsync();
      const d = (res as { data?: { scanned: number; remindersSent: number } }).data;
      void dialog.toast({
        text: `Sweep complete — ${d?.scanned ?? 0} docs scanned, ${d?.remindersSent ?? 0} reminders sent.`,
        icon: 'success',
      });
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Sweep failed', icon: 'error' });
    }
  }

  const safeRows = rows ?? [];

  return (
    <div class="obx-tab-panel">
      <div class="obx-toolbar">
        <span class="hse-muted">Documents expiring within 30 days or already expired.</span>
        <div class="obx-toolbar-spacer" />
        {canSweep && (
          <button class="obx-btn obx-btn--warning" onClick={() => void handleSweep()} disabled={sweep.isPending}>
            {sweep.isPending ? 'Running…' : 'Run Reminder Sweep'}
          </button>
        )}
      </div>

      {isLoading && !safeRows.length ? (
        <table class="obx-table vt-table"><tbody><TableSkeleton rows={6} cols={6} /></tbody></table>
      ) : !safeRows.length ? (
        <EmptyState icon="fa-check-circle" title="No expiring documents" text="All employee documents are valid." />
      ) : (
        <table class="obx-table vt-table">
          <thead>
            <tr>
              <th>Employee</th><th>Type</th><th>Title</th>
              <th class="center">Status</th><th class="center">Expiry Date</th><th class="center">State</th>
            </tr>
          </thead>
          <tbody>
            {safeRows.map(r => (
              <tr key={r.id}>
                <td>{r.employeeName ?? r.employeeId}</td>
                <td>{r.documentType}</td>
                <td>{r.title}</td>
                <td class="center"><StatusBadge status={r.status} /></td>
                <td class="center">{fmtDate(r.expiryDate)}</td>
                <td class="center"><ExpiryBadge state={r.expiryState} /></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}
    </div>
  );
}

// ── Requirements Tab ───────────────────────────────────────────────────────────

function RequirementsTab(): VNode {
  const [reqOpen, setReqOpen] = useState(false);
  const [editReq, setEditReq] = useState<DocumentRequirement | null>(null);
  const canManage = useCan('hr.employee_documents.requirements.manage');

  const { data: requirements, isLoading: reqLoading } = useDocumentRequirements();
  const { data: compliance,   isLoading: compLoading } = useComplianceOverview();
  const retire = useRetireRequirement();

  const safeReqs = requirements ?? [];
  const safeComp = compliance ?? [];

  async function handleRetire(req: DocumentRequirement): Promise<void> {
    const ok = await dialog.confirm({
      title:       `Retire "${req.label}"?`,
      text:        'Stops tracking this requirement going forward. Existing compliance data is unaffected.',
      confirmText: 'Retire',
    });
    if (!ok) return;
    try {
      await retire.mutateAsync(req.id);
      void dialog.toast({ text: 'Requirement retired.', icon: 'success' });
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Retire failed', icon: 'error' });
    }
  }

  return (
    <div class="obx-tab-panel">
      {/* Policy table */}
      <div class="obx-section-header">
        <h3 class="obx-section-title">Document Requirements Policy</h3>
        {canManage && (
          <button class="obx-btn obx-btn--primary" onClick={() => { setEditReq(null); setReqOpen(true); }}>
            New Requirement
          </button>
        )}
      </div>

      {reqLoading && !safeReqs.length ? (
        <table class="obx-table vt-table"><tbody><TableSkeleton rows={4} cols={6} /></tbody></table>
      ) : !safeReqs.length ? (
        <EmptyState icon="fa-clipboard-list" title="No requirements defined"
          text="Create a requirement to track which document types employees must provide." />
      ) : (
        <table class="obx-table vt-table">
          <thead>
            <tr>
              <th>Type</th><th>Label</th><th>Scope</th><th class="center">Scope Value</th>
              <th class="center">Requires Expiry</th><th class="center">Reminder Days</th>
              {canManage && <th>Actions</th>}
            </tr>
          </thead>
          <tbody>
            {safeReqs.map(req => (
              <tr key={req.id}>
                <td>{req.documentType}</td>
                <td>{req.label}</td>
                <td><span class="vt-pill vt-pill--default">{req.appliesToScope}</span></td>
                <td class="center"><span class="hse-muted">{req.appliesToValue ?? 'All'}</span></td>
                <td class="center">
                  <span class={req.requiresExpiry ? 'vt-pill vt-pill--warning' : 'vt-pill vt-pill--muted'}>
                    {req.requiresExpiry ? 'Yes' : 'No'}
                  </span>
                </td>
                <td class="center"><span class="hse-muted">{req.reminderDays.join(', ')} days</span></td>
                {canManage && (
                  <td>
                    <div class="obx-action-row">
                      <button class="obx-btn obx-btn--xs" onClick={() => { setEditReq(req); setReqOpen(true); }}>Edit</button>
                      <button class="obx-btn obx-btn--xs obx-btn--muted" onClick={() => void handleRetire(req)}>Retire</button>
                    </div>
                  </td>
                )}
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Compliance overview */}
      <div class="obx-section-header" style="margin-top:2rem">
        <h3 class="obx-section-title">Compliance — Employees with Missing / Expired Documents</h3>
      </div>

      {compLoading && !safeComp.length ? (
        <table class="obx-table vt-table"><tbody><TableSkeleton rows={4} cols={5} /></tbody></table>
      ) : !safeComp.length ? (
        <EmptyState icon="fa-check-circle" title="All employees compliant"
          text="No employees have missing or expired required documents." />
      ) : (
        <table class="obx-table vt-table">
          <thead>
            <tr>
              <th>Employee</th><th>Department</th>
              <th class="center">Missing</th><th class="center">Expired</th><th class="center">Total Required</th>
            </tr>
          </thead>
          <tbody>
            {safeComp.map(r => (
              <tr key={r.employeeId}>
                <td>{r.employeeName ?? r.employeeId}</td>
                <td><span class="hse-muted">{r.departmentName ?? '—'}</span></td>
                <td class="center">
                  {r.missingCount > 0
                    ? <span class="vt-pill vt-pill--danger">{r.missingCount}</span>
                    : <span class="hse-muted">0</span>}
                </td>
                <td class="center">
                  {r.expiredCount > 0
                    ? <span class="vt-pill vt-pill--warning">{r.expiredCount}</span>
                    : <span class="hse-muted">0</span>}
                </td>
                <td class="center"><span class="hse-muted">{r.totalRequired}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      )}

      {/* Requirement create/edit modal */}
      {reqOpen && <RequirementModal existing={editReq} onClose={() => setReqOpen(false)} />}
    </div>
  );
}

// ── Requirement Modal ──────────────────────────────────────────────────────────

function RequirementModal({ existing, onClose }: {
  existing: DocumentRequirement | null;
  onClose: () => void;
}): VNode {
  const [documentType, setDocumentType]     = useState(existing?.documentType ?? '');
  const [label, setLabel]                   = useState(existing?.label ?? '');
  const [scope, setScope]                   = useState<CreateRequirementArgs['appliesToScope']>(existing?.appliesToScope ?? 'all');
  const [scopeValue, setScopeValue]         = useState(existing?.appliesToValue ?? '');
  const [requiresExpiry, setRequiresExpiry] = useState(existing?.requiresExpiry ?? false);
  const [reminderDays, setReminderDays]     = useState((existing?.reminderDays ?? [30, 7, 0]).join(','));

  const create    = useCreateRequirement();
  const update    = useUpdateRequirement();
  const isPending = create.isPending || update.isPending;

  async function handleSubmit(e: Event): Promise<void> {
    e.preventDefault();
    if (!documentType || !label) {
      void dialog.toast({ text: 'Document type and label are required.', icon: 'error' });
      return;
    }
    const days = reminderDays.split(',')
      .map((s: string) => parseInt(s.trim(), 10))
      .filter((n: number) => Number.isFinite(n));
    try {
      if (existing) {
        await update.mutateAsync({ requirementId: existing.id, label, requiresExpiry, reminderDays: days });
        void dialog.toast({ text: 'Requirement updated.', icon: 'success' });
      } else {
        await create.mutateAsync({
          documentType, label,
          appliesToScope: scope,
          appliesToValue: scopeValue || null,
          requiresExpiry,
          reminderDays: days,
        });
        void dialog.toast({ text: 'Requirement created.', icon: 'success' });
      }
      onClose();
    } catch (err) {
      void dialog.toast({ text: err instanceof Error ? err.message : 'Save failed', icon: 'error' });
    }
  }

  return (
    <Modal open title={existing ? 'Edit Requirement' : 'New Document Requirement'} onClose={onClose} size="md">
      <form onSubmit={e => void handleSubmit(e)}>
        <FormGrid>
          <Field label="Document Type *">
            {existing
              ? <input class="ui-input" type="text" value={documentType} disabled />
              : <TextInput value={documentType} onInput={setDocumentType} placeholder="e.g. passport, nda, safety_cert" />
            }
          </Field>
          <Field label="Label *">
            <TextInput value={label} onInput={setLabel} placeholder="Human-readable label" />
          </Field>
          {!existing && (
            <>
              <Field label="Applies To">
                <SelectInput
                  value={scope}
                  onInput={v => setScope(v as CreateRequirementArgs['appliesToScope'])}
                  options={[
                    { value: 'all',             label: 'All employees' },
                    { value: 'role',            label: 'Specific role' },
                    { value: 'employment_type', label: 'Employment type' },
                    { value: 'department',      label: 'Department' },
                  ]}
                />
              </Field>
              {scope !== 'all' && (
                <Field label="Scope Value">
                  <TextInput
                    value={scopeValue} onInput={setScopeValue}
                    placeholder={scope === 'department' ? 'Dept UUID' : 'e.g. employee, manager'}
                  />
                </Field>
              )}
            </>
          )}
          <Field label="Requires Expiry Date">
            <label class="obx-checkbox-label">
              <input type="checkbox" checked={requiresExpiry}
                onChange={e => setRequiresExpiry((e.target as HTMLInputElement).checked)} />
              <span>Doc without an expiry date counts as non-compliant</span>
            </label>
          </Field>
          <Field label="Reminder Windows (days before expiry)">
            <TextInput value={reminderDays} onInput={setReminderDays} placeholder="30,7,0" />
          </Field>
        </FormGrid>
        <div class="obx-modal-footer">
          <button type="button" class="obx-btn" onClick={onClose}>Cancel</button>
          <button type="submit" class="obx-btn obx-btn--primary" disabled={isPending}>
            {isPending ? 'Saving…' : existing ? 'Save Changes' : 'Create'}
          </button>
        </div>
      </form>
    </Modal>
  );
}

// ── Stats Row ──────────────────────────────────────────────────────────────────

function StatsRow(): VNode {
  const { data: stats, isLoading } = useDocumentsStats();
  const items: Array<{ label: string; value: number | undefined }> = [
    { label: 'Total Documents',  value: stats?.total },
    { label: 'Pending Review',   value: stats?.uploaded },
    { label: 'Verified',         value: stats?.verified },
    { label: 'Expiring Soon',    value: stats?.expiringSoon },
    { label: 'Expired',          value: stats?.expired },
    { label: 'Missing Required', value: stats?.missingRequired },
  ];
  return (
    <div class="obx-stats-row">
      {items.map(({ label, value }) => (
        <div class="obx-stat-card" key={label}>
          <div class="obx-stat-label">{label}</div>
          <div class="obx-stat-value">{isLoading && value === undefined ? '—' : (value ?? 0)}</div>
        </div>
      ))}
    </div>
  );
}

// ── Page ───────────────────────────────────────────────────────────────────────

type DocTab = 'register' | 'expiring' | 'requirements';

const TABS: TabDef<DocTab>[] = [
  { key: 'register',     label: 'Register' },
  { key: 'expiring',     label: 'Expiring' },
  { key: 'requirements', label: 'Requirements' },
];

export function HRDocumentsOverview(): VNode {
  const [tab, setTab] = useState<DocTab>('register');

  return (
    <div class="obx-page">
      <PageHeader
        icon="fa-folder-open"
        title="HR Documents"
        sub="Cross-employee document register, expiry tracking, and requirement policy."
        module="HR"
      />
      <StatsRow />
      <Tabs<DocTab> tabs={TABS} active={tab} onChange={setTab} />
      {tab === 'register'     && <RegisterTab />}
      {tab === 'expiring'     && <ExpiringTab />}
      {tab === 'requirements' && <RequirementsTab />}
    </div>
  );
}
