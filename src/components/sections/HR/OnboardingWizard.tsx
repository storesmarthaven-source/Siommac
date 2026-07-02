/**
 * src/components/sections/HR/OnboardingWizard.tsx
 *
 * HR ▸ Employee Master — Start Onboarding wizard (v36 §10), on the shared @ui
 * <WizardShell> (dark rail: section title + step nav + Current Batch / Permissions
 * panels). A long controlled form (not step-gated, matching v36): Worker & Trigger
 * → Onboarding Package cards → Task Plan & Handoffs (live preview) → Options →
 * Review. Wired to routes/hrOnboarding.ts; the intake fields (reason/priority/
 * target start/case owner/worker type/launch mode) persist on the case.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useEffect, useMemo, useState } from 'preact/hooks';
import { useQueryClient } from '@tanstack/preact-query';
import { WizardShell, type WizardStepDef } from '@ui';
import { hrOnboardingApi, useOnboardingPackages, useOnboardingActionTemplates, type OnboardingPreview } from '@api/hr/onboarding';
import { useHrEmployees, type HrEmployeeRow } from '@api/hr/employees';
import { hrEmployeeKeys } from '@api/queryKeys';
import { rowName, Avatar } from './shared';
import { humanize } from './onboardingStatus';

const STEPS: WizardStepDef[] = [
  { key: 'worker',  label: 'Worker',  sub: 'Person and trigger',  icon: 'fa-user' },
  { key: 'package', label: 'Package', sub: 'Checklist package',    icon: 'fa-box-open' },
  { key: 'plan',    label: 'Plan',    sub: 'Tasks & handoffs',     icon: 'fa-list-check' },
  { key: 'actions', label: 'Actions', sub: 'Custom action templates', icon: 'fa-bolt' },
  { key: 'options', label: 'Options', sub: 'Owner & due date',     icon: 'fa-sliders' },
  { key: 'review',  label: 'Review',  sub: 'Start case',           icon: 'fa-circle-check' },
];
const REASONS = ['New hire', 'Rehire', 'Role change', 'Contract conversion', 'Transfer in'];
const PRIORITIES = ['Normal', 'High', 'Urgent'];
const CASE_OWNERS = ['HR Operations', 'HR Manager', 'Site HR', 'Talent Team'];
const WORKER_TYPES = ['Employee', 'Contractor', 'Intern', 'Temporary'];
const LAUNCH_MODES = ['Start now', 'Scheduled'];
const cap = (s: string) => s.replace(/[_-]+/g, ' ').replace(/\b\w/g, c => c.toUpperCase());

function Fld({ label, children, full }: { label: string; children: ComponentChildren; full?: boolean }): VNode {
  return <div class={`form-field ${full ? 'full' : ''}`}><label>{label}</label>{children}</div>;
}
function Sel({ value, onInput, options }: { value: string; onInput: (v: string) => void; options: string[] }): VNode {
  return <select value={value} onChange={e => onInput(e.currentTarget.value)}>{options.map(o => <option value={o}>{o}</option>)}</select>;
}
function Section({ id, title, desc, children }: { id: string; title: string; desc: string; children: ComponentChildren }): VNode {
  return (
    <section class="form-section" id={`wz-onb-${id}`} style={{ scrollMarginTop: '8px' }}>
      <div class="form-section-head"><div><h4>{title}</h4><p>{desc}</p></div></div>
      {children}
    </section>
  );
}

export function OnboardingWizard(
  { onClose, onToast, employeeId: preset }:
  { onClose: () => void; onToast: (m: string) => void; employeeId?: string | null },
): VNode {
  const qc = useQueryClient();
  const empQ = useHrEmployees({ limit: 500 });
  const employees: HrEmployeeRow[] = useMemo(() => empQ.data ?? [], [empQ.data]);

  const [step, setStep] = useState('worker');
  const [employeeId, setEmployeeId] = useState(preset ?? '');
  const [packageKey, setPackageKey] = useState('standard_employee');
  const { data: packages = [] } = useOnboardingPackages();
  const [reason, setReason] = useState('New hire');
  const [priority, setPriority] = useState('Normal');
  const [targetStartDate, setTargetStartDate] = useState('');
  const [caseOwner, setCaseOwner] = useState('HR Operations');
  const [workerType, setWorkerType] = useState('Employee');
  const [launchMode, setLaunchMode] = useState('Start now');
  const [ownerId, setOwnerId] = useState('');
  const [dueAt, setDueAt] = useState('');
  const [preview, setPreview] = useState<OnboardingPreview | null>(null);
  const [busy, setBusy] = useState(false);
  const [error, setError] = useState<string | null>(null);
  const [done, setDone] = useState<{ caseNo: string; taskCount: number } | null>(null);
  const [includedActionIds, setIncludedActionIds] = useState<Set<string>>(new Set());

  const selectedEmp = employees.find(e => e.id === employeeId);
  const empName = selectedEmp ? rowName(selectedEmp) : '';
  const ownerUser = employees.find(e => e.id === ownerId);
  const ownerName = ownerUser ? rowName(ownerUser) : '';
  const pkg = packages.find(p => p.key === packageKey);
  const { data: actionTemplates = [] } = useOnboardingActionTemplates(packageKey);

  // Default worker type from the chosen employee's contractor flag.
  useEffect(() => { if (selectedEmp) setWorkerType(selectedEmp.contractor_flag ? 'Contractor' : 'Employee'); }, [employeeId]);

  // Live task-plan preview for the selected package (drives Current Batch + the Plan section).
  useEffect(() => {
    let off = false;
    hrOnboardingApi.preview({ packageKey }).then(p => { if (!off) setPreview(p); }).catch(() => { if (!off) setPreview(null); });
    return () => { off = true; };
  }, [packageKey]);

  // The query already excludes inactive templates, so every returned template defaults to
  // included (they're recommended by the package); switching packages resets the selection.
  // Required templates stay included — see the disabled checkbox in the Actions step.
  useEffect(() => { setIncludedActionIds(new Set(actionTemplates.map(t => t.id))); }, [actionTemplates]);
  function toggleAction(id: string, isRequired: boolean): void {
    if (isRequired) return;
    setIncludedActionIds(prev => { const next = new Set(prev); if (next.has(id)) next.delete(id); else next.add(id); return next; });
  }

  function go(key: string) {
    setStep(key);
    document.getElementById(`wz-onb-${key}`)?.scrollIntoView({ behavior: 'smooth', block: 'start' });
  }

  function start() {
    if (!employeeId) { setError('Select the employee to onboard.'); go('worker'); return; }
    setBusy(true); setError(null);
    hrOnboardingApi.start({
      employeeId, packageKey, ownerId: ownerId || null, dueAt: dueAt || null,
      reason, priority, targetStartDate: targetStartDate || null,
      launchMode, caseOwner, workerType: workerType.toLowerCase(),
      includeActionTemplateIds: Array.from(includedActionIds),
    }).then(r => {
      setDone({ caseNo: r.caseNo, taskCount: r.taskCount });
      qc.invalidateQueries({ queryKey: hrEmployeeKeys.all });
      onToast(`Onboarding started — ${r.caseNo} (${r.taskCount} tasks)`);
    }).catch(e => setError(e instanceof Error ? e.message : 'Request failed.')).finally(() => setBusy(false));
  }

  const info = [
    { title: 'Current Batch', rows: [
      { label: 'Selected worker', value: selectedEmp?.employee_number ?? empName ?? '—' },
      { label: 'Recommended package', value: pkg?.label ?? '—', highlight: true },
      { label: 'Generated tasks', value: preview ? String(preview.taskCount) : '—' },
      { label: 'Priority', value: priority },
      { label: 'Worker type', value: workerType },
    ] },
    { title: 'Permissions & Audit', rows: [
      { label: 'Permission', value: 'HR controlled' },
      { label: 'Reason required', value: 'Sensitive changes' },
    ] },
  ];

  const footer = done
    ? <button class="ui-btn-primary" type="button" onClick={onClose}>Done</button>
    : <>
        <button class="ui-btn-secondary" type="button" onClick={onClose}>Cancel</button>
        <button class="ui-btn-primary" type="button" disabled={busy} onClick={start}>{busy ? 'Starting…' : 'Start Onboarding'}</button>
      </>;

  return (
    <WizardShell
      open title="Start Onboarding" railTitle="Start Onboarding" railSubtitle="Launch controlled onboarding tasks"
      steps={STEPS} activeStep={step} onStep={go} info={info}
      footNote="Launches an onboarding case and downstream handoffs." footer={footer} onClose={onClose}
    >
      {error && <div class="warning-card">{error}</div>}
      {done && <div class="info-strip">Onboarding case <strong>{done.caseNo}</strong> created with {done.taskCount} tasks. Handoff intents recorded for the downstream modules.</div>}

      <Section id="worker" title="1. Worker &amp; Trigger" desc="Select the employee or worker and define why onboarding is being started.">
        {selectedEmp
          ? <div class="form-field full"><div class="employee-cell">
              <Avatar name={empName} img={selectedEmp.profile_image_url} />
              <div style={{ minWidth: 0 }}>
                <div class="emp-name">{empName}</div>
                <div class="emp-email">{[selectedEmp.employee_number, selectedEmp.position, selectedEmp.departmentName].filter(Boolean).join(' · ') || '—'}</div>
              </div>
            </div></div>
          : null}
        <div class="form-grid">
          <Fld label="Employee" full>
            <select value={employeeId} onChange={e => setEmployeeId(e.currentTarget.value)}>
              <option value="">Select employee…</option>
              {employees.map(e => <option value={e.id}>{rowName(e)}</option>)}
            </select>
          </Fld>
          <Fld label="Onboarding Reason"><Sel value={reason} onInput={setReason} options={REASONS} /></Fld>
          <Fld label="Onboarding Priority"><Sel value={priority} onInput={setPriority} options={PRIORITIES} /></Fld>
          <Fld label="Target Start Date"><input type="date" value={targetStartDate} onInput={e => setTargetStartDate(e.currentTarget.value)} /></Fld>
          <Fld label="Case Owner"><Sel value={caseOwner} onInput={setCaseOwner} options={CASE_OWNERS} /></Fld>
          <Fld label="Worker Type"><Sel value={workerType} onInput={setWorkerType} options={WORKER_TYPES} /></Fld>
          <Fld label="Launch Mode"><Sel value={launchMode} onInput={setLaunchMode} options={LAUNCH_MODES} /></Fld>
        </div>
      </Section>

      <Section id="package" title="2. Onboarding Package" desc="Choose the package that determines task templates, owners, dependencies, and required policy packs.">
        <div class="ui-wz-card-grid cols-3">
          {packages.map(p => (
            <button type="button" key={p.key} class={`ui-wz-card${packageKey === p.key ? ' active' : ''}`} onClick={() => setPackageKey(p.key)}>
              <strong>{p.label}</strong>
              <div class="ui-wz-card-meta">{packageKey === p.key && preview ? `${preview.taskCount} tasks · ` : ''}{p.owners}</div>
              <div class="ui-wz-card-desc">{p.description}</div>
            </button>
          ))}
        </div>
      </Section>

      <Section id="plan" title="3. Task Plan, Owners &amp; Handoffs" desc={preview ? `${preview.label} — ${preview.taskCount} tasks. Created when you start onboarding.` : 'Select a package to preview its tasks and handoffs.'}>
        {preview
          ? <>
              <div class="ui-stat-tiles" style={{ gridTemplateColumns: 'repeat(4, minmax(0,1fr))', marginBottom: '12px' }}>
                <div class="ui-stat-tile"><small>Tasks</small><strong>{preview.taskCount}</strong><span>Generated from package</span></div>
                <div class="ui-stat-tile"><small>Owners</small><strong>{new Set(preview.tasks.map(t => t.ownerRole)).size}</strong><span>Distinct owner roles</span></div>
                <div class="ui-stat-tile"><small>Handoffs</small><strong>{preview.handoffs.length}</strong><span>Cross-module intents</span></div>
                <div class="ui-stat-tile"><small>Modules</small><strong>{new Set([...preview.tasks.map(t => t.moduleKey || 'hr'), ...preview.handoffs.map(h => h.targetModule)]).size}</strong><span>Involved modules</span></div>
              </div>
              <table class="mini-table"><thead><tr><th>Task</th><th>Owner</th><th>Module</th></tr></thead><tbody>
                {preview.tasks.map(t => <tr><td>{t.taskTitle}</td><td>{cap(t.ownerRole)}</td><td>{t.moduleKey ? cap(t.moduleKey) : 'HR'}</td></tr>)}
              </tbody></table>
              {preview.handoffs.length > 0 && <table class="mini-table" style={{ marginTop: '12px' }}><thead><tr><th>Target module</th><th>Handoff</th></tr></thead><tbody>
                {preview.handoffs.map(h => <tr><td>{cap(h.targetModule)}</td><td>{cap(h.handoffType)}</td></tr>)}
              </tbody></table>}
              <div class="info-strip" style={{ marginTop: '12px' }}>Handoffs are recorded as intents + emit events; delivery to HSE/Training/Payroll is a later phase.</div>
            </>
          : <div class="em-empty">Loading task plan…</div>}
      </Section>

      <Section id="actions" title="4. Custom Actions" desc="Package-level action templates. Included actions are created on the case when onboarding starts.">
        {actionTemplates.length === 0
          ? <div class="em-empty">This package has no custom action templates.</div>
          : <div class="summary-list">
              {actionTemplates.map(t => (
                <label key={t.id} class="obx-checkline" style={{ marginTop: 0, padding: '8px 0', borderBottom: '1px solid var(--border, #eef2f7)' }}>
                  <input type="checkbox" checked={includedActionIds.has(t.id)} disabled={t.isRequired}
                    onChange={() => toggleAction(t.id, t.isRequired)} />
                  <span style={{ flex: 1 }}>
                    <strong>{t.actionName}</strong>
                    <span style={{ color: 'var(--text-muted, #64748b)', marginLeft: 8 }}>{humanize(t.actionType)} · {humanize(t.ownerType)}{t.ownerRole ? ` (${t.ownerRole})` : ''}</span>
                  </span>
                  {t.isRequired && <span class="setting-pill">Required</span>}
                  {t.blocksOnboarding && <span class="setting-pill">Blocking</span>}
                </label>
              ))}
            </div>}
      </Section>

      <Section id="options" title="5. Options" desc="Assign the case owner (a specific user) and an optional target due date.">
        <div class="form-grid">
          <Fld label="Case Owner (user)">
            <select value={ownerId} onChange={e => setOwnerId(e.currentTarget.value)}>
              <option value="">Me (default)</option>
              {employees.map(e => <option value={e.id}>{rowName(e)}</option>)}
            </select>
          </Fld>
          <Fld label="Due Date"><input type="date" value={dueAt} onInput={e => setDueAt(e.currentTarget.value)} /></Fld>
        </div>
      </Section>

      <Section id="review" title="6. Review" desc="Creates the onboarding case, its tasks, the handoff intents, and any included custom actions.">
        <div class="summary-list">
          <div class="summary-item"><span>Employee</span><strong>{empName || '—'}</strong></div>
          <div class="summary-item"><span>Reason · Priority</span><strong>{reason} · {priority}</strong></div>
          <div class="summary-item"><span>Package</span><strong>{pkg?.label ?? cap(packageKey)}</strong></div>
          <div class="summary-item"><span>Tasks</span><strong>{preview ? preview.taskCount : '—'}</strong></div>
          <div class="summary-item"><span>Custom actions</span><strong>{includedActionIds.size} of {actionTemplates.length} included</strong></div>
          <div class="summary-item"><span>Case owner</span><strong>{caseOwner}{ownerName ? ` · ${ownerName}` : ''}</strong></div>
          <div class="summary-item"><span>Launch · Due</span><strong>{launchMode}{dueAt ? ` · ${dueAt}` : ''}</strong></div>
        </div>
      </Section>
    </WizardShell>
  );
}
