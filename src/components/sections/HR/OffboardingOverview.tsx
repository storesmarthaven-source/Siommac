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
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PageHeader, Modal, Field, FormGrid, SelectInput, TextInput, EmptyState } from '@ui';
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
  return (
    <Modal open title="New Offboarding Case" icon="fa-door-open" onClose={onClose}
      onSubmit={() => void submit()} submitLabel="Start" submitDisabled={startMut.isPending}>
      <FormGrid>
        <Field label="Employee" wide><SelectInput value={f.employeeId} onInput={v => setF(s => ({ ...s, employeeId: v }))} options={peopleOpts} placeholder="Select employee…" /></Field>
        <Field label="Reason"><SelectInput value={f.reason} onInput={v => setF(s => ({ ...s, reason: v as OffboardingReason }))} options={REASONS.map(r => ({ value: r, label: humanize(r) }))} /></Field>
        <Field label="Case owner"><SelectInput value={f.ownerId} onInput={v => setF(s => ({ ...s, ownerId: v }))} options={peopleOpts} placeholder="— You —" /></Field>
        <Field label="Last working day"><TextInput type="date" value={f.lastWorkingDay} onInput={v => setF(s => ({ ...s, lastWorkingDay: v }))} /></Field>
      </FormGrid>
    </Modal>
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
  async function onFinalize(caseNo: string): Promise<void> {
    if (!await dialog.confirm({ title: `Finalize ${caseNo}?`, text: 'This terminates the employee (disables login) and raises the IT access-removal handoff.' })) return;
    await run(finalizeMut.mutateAsync({ caseId }), 'Exit finalized — employee terminated');
  }
  async function onCancel(): Promise<void> {
    const r = await dialog.prompt({ title: 'Reason for cancelling this case?' });
    if (r === null) return;
    await run(cancelMut.mutateAsync({ caseId, reason: r || undefined }), 'Case cancelled');
  }

  if (q.isLoading && !q.data) return <div class="hr-offboarding"><button class="obx-back" onClick={onBack}>← Offboarding</button><div class="obx-empty">Loading…</div></div>;
  if (!q.data) return <div class="hr-offboarding"><button class="obx-back" onClick={onBack}>← Offboarding</button><div class="obx-empty">Case not found.</div></div>;
  const { case: c, tasks, handoffs, blockers } = q.data;
  const terminal = c.status === 'completed' || c.status === 'cancelled';

  return (
    <div class="hr-offboarding">
      <button class="obx-back" onClick={onBack}>← Offboarding</button>
      <PageHeader
        icon="fa-door-open" module="HR · Offboarding" title={`${c.caseNo} · ${c.employeeName ?? '—'}`}
        sub={`${humanize(c.reason)} · ${humanize(c.status)}${c.lastWorkingDay ? ` · last day ${c.lastWorkingDay}` : ''}`}
        actions={canManage && !terminal ? (
          <div style={{ display: 'flex', gap: 8, flexWrap: 'wrap' }}>
            {c.status === 'paused'
              ? <button class="obx-mini" onClick={() => void run(resumeMut.mutateAsync({ caseId }), 'Resumed')}>Resume</button>
              : <button class="obx-mini" onClick={() => void run(pauseMut.mutateAsync({ caseId }), 'Paused')}>Pause</button>}
            <button class="obx-mini" onClick={() => void run(readyMut.mutateAsync({ caseId }), 'Marked ready for exit')}>Mark Ready for Exit</button>
            <button class="obx-mini" onClick={() => void run(completeMut.mutateAsync({ caseId }), 'Case completed')}>Complete</button>
            {canFinalize && <button class="obx-mini danger" onClick={() => void onFinalize(c.caseNo)}>Finalize Exit</button>}
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
