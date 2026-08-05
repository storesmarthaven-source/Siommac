/**
 * src/components/sections/HR/OnboardingPackageDetail.tsx
 *
 * HR ▸ Onboarding ▸ Packages ▸ Detail — the governed seven-tab package workspace.
 *   • Task templates    — instantiated into hr_onboarding_tasks when a case starts
 *   • Handoff templates — instantiated into hr_onboarding_handoffs when a case starts
 *   • Custom actions    — the Custom Action Template Manager (reuses the existing
 *     Phase-5 backend/hooks verbatim; this tab is the only new surface for it)
 * Task/handoff template delete is a real DELETE (no soft-delete column on those two
 * tables) — safe because loadPackagePlan only reads templates at case-START time.
 * Custom action templates keep their own is_active/retire semantics.
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { PageHeader, Modal, Field, FormGrid, TextInput, SelectInput, Tabs, type TabDef } from '@ui';
import { useEffectiveSettings } from '@api/settingsCatalog';
import {
  useOnboardingPackageDetail, useOnboardingUpdatePackage, useOnboardingSetPackageStatus,
  useOnboardingCreateTaskTemplate, useOnboardingUpdateTaskTemplate, useOnboardingDeleteTaskTemplate,
  useOnboardingCreateHandoffTemplate, useOnboardingUpdateHandoffTemplate, useOnboardingDeleteHandoffTemplate,
  useOnboardingActionTemplates, useOnboardingCreateActionTemplate, useOnboardingUpdateActionTemplate, useOnboardingRetireActionTemplate,
  useOnboardingPackageReferenceData,
} from '@api/hr/onboarding';
import type {
  OnboardingTaskTemplateRow, OnboardingHandoffTemplateRow, OnboardingActionTemplate,
  OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority,
} from '../../../../types/hrOnboarding';
import { humanize } from './onboardingStatus';
import './onboardingCase.css';
import './OnboardingPackageManagement.mockup.css';
import './OnboardingPackageManagement.page.css';

type PkgTab = 'overview' | 'work' | 'handoffs' | 'requirements' | 'portal' | 'communications' | 'governance';
const TABS: TabDef<PkgTab>[] = [
  { key: 'overview', label: 'Overview' },
  { key: 'work', label: 'Work Plan' },
  { key: 'handoffs', label: 'Handoffs' },
  { key: 'requirements', label: 'Requirements & Gates' },
  { key: 'portal', label: 'Worker Portal & Account' },
  { key: 'communications', label: 'Communications' },
  { key: 'governance', label: 'Governance & Versions' },
];
const ACTION_TYPES: OnboardingActionType[] = ['custom_task', 'custom_checklist_item', 'custom_external_action', 'custom_handoff', 'custom_document_request', 'custom_training_request', 'custom_approval', 'custom_notification'];
const OWNER_TYPES: OnboardingOwnerType[] = ['role', 'employee', 'department', 'system', 'external'];
const PRIORITIES: OnboardingActionPriority[] = ['low', 'normal', 'high', 'critical'];
const emptyTaskForm = { id: null as string | null, taskKey: '', taskTitle: '', ownerRole: '', moduleKey: '', isBlocking: false, requiresEvidence: false, sortOrder: '100' };
const emptyHandoffForm = { id: null as string | null, handoffKey: '', targetModule: '', handoffType: '', isRequired: true, sortOrder: '100' };
const emptyActionForm = {
  id: null as string | null, actionName: '', actionType: 'custom_task' as OnboardingActionType, ownerType: 'role' as OnboardingOwnerType,
  ownerRole: '', ownerEmployeeId: '', dueOffsetDays: '', priority: 'normal' as OnboardingActionPriority,
  isRequired: true, blocksOnboarding: false, requiresEvidence: false, workflowTemplateId: '',
  documentTypeId: '', trainingRequirementId: '', notificationTemplateId: '', externalSystemKey: '', externalActionUrl: '',
};

export function OnboardingPackageDetail({
  packageKey, onBack, onOpenEmailTemplates, onToast,
}: { packageKey: string; onBack: () => void; onOpenEmailTemplates?: () => void; onToast: (m: string) => void }): VNode {
  const [tab, setTab] = useState<PkgTab>('overview');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ label: '', description: '', defaultSlaDays: '10', defaultOwnerRole: '', workerTypes: '', probationDays: '' });
  const [taskModal, setTaskModal] = useState<typeof emptyTaskForm | null>(null);
  const [handoffModal, setHandoffModal] = useState<typeof emptyHandoffForm | null>(null);
  const [actionModal, setActionModal] = useState<typeof emptyActionForm | null>(null);

  const detailQ = useOnboardingPackageDetail(packageKey);
  const pkg = detailQ.data;
  const actionsQ = useOnboardingActionTemplates(packageKey, true);
  const actions = actionsQ.data ?? [];
  const editable = pkg?.status === 'draft';
  const settingsQ = useEffectiveSettings('hr_onboarding');
  const referencesQ = useOnboardingPackageReferenceData(editable);
  const settings = settingsQ.data?.data.settings ?? [];
  const setting = (key: string): unknown => settings.find(item => item.settingKey === key)?.effectiveValue;
  const operatingModel = String(setting('hr_onboarding.account_operating_model') ?? 'hybrid');
  const ownerQueue = String(setting('hr_onboarding.account_owner_queue') ?? 'it_service_desk');
  const invitationsEnabled = setting('hr_onboarding.secure_invitation_enabled') !== false;
  const invitationOffset = Number(setting('hr_onboarding.invitation_offset_days') ?? 5);
  const senderName = String(setting('hr_onboarding.communication_sender_name') ?? 'SIOMAC Onboarding');
  const senderEmail = String(setting('hr_onboarding.communication_sender_email') ?? 'Not configured');
  const escalationHours = Number(setting('hr_onboarding.default_escalation_hours') ?? 24);

  const updatePkgMut = useOnboardingUpdatePackage();
  const setStatusMut = useOnboardingSetPackageStatus();
  const createTaskMut = useOnboardingCreateTaskTemplate(), updateTaskMut = useOnboardingUpdateTaskTemplate(), deleteTaskMut = useOnboardingDeleteTaskTemplate();
  const createHandoffMut = useOnboardingCreateHandoffTemplate(), updateHandoffMut = useOnboardingUpdateHandoffTemplate(), deleteHandoffMut = useOnboardingDeleteHandoffTemplate();
  const createActionMut = useOnboardingCreateActionTemplate(), updateActionMut = useOnboardingUpdateActionTemplate(), retireActionMut = useOnboardingRetireActionTemplate();

  async function run(fn: () => Promise<unknown>, ok: string): Promise<void> {
    try { await fn(); onToast(ok); } catch (e) { onToast(e instanceof Error ? e.message : 'Action failed'); }
  }

  if (detailQ.isLoading && !pkg) return <div class="obx-empty">Loading…</div>;
  if (!pkg) return <div class="obx-empty">Onboarding package not found.</div>;

  // ── package header actions ──────────────────────────────────────────────────────
  function openEdit(): void {
    setEditForm({ label: pkg!.label, description: pkg!.description ?? '', defaultSlaDays: String(pkg!.defaultSlaDays), defaultOwnerRole: pkg!.defaultOwnerRole ?? '', workerTypes: pkg!.workerTypes.join(', '), probationDays: pkg!.probationDays != null ? String(pkg!.probationDays) : '' });
    setEditOpen(true);
  }
  async function submitEdit(): Promise<void> {
    await run(() => updatePkgMut.mutateAsync({
      id: pkg!.id, label: editForm.label.trim() || undefined, description: editForm.description.trim() || null,
      defaultSlaDays: Number(editForm.defaultSlaDays) || undefined, defaultOwnerRole: editForm.defaultOwnerRole.trim() || null,
      workerTypes: editForm.workerTypes.split(',').map(s => s.trim()).filter(Boolean),
      probationDays: editForm.probationDays.trim() ? Number(editForm.probationDays) : null,
    }), 'Package updated');
    setEditOpen(false);
  }
  async function handleStatusStep(): Promise<void> {
    if (pkg!.status === 'retired') return;
    const next = pkg!.status === 'draft' ? 'active' : 'retired';
    const label = next === 'active' ? 'Publish' : 'Retire';
    if (!await dialog.confirm({ title: `${label} "${pkg!.label}"?` })) return;
    await run(() => setStatusMut.mutateAsync({ id: pkg!.id, status: next }), `Package ${next}`);
  }

  // ── task template handlers ───────────────────────────────────────────────────────
  function openAddTask(): void { setTaskModal(emptyTaskForm); }
  function openEditTask(t: OnboardingTaskTemplateRow): void {
    setTaskModal({ id: t.id, taskKey: t.taskKey, taskTitle: t.taskTitle, ownerRole: t.ownerRole, moduleKey: t.moduleKey ?? '', isBlocking: t.isBlocking, requiresEvidence: t.requiresEvidence, sortOrder: String(t.sortOrder) });
  }
  async function submitTask(): Promise<void> {
    const f = taskModal!;
    if (!f.taskTitle.trim() || !f.ownerRole.trim() || (!f.id && !f.taskKey.trim())) { onToast('Task key, title and owner role are required'); return; }
    const patch = { taskTitle: f.taskTitle.trim(), ownerRole: f.ownerRole.trim(), moduleKey: f.moduleKey.trim() || null, isBlocking: f.isBlocking, requiresEvidence: f.requiresEvidence, sortOrder: Number(f.sortOrder) || 100 };
    await run(() => f.id ? updateTaskMut.mutateAsync({ id: f.id, ...patch }) : createTaskMut.mutateAsync({ packageId: pkg!.id, taskKey: f.taskKey.trim(), ...patch }), f.id ? 'Task template updated' : 'Task template added');
    setTaskModal(null);
  }
  async function deleteTask(t: OnboardingTaskTemplateRow): Promise<void> {
    if (!await dialog.confirm({ title: `Delete task template "${t.taskTitle}"?`, text: 'This only affects future case starts — already-started cases keep their own tasks.', danger: true })) return;
    await run(() => deleteTaskMut.mutateAsync({ id: t.id }), 'Task template deleted');
  }

  // ── handoff template handlers ────────────────────────────────────────────────────
  function openAddHandoff(): void { setHandoffModal(emptyHandoffForm); }
  function openEditHandoff(h: OnboardingHandoffTemplateRow): void {
    setHandoffModal({ id: h.id, handoffKey: h.handoffKey, targetModule: h.targetModule, handoffType: h.handoffType, isRequired: h.isRequired, sortOrder: String(h.sortOrder) });
  }
  async function submitHandoff(): Promise<void> {
    const f = handoffModal!;
    if (!f.targetModule.trim() || !f.handoffType.trim() || (!f.id && !f.handoffKey.trim())) { onToast('Handoff key, target module and type are required'); return; }
    const patch = { targetModule: f.targetModule.trim(), handoffType: f.handoffType.trim(), isRequired: f.isRequired, sortOrder: Number(f.sortOrder) || 100 };
    await run(() => f.id ? updateHandoffMut.mutateAsync({ id: f.id, ...patch }) : createHandoffMut.mutateAsync({ packageId: pkg!.id, handoffKey: f.handoffKey.trim(), ...patch }), f.id ? 'Handoff template updated' : 'Handoff template added');
    setHandoffModal(null);
  }
  async function deleteHandoff(h: OnboardingHandoffTemplateRow): Promise<void> {
    if (!await dialog.confirm({ title: `Delete handoff template "${h.handoffKey}"?`, text: 'This only affects future case starts — already-started cases keep their own handoffs.', danger: true })) return;
    await run(() => deleteHandoffMut.mutateAsync({ id: h.id }), 'Handoff template deleted');
  }

  // ── custom action template handlers (existing Phase-5 backend) ──────────────────
  function openAddAction(actionType: OnboardingActionType = 'custom_task'): void { setActionModal({ ...emptyActionForm, actionType }); }
  function openEditAction(a: OnboardingActionTemplate): void {
    setActionModal({
      id: a.id, actionName: a.actionName, actionType: a.actionType, ownerType: a.ownerType,
      ownerRole: a.ownerRole ?? '', ownerEmployeeId: a.ownerEmployeeId ?? '', dueOffsetDays: a.dueOffsetDays != null ? String(a.dueOffsetDays) : '',
      priority: a.priority, isRequired: a.isRequired, blocksOnboarding: a.blocksOnboarding, requiresEvidence: a.requiresEvidence,
      workflowTemplateId: a.workflowTemplateId ?? '',
      documentTypeId: a.documentTypeId ?? '', trainingRequirementId: a.trainingRequirementId ?? '',
      notificationTemplateId: a.notificationTemplateId ?? '', externalSystemKey: a.externalSystemKey ?? '', externalActionUrl: a.externalActionUrl ?? '',
    });
  }
  async function submitAction(): Promise<void> {
    const f = actionModal!;
    if (!f.actionName.trim()) { onToast('Action name is required'); return; }
    if (f.actionType === 'custom_approval' && !f.workflowTemplateId.trim()) { onToast('A workflow template ID is required for a custom approval action'); return; }
    if (f.actionType === 'custom_document_request' && !f.documentTypeId.trim()) { onToast('Choose an approved document type'); return; }
    if (f.actionType === 'custom_training_request' && !f.trainingRequirementId.trim()) { onToast('Choose an approved training requirement'); return; }
    const patch = {
      actionName: f.actionName.trim(), actionType: f.actionType, ownerType: f.ownerType,
      ownerRole: f.ownerType === 'role' ? f.ownerRole.trim() || null : null, ownerEmployeeId: f.ownerType === 'employee' ? f.ownerEmployeeId.trim() || null : null,
      dueOffsetDays: f.dueOffsetDays.trim() ? Number(f.dueOffsetDays) : undefined, priority: f.priority,
      isRequired: f.isRequired, blocksOnboarding: f.blocksOnboarding, requiresEvidence: f.requiresEvidence,
      workflowTemplateId: f.actionType === 'custom_approval' ? f.workflowTemplateId.trim() : null,
      documentTypeId: f.actionType === 'custom_document_request' ? f.documentTypeId.trim() || null : null,
      trainingRequirementId: f.actionType === 'custom_training_request' ? f.trainingRequirementId.trim() || null : null,
      notificationTemplateId: f.actionType === 'custom_notification' ? f.notificationTemplateId.trim() || null : null,
      externalSystemKey: f.actionType === 'custom_external_action' ? f.externalSystemKey.trim() || null : null,
      externalActionUrl: f.actionType === 'custom_external_action' ? f.externalActionUrl.trim() || null : null,
    };
    await run(() => f.id ? updateActionMut.mutateAsync({ id: f.id, ...patch }) : createActionMut.mutateAsync({ packageKey, ...patch }), f.id ? 'Custom action updated' : 'Custom action added');
    setActionModal(null);
  }
  async function retireAction(a: OnboardingActionTemplate): Promise<void> {
    if (!await dialog.confirm({ title: `Retire custom action "${a.actionName}"?` })) return;
    await run(() => retireActionMut.mutateAsync({ id: a.id }), 'Custom action retired');
  }

  const YN = (v: boolean): VNode => v ? <span class="obx-pill green" style={{ height: 18, padding: '0 8px' }}>Yes</span> : <span class="obx-meta">—</span>;
  const empty = (m: string): VNode => <div class="obx-empty">{m}</div>;
  const requirementTypes: OnboardingActionType[] = ['custom_document_request', 'custom_training_request', 'custom_approval'];
  const requirementActions = actions.filter(action => requirementTypes.includes(action.actionType));
  const workActions = actions.filter(action => !requirementTypes.includes(action.actionType));

  return (
    <div class="hr-onboarding-packages opm-root">
      <button class="obx-back" onClick={onBack}>← Packages</button>

      <PageHeader
        icon="fa-boxes-stacked"
        module="HR · Onboarding"
        title={pkg.label}
        sub={`${pkg.key} · v${pkg.versionNo}`}
        actions={
          <div class="obx-actions">
            {editable && <button class="obx-btn" onClick={openEdit}>Edit details</button>}
            {pkg.status !== 'retired' && <button class={`obx-btn${pkg.status === 'draft' ? ' primary' : ' danger'}`} onClick={() => void handleStatusStep()}>
              {pkg.status === 'draft' ? 'Publish Package' : 'Retire'}
            </button>}
          </div>
        }
      />

      <div class={`published-banner ${pkg.status}`}><div>
        <i class={`fas ${pkg.status === 'draft' ? 'fa-pen-ruler' : pkg.status === 'active' ? 'fa-lock' : 'fa-box-archive'}`} />
        <strong>{pkg.status === 'draft' ? 'Draft package' : pkg.status === 'active' ? 'Published version' : 'Retired package'}</strong>
        <span>{pkg.status === 'draft' ? 'Configure and validate the package before publishing it for future launches.' : pkg.status === 'active' ? 'This definition is read-only; existing cases remain frozen to the version used at launch.' : 'This version remains available for case history but cannot be selected for a new launch.'}</span>
      </div></div>
      <div class="package-workspace-grid">
        <main class="package-content-column">
      <div class="package-tabs"><Tabs tabs={TABS} active={tab} onChange={setTab} counts={{ work: pkg.taskTemplates.length + actions.length, handoffs: pkg.handoffTemplates.length }} /></div>

      {tab === 'overview' && (
        <div class="obx-section">
          <div class="package-glance" aria-label="Package at a glance">
            <div class="glance-item"><span>Recommended lead time</span><strong>{pkg.defaultSlaDays} days</strong><small>Calendar days</small></div>
            <div class="glance-item"><span>Required tasks</span><strong>{pkg.taskTemplates.length}</strong><small>Generated at launch</small></div>
            <div class="glance-item"><span>Handoffs</span><strong>{pkg.handoffTemplates.length}</strong><small>Across accountable teams</small></div>
            <div class="glance-item"><span>Required actions</span><strong>{actions.filter(action => action.isRequired).length}</strong><small>Cannot be removed in wizard</small></div>
            <div class="glance-item"><span>Probation</span><strong>{pkg.probationDays ?? '—'}</strong><small>{pkg.probationDays == null ? 'Not configured' : 'Days'}</small></div>
          </div>
          <div class="overview-main">
            <section class="section"><div class="section-head"><div><h3>Package Definition</h3><p>The stable configuration applied when a case launches.</p></div><span class="pill">{humanize(pkg.status)}</span></div><div class="definition-list"><div class="definition-item"><span>Package key</span><strong>{pkg.key}</strong></div><div class="definition-item"><span>Default owner</span><strong>{pkg.defaultOwnerRole ?? 'HR Operations'}</strong></div><div class="definition-item"><span>Case overrides</span><strong>Owner and optional work only</strong></div></div></section>
            <section class="section"><div class="section-head"><div><h3>Package Eligibility</h3><p>Employee Master facts determine whether the package is offered.</p></div></div><div class="eligibility-summary"><div class="eligibility-row"><span class="eligibility-label">Worker category</span><div class="chip-row">{pkg.workerTypes.map(type => <span class="chip" key={type}>{humanize(type)}</span>)}</div></div><div class="eligibility-scope"><i class="fas fa-check" /><span>{pkg.appliesToDepartments.length ? `${pkg.appliesToDepartments.length} departments` : 'All departments'} and {pkg.appliesToSites.length ? `${pkg.appliesToSites.length} sites` : 'all sites'} are eligible.</span></div></div></section>
          </div>
        </div>
      )}

      {tab === 'work' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-list-check" />Task templates</h2>{editable && <button class="obx-btn primary obx-btn-sm" onClick={openAddTask}>+ Add</button>}</div>
          <div class="obx-section-body">
            {!pkg.taskTemplates.length ? empty('No task templates yet.') : (
              <table class="obx-table">
                <thead><tr><th>#</th><th>Key</th><th>Title</th><th>Owner</th><th>Module</th><th>Blocking</th><th>Evidence</th><th>Actions</th></tr></thead>
                <tbody>{pkg.taskTemplates.map(t => (
                  <tr key={t.id}>
                    <td class="obx-meta">{t.sortOrder}</td>
                    <td class="obx-meta">{t.taskKey}</td>
                    <td><b>{t.taskTitle}</b></td>
                    <td class="obx-meta">{humanize(t.ownerRole)}</td>
                    <td class="obx-meta">{t.moduleKey ? humanize(t.moduleKey) : '—'}</td>
                    <td>{YN(t.isBlocking)}</td>
                    <td>{YN(t.requiresEvidence)}</td>
                    <td>{editable ? <div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditTask(t)}>Edit</button>
                      <button class="obx-mini" onClick={() => void deleteTask(t)}>Delete</button>
                    </div> : <span class="obx-meta">Published</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'handoffs' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-arrow-right-arrow-left" />Handoff templates</h2>{editable && <button class="obx-btn primary obx-btn-sm" onClick={openAddHandoff}>+ Add</button>}</div>
          <div class="obx-section-body">
            {!pkg.handoffTemplates.length ? empty('No handoff templates yet.') : (
              <table class="obx-table">
                <thead><tr><th>#</th><th>Key</th><th>Target module</th><th>Type</th><th>Required</th><th>Actions</th></tr></thead>
                <tbody>{pkg.handoffTemplates.map(h => (
                  <tr key={h.id}>
                    <td class="obx-meta">{h.sortOrder}</td>
                    <td class="obx-meta">{h.handoffKey}</td>
                    <td><b>{humanize(h.targetModule)}</b></td>
                    <td class="obx-meta">{humanize(h.handoffType)}</td>
                    <td>{YN(h.isRequired)}</td>
                    <td>{editable ? <div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditHandoff(h)}>Edit</button>
                      <button class="obx-mini" onClick={() => void deleteHandoff(h)}>Delete</button>
                    </div> : <span class="obx-meta">Published</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'work' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-bolt" />Custom actions</h2>{editable && <button class="obx-btn primary obx-btn-sm" onClick={() => openAddAction()}>+ Add</button>}</div>
          <div class="obx-section-body">
            {actionsQ.isLoading && !actionsQ.data ? empty('Loading…') : !workActions.length ? empty('No custom action templates yet.') : (
              <table class="obx-table">
                <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Priority</th><th>Required</th><th>Blocks</th><th>Active</th><th>Actions</th></tr></thead>
                <tbody>{workActions.map(a => (
                  <tr key={a.id}>
                    <td><b>{a.actionName}</b></td>
                    <td class="obx-meta">{humanize(a.actionType)}</td>
                    <td class="obx-meta">{a.ownerType === 'employee' ? (a.ownerEmployeeId ?? '—') : a.ownerRole ? humanize(a.ownerRole) : humanize(a.ownerType)}</td>
                    <td><span class="obx-pill blue" style={{ height: 18, padding: '0 8px' }}>{humanize(a.priority)}</span></td>
                    <td>{YN(a.isRequired)}</td>
                    <td>{YN(a.blocksOnboarding)}</td>
                    <td>{YN(a.isActive)}</td>
                    <td>{editable ? <div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditAction(a)}>Edit</button>
                      {a.isActive && <button class="obx-mini" onClick={() => void retireAction(a)}>Retire</button>}
                    </div> : <span class="obx-meta">Published</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'requirements' && (
        <div class="obx-section">
          <div class="obx-section-head">
            <div><h2><i class="fas fa-shield-halved" />Requirements & Gates</h2><p class="obx-meta">Required document, training and approval controls generated when the case launches.</p></div>
            {editable && <div class="obx-rowbtns"><button class="obx-btn obx-btn-sm" onClick={() => openAddAction('custom_document_request')}>Add Document</button><button class="obx-btn obx-btn-sm" onClick={() => openAddAction('custom_training_request')}>Add Training</button><button class="obx-btn obx-btn-sm" onClick={() => openAddAction('custom_approval')}>Add Approval</button></div>}
          </div>
          <div class="obx-section-body">
            {!requirementActions.length ? empty('No package requirements have been configured.') : (
              <table class="obx-table">
                <thead><tr><th>Requirement</th><th>Category</th><th>Owner</th><th>Due</th><th>Required</th><th>Activation gate</th><th>Actions</th></tr></thead>
                <tbody>{requirementActions.map(action => (
                  <tr key={action.id}>
                    <td><b>{action.actionName}</b></td>
                    <td class="obx-meta">{humanize(action.actionType.replace('custom_', ''))}</td>
                    <td class="obx-meta">{action.ownerRole ? humanize(action.ownerRole) : humanize(action.ownerType)}</td>
                    <td class="obx-meta">{action.dueOffsetDays == null ? 'Unscheduled' : `${Math.abs(action.dueOffsetDays)} days ${action.dueOffsetDays < 0 ? 'before' : 'after'} start`}</td>
                    <td>{YN(action.isRequired)}</td>
                    <td>{YN(action.blocksOnboarding)}</td>
                    <td>{editable ? <div class="obx-rowbtns"><button class="obx-mini" onClick={() => openEditAction(action)}>Edit</button>{action.isActive && <button class="obx-mini" onClick={() => void retireAction(action)}>Retire</button>}</div> : <span class="obx-meta">Published</span>}</td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'portal' && (
        <div class="obx-section">
          <div class="obx-section-head"><div><h2><i class="fas fa-user-gear" />Worker Portal & Account</h2><p class="obx-meta">Organisation policy is shown here for launch review and remains editable only in Onboarding Settings.</p></div></div>
          <div class="obx-section-body">
            {settingsQ.isLoading ? empty('Loading onboarding policy…') : (
              <div class="package-policy-grid">
                <div class="package-policy-card"><i class="fas fa-diagram-project" /><span>Operating model</span><strong>{humanize(operatingModel)}</strong><small>Determines whether HR, IT or both teams complete account setup.</small></div>
                <div class="package-policy-card"><i class="fas fa-people-group" /><span>Account owner queue</span><strong>{humanize(ownerQueue)}</strong><small>The accountable queue used when this package creates account work.</small></div>
                <div class="package-policy-card"><i class="fas fa-envelope-circle-check" /><span>Secure invitation</span><strong>{invitationsEnabled ? `${invitationOffset} days before start` : 'Disabled'}</strong><small>{invitationsEnabled ? 'A single-use worker invitation is issued under organisation policy.' : 'Launch does not issue a worker invitation.'}</small></div>
                <div class="package-policy-card"><i class="fas fa-lock" /><span>Package responsibility</span><strong>Content and readiness gates</strong><small>Provisioning authority and sender identity are never overridden by a package.</small></div>
              </div>
            )}
          </div>
        </div>
      )}

      {tab === 'communications' && (
        <div class="obx-section">
          <div class="obx-section-head"><div><h2><i class="fas fa-envelope-open-text" />Communications</h2><p class="obx-meta">Governed templates open in Email Studio; organisation sender policy stays read-only here.</p></div>{onOpenEmailTemplates ? <button class="obx-btn primary obx-btn-sm" onClick={onOpenEmailTemplates}>Open Email Templates</button> : null}</div>
          <div class="obx-section-body">
            <div class="package-policy-grid compact">
              <div class="package-policy-card"><i class="fas fa-signature" /><span>Sender name</span><strong>{senderName}</strong><small>{senderEmail}</small></div>
              <div class="package-policy-card"><i class="fas fa-clock" /><span>Default escalation</span><strong>{escalationHours} hours</strong><small>Applied when package work becomes overdue.</small></div>
              <div class="package-policy-card"><i class="fas fa-shield-halved" /><span>Delivery model</span><strong>Governed templates</strong><small>Messages are rendered and delivered by the authenticated server workflow.</small></div>
            </div>
          </div>
        </div>
      )}

      {tab === 'governance' && (
        <div class="obx-section"><div class="obx-section-head"><h2><i class="fas fa-code-branch" />Governance & Versions</h2></div><div class="obx-section-body"><div class="ob-review-list"><div class="ob-review-row"><span>Current version</span><strong>v{pkg.versionNo}</strong></div><div class="ob-review-row"><span>Lifecycle</span><strong>{humanize(pkg.status)}</strong></div><div class="ob-review-row"><span>Change policy</span><strong>Future cases only</strong></div></div></div></div>
      )}
        </main>

        <aside class="package-context-rail" aria-label="Package governance context">
          <section class="rail-widget">
            <div class="rail-widget-head"><i class="fas fa-heart-pulse" aria-hidden="true" /><div><h3>Package Health</h3><p>Configuration status</p></div></div>
            <div class="health-score">
              <span class="health-check"><i class={`fas ${pkg.taskTemplates.length && pkg.handoffTemplates.length ? 'fa-check' : 'fa-triangle-exclamation'}`} /></span>
              <div class="health-copy"><strong>{pkg.taskTemplates.length && pkg.handoffTemplates.length ? 'Core plan configured' : 'Configuration needs review'}</strong><span>{pkg.taskTemplates.length} tasks · {pkg.handoffTemplates.length} handoffs · {actions.filter(action => action.isRequired).length} required actions</span></div>
            </div>
          </section>
          <section class="rail-widget">
            <div class="rail-widget-head"><i class="fas fa-sliders" aria-hidden="true" /><div><h3>Operating Defaults</h3><p>Frozen when a case launches</p></div></div>
            <div class="rail-facts">
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-calendar-day" /></span><div><span>Lead Time</span><strong>{pkg.defaultSlaDays} days</strong></div></div>
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-user-shield" /></span><div><span>Owner Queue</span><strong>{pkg.defaultOwnerRole ? humanize(pkg.defaultOwnerRole) : 'HR Operations'}</strong></div></div>
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-diagram-project" /></span><div><span>Account Model</span><strong>{humanize(operatingModel)}</strong></div></div>
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-envelope-circle-check" /></span><div><span>Worker Invitation</span><strong>{invitationsEnabled ? `${invitationOffset} days before` : 'Disabled'}</strong></div></div>
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-user-clock" /></span><div><span>Probation</span><strong>{pkg.probationDays == null ? 'Not configured' : `${pkg.probationDays} days`}</strong></div></div>
            </div>
          </section>
          <section class="rail-widget">
            <div class="rail-widget-head"><i class="fas fa-code-branch" aria-hidden="true" /><div><h3>Publication</h3><p>Version and change state</p></div></div>
            <div class="rail-facts">
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-tag" /></span><div><span>Version</span><strong>v{pkg.versionNo}</strong></div></div>
              <div class="rail-fact"><span class="rail-fact-icon"><i class="fas fa-circle-info" /></span><div><span>Lifecycle</span><strong>{humanize(pkg.status)}</strong></div></div>
            </div>
          </section>
        </aside>
      </div>

      <Modal open={editOpen} title="Edit Package" icon="fa-boxes-stacked" onClose={() => setEditOpen(false)} onSubmit={() => void submitEdit()} submitLabel="Save" submitDisabled={updatePkgMut.isPending}>
        <FormGrid>
          <Field label="Label" wide><TextInput value={editForm.label} onInput={v => setEditForm(f => ({ ...f, label: v }))} /></Field>
          <Field label="Default SLA (days)"><TextInput type="number" value={editForm.defaultSlaDays} onInput={v => setEditForm(f => ({ ...f, defaultSlaDays: v }))} /></Field>
          <Field label="Probation (days)"><TextInput type="number" value={editForm.probationDays} onInput={v => setEditForm(f => ({ ...f, probationDays: v }))} placeholder="e.g. 90, blank = none" /></Field>
          <Field label="Default owner role"><TextInput value={editForm.defaultOwnerRole} onInput={v => setEditForm(f => ({ ...f, defaultOwnerRole: v }))} /></Field>
          <Field label="Worker types" wide><TextInput value={editForm.workerTypes} onInput={v => setEditForm(f => ({ ...f, workerTypes: v }))} placeholder="e.g. full_time, contractor" /></Field>
        </FormGrid>
      </Modal>

      {taskModal && (
        <Modal open title={taskModal.id ? 'Edit Task Template' : 'Add Task Template'} icon="fa-list-check" onClose={() => setTaskModal(null)} onSubmit={() => void submitTask()} submitLabel={taskModal.id ? 'Save' : 'Add'} submitDisabled={createTaskMut.isPending || updateTaskMut.isPending}>
          <FormGrid>
            <Field label="Task key">
              <TextInput value={taskModal.taskKey} onInput={v => setTaskModal(f => f && { ...f, taskKey: v })} placeholder="e.g. collect_id_documents" />
            </Field>
            <Field label="Title" wide><TextInput value={taskModal.taskTitle} onInput={v => setTaskModal(f => f && { ...f, taskTitle: v })} placeholder="e.g. Collect ID documents" /></Field>
            <Field label="Owner role"><TextInput value={taskModal.ownerRole} onInput={v => setTaskModal(f => f && { ...f, ownerRole: v })} placeholder="e.g. hr, it, hse" /></Field>
            <Field label="Module key"><TextInput value={taskModal.moduleKey} onInput={v => setTaskModal(f => f && { ...f, moduleKey: v })} placeholder="e.g. documents, it, hse" /></Field>
            <Field label="Sort order"><TextInput type="number" value={taskModal.sortOrder} onInput={v => setTaskModal(f => f && { ...f, sortOrder: v })} /></Field>
          </FormGrid>
          <label class="obx-checkline"><input type="checkbox" checked={taskModal.isBlocking} onChange={e => setTaskModal(f => f && { ...f, isBlocking: (e.target as HTMLInputElement).checked })} /> Blocks activation until complete</label>
          <label class="obx-checkline"><input type="checkbox" checked={taskModal.requiresEvidence} onChange={e => setTaskModal(f => f && { ...f, requiresEvidence: (e.target as HTMLInputElement).checked })} /> Requires evidence to complete</label>
        </Modal>
      )}

      {handoffModal && (
        <Modal open title={handoffModal.id ? 'Edit Handoff Template' : 'Add Handoff Template'} icon="fa-arrow-right-arrow-left" onClose={() => setHandoffModal(null)} onSubmit={() => void submitHandoff()} submitLabel={handoffModal.id ? 'Save' : 'Add'} submitDisabled={createHandoffMut.isPending || updateHandoffMut.isPending}>
          <FormGrid>
            <Field label="Handoff key">
              <TextInput value={handoffModal.handoffKey} onInput={v => setHandoffModal(f => f && { ...f, handoffKey: v })} placeholder="e.g. it_account_provisioning" />
            </Field>
            <Field label="Target module"><TextInput value={handoffModal.targetModule} onInput={v => setHandoffModal(f => f && { ...f, targetModule: v })} placeholder="e.g. it, hse, payroll" /></Field>
            <Field label="Handoff type" wide><TextInput value={handoffModal.handoffType} onInput={v => setHandoffModal(f => f && { ...f, handoffType: v })} placeholder="e.g. account_setup" /></Field>
            <Field label="Sort order"><TextInput type="number" value={handoffModal.sortOrder} onInput={v => setHandoffModal(f => f && { ...f, sortOrder: v })} /></Field>
          </FormGrid>
          <label class="obx-checkline"><input type="checkbox" checked={handoffModal.isRequired} onChange={e => setHandoffModal(f => f && { ...f, isRequired: (e.target as HTMLInputElement).checked })} /> Required</label>
        </Modal>
      )}

      {actionModal && (
        <Modal open title={actionModal.id ? 'Edit Custom Action' : 'Add Custom Action'} icon="fa-bolt" onClose={() => setActionModal(null)} onSubmit={() => void submitAction()} submitLabel={actionModal.id ? 'Save' : 'Add'} submitDisabled={createActionMut.isPending || updateActionMut.isPending}>
          <FormGrid>
            <Field label="Action name" wide><TextInput value={actionModal.actionName} onInput={v => setActionModal(f => f && { ...f, actionName: v })} placeholder="e.g. Manager welcome call" /></Field>
            <Field label="Type"><SelectInput value={actionModal.actionType} onInput={v => setActionModal(f => f && { ...f, actionType: v as OnboardingActionType })} options={ACTION_TYPES.map(t => ({ value: t, label: humanize(t) }))} /></Field>
            <Field label="Priority"><SelectInput value={actionModal.priority} onInput={v => setActionModal(f => f && { ...f, priority: v as OnboardingActionPriority })} options={PRIORITIES.map(p => ({ value: p, label: humanize(p) }))} /></Field>
            <Field label="Owner type"><SelectInput value={actionModal.ownerType} onInput={v => setActionModal(f => f && { ...f, ownerType: v as OnboardingOwnerType })} options={OWNER_TYPES.map(t => ({ value: t, label: humanize(t) }))} /></Field>
            {actionModal.ownerType === 'role' && <Field label="Owner role"><TextInput value={actionModal.ownerRole} onInput={v => setActionModal(f => f && { ...f, ownerRole: v })} placeholder="e.g. supervisor, hr" /></Field>}
            {actionModal.ownerType === 'employee' && <Field label="Owner (employee id)"><TextInput value={actionModal.ownerEmployeeId} onInput={v => setActionModal(f => f && { ...f, ownerEmployeeId: v })} /></Field>}
            <Field label="Due offset (days)"><TextInput type="number" value={actionModal.dueOffsetDays} onInput={v => setActionModal(f => f && { ...f, dueOffsetDays: v })} placeholder="e.g. 3" /></Field>
            {actionModal.actionType === 'custom_approval' && <Field label="Approval workflow" wide><SelectInput value={actionModal.workflowTemplateId} onInput={v => setActionModal(f => f && { ...f, workflowTemplateId: v })} placeholder={referencesQ.isLoading ? 'Loading approved workflows…' : 'Choose an approved workflow'} options={(referencesQ.data?.workflowTemplates ?? []).map(option => ({ value: option.id, label: option.detail ? `${option.label} — ${option.detail}` : option.label }))} /></Field>}
            {actionModal.actionType === 'custom_document_request' && <Field label="Document requirement" wide><SelectInput value={actionModal.documentTypeId} onInput={v => setActionModal(f => f && { ...f, documentTypeId: v })} placeholder={referencesQ.isLoading ? 'Loading document requirements…' : 'Choose an approved document requirement'} options={(referencesQ.data?.documentRequirements ?? []).map(option => ({ value: option.id, label: option.detail ? `${option.label} — ${option.detail}` : option.label }))} /></Field>}
            {actionModal.actionType === 'custom_training_request' && <Field label="Training requirement" wide><SelectInput value={actionModal.trainingRequirementId} onInput={v => setActionModal(f => f && { ...f, trainingRequirementId: v })} placeholder={referencesQ.isLoading ? 'Loading training requirements…' : 'Choose an approved training requirement'} options={(referencesQ.data?.trainingRequirements ?? []).map(option => ({ value: option.id, label: option.detail ? `${option.label} — ${option.detail}` : option.label }))} /></Field>}
            {actionModal.actionType === 'custom_notification' && <Field label="Notification template ID" wide><TextInput value={actionModal.notificationTemplateId} onInput={v => setActionModal(f => f && { ...f, notificationTemplateId: v })} placeholder="Approved notification template UUID" /></Field>}
            {actionModal.actionType === 'custom_external_action' && <>
              <Field label="External system key"><TextInput value={actionModal.externalSystemKey} onInput={v => setActionModal(f => f && { ...f, externalSystemKey: v })} /></Field>
              <Field label="Approved action URL"><TextInput value={actionModal.externalActionUrl} onInput={v => setActionModal(f => f && { ...f, externalActionUrl: v })} /></Field>
            </>}
          </FormGrid>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.isRequired} onChange={e => setActionModal(f => f && { ...f, isRequired: (e.target as HTMLInputElement).checked })} /> Required</label>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.blocksOnboarding} onChange={e => setActionModal(f => f && { ...f, blocksOnboarding: (e.target as HTMLInputElement).checked })} /> Blocks activation until complete</label>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.requiresEvidence} onChange={e => setActionModal(f => f && { ...f, requiresEvidence: (e.target as HTMLInputElement).checked })} /> Requires evidence to complete</label>
        </Modal>
      )}
    </div>
  );
}
