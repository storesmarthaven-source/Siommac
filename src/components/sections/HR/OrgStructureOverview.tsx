/**
 * src/components/sections/HR/OrgStructureOverview.tsx
 *
 * HR ▸ Organization — functional-only reference-data console (Phase A). Plain page:
 * header + stat row + org-health panel + tabs (Structure / Positions / Cost Centres).
 * No widget board. Org units = the `departments` tree; positions = hr_positions; cost
 * centres = the shared finance_cost_centers registry. Destructive actions (archive /
 * delete / retire) run a read-only impact preview first. Gated by hr.organization.* /
 * hr.positions.* / hr.cost_centers.*; the backend enforces, the UI just hides.
 */
import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { can } from '@lib/permissions';
import { PageHeader, Modal, Field, FormGrid, TextInput, TextareaInput, SelectInput, Tabs, EmptyState, Callout, FieldList, FieldRow } from '@ui';
import { EnterpriseFormModal, orgPositionContext, orgCostCenterContext, moveOrgUnitContext } from '@/components/common/dialogs';
import {
  useOrgUnits, useOrgStats, useOrgHealth, usePositions, useCostCenters,
  useCreateOrgUnit, useUpdateOrgUnit, useMoveOrgUnit, useArchiveOrgUnit, useDeleteOrgUnit,
  useCreatePosition, useUpdatePosition, useRetirePosition,
  useCreateCostCenter, useUpdateCostCenter, useRetireCostCenter,
  useOrgChangeRequests, useCancelOrgChange,
  hrOrganizationApi,
} from '@api/hr/organization';
import { useHrEmployees, useHrSites } from '@api/hr/employees';
import type {
  OrgUnit, OrgUnitType, Position, CostCenter, OrgChangeImpactSummary, PreviewOrgChangeArgs,
  OrgMutationResult, OrgChangeRequest,
} from '../../../../types/hrOrganization';
import './onboardingCase.css';
import './orgStructure.css';

interface Opt { value: string; label: string }
const ORG_UNIT_TYPES: OrgUnitType[] = ['company', 'division', 'department', 'team', 'crew', 'site_department'];
/** Union-aware toast: applied vs held for approval (Phase B). */
function toastResult(res: OrgMutationResult, appliedMsg: string): void {
  toast(res.mode === 'pendingApproval' ? `Submitted for approval — ${res.riskLevel} risk` : appliedMsg);
}

function titleCase(s: string): string { return s.replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase()); }

// ── Impact-preview confirm modal ─────────────────────────────────────────────────
function ImpactModal({ open, title, impact, confirmLabel, confirmDisabled, busy, onConfirm, onClose }: {
  open: boolean; title: string; impact: OrgChangeImpactSummary | null;
  confirmLabel: string; confirmDisabled: boolean; busy: boolean; onConfirm: () => void; onClose: () => void;
}): VNode {
  const rows: [string, number][] = impact ? ([
    ['Employees affected', impact.affectedEmployees],
    ['Positions affected', impact.affectedPositions],
    ['Child units affected', impact.affectedChildUnits],
    ['Active onboarding cases', impact.affectedOnboardingCases],
    ['Active offboarding cases', impact.affectedOffboardingCases],
    ['Pending change requests', impact.affectedPendingTransfers],
    ['Finance references', impact.affectedFinanceReferences],
  ] as [string, number][]).filter(([, n]) => n > 0) : [];
  return (
    <Modal open={open} title={title} icon="fa-triangle-exclamation" onClose={onClose}
      onSubmit={onConfirm} submitLabel={confirmLabel} submitDisabled={confirmDisabled || busy}>
      {!impact ? <div class="obx-empty">Loading impact…</div> : (
        <div>
          {rows.length === 0 && impact.blockers.length === 0 && impact.warnings.length === 0 && (
            <p class="obx-meta">No dependent records were found. This is safe to proceed.</p>
          )}
          {rows.length > 0 && (
            <table class="obx-table" style={{ marginBottom: 10 }}>
              <tbody>{rows.map(([l, n]) => <tr key={l}><td>{l}</td><td style={{ textAlign: 'right' }}><b>{n}</b></td></tr>)}</tbody>
            </table>
          )}
          {impact.blockers.map(b => <div key={b} class="org-health-item"><span class="org-badge critical">!</span><span class="txt">{b}</span></div>)}
          {impact.warnings.map(w => <div key={w} class="org-health-item"><span class="org-badge warning">!</span><span class="txt">{w}</span></div>)}
          {confirmDisabled && <p class="obx-meta" style={{ marginTop: 10 }}>Resolve the blocker(s) above before this action can proceed.</p>}
        </div>
      )}
    </Modal>
  );
}

// ── Org-unit type guidance (shown live in the New/Edit Unit context panel) ───────
const UNIT_TYPE_INFO: Record<OrgUnitType, { icon: string; blurb: string }> = {
  company:         { icon: 'fa-building',         blurb: 'The legal entity at the top of the tree. Normally only one, with no parent.' },
  division:        { icon: 'fa-diagram-project',  blurb: 'A major grouping under the company (e.g. Operations, Corporate Services).' },
  department:      { icon: 'fa-sitemap',          blurb: 'A functional unit within a division (e.g. Field Operations, Finance, HSE).' },
  team:            { icon: 'fa-people-group',     blurb: 'A working group inside a department, usually with a team lead.' },
  crew:            { icon: 'fa-helmet-safety',    blurb: 'A field crew — the smallest operational unit, typically site-based.' },
  site_department: { icon: 'fa-location-dot',     blurb: 'A department scoped to one project site, for site-specific reporting.' },
};

/** Walk parentId up to the root, returning the ancestor chain (root → …→ parent). */
function ancestorChain(units: OrgUnit[], startId: string | null): OrgUnit[] {
  const byId = new Map(units.map(u => [u.id, u]));
  const chain: OrgUnit[] = [];
  const guard = new Set<string>();
  let cur: OrgUnit | undefined = startId ? byId.get(startId) : undefined;
  while (cur && !guard.has(cur.id)) { guard.add(cur.id); chain.unshift(cur); cur = cur.parentId ? byId.get(cur.parentId) : undefined; }
  return chain;
}

