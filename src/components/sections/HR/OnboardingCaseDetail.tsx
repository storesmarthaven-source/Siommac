/**
 * src/components/sections/HR/OnboardingCaseDetail.tsx
 *
 * HR ▸ Onboarding ▸ Case Detail — a FIXED SEVEN-TAB operating page.
 *
 *   Overview · Tasks · Handoffs · Blockers · Communications · Timeline · Audit
 *
 * THE RULE (corrects an earlier stale note that called this page a widget board):
 *   Command Centre  = a WidgetBoard.
 *   Case Detail     = a seven-tab operating shell built to its own approved design.
 *
 * All seven tabs are PERMANENT operational workspaces. They are not widgets, they are not in
 * the Widget Library, and they cannot be removed or reordered. Overview is the approved
 * `work-area` composition — Priority Tasks and Readiness by Domain beside a Key Blockers
 * rail — NOT a customizable grid. The earlier four-widget board was superseded by
 * docs/mockups/onboarding-case-detail-implementation-ready.html, which is the authority for
 * this page; onboardingCaseDetail.test.ts records that supersession openly.
 *
 * Audit is permission-gated on `hr.onboarding.audit.view` and is absent — not merely
 * disabled — without it.
 *
 * Every tab reuses the module's existing onboarding API; no tab introduces a second data
 * system, and no control here is a placeholder. All mutations invalidate ['hr','onboarding'].
 */
