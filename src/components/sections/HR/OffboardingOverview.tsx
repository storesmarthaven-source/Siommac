/**
 * src/components/sections/HR/OffboardingOverview.tsx
 *
 * HR ▸ Offboarding — functional-only exit console. Plain page: header + stat row +
 * cases table (status filter) + New Case modal; row click opens an inline case
 * detail with the lifecycle (Pause/Resume/Mark Ready for Exit/Finalize/Cancel/
 * Complete + owner reassign) and plain task/handoff/blocker tables. No widget board.
 * Gated by hr.offboarding.*; the backend enforces, the UI hides.
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { toast } from '@store';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { EnterpriseFormModal, type DialogContextPanelConfig } from '@/components/common/dialogs';
import { can } from '@lib/permissions';
import { PageHeader, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
import {
  useOffboardingCases, useOffboardingCase, useOffboardingStats, useOffboardingMutation, hrOffboardingApi,
} from '@api/hr/offboarding';
import { useHrEmployees } from '@api/hr/employees';
import type { OffboardingReason } from '../../../../types/hrOffboarding';
import { OffboardingDashboard, OffboardingDashboardSkeleton } from './offboardingWidgets';
import './onboardingCase.css';

const REASONS: OffboardingReason[] = ['resignation', 'termination', 'redundancy', 'end_of_contract', 'retirement'];
const STATUS_FILTERS = ['all', 'in_progress', 'open', 'paused', 'blocked', 'ready_for_exit', 'draft', 'completed', 'cancelled'] as const;
function humanize(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }
function statusTone(s: string): 'green' | 'gray' | 'red' {
  return s === 'completed' ? 'green' : s === 'cancelled' ? 'red' : 'gray';
}

export function OffboardingOverview(): VNode {
  const [statusFilter, setStatusFilter] = useState<string>('all');
  const [selectedId, setSelectedId] = useState<string | null>(null);
  const [newOpen, setNewOpen] = useState(false);

  const casesQ = useOffboardingCases(statusFilter === 'all' ? undefined : statusFilter);
  const allCasesQ = useOffboardingCases();          // unfiltered — feeds the dashboard widgets
  const statsQ = useOffboardingStats();
  const canStart = can('hr.offboarding.start');

  if (selectedId) return <CaseDetail caseId={selectedId} onBack={() => setSelectedId(null)} />;

  const rows = casesQ.data ?? [];

  return (
    <div class="hr-offboarding">
      <PageHeader
        icon="fa-door-open" module="HR · Offboarding" title="Offboarding"
        sub="Employee exits — clearance, asset return, access removal & final pay."
        meta={[{ icon: 'fa-list-check', label: `${(allCasesQ.data ?? rows).length} cases` }]}
        actions={canStart ? <button class="obx-btn primary" onClick={() => setNewOpen(true)}>+ New Case</button> : undefined}
      />

      {statsQ.data
        ? <OffboardingDashboard stats={statsQ.data} cases={allCasesQ.data ?? []} onOpenCase={setSelectedId} onFilterStatus={st => setStatusFilter(st)} />
        : <OffboardingDashboardSkeleton />}

      <div style={{ display: 'flex', gap: 10, margin: '10px 0' }}>
        <select class="ui-select" style={{ width: 180 }} value={statusFilter} onChange={e => setStatusFilter((e.target as HTMLSelectElement).value)}>
          {STATUS_FILTERS.map(f => <option key={f} value={f}>{f === 'all' ? 'All statuses' : humanize(f)}</option>)}
        </select>
      </div>

      <div class="obx-section"><div class="obx-section-body">
        {casesQ.isLoading && !casesQ.data ? <div class="obx-empty">Loading…</div>
          : !rows.length ? <EmptyState icon="fa-door-open" title="No offboarding cases" text={canStart ? 'Start a case to begin an employee exit.' : 'No offboarding cases match this filter.'} />
          : (
            <table class="obx-table">
              <thead><tr><th>Case</th><th>Employee</th><th>Reason</th><th>Owner</th><th style={{ textAlign: 'center' }}>Tasks</th><th>Last day</th><th>Status</th></tr></thead>
              <tbody>{rows.map(c => (
                <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setSelectedId(c.id)}>
                  <td><b>{c.caseNo}</b></td>
                  <td>{c.employeeName ?? c.employeeId ?? '—'}</td>
                  <td class="obx-meta">{humanize(c.reason)}</td>
                  <td class="obx-meta">{c.ownerName ?? '—'}</td>
                  <td class="obx-meta" style={{ textAlign: 'center' }}>{c.taskCount - c.openTaskCount}/{c.taskCount}</td>
                  <td class="obx-meta">{c.lastWorkingDay ?? '—'}</td>
                  <td><span class={`obx-pill ${statusTone(c.status)}`}>{humanize(c.status)}</span></td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div></div>

      {newOpen && <NewCaseModal onClose={() => setNewOpen(false)} onCreated={id => { setNewOpen(false); setSelectedId(id); }} />}
    </div>
  );
}

function NewCaseModal({ onClose, onCreated }: { onClose: () => void; onCreated: (caseId: string) => void }): VNode {
  const peopleQ = useHrEmployees({});
  const startMut = useOffboardingMutation(hrOffboardingApi.start);
  const [f, setF] = useState({ employeeId: '', reason: 'resignation' as OffboardingReason, ownerId: '', lastWorkingDay: '' });
  const peopleOpts = useMemo(() => (peopleQ.data ?? []).map(e => ({ value: e.id, label: e.full_name ?? e.id })), [peopleQ.data]);

  async function submit(): Promise<void> {
    if (!f.employeeId) { toast('Select an employee'); return; }
    try {
      const r = await startMut.mutateAsync({
        employeeId: f.employeeId, reason: f.reason, ownerId: f.ownerId || null, lastWorkingDay: f.lastWorkingDay || null,
      });
      toast(`Offboarding started (${r.caseNo})`);
      onCreated(r.caseId);
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to start offboarding'); }
  }
  const empName = peopleOpts.find(o => o.value === f.employeeId)?.label;
  const context: DialogContextPanelConfig = {
    eyebrow: 'HR · Offboarding', title: 'Exit Preview', description: 'Preview what starting this offboarding case creates.',
    preview: {
      icon: 'OFB', title: empName ?? 'Select employee', subtitle: humanize(f.reason),
      badges: f.lastWorkingDay ? [{ label: `Last day ${f.lastWorkingDay}`, tone: 'info' }] : [],
    },
    validation: [...(!f.employeeId ? [{ message: 'Select an employee.', tone: 'danger' as const }] : [])],
    whatNext: [
      { label: 'Exit tasks created', description: 'Clearance, access removal, asset return, exit interview, final pay.' },
      { label: 'Cross-module handoffs raised', description: 'IT access-removal, finance final-pay, HSE PPE-return.' },
      { label: 'On finalize', description: 'The employee is terminated and their login is disabled.' },
    ],
  };
  return (
    <EnterpriseFormModal open
      title="New Offboarding Case"
      subtitle="Start an employee exit — the panel previews the tasks and handoffs it creates."
      icon={<i class="fas fa-door-open" />}
      context={context}
      primaryLabel="Start Offboarding"
      loading={startMut.isPending}
      disabled={!f.employeeId}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Employee" wide><SelectInput value={f.employeeId} onInput={v => setF(s => ({ ...s, employeeId: v }))} options={peopleOpts} placeholder="Select employee…" /></Field>
        <Field label="Reason"><SelectInput value={f.reason} onInput={v => setF(s => ({ ...s, reason: v as OffboardingReason }))} options={REASONS.map(r => ({ value: r, label: humanize(r) }))} /></Field>
        <Field label="Case owner"><SelectInput value={f.ownerId} onInput={v => setF(s => ({ ...s, ownerId: v }))} options={peopleOpts} placeholder="— You —" /></Field>
        <Field label="Last working day"><TextInput type="date" value={f.lastWorkingDay} onInput={v => setF(s => ({ ...s, lastWorkingDay: v }))} /></Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

function CaseDetail({ caseId, onBack }: { caseId: string; onBack: () => void }): VNode {
  const q = useOffboardingCase(caseId);
  const completeTaskMut = useOffboardingMutation(hrOffboardingApi.completeTask);
  const pauseMut = useOffboardingMutation(hrOffboardingApi.pause);
  const resumeMut = useOffboardingMutation(hrOffboardingApi.resume);
  const readyMut = useOffboardingMutation(hrOffboardingApi.markReady);
  const finalizeMut = useOffboardingMutation(hrOffboardingApi.finalize);
  const cancelMut = useOffboardingMutation(hrOffboardingApi.cancel);
  const completeMut = useOffboardingMutation(hrOffboardingApi.complete);

  const canManage = can('hr.offboarding.case.manage');
  const canFinalize = can('hr.offboarding.finalize');
  const canTask = can('hr.offboarding.task.manage');

  async function run(p: Promise<unknown>, msg: string): Promise<void> {
    try { await p; toast(msg); } catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  }

  if (q.isLoading && !q.data) return <div class="hr-offboarding"><button class="obx-back" onClick={onBack}>← Offboarding</button><div class="obx-empty">Loading…</div></div>;
  if (!q.data) return <div class="hr-offboarding"><button class="obx-back" onClick={onBack}>← Offboarding</button><div class="obx-empty">Case not found.</div></div>;
  const { case: c, tasks, handoffs, blockers } = q.data;
  const terminal = c.status === 'completed' || c.status === 'cancelled';

  // ── Lifecycle actions via ActionModal (record + status transition + consequence) ──
  const caseRecord = toActionRecord({
    title: `${c.caseNo} · ${c.employeeName ?? '—'}`, subtitle: humanize(c.reason), icon: 'fa-door-open',
    badges: [statusBadge(c.status)],
    fields: [c.lastWorkingDay ? { label: 'Last working day', value: c.lastWorkingDay } : null],
  });
  const onPause = async (): Promise<void> => {
    const r = await openActionModal({ title: 'Pause case', icon: 'fa-circle-pause', tone: 'warning', record: caseRecord, whatNext: ['The case is paused; it leaves the active queue until resumed.'], confirmLabel: 'Pause' });
    if (r.confirmed) await run(pauseMut.mutateAsync({ caseId }), 'Paused');
  };
  const onResume = async (): Promise<void> => {
    const r = await openActionModal({ title: 'Resume case', icon: 'fa-circle-play', tone: 'info', record: caseRecord, whatNext: ['The case resumes and re-enters the active queue.'], confirmLabel: 'Resume' });
    if (r.confirmed) await run(resumeMut.mutateAsync({ caseId }), 'Resumed');
  };
  const onReady = async (): Promise<void> => {
    const r = await openActionModal({ title: 'Mark ready for exit', icon: 'fa-flag-checkered', tone: 'info', record: caseRecord, warning: 'Confirm all exit tasks are complete.', whatNext: ['Status → ready_for_exit; the case is ready for final exit / finalize.'], confirmLabel: 'Mark ready' });
    if (r.confirmed) await run(readyMut.mutateAsync({ caseId }), 'Marked ready for exit');
  };
  const onComplete = async (): Promise<void> => {
    const r = await openActionModal({ title: 'Complete case', icon: 'fa-circle-check', tone: 'warning', record: caseRecord, warning: 'Completing closes the offboarding case.', whatNext: ['Status → completed; no further changes.'], confirmLabel: 'Complete' });
    if (r.confirmed) await run(completeMut.mutateAsync({ caseId }), 'Case completed');
  };
  const onFinalize = async (): Promise<void> => {
    const r = await openActionModal({
      title: 'Finalize exit', icon: 'fa-user-slash', tone: 'danger', record: caseRecord,
      warning: 'This terminates the employee and disables their login.',
      whatNext: ['Employee status → terminated (login disabled).', 'IT access-removal, final-pay and PPE-return handoffs are raised.', 'Status → completed.'],
      confirmLabel: 'Finalize exit',
    });
    if (r.confirmed) await run(finalizeMut.mutateAsync({ caseId }), 'Exit finalized — employee terminated');
  };
  const onCancel = async (): Promise<void> => {
    const r = await openActionModal({
      title: 'Cancel case', icon: 'fa-xmark', tone: 'danger', record: caseRecord,
      warning: 'Cancelling this offboarding case cannot be undone.',
      reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this being cancelled?' },
      whatNext: ['Open tasks and handoffs are voided.', 'Status → cancelled.'],
      confirmLabel: 'Cancel case',
    });
    if (r.confirmed) await run(cancelMut.mutateAsync({ caseId, reason: r.reason || undefined }), 'Case cancelled');
  };

  return (
    <div class="hr-offboarding">
      <button class="obx-back" onClick={onBack}>← Offboarding</button>
      <PageHeader
        icon="fa-door-open" module="HR · Offboarding" title={`${c.caseNo} · ${c.employeeName ?? '—'}`}
        sub={`${humanize(c.reason)} · ${humanize(c.status)}${c.lastWorkingDay ? ` · last day ${c.lastWorkingDay}` : ''}`}
        actions={canManage && !terminal ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {c.status === 'paused'
              ? <button class="obx-mini" onClick={() => void onResume()}>Resume</button>
              : <button class="obx-mini" onClick={() => void onPause()}>Pause</button>}
            <button class="obx-mini" onClick={() => void onReady()}>Mark Ready for Exit</button>
            <button class="obx-mini" onClick={() => void onComplete()}>Complete</button>
            {canFinalize && <button class="obx-mini danger" onClick={() => void onFinalize()}>Finalize Exit</button>}
            <button class="obx-mini" onClick={() => void onCancel()}>Cancel</button>
          </div>
        ) : undefined}
      />

      <div class="obx-section"><div class="obx-section-head">Tasks</div><div class="obx-section-body">
        {!tasks.length ? <div class="obx-empty">No tasks.</div> : (
          <table class="obx-table">
            <thead><tr><th>Task</th><th>Owner</th><th>Blocking</th><th>Status</th><th>Actions</th></tr></thead>
            <tbody>{tasks.map(t => (
              <tr key={t.id}>
                <td><b>{t.taskTitle}</b><div class="obx-meta" style={{ fontSize: 12 }}>{t.moduleKey ?? '—'}</div></td>
                <td class="obx-meta">{t.assignedToName ?? t.ownerRole ?? '—'}</td>
                <td class="obx-meta">{t.isBlocking ? 'Yes' : '—'}</td>
                <td><span class={`obx-pill ${t.status === 'completed' ? 'green' : 'gray'}`}>{humanize(t.status)}</span></td>
                <td>{canTask && t.status !== 'completed' && !terminal ? <button class="obx-mini" onClick={() => void run(completeTaskMut.mutateAsync({ taskId: t.id }), 'Task completed')}>Complete</button> : <span class="obx-meta">—</span>}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div></div>

      <div class="obx-section"><div class="obx-section-head">Handoffs</div><div class="obx-section-body">
        {!handoffs.length ? <div class="obx-empty">No handoffs.</div> : (
          <table class="obx-table">
            <thead><tr><th>Target</th><th>Type</th><th>Status</th></tr></thead>
            <tbody>{handoffs.map(h => (
              <tr key={h.id}><td class="obx-meta">{humanize(h.targetModule)}</td><td class="obx-meta">{humanize(h.handoffType ?? '—')}</td><td><span class="obx-pill gray">{humanize(h.status)}</span></td></tr>
            ))}</tbody>
          </table>
        )}
      </div></div>

      {blockers.length > 0 && (
        <div class="obx-section"><div class="obx-section-head">Blockers</div><div class="obx-section-body">
          <table class="obx-table">
            <thead><tr><th>Blocker</th><th>Severity</th><th>Status</th></tr></thead>
            <tbody>{blockers.map(b => (
              <tr key={b.id}><td><b>{b.title}</b></td><td class="obx-meta">{humanize(b.severity)}</td><td><span class="obx-pill gray">{humanize(b.status)}</span></td></tr>
            ))}</tbody>
          </table>
        </div></div>
      )}
    </div>
  );
}
