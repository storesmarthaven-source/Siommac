/**
 * src/components/sections/HR/OnboardingTasksWorkspace.tsx
 *
 * HR ▸ Onboarding ▸ Tasks — the CROSS-CASE execution queue (Phase 2 of the
 * remaining-surfaces plan). Case Detail manages one case's tasks; this workspace is
 * where HR Operations works the whole queue: every open task across every active
 * case, in four views (Table · Board · Owner · Due Date), with a task drawer for
 * notes, evidence, and the standard task actions.
 *
 * Plain admin page (no widget board — this is an operational queue, not a
 * dashboard), same shape as OnboardingPackageManager. All data + mutations hit the
 * real onboarding API; mutations invalidate ['hr','onboarding'].
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader, Drawer, Field, FormGrid, TextInput, SelectInput, Modal } from '@ui';
import {
  useOnboardingTasksList, useOnboardingTaskDetail, useOnboardingPackages,
  useOnboardingCompleteTask, useOnboardingReassignTask, useOnboardingBlockTask, useOnboardingUnblockTask,
  useOnboardingAddTask, useOnboardingAddTaskNote, useOnboardingAttachTaskEvidence,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import type { OnboardingTaskRow, DueState } from '../../../../types/hrOnboarding';
import { taskStatusPill, pillClass, humanize, fmtDate, fmtDateTime } from './onboardingStatus';
import './onboardingCase.css';

type ViewMode = 'table' | 'board' | 'owner' | 'due';
const VIEWS: { key: ViewMode; label: string; icon: string }[] = [
  { key: 'table', label: 'Table', icon: 'fa-table-list' },
  { key: 'board', label: 'Board', icon: 'fa-table-columns' },
  { key: 'owner', label: 'Owner', icon: 'fa-user-group' },
  { key: 'due', label: 'Due Date', icon: 'fa-calendar-days' },
];
const TASK_STATUSES = ['pending', 'open', 'in_progress', 'blocked', 'completed', 'skipped', 'cancelled'];
const OPEN_STATUSES = new Set(['pending', 'open', 'in_progress', 'blocked']);
const DUE_OPTS: { v: DueState; label: string }[] = [
  { v: 'all', label: 'Any due date' }, { v: 'overdue', label: 'Overdue' },
  { v: 'due_today', label: 'Due today' }, { v: 'due_this_week', label: 'Due this week' },
];
const BOARD_COLS: { key: string; label: string; statuses: string[] }[] = [
  { key: 'pending', label: 'Pending', statuses: ['pending', 'open'] },
  { key: 'in_progress', label: 'In Progress', statuses: ['in_progress'] },
  { key: 'blocked', label: 'Blocked', statuses: ['blocked'] },
  { key: 'completed', label: 'Completed', statuses: ['completed'] },
  { key: 'closed', label: 'Skipped / Cancelled', statuses: ['skipped', 'cancelled'] },
];

const isOpen = (s: string): boolean => OPEN_STATUSES.has(s);
const isOverdue = (t: OnboardingTaskRow): boolean => isOpen(t.status) && !!t.dueAt && new Date(t.dueAt).getTime() < Date.now();
function dueGroup(t: OnboardingTaskRow): 'overdue' | 'today' | 'week' | 'later' | 'none' {
  if (!t.dueAt) return 'none';
  const d = new Date(t.dueAt);
  const start = new Date(); start.setHours(0, 0, 0, 0);
  const endToday = new Date(start); endToday.setDate(endToday.getDate() + 1);
  const in7 = new Date(start); in7.setDate(in7.getDate() + 7);
  if (d < start) return 'overdue';
  if (d < endToday) return 'today';
  if (d < in7) return 'week';
  return 'later';
}
const DUE_GROUPS: { key: ReturnType<typeof dueGroup>; label: string; tone: string }[] = [
  { key: 'overdue', label: 'Overdue', tone: 'red' },
  { key: 'today', label: 'Due today', tone: 'amber' },
  { key: 'week', label: 'Due this week', tone: 'blue' },
  { key: 'later', label: 'Later', tone: 'gray' },
  { key: 'none', label: 'No due date', tone: 'gray' },
];

export function OnboardingTasksWorkspace({
  onBack, onOpenCase, onToast,
}: { onBack: () => void; onOpenCase: (caseId: string) => void; onToast: (m: string) => void }): VNode {
  const [view, setView] = useState<ViewMode>('table');
  const [query, setQuery] = useState('');
  const [status, setStatus] = useState('');
  const [ownerRole, setOwnerRole] = useState('');
  const [pkgKey, setPkgKey] = useState('');
  const [dueState, setDueState] = useState<DueState>('all');
  const [blockingOnly, setBlockingOnly] = useState(false);
  const [drawerTaskId, setDrawerTaskId] = useState<string | null>(null);
  const [addOpen, setAddOpen] = useState(false);

  const tasksQ = useOnboardingTasksList({
    query: query.trim() || undefined,
    statuses: status ? [status] : undefined,
    ownerRoles: ownerRole ? [ownerRole] : undefined,
    packageKeys: pkgKey ? [pkgKey] : undefined,
    dueState: dueState !== 'all' ? dueState : undefined,
    blockingOnly: blockingOnly || undefined,
  });
  const rows = tasksQ.data ?? [];
  const pkgsQ = useOnboardingPackages();
  const empsQ = useHrEmployees({ limit: 500 });
  const employees = empsQ.data ?? [];
  const ownerRoles = useMemo(() => Array.from(new Set(rows.map(r => r.ownerRole).filter((x): x is string => !!x))).sort(), [rows]);

  // KPI strip — computed from the CURRENT filter set so the numbers match the list.
  const _kpi = useMemo(() => {
    const weekAgo = Date.now() - 7 * 86400_000;
    return {
      open: rows.filter(r => isOpen(r.status)).length,
      overdue: rows.filter(isOverdue).length,
      blocking: rows.filter(r => r.isBlocking && isOpen(r.status)).length,
      doneWeek: rows.filter(r => r.status === 'completed' && r.completedAt && new Date(r.completedAt).getTime() >= weekAgo).length,
    };
  }, [rows]);

  // ── mutations (shared run wrapper, same as Case Detail) ───────────────────────
  const completeMut = useOnboardingCompleteTask(), reassignMut = useOnboardingReassignTask();
  const blockMut = useOnboardingBlockTask(), unblockMut = useOnboardingUnblockTask();
  const addTaskMut = useOnboardingAddTask();
  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }
  async function handleComplete(t: OnboardingTaskRow): Promise<void> { await run(() => completeMut.mutateAsync({ taskId: t.taskId }), 'Task completed'); }
  async function handleBlock(t: OnboardingTaskRow): Promise<void> { const r = await dialog.prompt({ title: `Why is "${t.taskTitle}" blocked?` }); if (r === null) return; await run(() => blockMut.mutateAsync({ taskId: t.taskId, reason: r || null }), 'Task blocked'); }
  async function handleUnblock(t: OnboardingTaskRow): Promise<void> { await run(() => unblockMut.mutateAsync({ taskId: t.taskId }), 'Task unblocked'); }
  async function handleReassign(t: OnboardingTaskRow, assignedTo: string): Promise<void> { await run(() => reassignMut.mutateAsync({ taskId: t.taskId, assignedTo: assignedTo || null }), 'Task reassigned'); }

  // Add Task (needs a case picker — cross-case surface, unlike Case Detail's modal).
  const [addForm, setAddForm] = useState({ caseNo: '', taskTitle: '', assignedTo: '', dueAt: '', priority: 'normal', isBlocking: false });
  const caseOptions = useMemo(() => {
    const seen = new Map<string, string>();
    for (const r of rows) if (!seen.has(r.caseId)) seen.set(r.caseId, `${r.caseNo}${r.employeeName ? ` · ${r.employeeName}` : ''}`);
    return Array.from(seen.entries()).map(([id, label]) => ({ id, label }));
  }, [rows]);
  async function submitAdd(): Promise<void> {
    if (!addForm.caseNo) { onToast('Pick a case'); return; }
    if (!addForm.taskTitle.trim()) { onToast('Task title is required'); return; }
    await run(() => addTaskMut.mutateAsync({
      caseId: addForm.caseNo, taskTitle: addForm.taskTitle.trim(), assignedTo: addForm.assignedTo || null,
      dueAt: addForm.dueAt || null, priority: addForm.priority, isBlocking: addForm.isBlocking,
    }), 'Task added');
    setAddOpen(false);
  }

  // ── shared row bits ──────────────────────────────────────────────────────────--
  const Pill = ({ s }: { s: OnboardingTaskRow['status'] }): VNode => {
    const p = taskStatusPill(s);
    return <span class={`obx-pill ${pillClass(p)}`}>{p.label}</span>;
  };
  const rowActions = (t: OnboardingTaskRow): VNode => (
    <div class="obx-rowbtns">
      {isOpen(t.status) && <button class="obx-mini" onClick={e => { e.stopPropagation(); void handleComplete(t); }}>Complete</button>}
      {t.status === 'blocked'
        ? <button class="obx-mini" onClick={e => { e.stopPropagation(); void handleUnblock(t); }}>Unblock</button>
        : isOpen(t.status) && <button class="obx-mini" onClick={e => { e.stopPropagation(); void handleBlock(t); }}>Block</button>}
    </div>
  );
  const openDrawer = (t: OnboardingTaskRow): void => setDrawerTaskId(t.taskId);

  const taskCard = (t: OnboardingTaskRow): VNode => (
    <button type="button" class="obx-taskcard" key={t.taskId} onClick={() => openDrawer(t)}>
      <div class="obx-taskcard-title">{t.taskTitle}{t.isBlocking && <span class="obx-pill red" style={{ marginLeft: 6 }}>blocking</span>}</div>
      <div class="obx-taskcard-meta">{t.caseNo}{t.employeeName ? ` · ${t.employeeName}` : ''}</div>
      <div class="obx-taskcard-foot">
        <span class="obx-meta">{t.assignedToName ?? humanize(t.ownerRole ?? 'Unassigned')}</span>
        <span class={`obx-meta${isOverdue(t) ? ' obx-overdue' : ''}`}>{fmtDate(t.dueAt)}</span>
      </div>
    </button>
  );

  // ── views ─────────────────────────────────────────────────────────────────────
  const tableView = (): VNode => (
    <div class="obx-section">
      <div class="obx-section-body">
        {tasksQ.isLoading && !tasksQ.data ? <div class="obx-empty">Loading…</div> : !rows.length ? <div class="obx-empty">No tasks match these filters.</div> : (
          <table class="obx-table">
            <thead><tr><th>Task</th><th>Case</th><th>Employee</th><th>Owner</th><th>Assignee</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
            <tbody>{rows.map(t => (
              <tr key={t.taskId} style={{ cursor: 'pointer' }} onClick={() => openDrawer(t)}>
                <td><b>{t.taskTitle}</b>{t.isBlocking && <span class="obx-pill red" style={{ marginLeft: 8 }}>blocking</span>}</td>
                <td class="obx-meta">{t.caseNo}</td>
                <td class="obx-meta">{t.employeeName ?? '—'}</td>
                <td class="obx-meta">{humanize(t.ownerRole ?? '—')}</td>
                <td onClick={e => e.stopPropagation()}>
                  <select class="obx-mini-select" value={t.assignedTo ?? ''} onChange={e => void handleReassign(t, (e.target as HTMLSelectElement).value)} title="Reassign">
                    <option value="">Unassigned</option>
                    {employees.map(e2 => <option key={e2.id} value={e2.id}>{e2.full_name ?? e2.email ?? e2.id}</option>)}
                  </select>
                </td>
                <td><Pill s={t.status} /></td>
                <td class={isOverdue(t) ? 'obx-overdue' : 'obx-meta'}>{fmtDate(t.dueAt)}</td>
                <td onClick={e => e.stopPropagation()}>{rowActions(t)}</td>
              </tr>
            ))}</tbody>
          </table>
        )}
      </div>
    </div>
  );

  const boardView = (): VNode => (
    <div class="obx-board">
      {BOARD_COLS.map(col => {
        const items = rows.filter(t => col.statuses.includes(t.status));
        return (
          <div class="obx-board-col" key={col.key}>
            <div class="obx-board-head">{col.label}<span class="obx-board-count">{items.length}</span></div>
            <div class="obx-board-cards">{items.length ? items.map(taskCard) : <div class="obx-empty" style={{ padding: 12 }}>—</div>}</div>
          </div>
        );
      })}
    </div>
  );

  const groupedView = (groups: { label: string; items: OnboardingTaskRow[]; badge?: VNode }[]): VNode => (
    <div style={{ display: 'grid', gap: 14 }}>
      {groups.map(g => (
        <div class="obx-section" key={g.label}>
          <div class="obx-section-head"><h2><i class="fas fa-layer-group" />{g.label} <span class="obx-meta" style={{ fontWeight: 600 }}>({g.items.length})</span></h2>{g.badge}</div>
          <div class="obx-section-body">
            {!g.items.length ? <div class="obx-empty">No tasks.</div> : (
              <table class="obx-table">
                <thead><tr><th>Task</th><th>Case</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
                <tbody>{g.items.map(t => (
                  <tr key={t.taskId} style={{ cursor: 'pointer' }} onClick={() => openDrawer(t)}>
                    <td><b>{t.taskTitle}</b></td>
                    <td class="obx-meta">{t.caseNo}{t.employeeName ? ` · ${t.employeeName}` : ''}</td>
                    <td><Pill s={t.status} /></td>
                    <td class={isOverdue(t) ? 'obx-overdue' : 'obx-meta'}>{fmtDate(t.dueAt)}</td>
                    <td onClick={e => e.stopPropagation()}>{rowActions(t)}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      ))}
    </div>
  );

  const ownerView = (): VNode => {
    const open = rows.filter(t => isOpen(t.status));
    const byOwner = new Map<string, OnboardingTaskRow[]>();
    for (const t of open) {
      const key = t.assignedToName ?? (t.ownerRole ? `${humanize(t.ownerRole)} (role)` : 'Unassigned');
      byOwner.set(key, [...(byOwner.get(key) ?? []), t]);
    }
    const groups = Array.from(byOwner.entries()).sort((a, b) => b[1].length - a[1].length)
      .map(([label, items]) => ({ label, items }));
    return groupedView(groups.length ? groups : [{ label: 'Open tasks', items: [] }]);
  };

  const dueView = (): VNode => {
    const open = rows.filter(t => isOpen(t.status));
    const groups = DUE_GROUPS.map(g => ({ label: g.label, items: open.filter(t => dueGroup(t) === g.key) }))
      .filter(g => g.items.length > 0);
    return groupedView(groups.length ? groups : [{ label: 'Open tasks', items: [] }]);
  };

  return (
    <div class="hr-onboarding-tasks">
      <button class="obx-back" onClick={onBack}>← Onboarding</button>

      <PageHeader
        icon="fa-list-check"
        module="HR · Onboarding"
        title="Tasks"
        sub="Cross-case execution queue — every onboarding task, one workspace."
        actions={<button class="obx-btn primary" onClick={() => { setAddForm({ caseNo: '', taskTitle: '', assignedTo: '', dueAt: '', priority: 'normal', isBlocking: false }); setAddOpen(true); }}>+ Add Task</button>}
      />

      <div class="obx-toolbar">
        <div class="obx-viewswitch">
          {VIEWS.map(v => (
            <button key={v.key} type="button" class={`obx-view-btn${view === v.key ? ' active' : ''}`} onClick={() => setView(v.key)}>
              <i class={`fas ${v.icon}`} /> {v.label}
            </button>
          ))}
        </div>
        <input class="ui-input" style={{ flex: 1, minWidth: 160 }} placeholder="Search task, employee, case…" value={query} onInput={e => setQuery((e.target as HTMLInputElement).value)} />
        <select class="ui-select" value={status} onChange={e => setStatus((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {TASK_STATUSES.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select class="ui-select" value={ownerRole} onChange={e => setOwnerRole((e.target as HTMLSelectElement).value)}>
          <option value="">All owner roles</option>
          {ownerRoles.map(r => <option key={r} value={r}>{humanize(r)}</option>)}
        </select>
        <select class="ui-select" value={pkgKey} onChange={e => setPkgKey((e.target as HTMLSelectElement).value)}>
          <option value="">All packages</option>
          {(pkgsQ.data ?? []).map(p => <option key={p.key} value={p.key}>{p.label}</option>)}
        </select>
        <select class="ui-select" value={dueState} onChange={e => setDueState((e.target as HTMLSelectElement).value as DueState)}>
          {DUE_OPTS.map(o => <option key={o.v} value={o.v}>{o.label}</option>)}
        </select>
        <label class="obx-checkline" style={{ marginTop: 0, whiteSpace: 'nowrap' }}>
          <input type="checkbox" checked={blockingOnly} onChange={e => setBlockingOnly((e.target as HTMLInputElement).checked)} /> Blocking only
        </label>
      </div>

      {view === 'table' && tableView()}
      {view === 'board' && boardView()}
      {view === 'owner' && ownerView()}
      {view === 'due' && dueView()}

      <TaskDrawer
        taskId={drawerTaskId}
        onClose={() => setDrawerTaskId(null)}
        onOpenCase={onOpenCase}
        onToast={onToast}
        employees={employees}
        onComplete={handleComplete} onBlock={handleBlock} onUnblock={handleUnblock} onReassign={handleReassign}
      />

      <Modal
        open={addOpen} title="Add Task" icon="fa-list-check" onClose={() => setAddOpen(false)}
        onSubmit={() => void submitAdd()} submitLabel="Add Task" submitDisabled={addTaskMut.isPending}
      >
        <FormGrid>
          <Field label="Case" wide>
            <select class="ui-select" value={addForm.caseNo} onChange={e => setAddForm(f => ({ ...f, caseNo: (e.target as HTMLSelectElement).value }))}>
              <option value="">Select a case…</option>
              {caseOptions.map(c => <option key={c.id} value={c.id}>{c.label}</option>)}
            </select>
          </Field>
          <Field label="Task title" wide><TextInput value={addForm.taskTitle} onInput={v => setAddForm(f => ({ ...f, taskTitle: v }))} placeholder="e.g. Collect signed contract" /></Field>
          <Field label="Assignee">
            <select class="ui-select" value={addForm.assignedTo} onChange={e => setAddForm(f => ({ ...f, assignedTo: (e.target as HTMLSelectElement).value }))}>
              <option value="">Unassigned</option>
              {employees.map(e2 => <option key={e2.id} value={e2.id}>{e2.full_name ?? e2.email ?? e2.id}</option>)}
            </select>
          </Field>
          <Field label="Due date"><TextInput type="date" value={addForm.dueAt} onInput={v => setAddForm(f => ({ ...f, dueAt: v }))} /></Field>
          <Field label="Priority"><SelectInput value={addForm.priority} onInput={v => setAddForm(f => ({ ...f, priority: v }))} options={['low', 'normal', 'high', 'critical']} /></Field>
        </FormGrid>
        <label class="obx-checkline"><input type="checkbox" checked={addForm.isBlocking} onChange={e => setAddForm(f => ({ ...f, isBlocking: (e.target as HTMLInputElement).checked }))} /> Blocks activation until complete</label>
      </Modal>
    </div>
  );
}

// ── task drawer — detail + notes + evidence + actions ─────────────────────────────
function TaskDrawer({
  taskId, onClose, onOpenCase, onToast, employees, onComplete, onBlock, onUnblock, onReassign,
}: {
  taskId: string | null;
  onClose: () => void;
  onOpenCase: (caseId: string) => void;
  onToast: (m: string) => void;
  employees: { id: string; full_name: string | null; email: string | null }[];
  onComplete: (t: OnboardingTaskRow) => Promise<void>;
  onBlock: (t: OnboardingTaskRow) => Promise<void>;
  onUnblock: (t: OnboardingTaskRow) => Promise<void>;
  onReassign: (t: OnboardingTaskRow, assignedTo: string) => Promise<void>;
}): VNode | null {
  const detailQ = useOnboardingTaskDetail(taskId);
  const noteMut = useOnboardingAddTaskNote();
  const evidenceMut = useOnboardingAttachTaskEvidence();
  const [noteText, setNoteText] = useState('');
  const t = detailQ.data;

  async function submitNote(): Promise<void> {
    const note = noteText.trim();
    if (!note || !taskId) return;
    try { await noteMut.mutateAsync({ taskId, note }); setNoteText(''); onToast('Note added'); }
    catch (e) { onToast(e instanceof Error ? e.message : 'Failed to add note'); }
  }
  async function onEvidenceFile(e: Event): Promise<void> {
    const input = e.target as HTMLInputElement;
    const file = (input.files ?? [])[0];
    input.value = '';
    if (!file || !taskId) return;
    try { await evidenceMut.mutateAsync({ taskId, file }); onToast('Evidence attached'); }
    catch (err) { onToast(err instanceof Error ? err.message : 'Evidence upload failed'); }
  }

  if (!taskId) return null;
  return (
    <Drawer
      open title={t?.taskTitle ?? 'Task'} sub={t ? `${t.caseNo}${t.employeeName ? ` · ${t.employeeName}` : ''}` : undefined}
      onClose={onClose}
      foot={
        <div class="obx-rowbtns" style={{ justifyContent: 'flex-end', width: '100%' }}>
          {t && <button class="obx-btn" onClick={() => { onOpenCase(t.caseId); onClose(); }}>Open Case</button>}
          {t && OPEN_STATUSES.has(t.status) && <button class="obx-btn primary" onClick={() => void onComplete(t)}>Complete</button>}
          {t && (t.status === 'blocked'
            ? <button class="obx-btn amber" onClick={() => void onUnblock(t)}>Unblock</button>
            : OPEN_STATUSES.has(t.status) && <button class="obx-btn amber" onClick={() => void onBlock(t)}>Block</button>)}
        </div>
      }
    >
      {!t ? <div class="obx-empty">Loading…</div> : (
        <div style={{ display: 'grid', gap: 14 }}>
          <div class="obx-section">
            <div class="obx-section-head"><h2><i class="fas fa-circle-info" />Details</h2></div>
            <div class="obx-section-body" style={{ padding: '10px 16px' }}>
              <table class="obx-table"><tbody>
                <tr><td class="obx-meta">Status</td><td><span class={`obx-pill ${pillClass(taskStatusPill(t.status))}`}>{taskStatusPill(t.status).label}</span></td></tr>
                <tr><td class="obx-meta">Package</td><td>{humanize(t.packageKey)}</td></tr>
                <tr><td class="obx-meta">Owner role</td><td>{humanize(t.ownerRole ?? '—')}</td></tr>
                <tr><td class="obx-meta">Assignee</td><td>
                  <select class="obx-mini-select" value={t.assignedTo ?? ''} onChange={e => void onReassign(t, (e.target as HTMLSelectElement).value)}>
                    <option value="">Unassigned</option>
                    {employees.map(e2 => <option key={e2.id} value={e2.id}>{e2.full_name ?? e2.email ?? e2.id}</option>)}
                  </select>
                </td></tr>
                <tr><td class="obx-meta">Module</td><td>{t.moduleKey ? humanize(t.moduleKey) : '—'}</td></tr>
                <tr><td class="obx-meta">Due</td><td>{fmtDate(t.dueAt)}</td></tr>
                <tr><td class="obx-meta">Priority</td><td>{humanize(t.priority ?? 'normal')}</td></tr>
                <tr><td class="obx-meta">Blocking</td><td>{t.isBlocking ? <span class="obx-pill red">Yes</span> : 'No'}</td></tr>
                <tr><td class="obx-meta">Evidence required</td><td>{t.requiresEvidence ? 'Yes' : 'No'}</td></tr>
                {t.blockedReason && <tr><td class="obx-meta">Blocked reason</td><td>{t.blockedReason}</td></tr>}
                {t.dependencyKeys.length > 0 && <tr><td class="obx-meta">Depends on</td><td class="obx-meta">{t.dependencyKeys.map(humanize).join(', ')}</td></tr>}
                {t.completedAt && <tr><td class="obx-meta">Completed</td><td class="obx-meta">{fmtDateTime(t.completedAt)}{t.completedByName ? ` · ${t.completedByName}` : ''}</td></tr>}
              </tbody></table>
            </div>
          </div>

          <div class="obx-section">
            <div class="obx-section-head">
              <h2><i class="fas fa-paperclip" />Evidence ({t.evidence.length})</h2>
              {OPEN_STATUSES.has(t.status) && (
                <label class="obx-btn obx-btn-sm" style={{ cursor: 'pointer', display: 'inline-flex', alignItems: 'center' }}>
                  {evidenceMut.isPending ? 'Uploading…' : '+ Attach'}
                  <input type="file" style={{ display: 'none' }} disabled={evidenceMut.isPending} onChange={e => void onEvidenceFile(e)} />
                </label>
              )}
            </div>
            <div class="obx-section-body">
              {!t.evidence.length ? <div class="obx-empty">No evidence attached.</div> : (
                <table class="obx-table"><tbody>
                  {t.evidence.map(ev => (
                    <tr key={ev.id}>
                      <td><b>{ev.fileName}</b></td>
                      <td class="obx-meta">{ev.byName ?? '—'}</td>
                      <td class="obx-meta">{fmtDateTime(ev.at)}</td>
                    </tr>
                  ))}
                </tbody></table>
              )}
            </div>
          </div>

          <div class="obx-section">
            <div class="obx-section-head"><h2><i class="fas fa-note-sticky" />Notes ({t.notes.length})</h2></div>
            <div class="obx-section-body" style={{ padding: '10px 16px', display: 'grid', gap: 10 }}>
              {t.notes.map(n => (
                <div key={n.id} style={{ borderBottom: '1px solid #f1f5f9', paddingBottom: 8 }}>
                  <div style={{ fontSize: 13, color: '#334155' }}>{n.note}</div>
                  <div class="obx-meta" style={{ fontSize: 11, marginTop: 3 }}>{n.byName ?? '—'} · {fmtDateTime(n.at)}</div>
                </div>
              ))}
              <div style={{ display: 'flex', gap: 8 }}>
                <input class="ui-input" style={{ flex: 1 }} placeholder="Add a note…" value={noteText}
                  onInput={e => setNoteText((e.target as HTMLInputElement).value)}
                  onKeyDown={e => { if (e.key === 'Enter') void submitNote(); }} />
                <button class="obx-btn primary obx-btn-sm" style={{ height: 36 }} disabled={noteMut.isPending || !noteText.trim()} onClick={() => void submitNote()}>Add</button>
              </div>
            </div>
          </div>
        </div>
      )}
    </Drawer>
  );
}
