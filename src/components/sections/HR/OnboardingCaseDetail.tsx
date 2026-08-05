/**
 * src/components/sections/HR/OnboardingCaseDetail.tsx
 *
 * HR ▸ Onboarding ▸ Case Detail — a FIXED SEVEN-TAB operating page.
 *
 *   Overview · Tasks · Handoffs · Blockers · Communications · Timeline · Audit
 *
 * THE RULE (corrects an earlier stale note that called this page a widget board):
 *   Command Centre  = a WidgetBoard.
 *   Case Detail     = a seven-tab shell whose OVERVIEW tab holds a customizable board.
 *
 * The other six tabs are PERMANENT operational workspaces. They are not widgets, they are
 * not in the Widget Library, and they cannot be removed or reordered from the board.
 * Overview's default board is the four approved widgets: Priority Tasks, Activation
 * Readiness, Readiness by Domain, Key Blockers.
 *
 * Audit is permission-gated on `hr.onboarding.audit.view` and is absent — not merely
 * disabled — without it.
 *
 * Built to docs/mockups/onboarding-case-detail-implementation-ready.html and
 * docs/ONBOARDING_UI_PAGES_SPEC.md. Every tab reuses the existing onboarding API; no tab
 * introduces a second data system. All mutations invalidate ['hr','onboarding'].
 */import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { PageHeader, Modal, Field, FormGrid, TextInput, SelectInput, LucideIcon } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget, placeWidgetsAtBottom,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeDef, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import {
  useOnboardingTasksList, useOnboardingHandoffsList, useOnboardingBlockersList, useOnboardingCaseActions,
  useOnboardingCommunications, useOnboardingTimeline, useOnboardingAudit,
  useOnboardingCompleteTask, useOnboardingReassignTask, useOnboardingBlockTask, useOnboardingUnblockTask,
  useOnboardingRetryHandoff, useOnboardingAcceptHandoff, useOnboardingCompleteHandoff, useOnboardingCancelHandoff,
  useOnboardingResolveBlocker, useOnboardingEscalateBlocker, useOnboardingWaiveBlocker,
  useOnboardingPauseCase, useOnboardingResumeCase, useOnboardingMarkReady, useOnboardingCompleteCase,
  useOnboardingCancelCase, useOnboardingReassignOwner, useOnboardingProvisionAccount,
  useOnboardingAddCaseAction, useOnboardingUpdateCaseAction, useOnboardingCompleteCaseAction, useOnboardingCancelCaseAction,
  useOnboardingSendCommunication, useOnboardingResendCommunication,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import type {
  OnboardingCaseRow, OnboardingTaskRow, OnboardingBlockerRow, OnboardingCaseAction,
  OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority, OnboardingCaseActionStatus,
  OnboardingCommunicationType, OnboardingCommunicationChannel, OnboardingHandoffRow,
} from '../../../../types/hrOnboarding';
import { useOnboardingCaseStore } from '@store/onboardingCase';
import { humanize, fmtDate, fmtDateTime } from './onboardingStatus';
import { isOpen } from './onboardingCase.helpers';
import {
  CASE_TABS, DEFAULT_CASE_TAB, focusTab, focusRecordId, focusEvidenceId,
  type CaseTab, type CaseFocusRequest,
} from './onboardingCaseFocus';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import './onboardingCase.css';
import './OnboardingCaseDetail.mockup.css';
import './onboardingCaseDetail.page.css';

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

// .v2 retires layouts saved against the old coarse 88px grid — their row counts mean a ~5×
// smaller tile on the canonical grid. normalizePageKey ignores the version when matching
// governance/supportedPages, so the bump costs nothing but the stale geometry.
const CASE_PAGE_KEY = 'hr.onboarding.case.v2';
/**
 * Human labels for routing queues. An internal module/role key must never reach the UI:
 * "hse" is a key, "HSE Queue" is what a person routes work to.
 */
const QUEUE_LABEL: Record<string, string> = {
  hr: 'HR', it: 'IT', hse: 'HSE', training: 'Training', payroll: 'Payroll',
  security: 'Security', facilities: 'Facilities', finance: 'Finance', supervisor: 'Supervisor',
  general: 'General',
};
function queueLabel(key: string | null | undefined): string {
  if (!key) return 'Unrouted';
  return `${QUEUE_LABEL[key] ?? humanize(key)} Queue`;
}

const TAB_LABEL: Record<CaseTab, string> = {
  overview: 'Overview', tasks: 'Tasks', handoffs: 'Handoffs', blockers: 'Blockers',
  communications: 'Communications', timeline: 'Timeline', audit: 'Audit',
};
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
      // Heights are CANONICAL rows (18h − 12 px) like every other board — this page previously
      // ran on the old coarse 88px default, which made it the one board where a shared
      // (`supportedPages: ['*']`) widget could not render at a sane size.
      main: [
        // The four APPROVED Overview widgets. Handoffs and Custom Actions are deliberately
        // NOT here: Handoffs owns its own permanent tab, and case actions are labelled rows
        // inside Tasks. Both remain addable from the Widget Library without changing the
        // authoritative workspaces.
        defInst('hr.onboarding.case.activeTasks',         0,  0, 8, 26, 'wide'),   // Priority Tasks
        defInst('hr.onboarding.case.activationReadiness', 8,  0, 4, 13, 'tall'),
        defInst('hr.onboarding.case.readinessByDomain',   8, 13, 4, 13, 'tall'),
        defInst('hr.onboarding.case.blockersTable',       0, 26, 12, 20, 'wide'),  // Key Blockers
      ],
    },
  };
}

