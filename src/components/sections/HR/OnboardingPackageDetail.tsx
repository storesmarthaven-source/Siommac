/**
 * src/components/sections/HR/OnboardingPackageDetail.tsx
 *
 * HR ▸ Onboarding ▸ Packages ▸ Detail — plain admin page (no widget board), three
 * tabs over one package's configuration:
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
import {
  useOnboardingPackageDetail, useOnboardingUpdatePackage, useOnboardingSetPackageStatus,
  useOnboardingCreateTaskTemplate, useOnboardingUpdateTaskTemplate, useOnboardingDeleteTaskTemplate,
  useOnboardingCreateHandoffTemplate, useOnboardingUpdateHandoffTemplate, useOnboardingDeleteHandoffTemplate,
  useOnboardingActionTemplates, useOnboardingCreateActionTemplate, useOnboardingUpdateActionTemplate, useOnboardingRetireActionTemplate,
} from '@api/hr/onboarding';
import type {
  OnboardingTaskTemplateRow, OnboardingHandoffTemplateRow, OnboardingActionTemplate,
  OnboardingActionType, OnboardingOwnerType, OnboardingActionPriority,
} from '../../../../types/hrOnboarding';
import { humanize } from './onboardingStatus';
import './onboardingCase.css';

type PkgTab = 'tasks' | 'handoffs' | 'actions';
const TABS: TabDef<PkgTab>[] = [
  { key: 'tasks', label: 'Task templates' },
  { key: 'handoffs', label: 'Handoff templates' },
  { key: 'actions', label: 'Custom actions' },
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
};

export function OnboardingPackageDetail({
  packageKey, onBack, onToast,
}: { packageKey: string; onBack: () => void; onToast: (m: string) => void }): VNode {
  const [tab, setTab] = useState<PkgTab>('tasks');
  const [editOpen, setEditOpen] = useState(false);
  const [editForm, setEditForm] = useState({ label: '', description: '', defaultSlaDays: '10', defaultOwnerRole: '', workerTypes: '' });
  const [taskModal, setTaskModal] = useState<typeof emptyTaskForm | null>(null);
  const [handoffModal, setHandoffModal] = useState<typeof emptyHandoffForm | null>(null);
  const [actionModal, setActionModal] = useState<typeof emptyActionForm | null>(null);

  const detailQ = useOnboardingPackageDetail(packageKey);
  const pkg = detailQ.data;
  const actionsQ = useOnboardingActionTemplates(packageKey, true);
  const actions = actionsQ.data ?? [];

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
    setEditForm({ label: pkg!.label, description: pkg!.description ?? '', defaultSlaDays: String(pkg!.defaultSlaDays), defaultOwnerRole: pkg!.defaultOwnerRole ?? '', workerTypes: pkg!.workerTypes.join(', ') });
    setEditOpen(true);
  }
  async function submitEdit(): Promise<void> {
    await run(() => updatePkgMut.mutateAsync({
      id: pkg!.id, label: editForm.label.trim() || undefined, description: editForm.description.trim() || null,
      defaultSlaDays: Number(editForm.defaultSlaDays) || undefined, defaultOwnerRole: editForm.defaultOwnerRole.trim() || null,
      workerTypes: editForm.workerTypes.split(',').map(s => s.trim()).filter(Boolean),
    }), 'Package updated');
    setEditOpen(false);
  }
  async function handleStatusStep(): Promise<void> {
    const next = pkg!.status === 'draft' ? 'active' : pkg!.status === 'active' ? 'retired' : 'draft';
    const label = next === 'active' ? 'Activate' : next === 'retired' ? 'Retire' : 'Restore to draft';
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
  function openAddAction(): void { setActionModal(emptyActionForm); }
  function openEditAction(a: OnboardingActionTemplate): void {
    setActionModal({
      id: a.id, actionName: a.actionName, actionType: a.actionType, ownerType: a.ownerType,
      ownerRole: a.ownerRole ?? '', ownerEmployeeId: a.ownerEmployeeId ?? '', dueOffsetDays: a.dueOffsetDays != null ? String(a.dueOffsetDays) : '',
      priority: a.priority, isRequired: a.isRequired, blocksOnboarding: a.blocksOnboarding, requiresEvidence: a.requiresEvidence,
      workflowTemplateId: a.workflowTemplateId ?? '',
    });
  }
  async function submitAction(): Promise<void> {
    const f = actionModal!;
    if (!f.actionName.trim()) { onToast('Action name is required'); return; }
    if (f.actionType === 'custom_approval' && !f.workflowTemplateId.trim()) { onToast('A workflow template ID is required for a custom approval action'); return; }
    const patch = {
      actionName: f.actionName.trim(), actionType: f.actionType, ownerType: f.ownerType,
      ownerRole: f.ownerType === 'role' ? f.ownerRole.trim() || null : null, ownerEmployeeId: f.ownerType === 'employee' ? f.ownerEmployeeId.trim() || null : null,
      dueOffsetDays: f.dueOffsetDays.trim() ? Number(f.dueOffsetDays) : undefined, priority: f.priority,
      isRequired: f.isRequired, blocksOnboarding: f.blocksOnboarding, requiresEvidence: f.requiresEvidence,
      workflowTemplateId: f.actionType === 'custom_approval' ? f.workflowTemplateId.trim() : null,
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

  return (
    <div class="hr-onboarding-packages">
      <button class="obx-back" onClick={onBack}>← Packages</button>

      <PageHeader
        icon="fa-boxes-stacked"
        module="HR · Onboarding"
        title={pkg.label}
        sub={`${pkg.key} · v${pkg.versionNo}`}
        meta={[
          { icon: 'fa-circle-dot', label: humanize(pkg.status) },
          { icon: 'fa-clock', label: `${pkg.defaultSlaDays} day SLA` },
          { icon: 'fa-user', label: pkg.defaultOwnerRole ? humanize(pkg.defaultOwnerRole) : 'No default owner' },
        ]}
        actions={
          <div class="obx-actions">
            <button class="obx-btn" onClick={openEdit}>Edit details</button>
            <button class={`obx-btn${pkg.status === 'draft' ? ' primary' : pkg.status === 'active' ? ' danger' : ''}`} onClick={() => void handleStatusStep()}>
              {pkg.status === 'draft' ? 'Activate' : pkg.status === 'active' ? 'Retire' : 'Restore to draft'}
            </button>
          </div>
        }
      />

      <div style={{ margin: '14px 0' }}><Tabs tabs={TABS} active={tab} onChange={setTab} counts={{ tasks: pkg.taskTemplates.length, handoffs: pkg.handoffTemplates.length, actions: actions.length }} /></div>

      {tab === 'tasks' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-list-check" />Task templates</h2><button class="obx-btn primary obx-btn-sm" onClick={openAddTask}>+ Add</button></div>
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
                    <td><div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditTask(t)}>Edit</button>
                      <button class="obx-mini" onClick={() => void deleteTask(t)}>Delete</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'handoffs' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-arrow-right-arrow-left" />Handoff templates</h2><button class="obx-btn primary obx-btn-sm" onClick={openAddHandoff}>+ Add</button></div>
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
                    <td><div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditHandoff(h)}>Edit</button>
                      <button class="obx-mini" onClick={() => void deleteHandoff(h)}>Delete</button>
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      {tab === 'actions' && (
        <div class="obx-section">
          <div class="obx-section-head"><h2><i class="fas fa-bolt" />Custom actions</h2><button class="obx-btn primary obx-btn-sm" onClick={openAddAction}>+ Add</button></div>
          <div class="obx-section-body">
            {actionsQ.isLoading && !actionsQ.data ? empty('Loading…') : !actions.length ? empty('No custom action templates yet.') : (
              <table class="obx-table">
                <thead><tr><th>Name</th><th>Type</th><th>Owner</th><th>Priority</th><th>Required</th><th>Blocks</th><th>Active</th><th>Actions</th></tr></thead>
                <tbody>{actions.map(a => (
                  <tr key={a.id}>
                    <td><b>{a.actionName}</b></td>
                    <td class="obx-meta">{humanize(a.actionType)}</td>
                    <td class="obx-meta">{a.ownerType === 'employee' ? (a.ownerEmployeeId ?? '—') : a.ownerRole ? humanize(a.ownerRole) : humanize(a.ownerType)}</td>
                    <td><span class="obx-pill blue" style={{ height: 18, padding: '0 8px' }}>{humanize(a.priority)}</span></td>
                    <td>{YN(a.isRequired)}</td>
                    <td>{YN(a.blocksOnboarding)}</td>
                    <td>{YN(a.isActive)}</td>
                    <td><div class="obx-rowbtns">
                      <button class="obx-mini" onClick={() => openEditAction(a)}>Edit</button>
                      {a.isActive && <button class="obx-mini" onClick={() => void retireAction(a)}>Retire</button>}
                    </div></td>
                  </tr>
                ))}</tbody>
              </table>
            )}
          </div>
        </div>
      )}

      <Modal open={editOpen} title="Edit Package" icon="fa-boxes-stacked" onClose={() => setEditOpen(false)} onSubmit={() => void submitEdit()} submitLabel="Save" submitDisabled={updatePkgMut.isPending}>
        <FormGrid>
          <Field label="Label" wide><TextInput value={editForm.label} onInput={v => setEditForm(f => ({ ...f, label: v }))} /></Field>
          <Field label="Default SLA (days)"><TextInput type="number" value={editForm.defaultSlaDays} onInput={v => setEditForm(f => ({ ...f, defaultSlaDays: v }))} /></Field>
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
            {actionModal.actionType === 'custom_approval' && <Field label="Workflow template ID" wide><TextInput value={actionModal.workflowTemplateId} onInput={v => setActionModal(f => f && { ...f, workflowTemplateId: v })} placeholder="UUID of the approval workflow template" /></Field>}
          </FormGrid>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.isRequired} onChange={e => setActionModal(f => f && { ...f, isRequired: (e.target as HTMLInputElement).checked })} /> Required</label>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.blocksOnboarding} onChange={e => setActionModal(f => f && { ...f, blocksOnboarding: (e.target as HTMLInputElement).checked })} /> Blocks activation until complete</label>
          <label class="obx-checkline"><input type="checkbox" checked={actionModal.requiresEvidence} onChange={e => setActionModal(f => f && { ...f, requiresEvidence: (e.target as HTMLInputElement).checked })} /> Requires evidence to complete</label>
        </Modal>
      )}
    </div>
  );
}