import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { openActionModal, toActionRecord, statusBadge } from '@/components/common/actions';
import { Modal, Field, FormGrid, TextInput, SelectInput, LucideIcon, PersonSearchSelect } from '@ui';
import type { LucideName } from '@ui/LucideIcon';
import { can } from '@lib/permissions';
import {
  useOnboardingTasksList, useOnboardingHandoffsList, useOnboardingBlockersList, useOnboardingCaseActions,
  useOnboardingCommunications, useOnboardingTimeline, useOnboardingAudit,
  useOnboardingCompleteTask, useOnboardingReassignTask, useOnboardingBlockTask, useOnboardingUnblockTask,
  useOnboardingRetryHandoff, useOnboardingAcceptHandoff, useOnboardingCompleteHandoff, useOnboardingCancelHandoff,
  useOnboardingResolveBlocker, useOnboardingEscalateBlocker, useOnboardingWaiveBlocker, useOnboardingNotifyBlockerOwner,
  useOnboardingPauseCase, useOnboardingResumeCase, useOnboardingMarkReady, useOnboardingCompleteCase,
  useOnboardingCancelCase, useOnboardingReassignOwner, useOnboardingProvisionAccount,
  useOnboardingAddCaseAction, useOnboardingUpdateCaseAction, useOnboardingCompleteCaseAction, useOnboardingCancelCaseAction,
  useOnboardingSendCommunication, useOnboardingResendCommunication,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import { recordReadScope } from './useOnboardingScope';
import type {
  OnboardingReadScope,
  OnboardingCaseRow, OnboardingTaskRow, OnboardingBlockerRow, OnboardingCaseAction,
  OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority, OnboardingCaseActionStatus,
  OnboardingCommunicationType, OnboardingCommunicationChannel, OnboardingHandoffRow,
} from '../../../../types/hrOnboarding';
import { useOnboardingCaseStore } from '@store/onboardingCase';
import { openHrEmployeeRecord, openOnboardingPackages } from './hrDeepLink';
import { rowName } from './shared';
import { humanize, fmtDate, fmtDateTime } from './onboardingStatus';
import { isOpen } from './onboardingCase.helpers';
import {
  CASE_TABS, DEFAULT_CASE_TAB, focusTab, focusRecordId, focusEvidenceId,
  type CaseTab, type CaseFocusRequest,
} from './onboardingCaseFocus';
import { OnboardingAddTaskModal } from './OnboardingAddTaskModal';
import './OnboardingCaseDetail.mockup.css';
import './onboardingCaseDetail.page.css';

// ── helpers ──────────────────────────────────────────────────────────────────────
const _initials = (n: string | null | undefined): string =>
  (n ?? '').split(/\s+/).filter(Boolean).slice(0, 2).map(s => (s[0] ?? '').toUpperCase()).join('') || '?';

/**
 * Is a blocker still open?
 *
 * MODULE scope on purpose. This was a `const` inside the component declared BELOW the
 * `blocked` useMemo that calls it, so the memo read it from the temporal dead zone. It
 * survived an empty list — `[].filter(cb)` never invokes `cb` — and then threw
 * "Cannot access 'blockerOpen' before initialization" on the first render after real
 * blockers arrived. A throw during render aborts the update, so the page froze with its
 * last-painted DOM: clicks ran their handlers, state changed, and nothing ever repainted.
 * That is what made every tab look dead. It has no closure dependencies, so it lives here.
 */
const blockerOpen = (s: string): boolean =>
  ['active', 'acknowledged', 'waiting_on_owner', 'escalated'].includes(s);

function tone(s: string): string {
  if (['completed', 'delivered', 'accepted', 'resolved', 'received', 'waived', 'ready_for_activation'].includes(s)) return 'green';
  if (['blocked', 'failed', 'escalated', 'active', 'critical'].includes(s)) return 'red';
  if (['in_progress', 'sent', 'acknowledged', 'waiting_on_owner', 'paused', 'high', 'queued'].includes(s)) return 'amber';
  if (['cancelled', 'skipped', 'draft', 'low'].includes(s)) return 'gray';
  return 'blue';
}

/** The mockup's pill. One shape for every status in the page — no second badge vocabulary. */
const Status = ({ s, label }: { s: string; label?: string }): VNode =>
  <span class={`status ${tone(s)}`}>{label ?? humanize(s)}</span>;

/**
 * Human labels for routing queues. An internal module/role key must never reach the UI:
 * "hse" is a key, "HSE Queue" is what a person routes work to.
 */
const QUEUE_LABEL: Record<string, string> = {
  hr: 'HR', it: 'IT', hse: 'HSE', training: 'Training', payroll: 'Payroll',
  security: 'Security', facilities: 'Facilities', finance: 'Finance', supervisor: 'Supervisor',
  general: 'General',
};
/** Short domain name — matrix columns and card sub-lines. */
function domainLabel(key: string | null | undefined): string {
  if (!key) return 'Unrouted';
  return QUEUE_LABEL[key] ?? humanize(key);
}
/** The routable queue — where work goes, as distinct from the person accountable for it. */
function queueLabel(key: string | null | undefined): string {
  if (!key) return 'Unrouted';
  return `${domainLabel(key)} Queue`;
}
const DOMAIN_ICON: Record<string, LucideName> = {
  hr: 'Users', it: 'Lock', hse: 'ShieldCheck', training: 'GraduationCap', payroll: 'Wallet',
  security: 'ShieldCheck', facilities: 'Package', finance: 'Wallet', supervisor: 'UserRound',
  general: 'ListChecks',
};
const domainIcon = (key: string): LucideName => DOMAIN_ICON[key] ?? 'ListChecks';

const DAY_MS = 86_400_000;
/** Due-date presentation: the date plus its human distance, and whether it has passed. */
function dueParts(iso: string | null): { label: string; note: string; overdue: boolean } {
  if (!iso) return { label: 'No due date', note: 'Not scheduled', overdue: false };
  const ms = new Date(iso.includes('T') ? iso : `${iso}T12:00:00`).getTime();
  if (Number.isNaN(ms)) return { label: '—', note: '', overdue: false };
  const days = Math.ceil((ms - Date.now()) / DAY_MS);
  const label = fmtDate(iso);
  if (days < 0) return { label, note: `${-days} day${days === -1 ? '' : 's'} overdue`, overdue: true };
  if (days === 0) return { label, note: 'Due today', overdue: false };
  return { label, note: `Due in ${days} day${days === 1 ? '' : 's'}`, overdue: false };
}
const isOverdue = (iso: string | null): boolean => dueParts(iso).overdue;

const TAB_LABEL: Record<CaseTab, string> = {
  overview: 'Overview', tasks: 'Tasks', handoffs: 'Handoffs', blockers: 'Blockers',
  communications: 'Communications', timeline: 'Timeline', audit: 'Audit',
};
const TAB_ICON: Record<CaseTab, LucideName> = {
  overview: 'LayoutGrid', tasks: 'ListChecks', handoffs: 'ArrowRightLeft', blockers: 'TriangleAlert',
  communications: 'Mail', timeline: 'Clock', audit: 'ShieldCheck',
};

/** Cold-path skeleton. Never a fake "0" and never an empty-state that hides a pending load. */
const skeletonLines = (n: number): VNode => (
  <div class="sk-lines" aria-busy="true" aria-live="polite">
    {Array.from({ length: n }, (_, i) => <i key={i} class="skeleton" />)}
  </div>
);

/**
 * A compact "previous → new" for an audit row.
 *
 * `previousState` / `newState` are opaque JSON. Rather than dumping them, name the scalar
 * fields that actually changed. Returns null when nothing comparable is present, so the cell
 * shows an honest em-dash instead of a fabricated summary.
 */
function changeSummary(prev: unknown, next: unknown): string | null {
  const isObj = (v: unknown): v is Record<string, unknown> =>
    !!v && typeof v === 'object' && !Array.isArray(v);
  if (!isObj(prev) || !isObj(next)) return null;
  const scalar = (v: unknown): string | null =>
    v === null || v === undefined ? '—'
      : ['string', 'number', 'boolean'].includes(typeof v) ? String(v)
        : null;
  const parts: string[] = [];
  for (const key of Object.keys(next)) {
    if (parts.length === 2) break;
    const a = scalar(prev[key]), b = scalar(next[key]);
    if (a === null || b === null || a === b) continue;
    parts.push(`${humanize(key)}: ${a} → ${b}`);
  }
  return parts.length ? parts.join(' · ') : null;
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
  const [ownerModalOpen, setOwnerModalOpen] = useState(false);
  const [ownerDraftId, setOwnerDraftId] = useState('');
  // Task reassignment is an FK'd person, so it gets the shared picker in a real dialog —
  // not a bare <select> of every employee wedged into a table cell.
  const [reassignTask, setReassignTask] = useState<OnboardingTaskRow | null>(null);
  const [assigneeDraftId, setAssigneeDraftId] = useState('');
  const [communicationModalOpen, setCommunicationModalOpen] = useState(false);
  const [communicationForm, setCommunicationForm] = useState({
    communicationType: 'employee_welcome' as OnboardingCommunicationType,
    channel: 'email' as OnboardingCommunicationChannel,
  });
  const canManageCase = can('hr.onboarding.case.manage');
  const canManageTasks = can('hr.onboarding.task.manage');
  const setCaseInStore = useOnboardingCaseStore(s => s.setCase);
  const clearCaseInStore = useOnboardingCaseStore(s => s.clear);

  // publish the active case so detached-root tiles read it (@store/onboardingCase)
  useEffect(() => { setCaseInStore(caseRow); }, [caseRow, setCaseInStore]);
  useEffect(() => () => clearCaseInStore(), [clearCaseInStore]);

  // ── data ────────────────────────────────────────────────────────────────────────
  // Every read here is already pinned to THIS case, which the user reached by clicking it in
  // a list they were authorised to see. Sending no scope made the API apply its browse
  // default (`my`), so a case the signed-in user did not personally own opened with all seven
  // tabs empty — on a case that plainly had tasks and blockers. See recordReadScope().
  const scope = useMemo<OnboardingReadScope>(recordReadScope, []);
  const tasksQ    = useOnboardingTasksList({ caseId, scope });
  const handoffsQ = useOnboardingHandoffsList({ caseId, scope });
  const blockersQ = useOnboardingBlockersList({ caseId, scope });
  const actionsQ  = useOnboardingCaseActions(caseId);
  const empsQ     = useHrEmployees({ limit: 500 });
  const tasks = tasksQ.data ?? [];
  const handoffs = handoffsQ.data ?? [];
  const blockers = blockersQ.data ?? [];
  const actions = actionsQ.data ?? [];
  const employees = empsQ.data ?? [];
  const ownerEmployee = employees.find(e => e.id === caseRow.ownerId);
  // The case row carries the employee's number but not their job title; the register row does.
  const caseEmployee = employees.find(e => e.id === caseRow.employeeId);
  // Owner photos come from the employee register, which the page already loads for its pickers.
  const photoById = useMemo(
    () => new Map(employees.map(e => [e.id, e.profile_image_url ?? null])), [employees],
  );
  const photoOf = (id: string | null | undefined): string | null => (id ? photoById.get(id) ?? null : null);

  // ── seven-tab shell ─────────────────────────────────────────────────────────────
  // A drill-through from the Work Queue opens its owning tab; a direct open lands on
  // Overview. Keyed on the drill-through TARGET so arriving at a different record re-targets
  // the tab, while a user's own tab clicks are never overridden.
  const [tab, setTab] = useState<CaseTab>(() => focusTab(focus));
  const focusedRecordId = focusRecordId(focus);
  const focusedEvidenceId = focusEvidenceId(focus);
  // Keyed on the drill-through TARGET, not on `focus` object identity. The parent holds `focus`
  // beside other state, so any parent re-render can hand down an equivalent-but-new object; an
  // identity-keyed effect re-ran on each of those and silently forced the tab back, discarding
  // the user's own selection. Keying on the target means the tab is re-aimed only when a
  // genuinely different record is drilled into.
  const focusKey = focus ? `${focus.sourceType}:${focus.sourceId}:${focus.relatedTaskId ?? ''}` : '';
  const focusTabValue = focusTab(focus);
  const lastAppliedFocusKey = useRef<string | null>(null);
  useEffect(() => {
    if (lastAppliedFocusKey.current === focusKey) return;
    lastAppliedFocusKey.current = focusKey;
    setTab(focusTabValue);
  }, [focusKey, focusTabValue]);

  const showAudit = can('hr.onboarding.audit.view');
  // Audit is ABSENT without the permission, not disabled — and a stale tab selection can
  // never leave the user on a panel they may not read.
  const visibleTabs = useMemo(() => CASE_TABS.filter(t => t !== 'audit' || showAudit), [showAudit]);
  useEffect(() => { if (!visibleTabs.includes(tab)) setTab(DEFAULT_CASE_TAB); }, [visibleTabs, tab]);

  // Fetched only once their tab is opened — seven permanent workspaces must not all load on
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

  // Readiness is DERIVED from the tasks and blockers already loaded (moduleKey + status),
  // exactly as the approved mockup specifies. No second data system, no new endpoint.
  const readiness = useMemo(() => {
    const done = (t: OnboardingTaskRow): boolean => ['completed', 'skipped'].includes(t.status);
    interface Row {
      total: number; done: number; blocking: number; overdue: number; blockedTasks: number;
      openBlockers: number; severity: string | null; owners: Map<string, { name: string; id: string | null; n: number }>;
    }
    const byDomain = new Map<string, Row>();
    const rowFor = (key: string): Row => {
      const existing = byDomain.get(key);
      if (existing) return existing;
      const fresh: Row = {
        total: 0, done: 0, blocking: 0, overdue: 0, blockedTasks: 0,
        openBlockers: 0, severity: null, owners: new Map(),
      };
      byDomain.set(key, fresh);
      return fresh;
    };
    for (const t of tasks) {
      const row = rowFor(t.moduleKey ?? t.ownerRole ?? 'general');
      row.total += 1;
      if (done(t)) row.done += 1;
      if (t.isBlocking && !done(t)) row.blocking += 1;
      if (t.status === 'blocked') row.blockedTasks += 1;
      if (!done(t) && isOverdue(t.dueAt)) row.overdue += 1;
      if (t.assignedToName) {
        const seen = row.owners.get(t.assignedToName)
          ?? { name: t.assignedToName, id: t.assignedTo, n: 0 };
        seen.n += 1;
        row.owners.set(t.assignedToName, seen);
      }
    }
    const RANK: Record<string, number> = { critical: 3, high: 2, medium: 1, low: 0 };
    for (const b of blockers) {
      if (!blockerOpen(b.status)) continue;
      const row = rowFor(b.blockingModule ?? 'general');
      row.openBlockers += 1;
      if (!row.severity || (RANK[b.severity] ?? 0) > (RANK[row.severity] ?? 0)) row.severity = b.severity;
    }
    const total = tasks.length;
    const completed = tasks.filter(done).length;
    const openBlocking = tasks.filter(t => t.isBlocking && !done(t)).length;
    const domains = [...byDomain.entries()].map(([key, v]) => {
      const percent = v.total ? Math.round((v.done / v.total) * 100) : 0;
      const gate = v.openBlockers > 0 || v.blockedTasks > 0 ? 'blocked'
        : v.total > 0 && v.done === v.total ? 'ready'
          : v.overdue > 0 ? 'at_risk'
            : 'in_progress';
      const top = [...v.owners.values()].sort((a, b) => b.n - a.n)[0] ?? null;
      return { key, ...v, percent, gate, owner: top };
    }).sort((a, b) => a.percent - b.percent || a.key.localeCompare(b.key));
    return {
      total, completed, openBlocking, domains,
      percent: total ? Math.round((completed / total) * 100) : 0,
      domainsReady: domains.filter(d => d.gate === 'ready').length,
      domainsAttention: domains.filter(d => d.gate === 'blocked' || d.gate === 'at_risk').length,
    };
  }, [tasks, blockers]);

  // ── mutations ───────────────────────────────────────────────────────────────────
  const pauseMut = useOnboardingPauseCase(), resumeMut = useOnboardingResumeCase(), markReadyMut = useOnboardingMarkReady();
  const completeCaseMut = useOnboardingCompleteCase(), cancelMut = useOnboardingCancelCase(), reassignMut = useOnboardingReassignOwner();
  const provisionMut = useOnboardingProvisionAccount();
  const completeTaskMut = useOnboardingCompleteTask(), reassignTaskMut = useOnboardingReassignTask(), blockTaskMut = useOnboardingBlockTask(), unblockTaskMut = useOnboardingUnblockTask();
  const retryHandoffMut = useOnboardingRetryHandoff(), acceptHandoffMut = useOnboardingAcceptHandoff(), completeHandoffMut = useOnboardingCompleteHandoff(), cancelHandoffMut = useOnboardingCancelHandoff();
  const resolveMut = useOnboardingResolveBlocker(), escalateMut = useOnboardingEscalateBlocker(), waiveMut = useOnboardingWaiveBlocker();
  const notifyBlockerMut = useOnboardingNotifyBlockerOwner();
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
  function openReassignTask(t: OnboardingTaskRow): void { setAssigneeDraftId(t.assignedTo ?? ''); setReassignTask(t); }
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
  /**
   * HR coordinates; the accountable specialist decides. Notifying the owner is the
   * coordination action the design leads with, and it is a real audited mutation
   * (hr/onboarding/blocker/notify-owner) — not a toast.
   */
  async function handleNotifyBlockerOwner(b: OnboardingBlockerRow): Promise<void> {
    const res = await openActionModal({
      title: 'Notify blocker owner', icon: 'fa-bell', tone: 'info',
      record: toActionRecord({ title: b.blockerTitle, subtitle: b.ownerName ?? 'Unassigned', icon: 'fa-ban' }),
      reason: { required: false, label: 'Message to the owner', type: 'textarea', placeholder: 'Optional note to include' },
      whatNext: ['The accountable owner is notified and the reminder is audited.'], confirmLabel: 'Notify',
    });
    if (!res.confirmed) return;
    await run(() => notifyBlockerMut.mutateAsync({ blockerId: b.blockerId, message: res.reason ?? null }), 'Owner notified');
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

  // ── shared panel states ─────────────────────────────────────────────────────────
  // One treatment for loading / empty / error so the three are never confused with one
  // another — an error must never read as "nothing here", and a cold load must never
  // render a fake zero.
  const panelState = (
    q: { isLoading: boolean; isError: boolean; error: unknown }, emptyText: string, len: number, lines = 4,
  ): VNode | null => {
    if (q.isLoading) return skeletonLines(lines);
    if (q.isError) return (
      <div class="ocd-panel-state is-error" role="alert">
        <strong>That could not be loaded.</strong>
        <span>{q.error instanceof Error ? q.error.message : 'Please try again.'}</span>
      </div>
    );
    if (!len) return <div class="ocd-panel-state">{emptyText}</div>;
    return null;
  };

  const Person = ({ name, url, cls }: { name: string | null | undefined; url?: string | null; cls?: string }): VNode =>
    url
      ? <img class={`owner-photo${cls ? ` ${cls}` : ''}`} src={url} alt="" referrerpolicy="no-referrer" />
      : <span class={`avatar${cls ? ` ${cls}` : ''}`} aria-hidden="true">{_initials(name)}</span>;

  // ══ OVERVIEW ════════════════════════════════════════════════════════════════════
  // The approved `work-area`: Priority Tasks + Readiness by Domain in the primary column,
  // Key Blockers in the rail. A fixed composition, not a customizable grid.

  const priorityTasks = useMemo(() => tasks
    .filter(t => isOpen(t.status))
    .sort((a, b) => Number(b.isBlocking) - Number(a.isBlocking) || (a.dueAt ?? '9999').localeCompare(b.dueAt ?? '9999'))
    .slice(0, 5), [tasks]);

  const priorityTasksWidget = (): VNode => {
    const overdue = tasks.filter(t => isOpen(t.status) && isOverdue(t.dueAt)).length;
    return (
      <article class="widget">
        <div class="widget-head">
          <div class="widget-title">
            <span class="widget-title-icon amber"><LucideIcon name="ListChecks" size={18} /></span>
            <div><h2>Priority Tasks</h2><p>Work ordered by readiness impact and due date</p></div>
          </div>
          <div class="priority-head-meta">
            {overdue > 0 && <span class="priority-count">{overdue} overdue</span>}
            <button class="link" type="button" onClick={() => setTab('tasks')}>View all</button>
          </div>
        </div>
        {priorityTasks.length > 0 && (
          <div class="priority-column-head" aria-hidden="true">
            <span /><span>Task</span><span>Owner</span><span>Due</span><span>Action</span>
          </div>
        )}
        {panelState(tasksQ, 'No priority tasks need attention.', priorityTasks.length, 3) ?? (
          <div class="priority-task-list">
            {priorityTasks.map(t => {
              const d = dueParts(t.dueAt);
              const stateTone = t.status === 'blocked' || d.overdue ? 'red' : t.status === 'in_progress' ? '' : 'amber';
              const stateIcon: LucideName = t.status === 'blocked' ? 'Lock' : t.requiresEvidence ? 'FileText' : 'Clock';
              const context = [
                queueLabel(t.moduleKey ?? t.ownerRole),
                t.requiresEvidence ? 'Evidence required before completion' : null,
              ].filter(Boolean).join(' · ');
              return (
                <article class="priority-task" key={t.taskId} data-record-id={t.taskId}>
                  <span class={`priority-state-icon${stateTone ? ` ${stateTone}` : ''}`}>
                    <LucideIcon name={stateIcon} size={17} />
                  </span>
                  <div class="priority-main">
                    <div class="priority-main-top">
                      <strong>{t.taskTitle}</strong>
                      {t.isBlocking
                        ? <span class="status red">Blocks activation</span>
                        : <Status s={t.status} />}
                    </div>
                    <p>{context}</p>
                  </div>
                  <div class="priority-owner">
                    <Person name={t.assignedToName} url={photoOf(t.assignedTo)} />
                    <div class="priority-owner-copy">
                      <strong>{t.assignedToName ?? 'Unassigned'}</strong>
                      <small>{domainLabel(t.moduleKey ?? t.ownerRole)}</small>
                    </div>
                  </div>
                  <div class={d.overdue ? 'priority-due overdue' : 'priority-due'}>
                    <LucideIcon name="CalendarDays" size={16} />{d.label}<span>{d.note}</span>
                  </div>
                  {canManageTasks && isOpen(t.status)
                    ? <button class="btn priority-action primary-lite" type="button" onClick={() => void handleCompleteTask(t)}>Complete</button>
                    : <button class="btn priority-action" type="button" onClick={() => setTab('tasks')}>View</button>}
                </article>
              );
            })}
          </div>
        )}
      </article>
    );
  };

  const readinessMatrixWidget = (): VNode => {
    const domains = readiness.domains;
    const n = domains.length;
    // The ported grid hard-codes six domains (and their edge borders via :nth-child(7n)).
    // Real cases carry whatever domains their package generated, so the track count and the
    // edge cells are computed — see the .ocd-col-end / .ocd-row-end rules in the page layer.
    const gridStyle = { gridTemplateColumns: `132px repeat(${n}, minmax(96px, 1fr))`, minWidth: `${132 + n * 96}px` };
    const GATE: Record<string, { label: string; s: string }> = {
      ready: { label: 'Ready', s: 'completed' }, at_risk: { label: 'At risk', s: 'high' },
      blocked: { label: 'Blocked', s: 'blocked' }, in_progress: { label: 'In progress', s: 'in_progress' },
    };
    const cell = (body: VNode | string, extra: string, last: boolean, bottom: boolean): VNode => (
      <div class={`matrix-cell ${extra}${last ? ' ocd-col-end' : ''}${bottom ? ' ocd-row-end' : ''}`}>{body}</div>
    );
    return (
      <article class="widget">
        <div class="widget-head">
          <div class="widget-title">
            <span class="widget-title-icon green"><LucideIcon name="ShieldCheck" size={18} /></span>
            <div><h2>Readiness by Domain</h2><p>Progress and remaining work across every day-one requirement</p></div>
          </div>
          <button class="link" type="button" onClick={() => setTab('blockers')}>Review blockers</button>
        </div>
        {panelState(tasksQ, 'No tasks yet — readiness is unmeasured.', n, 4) ?? (
          <div class="readiness-matrix-wrap">
            <div class="readiness-matrix" role="table" aria-label="Readiness by domain" style={gridStyle}>
              <div class="matrix-cell matrix-corner" role="columnheader">
                <strong>Requirement</strong><small>Day-one gates</small>
              </div>
              {domains.map((d, i) => (
                <div key={`h-${d.key}`} class={`matrix-cell matrix-domain${i === n - 1 ? ' ocd-col-end' : ''}`} role="columnheader">
                  <span class="matrix-domain-icon"><LucideIcon name={domainIcon(d.key)} size={15} /></span>
                  <strong>{domainLabel(d.key)}</strong>
                </div>
              ))}

              <div class="matrix-cell matrix-row-label" role="rowheader"><strong>Gate status</strong><small>Activation decision</small></div>
              {domains.map((d, i) => {
                const g = GATE[d.gate] ?? GATE.in_progress!;
                return cell(<Status s={g.s} label={g.label} />, 'matrix-value', i === n - 1, false);
              })}

              <div class="matrix-cell matrix-row-label" role="rowheader"><strong>Completion</strong><small>Required work</small></div>
              {domains.map((d, i) => cell(
                <>
                  <strong>{d.percent}%</strong>
                  <span class="matrix-mini-progress"><i style={{ width: `${d.percent}%` }} /></span>
                </>, 'matrix-value', i === n - 1, false,
              ))}

              <div class="matrix-cell matrix-row-label" role="rowheader"><strong>Task coverage</strong><small>Completed / total</small></div>
              {domains.map((d, i) => cell(
                <>
                  <strong>{d.done} / {d.total}</strong>
                  <small>{d.total - d.done === 0 ? 'Complete' : `${d.total - d.done} remaining`}</small>
                </>, 'matrix-value', i === n - 1, false,
              ))}

              <div class="matrix-cell matrix-row-label" role="rowheader"><strong>Open blockers</strong><small>Issues requiring action</small></div>
              {domains.map((d, i) => cell(
                <>
                  <strong class={d.openBlockers ? `ocd-status ${tone(d.severity ?? 'active')}` : undefined}>{d.openBlockers}</strong>
                  <small>{d.openBlockers ? humanize(d.severity ?? 'active') : 'Clear'}</small>
                </>, 'matrix-value', i === n - 1, false,
              ))}

              <div class="matrix-cell matrix-row-label ocd-row-end" role="rowheader"><strong>Accountable owner</strong><small>Responsible team</small></div>
              {domains.map((d, i) => cell(
                <span class="matrix-owner">
                  <Person name={d.owner?.name ?? domainLabel(d.key)} url={photoOf(d.owner?.id)} />
                  <small>{d.owner?.name ?? queueLabel(d.key)}</small>
                </span>, 'matrix-value', i === n - 1, true,
              ))}
            </div>
            <div class="matrix-summary">
              <div class="matrix-summary-copy">
                <span><strong>{readiness.domainsReady} of {n}</strong> domains ready</span>
                {readiness.domainsAttention > 0 && (
                  <span class="attention"><strong>{readiness.domainsAttention}</strong> require follow-up</span>
                )}
                <span><strong>{readiness.percent}%</strong> of all tasks complete</span>
              </div>
            </div>
          </div>
        )}
      </article>
    );
  };

  const keyBlockersWidget = (): VNode => {
    const open = blocked.openBlockers.slice(0, 6);
    return (
      <article class="widget">
        <div class="widget-head">
          <div class="widget-title">
            <span class="widget-title-icon red"><LucideIcon name="TriangleAlert" size={18} /></span>
            <div><h2>Key Blockers</h2><p>Issues preventing readiness</p></div>
          </div>
          <button class="link" type="button" onClick={() => setTab('blockers')}>View all</button>
        </div>
        {panelState(blockersQ, blocked.blockedTasks.length
          ? `No blocker records — ${blocked.blockedTasks.length} blocked task${blocked.blockedTasks.length === 1 ? '' : 's'} on Tasks.`
          : 'Nothing is blocking this case.', open.length, 3) ?? (
          <div class="case-blocker-compact-list">
            {open.map(b => {
              const d = dueParts(b.dueAt);
              const age = d.overdue ? d.note : b.ageDays > 0 ? `Open ${b.ageDays} day${b.ageDays === 1 ? '' : 's'}` : d.note;
              return (
                <button
                  key={b.blockerId} class="case-blocker-compact-item" type="button"
                  data-record-id={b.blockerId} onClick={() => setTab('blockers')}
                >
                  <div class="case-blocker-main">
                    <div class="case-blocker-heading">
                      <strong>{b.blockerTitle}</strong>
                      <Status s={b.severity} />
                    </div>
                    <p>{domainLabel(b.blockingModule)} · {humanize(b.status)}</p>
                  </div>
                  <div class="case-blocker-owner">
                    <Person name={b.ownerName} url={photoOf(b.ownerId)} />
                    <span>{b.ownerName ?? 'Unassigned'}</span>
                  </div>
                  <span class={d.overdue ? 'case-blocker-due' : 'case-blocker-due amber'}>
                    <LucideIcon name="Clock" size={14} />{age}
                  </span>
                </button>
              );
            })}
          </div>
        )}
      </article>
    );
  };

  const overviewWorkspace = (): VNode => (
    <section class="work-area" aria-label="Case overview">
      <div class="case-primary-column">
        {priorityTasksWidget()}
        {readinessMatrixWidget()}
      </div>
      <div class="rail">{keyBlockersWidget()}</div>
    </section>
  );

  // ══ TASKS ═══════════════════════════════════════════════════════════════════════
  // Tasks and case-specific actions are one work list, as the design specifies — an action
  // is labelled as such rather than hidden in a second table. An action already linked to a
  // task is not listed twice.
  interface CaseWorkRow {
    kind: 'task' | 'action';
    id: string; title: string; sub: string; queue: string;
    ownerName: string; ownerId: string | null;
    dueAt: string | null; status: string; evidence: string;
    task: OnboardingTaskRow | null; action: OnboardingCaseAction | null;
  }
  const [taskQuery, setTaskQuery] = useState('');
  const [taskStatusFilter, setTaskStatusFilter] = useState('');
  const [taskOwnerFilter, setTaskOwnerFilter] = useState('');
  const [taskDueFilter, setTaskDueFilter] = useState('');
  const taskFiltersActive = !!(taskQuery || taskStatusFilter || taskOwnerFilter || taskDueFilter);
  function clearTaskFilters(): void {
    setTaskQuery(''); setTaskStatusFilter(''); setTaskOwnerFilter(''); setTaskDueFilter('');
  }

  const workRows = useMemo<CaseWorkRow[]>(() => {
    const linked = new Set(tasks.map(t => t.taskId));
    const taskRows: CaseWorkRow[] = tasks.map(t => ({
      kind: 'task', id: t.taskId, title: t.taskTitle,
      sub: [domainLabel(t.moduleKey ?? t.ownerRole), t.isBlocking ? 'blocks activation' : null].filter(Boolean).join(' · '),
      queue: domainLabel(t.moduleKey ?? t.ownerRole),
      ownerName: t.assignedToName ?? 'Unassigned', ownerId: t.assignedTo,
      dueAt: t.dueAt, status: t.status,
      evidence: t.requiresEvidence ? 'Required' : 'Not required',
      task: t, action: null,
    }));
    const actionRows: CaseWorkRow[] = actions
      .filter(a => !(a.linkedTaskId && linked.has(a.linkedTaskId)))
      .map(a => ({
        kind: 'action', id: a.id, title: a.actionName,
        sub: `${humanize(a.actionType)} · Case-specific action`,
        queue: 'Case action',
        ownerName: a.addedByName ?? 'Unassigned', ownerId: a.addedBy,
        dueAt: null, status: a.status, evidence: 'Not required',
        task: null, action: a,
      }));
    return [...taskRows, ...actionRows];
  }, [tasks, actions]);

  const taskOwnerOptions = useMemo(
    () => [...new Set(workRows.map(r => r.ownerName))].sort((a, b) => a.localeCompare(b)), [workRows],
  );
  const taskStatusOptions = useMemo(
    () => [...new Set(workRows.map(r => r.status))].sort((a, b) => a.localeCompare(b)), [workRows],
  );

  const filteredWorkRows = useMemo(() => {
    const q = taskQuery.trim().toLowerCase();
    return workRows.filter(r => {
      if (q && ![r.title, r.sub, r.ownerName, r.queue].some(v => v.toLowerCase().includes(q))) return false;
      if (taskStatusFilter && r.status !== taskStatusFilter) return false;
      if (taskOwnerFilter && r.ownerName !== taskOwnerFilter) return false;
      if (taskDueFilter === 'overdue' && !(isOpen(r.status) && isOverdue(r.dueAt))) return false;
      if (taskDueFilter === 'today' && dueParts(r.dueAt).note !== 'Due today') return false;
      if (taskDueFilter === 'none' && r.dueAt) return false;
      return true;
    });
  }, [workRows, taskQuery, taskStatusFilter, taskOwnerFilter, taskDueFilter]);

  const taskSummary = useMemo(() => ({
    overdue: workRows.filter(r => isOpen(r.status) && isOverdue(r.dueAt)).length,
    unassigned: workRows.filter(r => isOpen(r.status) && r.ownerName === 'Unassigned').length,
    evidence: workRows.filter(r => isOpen(r.status) && r.evidence === 'Required').length,
    complete: workRows.filter(r => !isOpen(r.status)).length,
  }), [workRows]);

  const ACTION_STATUS_OPTIONS: OnboardingCaseActionStatus[] = ['open', 'in_progress', 'blocked', 'completed', 'cancelled'];

  const tasksWorkspace = (): VNode => (
    <section class="tab-workspace" data-focus-record={focusedRecordId ?? undefined}>
      <div class="workspace-head">
        <div class="workspace-title">
          <span class="workspace-title-icon amber"><LucideIcon name="ListChecks" size={19} /></span>
          <div><h2>Tasks Workspace</h2><p>Own, complete and evidence every task generated for this case.</p></div>
        </div>
        {canManageTasks && (
          <div class="header-actions">
            <button class="btn" type="button" onClick={openAddAction}>Add Case Action</button>
            <button class="btn primary" type="button" onClick={openAddTask}>
              <LucideIcon name="Plus" size={15} />Add Task
            </button>
          </div>
        )}
      </div>

      <div class="toolbar">
        <label class="search">
          <LucideIcon name="Search" size={16} />
          <input
            placeholder="Search tasks, owners or queues" value={taskQuery} aria-label="Search tasks"
            onInput={e => setTaskQuery((e.target as HTMLInputElement).value)}
          />
        </label>
        <select class="filter" aria-label="Filter by status" value={taskStatusFilter}
          onChange={e => setTaskStatusFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All statuses</option>
          {taskStatusOptions.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
        </select>
        <select class="filter" aria-label="Filter by owner" value={taskOwnerFilter}
          onChange={e => setTaskOwnerFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All owners</option>
          {taskOwnerOptions.map(o => <option key={o} value={o}>{o}</option>)}
        </select>
        <select class="filter" aria-label="Filter by due date" value={taskDueFilter}
          onChange={e => setTaskDueFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All due dates</option>
          <option value="overdue">Overdue</option>
          <option value="today">Due today</option>
          <option value="none">No due date</option>
        </select>
        {taskFiltersActive && <button class="btn" type="button" onClick={clearTaskFilters}>Clear</button>}
      </div>

      {focusedEvidenceId && (
        <p class="ocd-focus-note">Opened from an evidence review — the task holding that submission is highlighted.</p>
      )}

      <div class="workspace-grid">
        <div class="workspace-main">
          {panelState(tasksQ, taskFiltersActive ? 'No tasks match these filters.' : 'No tasks for this case.', filteredWorkRows.length) ?? (
            <div class="table-wrap">
              <table>
                <thead>
                  <tr><th>Task</th><th>Owner</th><th>Due</th><th>Evidence</th><th>Status</th><th /></tr>
                </thead>
                <tbody>
                  {filteredWorkRows.map(r => {
                    const d = dueParts(r.dueAt);
                    const t = r.task;
                    const a = r.action;
                    return (
                      <tr key={r.id} data-record-id={r.id} class={focusedRecordId === r.id ? 'ocd-focused' : undefined}>
                        <td><strong>{r.title}</strong><small>{r.sub}</small></td>
                        <td>{r.ownerName}</td>
                        <td class={d.overdue ? 'ocd-status red' : undefined}>
                          {r.dueAt ? <>{d.label}<small>{d.note}</small></> : '—'}
                        </td>
                        <td>{r.evidence}</td>
                        <td>
                          {a && canManageTasks && isOpen(a.status) ? (
                            <select
                              class="filter" value={a.status} aria-label={`Status for ${a.actionName}`}
                              onChange={e => void handleUpdateActionStatus(a, (e.target as HTMLSelectElement).value as OnboardingCaseActionStatus)}
                            >
                              {ACTION_STATUS_OPTIONS.map(s => <option key={s} value={s}>{humanize(s)}</option>)}
                            </select>
                          ) : <Status s={r.status} />}
                        </td>
                        <td>
                          <div class="row-actions">
                            {t && canManageTasks && <>
                              {isOpen(t.status) && <button class="btn" type="button" onClick={() => void handleCompleteTask(t)}>Complete</button>}
                              {t.status === 'blocked'
                                ? <button class="btn" type="button" onClick={() => void handleUnblockTask(t)}>Unblock</button>
                                : isOpen(t.status) && <button class="btn" type="button" onClick={() => void handleBlockTask(t)}>Block</button>}
                              {isOpen(t.status) && <button class="btn" type="button" onClick={() => openReassignTask(t)}>Reassign</button>}
                            </>}
                            {a && canManageTasks && isOpen(a.status) && <>
                              <button class="btn" type="button" onClick={() => void handleCompleteAction(a)}>Complete</button>
                              <button class="btn" type="button" onClick={() => void handleCancelAction(a)}>Cancel</button>
                            </>}
                          </div>
                        </td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          )}
        </div>

        <aside class="workspace-rail">
          <div class="detail-card">
            <h3>Task Summary</h3>
            <div class="detail-list">
              <div class="detail-row">
                <span class="detail-icon"><LucideIcon name="Clock" size={17} /></span>
                <div><strong>{taskSummary.overdue} overdue</strong><small>Past their due date and still open</small></div>
                {taskSummary.overdue > 0 && <span class="status red">Action</span>}
              </div>
              <div class="detail-row">
                <span class="detail-icon"><LucideIcon name="Users" size={17} /></span>
                <div><strong>{taskSummary.unassigned} unassigned</strong><small>Open work with no accountable person</small></div>
                {taskSummary.unassigned > 0 && <span class="status amber">Route</span>}
              </div>
              <div class="detail-row">
                <span class="detail-icon"><LucideIcon name="FileText" size={17} /></span>
                <div><strong>{taskSummary.evidence} need evidence</strong><small>Cannot complete without a submission</small></div>
              </div>
              <div class="detail-row">
                <span class="detail-icon"><LucideIcon name="Check" size={17} /></span>
                <div><strong>{taskSummary.complete} complete</strong><small>{readiness.percent}% package progress</small></div>
              </div>
            </div>
          </div>
          <div class="info-banner">
            <LucideIcon name="ShieldCheck" size={18} />
            <span>Every completion, block and reassignment is written to the case audit trail and notifies the accountable owner.</span>
          </div>
        </aside>
      </div>
    </section>
  );

  // ══ HANDOFFS ════════════════════════════════════════════════════════════════════
  const [handoffFilter, setHandoffFilter] = useState('');
  const handoffStats = useMemo(() => ({
    required: handoffs.length,
    completed: handoffs.filter(h => ['completed', 'delivered'].includes(h.status)).length,
    inProgress: handoffs.filter(h => ['accepted', 'sent'].includes(h.status)).length,
    awaiting: handoffs.filter(h => h.status === 'pending').length,
  }), [handoffs]);
  const filteredHandoffs = useMemo(() => handoffs.filter(h => {
    if (!handoffFilter) return true;
    if (handoffFilter === 'awaiting') return h.status === 'pending';
    if (handoffFilter === 'in_progress') return ['accepted', 'sent'].includes(h.status);
    if (handoffFilter === 'blocked') return ['blocked', 'failed'].includes(h.status);
    if (handoffFilter === 'completed') return ['completed', 'delivered'].includes(h.status);
    return true;
  }), [handoffs, handoffFilter]);

  const handoffsWorkspace = (): VNode => (
    <section class="tab-workspace" data-focus-record={focusedRecordId ?? undefined}>
      <div class="workspace-head">
        <div class="workspace-title">
          <span class="workspace-title-icon"><LucideIcon name="ArrowRightLeft" size={19} /></span>
          <div>
            <h2>Cross-Team Handoffs</h2>
            <p>Monitor ownership, expected outcomes and deadlines without taking over specialist approval.</p>
          </div>
        </div>
        <select class="filter" aria-label="Filter handoffs" value={handoffFilter}
          onChange={e => setHandoffFilter((e.target as HTMLSelectElement).value)}>
          <option value="">All handoff states</option>
          <option value="awaiting">Awaiting acceptance</option>
          <option value="in_progress">In progress</option>
          <option value="blocked">Blocked</option>
          <option value="completed">Completed</option>
        </select>
      </div>

      {!handoffsQ.isLoading && !handoffsQ.isError && handoffs.length > 0 && (
        <div class="handoff-summary" aria-label="Handoff summary">
          <div class="handoff-kpi"><span>Required</span><strong>{handoffStats.required}</strong></div>
          <div class="handoff-kpi"><span>Completed</span><strong class="ocd-status green">{handoffStats.completed}</strong></div>
          <div class="handoff-kpi"><span>In progress</span><strong class="ocd-status blue">{handoffStats.inProgress}</strong></div>
          <div class="handoff-kpi"><span>Awaiting acceptance</span><strong class="ocd-status amber">{handoffStats.awaiting}</strong></div>
        </div>
      )}

      <div class="handoff-authority">
        <LucideIcon name="ShieldCheck" size={18} />
        <span>
          <strong>HR coordinates the case.</strong> The receiving specialist performs the work and approves its
          evidence. HR only completes a specialist handoff when the organisation has explicitly assigned that authority.
        </span>
      </div>

      {panelState(handoffsQ, handoffFilter ? 'No handoffs match this filter.' : 'No handoffs on this case.', filteredHandoffs.length) ?? (
        <div class="handoff-work-list ocd-work-list">
          {filteredHandoffs.map(h => {
            const d = dueParts(h.dueAt);
            const done = ['completed', 'delivered'].includes(h.status);
            const iconTone = done ? 'green' : ['failed', 'blocked'].includes(h.status) ? 'red' : h.status === 'pending' ? 'amber' : '';
            return (
              <article
                key={h.handoffId} class={`handoff-work-item${focusedRecordId === h.handoffId ? ' ocd-focused' : ''}`}
                data-record-id={h.handoffId}
              >
                <span class={`detail-icon${iconTone ? ` ${iconTone}` : ''}`}>
                  <LucideIcon name={done ? 'Check' : 'ArrowRightLeft'} size={17} />
                </span>
                <div class="handoff-work-copy">
                  <strong>{queueLabel(h.targetModule)}</strong>
                  <small>{humanize(h.handoffType ?? 'handoff')}{h.failureReason ? ` · ${h.failureReason}` : ''}</small>
                </div>
                <div class="handoff-work-meta">
                  <span>Accountable owner</span>
                  <strong>{h.ownerName ?? 'Unassigned'}</strong>
                </div>
                <div class="handoff-work-meta">
                  <span>{done ? 'Completed' : 'Due'}</span>
                  <strong>{done ? fmtDateTime(h.lastEventAt) : `${d.label} · ${d.note}`}</strong>
                </div>
                <div class="row-actions">
                  <Status s={h.status} />
                  {canManageCase && <>
                    {h.status === 'failed' && <button class="btn" type="button" onClick={() => void handleRetryHandoff(h)}>Retry</button>}
                    {['pending', 'sent'].includes(h.status) && <button class="btn" type="button" onClick={() => void handleAcceptHandoff(h)}>Accept</button>}
                    {['accepted', 'delivered', 'blocked'].includes(h.status) && <button class="btn" type="button" onClick={() => void handleCompleteHandoff(h)}>Complete</button>}
                    {!['completed', 'cancelled'].includes(h.status) && <button class="btn" type="button" onClick={() => void handleCancelHandoff(h)}>Cancel</button>}
                  </>}
                  {done && <button class="btn" type="button" onClick={() => setTab('timeline')}>History</button>}
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  // ══ BLOCKERS ════════════════════════════════════════════════════════════════════
  const [blockerSeverityFilter, setBlockerSeverityFilter] = useState('');
  const [blockerOwnerFilter, setBlockerOwnerFilter] = useState('');
  const blockerFiltersActive = !!(blockerSeverityFilter || blockerOwnerFilter);
  const blockerOwnerOptions = useMemo(
    () => [...new Set(blockers.map(b => domainLabel(b.blockingModule)))].sort((a, b) => a.localeCompare(b)), [blockers],
  );
  const blockerStats = useMemo(() => ({
    open: blocked.openBlockers.length,
    overdue: blocked.openBlockers.filter(b => isOverdue(b.dueAt)).length,
    escalated: blocked.openBlockers.filter(b => b.status === 'escalated').length,
    domains: new Set(blocked.openBlockers.map(b => b.blockingModule ?? 'general')).size,
  }), [blocked.openBlockers]);
  const filteredBlockers = useMemo(() => blockers.filter(b => {
    if (blockerSeverityFilter && b.severity !== blockerSeverityFilter) return false;
    if (blockerOwnerFilter && domainLabel(b.blockingModule) !== blockerOwnerFilter) return false;
    return true;
  }), [blockers, blockerSeverityFilter, blockerOwnerFilter]);

  const blockersWorkspace = (): VNode => (
    <section class="tab-workspace" data-focus-record={focusedRecordId ?? undefined}>
      <div class="workspace-head">
        <div class="workspace-title">
          <span class="workspace-title-icon red"><LucideIcon name="TriangleAlert" size={19} /></span>
          <div>
            <h2>Readiness Blockers</h2>
            <p>Coordinate the accountable owner, evidence and next action for every issue preventing activation.</p>
          </div>
        </div>
        <div class="header-actions">
          <select class="filter" aria-label="Filter blocker severity" value={blockerSeverityFilter}
            onChange={e => setBlockerSeverityFilter((e.target as HTMLSelectElement).value)}>
            <option value="">All severities</option>
            {(['critical', 'high', 'medium', 'low']).map(s => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          <select class="filter" aria-label="Filter blocker owner" value={blockerOwnerFilter}
            onChange={e => setBlockerOwnerFilter((e.target as HTMLSelectElement).value)}>
            <option value="">All owning teams</option>
            {blockerOwnerOptions.map(o => <option key={o} value={o}>{o}</option>)}
          </select>
          {blockerFiltersActive && (
            <button class="btn" type="button" onClick={() => { setBlockerSeverityFilter(''); setBlockerOwnerFilter(''); }}>Clear</button>
          )}
        </div>
      </div>

      {!blockersQ.isLoading && !blockersQ.isError && blockers.length > 0 && (
        <div class="blocker-summary" aria-label="Blocker summary">
          <div class="blocker-kpi">
            <span class="blocker-kpi-icon"><LucideIcon name="TriangleAlert" size={17} /></span>
            <div><span>Open blockers</span><strong>{blockerStats.open}</strong></div>
          </div>
          <div class="blocker-kpi">
            <span class="blocker-kpi-icon"><LucideIcon name="Clock" size={17} /></span>
            <div><span>Overdue</span><strong>{blockerStats.overdue}</strong></div>
          </div>
          <div class="blocker-kpi">
            <span class="blocker-kpi-icon amber"><LucideIcon name="Bell" size={17} /></span>
            <div><span>Escalated</span><strong>{blockerStats.escalated}</strong></div>
          </div>
          <div class="blocker-kpi">
            <span class="blocker-kpi-icon blue"><LucideIcon name="ShieldCheck" size={17} /></span>
            <div><span>Domains affected</span><strong>{blockerStats.domains} of {readiness.domains.length}</strong></div>
          </div>
        </div>
      )}

      {/* A case can be Blocked because a TASK is blocked, with no blocker record at all.
          Saying "No blockers" there is the contradiction this reconciles. */}
      {!blocked.openBlockers.length && blocked.blockedTasks.length > 0 && (
        <div class="info-banner">
          <LucideIcon name="Info" size={18} />
          <span>
            No blocker records — this case is blocked by {blocked.blockedTasks.length} blocked
            task{blocked.blockedTasks.length === 1 ? '' : 's'} on the Tasks tab.
          </span>
        </div>
      )}

      <div class="handoff-authority">
        <LucideIcon name="ShieldCheck" size={18} />
        <span>
          <strong>HR owns coordination, not every decision.</strong> HR follows up, tracks deadlines and escalates.
          The accountable specialist records the approval that clears its blocker.
        </span>
      </div>

      {panelState(blockersQ, blockerFiltersActive ? 'No blockers match these filters.' : 'No blockers on this case.', filteredBlockers.length) ?? (
        <div class="blocker-work-list ocd-work-list">
          {filteredBlockers.map(b => {
            const d = dueParts(b.dueAt);
            const open = blockerOpen(b.status);
            return (
              <article
                key={b.blockerId} data-record-id={b.blockerId}
                class={`blocker-work-item${b.severity === 'high' ? ' high' : ''}${focusedRecordId === b.blockerId ? ' ocd-focused' : ''}`}
              >
                <div class="blocker-work-head">
                  <div class="blocker-owner">
                    <Person name={b.ownerName} url={photoOf(b.ownerId)} />
                    <div class="blocker-owner-copy">
                      <span>Accountable owner</span>
                      <strong>{b.ownerName ?? 'Unassigned'}</strong>
                      <small>{domainLabel(b.blockingModule)} · Specialist approval</small>
                    </div>
                  </div>
                  <Status s={b.status} label={`${humanize(b.severity)} · ${humanize(b.status)}`} />
                </div>
                <div class="blocker-work-body">
                  <div class="blocker-work-title">
                    <h3>{b.blockerTitle}</h3>
                    <p>{domainLabel(b.blockingModule)} approval is required before this case can be activated.</p>
                  </div>
                  <div class="blocker-work-grid">
                    <div class="blocker-work-fact">
                      <span>Due / age</span>
                      <strong class={d.overdue ? 'ocd-status red' : undefined}>
                        {b.dueAt ? `${d.label} · ${d.note}` : `Open ${b.ageDays} day${b.ageDays === 1 ? '' : 's'}`}
                      </strong>
                    </div>
                    <div class="blocker-work-fact">
                      <span>Linked work</span>
                      <strong>{b.taskId ? 'Linked to a task' : b.handoffId ? 'Linked to a handoff' : 'Case-level'}</strong>
                    </div>
                    <div class="blocker-work-fact">
                      <span>Readiness impact</span>
                      <strong>{domainLabel(b.blockingModule)} · {open ? 'blocks activation' : humanize(b.status)}</strong>
                    </div>
                  </div>
                </div>
                <div class="blocker-work-foot">
                  <span class={b.severity === 'critical' ? 'blocker-impact' : 'blocker-impact amber'}>
                    <LucideIcon name={open ? 'Lock' : 'Check'} size={13} />
                    {open ? 'Activation blocked until specialist approval' : `Closed — ${humanize(b.status)}`}
                  </span>
                  <div class="blocker-work-actions">
                    {canManageCase && open && <>
                      <button class="btn" type="button" onClick={() => void handleNotifyBlockerOwner(b)}>Notify owner</button>
                      <button class="btn" type="button" onClick={() => void handleEscalate(b)}>Escalate</button>
                      <button class="btn" type="button" onClick={() => void handleWaive(b)}>Waive</button>
                      <button class="btn primary" type="button" onClick={() => void handleResolve(b)}>Resolve</button>
                    </>}
                    {!open && <button class="btn" type="button" onClick={() => setTab('timeline')}>History</button>}
                  </div>
                </div>
              </article>
            );
          })}
        </div>
      )}
    </section>
  );

  // ══ COMMUNICATIONS ══════════════════════════════════════════════════════════════
  const [commQuery, setCommQuery] = useState('');
  const [commStatusFilter, setCommStatusFilter] = useState('');
  const [commChannelFilter, setCommChannelFilter] = useState('');
  const commFiltersActive = !!(commQuery || commStatusFilter || commChannelFilter);

  const communicationsWorkspace = (): VNode => {
    const all = commsQ.data ?? [];
    const q = commQuery.trim().toLowerCase();
    const rows = all.filter(c => {
      if (commStatusFilter && c.status !== commStatusFilter) return false;
      if (commChannelFilter && c.channel !== commChannelFilter) return false;
      if (q) {
        const hay = [c.subject, c.recipientName, c.recipientEmail, humanize(c.communicationType)]
          .filter(Boolean).join(' ').toLowerCase();
        if (!hay.includes(q)) return false;
      }
      return true;
    });
    const health = {
      sent: all.filter(c => c.status === 'sent').length,
      failed: all.filter(c => c.status === 'failed').length,
      pending: all.filter(c => ['queued', 'draft'].includes(c.status)).length,
    };
    const participants = [
      caseRow.employeeName ? { name: caseRow.employeeName, role: 'Worker', url: caseRow.employeePhotoUrl } : null,
      caseRow.ownerName ? { name: caseRow.ownerName, role: 'Case owner', url: ownerEmployee?.profile_image_url ?? null } : null,
      ...[...new Map(all.filter(c => c.recipientName).map(c => [c.recipientName!, c])).values()]
        .map(c => ({ name: c.recipientName!, role: 'Recipient', url: photoOf(c.recipientUserId) })),
    ].filter(Boolean).slice(0, 6) as { name: string; role: string; url: string | null }[];

    return (
      <section class="tab-workspace">
        <div class="workspace-head">
          <div class="workspace-title">
            <span class="workspace-title-icon"><LucideIcon name="Mail" size={19} /></span>
            <div>
              <h2>Case Communications</h2>
              <p>Messages sent to the worker and participating teams, retained with the case.</p>
            </div>
          </div>
          {canManageCase && (
            <button class="btn primary" type="button" onClick={() => setCommunicationModalOpen(true)}>
              <LucideIcon name="Plus" size={15} />New Message
            </button>
          )}
        </div>

        <div class="toolbar">
          <label class="search">
            <LucideIcon name="Search" size={16} />
            <input
              placeholder="Search subject, recipient or message type" value={commQuery}
              aria-label="Search communications"
              onInput={e => setCommQuery((e.target as HTMLInputElement).value)}
            />
          </label>
          <select class="filter" aria-label="Filter by delivery state" value={commStatusFilter}
            onChange={e => setCommStatusFilter((e.target as HTMLSelectElement).value)}>
            <option value="">All delivery states</option>
            {(['sent', 'queued', 'failed', 'draft', 'cancelled']).map(s => <option key={s} value={s}>{humanize(s)}</option>)}
          </select>
          <select class="filter" aria-label="Filter by channel" value={commChannelFilter}
            onChange={e => setCommChannelFilter((e.target as HTMLSelectElement).value)}>
            <option value="">All channels</option>
            {(['email', 'in_app', 'sms', 'manual']).map(c => <option key={c} value={c}>{humanize(c)}</option>)}
          </select>
          {commFiltersActive && (
            <button class="btn" type="button" onClick={() => { setCommQuery(''); setCommStatusFilter(''); setCommChannelFilter(''); }}>Clear</button>
          )}
        </div>

        <div class="workspace-grid">
          <div class="workspace-main">
            {panelState(commsQ, commFiltersActive ? 'No messages match these filters.' : 'No communications sent for this case yet.', rows.length) ?? (
              rows.map(c => (
                <article class="thread" key={c.id} data-record-id={c.id}>
                  <div class="thread-head">
                    <div>
                      <strong>{c.subject ?? humanize(c.communicationType)}</strong>
                      <small>To {c.recipientName ?? c.recipientEmail ?? 'an unresolved recipient'} · {humanize(c.channel)}</small>
                    </div>
                    <Status s={c.status} />
                  </div>
                  {c.body && <div class="thread-preview">{c.body}</div>}
                  {c.failureReason && <div class="thread-preview ocd-status red">{c.failureReason}</div>}
                  <div class="meta-row">
                    <span>{c.sentByName ? `Sent by ${c.sentByName}` : 'Queued by the system'}</span>
                    <span>{c.sentAt ? fmtDateTime(c.sentAt) : fmtDateTime(c.createdAt)}</span>
                  </div>
                  {canManageCase && c.status === 'failed' && (
                    <div class="inline-actions">
                      <button class="btn" type="button"
                        onClick={() => void run(() => resendCommunicationMut.mutateAsync({ id: c.id }), 'Communication queued again')}>
                        Resend
                      </button>
                    </div>
                  )}
                </article>
              ))
            )}
          </div>

          <aside class="workspace-rail">
            <div class="detail-card">
              <h3>Delivery Health</h3>
              <div class="detail-list">
                <div class="detail-row">
                  <span class="detail-icon"><LucideIcon name="Check" size={17} /></span>
                  <div><strong>{health.sent} delivered</strong><small>Accepted by the channel</small></div>
                  {health.sent > 0 && <span class="status green">Healthy</span>}
                </div>
                <div class="detail-row">
                  <span class="detail-icon"><LucideIcon name="TriangleAlert" size={17} /></span>
                  <div><strong>{health.failed} failed</strong><small>Needs a resend or a corrected address</small></div>
                  {health.failed > 0 && <span class="status red">Action</span>}
                </div>
                <div class="detail-row">
                  <span class="detail-icon"><LucideIcon name="Clock" size={17} /></span>
                  <div><strong>{health.pending} pending</strong><small>Queued for delivery</small></div>
                </div>
              </div>
            </div>
            <div class="detail-card">
              <h3>Participants</h3>
              <div class="detail-list">
                {participants.map(p => (
                  <div class="detail-row" key={`${p.role}-${p.name}`}>
                    <Person name={p.name} url={p.url} />
                    <div><strong>{p.name}</strong><small>{p.role}</small></div>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </section>
    );
  };

  // ══ TIMELINE ════════════════════════════════════════════════════════════════════
  const [timelineTypeFilter, setTimelineTypeFilter] = useState('');
  const [timelineRangeFilter, setTimelineRangeFilter] = useState('');

  const timelineWorkspace = (): VNode => {
    const all = timelineQ.data ?? [];
    const cutoff = timelineRangeFilter === 'today' ? Date.now() - DAY_MS
      : timelineRangeFilter === '7' ? Date.now() - 7 * DAY_MS
        : timelineRangeFilter === '30' ? Date.now() - 30 * DAY_MS
          : null;
    const rows = all.filter(e => {
      if (timelineTypeFilter && e.item_type !== timelineTypeFilter) return false;
      if (cutoff !== null && new Date(e.created_at).getTime() < cutoff) return false;
      return true;
    });
    const active = !!(timelineTypeFilter || timelineRangeFilter);
    /** Which tab owns an event, so "open the related record" is a real navigation. */
    const jump: Record<string, CaseTab | null> = {
      handoff: 'handoffs', message: 'communications', audit: 'audit', ticket: null, workflow: null, event: null,
    };
    return (
      <section class="tab-workspace">
        <div class="workspace-head">
          <div class="workspace-title">
            <span class="workspace-title-icon green"><LucideIcon name="Clock" size={19} /></span>
            <div>
              <h2>Case Timeline</h2>
              <p>A single chronological record across case, task, handoff and communication events.</p>
            </div>
          </div>
          <div class="header-actions">
            <select class="filter" aria-label="Filter activity type" value={timelineTypeFilter}
              onChange={e => setTimelineTypeFilter((e.target as HTMLSelectElement).value)}>
              <option value="">All activity</option>
              {(['event', 'handoff', 'message', 'workflow', 'ticket', 'audit']).map(t => (
                <option key={t} value={t}>{humanize(t)}</option>
              ))}
            </select>
            <select class="filter" aria-label="Filter date range" value={timelineRangeFilter}
              onChange={e => setTimelineRangeFilter((e.target as HTMLSelectElement).value)}>
              <option value="">All dates</option>
              <option value="today">Last 24 hours</option>
              <option value="7">Last 7 days</option>
              <option value="30">Last 30 days</option>
            </select>
            {active && (
              <button class="btn" type="button" onClick={() => { setTimelineTypeFilter(''); setTimelineRangeFilter(''); }}>Clear</button>
            )}
          </div>
        </div>

        {panelState(timelineQ, active ? 'No activity matches these filters.' : 'Nothing has happened on this case yet.', rows.length) ?? (
          <div class="timeline-full">
            {rows.map(e => {
              const target = jump[e.item_type] ?? null;
              return (
                <div class="timeline-event" key={e.id} data-record-id={e.id}>
                  <strong>{e.title}</strong>
                  <p>
                    {[e.actor_name, fmtDateTime(e.created_at), e.description].filter(Boolean).join(' · ')}
                  </p>
                  {target && visibleTabs.includes(target) && (
                    <button class="link" type="button" onClick={() => setTab(target)}>
                      Open {TAB_LABEL[target].toLowerCase()}
                    </button>
                  )}
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  // ══ AUDIT ═══════════════════════════════════════════════════════════════════════
  const [auditAreaFilter, setAuditAreaFilter] = useState('');
  const [auditRangeFilter, setAuditRangeFilter] = useState('');

  const auditWorkspace = (): VNode => {
    const all = auditQ.data ?? [];
    /** `hr.onboarding.task.complete` → `task`. The area is what a reader filters by. */
    const areaOf = (action: string): string =>
      action.replace(/^hr\.onboarding\./, '').split('.')[0] ?? 'case';
    const areas = [...new Set(all.map(a => areaOf(a.action)))].sort((a, b) => a.localeCompare(b));
    const cutoff = auditRangeFilter === '30' ? Date.now() - 30 * DAY_MS
      : auditRangeFilter === '90' ? Date.now() - 90 * DAY_MS
        : null;
    const rows = all.filter(a => {
      if (auditAreaFilter && areaOf(a.action) !== auditAreaFilter) return false;
      if (cutoff !== null && new Date(a.createdAt).getTime() < cutoff) return false;
      return true;
    });
    const active = !!(auditAreaFilter || auditRangeFilter);
    return (
      <section class="tab-workspace">
        <div class="workspace-head">
          <div class="workspace-title">
            <span class="workspace-title-icon"><LucideIcon name="ShieldCheck" size={19} /></span>
            <div>
              <h2>Audit History</h2>
              <p>Governed changes, actors and reasons for this onboarding case.</p>
            </div>
          </div>
          <div class="header-actions">
            <select class="filter" aria-label="Filter audit area" value={auditAreaFilter}
              onChange={e => setAuditAreaFilter((e.target as HTMLSelectElement).value)}>
              <option value="">All areas</option>
              {areas.map(a => <option key={a} value={a}>{humanize(a)}</option>)}
            </select>
            <select class="filter" aria-label="Filter audit date range" value={auditRangeFilter}
              onChange={e => setAuditRangeFilter((e.target as HTMLSelectElement).value)}>
              <option value="">All dates</option>
              <option value="30">Last 30 days</option>
              <option value="90">Last 90 days</option>
            </select>
            {active && (
              <button class="btn" type="button" onClick={() => { setAuditAreaFilter(''); setAuditRangeFilter(''); }}>Clear</button>
            )}
          </div>
        </div>

        {panelState(auditQ, active ? 'No audited changes match these filters.' : 'No audited changes on this case.', rows.length) ?? (
          <div>
            {rows.map(a => {
              const change = changeSummary(a.previousState, a.newState);
              return (
                <div class="audit-change" key={a.id} data-record-id={a.id}>
                  <div><span>{fmtDateTime(a.createdAt)}</span><strong>{a.actorName ?? a.actorId ?? 'System'}</strong></div>
                  <div><span>Action</span><strong>{humanize(a.action.replace(/^hr\.onboarding\./, ''))}</strong></div>
                  <div><span>Reason</span><strong>{a.reason ?? '—'}</strong></div>
                  <div><span>Change</span><strong>{change ?? '—'}</strong></div>
                </div>
              );
            })}
          </div>
        )}
      </section>
    );
  };

  // ── dialogs ─────────────────────────────────────────────────────────────────────
  // Owner reassignment sits in the mockup's More popover + a real dialog. An owner is an
  // FK'd person, so it uses the shared person picker rather than a free-text/opaque list
  // (Feature Completeness: pickers, not free text).
  const personOptions = employees.map(e => ({
    id: e.id,
    name: rowName(e),
    subtitle: [e.employee_number, e.position].filter(Boolean).join(' · ') || null,
    photoUrl: e.profile_image_url,
  }));

  const ownerDialog = (
    <Modal
      open={ownerModalOpen}
      title="Reassign case owner"
      onClose={() => setOwnerModalOpen(false)}
      footer={<>
        <button class="btn" type="button" onClick={() => setOwnerModalOpen(false)}>Cancel</button>
        <button class="btn primary" type="button"
          disabled={!ownerDraftId || ownerDraftId === (caseRow.ownerId ?? '')}
          onClick={() => { void handleReassignOwner(ownerDraftId); setOwnerModalOpen(false); }}
        >Reassign</button>
      </>}
    >
      <FormGrid>
        <Field label="New case owner">
          <PersonSearchSelect
            options={personOptions} value={ownerDraftId} onChange={setOwnerDraftId}
            placeholder="Search by name or employee number…" emptyLabel="No employees found"
          />
        </Field>
      </FormGrid>
    </Modal>
  );

  const reassignTaskDialog = (
    <Modal
      open={!!reassignTask}
      title="Reassign task"
      onClose={() => setReassignTask(null)}
      footer={<>
        <button class="btn" type="button" onClick={() => setReassignTask(null)}>Cancel</button>
        <button class="btn primary" type="button"
          disabled={!reassignTask || assigneeDraftId === (reassignTask.assignedTo ?? '')}
          onClick={() => {
            if (reassignTask) void handleReassignTask(reassignTask, assigneeDraftId);
            setReassignTask(null);
          }}
        >Reassign</button>
      </>}
    >
      <FormGrid>
        <Field label={`Accountable person for “${reassignTask?.taskTitle ?? ''}”`}>
          <PersonSearchSelect
            options={personOptions} value={assigneeDraftId} onChange={setAssigneeDraftId}
            placeholder="Search by name or employee number…" emptyLabel="No employees found"
          />
        </Field>
      </FormGrid>
      <p class="ocd-form-note">
        Routing stays with {queueLabel(reassignTask?.moduleKey ?? reassignTask?.ownerRole)} — this changes
        only who is personally accountable. Clear the selection to leave the task unassigned.
      </p>
    </Modal>
  );

  // ── render — the approved case header, profile strip, seven tabs and their workspaces ──
  // Ported from docs/mockups/onboarding-case-detail-implementation-ready.html.
  //
  // NOTE: the ported stylesheet carries `[data-tab-panel]{display:none}` from the mockup's own
  // JS tab switcher. Panels here are rendered conditionally, so that attribute is deliberately
  // NOT emitted — adding it would hide every workspace.
  return (
    <div class="hr-onboarding-case ocd-root">
      <div class="breadcrumb">
        <a href="#" onClick={e => { e.preventDefault(); onBack(); }}>Onboarding Command Centre</a>
        <span>›</span><span>{caseRow.caseNo}</span>
      </div>

      <header class="case-header">
        <div class="header-top">
          <div class="case-title">
            <h1>{caseRow.caseNo}</h1>
            <span class={`status ${tone(caseRow.status)}`}>{humanize(caseRow.status)}</span>
          </div>
          <div class="header-actions">
            {caseRow.employeeId && (
              <button class="btn" type="button" onClick={() => openHrEmployeeRecord(caseRow.employeeId!, 'overview')}>
                <LucideIcon name="IdCard" size={15} />View Employee Record
              </button>
            )}
            <details class="case-more-menu">
              <summary class="btn"><LucideIcon name="Ellipsis" size={15} />More</summary>
              <div class="case-more-popover">
                {canManageCase && <>
                  <button type="button" onClick={() => { setOwnerDraftId(caseRow.ownerId ?? ''); setOwnerModalOpen(true); }}>
                    <LucideIcon name="Users" size={15} />
                    <span><strong>Reassign owner</strong><small>Change case accountability.</small></span>
                  </button>
                  {caseRow.status === 'in_progress' && (
                    <button type="button" onClick={() => void handlePause()}>
                      <LucideIcon name="Clock" size={15} />
                      <span><strong>Pause case</strong><small>Temporarily stop progression.</small></span>
                    </button>
                  )}
                  {caseRow.status === 'paused' && (
                    <button type="button" onClick={() => void handleResume()}>
                      <LucideIcon name="Play" size={15} />
                      <span><strong>Resume case</strong><small>Continue progression.</small></span>
                    </button>
                  )}
                  {caseRow.employeeId && (
                    <button type="button" onClick={() => void handleProvision()}>
                      <LucideIcon name="KeyRound" size={15} />
                      <span><strong>Provision account</strong><small>Create system access.</small></span>
                    </button>
                  )}
                  {!['completed', 'cancelled'].includes(caseRow.status) && (
                    <button class="danger" type="button" onClick={() => void handleCancel()}>
                      <LucideIcon name="TriangleAlert" size={15} />
                      <span><strong>Cancel case</strong><small>Close with a mandatory reason.</small></span>
                    </button>
                  )}
                </>}
                {!canManageCase && (
                  <button type="button" disabled>
                    <LucideIcon name="Lock" size={15} />
                    <span><strong>No case actions</strong><small>You have read access to this case.</small></span>
                  </button>
                )}
              </div>
            </details>
            {canManageCase && (caseRow.status === 'in_progress' || caseRow.status === 'paused') && (
              <button class="btn primary" type="button" onClick={() => void handleMarkReady()}>
                <LucideIcon name="Check" size={15} />Review Readiness
              </button>
            )}
            {canManageCase && caseRow.status === 'ready_for_activation' && (
              <button class="btn primary" type="button" onClick={() => void handleComplete()}>
                <LucideIcon name="Check" size={15} />Complete Onboarding
              </button>
            )}
          </div>
        </div>

        {/* ── approved profile strip: one navy identity cell + four white fact cells ── */}
        <section class="case-profile-strip" aria-label="Onboarding case profile">
          <button class="case-profile-cell case-person" type="button"
            disabled={!caseRow.employeeId}
            onClick={() => caseRow.employeeId && openHrEmployeeRecord(caseRow.employeeId, 'overview')}>
            {caseRow.employeePhotoUrl
              ? <img class="avatar" src={caseRow.employeePhotoUrl} alt="" />
              : <span class="avatar" aria-hidden="true">{_initials(caseRow.employeeName)}</span>}
            <span class="case-profile-copy">
              <strong>{caseRow.employeeName ?? '—'}</strong>
              <span>{[caseRow.employeeNo, caseEmployee?.position].filter(Boolean).join(' · ') || caseRow.caseNo}</span>
              <small>{caseRow.departmentName ?? 'Department unassigned'}</small>
            </span>
          </button>
          <button class="case-profile-cell case-profile-fact" type="button" onClick={() => openOnboardingPackages()}>
            <span><LucideIcon name="Package" size={16} />Package</span><strong>{caseRow.packageLabel}</strong>
            <small class="link">{humanize(caseRow.workerType ?? 'employee')}</small>
          </button>
          <div class="case-profile-cell case-profile-fact">
            <span><LucideIcon name="UserRound" size={16} />Case owner</span>
            <div class="case-owner-name">
              {ownerEmployee?.profile_image_url
                ? <img src={ownerEmployee.profile_image_url} alt="" />
                : <span class="ocd-owner-avatar" aria-hidden="true">{_initials(caseRow.ownerName)}</span>}
              <strong>{caseRow.ownerName ?? 'Unassigned'}</strong>
            </div>
            <small>{caseRow.departmentName ?? '—'}</small>
          </div>
          <div class="case-profile-cell case-profile-fact case-stage">
            <span><LucideIcon name="Route" size={16} />Current stage</span>
            <strong>{humanize(caseRow.status)}</strong>
            <div class="case-stage-meter">
              <span class="case-stage-progress" aria-label={`${readiness.percent} percent complete`}>
                <i style={{ width: `${readiness.percent}%` }} />
              </span>
              {/* Caption stays short. `.case-stage-meter` is a flex row where the caption is
                  `flex:0 0 auto; white-space:nowrap`, so a longer string starves the 82px bar —
                  appending the task counts here shrank it to 8px. Counts live on the Tasks tab. */}
              <small>{readiness.percent}% complete</small>
            </div>
          </div>
          <div class="case-profile-cell case-profile-fact">
            <span><LucideIcon name="ShieldCheck" size={16} />Status</span>
            <strong class={`ocd-status ${tone(caseRow.status)}`}>{humanize(caseRow.status)}</strong>
            <small>{blocked.reason}</small>
          </div>
        </section>

        {/* ── the seven permanent tabs. Counts come from the queries already loaded. ── */}
        <nav class="tabs" role="tablist" aria-label="Onboarding case sections">
          {visibleTabs.map(t => {
            const count = t === 'tasks' ? tasks.filter(x => isOpen(x.status)).length
              : t === 'handoffs' ? handoffs.length
                : t === 'blockers' ? blocked.openBlockers.length
                  : 0;
            return (
              <button
                key={t} type="button" role="tab" id={`caseTab-${t}`}
                aria-selected={tab === t} aria-controls={`casePanel-${t}`}
                class={tab === t ? 'active' : ''} onClick={() => setTab(t)}
              >
                <LucideIcon name={TAB_ICON[t]} size={16} />
                {TAB_LABEL[t]}
                {count > 0 && (
                  <span class={`status ${t === 'blockers' ? 'red' : t === 'handoffs' ? 'amber' : 'blue'}`}>{count}</span>
                )}
              </button>
            );
          })}
        </nav>
      </header>

      <div id={`casePanel-${tab}`} role="tabpanel" aria-labelledby={`caseTab-${tab}`} class="ocd-panel">
        {tab === 'overview' && overviewWorkspace()}
        {tab === 'tasks' && tasksWorkspace()}
        {tab === 'handoffs' && handoffsWorkspace()}
        {tab === 'blockers' && blockersWorkspace()}
        {tab === 'communications' && communicationsWorkspace()}
        {tab === 'timeline' && timelineWorkspace()}
        {tab === 'audit' && showAudit && auditWorkspace()}
      </div>

      <OnboardingAddTaskModal open={taskModalOpen} caseId={caseId} onClose={() => setTaskModalOpen(false)} onToast={onToast} />
      {ownerDialog}
      {reassignTaskDialog}

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
                <PersonSearchSelect
                  options={personOptions} value={actionForm.ownerEmployeeId}
                  onChange={v => setActionForm(f => ({ ...f, ownerEmployeeId: v }))}
                  placeholder="Search by name or employee number…" emptyLabel="No employees found"
                />
              </Field>
            : actionForm.ownerType === 'role'
              ? <Field label="Owner role"><TextInput value={actionForm.ownerRole} onInput={v => setActionForm(f => ({ ...f, ownerRole: v }))} placeholder="e.g. hr, it, supervisor" /></Field>
              : null}
          <Field label="Due date"><TextInput type="date" value={actionForm.dueDate} onInput={v => setActionForm(f => ({ ...f, dueDate: v }))} /></Field>
        </FormGrid>
        {/* The design's own choice cards. The Modal renders in place, inside .ocd-root, so the
            ported `.choice-grid` / `.choice-card` rules apply to it. */}
        <div class="choice-grid ocd-choice-grid">
          <label class="choice-card">
            <input type="checkbox" checked={actionForm.blocksOnboarding}
              onChange={e => setActionForm(f => ({ ...f, blocksOnboarding: (e.target as HTMLInputElement).checked }))} />
            <span>
              <strong>Blocks activation</strong>
              <small>The case cannot be marked ready until this action is complete.</small>
            </span>
          </label>
          <label class="choice-card">
            <input type="checkbox" checked={actionForm.requiresEvidence}
              onChange={e => setActionForm(f => ({ ...f, requiresEvidence: (e.target as HTMLInputElement).checked }))} />
            <span>
              <strong>Requires evidence</strong>
              <small>A submission must be attached before it can be completed.</small>
            </span>
          </label>
        </div>
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
