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
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PageHeader, Field, FormGrid, SelectInput, TextInput, EmptyState, TableSkeleton } from '@ui';
import {
  useRequestTypes, useMyRequests, useAllRequests, useRequestsMutation, hrRequestsApi,
} from '@api/hr/requests';
import type { HrRequestRow, HrRequestTypeDef } from '../../../../types/hrRequests';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function requestRecord(req: HrRequestRow) {
  return toActionRecord({
    title: req.title, subtitle: `${req.requestNo ?? ''} · ${humanize(req.requestType)}`.replace(/^ · /, ''), icon: 'fa-inbox',
    badges: [statusBadge(req.status)], fields: [],
  });
}

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
    if (!title.trim()) { toast('Please enter a title.'); return; }
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
      toast(e instanceof Error ? e.message : 'Submit failed.');
    } finally {
      setBusy(false);
    }
  }

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Requests', title: 'Request Preview', description: 'Preview how this request will be routed.',
    preview: {
      icon: 'REQ', title: selectedType?.label ?? 'Request', subtitle: title.trim() || 'Untitled request',
      badges: [{ label: humanize(priority), tone: priority === 'high' ? 'warning' : priority === 'low' ? 'muted' : 'info' }],
    },
    derived: selectedType ? { title: 'Request type', fields: [{ label: 'What this is', value: selectedType.description }] } : undefined,
    validation: [...(!title.trim() ? [{ message: 'Enter a title / subject.', tone: 'danger' as const }] : [])],
    approval: { required: true, risk: priority === 'high' ? 'medium' : 'low', message: 'Submitted to HR for triage and decision.' },
    whatNext: [
      { label: 'Routes to HR triage', description: 'HR reviews and approves, rejects, or fulfils the request.' },
      { label: 'Track status', description: 'It appears under My Requests with live status updates.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New HR Request"
      subtitle="Raise a self-service request — the panel previews its routing."
      icon={<i class="fas fa-inbox" />}
      context={context}
      primaryLabel="Submit Request"
      loading={busy}
      disabled={!title.trim()}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Request Type" wide>
          <SelectInput value={requestType} onInput={setRequestType} options={types.map(t => ({ value: t.key, label: t.label }))} />
        </Field>
        <Field label="Title / Subject" wide>
          <TextInput value={title} onInput={setTitle} placeholder="Brief description of your request" />
        </Field>
        <Field label="Details" wide>
          <textarea class="ui-input" rows={4} value={details} onInput={e => setDetails((e.target as HTMLTextAreaElement).value)} placeholder="Provide any relevant details…" />
        </Field>
        <Field label="Priority">
          <SelectInput value={priority} onInput={setPriority}
            options={[{ value: 'low', label: 'Low' }, { value: 'normal', label: 'Normal' }, { value: 'high', label: 'High' }]} />
        </Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

function MyRequestsTab(): VNode {
  const [newOpen, setNewOpen] = useState(false);
  const typesQ    = useRequestTypes();
  const requestsQ = useMyRequests();
  const cancelMut = useRequestsMutation((a: { requestId: string; reason?: string }) => hrRequestsApi.cancel(a));

  const rows: HrRequestRow[] = requestsQ.data ?? [];
  const types = typesQ.data ?? [];

  async function handleCancel(req: HrRequestRow): Promise<void> {
    const res = await openActionModal({ title: 'Cancel request', icon: 'fa-xmark', tone: 'danger', record: requestRecord(req), warning: 'This withdraws your request.', reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why are you cancelling?' }, whatNext: ['Status → cancelled.'], confirmLabel: 'Cancel request' });
    if (!res.confirmed) return;
    try {
      await cancelMut.mutateAsync({ requestId: req.id, reason: res.reason ?? undefined });
      toast('Request cancelled.');
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Cancel failed.');
    }
  }

  return (
    <div>
      <div style={{ display: 'flex', justifyContent: 'flex-end', marginBottom: 12 }}>
        <button class="obx-btn primary" onClick={() => setNewOpen(true)}>+ New Request</button>
      </div>

      {requestsQ.isLoading && !requestsQ.data
        ? <div class="obx-section"><div class="obx-section-body"><table class="obx-table"><tbody><TableSkeleton rows={4} cols={7} /></tbody></table></div></div>
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
                        <button class="obx-btn sm" onClick={() => void handleCancel(r)}>Cancel</button>
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
      toast('A comment is required to reject or return.'); return;
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
      toast(e instanceof Error ? e.message : 'Decision failed.');
    } finally {
      setBusy(false);
    }
  }

  const needsComment = decision === 'rejected' || decision === 'returned';
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Requests', title: 'Decision', description: 'Review the request before deciding.',
    preview: { icon: 'REQ', title: `${req.requestNo} · ${req.title}`, subtitle: humanize(req.requestType), badges: [statusBadge(req.status)] },
    validation: [...(needsComment && !comment.trim() ? [{ message: 'A comment is required to reject or return.', tone: 'danger' as const }] : [])],
    approval: { required: false, message: 'You act as the approver — the decision is audited.' },
    whatNext: [
      decision === 'approved' ? { label: 'Approved', description: 'The request proceeds to fulfilment.' }
        : decision === 'returned' ? { label: 'Returned', description: 'Sent back to the requester for changes.' }
        : { label: 'Rejected', description: 'The request is declined.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title={`Decide: ${req.requestNo}`}
      subtitle="Approve, return, or reject this request."
      icon={<i class="fas fa-gavel" />}
      context={context}
      primaryLabel="Submit Decision"
      loading={busy}
      disabled={needsComment && !comment.trim()}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Decision" wide>
          <SelectInput value={decision} onInput={setDecision}
            options={[{ value: 'approved', label: 'Approve' }, { value: 'returned', label: 'Return to requester' }, { value: 'rejected', label: 'Reject' }]} />
        </Field>
        <Field label={`Comment${needsComment ? ' (required)' : ''}`} wide>
          <textarea class="ui-input" rows={3} value={comment} onInput={e => setComment((e.target as HTMLTextAreaElement).value)} placeholder="Add a note…" />
        </Field>
      </FormGrid>
    </EnterpriseFormModal>
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
      toast(e instanceof Error ? e.message : 'Fulfill failed.');
    } finally {
      setBusy(false);
    }
  }

  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Requests', title: 'Fulfilment', description: 'Record how this request was delivered.',
    preview: { icon: 'REQ', title: `${req.requestNo} · ${req.title}`, subtitle: humanize(req.requestType), badges: [statusBadge(req.status)] },
    whatNext: [{ label: 'Marks fulfilled', description: 'Status → fulfilled; the requester is notified.' }],
  };
  return (
    <EnterpriseFormModal open
      title={`Fulfill: ${req.requestNo}`}
      subtitle="Record delivery and close out the request."
      icon={<i class="fas fa-clipboard-check" />}
      context={context}
      primaryLabel="Mark Fulfilled"
      loading={busy}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Fulfillment note" wide>
          <textarea class="ui-input" rows={3} value={note} onInput={e => setNote((e.target as HTMLTextAreaElement).value)} placeholder="Describe what was delivered…" />
        </Field>
        <Field label="Artifact / document reference" wide>
          <TextInput value={artifactRef} onInput={setArtRef} placeholder="e.g. doc ID, file name, SharePoint link" />
        </Field>
      </FormGrid>
    </EnterpriseFormModal>
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
    const res = await openActionModal({ title: 'Cancel request', icon: 'fa-xmark', tone: 'danger', record: requestRecord(req), warning: 'Cancelling this request cannot be undone.', reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this being cancelled?' }, whatNext: ['Status → cancelled.'], confirmLabel: 'Cancel request' });
    if (!res.confirmed) return;
    try {
      await hrRequestsApi.cancel({ requestId: req.id, reason: res.reason ?? undefined });
      toast('Request cancelled.');
      void requestsQ.refetch();
    } catch (e) {
      toast(e instanceof Error ? e.message : 'Cancel failed.');
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
        ? <div class="obx-section"><div class="obx-section-body"><table class="obx-table"><tbody><TableSkeleton rows={5} cols={7} /></tbody></table></div></div>
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
                        <button class="obx-btn sm" onClick={() => void handleCancel(r)}>Cancel</button>
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
