/**
 * src/components/sections/HR/OnboardingCaseDetail.tsx
 *
 * HR ▸ Onboarding ▸ Case detail — STANDARD page shape: PageHeader (title + ProfilePill +
 * lifecycle actions) → Customize widget grid (same stack-grid as Employee Master).
 * The grid mixes glanceable KPI tiles (registry.hrOnboardingCase, fed the active case via the
 * @store/onboardingCase store) with the FUNCTIONAL tables as page-local widgets:
 *   • Active Tasks  — Complete · Block · Unblock · Add
 *   • Blockers      — Resolve · Escalate · Waive
 *   • Handoffs      — read-only
 *   • Custom Actions — Complete · Cancel · Add
 * Lifecycle (Pause/Resume/Mark Ready/Complete/Cancel/Provision/Reassign Owner) lives in the header.
 * All data + mutations hit the real onboarding API; mutations invalidate ['hr','onboarding'].
 */
import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader } from '@ui';
import {
  WidgetBoard, WidgetBoardToolbar, WidgetLibraryModal, useBoardLayout, WIDGET_REGISTRY, commitPreviewWidget,
  type BoardLayout, type LocalWidgetMap, type PreviewWidgetInstance, type WidgetInstance, type WidgetSizeKey,
} from '@ui/widgets';
import { can } from '@lib/permissions';
import { useSessionStore, selectIsManager, selectIsAdmin } from '@store/session';
import {
  useOnboardingTasksList, useOnboardingHandoffsList, useOnboardingBlockersList, useOnboardingCaseActions,
  useOnboardingCompleteTask, useOnboardingAddTask, useOnboardingBlockTask, useOnboardingUnblockTask,
  useOnboardingResolveBlocker, useOnboardingEscalateBlocker, useOnboardingWaiveBlocker,
  useOnboardingPauseCase, useOnboardingResumeCase, useOnboardingMarkReady, useOnboardingCompleteCase,
  useOnboardingCancelCase, useOnboardingReassignOwner, useOnboardingProvisionAccount,
  useOnboardingAddCaseAction, useOnboardingCompleteCaseAction, useOnboardingCancelCaseAction,
} from '@api/hr/onboarding';
import { useHrEmployees } from '@api/hr/employees';
import type {
  OnboardingCaseRow, OnboardingTaskRow, OnboardingBlockerRow, OnboardingCaseAction,
} from '../../../../types/hrOnboarding';
import { useOnboardingCaseStore } from '@store/onboardingCase';
import { humanize, fmtDate, fmtDateTime } from './onboardingStatus';
import { isOpen } from './onboardingCase.helpers';
import './onboardingCase.css';