/** A "root › … › unit" placement path string; "Top level" when the id is null. */
function placementPath(units: OrgUnit[], id: string | null): string {
  if (!id) return 'Top level (no parent)';
  const chain = ancestorChain(units, id);
  return chain.length ? chain.map(c => c.name).join(' › ') : 'Top level (no parent)';
}

/** The set of a unit's own id + all descendant ids (moving under any of these is a cycle). */
function selfAndDescendants(units: OrgUnit[], rootId: string): Set<string> {
  const childrenOf = new Map<string, string[]>();
  for (const u of units) {
    const p = u.parentId ?? '';
    (childrenOf.get(p) ?? childrenOf.set(p, []).get(p)!).push(u.id);
  }
  const out = new Set<string>([rootId]);
  const stack = [rootId];
  while (stack.length) {
    const cur = stack.pop()!;
    for (const child of childrenOf.get(cur) ?? []) {
      if (!out.has(child)) { out.add(child); stack.push(child); }
    }
  }
  return out;
}

// ── Org-unit create/edit modal (information-rich: form + live context panel) ──────
function UnitModal({ open, editing, defaultParentId, units, siteOpts, ccOpts, peopleOpts, onClose }: {
  open: boolean; editing: OrgUnit | null; defaultParentId: string | null;
  units: OrgUnit[]; siteOpts: Opt[]; ccOpts: Opt[]; peopleOpts: Opt[]; onClose: () => void;
}): VNode {
  const create = useCreateOrgUnit();
  const update = useUpdateOrgUnit();
  const [f, setF] = useState(() => ({
    name: editing?.name ?? '', code: editing?.code ?? '', orgUnitType: editing?.orgUnitType ?? 'department',
    siteId: editing?.siteId ?? '', managerId: editing?.managerId ?? '', costCenterId: editing?.costCenterId ?? '',
    description: editing?.description ?? '',
  }));

  // ── Live context derived from the current form + the org tree ─────────────────
  const effectiveParentId = editing ? editing.parentId : defaultParentId;
  const chain      = useMemo(() => ancestorChain(units, effectiveParentId), [units, effectiveParentId]);
  const parentUnit = chain.length ? chain[chain.length - 1]! : null;
  const siblings   = useMemo(
    () => units.filter(u => (u.parentId ?? null) === (effectiveParentId ?? null) && u.id !== editing?.id),
    [units, effectiveParentId, editing],
  );
  const codeTrim   = f.code.trim();
  const codeClash  = codeTrim ? units.some(u => u.id !== editing?.id && (u.code ?? '').toLowerCase() === codeTrim.toLowerCase()) : false;
  const typeInfo   = UNIT_TYPE_INFO[f.orgUnitType];
  const inheritSite = !f.siteId && parentUnit?.siteName ? parentUnit.siteName : null;
  const inheritCc   = !f.costCenterId && parentUnit?.costCenterName ? parentUnit.costCenterName : null;
  const previewName = f.name.trim() || 'New unit';

  async function submit(): Promise<void> {
    if (!f.name.trim()) { toast('Name is required'); return; }
    try {
      if (editing) {
        const res = await update.mutateAsync({
          unitId: editing.id, expectedUpdatedAt: editing.updatedAt, name: f.name.trim(), code: f.code.trim() || null,
          orgUnitType: f.orgUnitType, siteId: f.siteId || null, managerId: f.managerId || null,
          costCenterId: f.costCenterId || null, description: f.description.trim() || null,
        });
        toastResult(res, 'Org unit updated');
      } else {
        await create.mutateAsync({
          name: f.name.trim(), code: f.code.trim() || null, orgUnitType: f.orgUnitType,
          parentId: defaultParentId, siteId: f.siteId || null, managerId: f.managerId || null,
          costCenterId: f.costCenterId || null, description: f.description.trim() || null,
        });
        toast('Org unit created');
      }
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to save org unit'); }
  }

  return (
    <Modal open={open} size="lg"
      title={editing ? `Edit "${editing.name}"` : 'New Org Unit'} icon="fa-sitemap"
      sub={editing ? 'Update this unit — changes above the risk threshold route for approval.' : 'Add a unit to the organisation tree. The panel on the right previews where it lands.'}
      onClose={onClose}
      onSubmit={() => void submit()} submitLabel={editing ? 'Save changes' : 'Create unit'}
      submitDisabled={create.isPending || update.isPending}>
      <div class="org-unit-modal">
        {/* ── Left: the form ── */}
        <div class="org-unit-form">
          <FormGrid>
            <Field label="Name" wide><TextInput value={f.name} onInput={v => setF(s => ({ ...s, name: v }))} placeholder="e.g. Field Operations" /></Field>
            <Field label="Code"><TextInput value={f.code} onInput={v => setF(s => ({ ...s, code: v }))} placeholder="e.g. OPS" /></Field>
            <Field label="Type"><SelectInput value={f.orgUnitType} onInput={v => setF(s => ({ ...s, orgUnitType: v as OrgUnitType }))} options={ORG_UNIT_TYPES.map(t => ({ value: t, label: titleCase(t) }))} /></Field>
            <Field label="Manager"><SelectInput value={f.managerId} onInput={v => setF(s => ({ ...s, managerId: v }))} options={peopleOpts} placeholder="— None —" /></Field>
            <Field label="Site"><SelectInput value={f.siteId} onInput={v => setF(s => ({ ...s, siteId: v }))} options={siteOpts} placeholder={inheritSite ? `Inherit: ${inheritSite}` : '— None —'} /></Field>
            <Field label="Cost centre"><SelectInput value={f.costCenterId} onInput={v => setF(s => ({ ...s, costCenterId: v }))} options={ccOpts} placeholder={inheritCc ? `Inherit: ${inheritCc}` : '— None —'} /></Field>
            <Field label="Description" wide><TextareaInput value={f.description} onInput={v => setF(s => ({ ...s, description: v }))} rows={2} /></Field>
          </FormGrid>
        </div>

        {/* ── Right: live context / preview panel ── */}
        <aside class="org-unit-aside">
          <div class="org-unit-block">
            <div class="org-unit-block-head">Placement</div>
            <div class="org-unit-crumbs">
              {chain.length === 0
                ? <span class="cur"><i class="fas fa-crown" aria-hidden="true" /> Top level of the org tree</span>
                : <>
                    {chain.map(c => <span key={c.id} class="crumb">{c.name}<i class="fas fa-angle-right" aria-hidden="true" /></span>)}
                    <span class="cur">{previewName}</span>
                  </>}
            </div>
          </div>

          <div class="org-unit-preview">
            <div class="org-unit-preview-row">
              <span class={`org-type-pill org-type-${f.orgUnitType}`}><i class={`fas ${typeInfo.icon}`} aria-hidden="true" /> {titleCase(f.orgUnitType)}</span>
              {codeTrim && <span class="org-code-chip">{codeTrim.toUpperCase()}</span>}
            </div>
            <div class="org-unit-preview-name">{previewName}</div>
            <p class="org-unit-preview-blurb">{typeInfo.blurb}</p>
          </div>

          <FieldList>
            <FieldRow icon="fa-diagram-project" label="Parent" value={parentUnit ? parentUnit.name : 'None (top level)'} />
            <FieldRow icon="fa-code-branch" label="Sibling units" value={`${siblings.length} under this parent`} />
            {inheritSite && <FieldRow icon="fa-location-dot" label="Site" value={<span>Inherits <b>{inheritSite}</b> from parent</span>} />}
            {inheritCc && <FieldRow icon="fa-coins" label="Cost centre" value={<span>Inherits <b>{inheritCc}</b> from parent</span>} />}
          </FieldList>

          {codeClash && (
            <Callout mark={<i class="fas fa-triangle-exclamation" />} title="Code already in use" status="Duplicate" alert>
              Another unit already uses the code <b>{codeTrim.toUpperCase()}</b>. Codes should be unique.
            </Callout>
          )}

          {!editing && (
            <Callout mark={<i class="fas fa-wand-magic-sparkles" />} title="After you create this unit" status="Next">
              You can attach positions, assign a manager and employees, and nest child units beneath it. Large structural changes route through approval automatically.
            </Callout>
          )}
        </aside>
      </div>
    </Modal>
  );
}

// ── Move modal ───────────────────────────────────────────────────────────────────
function MoveModal({ open, unit, units, unitOpts, onClose }: { open: boolean; unit: OrgUnit; units: OrgUnit[]; unitOpts: Opt[]; onClose: () => void }): VNode {
  const move = useMoveOrgUnit();
  const [parentId, setParentId] = useState<string>(unit.parentId ?? '');
  async function submit(): Promise<void> {
    try {
      const res = await move.mutateAsync({ unitId: unit.id, newParentId: parentId || null, expectedUpdatedAt: unit.updatedAt });
      toastResult(res, 'Org unit moved'); onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to move'); }
  }
  // Can't move a unit under itself or any of its own descendants.
  const blocked = selfAndDescendants(units, unit.id);
  const opts = unitOpts.filter(o => !blocked.has(o.value));
  const cycleWarning = parentId ? blocked.has(parentId) : false;
  const requiresApproval = unit.employeeCount > 0 || unit.positionCount > 0;
  const context = moveOrgUnitContext({
    unitName: unit.name,
    fromPath: placementPath(units, unit.parentId),
    toPath: placementPath(units, parentId || null),
    childCount: unit.childCount, employeeCount: unit.employeeCount, positionCount: unit.positionCount,
    cycleWarning, requiresApproval,
  });
  return (
    <EnterpriseFormModal open
      title={`Move "${unit.name}"`}
      subtitle="Preview the hierarchy impact before moving this unit."
      icon={<i class="fas fa-arrows-up-down-left-right" />}
      context={context}
      primaryLabel={requiresApproval ? 'Submit Move Request' : 'Move Unit'}
      loading={move.isPending}
      disabled={cycleWarning}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="New parent unit" wide><SelectInput value={parentId} onInput={setParentId} options={opts} placeholder="— Top level (no parent) —" /></Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

// ── Position create/edit modal ───────────────────────────────────────────────────
function PositionModal({ open, editing, positions, unitOpts, siteOpts, peopleOpts, positionOpts, onClose }: {
  open: boolean; editing: Position | null; positions: Position[]; unitOpts: Opt[]; siteOpts: Opt[]; peopleOpts: Opt[]; positionOpts: Opt[]; onClose: () => void;
}): VNode {
  const create = useCreatePosition();
  const update = useUpdatePosition();
  const [f, setF] = useState(() => ({
    positionKey: editing?.positionKey ?? '', title: editing?.title ?? '', grade: editing?.grade ?? '',
    departmentId: editing?.departmentId ?? '', siteId: editing?.siteId ?? '', defaultSupervisorId: editing?.defaultSupervisorId ?? '',
    reportsToPositionId: editing?.reportsToPositionId ?? '', headcountBudget: editing?.headcountBudget != null ? String(editing.headcountBudget) : '',
    isSafetyCritical: editing?.isSafetyCritical ?? false,
  }));
  async function submit(): Promise<void> {
    if (!editing && !f.positionKey.trim()) { toast('Position key is required'); return; }
    if (!f.title.trim()) { toast('Title is required'); return; }
    const budget = f.headcountBudget.trim() === '' ? null : Number(f.headcountBudget);
    try {
      if (editing) {
        const res = await update.mutateAsync({
          positionId: editing.id, expectedUpdatedAt: editing.updatedAt, title: f.title.trim(), grade: f.grade.trim() || null,
          departmentId: f.departmentId || null, siteId: f.siteId || null, defaultSupervisorId: f.defaultSupervisorId || null,
          reportsToPositionId: f.reportsToPositionId || null, headcountBudget: budget, isSafetyCritical: f.isSafetyCritical,
        });
        toastResult(res, 'Position updated');
      } else {
        await create.mutateAsync({
          positionKey: f.positionKey.trim(), title: f.title.trim(), grade: f.grade.trim() || null,
          departmentId: f.departmentId || null, siteId: f.siteId || null, defaultSupervisorId: f.defaultSupervisorId || null,
          reportsToPositionId: f.reportsToPositionId || null, headcountBudget: budget, isSafetyCritical: f.isSafetyCritical,
        });
        toast('Position created');
      }
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to save position'); }
  }
  const reportsToOpts = positionOpts.filter(o => o.value !== editing?.id);
  const nameFrom = (opts: Opt[], id: string): string | undefined => (id ? opts.find(o => o.value === id)?.label : undefined);
  const keyTrim = f.positionKey.trim();
  const duplicateKey = !editing && keyTrim ? positions.some(p => p.positionKey.toLowerCase() === keyTrim.toLowerCase()) : false;
  const context = orgPositionContext({
    title: f.title,
    positionKey: f.positionKey,
    departmentName: nameFrom(unitOpts, f.departmentId),
    siteName: nameFrom(siteOpts, f.siteId),
    reportsToTitle: nameFrom(positionOpts, f.reportsToPositionId),
    defaultSupervisorName: nameFrom(peopleOpts, f.defaultSupervisorId),
    headcountBudget: f.headcountBudget.trim() === '' ? null : Number(f.headcountBudget),
    incumbentCount: editing?.incumbentCount ?? 0,
    isSafetyCritical: f.isSafetyCritical,
    duplicateKey,
  });
  return (
    <EnterpriseFormModal open
      title={editing ? 'Edit Position' : 'New Position'}
      subtitle="Define a position, its headcount budget, and reporting structure."
      icon={<i class="fas fa-id-badge" />}
      context={context}
      primaryLabel={editing ? 'Save Position' : 'Create Position'}
      loading={create.isPending || update.isPending}
      disabled={!f.title.trim() || (!editing && !keyTrim) || duplicateKey}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        {!editing && <Field label="Position key"><TextInput value={f.positionKey} onInput={v => setF(s => ({ ...s, positionKey: v }))} placeholder="e.g. field_supervisor" /></Field>}
        <Field label="Title" wide={!!editing}><TextInput value={f.title} onInput={v => setF(s => ({ ...s, title: v }))} placeholder="e.g. Field Supervisor" /></Field>
        <Field label="Grade"><TextInput value={f.grade} onInput={v => setF(s => ({ ...s, grade: v }))} placeholder="e.g. G5" /></Field>
        <Field label="Headcount budget"><TextInput type="number" value={f.headcountBudget} onInput={v => setF(s => ({ ...s, headcountBudget: v }))} placeholder="e.g. 4" /></Field>
        <Field label="Org unit"><SelectInput value={f.departmentId} onInput={v => setF(s => ({ ...s, departmentId: v }))} options={unitOpts} placeholder="— None —" /></Field>
        <Field label="Site"><SelectInput value={f.siteId} onInput={v => setF(s => ({ ...s, siteId: v }))} options={siteOpts} placeholder="— None —" /></Field>
        <Field label="Default supervisor"><SelectInput value={f.defaultSupervisorId} onInput={v => setF(s => ({ ...s, defaultSupervisorId: v }))} options={peopleOpts} placeholder="— None —" /></Field>
        <Field label="Reports to"><SelectInput value={f.reportsToPositionId} onInput={v => setF(s => ({ ...s, reportsToPositionId: v }))} options={reportsToOpts} placeholder="— None —" /></Field>
        <Field label="Safety critical" wide>
          <label style={{ display: 'inline-flex', gap: 8, alignItems: 'center' }}>
            <input type="checkbox" checked={f.isSafetyCritical} onChange={e => setF(s => ({ ...s, isSafetyCritical: (e.target as HTMLInputElement).checked }))} />
            <span class="obx-meta">Vacancies surface as critical health issues</span>
          </label>
        </Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

// ── Cost-centre create/edit modal ────────────────────────────────────────────────
function CostCenterModal({ open, editing, costCenters, units, positions, unitOpts, peopleOpts, onClose }: {
  open: boolean; editing: CostCenter | null; costCenters: CostCenter[]; units: OrgUnit[]; positions: Position[];
  unitOpts: Opt[]; peopleOpts: Opt[]; onClose: () => void;
}): VNode {
  const create = useCreateCostCenter();
  const update = useUpdateCostCenter();
  const [f, setF] = useState(() => ({
    code: editing?.code ?? '', name: editing?.name ?? '', currency: editing?.currency ?? 'TTD',
    annualBudget: editing?.annualBudget != null ? String(editing.annualBudget) : '',
    departmentId: editing?.departmentId ?? '', managerId: editing?.managerId ?? '',
  }));
  async function submit(): Promise<void> {
    if (!f.name.trim()) { toast('Name is required'); return; }
    const budget = f.annualBudget.trim() === '' ? null : Number(f.annualBudget);
    try {
      if (editing) {
        const res = await update.mutateAsync({
          costCenterId: editing.id, expectedUpdatedAt: editing.updatedAt, code: f.code.trim() || null, name: f.name.trim(),
          currency: f.currency.trim() || 'TTD', annualBudget: budget, departmentId: f.departmentId || null, managerId: f.managerId || null,
        });
        toastResult(res, 'Cost centre updated');
      } else {
        await create.mutateAsync({
          code: f.code.trim() || null, name: f.name.trim(), currency: f.currency.trim() || 'TTD',
          annualBudget: budget, departmentId: f.departmentId || null, managerId: f.managerId || null,
        });
        toast('Cost centre created');
      }
      onClose();
    } catch (e) { toast(e instanceof Error ? e.message : 'Failed to save cost centre'); }
  }
  const codeTrim = f.code.trim();
  const duplicateCode = codeTrim ? costCenters.some(c => c.id !== editing?.id && (c.code ?? '').toLowerCase() === codeTrim.toLowerCase()) : false;
  // Positions inherit their cost centre from the org unit they sit in.
  const unitIdsWithCc = editing ? new Set(units.filter(u => u.costCenterId === editing.id).map(u => u.id)) : new Set<string>();
  const positionCount = editing ? positions.filter(p => p.departmentId && unitIdsWithCc.has(p.departmentId)).length : 0;
  const context = orgCostCenterContext({
    name: f.name, code: f.code,
    owningUnitName: unitOpts.find(o => o.value === f.departmentId)?.label,
    ownerName: peopleOpts.find(o => o.value === f.managerId)?.label,
    assignedUnitCount: editing?.assignedUnitCount ?? 0,
    positionCount,
    duplicateCode,
  });
  return (
    <EnterpriseFormModal open
      title={editing ? 'Edit Cost Centre' : 'New Cost Centre'}
      subtitle="Create a shared organisational and financial cost centre."
      icon={<i class="fas fa-coins" />}
      context={context}
      primaryLabel={editing ? 'Save Cost Centre' : 'Create Cost Centre'}
      loading={create.isPending || update.isPending}
      disabled={!f.name.trim() || duplicateCode}
      onCancel={onClose}
      onSubmit={() => void submit()}>
      <FormGrid>
        <Field label="Code"><TextInput value={f.code} onInput={v => setF(s => ({ ...s, code: v }))} placeholder="e.g. CC-1000" /></Field>
        <Field label="Name"><TextInput value={f.name} onInput={v => setF(s => ({ ...s, name: v }))} placeholder="e.g. Operations Payroll" /></Field>
        <Field label="Currency"><TextInput value={f.currency} onInput={v => setF(s => ({ ...s, currency: v }))} placeholder="TTD" /></Field>
        <Field label="Annual budget"><TextInput type="number" value={f.annualBudget} onInput={v => setF(s => ({ ...s, annualBudget: v }))} placeholder="e.g. 500000" /></Field>
        <Field label="Owning unit"><SelectInput value={f.departmentId} onInput={v => setF(s => ({ ...s, departmentId: v }))} options={unitOpts} placeholder="— None —" /></Field>
        <Field label="Manager"><SelectInput value={f.managerId} onInput={v => setF(s => ({ ...s, managerId: v }))} options={peopleOpts} placeholder="— None —" /></Field>
      </FormGrid>
    </EnterpriseFormModal>
  );
}

type Tab = 'structure' | 'positions' | 'costcenters' | 'changerequests';
type ModalState =
  | { kind: 'none' }
  | { kind: 'unit'; editing: OrgUnit | null; parentId: string | null }
  | { kind: 'move'; unit: OrgUnit }
  | { kind: 'position'; editing: Position | null }
  | { kind: 'costcenter'; editing: CostCenter | null };

export function OrgStructureOverview(): VNode {
  const [tab, setTab] = useState<Tab>('structure');
  const [modal, setModal] = useState<ModalState>({ kind: 'none' });
  const [expanded, setExpanded] = useState<Set<string>>(new Set());
  const [impact, setImpact] = useState<{ title: string; data: OrgChangeImpactSummary | null; confirmLabel: string; run: () => Promise<void> } | null>(null);
  const [impactBusy, setImpactBusy] = useState(false);

  const unitsQ = useOrgUnits();
  const statsQ = useOrgStats();
  const healthQ = useOrgHealth();
  const positionsQ = usePositions();
  const ccQ = useCostCenters();
  const peopleQ = useHrEmployees({});
  const sitesQ = useHrSites();

  const archiveMut = useArchiveOrgUnit();
  const deleteMut = useDeleteOrgUnit();
  const activateUnitMut = useUpdateOrgUnit();
  const retirePosMut = useRetirePosition();
  const reactivatePosMut = useUpdatePosition();
  const retireCcMut = useRetireCostCenter();
  const reactivateCcMut = useUpdateCostCenter();

  const canOrg = can('hr.organization.manage');
  const canPos = can('hr.positions.manage');
  const canCc = can('hr.cost_centers.manage');

  const units = unitsQ.data ?? [];
  const unitOpts: Opt[] = useMemo(() => units.map(u => ({ value: u.id, label: u.name })), [units]);
  const siteOpts: Opt[] = useMemo(() => (sitesQ.data ?? []).map(s => ({ value: s.id, label: s.name })), [sitesQ.data]);
  const ccOpts: Opt[] = useMemo(() => (ccQ.data ?? []).map(c => ({ value: c.id, label: c.name })), [ccQ.data]);
  const positionOpts: Opt[] = useMemo(() => (positionsQ.data ?? []).map(p => ({ value: p.id, label: p.title })), [positionsQ.data]);
  const peopleOpts: Opt[] = useMemo(() => (peopleQ.data ?? []).map(e => ({ value: e.id, label: e.full_name ?? e.id })), [peopleQ.data]);

  const childrenOf = useMemo(() => {
    const m = new Map<string, OrgUnit[]>();
    for (const u of units) { const k = u.parentId ?? '__root__'; m.set(k, [...(m.get(k) ?? []), u]); }
    return m;
  }, [units]);

  function toggle(id: string): void { setExpanded(prev => { const n = new Set(prev); if (n.has(id)) n.delete(id); else n.add(id); return n; }); }

  async function runImpact(args: PreviewOrgChangeArgs, title: string, confirmLabel: string, run: () => Promise<void>): Promise<void> {
    setImpact({ title, data: null, confirmLabel, run });
    try { const data = await hrOrganizationApi.previewChange(args); setImpact({ title, data, confirmLabel, run }); }
    catch (e) { setImpact(null); toast(e instanceof Error ? e.message : 'Preview failed'); }
  }
  async function confirmImpact(): Promise<void> {
    if (!impact) return;
    setImpactBusy(true);
    try { await impact.run(); setImpact(null); }
    catch (e) { toast(e instanceof Error ? e.message : 'Action failed'); }
    finally { setImpactBusy(false); }
  }

  // ── unit row actions ──
  function onArchiveUnit(u: OrgUnit): void {
    void runImpact({ entityType: 'org_unit', entityId: u.id, action: 'archive' }, `Archive "${u.name}"?`, 'Archive',
      async () => { const res = await archiveMut.mutateAsync({ unitId: u.id }); toastResult(res, 'Org unit archived'); });
  }
  function onDeleteUnit(u: OrgUnit): void {
    void runImpact({ entityType: 'org_unit', entityId: u.id, action: 'delete' }, `Delete "${u.name}"?`, 'Delete',
      async () => { const res = await deleteMut.mutateAsync({ unitId: u.id }); toastResult(res, 'Org unit deleted'); });
  }
  async function onActivateUnit(u: OrgUnit): Promise<void> {
    if (!await dialog.confirm({ title: `Reactivate "${u.name}"?` })) return;
    try { const res = await activateUnitMut.mutateAsync({ unitId: u.id, expectedUpdatedAt: u.updatedAt, isActive: true }); toastResult(res, 'Org unit reactivated'); }
    catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
  }

  const loadingUnits = unitsQ.isLoading && !unitsQ.data;

  return (
    <div class="hr-org-structure">
      <PageHeader
        icon="fa-sitemap" module="HR · Organization" title="Organization Structure"
        sub="Org units, positions, cost centres &amp; reporting lines."
        meta={[{ icon: 'fa-diagram-project', label: `${units.length} units` }]}
        actions={tab === 'structure' && canOrg ? <button class="obx-btn primary" onClick={() => setModal({ kind: 'unit', editing: null, parentId: null })}>+ New Unit</button>
          : tab === 'positions' && canPos ? <button class="obx-btn primary" onClick={() => setModal({ kind: 'position', editing: null })}>+ New Position</button>
          : tab === 'costcenters' && canCc ? <button class="obx-btn primary" onClick={() => setModal({ kind: 'costcenter', editing: null })}>+ New Cost Centre</button>
          : undefined}
      />

      <StatRow />
      <HealthPanel />

      <Tabs<Tab>
        tabs={[{ key: 'structure', label: 'Structure' }, { key: 'positions', label: 'Positions' }, { key: 'costcenters', label: 'Cost Centres' }, { key: 'changerequests', label: 'Change Requests' }]}
        active={tab} onChange={setTab}
      />

      {tab === 'structure' && (
        <div class="obx-section"><div class="obx-section-body">
          {loadingUnits ? <div class="obx-empty">Loading…</div>
            : !units.length ? <EmptyState icon="fa-sitemap" title="No org units yet" text={canOrg ? 'Create your first unit to build the structure.' : 'No organization units have been defined.'} />
            : (
              <table class="obx-table">
                <thead><tr><th>Name</th><th>Type</th><th>Manager</th><th>Site</th><th>Cost centre</th><th style={{ textAlign: 'center' }}>Emp</th><th style={{ textAlign: 'center' }}>Pos</th><th>Status</th><th>Actions</th></tr></thead>
                <tbody>{renderTree('__root__', 0)}</tbody>
              </table>
            )}
        </div></div>
      )}

      {tab === 'positions' && <PositionsTab />}
      {tab === 'costcenters' && <CostCentersTab />}
      {tab === 'changerequests' && <ChangeRequestsTab />}

      {/* Modals */}
      {modal.kind === 'unit' && <UnitModal open editing={modal.editing} defaultParentId={modal.parentId} units={units} siteOpts={siteOpts} ccOpts={ccOpts} peopleOpts={peopleOpts} onClose={() => setModal({ kind: 'none' })} />}
      {modal.kind === 'move' && <MoveModal open unit={modal.unit} units={units} unitOpts={unitOpts} onClose={() => setModal({ kind: 'none' })} />}
      {modal.kind === 'position' && <PositionModal open editing={modal.editing} positions={positionsQ.data ?? []} unitOpts={unitOpts} siteOpts={siteOpts} peopleOpts={peopleOpts} positionOpts={positionOpts} onClose={() => setModal({ kind: 'none' })} />}
      {modal.kind === 'costcenter' && <CostCenterModal open editing={modal.editing} costCenters={ccQ.data ?? []} units={units} positions={positionsQ.data ?? []} unitOpts={unitOpts} peopleOpts={peopleOpts} onClose={() => setModal({ kind: 'none' })} />}
      <ImpactModal open={!!impact} title={impact?.title ?? ''} impact={impact?.data ?? null} confirmLabel={impact?.confirmLabel ?? 'Confirm'}
        confirmDisabled={(impact?.data?.blockers.length ?? 0) > 0} busy={impactBusy} onConfirm={() => void confirmImpact()} onClose={() => setImpact(null)} />
    </div>
  );

  // ── inner render helpers (closures over state) ──
  function StatRow(): VNode {
    const s = statsQ.data;
    const cells: [string, number | string][] = [
      ['Org units', s?.activeUnitCount ?? 0], ['Positions', s?.activePositionCount ?? 0],
      ['Filled / budgeted', s ? `${s.filledHeadcount} / ${s.budgetedHeadcount}` : '—'],
      ['Cost centres', s?.costCenterCount ?? 0], ['No unit', s?.employeesWithoutUnit ?? 0], ['No supervisor', s?.employeesWithoutSupervisor ?? 0],
    ];
    return <div class="org-stat-row">{cells.map(([l, n]) => <div key={l} class="org-stat"><div class="n">{n}</div><div class="l">{l}</div></div>)}</div>;
  }

  function HealthPanel(): VNode | null {
    const h = healthQ.data;
    if (!h || h.issues.length === 0) return null;
    return (
      <div class="org-health">
        <div class="org-health-head">
          <span>Org health</span>
          {h.criticalCount > 0 && <span class="org-badge critical">{h.criticalCount} critical</span>}
          {h.warningCount > 0 && <span class="org-badge warning">{h.warningCount} warning</span>}
          {h.infoCount > 0 && <span class="org-badge info">{h.infoCount} info</span>}
        </div>
        <div class="org-health-list">
          {h.issues.map(i => (
            <div key={i.id} class="org-health-item">
              <span class={`org-badge ${i.severity}`}>{i.count}</span>
              <span class="txt"><b>{i.title}</b> — {i.description}</span>
            </div>
          ))}
        </div>
      </div>
    );
  }

  function renderTree(parentKey: string, depth: number): VNode[] {
    const kids = (childrenOf.get(parentKey) ?? []).slice().sort((a, b) => a.sortOrder - b.sortOrder || a.name.localeCompare(b.name));
    const out: VNode[] = [];
    for (const u of kids) {
      const hasKids = (childrenOf.get(u.id) ?? []).length > 0;
      const isOpen = expanded.has(u.id);
      out.push(
        <tr key={u.id} style={{ opacity: u.isActive ? 1 : 0.55 }}>
          <td>
            <span class="org-tree-name" style={{ paddingLeft: `${depth * 18}px` }}>
              {hasKids ? <span class="org-tree-toggle" onClick={() => toggle(u.id)}>{isOpen ? '▾' : '▸'}</span> : <span class="org-tree-toggle org-tree-spacer" />}
              <b>{u.name}</b>{u.code ? <span class="obx-meta"> · {u.code}</span> : null}
            </span>
          </td>
          <td class="obx-meta">{titleCase(u.orgUnitType)}</td>
          <td class="obx-meta">{u.managerName ?? '—'}</td>
          <td class="obx-meta">{u.siteName ?? '—'}</td>
          <td class="obx-meta">{u.costCenterName ?? '—'}</td>
          <td class="obx-meta" style={{ textAlign: 'center' }}>{u.employeeCount}</td>
          <td class="obx-meta" style={{ textAlign: 'center' }}>{u.positionCount}</td>
          <td><span class={`obx-pill ${u.isActive ? 'green' : 'gray'}`}>{u.isActive ? 'active' : 'inactive'}</span></td>
          <td onClick={e => e.stopPropagation()}>
            {canOrg ? (
              <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                <button class="obx-mini" onClick={() => setModal({ kind: 'unit', editing: null, parentId: u.id })}>+ Child</button>
                <button class="obx-mini" onClick={() => setModal({ kind: 'unit', editing: u, parentId: null })}>Edit</button>
                <button class="obx-mini" onClick={() => setModal({ kind: 'move', unit: u })}>Move</button>
                {u.isActive
                  ? <button class="obx-mini" onClick={() => onArchiveUnit(u)}>Archive</button>
                  : <button class="obx-mini" onClick={() => void onActivateUnit(u)}>Activate</button>}
                <button class="obx-mini danger" onClick={() => onDeleteUnit(u)}>Delete</button>
              </div>
            ) : <span class="obx-meta">—</span>}
          </td>
        </tr>,
      );
      if (hasKids && isOpen) out.push(...renderTree(u.id, depth + 1));
    }
    return out;
  }

  function PositionsTab(): VNode {
    const [q, setQ] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const all = positionsQ.data ?? [];
    const rows = all.filter(p => (showInactive || p.isActive) && (!q.trim() || p.title.toLowerCase().includes(q.toLowerCase()) || p.positionKey.toLowerCase().includes(q.toLowerCase())));
    function onRetire(p: Position): void {
      void runImpact({ entityType: 'position', entityId: p.id, action: 'retire' }, `Retire "${p.title}"?`, 'Retire',
        async () => { const res = await retirePosMut.mutateAsync({ positionId: p.id }); toastResult(res, 'Position retired'); });
    }
    async function onReactivate(p: Position): Promise<void> {
      if (!await dialog.confirm({ title: `Reactivate "${p.title}"?` })) return;
      try { const res = await reactivatePosMut.mutateAsync({ positionId: p.id, expectedUpdatedAt: p.updatedAt, isActive: true }); toastResult(res, 'Position reactivated'); }
      catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
    }
    return (
      <div class="obx-section"><div class="obx-section-body">
        <div class="org-toolbar">
          <input class="ui-input" style={{ flex: 1 }} placeholder="Search positions…" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} class="obx-meta"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive((e.target as HTMLInputElement).checked)} /> Show inactive</label>
        </div>
        {positionsQ.isLoading && !positionsQ.data ? <div class="obx-empty">Loading…</div>
          : !rows.length ? <EmptyState icon="fa-id-badge" title="No positions" text="No job positions match these filters." />
          : (
            <table class="obx-table">
              <thead><tr><th>Title</th><th>Key</th><th>Org unit</th><th>Grade</th><th>Reports to</th><th style={{ textAlign: 'center' }}>Incumb.</th><th style={{ textAlign: 'center' }}>Budget</th><th style={{ textAlign: 'center' }}>Vacancy</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(p => (
                <tr key={p.id} style={{ opacity: p.isActive ? 1 : 0.55 }}>
                  <td><b>{p.title}</b>{p.isSafetyCritical ? <span class="obx-pill" style={{ marginLeft: 6, background: '#fee2e2', color: '#b91c1c' }}>safety</span> : null}</td>
                  <td class="obx-meta">{p.positionKey}</td>
                  <td class="obx-meta">{p.departmentName ?? '—'}</td>
                  <td class="obx-meta">{p.grade ?? '—'}</td>
                  <td class="obx-meta">{p.reportsToPositionTitle ?? '—'}</td>
                  <td class="obx-meta" style={{ textAlign: 'center' }}>{p.incumbentCount}</td>
                  <td class="obx-meta" style={{ textAlign: 'center' }}>{p.headcountBudget ?? '—'}</td>
                  <td class="obx-meta" style={{ textAlign: 'center' }}>{p.vacancy ?? '—'}</td>
                  <td><span class={`obx-pill ${p.isActive ? 'green' : 'gray'}`}>{p.isActive ? 'active' : 'retired'}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    {canPos ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button class="obx-mini" onClick={() => setModal({ kind: 'position', editing: p })}>Edit</button>
                        {p.isActive ? <button class="obx-mini" onClick={() => onRetire(p)}>Retire</button> : <button class="obx-mini" onClick={() => void onReactivate(p)}>Activate</button>}
                      </div>
                    ) : <span class="obx-meta">—</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div></div>
    );
  }

  function CostCentersTab(): VNode {
    const [q, setQ] = useState('');
    const [showInactive, setShowInactive] = useState(false);
    const all = ccQ.data ?? [];
    const rows = all.filter(c => (showInactive || c.isActive) && (!q.trim() || c.name.toLowerCase().includes(q.toLowerCase()) || (c.code ?? '').toLowerCase().includes(q.toLowerCase())));
    function onRetire(c: CostCenter): void {
      void runImpact({ entityType: 'cost_center', entityId: c.id, action: 'retire' }, `Retire "${c.name}"?`, 'Retire',
        async () => { const res = await retireCcMut.mutateAsync({ costCenterId: c.id }); toastResult(res, 'Cost centre retired'); });
    }
    async function onReactivate(c: CostCenter): Promise<void> {
      if (!await dialog.confirm({ title: `Reactivate "${c.name}"?` })) return;
      try { const res = await reactivateCcMut.mutateAsync({ costCenterId: c.id, expectedUpdatedAt: c.updatedAt, isActive: true }); toastResult(res, 'Cost centre reactivated'); }
      catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
    }
    return (
      <div class="obx-section"><div class="obx-section-body">
        <div class="org-toolbar">
          <input class="ui-input" style={{ flex: 1 }} placeholder="Search cost centres…" value={q} onInput={e => setQ((e.target as HTMLInputElement).value)} />
          <label style={{ display: 'inline-flex', gap: 6, alignItems: 'center' }} class="obx-meta"><input type="checkbox" checked={showInactive} onChange={e => setShowInactive((e.target as HTMLInputElement).checked)} /> Show inactive</label>
        </div>
        {ccQ.isLoading && !ccQ.data ? <div class="obx-empty">Loading…</div>
          : !rows.length ? <EmptyState icon="fa-coins" title="No cost centres" text="No cost centres match these filters." />
          : (
            <table class="obx-table">
              <thead><tr><th>Code</th><th>Name</th><th>Currency</th><th style={{ textAlign: 'right' }}>Annual budget</th><th>Manager</th><th style={{ textAlign: 'center' }}>Units</th><th>Status</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(c => (
                <tr key={c.id} style={{ opacity: c.isActive ? 1 : 0.55 }}>
                  <td class="obx-meta">{c.code ?? '—'}</td>
                  <td><b>{c.name}</b></td>
                  <td class="obx-meta">{c.currency}</td>
                  <td class="obx-meta" style={{ textAlign: 'right' }}>{c.annualBudget != null ? c.annualBudget.toLocaleString() : '—'}</td>
                  <td class="obx-meta">{c.managerName ?? '—'}</td>
                  <td class="obx-meta" style={{ textAlign: 'center' }}>{c.assignedUnitCount}</td>
                  <td><span class={`obx-pill ${c.isActive ? 'green' : 'gray'}`}>{c.isActive ? 'active' : 'retired'}</span></td>
                  <td onClick={e => e.stopPropagation()}>
                    {canCc ? (
                      <div style={{ display: 'flex', gap: 6, flexWrap: 'wrap' }}>
                        <button class="obx-mini" onClick={() => setModal({ kind: 'costcenter', editing: c })}>Edit</button>
                        {c.isActive ? <button class="obx-mini" onClick={() => onRetire(c)}>Retire</button> : <button class="obx-mini" onClick={() => void onReactivate(c)}>Activate</button>}
                      </div>
                    ) : <span class="obx-meta">—</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div></div>
    );
  }

  function ChangeRequestsTab(): VNode {
    const crQ = useOrgChangeRequests({});
    const cancelMut = useCancelOrgChange();
    const rows = crQ.data ?? [];
    async function onCancel(cr: OrgChangeRequest): Promise<void> {
      if (!await dialog.confirm({ title: `Cancel change ${cr.changeNo ?? ''}?` })) return;
      try { await cancelMut.mutateAsync({ changeRequestId: cr.id }); toast('Change request cancelled'); }
      catch (e) { toast(e instanceof Error ? e.message : 'Failed'); }
    }
    const riskTone = (r: string): string => r === 'critical' ? 'critical' : r === 'high' ? 'warning' : 'info';
    return (
      <div class="obx-section"><div class="obx-section-body">
        {crQ.isLoading && !crQ.data ? <div class="obx-empty">Loading…</div>
          : !rows.length ? <EmptyState icon="fa-clipboard-check" title="No change requests" text="High-risk org changes that require approval will appear here." />
          : (
            <table class="obx-table">
              <thead><tr><th>Change</th><th>Entity</th><th>Action</th><th>Risk</th><th>Status</th><th>Effective</th><th>Requested by</th><th>Actions</th></tr></thead>
              <tbody>{rows.map(cr => (
                <tr key={cr.id}>
                  <td class="obx-meta">{cr.changeNo ?? '—'}</td>
                  <td><b>{cr.entityName ?? cr.entityId ?? '—'}</b><div class="obx-meta" style={{ fontSize: 12 }}>{titleCase(cr.entityType)}</div></td>
                  <td class="obx-meta">{titleCase(cr.action)}</td>
                  <td><span class={`org-badge ${riskTone(cr.riskLevel)}`}>{cr.riskLevel}</span></td>
                  <td><span class="obx-pill">{cr.status.replace(/_/g, ' ')}</span></td>
                  <td class="obx-meta">{cr.effectiveFrom ? cr.effectiveFrom.slice(0, 10) : '—'}</td>
                  <td class="obx-meta">{cr.requestedByName ?? '—'}</td>
                  <td onClick={e => e.stopPropagation()}>
                    {canOrg && ['draft', 'pending_approval', 'scheduled', 'approved'].includes(cr.status)
                      ? <button class="obx-mini danger" onClick={() => void onCancel(cr)}>Cancel</button>
                      : <span class="obx-meta">—</span>}
                  </td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div></div>
    );
  }
}
