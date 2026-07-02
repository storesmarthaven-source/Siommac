/**
 * src/components/sections/HR/HRRequestsOverview.tsx
 *
 * HR ▸ Request Center — functional-only self-service & triage console.
 *
 * My Requests tab (submit_own): submit new requests + track + cancel own.
 * Triage tab (manage): view all, decide (approve/reject/return), fulfill.
 * Tab visibility is entitlement-driven; a pure employee sees only My Requests,
 * HR staff sees only Triage (or both if they also have submit_own).
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { can } from '@lib/permissions';
import { PageHeader, Modal, Field, FormGrid, SelectInput, TextInput, EmptyState, TableSkeleton } from '@ui';
import {
  useRequestTypes, useMyRequests, useAllRequests, useRequestsMutation, hrRequestsApi,
} from '@api/hr/requests';
import type { HrRequestRow, HrRequestTypeDef } from '../../../../types/hrRequests';

const toast = (m: string): void => { void dialog.toast({ title: m }); };
function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

function statusTone(s: string): 'green' | 'gray' | 'red' | 'blue' | 'orange' {
  if (s === 'fulfilled' || s === 'approved') return 'green';
  if (s === 'rejected' || s === 'cancelled') return 'red';
  if (s === 'in_review') return 'blue';
  if (s === 'returned') return 'orange';
  return 'gray';
}

const TERMINAL = new Set(['approved', 'rejected', 'fulfilled', 'cancelled']);

// ── My Requests tab ───────────────────────────────────────────────────────────

interface NewRequestModalProps {
  types: HrRequestTypeDef[];
  onClose: () => void;
  onSubmitted: () => void;
}

function NewRequestModal({ types, onClose, onSubmitted }: NewRequestModalProps): VNode {
  const [requestType, setRequestType] = useState(types[0]?.key ?? '');
  const [title, setTitle] = useState('');
  const [details, setDetails] = useState('');
  const [priority, setPriority] = useState('normal');
  const [busy, setBusy] = useState(false);

  const selectedType = types.find(t => t.key === requestType);

  async function submit(): Promise<void> {
    if (!title.trim()) { void dialog.toast({ title: 'Please enter a title.' }); return; }
    setBusy(true);
    try {
      await hrRequestsApi.submit({
        requestType,
        title: title.trim(),
        details: details.trim() ? { body: details.trim() } : {},
        priority: priority as 'low' | 'normal' | 'high',
      });
      toast('Request submitted successfully.');
      onSubmitted();
      onClose();
    } catch (e) {
      toast((e as Error).message ?? 'Submit failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title="New HR Request" onClose={onClose}>
      <FormGrid>
        <Field label="Request Type">
          <SelectInput
            value={requestType}
            onInput={setRequestType}
            options={types.map(t => ({ value: t.key, label: t.label }))}
          />
        </Field>
        {selectedType && <p class="obx-meta" style={{ marginTop: 0, gridColumn: '1 / -1' }}>{selectedType.description}</p>}
        <Field label="Title / Subject">
          <TextInput value={title} onInput={setTitle} placeholder="Brief description of your request" />
        </Field>
        <Field label="Details">
          <textarea class="ui-input" rows={4} value={details} onInput={e => setDetails((e.target as HTMLTextAreaElement).value)} placeholder="Provide any relevant details…" />
        </Field>
        <Field label="Priority">
          <SelectInput
            value={priority}
            onInput={setPriority}
            options={[
              { value: 'low', label: 'Low' },
              { value: 'normal', label: 'Normal' },
              { value: 'high', label: 'High' },
            ]}
          />
        </Field>
      </FormGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <button class="obx-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button class="obx-btn primary" onClick={submit} disabled={busy}>{busy ? 'Submitting…' : 'Submit Request'}</button>
      </div>
    </Modal>
  );
}

function MyRequestsTab(): VNode {
  const [newOpen, setNewOpen] = useState(false);
  const typesQ    = useRequestTypes();
  const requestsQ = useMyRequests();
  const cancelMut = useRequestsMutation((a: { requestId: string }) => hrRequestsApi.cancel(a));

  const rows: HrRequestRow[] = requestsQ.data ?? [];
  const types = typesQ.data ?? [];

  async function handleCancel(req: HrRequestRow): Promise<void> {
    const confirmed = await dialog.confirm({ title: 'Cancel Request', text: `Cancel "${req.title}"?` });
    if (!confirmed) return;
    try {
      await cancelMut.mutateAsync({ requestId: req.id });
      toast('Request cancelled.');
    } catch (e) {
      toast((e as Error).message ?? 'Cancel failed.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button class="obx-btn primary" onClick={() => setNewOpen(true)}>+ New Request</button>
      </div>

      {requestsQ.isLoading && !requestsQ.data
        ? <TableSkeleton rows={4} cols={5} />
        : !rows.length
          ? <EmptyState icon="fa-inbox" title="No requests yet" text="Submit a request to get started." />
          : (
            <div class="obx-section"><div class="obx-section-body">
              <table class="obx-table">
                <thead><tr><th>Ref</th><th>Type</th><th>Title</th><th>Priority</th><th>Status</th><th>Submitted</th><th></th></tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.requestNo}</b></td>
                    <td class="obx-meta">{humanize(r.requestType)}</td>
                    <td>{r.title}</td>
                    <td class="obx-meta" style={{ textTransform: 'capitalize' }}>{r.priority}</td>
                    <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                    <td class="obx-meta">{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : '—'}</td>
                    <td>
                      {!TERMINAL.has(r.status) && (
                        <button class="obx-btn sm" onClick={() => handleCancel(r)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div></div>
          )
      }

      {newOpen && types.length > 0 && (
        <NewRequestModal types={types} onClose={() => setNewOpen(false)} onSubmitted={() => void requestsQ.refetch()} />
      )}
    </div>
  );
}

// ── Triage tab ────────────────────────────────────────────────────────────────

interface DecideModalProps {
  req: HrRequestRow;
  onClose: () => void;
  onDone: () => void;
}

function DecideModal({ req, onClose, onDone }: DecideModalProps): VNode {
  const [decision, setDecision] = useState('approved');
  const [comment, setComment]   = useState('');
  const [busy, setBusy]         = useState(false);

  async function submit(): Promise<void> {
    if ((decision === 'rejected' || decision === 'returned') && !comment.trim()) {
      void dialog.toast({ title: 'A comment is required to reject or return.' }); return;
    }
    setBusy(true);
    try {
      await hrRequestsApi.decide({
        requestId: req.id,
        decision: decision as 'approved' | 'rejected' | 'returned',
        comment: comment || undefined,
      });
      toast(`Request ${decision}.`);
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message ?? 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Decide: ${req.requestNo}`} onClose={onClose}>
      <p class="obx-meta">{req.title} — {humanize(req.requestType)}</p>
      <FormGrid>
        <Field label="Decision">
          <SelectInput
            value={decision}
            onInput={setDecision}
            options={[
              { value: 'approved', label: 'Approve' },
              { value: 'returned', label: 'Return to requester' },
              { value: 'rejected', label: 'Reject' },
            ]}
          />
        </Field>
        <Field label={`Comment${decision !== 'approved' ? ' (required)' : ''}`}>
          <textarea class="ui-input" rows={3} value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)} placeholder="Add a note…" />
        </Field>
      </FormGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <button class="obx-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button class="obx-btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Submit Decision'}</button>
      </div>
    </Modal>
  );
}

interface FulfillModalProps {
  req: HrRequestRow;
  onClose: () => void;
  onDone: () => void;
}

function FulfillModal({ req, onClose, onDone }: FulfillModalProps): VNode {
  const [note, setNote]          = useState('');
  const [artifactRef, setArtRef] = useState('');
  const [busy, setBusy]          = useState(false);

  async function submit(): Promise<void> {
    setBusy(true);
    try {
      await hrRequestsApi.fulfill({ requestId: req.id, note: note || undefined, artifactRef: artifactRef || undefined });
      toast('Request fulfilled.');
      onDone();
      onClose();
    } catch (e) {
      toast((e as Error).message ?? 'Fulfill failed.');
    } finally {
      setBusy(false);
    }
  }

  return (
    <Modal open title={`Fulfill: ${req.requestNo}`} onClose={onClose}>
      <p class="obx-meta">{req.title}</p>
      <FormGrid>
        <Field label="Fulfillment note">
          <textarea class="ui-input" rows={3} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} placeholder="Describe what was delivered…" />
        </Field>
        <Field label="Artifact / document reference">
          <TextInput value={artifactRef} onInput={setArtRef} placeholder="e.g. doc ID, file name, SharePoint link" />
        </Field>
      </FormGrid>
      <div style={{ display: 'flex', gap: 10, justifyContent: 'flex-end', marginTop: 16 }}>
        <button class="obx-btn" onClick={onClose} disabled={busy}>Cancel</button>
        <button class="obx-btn primary" onClick={submit} disabled={busy}>{busy ? 'Saving…' : 'Mark Fulfilled'}</button>
      </div>
    </Modal>
  );
}

function TriageTab(): VNode {
  const [statusFilter, setStatusFilter] = useState('');
  const [typeFilter, setTypeFilter]     = useState('');
  const [decideReq, setDecideReq]       = useState<HrRequestRow | null>(null);
  const [fulfillReq, setFulfillReq]     = useState<HrRequestRow | null>(null);

  const typesQ    = useRequestTypes();
  const requestsQ = useAllRequests(statusFilter || typeFilter ? { status: statusFilter || undefined, requestType: typeFilter || undefined } : undefined);

  const rows: HrRequestRow[] = requestsQ.data ?? [];
  const types = typesQ.data ?? [];

  async function handleCancel(req: HrRequestRow): Promise<void> {
    const reason = await dialog.prompt({ title: `Reason for cancelling "${req.title}"?` });
    if (reason === null) return;
    try {
      await hrRequestsApi.cancel({ requestId: req.id, reason: reason || undefined });
      toast('Request cancelled.');
      void requestsQ.refetch();
    } catch (e) {
      toast((e as Error).message ?? 'Cancel failed.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', gap: 10, marginBottom: 12 }}>
        <select class="ui-select" style={{ width: 160 }} value={statusFilter} onChange={e => setStatusFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {['submitted','in_review','returned','approved','rejected','fulfilled','cancelled'].map(s => (
            <option key={s} value={s}>{humanize(s)}</option>
          ))}
        </select>
        <select class="ui-select" style={{ width: 180 }} value={typeFilter} onChange={e => setTypeFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All types</option>
          {types.map(t => <option key={t.key} value={t.key}>{t.label}</option>)}
        </select>
      </div>

      {requestsQ.isLoading && !requestsQ.data
        ? <TableSkeleton rows={5} cols={7} />
        : !rows.length
          ? <EmptyState icon="fa-inbox" title="No requests" text="No HR requests match this filter." />
          : (
            <div class="obx-section"><div class="obx-section-body">
              <table class="obx-table">
                <thead><tr><th>Ref</th><th>Employee</th><th>Type</th><th>Title</th><th>Status</th><th>Submitted</th><th>Actions</th></tr></thead>
                <tbody>{rows.map(r => (
                  <tr key={r.id}>
                    <td><b>{r.requestNo}</b></td>
                    <td class="obx-meta">{r.employeeName ?? r.employeeId}</td>
                    <td class="obx-meta">{humanize(r.requestType)}</td>
                    <td>{r.title}</td>
                    <td><span class={`obx-pill ${statusTone(r.status)}`}>{humanize(r.status)}</span></td>
                    <td class="obx-meta">{r.requestedAt ? new Date(r.requestedAt).toLocaleDateString() : '—'}</td>
                    <td style={{ whiteSpace: 'nowrap' }}>
                      {(r.status === 'submitted' || r.status === 'in_review') && (
                        <button class="obx-btn sm" style={{ marginRight: 4 }} onClick={() => setDecideReq(r)}>Decide</button>
                      )}
                      {r.status === 'approved' && (
                        <button class="obx-btn sm primary" style={{ marginRight: 4 }} onClick={() => setFulfillReq(r)}>Fulfill</button>
                      )}
                      {!TERMINAL.has(r.status) && (
                        <button class="obx-btn sm" onClick={() => handleCancel(r)}>Cancel</button>
                      )}
                    </td>
                  </tr>
                ))}</tbody>
              </table>
            </div></div>
          )
      }

      {decideReq && <DecideModal req={decideReq} onClose={() => setDecideReq(null)} onDone={() => void requestsQ.refetch()} />}
      {fulfillReq && <FulfillModal req={fulfillReq} onClose={() => setFulfillReq(null)} onDone={() => void requestsQ.refetch()} />}
    </div>
  );
}

// ── Main component ────────────────────────────────────────────────────────────

export function HRRequestsOverview(): VNode {
  const canSubmit = can('hr.requests.submit_own');
  const canManage = can('hr.requests.manage');

  // Default tab: employee sees My Requests, HR-only users see Triage.
  const [tab, setTab] = useState<'my' | 'triage'>(() => (canSubmit ? 'my' : 'triage'));

  const showTabs = canSubmit && canManage;

  return (
    <div class="hr-requests">
      <PageHeader
        icon="fa-inbox"
        module="HR · Requests"
        title="Request Center"
        sub="Employee self-service requests and HR triage."
      />

      {showTabs && (
        <div class="obx-tabs" style={{ marginBottom: 16 }}>
          <button class={`obx-tab${tab === 'my' ? ' active' : ''}`} onClick={() => setTab('my')}>My Requests</button>
          <button class={`obx-tab${tab === 'triage' ? ' active' : ''}`} onClick={() => setTab('triage')}>Triage</button>
        </div>
      )}

      {!showTabs && canSubmit && <p class="obx-meta" style={{ marginBottom: 8 }}>Your submitted requests.</p>}
      {!showTabs && canManage && <p class="obx-meta" style={{ marginBottom: 8 }}>All employee HR requests — triage and resolve.</p>}

      {(tab === 'my' || !canManage) && canSubmit && <MyRequestsTab />}
      {(tab === 'triage' || !canSubmit) && canManage && <TriageTab />}
    </div>
  );
}
