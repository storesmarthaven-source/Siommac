/**
 * src/components/sections/HR/OnboardingCaseDetail.tsx
 *
 * HR ▸ Onboarding ▸ Case detail — STANDARD page shape: PageHeader (title + ProfilePill +
 * lifecycle actions) → Customize widget grid (same board as Employee Master).
 * The grid holds the FUNCTIONAL tables as page-local widgets (the KPI / timeline / provisioning /
 * communications tiles were removed when the widget catalogue was cleared for the v2 rebuild and
 * will be re-authored on the new contract):
 *   • Active Tasks  — Complete · Block · Unblock · Add
 *   • Blockers      — Resolve · Escalate · Waive
 *   • Handoffs      — read-only
 *   • Custom Actions — Complete · Cancel · Add
 * Lifecycle (Pause/Resume/Mark Ready/Complete/Cancel/Provision/Reassign Owner) lives in the header.
 * All data + mutations hit the real onboarding API; mutations invalidate ['hr','onboarding'].
 */
import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { PageHeader, Modal, Field, FormGrid, TextInput, SelectInput } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import {
  useOnboardingTasksList, useOnboardingHandoffsList, useOnboardingBlockersList, useOnboardingCaseActions,
  useOnboardingCompleteTask, useOnboardingReassignTask, useOnboardingBlockTask, useOnboardingUnblockTask,
  useOnboardingResolveBlocker, useOnboardingEscalateBlocker, useOnboardingWaiveBlocker,
  useOnboardingPauseCase, useOnboardingResumeCase, useOnboardingMarkReady, useOnboardingCompleteCase,
  useOnboardingCancelCase, useOnboardingReassignOwner, useOnboardingProvisionAccount,
  useOnboardingAddCaseAction, useOnboardingUpdateCaseAction, useOnboardingCompleteCaseAction, useOnboardingCancelCaseAction,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import type {
  OnboardingCaseRow, OnboardingTaskRow, OnboardingBlockerRow, OnboardingCaseAction,
  OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority, OnboardingCaseActionStatus,
} from '../../../../types/hrOnboarding';
import { useOnboardingCaseStore } from '@store/onboardingCase';
import { humanize, fmtDate, fmtDateTime } from './onboardingStatus';
import { isOpen } from './onboardingCase.helpers';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import './onboardingCase.css';

// ── helpers ──────────────────────────────────────────────────────────────────────
const _initials = (n: string | null | undefined): string =>
  (n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => (s[0] ?? '').toUpperCase()).join('') || '?';

function tone(s: string): string {
  if (['completed', 'delivered', 'accepted', 'resolved', 'received', 'waived', 'ready_for_activation'].includes(s)) return 'green';
  if (['blocked', 'failed', 'escalated', 'active'].includes(s)) return 'red';
  if (['in_progress', 'sent', 'acknowledged', 'waiting_on_owner', 'paused'].includes(s)) return 'amber';
  if (['cancelled', 'skipped', 'draft'].includes(s)) return 'gray';
  return 'blue';
}
const Pill = ({ s }: { s: string }): VNode => <span class={`obx-pill ${tone(s)}`}>{humanize(s)}</span>;

const CASE_PAGE_KEY = 'hr.onboarding.case';
const CASE_ZONE = 'main';
function defInst(widgetId: string, x: number, y: number, w: number, h: number, sizeKey: WidgetSizeKey): WidgetInstance {
  return { instanceId: `${widgetId}#def`, widgetId, pageKey: CASE_PAGE_KEY, zoneId: CASE_ZONE, x, y, w, h, sizeKey, config: {} };
}
function defaultCaseLayout(): BoardLayout {
  return {
    pageKey: CASE_PAGE_KEY,
    zones: {
      // Functional page-local table widgets (the KPI / timeline / provisioning / communications
      // widgets were removed when the widget catalogue was cleared for the v2 rebuild; they'll be
      // re-authored on the new contract and added back via the Widget Library).
      main: [
        defInst('hr.onboarding.case.activeTasks',   0, 0, 8, 5, 'wide'),
        defInst('hr.onboarding.case.blockersTable', 8, 0, 4, 5, 'tall'),
        defInst('hr.onboarding.case.customActions', 0, 5, 6, 4, 'wide'),
        defInst('hr.onboarding.case.handoffsTable', 6, 5, 6, 4, 'wide'),
      ],
    },
  };
}

// ── main component ─────────────────────────────────────────────────────────────
export function OnboardingCaseDetail({
  caseRow, onBack, onToast,
}: { caseRow: OnboardingCaseRow; onBack: () => void; onToast: (m: string) => void }): VNode {
  const caseId = caseRow.caseId;

  // board state (standard customize grid)
  const [editing, setEditing] = useState(false);
  const [libOpen, setLibOpen] = useState(false);
  const [demo, setDemo] = useState(false);
  const [preview, setPreview] = useState<PreviewWidgetInstance | null>(null);
  // Add Task modal is the shared OnboardingAddTaskModal (also used by the Command Center).
  // Add Custom Action modal (replaces a single-field prompt so the full set of fields the
  // backend already accepts is actually reachable from the UI).
  const [taskModalOpen, setTaskModalOpen] = useState(false);
  const [actionModalOpen, setActionModalOpen] = useState(false);
  const [actionForm, setActionForm] = useState({
    actionName: '', actionType: 'custom_task' as OnboardingActionType, ownerType: 'role' as OnboardingOwnerType,
    ownerRole: '', ownerEmployeeId: '', dueDate: '', priority: 'normal' as OnboardingActionPriority,
    blocksOnboarding: false, requiresEvidence: false,
  });
  const canEdit = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);
  const setCaseInStore = useOnboardingCaseStore(s => s.setCase);
  const clearCaseInStore = useOnboardingCaseStore(s => s.clear);
  const { layout, addWidget, setAsDefault, resetLayout } = useBoardLayout(CASE_PAGE_KEY, defaultCaseLayout());
  const boardItems = layout.zones[CASE_ZONE] ?? [];
  const placedWidgetIds = boardItems.map(w => w.widgetId);
  const placeBottom = <T extends { x: number; y: number }>(w: T): T => ({ ...w, x: 0, y: Math.max(0, ...boardItems.map(i => i.y + i.h)) });
  const userPermissions = useMemo(() => Array.from(new Set(WIDGET_REGISTRY.flatMap(w => w.dataSource.permissions))).filter(can), []);

  // publish the active case so detached-root tiles read it (@store/onboardingCase)
  useEffect(() => { setCaseInStore(caseRow); }, [caseRow, setCaseInStore]);
  useEffect(() => () => clearCaseInStore(), [clearCaseInStore]);

  function commitPreview(p: PreviewWidgetInstance): void { void addWidget(p.zoneId, commitPreviewWidget(p)); setPreview(null); }
  function discardPreview(): void { setPreview(null); setLibOpen(true); }

  // ── data (drives the local table widgets) ───────────────────────────────────────
  const tasksQ    = useOnboardingTasksList({ caseId });
  const handoffsQ = useOnboardingHandoffsList({ caseId });
  const blockersQ = useOnboardingBlockersList({ caseId });
  const actionsQ  = useOnboardingCaseActions(caseId);
  const empsQ     = useHrEmployees({ limit: 500 });
  const tasks = tasksQ.data ?? [];
  const handoffs = handoffsQ.data ?? [];
  const blockers = blockersQ.data ?? [];
  const actions = actionsQ.data ?? [];
  const employees = empsQ.data ?? [];

  // ── mutations ───────────────────────────────────────────────────────────────────
  const pauseMut = useOnboardingPauseCase(), resumeMut = useOnboardingResumeCase(), markReadyMut = useOnboardingMarkReady();
  const completeCaseMut = useOnboardingCompleteCase(), cancelMut = useOnboardingCancelCase(), reassignMut = useOnboardingReassignOwner();
  const provisionMut = useOnboardingProvisionAccount();
  const completeTaskMut = useOnboardingCompleteTask(), reassignTaskMut = useOnboardingReassignTask(), blockTaskMut = useOnboardingBlockTask(), unblockTaskMut = useOnboardingUnblockTask();
  const resolveMut = useOnboardingResolveBlocker(), escalateMut = useOnboardingEscalateBlocker(), waiveMut = useOnboardingWaiveBlocker();
  const addActionMut = useOnboardingAddCaseAction(), updateActionMut = useOnboardingUpdateCaseAction(), completeActionMut = useOnboardingCompleteCaseAction(), cancelActionMut = useOnboardingCancelCaseAction();

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }

  // ── lifecycle handlers (ActionModal: record + status transition + consequence) ────
  const caseRecord = () => toActionRecord({
    title: `${caseRow.caseNo} · ${caseRow.employeeName ?? '—'}`, subtitle: caseRow.packageLabel ?? undefined, icon: 'fa-rocket',
    badges: [statusBadge(caseRow.status)],
    fields: [{ label: 'Progress', value: `${caseRow.progressPercent}%` }, caseRow.dueAt ? { label: 'Due', value: caseRow.dueAt } : null],
  });
  async function handlePause(): Promise<void> {
    const res = await openActionModal({ title: 'Pause case', icon: 'fa-circle-pause', tone: 'warning', record: caseRecord(), reason: { required: false, label: 'Reason for pausing', type: 'text', placeholder: 'Optional' }, whatNext: ['The case is paused; it leaves the active queue until resumed.'], confirmLabel: 'Pause' });
    if (res.confirmed) await run(() => pauseMut.mutateAsync({ caseId, reason: res.reason ?? null }), 'Case paused');
  }
  async function handleResume(): Promise<void> {
    const res = await openActionModal({ title: 'Resume case', icon: 'fa-circle-play', tone: 'info', record: caseRecord(), whatNext: ['The case resumes and re-enters the active queue.'], confirmLabel: 'Resume' });
    if (res.confirmed) await run(() => resumeMut.mutateAsync({ caseId }), 'Case resumed');
  }
  async function handleMarkReady(): Promise<void> {
    const res = await openActionModal({ title: 'Mark ready for activation', icon: 'fa-flag-checkered', tone: 'info', record: caseRecord(), warning: 'Confirm all onboarding tasks are complete.', whatNext: ['Status → ready_for_activation.'], confirmLabel: 'Mark ready' });
    if (res.confirmed) await run(() => markReadyMut.mutateAsync({ caseId }), 'Marked ready');
  }
  async function handleComplete(): Promise<void> {
    const res = await openActionModal({ title: 'Complete case', icon: 'fa-circle-check', tone: 'warning', record: caseRecord(), warning: 'Completing closes the onboarding case.', whatNext: ['Status → completed; no further changes.'], confirmLabel: 'Complete' });
    if (res.confirmed) await run(() => completeCaseMut.mutateAsync({ caseId }), 'Case completed');
  }
  async function handleCancel(): Promise<void> {
    const res = await openActionModal({ title: 'Cancel case', icon: 'fa-xmark', tone: 'danger', record: caseRecord(), warning: 'Cancelling this onboarding case cannot be undone.', reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this being cancelled?' }, whatNext: ['Open tasks and handoffs are voided.', 'Status → cancelled.'], confirmLabel: 'Cancel case' });
    if (res.confirmed) await run(() => cancelMut.mutateAsync({ caseId, reason: res.reason ?? undefined }), 'Case cancelled');
  }
  async function handleReassignOwner(ownerId: string): Promise<void> { await run(() => reassignMut.mutateAsync({ caseId, ownerId: ownerId || null }), 'Owner reassigned'); }
  async function handleProvision(): Promise<void> {
    if (!caseRow.employeeId) { onToast('No employee linked'); return; }
    const res = await openActionModal({ title: 'Provision account', icon: 'fa-user-gear', tone: 'info', record: caseRecord(), whatNext: ['Creates a work email + login for the employee.', 'An account-activation invite is sent.'], confirmLabel: 'Provision' });
    if (res.confirmed) await run(() => provisionMut.mutateAsync({ employeeId: caseRow.employeeId!, sendInvite: true }), 'Account provisioning started');
  }

  // ── task handlers ────────────────────────────────────────────────────────────────
  function openAddTask(): void { setTaskModalOpen(true); }
  async function handleCompleteTask(t: OnboardingTaskRow): Promise<void> { await run(() => completeTaskMut.mutateAsync({ taskId: t.taskId }), 'Task completed'); }
  async function handleBlockTask(t: OnboardingTaskRow): Promise<void> {
    const res = await openActionModal({ title: 'Block task', icon: 'fa-ban', tone: 'warning', record: toActionRecord({ title: t.taskTitle, icon: 'fa-list-check' }), reason: { required: true, label: 'Why is it blocked?', type: 'textarea', placeholder: 'Blocking reason' }, whatNext: ['The task is marked blocked; it may block case activation.'], confirmLabel: 'Block' });
    if (!res.confirmed) return;
    await run(() => blockTaskMut.mutateAsync({ taskId: t.taskId, reason: res.reason ?? null }), 'Task blocked');
  }
  async function handleUnblockTask(t: OnboardingTaskRow): Promise<void> { await run(() => unblockTaskMut.mutateAsync({ taskId: t.taskId }), 'Task unblocked'); }
  async function handleReassignTask(t: OnboardingTaskRow, assignedTo: string): Promise<void> { await run(() => reassignTaskMut.mutateAsync({ taskId: t.taskId, assignedTo: assignedTo || null }), 'Task reassigned'); }

  // ── blocker handlers ──────────────────────────────────────────────────────────────
  async function handleResolve(b: OnboardingBlockerRow): Promise<void> {
    const res = await openActionModal({ title: 'Resolve blocker', icon: 'fa-circle-check', tone: 'success', record: toActionRecord({ title: b.blockerTitle, icon: 'fa-ban' }), reason: { required: true, label: 'Resolution note', type: 'textarea', placeholder: 'How was it resolved?' }, whatNext: ['The blocker is marked resolved.'], confirmLabel: 'Resolve' });
    if (!res.confirmed) return;
    await run(() => resolveMut.mutateAsync({ blockerId: b.blockerId, note: res.reason ?? null }), 'Blocker resolved');
  }
  async function handleEscalate(b: OnboardingBlockerRow): Promise<void> {
    const res = await openActionModal({ title: 'Escalate blocker', icon: 'fa-arrow-up-right-dots', tone: 'warning', record: toActionRecord({ title: b.blockerTitle, icon: 'fa-ban' }), reason: { required: true, label: 'Escalation reason', type: 'textarea', placeholder: 'Why escalate?' }, whatNext: ['The blocker is escalated and its owner notified.'], confirmLabel: 'Escalate' });
    if (!res.confirmed) return;
    await run(() => escalateMut.mutateAsync({ blockerId: b.blockerId, note: res.reason ?? null }), 'Blocker escalated');
  }
  async function handleWaive(b: OnboardingBlockerRow): Promise<void> {
    const res = await openActionModal({ title: 'Waive blocker', icon: 'fa-circle-minus', tone: 'danger', record: toActionRecord({ title: b.blockerTitle, icon: 'fa-ban' }), warning: 'Waiving accepts the blocker without resolving it.', reason: { required: true, label: 'Waiver reason', type: 'textarea', placeholder: 'Why is this acceptable?' }, whatNext: ['The blocker is waived; the case can proceed.'], confirmLabel: 'Waive' });
    if (!res.confirmed) return;
    await run(() => waiveMut.mutateAsync({ blockerId: b.blockerId, reason: res.reason ?? '' }), 'Blocker waived');
  }

  // ── custom action handlers ──────────────────────────────────────────────────────
  function openAddAction(): void {
    setActionForm({ actionName: '', actionType: 'custom_task', ownerType: 'role', ownerRole: '', ownerEmployeeId: '', dueDate: '', priority: 'normal', blocksOnboarding: false, requiresEvidence: false });
    setActionModalOpen(true);
  }
  async function submitAddAction(): Promise<void> {
    if (!actionForm.actionName.trim()) { onToast('Action name is required'); return; }
    await run(() => addActionMut.mutateAsync({
      caseId, actionName: actionForm.actionName.trim(), actionType: actionForm.actionType,
      ownerType: actionForm.ownerType, ownerRole: actionForm.ownerRole || null, ownerEmployeeId: actionForm.ownerEmployeeId || null,
      dueDate: actionForm.dueDate || null, priority: actionForm.priority,
      blocksOnboarding: actionForm.blocksOnboarding, requiresEvidence: actionForm.requiresEvidence,
    }), 'Custom action added');
    setActionModalOpen(false);
  }
  async function handleCompleteAction(a: OnboardingCaseAction): Promise<void> { await run(() => completeActionMut.mutateAsync({ id: a.id }), 'Action completed'); }
  async function handleCancelAction(a: OnboardingCaseAction): Promise<void> {
    const res = await openActionModal({ title: 'Cancel action', icon: 'fa-xmark', tone: 'danger', record: toActionRecord({ title: a.actionName, icon: 'fa-bolt' }), reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why cancel?' }, whatNext: ['The custom action is cancelled.'], confirmLabel: 'Cancel action' });
    if (!res.confirmed) return;
    await run(() => cancelActionMut.mutateAsync({ id: a.id, reason: res.reason ?? null }), 'Action cancelled');
  }
  async function handleUpdateActionStatus(a: OnboardingCaseAction, status: OnboardingCaseActionStatus): Promise<void> { await run(() => updateActionMut.mutateAsync({ id: a.id, status }), 'Action updated'); }

  const blockerOpen = (s: string): boolean => ['active', 'acknowledged', 'waiting_on_owner', 'escalated'].includes(s);

  // ── page-local TABLE widgets (functional, drag/resize like Employee Master's register) ──
  const wcard = (title: string, icon: string, body: VNode, action?: VNode): VNode => (
    <div class="obx-section obx-wcard">
      <div class="obx-section-head"><h2><i class={`fas ${icon}`} />{title}</h2>{action}</div>
      <div class="obx-section-body">{body}</div>
    </div>
  );
  const empty = (m: string): VNode => <div class="obx-empty">{m}</div>;

  const tasksBody = (): VNode => tasksQ.isLoading && !tasksQ.data ? empty('Loading…') : !tasks.length ? empty('No tasks for this case.') : (
    <table class="obx-table">
      <thead><tr><th>Task</th><th>Assignee</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{tasks.map(t => (
        <tr key={t.taskId}>
          <td><b>{t.taskTitle}</b>{t.isBlocking && <span class="obx-pill red" style={{ marginLeft: 8 }}>blocking</span>}</td>
          <td>
            <select class="obx-mini-select" value={t.assignedTo ?? ''} onChange={e => void handleReassignTask(t, (e.target as HTMLSelectElement).value)} title="Reassign">
              <option value="">{humanize(t.ownerRole ?? 'Unassigned')}</option>
              {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
            </select>
          </td>
          <td>{fmtDate(t.dueAt)}</td>
          <td><Pill s={t.status} /></td>
          <td><div class="obx-rowbtns">
            {isOpen(t.status) && <button class="obx-mini" onClick={() => void handleCompleteTask(t)}>Complete</button>}
            {t.status === 'blocked' ? <button class="obx-mini" onClick={() => void handleUnblockTask(t)}>Unblock</button> : isOpen(t.status) && <button class="obx-mini" onClick={() => void handleBlockTask(t)}>Block</button>}
          </div></td>
        </tr>
      ))}</tbody>
    </table>
  );

  const blockersBody = (): VNode => blockersQ.isLoading && !blockersQ.data ? empty('Loading…') : !blockers.length ? empty('No blockers.') : (
    <table class="obx-table">
      <thead><tr><th>Blocker</th><th>Module</th><th>Severity</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{blockers.map(b => (
        <tr key={b.blockerId}>
          <td><b>{b.blockerTitle}</b></td>
          <td>{humanize(b.blockingModule)}</td>
          <td><Pill s={b.severity} /></td>
          <td><Pill s={b.status} /></td>
          <td>{blockerOpen(b.status) ? <div class="obx-rowbtns">
            <button class="obx-mini" onClick={() => void handleResolve(b)}>Resolve</button>
            <button class="obx-mini" onClick={() => void handleEscalate(b)}>Escalate</button>
            <button class="obx-mini" onClick={() => void handleWaive(b)}>Waive</button>
          </div> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const handoffsBody = (): VNode => handoffsQ.isLoading && !handoffsQ.data ? empty('Loading…') : !handoffs.length ? empty('No handoffs.') : (
    <table class="obx-table">
      <thead><tr><th>Module</th><th>Type</th><th>Owner</th><th>Status</th><th>Last event</th></tr></thead>
      <tbody>{handoffs.map(h => (
        <tr key={h.handoffId}>
          <td><b>{humanize(h.targetModule)}</b></td>
          <td>{humanize(h.handoffType ?? '—')}</td>
          <td>{h.ownerName ?? 'Unassigned'}</td>
          <td><Pill s={h.status} /></td>
          <td>{fmtDateTime(h.lastEventAt ?? h.createdAt)}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const ACTION_STATUS_OPTIONS: OnboardingCaseActionStatus[] = ['open', 'in_progress', 'blocked', 'completed', 'cancelled'];
  const actionsBody = (): VNode => actionsQ.isLoading && !actionsQ.data ? empty('Loading…') : !actions.length ? empty('No custom actions.') : (
    <table class="obx-table">
      <thead><tr><th>Action</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{actions.map(a => (
        <tr key={a.id}>
          <td><b>{a.actionName}</b></td>
          <td>{humanize(a.actionType)}</td>
          <td>
            <select class="obx-mini-select" value={a.status} onChange={e => void handleUpdateActionStatus(a, (e.target as HTMLSelectElement).value as OnboardingCaseActionStatus)}>
              {ACTION_STATUS_OPTIONS.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
            </select>
          </td>
          <td>{isOpen(a.status) ? <div class="obx-rowbtns">
            <button class="obx-mini" onClick={() => void handleCompleteAction(a)}>Complete</button>
            <button class="obx-mini" onClick={() => void handleCancelAction(a)}>Cancel</button>
          </div> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const localWidgets: LocalWidgetMap = {
    'hr.onboarding.case.activeTasks':   { chrome: 'none', title: 'Active Tasks', render: () => wcard('Active Tasks', 'fa-list-check', tasksBody(), <button class="obx-btn primary obx-btn-sm" onClick={openAddTask}>+ Add</button>) },
    'hr.onboarding.case.blockersTable': { chrome: 'none', title: 'Blockers', render: () => wcard('Blockers', 'fa-triangle-exclamation', blockersBody()) },
    'hr.onboarding.case.handoffsTable': { chrome: 'none', title: 'Handoffs', render: () => wcard('Handoffs', 'fa-arrow-right-arrow-left', handoffsBody()) },
    'hr.onboarding.case.customActions': { chrome: 'none', title: 'Custom Actions', render: () => wcard('Custom Actions', 'fa-bolt', actionsBody(), <button class="obx-btn primary obx-btn-sm" onClick={openAddAction}>+ Add</button>) },
  };

  // ── lifecycle action buttons (PageHeader actions slot) ──────────────────────────
  const headerActions = (
    <div class="obx-actions">
      {caseRow.status === 'in_progress' && <button class="obx-btn amber" onClick={() => void handlePause()}>Pause</button>}
      {caseRow.status === 'paused' && <button class="obx-btn" onClick={() => void handleResume()}>Resume</button>}
      {(caseRow.status === 'in_progress' || caseRow.status === 'paused') && <button class="obx-btn primary" onClick={() => void handleMarkReady()}>Mark Ready</button>}
      {caseRow.status === 'ready_for_activation' && <button class="obx-btn primary" onClick={() => void handleComplete()}>Complete</button>}
      {caseRow.employeeId && <button class="obx-btn" onClick={() => void handleProvision()}>Provision</button>}
      {!['completed', 'cancelled'].includes(caseRow.status) && <button class="obx-btn danger" onClick={() => void handleCancel()}>Cancel</button>}
      <label class="obx-owner">Owner
        <select value={caseRow.ownerId ?? ''} onChange={e => void handleReassignOwner((e.target as HTMLSelectElement).value)}>
          <option value="">Unassigned</option>
          {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
        </select>
      </label>
    </div>
  );

  // ── render — standard PageHeader + Customize grid ───────────────────────────────
  return (
    <div class="hr-onboarding-case">
      <button class="obx-back" onClick={onBack}>← Onboarding Cases</button>

      <PageHeader
        icon="fa-user-check"
        module="HR · Onboarding"
        title={caseRow.employeeName ?? caseRow.caseNo}
        sub={`${caseRow.caseNo} · ${caseRow.packageLabel}`}
        actions={headerActions}
      />

      {canEdit && (
        <WidgetBoardToolbar
          editing={editing} canSetDefault={isAdmin} layoutItems={boardItems}
          onToggleEdit={() => setEditing(e => !e)}
          onOpenLibrary={() => setLibOpen(true)}
          onReset={() => void resetLayout()}
          onSetDefault={() => void setAsDefault()}
        />
      )}

      {preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it on the grid, then add or discard.</span>
          <button class="obx-btn" onClick={discardPreview}>Discard preview</button>
        </div>
      )}

      <WidgetBoard
        pageKey={CASE_PAGE_KEY} zones={[CASE_ZONE]} editing={editing && canEdit}
        localWidgets={localWidgets} defaultLayout={defaultCaseLayout()} demo={demo}
        preview={preview} onPreviewChange={setPreview}
        onCommitPreview={commitPreview} onDiscardPreview={discardPreview}
      />

      <WidgetLibraryModal
        open={libOpen} pageKey={CASE_PAGE_KEY} zoneId={CASE_ZONE}
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget(CASE_ZONE, placeBottom(inst))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))}
      />

      <OnboardingAddTaskModal open={taskModalOpen} caseId={caseId} onClose={() => setTaskModalOpen(false)} onToast={onToast} />

      <Modal
        open={actionModalOpen} title="Add Custom Action" icon="fa-bolt" onClose={() => setActionModalOpen(false)}
        onSubmit={() => void submitAddAction()} submitLabel="Add Action" submitDisabled={addActionMut.isPending}
      >
        <FormGrid>
          <Field label="Action name" wide><TextInput value={actionForm.actionName} onInput={v => setActionForm(f => ({ ...f, actionName: v }))} placeholder="e.g. Return company laptop" /></Field>
          <Field label="Type">
            <select class="ui-select" value={actionForm.actionType} onChange={e => setActionForm(f => ({ ...f, actionType: (e.target as HTMLSelectElement).value as OnboardingActionType }))}>
              {(['custom_task', 'custom_checklist_item', 'custom_external_action', 'custom_handoff', 'custom_document_request', 'custom_training_request', 'custom_approval', 'custom_notification'] as OnboardingActionType[])
                .map(t => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </Field>
          <Field label="Priority">
            <SelectInput value={actionForm.priority} onInput={v => setActionForm(f => ({ ...f, priority: v as OnboardingActionPriority }))} options={['low', 'normal', 'high', 'critical']} />
          </Field>
          <Field label="Owner type">
            <select class="ui-select" value={actionForm.ownerType} onChange={e => setActionForm(f => ({ ...f, ownerType: (e.target as HTMLSelectElement).value as OnboardingOwnerType }))}>
              {(['role', 'employee', 'department', 'system', 'external'] as OnboardingOwnerType[]).map(t => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </Field>
          {actionForm.ownerType === 'employee'
            ? <Field label="Owner (employee)">
                <select class="ui-select" value={actionForm.ownerEmployeeId} onChange={e => setActionForm(f => ({ ...f, ownerEmployeeId: (e.target as HTMLSelectElement).value }))}>
                  <option value="">Select…</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
                </select>
              </Field>
            : actionForm.ownerType === 'role'
              ? <Field label="Owner role"><TextInput value={actionForm.ownerRole} onInput={v => setActionForm(f => ({ ...f, ownerRole: v }))} placeholder="e.g. hr, it, supervisor" /></Field>
              : null}
          <Field label="Due date"><TextInput type="date" value={actionForm.dueDate} onInput={v => setActionForm(f => ({ ...f, dueDate: v }))} /></Field>
        </FormGrid>
        <label class="obx-checkline"><input type="checkbox" checked={actionForm.blocksOnboarding} onChange={e => setActionForm(f => ({ ...f, blocksOnboarding: (e.target as HTMLInputElement).checked }))} /> Blocks activation until complete</label>
        <label class="obx-checkline"><input type="checkbox" checked={actionForm.requiresEvidence} onChange={e => setActionForm(f => ({ ...f, requiresEvidence: (e.target as HTMLInputElement).checked }))} /> Requires evidence to complete</label>
      </Modal>
    </div>
  );
}
