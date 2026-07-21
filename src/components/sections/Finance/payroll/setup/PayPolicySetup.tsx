import { type VNode } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { can } from '@lib/permissions';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { HrfinPill, HrfinWizardModal } from '@ui';
import { usePayComponents } from '@api/finance/statutory';
import { usePayGroups } from '@api/finance/payroll';
import {
  payPoliciesApi, usePayPolicies, usePayPolicy, usePayPolicyMutation,
  type PayPolicyDraftInput, type PayPolicySourceRuleInput, type PayPolicyWorkspace,
} from '@api/finance/payPolicies';
import { buildPayPolicySources, payPolicyDraftStepInvalid } from './payPolicyRules';
import './payPolicySetup.css';

const today = (): string => new Date().toISOString().slice(0, 10);
const key = (): string => crypto.randomUUID();
const title = (v: string): string => v.replace(/_/g, ' ').replace(/\b\w/g, x => x.toUpperCase());
const detailTabs = ['overview', 'components', 'sources', 'costing', 'versions', 'usage', 'audit'] as const;

function replaceQueryValue(name: string, value: string | null): void {
  const url = new URL(window.location.href);
  if (value) url.searchParams.set(name, value);
  else url.searchParams.delete(name);
  window.history.replaceState(window.history.state, '', url);
}

const initialDraft = (): PayPolicyDraftInput => ({
  code: '', name: '', description: '', policyType: 'standard_salary', ownerId: null,
  effectiveFrom: today(), effectiveTo: null, changeSummary: 'Initial governed policy',
  dayBoundary: 'calendar_day', components: [], sourceRules: buildPayPolicySources(false),
});

export function PayPolicySetup(): VNode {
  const [search, setSearch] = useState('');
  const [status, setStatus] = useState('');
  const [cursor, setCursor] = useState<string | undefined>();
  const [cursorHistory, setCursorHistory] = useState<string[]>([]);
  const [selected, setSelected] = useState<string | null>(() => new URLSearchParams(window.location.search).get('policy'));
  const [wizard, setWizard] = useState(false);
  const list = usePayPolicies({ ...(search.trim() ? { search: search.trim() } : {}), ...(status ? { status } : {}), ...(cursor ? { cursor } : {}), limit: 25 });
  const canDraft = can('finance.payroll.policies.draft');
  useEffect(() => {
    replaceQueryValue('policy', selected);
    if (!selected) replaceQueryValue('policyTab', null);
  }, [selected]);

  if (selected) return <PayPolicyDetail policyId={selected} onBack={() => setSelected(null)} />;

  const next = (): void => {
    if (!list.data?.nextCursor) return;
    setCursorHistory(h => [...h, cursor ?? '']);
    setCursor(list.data.nextCursor);
  };
  const previous = (): void => {
    const prior = cursorHistory.at(-1);
    setCursor(prior || undefined);
    setCursorHistory(h => h.slice(0, -1));
  };

  return (
    <div class="pps">
      <div class="pps-actions">
        <div>
          <strong>Pay Policies</strong>
          <span>Effective-Dated T&amp;T Payroll Configuration</span>
        </div>
        <div>
          <button type="button" onClick={() => void list.refetch()}>Refresh</button>
          {canDraft && <button type="button" class="is-primary" onClick={() => setWizard(true)}>New Pay Policy</button>}
        </div>
      </div>
      <div class="pps-tabs" role="tablist" aria-label="Policy Status">
        {['', 'draft', 'active', 'retired'].map(s => (
          <button type="button" role="tab" aria-selected={status === s} class={status === s ? 'active' : ''}
            onClick={() => { setStatus(s); setCursor(undefined); setCursorHistory([]); }}>{s ? title(s) : 'All Policies'}</button>
        ))}
      </div>
      <div class="pps-toolbar">
        <input aria-label="Search Pay Policies" value={search} placeholder="Search By Policy Code Or Name…"
          onInput={e => { setSearch(e.currentTarget.value); setCursor(undefined); setCursorHistory([]); }} />
        <span>{list.data ? `${list.data.total} Policies` : 'Loading Policies'}</span>
      </div>
      <div class="pps-register" aria-live="polite">
        {list.isLoading && !list.data ? <div class="pps-state">Loading Pay Policies…</div>
          : list.isError ? <div class="pps-state is-error">Pay Policies Could Not Be Loaded. <button onClick={() => void list.refetch()}>Retry</button></div>
          : !list.data?.items.length ? <div class="pps-state">No Pay Policies Match This View.</div>
          : (
            <table>
              <thead><tr><th>Policy</th><th>Type</th><th>Current Version</th><th>Effective Period</th><th>Pay Groups</th><th>Status</th><th aria-label="Open" /></tr></thead>
              <tbody>{list.data.items.map(p => (
                <tr key={p.id}>
                  <td><strong>{p.name}</strong><small>{p.code}</small></td>
                  <td>{title(p.policyType)}</td>
                  <td>{p.currentVersion ? `v${p.currentVersion.versionNo}` : '—'}</td>
                  <td>{p.currentVersion ? `${p.currentVersion.effectiveFrom}${p.currentVersion.effectiveTo ? ` – ${p.currentVersion.effectiveTo}` : ' – Open'}` : '—'}</td>
                  <td>{p.assignmentCount}</td>
                  <td><HrfinPill tone={p.status === 'active' ? 'ok' : p.status === 'retired' ? 'nu' : 'wn'}>{title(p.status)}</HrfinPill></td>
                  <td><button type="button" aria-label={`Open ${p.name}`} onClick={() => setSelected(p.id)}>→</button></td>
                </tr>
              ))}</tbody>
            </table>
          )}
      </div>
      <div class="pps-footer">
        <span>{list.data ? `Showing ${list.data.items.length} Of ${list.data.total}` : '—'}</span>
        <div><button type="button" disabled={!cursorHistory.length} onClick={previous}>Previous</button><button type="button" disabled={!list.data?.nextCursor} onClick={next}>Next</button></div>
      </div>
      {wizard && <PayPolicyWizard onClose={() => setWizard(false)} onCreated={id => { setWizard(false); setSelected(id); }} />}
    </div>
  );
}