// ── main component ─────────────────────────────────────────────────────────────
export function OnboardingCaseDetail({
  caseRow, onBack, onToast, focus = null,
}: {
  caseRow: OnboardingCaseRow; onBack: () => void; onToast: (m: string) => void;
  /** Optional deep-link from the Work Queue: which record the user came here to act on. */
  focus?: CaseFocusRequest | null;
}): VNode {
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
  const [communicationModalOpen, setCommunicationModalOpen] = useState(false);
  const [communicationForm, setCommunicationForm] = useState({
    communicationType: 'employee_welcome' as OnboardingCommunicationType,
    channel: 'email' as OnboardingCommunicationChannel,
  });
  const canEdit = useSessionStore(selectIsManager);
  const isAdmin = useSessionStore(selectIsAdmin);
  const canManageCase = can('hr.onboarding.case.manage');
  const canManageTasks = can('hr.onboarding.task.manage');
  const setCaseInStore = useOnboardingCaseStore(s => s.setCase);
  const clearCaseInStore = useOnboardingCaseStore(s => s.clear);
  const {
    layout, addWidget, updateZoneLayout, saveLayout, cancelLayout, setAsDefault, resetLayout,
    isDefaultDirty, isDirty, isSaving,
  } = useBoardLayout(CASE_PAGE_KEY, defaultCaseLayout());
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
  const ownerEmployee = employees.find(e => e.id === caseRow.ownerId);

  // ── seven-tab shell ─────────────────────────────────────────────────────────────
  // A drill-through from the Work Queue opens its owning tab; a direct open lands on
  // Overview. Keyed on `focus` so arriving at a different record re-targets the tab, while
  // a user's own tab clicks are never overridden.
  const [tab, setTab] = useState<CaseTab>(() => focusTab(focus));
  const focusedRecordId = focusRecordId(focus);
  const focusedEvidenceId = focusEvidenceId(focus);
  useEffect(() => { setTab(focusTab(focus)); }, [focus]);

  const showAudit = can('hr.onboarding.audit.view');
  // Audit is ABSENT without the permission, not disabled — and a stale tab selection can
  // never leave the user on a panel they may not read.
  const visibleTabs = useMemo(() => CASE_TABS.filter(t => t !== 'audit' || showAudit), [showAudit]);
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(DEFAULT_CASE_TAB); }, [visibleTabs, tab]);

  // Fetched only once their tab is opened — six permanent workspaces must not all load on
  // arrival. `enabled` keeps Overview's first paint to the queries it actually needs.
  const commsQ    = useOnboardingCommunications(tab === 'communications' ? caseId : null);
  const timelineQ = useOnboardingTimeline(tab === 'timeline' ? caseId : null);
  const auditQ    = useOnboardingAudit(tab === 'audit' && showAudit ? caseId : null);

  // Evidence arriving without a parent task cannot select anything.
  useEffect(() => {
    if (focus?.sourceType === 'evidence' && !focusedRecordId) {
      onToast('That evidence is no longer linked to a task — showing the case.');
    }
  }, [focus, focusedRecordId, onToast]);

  // ── ONE blocked truth ───────────────────────────────────────────────────────────
  // The case status, the blocking-task flags and the blocker records are three different
  // stores and were being shown side by side, so a case could read "Blocked" while the
  // Blockers tab was empty. This reconciles them into a single statement: the status is
  // only ever explained by evidence that exists, and the reason names its source.
  const blocked = useMemo(() => {
    const openBlockers = blockers.filter(b => blockerOpen(b.status));
    const blockedTasks = tasks.filter(t => t.status === 'blocked');
    const openBlockingTasks = tasks.filter(t => t.isBlocking && isOpen(t.status));
    const parts: string[] = [];
    if (openBlockers.length) parts.push(`${openBlockers.length} blocker${openBlockers.length === 1 ? '' : 's'}`);
    if (blockedTasks.length) parts.push(`${blockedTasks.length} blocked task${blockedTasks.length === 1 ? '' : 's'}`);
    if (!parts.length && openBlockingTasks.length) {
      parts.push(`${openBlockingTasks.length} blocking task${openBlockingTasks.length === 1 ? '' : 's'} outstanding`);
    }
    return {
      openBlockers, blockedTasks, openBlockingTasks,
      isBlocked: openBlockers.length > 0 || blockedTasks.length > 0,
      // Never "No active blockers" on a case whose status says otherwise.
      reason: parts.length ? parts.join(' · ') : 'Nothing blocking',
    };
  }, [blockers, tasks]);

  // Readiness is DERIVED from the tasks already loaded (moduleKey + status), exactly as the
  // approved mockup specifies. No second data system, no new endpoint.
  const readiness = useMemo(() => {
    const done = (t: OnboardingTaskRow): boolean => ['completed', 'skipped'].includes(t.status);
    const byDomain = new Map<string, { total: number; done: number; blocking: number }>();
    for (const t of tasks) {
      const key = t.moduleKey ?? t.ownerRole ?? 'general';
      const row = byDomain.get(key) ?? { total: 0, done: 0, blocking: 0 };
      row.total += 1;
      if (done(t)) row.done += 1;
      if (t.isBlocking && !done(t)) row.blocking += 1;
      byDomain.set(key, row);
    }
    const total = tasks.length;
    const completed = tasks.filter(done).length;
    const openBlocking = tasks.filter(t => t.isBlocking && !done(t)).length;
    return {
      total, completed, openBlocking,
      percent: total ? Math.round((completed / total) * 100) : 0,
      domains: [...byDomain.entries()]
        .map(([key, v]) => ({ key, ...v, percent: v.total ? Math.round((v.done / v.total) * 100) : 0 }))
        .sort((a, b) => a.percent - b.percent || a.key.localeCompare(b.key)),
    };
  }, [tasks]);


  // ── mutations ───────────────────────────────────────────────────────────────────
  const pauseMut = useOnboardingPauseCase(), resumeMut = useOnboardingResumeCase(), markReadyMut = useOnboardingMarkReady();
  const completeCaseMut = useOnboardingCompleteCase(), cancelMut = useOnboardingCancelCase(), reassignMut = useOnboardingReassignOwner();
  const provisionMut = useOnboardingProvisionAccount();
  const completeTaskMut = useOnboardingCompleteTask(), reassignTaskMut = useOnboardingReassignTask(), blockTaskMut = useOnboardingBlockTask(), unblockTaskMut = useOnboardingUnblockTask();
  const retryHandoffMut = useOnboardingRetryHandoff(), acceptHandoffMut = useOnboardingAcceptHandoff(), completeHandoffMut = useOnboardingCompleteHandoff(), cancelHandoffMut = useOnboardingCancelHandoff();
  const resolveMut = useOnboardingResolveBlocker(), escalateMut = useOnboardingEscalateBlocker(), waiveMut = useOnboardingWaiveBlocker();
  const sendCommunicationMut = useOnboardingSendCommunication(), resendCommunicationMut = useOnboardingResendCommunication();
  const addActionMut = useOnboardingAddCaseAction(), updateActionMut = useOnboardingUpdateCaseAction(), completeActionMut = useOnboardingCompleteCaseAction(), cancelActionMut = useOnboardingCancelCaseAction();

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }

  // ── lifecycle handlers (ActionModal: record + status transition + consequence) ────
  const caseRecord = () => toActionRecord({
    title: `${caseRow.caseNo} · ${caseRow.employeeName ?? '—'}`, subtitle: caseRow.packageLabel, icon: 'fa-rocket',
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

  // ── handoff handlers ────────────────────────────────────────────────────────
  async function handleRetryHandoff(h: OnboardingHandoffRow): Promise<void> {
    await run(() => retryHandoffMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff queued for retry');
  }
  async function handleAcceptHandoff(h: OnboardingHandoffRow): Promise<void> {
    await run(() => acceptHandoffMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff accepted');
  }
  async function handleCompleteHandoff(h: OnboardingHandoffRow): Promise<void> {
    await run(() => completeHandoffMut.mutateAsync({ handoffId: h.handoffId }), 'Handoff completed');
  }
  async function handleCancelHandoff(h: OnboardingHandoffRow): Promise<void> {
    const res = await openActionModal({
      title: 'Cancel handoff', icon: 'fa-xmark', tone: 'danger',
      record: toActionRecord({ title: `${queueLabel(h.targetModule)} · ${humanize(h.handoffType ?? 'handoff')}`, icon: 'fa-arrow-right-arrow-left' }),
      reason: { required: true, label: 'Reason for cancelling', type: 'textarea', placeholder: 'Why is this handoff no longer required?' },
      whatNext: ['The receiving team can no longer act on this handoff.'], confirmLabel: 'Cancel handoff',
    });
    if (res.confirmed) await run(() => cancelHandoffMut.mutateAsync({ handoffId: h.handoffId, reason: res.reason ?? null }), 'Handoff cancelled');
  }

  async function submitCommunication(): Promise<void> {
    await run(() => sendCommunicationMut.mutateAsync({ caseId, ...communicationForm }), 'Communication queued');
    setCommunicationModalOpen(false);
  }

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

  const tasksBody = (): VNode => tasksQ.isLoading ? empty('Loading…') : !tasks.length ? empty('No tasks for this case.') : (
    <table class="obx-table">
      <thead><tr><th>Task</th><th>Queue · Accountable</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{tasks.map(t => (
        <tr key={t.taskId} data-record-id={t.taskId} class={focusedRecordId === t.taskId ? "ocd-focused" : undefined}>
          <td><b>{t.taskTitle}</b>{t.isBlocking && <span class="obx-pill red" style={{ marginLeft: 8 }}>blocking</span>}</td>
          <td>
            {/* Routing ownership and personal accountability are different things: the queue
                is a team, the assignee is a person. Showing the role inside the person
                selector made an unassigned task read as a blank control. */}
            <div class="ocd-owner-cell">
              <span class="ocd-queue-chip">{queueLabel(t.moduleKey ?? t.ownerRole)}</span>
              {canManageTasks ? (
                <select
                  class="obx-mini-select" value={t.assignedTo ?? ''}
                  onChange={e => void handleReassignTask(t, (e.target as HTMLSelectElement).value)}
                  aria-label={`Accountable person for ${t.taskTitle}`} title="Accountable person"
                >
                  <option value="">Unassigned</option>
                  {employees.map(e => <option key={e.id} value={e.id}>{e.full_name ?? e.email ?? e.id}</option>)}
                </select>
              ) : <span class="ocd-accountable-name">{t.assignedToName ?? 'Unassigned'}</span>}
            </div>
          </td>
          <td>{fmtDate(t.dueAt)}</td>
          <td><Pill s={t.status} /></td>
          <td><div class="obx-rowbtns">
            {canManageTasks && <>
            {isOpen(t.status) && <button class="obx-mini" onClick={() => void handleCompleteTask(t)}>Complete</button>}
            {t.status === 'blocked' ? <button class="obx-mini" onClick={() => void handleUnblockTask(t)}>Unblock</button> : isOpen(t.status) && <button class="obx-mini" onClick={() => void handleBlockTask(t)}>Block</button>}
            </>}
          </div></td>
        </tr>
      ))}</tbody>
    </table>
  );

  const blockersBody = (): VNode => blockersQ.isLoading ? empty('Loading…') : !blockers.length ? empty('No blockers.') : (
    <table class="obx-table">
      <thead><tr><th>Blocker</th><th>Module</th><th>Severity</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{blockers.map(b => (
        <tr key={b.blockerId} data-record-id={b.blockerId} class={focusedRecordId === b.blockerId ? "ocd-focused" : undefined}>
          <td><b>{b.blockerTitle}</b></td>
          <td><span class="ocd-queue-chip">{queueLabel(b.blockingModule)}</span></td>
          <td><Pill s={b.severity} /></td>
          <td><Pill s={b.status} /></td>
          <td>{canManageCase && blockerOpen(b.status) ? <div class="obx-rowbtns">
            <button class="obx-mini" onClick={() => void handleResolve(b)}>Resolve</button>
            <button class="obx-mini" onClick={() => void handleEscalate(b)}>Escalate</button>
            <button class="obx-mini" onClick={() => void handleWaive(b)}>Waive</button>
          </div> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const handoffsBody = (): VNode => handoffsQ.isLoading ? empty('Loading…') : !handoffs.length ? empty('No handoffs.') : (
    <table class="obx-table">
      <thead><tr><th>Receiving Queue</th><th>Type</th><th>Accountable</th><th>Status</th><th>Due</th><th>Actions</th></tr></thead>
      <tbody>{handoffs.map(h => (
        <tr key={h.handoffId} data-record-id={h.handoffId} class={focusedRecordId === h.handoffId ? "ocd-focused" : undefined}>
          <td><span class="ocd-queue-chip">{queueLabel(h.targetModule)}</span></td>
          <td>{humanize(h.handoffType ?? '—')}</td>
          <td>{h.ownerName ?? 'Unassigned'}</td>
          <td><Pill s={h.status} /></td>
          <td>{fmtDate(h.dueAt)}</td>
          <td>{canManageCase ? <div class="obx-rowbtns">
            {h.status === 'failed' && <button class="obx-mini" onClick={() => void handleRetryHandoff(h)}>Retry</button>}
            {['pending', 'sent'].includes(h.status) && <button class="obx-mini" onClick={() => void handleAcceptHandoff(h)}>Accept</button>}
            {['accepted', 'delivered', 'blocked'].includes(h.status) && <button class="obx-mini" onClick={() => void handleCompleteHandoff(h)}>Complete</button>}
            {!['completed', 'cancelled'].includes(h.status) && <button class="obx-mini" onClick={() => void handleCancelHandoff(h)}>Cancel</button>}
          </div> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const ACTION_STATUS_OPTIONS: OnboardingCaseActionStatus[] = ['open', 'in_progress', 'blocked', 'completed', 'cancelled'];
  const actionsBody = (): VNode => actionsQ.isLoading ? empty('Loading…') : !actions.length ? empty('No custom actions.') : (
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

  // Each page-local widget declares a resize FLOOR in canonical rows. Without one widgetMinGrid
  // falls back to a generic 2 cells — 24px on this grid, i.e. a table draggable into a sliver.
  const floor = (w: number, h: number): WidgetSizeDef[] => [{ key: 'wide', label: 'Default', grid: { w, h } }];
  // ── permanent tab workspaces ────────────────────────────────────────────────────
  // Each reuses the module's existing hook. None introduces a second data system.
  const panelState = (q: { isLoading: boolean; isError: boolean; error: unknown }, emptyText: string, len: number): VNode | null => {
    if (q.isLoading) return <div class="ocd-panel-state">Loading…</div>;
    if (q.isError) return (
      <div class="ocd-panel-state is-error" role="alert">
        <strong>That could not be loaded.</strong>
        <span>{q.error instanceof Error ? q.error.message : 'Please try again.'}</span>
      </div>
    );
    if (!len) return <div class="ocd-panel-state">{emptyText}</div>;
    return null;
  };

  const communicationsPanel = (): VNode => {
    const rows = commsQ.data ?? [];
    return panelState(commsQ, 'No communications sent for this case yet.', rows.length) ?? (
      <table class="obx-table">
        <thead><tr><th>Type</th><th>Recipient</th><th>Channel</th><th>Status</th><th>Sent</th><th>Actions</th></tr></thead>
        <tbody>{rows.map(c => (
          <tr key={c.id} data-record-id={c.id}>
            <td><b>{humanize(c.communicationType)}</b>{c.subject && <small class="ocd-sub">{c.subject}</small>}</td>
            <td>{c.recipientName ?? c.recipientEmail ?? '—'}</td>
            <td>{humanize(c.channel)}</td>
            <td><Pill s={c.status} />{c.failureReason && <small class="ocd-sub">{c.failureReason}</small>}</td>
            <td>{c.sentAt ? fmtDateTime(c.sentAt) : '—'}</td>
            <td>{canManageCase && c.status === 'failed'
              ? <button class="obx-mini" onClick={() => void run(() => resendCommunicationMut.mutateAsync({ id: c.id }), 'Communication queued again')}>Resend</button>
              : <span class="obx-meta">—</span>}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  };

  const timelinePanel = (): VNode => {
    const rows = timelineQ.data ?? [];
    return panelState(timelineQ, 'Nothing has happened on this case yet.', rows.length) ?? (
      <ol class="ocd-timeline">
        {rows.map(e => (
          <li key={e.id} data-record-id={e.id}>
            <span class={`ocd-tl-dot ${tone(e.severity ?? '')}`} aria-hidden="true" />
            <div>
              <div class="ocd-tl-top"><strong>{e.title}</strong><time>{fmtDateTime(e.created_at)}</time></div>
              {e.description && <p>{e.description}</p>}
              <small>{humanize(e.item_type)}{e.actor_name ? ` · ${e.actor_name}` : ''}</small>
            </div>
          </li>
        ))}
      </ol>
    );
  };

  const auditPanel = (): VNode => {
    const rows = auditQ.data ?? [];
    const hasReasons = rows.some(a => !!a.reason);
    return panelState(auditQ, 'No audited changes on this case.', rows.length) ?? (
      <table class="obx-table">
        <thead><tr><th>Action</th><th>Actor</th>{hasReasons && <th>Reason</th>}<th>When</th></tr></thead>
        <tbody>{rows.map(a => (
          <tr key={a.id} data-record-id={a.id}>
            <td><b>{humanize(a.action.replace(/^hr\.onboarding\./, ''))}</b></td>
            <td>{a.actorName ?? a.actorId ?? 'System'}</td>
            {hasReasons && <td>{a.reason ?? '—'}</td>}
            <td>{fmtDateTime(a.createdAt)}</td>
          </tr>
        ))}</tbody>
      </table>
    );
  };

  // ── Overview widget bodies ──────────────────────────────────────────────────────
  const readinessBody = (): VNode => tasksQ.isLoading ? empty('Loading…') : !readiness.total ? empty('No tasks yet — readiness is unmeasured.') : (
    <div class="ocd-readiness">
      <div class="ocd-gauge" role="img" aria-label={`Activation readiness ${readiness.percent} percent`}>
        <strong>{readiness.percent}%</strong>
        <span>{readiness.completed} of {readiness.total} tasks complete</span>
      </div>
      <div class="ocd-readiness-bar"><i style={{ width: `${readiness.percent}%` }} /></div>
      <p class={readiness.openBlocking ? 'ocd-readiness-note is-blocked' : 'ocd-readiness-note'}>
        {readiness.openBlocking
          ? `${readiness.openBlocking} blocking task${readiness.openBlocking === 1 ? '' : 's'} must clear before activation`
          : 'No blocking tasks outstanding'}
      </p>
    </div>
  );

  const readinessDomainBody = (): VNode => tasksQ.isLoading ? empty('Loading…') : !readiness.domains.length ? empty('No tasks yet.') : (
    <ul class="ocd-domain-list">
      {readiness.domains.map(d => (
        <li key={d.key}>
          <div class="ocd-domain-top">
            <strong>{queueLabel(d.key)}</strong>
            <span>{d.done}/{d.total}</span>
          </div>
          <div class="ocd-readiness-bar sm"><i class={d.blocking ? 'is-blocked' : ''} style={{ width: `${d.percent}%` }} /></div>
          {d.blocking > 0 && <small class="ocd-domain-blocking">{d.blocking} blocking</small>}
        </li>
      ))}
    </ul>
  );

  const priorityTasksBody = (): VNode => {
    const rows = tasks
      .filter(t => isOpen(t.status))
      .sort((a, b) => Number(b.isBlocking) - Number(a.isBlocking) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
      .slice(0, 5);
    if (tasksQ.isLoading) return empty('Loading…');
    if (!rows.length) return empty('No priority tasks need attention.');
    return (
      <ul class="ocd-priority-list">
        {rows.map(t => (
          <li key={t.taskId}>
            <div class="ocd-priority-main">
              <strong>{t.taskTitle}</strong>
              <span>{queueLabel(t.moduleKey ?? t.ownerRole)} · {t.assignedToName ?? 'Unassigned'}</span>
            </div>
            <div class="ocd-priority-meta">
              {t.isBlocking && <span class="obx-pill red">Blocking</span>}
              <time>{fmtDate(t.dueAt)}</time>
              <Pill s={t.status} />
            </div>
          </li>
        ))}
      </ul>
    );
  };

  const localWidgets: LocalWidgetMap = {
    'hr.onboarding.case.activeTasks':   { chrome: 'none', title: 'Active Tasks', allowedSizes: floor(4, 12), render: () => wcard('Priority Tasks', 'fa-list-check', priorityTasksBody(), <div class="obx-rowbtns"><button class="obx-mini" onClick={() => setTab('tasks')}>View all</button>{canManageTasks && <button class="obx-btn primary obx-btn-sm" onClick={openAddTask}>+ Add</button>}</div>) },
    'hr.onboarding.case.blockersTable': { chrome: 'none', title: 'Blockers', allowedSizes: floor(3, 12), render: () => wcard('Key Blockers', 'fa-triangle-exclamation', blockersBody()) },
    'hr.onboarding.case.handoffsTable': { chrome: 'none', title: 'Handoffs', allowedSizes: floor(3, 12), render: () => wcard('Handoffs', 'fa-arrow-right-arrow-left', handoffsBody()) },
    'hr.onboarding.case.activationReadiness': { chrome: 'none', title: 'Activation Readiness', allowedSizes: floor(3, 8), render: () => wcard('Activation Readiness', 'fa-gauge-high', readinessBody()) },
    'hr.onboarding.case.readinessByDomain':   { chrome: 'none', title: 'Readiness by Domain', allowedSizes: floor(3, 10), render: () => wcard('Readiness by Domain', 'fa-layer-group', readinessDomainBody()) },
    'hr.onboarding.case.customActions': { chrome: 'none', title: 'Custom Actions', allowedSizes: floor(3, 12), render: () => wcard('Custom Actions', 'fa-bolt', actionsBody(), <button class="obx-btn primary obx-btn-sm" onClick={openAddAction}>+ Add</button>) },
  };

  // ── lifecycle action buttons (PageHeader actions slot) ──────────────────────────
  const headerActions = (
    <div class="obx-actions">
      {canManageCase && <>
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
      </>}
    </div>
  );

  // ── render — standard PageHeader + Customize grid ───────────────────────────────
  return (
    <div class="hr-onboarding-case ocd-root">
      <button class="obx-back" onClick={onBack}>← Onboarding Cases</button>

      <PageHeader
        icon="fa-user-check"
        module="HR · Onboarding"
        title={caseRow.employeeName ?? caseRow.caseNo}
        sub={`${caseRow.caseNo} · ${caseRow.packageLabel}`}
        actions={headerActions}
      />


      {/* ── approved profile strip: one navy identity cell + four white fact cells ── */}
      <section class="case-profile-strip" aria-label="Case summary">
        <div class="case-profile-cell case-person">
          {caseRow.employeePhotoUrl
            ? <img class="avatar" src={caseRow.employeePhotoUrl} alt="" />
            : <span class="avatar" aria-hidden="true">{_initials(caseRow.employeeName)}</span>}
          <div class="case-profile-copy">
            <span>Employee</span>
            <strong>{caseRow.employeeName ?? '—'}</strong>
            <small>{caseRow.caseNo} · {caseRow.departmentName ?? 'Department unassigned'}</small>
          </div>
        </div>
        <div class="case-profile-cell case-profile-fact">
          <span><LucideIcon name="Package" size={16} />Package</span><strong>{caseRow.packageLabel}</strong>
          <small>{humanize(caseRow.workerType ?? 'employee')}</small>
        </div>
        <div class="case-profile-cell case-profile-fact">
          <span><LucideIcon name="UserRound" size={16} />Case Owner</span>
          <div class="case-owner-name">
            {ownerEmployee?.profile_image_url
              ? <img src={ownerEmployee.profile_image_url} alt="" />
              : <span class="ocd-owner-avatar" aria-hidden="true">{_initials(caseRow.ownerName)}</span>}
            <strong>{caseRow.ownerName ?? 'Unassigned'}</strong>
          </div>
          <small>{caseRow.departmentName ?? '—'}</small>
        </div>
        <div class="case-profile-cell case-profile-fact case-stage">
          <span><LucideIcon name="Route" size={16} />Current Stage</span><strong>{readiness.percent}% complete</strong>
          <span class="case-stage-progress" aria-hidden="true"><i style={{ width: `${readiness.percent}%` }} /></span>
          <small>{readiness.completed} of {readiness.total} tasks complete</small>
        </div>
        <div class="case-profile-cell case-profile-fact">
          <span><LucideIcon name="ShieldCheck" size={16} />Status</span><strong class={`ocd-status ${tone(caseRow.status)}`}>{humanize(caseRow.status)}</strong>
          <small>{blocked.reason}</small>
        </div>
      </section>

      {/* ── the seven permanent tabs. Counts come from the queries already loaded. ── */}
      <nav class="tabs ocd-tabs" role="tablist" aria-label="Onboarding case sections">
        {visibleTabs.map(t => {
          const count = t === 'tasks' ? tasks.filter(x => isOpen(x.status)).length
            : t === 'handoffs' ? handoffs.length
            : t === 'blockers' ? blockers.filter(b => blockerOpen(b.status)).length
            : 0;
          return (
            <button
              key={t} type="button" role="tab" id={`caseTab-${t}`}
              aria-selected={tab === t} aria-controls={`casePanel-${t}`}
              class={tab === t ? 'active' : ''} onClick={() => setTab(t)}
            >
              {TAB_LABEL[t]}
              {count > 0 && <span class={`status ${t === 'blockers' ? 'red' : t === 'handoffs' ? 'amber' : 'blue'}`}>{count}</span>}
            </button>
          );
        })}
      </nav>

      {/* Customize belongs to Overview only — the six operational tabs are permanent. */}
      {tab === 'overview' && canEdit && (
        <WidgetBoardToolbar
          editing={editing} canSetDefault={isAdmin} defaultDirty={isDefaultDirty} finishInBanner layoutItems={boardItems}
          onToggleEdit={() => setEditing(e => !e)}
          onOpenLibrary={() => { setEditing(true); setLibOpen(true); }}
          onSaveEditing={async () => { if (await saveLayout()) setEditing(false); }}
          onCancelEditing={async () => { await cancelLayout(); setEditing(false); }}
          onReset={() => void resetLayout()}
          onSetDefault={() => void setAsDefault()}
        />
      )}

      {tab === 'overview' && preview && (
        <div class="wmock-preview-banner">
          <span><i class="fas fa-eye" /> Previewing a widget — drag and resize it on the grid, then add or discard.</span>
          <button class="obx-btn" onClick={discardPreview}>Discard preview</button>
        </div>
      )}

      <div id={`casePanel-${tab}`} role="tabpanel" aria-labelledby={`caseTab-${tab}`} class="ocd-panel">
        {tab === 'overview' && (
          <WidgetBoard
            pageKey={CASE_PAGE_KEY} zones={[CASE_ZONE]} editing={editing && canEdit}
            localWidgets={localWidgets} defaultLayout={defaultCaseLayout()} demo={demo}
            preview={preview} onPreviewChange={setPreview}
            onCommitPreview={commitPreview} onDiscardPreview={discardPreview}
            onFinishEditing={() => setEditing(false)}
            onSaveEditing={async () => { if (await saveLayout()) setEditing(false); }}
            onCancelEditing={async () => { await cancelLayout(); setEditing(false); }}
            onOpenLibrary={() => setLibOpen(true)}
            defaultDirty={isDefaultDirty} isDirty={isDirty} saving={isSaving}
          />
        )}
        {tab === 'tasks' && (
          <section class="ocd-workspace" data-focus-record={focusedRecordId ?? undefined}>
            <header class="ocd-workspace-head">
              <div><h2>Tasks</h2><p>Every task on this case, including case-specific actions.</p></div>
              {canManageTasks && <button class="obx-btn primary obx-btn-sm" onClick={openAddTask}>+ Add Task</button>}
            </header>
            {focusedEvidenceId && <p class="ocd-focus-note">Opened from an evidence review — the task holding that submission is highlighted.</p>}
            {tasksBody()}
          </section>
        )}
        {tab === 'handoffs' && (
          <section class="ocd-workspace" data-focus-record={focusedRecordId ?? undefined}>
            <header class="ocd-workspace-head"><div><h2>Handoffs</h2><p>Receiving teams and their acceptance state.</p></div></header>
            {handoffsBody()}
          </section>
        )}
        {tab === 'blockers' && (
          <section class="ocd-workspace" data-focus-record={focusedRecordId ?? undefined}>
            <header class="ocd-workspace-head"><div><h2>Blockers</h2><p>Exceptions holding activation, with owning queue and severity.</p></div></header>
            {/* A case can be Blocked because a TASK is blocked, with no blocker record at
                all. Saying "No blockers" there is the contradiction this reconciles. */}
            {!blocked.openBlockers.length && blocked.blockedTasks.length > 0 && (
              <p class="ocd-focus-note">
                No blocker records — this case is blocked by {blocked.blockedTasks.length} blocked
                task{blocked.blockedTasks.length === 1 ? '' : 's'} on the Tasks tab.
              </p>
            )}
            {blockersBody()}
          </section>
        )}
        {tab === 'communications' && (
          <section class="ocd-workspace">
            <header class="ocd-workspace-head">
              <div><h2>Communications</h2><p>Case-linked messages and their delivery state.</p></div>
              {canManageCase && <button class="obx-btn primary obx-btn-sm" onClick={() => setCommunicationModalOpen(true)}>Send Message</button>}
            </header>
            {communicationsPanel()}
          </section>
        )}
        {tab === 'timeline' && (
          <section class="ocd-workspace">
            <header class="ocd-workspace-head"><div><h2>Timeline</h2><p>The readable history of this case.</p></div></header>
            {timelinePanel()}
          </section>
        )}
        {tab === 'audit' && showAudit && (
          <section class="ocd-workspace">
            <header class="ocd-workspace-head"><div><h2>Audit</h2><p>Governed changes: actor, action, reason and time.</p></div></header>
            {auditPanel()}
          </section>
        )}
      </div>

      <WidgetLibraryModal
        open={libOpen} pageKey={CASE_PAGE_KEY} zoneId={CASE_ZONE}
        placedWidgetIds={placedWidgetIds} userPermissions={userPermissions}
        demo={demo} onToggleDemo={() => setDemo(d => !d)}
        canManagePackages={isAdmin}
        onClose={() => setLibOpen(false)}
        onAddWidget={inst => addWidget(CASE_ZONE, placeBottom(inst))}
        onAddWidgets={instances => updateZoneLayout(CASE_ZONE, [...boardItems, ...placeWidgetsAtBottom(boardItems, instances)])}
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

      <Modal
        open={communicationModalOpen} title="Send Case Communication" icon="fa-paper-plane"
        onClose={() => setCommunicationModalOpen(false)}
        onSubmit={() => void submitCommunication()} submitLabel="Send" submitDisabled={sendCommunicationMut.isPending}
      >
        <FormGrid>
          <Field label="Message">
            <select class="ui-select" value={communicationForm.communicationType} onChange={e => setCommunicationForm(f => ({ ...f, communicationType: (e.target as HTMLSelectElement).value as OnboardingCommunicationType }))}>
              {(['employee_welcome', 'supervisor_notification', 'owner_reminder', 'escalation_notice'] as OnboardingCommunicationType[])
                .map(t => <option key={t} value={t}>{humanize(t)}</option>)}
            </select>
          </Field>
          <Field label="Channel">
            <select class="ui-select" value={communicationForm.channel} onChange={e => setCommunicationForm(f => ({ ...f, channel: (e.target as HTMLSelectElement).value as OnboardingCommunicationChannel }))}>
              {(['email', 'in_app', 'sms'] as OnboardingCommunicationChannel[]).map(c => <option key={c} value={c}>{humanize(c)}</option>)}
            </select>
          </Field>
        </FormGrid>
        <p class="ocd-form-note">SIOMAC resolves the correct recipient and uses the published template for this case.</p>
      </Modal>
    </div>
  );
}