// ── helpers ──────────────────────────────────────────────────────────────────────
const initials = (n: string | null | undefined): string =>
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
      main: [
        // glanceable KPI tiles
        defInst('hr.onboarding.case.progress',  0, 0, 3, 3, 'tall'),
        defInst('hr.onboarding.case.readiness', 3, 0, 3, 3, 'tall'),
        defInst('hr.onboarding.case.sla',       6, 0, 3, 3, 'tall'),
        defInst('hr.onboarding.case.team',      9, 0, 3, 3, 'tall'),
        // functional tables (page-local widgets)
        defInst('hr.onboarding.case.activeTasks',  0, 3, 8, 5, 'wide'),
        defInst('hr.onboarding.case.blockersTable', 8, 3, 4, 5, 'tall'),
        defInst('hr.onboarding.case.customActions', 0, 8, 6, 4, 'wide'),
        defInst('hr.onboarding.case.handoffsTable', 6, 8, 6, 4, 'wide'),
        // activity feed (registry tile) + provisioning tile
        defInst('hr.onboarding.case.activity',     0, 12, 8, 4, 'wide'),
        defInst('hr.onboarding.case.provisioning', 8, 12, 4, 3, 'tall'),
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
  const completeTaskMut = useOnboardingCompleteTask(), addTaskMut = useOnboardingAddTask(), blockTaskMut = useOnboardingBlockTask(), unblockTaskMut = useOnboardingUnblockTask();
  const resolveMut = useOnboardingResolveBlocker(), escalateMut = useOnboardingEscalateBlocker(), waiveMut = useOnboardingWaiveBlocker();
  const addActionMut = useOnboardingAddCaseAction(), completeActionMut = useOnboardingCompleteCaseAction(), cancelActionMut = useOnboardingCancelCaseAction();

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }

  // ── lifecycle handlers ──────────────────────────────────────────────────────────
  async function handlePause(): Promise<void> { const r = await dialog.prompt({ title: 'Reason for pausing this case?' }); if (r === null) return; await run(() => pauseMut.mutateAsync({ caseId, reason: r || null }), 'Case paused'); }
  async function handleResume(): Promise<void> { if (!await dialog.confirm({ title: 'Resume this onboarding case?' })) return; await run(() => resumeMut.mutateAsync({ caseId }), 'Case resumed'); }
  async function handleMarkReady(): Promise<void> { if (!await dialog.confirm({ title: 'Mark this case as ready for activation?' })) return; await run(() => markReadyMut.mutateAsync({ caseId }), 'Marked ready'); }
  async function handleComplete(): Promise<void> { if (!await dialog.confirm({ title: 'Complete this onboarding case?' })) return; await run(() => completeCaseMut.mutateAsync({ caseId }), 'Case completed'); }
  async function handleCancel(): Promise<void> { const r = await dialog.prompt({ title: 'Reason for cancelling this case?' }); if (r === null) return; await run(() => cancelMut.mutateAsync({ caseId, reason: r || undefined }), 'Case cancelled'); }
  async function handleReassignOwner(ownerId: string): Promise<void> { await run(() => reassignMut.mutateAsync({ caseId, ownerId: ownerId || null }), 'Owner reassigned'); }
  async function handleProvision(): Promise<void> { if (!caseRow.employeeId) { onToast('No employee linked'); return; } if (!await dialog.confirm({ title: 'Provision a work email & login for this employee?' })) return; await run(() => provisionMut.mutateAsync({ employeeId: caseRow.employeeId!, sendInvite: true }), 'Account provisioning started'); }

  // ── task handlers ────────────────────────────────────────────────────────────────
  async function handleAddTask(): Promise<void> { const t = await dialog.prompt({ title: 'New task title' }); if (!t) return; await run(() => addTaskMut.mutateAsync({ caseId, taskTitle: t }), 'Task added'); }
  async function handleCompleteTask(t: OnboardingTaskRow): Promise<void> { await run(() => completeTaskMut.mutateAsync({ taskId: t.taskId }), 'Task completed'); }
  async function handleBlockTask(t: OnboardingTaskRow): Promise<void> { const r = await dialog.prompt({ title: `Why is "${t.taskTitle}" blocked?` }); if (r === null) return; await run(() => blockTaskMut.mutateAsync({ taskId: t.taskId, reason: r || null }), 'Task blocked'); }
  async function handleUnblockTask(t: OnboardingTaskRow): Promise<void> { await run(() => unblockTaskMut.mutateAsync({ taskId: t.taskId }), 'Task unblocked'); }

  // ── blocker handlers ──────────────────────────────────────────────────────────────
  async function handleResolve(b: OnboardingBlockerRow): Promise<void> { const n = await dialog.prompt({ title: `Resolution for: ${b.blockerTitle}` }); if (n === null) return; await run(() => resolveMut.mutateAsync({ blockerId: b.blockerId, note: n || null }), 'Blocker resolved'); }
  async function handleEscalate(b: OnboardingBlockerRow): Promise<void> { const n = await dialog.prompt({ title: `Escalation reason for: ${b.blockerTitle}` }); if (n === null) return; await run(() => escalateMut.mutateAsync({ blockerId: b.blockerId, note: n || null }), 'Blocker escalated'); }
  async function handleWaive(b: OnboardingBlockerRow): Promise<void> { const r = await dialog.prompt({ title: `Waiver reason for: ${b.blockerTitle} (required)` }); if (!r) return; await run(() => waiveMut.mutateAsync({ blockerId: b.blockerId, reason: r }), 'Blocker waived'); }

  // ── custom action handlers ──────────────────────────────────────────────────────
  async function handleAddAction(): Promise<void> { const n = await dialog.prompt({ title: 'New custom action name' }); if (!n) return; await run(() => addActionMut.mutateAsync({ caseId, actionName: n, actionType: 'custom_task' }), 'Custom action added'); }
  async function handleCompleteAction(a: OnboardingCaseAction): Promise<void> { await run(() => completeActionMut.mutateAsync({ id: a.id }), 'Action completed'); }
  async function handleCancelAction(a: OnboardingCaseAction): Promise<void> { const r = await dialog.prompt({ title: `Reason for cancelling "${a.actionName}"?` }); if (r === null) return; await run(() => cancelActionMut.mutateAsync({ id: a.id, reason: r || null }), 'Action cancelled'); }

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
      <thead><tr><th>Task</th><th>Owner / Assignee</th><th>Due</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{tasks.map(t => (
        <tr key={t.taskId}>
          <td><b>{t.taskTitle}</b>{t.isBlocking && <span class="obx-pill red" style={{ marginLeft: 8 }}>blocking</span>}</td>
          <td>{t.assignedToName ?? humanize(t.ownerRole ?? '—')}</td>
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

  const actionsBody = (): VNode => actionsQ.isLoading && !actionsQ.data ? empty('Loading…') : !actions.length ? empty('No custom actions.') : (
    <table class="obx-table">
      <thead><tr><th>Action</th><th>Type</th><th>Status</th><th>Actions</th></tr></thead>
      <tbody>{actions.map(a => (
        <tr key={a.id}>
          <td><b>{a.actionName}</b></td>
          <td>{humanize(a.actionType)}</td>
          <td><Pill s={a.status} /></td>
          <td>{isOpen(a.status) ? <div class="obx-rowbtns">
            <button class="obx-mini" onClick={() => void handleCompleteAction(a)}>Complete</button>
            <button class="obx-mini" onClick={() => void handleCancelAction(a)}>Cancel</button>
          </div> : <span class="obx-meta">—</span>}</td>
        </tr>
      ))}</tbody>
    </table>
  );

  const localWidgets: LocalWidgetMap = {
    'hr.onboarding.case.activeTasks':   { chrome: 'none', title: 'Active Tasks', render: () => wcard('Active Tasks', 'fa-list-check', tasksBody(), <button class="obx-btn primary obx-btn-sm" onClick={() => void handleAddTask()}>+ Add</button>) },
    'hr.onboarding.case.blockersTable': { chrome: 'none', title: 'Blockers', render: () => wcard('Blockers', 'fa-triangle-exclamation', blockersBody()) },
    'hr.onboarding.case.handoffsTable': { chrome: 'none', title: 'Handoffs', render: () => wcard('Handoffs', 'fa-arrow-right-arrow-left', handoffsBody()) },
    'hr.onboarding.case.customActions': { chrome: 'none', title: 'Custom Actions', render: () => wcard('Custom Actions', 'fa-bolt', actionsBody(), <button class="obx-btn primary obx-btn-sm" onClick={() => void handleAddAction()}>+ Add</button>) },
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
        meta={[
          { icon: 'fa-circle-dot', label: humanize(caseRow.status) },
          { icon: 'fa-percent', label: `${caseRow.progressPercent}% complete` },
          { icon: 'fa-calendar', label: `Due ${fmtDate(caseRow.dueAt)}` },
        ]}
        actions={headerActions}
      />

      {canEdit && (
        <WidgetBoardToolbar
          editing={editing} canSetDefault={isAdmin}
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
        onAddWidget={inst => addWidget(CASE_ZONE, placeBottom(inst as WidgetInstance))}
        onPreviewOnBoard={p => setPreview(placeBottom(p))}
      />
    </div>
  );
}