function PayPolicyWizard({ onClose, onCreated, workspace }: {
  onClose: () => void; onCreated: (id: string) => void; workspace?: PayPolicyWorkspace;
}): VNode {
  const [step, setStep] = useState(0);
  const [draft, setDraft] = useState<PayPolicyDraftInput>(() => workspace?.version ? {
    code: workspace.policy.code, name: workspace.policy.name, description: workspace.policy.description,
    policyType: workspace.policy.policyType, ownerId: workspace.policy.ownerId,
    effectiveFrom: workspace.version.effectiveFrom, effectiveTo: workspace.version.effectiveTo,
    changeSummary: workspace.version.changeSummary, dayBoundary: workspace.version.dayBoundary,
    components: workspace.components.map(({ componentId, calculationBasis, rateSource, eligibilitySource, ruleParameters, required, sortOrder }) => ({
      componentId, calculationBasis, rateSource, eligibilitySource, ruleParameters, required, sortOrder,
    })),
    sourceRules: workspace.sourceRules.map(({ sourceType, ownerRole, required, reconciliationKey, lateInputPolicy, conflictSeverity, conflictOutcome }) => ({
      sourceType, ownerRole, required, reconciliationKey, lateInputPolicy, conflictSeverity, conflictOutcome,
    })),
  } : initialDraft());
  const [selectedComponent, setSelectedComponent] = useState('');
  const components = usePayComponents({ activeOnly: true });
  const create = usePayPolicyMutation(payPoliciesApi.createDraft);
  const update = usePayPolicyMutation(payPoliciesApi.updateDraft);
  const componentMap = useMemo(() => new Map((components.data ?? []).map(c => [c.id, c])), [components.data]);
  const invalid = payPolicyDraftStepInvalid(draft, step);
  const addComponent = (): void => {
    if (!selectedComponent || draft.components.some(x => x.componentId === selectedComponent)) return;
    const hourly = draft.policyType === 'hourly_shift';
    setDraft(d => ({ ...d, components: [...d.components, {
      componentId: selectedComponent, calculationBasis: hourly ? 'approved_hours' : 'salary_period',
      rateSource: hourly ? 'employee_assignment' : 'employee_contract',
      eligibilitySource: hourly ? 'approved_time' : 'approved_compensation',
      ruleParameters: hourly ? {} : { proration: 'working_days' }, required: true, sortOrder: d.components.length,
    }] }));
    setSelectedComponent('');
  };
  const save = async (): Promise<void> => {
    try {
      const clean = { ...draft, code: draft.code.trim().toUpperCase(), name: draft.name.trim(), description: draft.description.trim() };
      const result = workspace?.version
        ? await update.mutateAsync({
          ...clean, policyId: workspace.policy.id, versionId: workspace.version.id,
          expectedLockVersion: workspace.version.lockVersion, idempotencyKey: key(),
        })
        : await create.mutateAsync({ ...clean, idempotencyKey: key() });
      toast(workspace ? 'Pay Policy Draft Updated.' : 'Pay Policy Draft Saved.');
      onCreated(result.policyId);
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Pay Policy Could Not Be Saved.'); }
  };

  return (
    <HrfinWizardModal open title={workspace ? 'Edit Pay Policy Draft' : 'Create Pay Policy'} stepCount={5} activeStep={step} onClose={onClose}
      onBack={step ? () => setStep(s => s - 1) : undefined}
      primaryLabel={step === 4 ? (workspace ? 'Update Draft' : 'Save Draft') : 'Next Step'} primaryLoading={create.isPending || update.isPending} primaryDisabled={invalid}
      onPrimary={() => step === 4 ? void save() : setStep(s => s + 1)}>
      <div class="pps-wiz">
        <header><span>Step {step + 1} Of 5</span><h3>{['Policy Identity', 'Effective Controls', 'Pay Components', 'Source Controls', 'Review & Save'][step]}</h3></header>
        {step === 0 && <>
          <label>Policy Code<input maxLength={20} value={draft.code} onInput={e => setDraft(d => ({ ...d, code: e.currentTarget.value }))} placeholder="TT-MONTHLY" /></label>
          <label>Policy Name<input maxLength={120} value={draft.name} onInput={e => setDraft(d => ({ ...d, name: e.currentTarget.value }))} /></label>
          <label>Policy Type<select value={draft.policyType} onChange={e => {
            const policyType = e.currentTarget.value as PayPolicyDraftInput['policyType'];
            setDraft(d => ({ ...d, policyType, dayBoundary: policyType === 'standard_salary' ? 'calendar_day' : 'shift_start', sourceRules: buildPayPolicySources(policyType === 'hourly_shift'), components: [] }));
          }}><option value="standard_salary">Standard Salary</option><option value="hourly_shift">Hourly / Shift</option></select></label>
          <label>Description<textarea maxLength={1000} value={draft.description} onInput={e => setDraft(d => ({ ...d, description: e.currentTarget.value }))} /></label>
          <div class="pps-fixed"><strong>Fixed Scope</strong><span>SIOMAC-TT · Local Employee · TTD · America/Port_of_Spain</span></div>
        </>}
        {step === 1 && <>
          <label>Effective From<input type="date" value={draft.effectiveFrom} onInput={e => setDraft(d => ({ ...d, effectiveFrom: e.currentTarget.value }))} /></label>
          <label>Effective To (Optional)<input type="date" min={draft.effectiveFrom} value={draft.effectiveTo ?? ''} onInput={e => setDraft(d => ({ ...d, effectiveTo: e.currentTarget.value || null }))} /></label>
          <label>Change Summary<textarea maxLength={500} value={draft.changeSummary} onInput={e => setDraft(d => ({ ...d, changeSummary: e.currentTarget.value }))} /></label>
          <div class="pps-fixed"><strong>Day Boundary</strong><span>{title(draft.dayBoundary)} · Server-Enforced For {title(draft.policyType)}</span></div>
        </>}
        {step === 2 && <>
          <div class="pps-add"><select aria-label="Pay Component" value={selectedComponent} onChange={e => setSelectedComponent(e.currentTarget.value)}>
            <option value="">Select An Active Component</option>
            {(components.data ?? []).filter(c => !c.isStatutory).map(c => <option key={c.id} value={c.id}>{c.code} — {c.name}</option>)}
          </select><button type="button" disabled={!selectedComponent} onClick={addComponent}>Add Component</button></div>
          {components.isLoading ? <div class="pps-state">Loading Components…</div> : draft.components.map((c, index) => (
            <div class="pps-rule" key={c.componentId}><div><strong>{componentMap.get(c.componentId)?.name ?? 'Component'}</strong><small>{title(c.calculationBasis)} · {title(c.rateSource)}</small></div>
              <button type="button" onClick={() => setDraft(d => ({ ...d, components: d.components.filter((_, i) => i !== index) }))}>Remove</button></div>
          ))}
        </>}
        {step === 3 && draft.sourceRules.map((r, i) => (
          <div class="pps-source" key={r.sourceType}><div><strong>{title(r.sourceType)}</strong><small>{title(r.reconciliationKey)}</small></div>
            <select aria-label={`${title(r.sourceType)} Owner`} value={r.ownerRole} onChange={e => setDraft(d => ({ ...d, sourceRules: d.sourceRules.map((x, n) => n === i ? { ...x, ownerRole: e.currentTarget.value as PayPolicySourceRuleInput['ownerRole'] } : x) }))}>
              <option value="hr_manager">HR Manager</option><option value="manager">Line Manager</option><option value="finance_staff">Finance Staff</option><option value="finance_manager">Finance Manager</option>
            </select><span class={r.conflictSeverity === 'blocker' ? 'bad' : ''}>{title(r.conflictOutcome)}</span></div>
        ))}
        {step === 4 && <div class="pps-review">
          <div><span>Policy</span><strong>{draft.code.toUpperCase()} · {draft.name}</strong></div>
          <div><span>Effective</span><strong>{draft.effectiveFrom}{draft.effectiveTo ? ` – ${draft.effectiveTo}` : ' – Open'}</strong></div>
          <div><span>Components</span><strong>{draft.components.length} Governed Bindings</strong></div>
          <div><span>Required Sources</span><strong>{draft.sourceRules.filter(x => x.required).length}</strong></div>
          <div><span>Payment</span><strong>TTD · Primary Bank Account · Missing Account Blocks Release</strong></div>
          <p>Saving creates a server-side draft. Preflight and the three-stage maker-checker path are completed from the policy workspace.</p>
        </div>}
      </div>
    </HrfinWizardModal>
  );
}

function PayPolicyDetail({ policyId, onBack }: { policyId: string; onBack: () => void }): VNode {
  const [tab, setTab] = useState(() => {
    const requested = new URLSearchParams(window.location.search).get('policyTab');
    return requested && detailTabs.includes(requested as typeof detailTabs[number]) ? requested : 'overview';
  });
  const [editWizard, setEditWizard] = useState(false);
  const ws = usePayPolicy(policyId);
  const groups = usePayGroups();
  const submit = usePayPolicyMutation(({ versionId, requestKey }: { versionId: string; requestKey: string }) => payPoliciesApi.submit(versionId, requestKey));
  const activate = usePayPolicyMutation(({ versionId, requestKey }: { versionId: string; requestKey: string }) => payPoliciesApi.activate(policyId, versionId, requestKey));
  const copyVersion = usePayPolicyMutation(payPoliciesApi.copyVersion);
  const assign = usePayPolicyMutation(payPoliciesApi.assign);
  const endAssignment = usePayPolicyMutation(payPoliciesApi.endAssignment);
  const retire = usePayPolicyMutation(payPoliciesApi.retire);
  const [preflight, setPreflight] = useState<Awaited<ReturnType<typeof payPoliciesApi.preflight>> | null>(null);
  const [assignGroup, setAssignGroup] = useState('');
  const [assignFrom, setAssignFrom] = useState(today());
  useEffect(() => replaceQueryValue('policyTab', tab), [tab]);
  if (ws.isLoading) return <div class="pps-state">Loading Policy Workspace…</div>;
  if (ws.isError || !ws.data) return <div class="pps-state is-error">Policy Workspace Could Not Be Loaded. <button onClick={onBack}>Back To Policies</button></div>;
  const d = ws.data;
  const version = d.version;
  const runPreflight = async (): Promise<void> => {
    if (!version) return;
    try { setPreflight(await payPoliciesApi.preflight(version.id)); } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Preflight Failed.'); }
  };
  const doSubmit = async (): Promise<void> => {
    if (!version) return;
    const pf = preflight ?? await payPoliciesApi.preflight(version.id);
    setPreflight(pf);
    if (!pf.ready) return;
    try { await submit.mutateAsync({ versionId: version.id, requestKey: key() }); toast('Pay Policy Submitted For Review.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Submission Failed.'); }
  };
  const doActivate = async (): Promise<void> => {
    if (!version) return;
    const ok = await dialog.confirm({ title: `Activate ${d.policy.code} v${version.versionNo}?`, text: 'Activation independently revalidates the checksum, supersedes the prior effective version, notifies the preparer and sends a payroll handoff.', confirmText: 'Activate Policy', icon: 'question' });
    if (!ok) return;
    try { await activate.mutateAsync({ versionId: version.id, requestKey: key() }); toast('Pay Policy Activated.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Activation Failed.'); }
  };
  const doAssign = async (): Promise<void> => {
    if (!version || !assignGroup) return;
    try { await assign.mutateAsync({ policyId, versionId: version.id, payGroupId: assignGroup, effectiveFrom: assignFrom, idempotencyKey: key() }); setAssignGroup(''); toast('Pay Group Assigned.'); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Assignment Failed.'); }
  };
  const doCopyVersion = async (): Promise<void> => {
    const source = d.versions.find(item => item.status === 'active');
    if (!source) return;
    const effectiveFrom = await dialog.prompt({
      title: 'Create New Policy Version', text: 'Enter the effective date for the new draft (YYYY-MM-DD).',
      value: today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveFrom === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveFrom)) {
      await dialog.error('Enter the effective date as YYYY-MM-DD.');
      return;
    }
    const changeSummary = await dialog.prompt({
      title: 'Change Summary', text: 'Describe the governed change in this version.',
      type: 'textarea', placeholder: 'Required change summary', confirmText: 'Create Draft',
    });
    if (changeSummary === null) return;
    if (changeSummary.trim().length < 3) {
      await dialog.error('A change summary of at least three characters is required.');
      return;
    }
    try {
      await copyVersion.mutateAsync({
        policyId, sourceVersionId: source.id, effectiveFrom, changeSummary: changeSummary.trim(), idempotencyKey: key(),
      });
      toast('New Pay Policy Version Created.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Version Could Not Be Created.'); }
  };
  const doEndAssignment = async (assignmentId: string, effectiveFrom: string): Promise<void> => {
    const effectiveTo = await dialog.prompt({
      title: 'End Pay-Group Assignment', text: 'Enter the final effective date (YYYY-MM-DD).',
      value: effectiveFrom > today() ? effectiveFrom : today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveTo === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo) || effectiveTo < effectiveFrom) {
      await dialog.error('Enter a valid date on or after the assignment start.');
      return;
    }
    const reason = await dialog.prompt({
      title: 'Assignment End Reason', type: 'textarea', placeholder: 'Required reason', confirmText: 'End Assignment',
    });
    if (reason === null) return;
    if (reason.trim().length < 3) {
      await dialog.error('A reason of at least three characters is required.');
      return;
    }
    try {
      await endAssignment.mutateAsync({ policyId, assignmentId, effectiveTo, reason: reason.trim(), idempotencyKey: key() });
      toast('Pay-Group Assignment Ended.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Assignment Could Not Be Ended.'); }
  };
  const doRetire = async (): Promise<void> => {
    const effectiveTo = await dialog.prompt({
      title: `Retire ${d.policy.code}`, text: 'Enter the final effective date (YYYY-MM-DD).',
      value: today(), placeholder: 'YYYY-MM-DD', confirmText: 'Continue',
    });
    if (effectiveTo === null) return;
    if (!/^\d{4}-\d{2}-\d{2}$/.test(effectiveTo)) {
      await dialog.error('Enter the effective date as YYYY-MM-DD.');
      return;
    }
    const reason = await dialog.prompt({
      title: 'Retirement Reason', type: 'textarea', placeholder: 'Required reason', confirmText: 'Retire Policy',
    });
    if (reason === null || reason.trim().length < 3) {
      if (reason !== null) await dialog.error('A reason of at least three characters is required.');
      return;
    }
    try {
      await retire.mutateAsync({ policyId, effectiveTo, reason: reason.trim(), idempotencyKey: key() });
      toast('Pay Policy Retired.');
    } catch (e) { void dialog.error(e instanceof Error ? e.message : 'Policy Could Not Be Retired.'); }
  };
  return (
    <div class="pps pps-detail">
      <div class="pps-detail-head"><div><button type="button" onClick={onBack}>← Pay Policies</button><h2>{d.policy.name}</h2><span>{d.policy.code} · {title(d.policy.policyType)} · Local T&amp;T / TTD</span></div>
        <div><button type="button" onClick={() => void runPreflight()}>Run Preflight</button>
          {version?.status === 'draft' && can('finance.payroll.policies.draft') && <button type="button" onClick={() => setEditWizard(true)}>Edit Draft</button>}
          {d.policy.status === 'active' && !d.versions.some(x => ['draft', 'pending_approval', 'approved'].includes(x.status))
            && can('finance.payroll.policies.draft') && <button type="button" disabled={copyVersion.isPending} onClick={() => void doCopyVersion()}>Create New Version</button>}
          {version?.status === 'draft' && can('finance.payroll.policies.submit') && <button class="is-primary" type="button" disabled={!preflight?.ready || submit.isPending} onClick={() => void doSubmit()}>Submit For Approval</button>}
          {version?.status === 'approved' && can('finance.payroll.policies.activate') && <button class="is-primary" type="button" disabled={activate.isPending} onClick={() => void doActivate()}>Activate Policy</button>}
          {d.policy.status === 'active' && !d.versions.some(x => ['draft', 'pending_approval', 'approved'].includes(x.status))
            && can('finance.payroll.policies.activate') && <button type="button" disabled={retire.isPending} onClick={() => void doRetire()}>Retire Policy</button>}</div></div>
      <div class="pps-position">
        <div><span>Current Version</span><strong>{version ? `v${version.versionNo}` : '—'}</strong></div>
        <div><span>Version Status</span><strong>{version ? title(version.status) : '—'}</strong></div>
        <div><span>Effective From</span><strong>{version?.effectiveFrom ?? '—'}</strong></div>
        <div><span>Assigned Pay Groups</span><strong>{d.assignments.filter(x => x.status === 'active').length}</strong></div>
      </div>
      {preflight && <div class={`pps-preflight ${preflight.ready ? 'ready' : 'blocked'}`}><strong>{preflight.ready ? 'Configuration Ready' : `${preflight.blockers.length} Configuration Blockers`}</strong>
        <span>{preflight.ready ? `Checksum ${preflight.checksum.slice(0, 12)}…` : preflight.blockers.map(x => x.message).join(' ')}</span></div>}
      <nav class="pps-tabs" aria-label="Pay Policy Sections">{detailTabs.map(x => <button type="button" class={tab === x ? 'active' : ''} onClick={() => setTab(x)}>{title(x === 'costing' ? 'cost & payment' : x)}</button>)}</nav>
      <PolicyTab tab={tab} data={d} groups={groups.data ?? []} assignGroup={assignGroup} setAssignGroup={setAssignGroup}
        assignFrom={assignFrom} setAssignFrom={setAssignFrom} onAssign={doAssign} assigning={assign.isPending}
        onEndAssignment={doEndAssignment} endingAssignment={endAssignment.isPending} />
      {editWizard && <PayPolicyWizard workspace={d} onClose={() => setEditWizard(false)} onCreated={() => setEditWizard(false)} />}
    </div>
  );
}

function PolicyTab({ tab, data, groups, assignGroup, setAssignGroup, assignFrom, setAssignFrom, onAssign, assigning, onEndAssignment, endingAssignment }: {
  tab: string; data: PayPolicyWorkspace; groups: Array<{ id: string; code: string; name: string }>; assignGroup: string;
  setAssignGroup: (v: string) => void; assignFrom: string; setAssignFrom: (v: string) => void; onAssign: () => void; assigning: boolean;
  onEndAssignment: (assignmentId: string, effectiveFrom: string) => Promise<void>; endingAssignment: boolean;
}): VNode {
  const v = data.version;
  const [compareFrom, setCompareFrom] = useState('');
  const [compareTo, setCompareTo] = useState('');
  const [comparison, setComparison] = useState<Awaited<ReturnType<typeof payPoliciesApi.compare>> | null>(null);
  const compareVersions = async (): Promise<void> => {
    if (!compareFrom || !compareTo) return;
    try { setComparison(await payPoliciesApi.compare(data.policy.id, compareFrom, compareTo)); }
    catch (e) { void dialog.error(e instanceof Error ? e.message : 'Versions Could Not Be Compared.'); }
  };
  if (tab === 'overview') return <section class="pps-panel"><h3>Policy Composition</h3><div class="pps-composition">
    <div><b>1</b><strong>Approved T&amp;T Statutory Version</strong><span>Resolved By Effective Pay Date</span></div>
    <div><b>2</b><strong>{data.components.length} Pay Components</strong><span>Canonical Catalogue Bindings</span></div>
    <div><b>3</b><strong>{data.sourceRules.length} Source Controls</strong><span>Named Owners And Conflict Outcomes</span></div>
    <div><b>4</b><strong>TTD Payment Control</strong><span>Primary Bank Account Required</span></div>
  </div></section>;
  if (tab === 'components') return <section class="pps-panel"><h3>Pay Components</h3><table><thead><tr><th>Component</th><th>Kind</th><th>Calculation Basis</th><th>Rate Source</th><th>Eligibility</th><th>State</th></tr></thead>
    <tbody>{data.components.map(c => <tr><td><strong>{c.componentName}</strong><small>{c.componentCode}</small></td><td>{title(c.componentKind)}</td><td>{title(c.calculationBasis)}</td><td>{title(c.rateSource)}</td><td>{title(c.eligibilitySource)}</td><td>{c.required ? 'Required' : 'Optional'}</td></tr>)}</tbody></table></section>;
  if (tab === 'sources') return <section class="pps-panel"><h3>Source Controls</h3>{data.sourceRules.map(s => <div class="pps-source"><div><strong>{title(s.sourceType)}</strong><small>{title(s.reconciliationKey)}</small></div><span>{title(s.ownerRole)}</span><span>{title(s.lateInputPolicy)}</span><span>{title(s.conflictOutcome)}</span></div>)}</section>;
  if (tab === 'costing') return <section class="pps-panel"><h3>Cost &amp; Payment</h3><div class="pps-review">
    <div><span>Payroll Currency</span><strong>TTD</strong></div><div><span>Payment Destination</span><strong>Primary Bank Account</strong></div>
    <div><span>Missing Bank Account</span><strong>Blocks Release</strong></div><div><span>Cost Centre</span><strong>Required From Employee Assignment</strong></div>
  </div></section>;
  if (tab === 'versions') return <section class="pps-panel"><h3>Version History</h3>
    {data.versions.length > 1 && <div class="pps-add">
      <select aria-label="Compare From Version" value={compareFrom} onChange={e => { setCompareFrom(e.currentTarget.value); setComparison(null); }}><option value="">Compare From</option>{data.versions.map(x => <option value={x.id}>v{x.versionNo}</option>)}</select>
      <select aria-label="Compare To Version" value={compareTo} onChange={e => { setCompareTo(e.currentTarget.value); setComparison(null); }}><option value="">Compare To</option>{data.versions.map(x => <option value={x.id}>v{x.versionNo}</option>)}</select>
      <button type="button" disabled={!compareFrom || !compareTo || compareFrom === compareTo} onClick={() => void compareVersions()}>Compare Versions</button>
    </div>}
    {comparison && <div class="pps-preflight ready"><strong>{comparison.changes.length ? `${comparison.changes.length} Governed Changes` : 'No Governed Differences'}</strong>
      <span>{comparison.changes.map(change => title(change.field)).join(', ') || 'The selected versions have identical effective controls, components, and sources.'}</span></div>}
    <table><thead><tr><th>Version</th><th>Effective Period</th><th>Change</th><th>Prepared By</th><th>Checksum</th><th>Status</th></tr></thead>
    <tbody>{data.versions.map(x => <tr><td>v{x.versionNo}</td><td>{x.effectiveFrom}{x.effectiveTo ? ` – ${x.effectiveTo}` : ' – Open'}</td><td>{x.changeSummary}</td><td>{x.preparedBy}</td><td>{x.checksum ? `${x.checksum.slice(0, 12)}…` : '—'}</td><td>{title(x.status)}</td></tr>)}</tbody></table></section>;
  if (tab === 'usage') return <section class="pps-panel"><h3>Pay-Group Assignments</h3>
    {v?.status === 'active' && can('finance.payroll.policies.assign') && <div class="pps-add"><select value={assignGroup} onChange={e => setAssignGroup(e.currentTarget.value)}><option value="">Select Active Pay Group</option>{groups.map(g => <option value={g.id}>{g.code} — {g.name}</option>)}</select><input type="date" value={assignFrom} onInput={e => setAssignFrom(e.currentTarget.value)} /><button type="button" disabled={!assignGroup || assigning} onClick={() => void onAssign()}>Assign Pay Group</button></div>}
    {!data.assignments.length ? <div class="pps-state">No Pay Groups Are Assigned.</div> : data.assignments.map(a => <div class="pps-source"><div><strong>{a.payGroupName}</strong><small>{a.payGroupCode} · {a.memberCount} Current Members</small></div><span>{title(a.frequency)}</span><span>v{a.versionNo} From {a.effectiveFrom}</span><span>{title(a.status)}</span>
      {a.status === 'active' && can('finance.payroll.policies.assign') && <button type="button" disabled={endingAssignment} onClick={() => void onEndAssignment(a.id, a.effectiveFrom)}>End Assignment</button>}</div>)}</section>;
  return <section class="pps-panel"><h3>Policy Audit History</h3>{!data.audit.length ? <div class="pps-state">No Policy Events Yet.</div> : data.audit.map(e => <div class="pps-source"><div><strong>{title(e.type.replace('finance.payroll.policy.', ''))}</strong><small>{new Date(e.occurredAt).toLocaleString()}</small></div><span>{e.actorId ?? 'System'}</span></div>)}</section>;
}
