import { type ComponentChildren, type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import { EmptyState, LucideIcon, PageHeader, Pill, SkeletonText, type LucideName } from '@ui';
import {
  useHrAudit, useHrDocuments, useHrEmployee, useHrTrainingSummary,
  useHrWorkflowSummary, type HrDocument, type HrEmployeeAssignment,
} from '@api/hr/employees';
import { useAdminUserSecurityStatus } from '@api/security';
import { useBankAccounts } from '@api/finance/bankAccounts';
import { useEmployerProfile } from '@api/finance/statutoryForms';
import { useOffboardingCases, useOffboardingCase } from '@api/hr/offboarding';
import { can } from '@lib/permissions';
import { showSection } from '@components/nav/navCore';
import { humanize, statusTone } from './shared';
import type { EmployeeMasterAccess } from './employeeMasterAccess';
import './EmployeeProfilePage.css';

type ProfileTab = 'Overview' | 'Employment' | 'Documents' | 'Readiness' | 'Access' | 'Activity & Audit' | 'Offboarding';

export interface EmployeeProfilePageProps {
  employeeId: string;
  access: EmployeeMasterAccess;
  onBack: () => void;
  onAction: (label: string) => void;
}

const DASH = '—';

function fmtDate(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return DASH;
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-TT', {
    day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit',
  });
}

function tenure(startDate: string | null): string {
  if (!startDate) return 'Not On File';
  const start = new Date(startDate);
  const now = new Date();
  if (Number.isNaN(start.getTime()) || start > now) return 'Not On File';
  let months = (now.getFullYear() - start.getFullYear()) * 12 + now.getMonth() - start.getMonth();
  if (now.getDate() < start.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const rest = months % 12;
  return [
    years ? `${years} ${years === 1 ? 'Year' : 'Years'}` : '',
    rest ? `${rest} ${rest === 1 ? 'Month' : 'Months'}` : '',
  ].filter(Boolean).join(' ') || 'Less Than One Month';
}

function Card({ title, icon, action, wide, children }: {
  title: string; icon: LucideName; action?: ComponentChildren; wide?: boolean; children: ComponentChildren;
}): VNode {
  return (
    <section class={`epf-card${wide ? ' is-wide' : ''}`}>
      <header class="epf-card-head">
        <span class="epf-card-icon"><LucideIcon name={icon} size={18} /></span>
        <h3>{title}</h3>{action && <div class="epf-card-action">{action}</div>}
      </header>
      {children}
    </section>
  );
}

function TextAction({ children, onClick }: { children: ComponentChildren; onClick: () => void }): VNode {
  return <button type="button" class="epf-text-action" onClick={onClick}>{children}<LucideIcon name="ChevronRight" size={15} /></button>;
}

function DetailList({ items }: { items: { icon?: LucideName; label: string; value: ComponentChildren }[] }): VNode {
  return (
    <dl class="epf-detail-list">
      {items.map(item => <div>
        <dt>{item.icon && <LucideIcon name={item.icon} size={15} />}{item.label}</dt>
        <dd>{item.value ?? DASH}</dd>
      </div>)}
    </dl>
  );
}

function Gauge({ value, label = 'Ready' }: { value: number; label?: string }): VNode {
  const safe = Math.max(0, Math.min(100, value));
  return (
    <svg class="epf-gauge" viewBox="0 0 180 112" role="img" aria-label={`${safe} percent ${label.toLowerCase()}`}>
      <path class="epf-gauge-track" pathLength="100" d="M20 92 A70 70 0 0 1 160 92" />
      <path class="epf-gauge-value" pathLength="100" style={{ strokeDasharray: `${safe} 100` }} d="M20 92 A70 70 0 0 1 160 92" />
      <text class="epf-gauge-score" x="90" y="75">{safe}%</text>
      <text class="epf-gauge-label" x="90" y="99">{label}</text>
    </svg>
  );
}

function SectionHead({ title, text, actions }: { title: string; text: string; actions?: ComponentChildren }): VNode {
  return <header class="epf-section-head"><div><h2>{title}</h2><p>{text}</p></div>{actions && <div class="epf-section-actions">{actions}</div>}</header>;
}

function FinanceSnapshot({ employeeId, tab }: { employeeId: string; tab: 'overview' | 'employment' }): VNode {
  const employerQ = useEmployerProfile();
  const bankQ = useBankAccounts({ employeeId });
  const primary = bankQ.data?.find(account => account.isPrimary && account.isActive);
  if (tab === 'overview') {
    return <>{employerQ.isLoading ? 'Loading…' : employerQ.isError ? 'Unavailable' : (employerQ.data?.legalName ?? 'Not Configured')}</>;
  }
  return (
    <div class="epf-grid-2">
      <Card title="Legal Employer" icon="Building2">
        <DetailList items={[
          { label: 'Legal Name', value: employerQ.isError ? 'Unavailable' : (employerQ.data?.legalName ?? 'Not Configured') },
          { label: 'Trading Name', value: employerQ.data?.tradingName ?? DASH },
          { label: 'Jurisdiction', value: employerQ.data?.country ?? 'Trinidad And Tobago' },
        ]} />
      </Card>
      <Card title="Bank & Pay Administration" icon="Landmark">
        <DetailList items={[
          { label: 'Primary Bank', value: bankQ.isError ? 'Unavailable' : (primary?.bankName ?? 'No Primary Account') },
          { label: 'Account', value: primary?.accountNumberMasked ?? DASH },
          { label: 'Account Type', value: primary ? humanize(primary.accountType) : DASH },
          { label: 'Bank Record', value: primary ? <Pill tone="green">Active</Pill> : <Pill tone="amber">Required</Pill> },
        ]} />
      </Card>
    </div>
  );
}

function OffboardingPanel({ employeeId, canStart, onAction }: { employeeId: string; canStart: boolean; onAction: (label: string) => void }): VNode {
  const casesQ = useOffboardingCases(undefined, employeeId);
  const current = casesQ.data?.find(item => !['completed', 'cancelled'].includes(item.status)) ?? null;
  const detailQ = useOffboardingCase(current?.id ?? null);
  if (casesQ.isLoading) return <SkeletonText lines={8} />;
  if (casesQ.isError) return <EmptyState icon="fa-lock" title="Offboarding unavailable" text="The authorised offboarding record could not be loaded." />;
  if (!current) {
    return (
      <div class="epf-offboarding-empty">
        <span><LucideIcon name="LogOut" size={28} /></span>
        <h3>No Active Offboarding Case</h3>
        <p>Starting offboarding creates a governed case, assigns accountable work, and routes cross-team handoffs.</p>
        {canStart && <button type="button" class="ui-btn-primary" onClick={() => onAction('Start Offboarding')}><LucideIcon name="LogOut" size={16} /> Start Offboarding</button>}
        <div class="epf-flow">
          {[
            ['Create Case', 'Capture reason, last working day and accountable owner.'],
            ['Assign Work', 'Schedule HR, payroll and department tasks.'],
            ['Secure Access', 'Route account removal to the authorised support owner.'],
            ['Close Record', 'Verify evidence and complete the audit trail.'],
          ].map(([title, text], index) => <div><span>Step {index + 1}</span><strong>{title}</strong><small>{text}</small></div>)}
        </div>
      </div>
    );
  }
  const detail = detailQ.data;
  return (
    <div class="epf-grid-2">
      <Card title="Active Case" icon="LogOut">
        <DetailList items={[
          { label: 'Case Number', value: current.caseNo },
          { label: 'Reason', value: humanize(current.reason) },
          { label: 'Status', value: <Pill tone={current.status === 'blocked' ? 'red' : 'amber'}>{humanize(current.status)}</Pill> },
          { label: 'Last Working Day', value: fmtDate(current.lastWorkingDay) },
          { label: 'Owner', value: current.ownerName ?? 'Not Assigned' },
        ]} />
      </Card>
      <Card title="Clearance Progress" icon="ListChecks">
        <div class="epf-stat-row">
          <div><strong>{current.taskCount - current.openTaskCount}</strong><span>Completed Tasks</span></div>
          <div><strong>{current.openTaskCount}</strong><span>Open Tasks</span></div>
          <div><strong>{current.blockerCount}</strong><span>Blockers</span></div>
        </div>
        <button type="button" class="ui-btn-secondary" onClick={() => showSection('s-hr-offboarding')}>Open Offboarding Workspace</button>
      </Card>
      <Card title="Tasks & Handoffs" icon="Workflow" wide>
        <div class="epf-table-wrap"><table class="epf-table"><thead><tr><th>Item</th><th>Owner / Module</th><th>Due</th><th>Status</th></tr></thead><tbody>
          {(detail?.tasks ?? []).map(task => <tr><td><strong>{task.taskTitle}</strong></td><td>{task.assignedToName ?? humanize(task.ownerRole ?? task.moduleKey ?? 'Unassigned')}</td><td>{fmtDate(task.dueAt)}</td><td><Pill tone={task.status === 'completed' ? 'green' : task.status === 'blocked' ? 'red' : 'amber'}>{humanize(task.status)}</Pill></td></tr>)}
          {(detail?.handoffs ?? []).map(handoff => <tr><td><strong>{humanize(handoff.handoffType ?? handoff.handoffKey ?? 'Handoff')}</strong></td><td>{humanize(handoff.targetModule)}</td><td>{fmtDate(handoff.createdAt)}</td><td><Pill tone={handoff.status === 'delivered' ? 'green' : 'amber'}>{humanize(handoff.status)}</Pill></td></tr>)}
        </tbody></table></div>
      </Card>
    </div>
  );
}

export function EmployeeProfilePage({ employeeId, access, onBack, onAction }: EmployeeProfilePageProps): VNode {
  const [tab, setTab] = useState<ProfileTab>('Overview');
  const [referenceTime] = useState(() => Date.now());
  const detailQ = useHrEmployee(employeeId);
  const docsQ = useHrDocuments(access.viewDocuments && (tab === 'Overview' || tab === 'Documents' || tab === 'Readiness') ? employeeId : null);
  const trainQ = useHrTrainingSummary(access.viewTraining && (tab === 'Overview' || tab === 'Readiness') ? employeeId : null);
  const auditQ = useHrAudit(access.viewAudit && (tab === 'Overview' || tab === 'Activity & Audit') ? employeeId : null);
  const workflowQ = useHrWorkflowSummary(tab === 'Overview' || tab === 'Readiness' || tab === 'Activity & Audit' ? employeeId : null);
  const mayViewSecurity = can('auth.security.view');
  const securityQ = useAdminUserSecurityStatus(employeeId, mayViewSecurity && (tab === 'Overview' || tab === 'Access'));

  const tabs = useMemo(() => ([
    'Overview', 'Employment',
    ...(access.viewDocuments ? ['Documents'] : []),
    ...((access.viewTraining || access.viewStatutory) ? ['Readiness'] : []),
    'Access',
    ...(access.viewAudit ? ['Activity & Audit'] : []),
    ...(access.startOffboarding || can('hr.offboarding.view') ? ['Offboarding'] : []),
  ] as ProfileTab[]), [access]);

  if (detailQ.isError) {
    return <div class="employee-profile-page"><EmptyState icon="fa-user-slash" title="Employee Record Unavailable" text="Check your access or return to the register and try again." /></div>;
  }
  if (!detailQ.ready || !detailQ.data) return <div class="employee-profile-page"><SkeletonText lines={14} /></div>;

  const d = detailQ.data;
  const employee = d.employee;
  const readiness = employee.readiness;
  const security = securityQ.data;
  const mfaEnabled = !!security && (security.totpEnabled || security.passkeyCount > 0);
  const documents = docsQ.data ?? [];
  const expiring = documents.filter(doc => doc.expiry_date && new Date(doc.expiry_date).getTime() <= referenceTime + 30 * 86_400_000);
  const verifiedDocs = documents.filter(doc => doc.status === 'verified').length;
  const currentAssignment = d.currentAssignment;
  const payrollBlockerDetail = d.payrollReadiness?.blockers.map(humanize).join(' · ');
  const attention: { title: string; detail: string; icon: LucideName; target: ProfileTab; tone: 'danger' | 'warning' }[] = [
    ...(readiness?.blockers.includes('assignment') ? [{ title: 'Assignment Details Need Review', detail: 'Department, work location or supervisor is incomplete.', icon: 'BriefcaseBusiness' as LucideName, target: 'Employment' as ProfileTab, tone: 'danger' as const }] : []),
    ...(readiness?.blockers.includes('payroll') ? [{ title: 'Payroll Readiness Is Blocked', detail: payrollBlockerDetail?.length ? payrollBlockerDetail : 'Review the statutory and payroll setup.', icon: 'BadgeDollarSign' as LucideName, target: 'Readiness' as ProfileTab, tone: 'danger' as const }] : []),
    ...(readiness?.blockers.includes('training') ? [{ title: 'Training Evidence Needs Review', detail: `${trainQ.data?.expired ?? 0} expired · ${trainQ.data?.dueSoon ?? 0} due soon`, icon: 'GraduationCap' as LucideName, target: 'Readiness' as ProfileTab, tone: 'warning' as const }] : []),
    ...(expiring.length ? [{ title: 'Employee Document Expiring', detail: `${expiring.length} document${expiring.length === 1 ? '' : 's'} expire within 30 days.`, icon: 'FileWarning' as LucideName, target: 'Documents' as ProfileTab, tone: 'warning' as const }] : []),
    ...(mayViewSecurity && securityQ.isSuccess && !mfaEnabled ? [{ title: 'MFA Is Not Enrolled', detail: 'Route account assistance to the authorised support owner.', icon: 'ShieldAlert' as LucideName, target: 'Access' as ProfileTab, tone: 'danger' as const }] : []),
  ].slice(0, 3);

  const readinessRows = [
    { name: 'Assignment', value: readiness?.assignmentComplete ? 100 : 0, state: readiness?.assignmentComplete ? 'Complete' : 'Blocked', owner: 'HR Operations' },
    { name: 'Payroll', value: readiness?.payrollStatus === 'ready' ? 100 : 0, state: humanize(readiness?.payrollStatus ?? 'restricted'), owner: 'Payroll Team' },
    { name: 'Training', value: readiness?.trainingStatus === 'current' ? 100 : 0, state: humanize(readiness?.trainingStatus ?? 'restricted'), owner: 'Learning Team' },
    { name: 'Documents', value: documents.length ? Math.round((verifiedDocs / documents.length) * 100) : 0, state: documents.length ? `${verifiedDocs} Of ${documents.length} Verified` : 'No Documents', owner: 'HR Operations' },
  ];

  return (
    <div class="employee-profile-page">
      <PageHeader icon={<LucideIcon name="ContactRound" size={21} />} module="Human Resources" title="Employee Record"
        sub="Complete employee history, authorised administration, and readiness controls."
        actions={<div class="epf-page-actions">
          <button class="ui-btn-secondary" type="button" onClick={onBack}><LucideIcon name="ArrowLeft" size={16} /> Back To Register</button>
          {access.editEmployee && <button class="ui-btn-primary" type="button" onClick={() => onAction('Edit Contact')}><LucideIcon name="Pencil" size={16} /> Edit Employee</button>}
        </div>} />

      <section class="epf-hero" aria-label="Employee Summary">
        <div class="epf-hero-identity">
          <div class="epf-avatar-wrap">
            {employee.profile_image_url ? <img src={employee.profile_image_url} alt="" /> : <span>{(employee.first_name?.[0] ?? employee.username[0] ?? 'E').toUpperCase()}</span>}
            <i class={employee.status === 'active' ? 'is-active' : ''} />
          </div>
          <div>
            <div class="epf-name-line"><h2>{employee.full_name ?? employee.username}</h2><Pill tone={statusTone(employee.status)}>{humanize(employee.status)}</Pill></div>
            <p>{employee.employee_number ?? 'Employee Number Not Assigned'}</p>
            <strong>{employee.position ?? 'Position Not Assigned'}</strong>
            <span>{employee.departmentName ?? 'Department Not Assigned'} · {employee.siteName ?? 'Location Not Assigned'}</span>
          </div>
        </div>
        <div class="epf-hero-facts">
          <div><span>Employment</span><strong>{humanize(employee.employment_type ?? employee.workerType)} · {employee.work_schedule ?? 'Not On File'}</strong><small>{d.payGroup?.name ?? 'Pay Group Not Assigned'}</small></div>
          <div><span>Continuous Service</span><strong>{fmtDate(employee.start_date)}</strong><small>{tenure(employee.start_date)}</small></div>
          <div><span>Current Appointment</span><strong>{fmtDate(currentAssignment?.effective_from)}</strong><small>{currentAssignment?.positionTitle ?? employee.position ?? 'Not Assigned'}</small></div>
          <div><span>Supervisor</span><strong>{employee.supervisorName ?? 'Not Assigned'}</strong><small>{employee.departmentName ?? 'Department Not Assigned'}</small></div>
        </div>
      </section>

      <nav class="epf-tabs" role="tablist" aria-label="Employee Record Sections">
        {tabs.map(item => <button type="button" role="tab" aria-selected={tab === item} class={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </nav>

      <main class="epf-tab-shell">
        {tab === 'Overview' && <>
          <section class="epf-attention">
            <header><LucideIcon name="TriangleAlert" size={19} /><strong>Needs Attention</strong><span>{attention.length}</span></header>
            <div>
              {attention.length ? attention.map(item => <button type="button" class={`is-${item.tone}`} onClick={() => setTab(item.target)}>
                <span><LucideIcon name={item.icon} size={20} /></span><div><strong>{item.title}</strong><small>{item.detail}</small></div><LucideIcon name="ChevronRight" size={17} />
              </button>) : <div class="epf-no-attention"><LucideIcon name="CircleCheckBig" size={20} /> No Employee Record Issues Need Attention.</div>}
            </div>
          </section>
          <div class="epf-grid-3">
            <Card title="Record Readiness" icon="ChartNoAxesCombined" action={<TextAction onClick={() => setTab('Readiness')}>Open Breakdown</TextAction>}>
              {readiness ? <div class="epf-readiness-overview"><Gauge value={readiness.percent} /><div class="epf-progress-list">
                {readinessRows.slice(0, 3).map(row => <div><span>{row.name}</span><i><b style={{ width: `${row.value}%` }} /></i><strong>{row.value}%</strong></div>)}
              </div></div> : <div class="epf-restricted"><LucideIcon name="LockKeyhole" size={18} /> Readiness Is Restricted.</div>}
            </Card>
            <Card title="Employment Snapshot" icon="BriefcaseBusiness" action={<TextAction onClick={() => setTab('Employment')}>Open Employment</TextAction>}>
              <DetailList items={[
                { icon: 'Building2', label: 'Legal Employer', value: can('finance.payroll.statutory_forms.view') ? <FinanceSnapshot employeeId={employeeId} tab="overview" /> : 'Restricted' },
                { icon: 'BadgeCheck', label: 'Employment Basis', value: humanize(employee.employment_type ?? employee.workerType) },
                { icon: 'Clock3', label: 'Work Arrangement', value: employee.work_schedule ?? 'Not On File' },
                { icon: 'ChartNoAxesColumn', label: 'Cost Centre', value: employee.cost_center ?? 'Not Assigned' },
                { icon: 'MapPin', label: 'Work Location', value: employee.siteName ?? 'Not Assigned' },
                { icon: 'WalletCards', label: 'Pay Group', value: d.payGroup?.name ?? 'Not Assigned' },
              ]} />
            </Card>
            <Card title="Contact" icon="Phone">
              <DetailList items={[
                { icon: 'Mail', label: 'Work Email', value: employee.email ?? DASH },
                { icon: 'PhoneCall', label: 'Work Phone', value: employee.phone ?? DASH },
                { icon: 'Smartphone', label: 'Mobile', value: employee.mobile_phone ?? DASH },
                { icon: 'UserRound', label: 'Emergency Contact', value: employee.emergency_contact_name ?? DASH },
                { icon: 'UsersRound', label: 'Relationship', value: employee.emergency_contact_relationship ?? DASH },
                { icon: 'PhoneForwarded', label: 'Emergency Phone', value: employee.emergency_contact_phone ?? DASH },
              ]} />
            </Card>
            <Card title="Recent Employee Activity" icon="Clock3" wide action={<TextAction onClick={() => setTab('Activity & Audit')}>View Full History</TextAction>}>
              <div class="epf-timeline">{(auditQ.data ?? []).slice(0, 4).map(entry => <div><span /><div><strong>{humanize(entry.action)}</strong><small>{humanize(entry.submodule_key ?? 'Employee Record')} · By {entry.actorName ?? 'System'}</small></div><time>{fmtDateTime(entry.created_at)}</time></div>)}</div>
            </Card>
            <Card title="Account Health" icon="ShieldCheck" action={<TextAction onClick={() => setTab('Access')}>Open Access</TextAction>}>
              {!mayViewSecurity ? <div class="epf-restricted"><LucideIcon name="LockKeyhole" size={18} /> Account Health Requires Security Access.</div>
                : securityQ.isLoading ? <SkeletonText lines={5} />
                : securityQ.isError || !security ? <div class="epf-restricted"><LucideIcon name="ShieldAlert" size={18} /> Account Health Is Unavailable.</div>
                : <DetailList items={[
                { icon: 'CircleUserRound', label: 'Account', value: <Pill tone={employee.accountStatus === 'active' ? 'green' : 'red'}>{humanize(employee.accountStatus)}</Pill> },
                { icon: 'ShieldCheck', label: 'MFA', value: <Pill tone={mfaEnabled ? 'green' : 'amber'}>{mfaEnabled ? 'Enabled' : 'Not Enrolled'}</Pill> },
                { icon: 'LogIn', label: 'Last Sign-In', value: fmtDateTime(security.lastSeenAt) },
                { icon: 'KeyRound', label: 'Access Profile', value: d.accessProfile?.label ?? humanize(employee.role) },
                { icon: 'Laptop', label: 'Trusted Devices', value: security.trustedDeviceCount },
                { icon: 'ShieldAlert', label: 'Exceptions', value: mfaEnabled ? <Pill tone="gray">None</Pill> : <Pill tone="amber">MFA</Pill> },
              ]} />}
            </Card>
          </div>
        </>}

        {tab === 'Employment' && <>
          <SectionHead title="Employment" text="Authoritative assignment, terms, service dates, pay administration, and complete employment history."
            actions={<>{access.editEmployee && <button class="ui-btn-primary" type="button" onClick={() => onAction('Edit Employment')}>Edit Employment</button>}</>} />
          <div class="epf-stat-grid">
            <div><span>Employment Status</span><strong>{humanize(employee.status)}</strong><small>{humanize(employee.employment_type ?? employee.workerType)}</small></div>
            <div><span>Continuous Service</span><strong>{tenure(employee.start_date)}</strong><small>Started {fmtDate(employee.start_date)}</small></div>
            <div><span>Current Appointment</span><strong>{fmtDate(currentAssignment?.effective_from)}</strong><small>{currentAssignment?.positionTitle ?? employee.position ?? 'Not Assigned'}</small></div>
            <div><span>Work Arrangement</span><strong>{employee.work_schedule ?? 'Not On File'}</strong><small>{d.payGroup?.name ?? 'Pay Group Not Assigned'}</small></div>
          </div>
          <div class="epf-grid-2">
            <Card title="Current Assignment" icon="BriefcaseBusiness"><DetailList items={[
              { label: 'Position', value: currentAssignment?.positionTitle ?? employee.position ?? 'Not Assigned' },
              { label: 'Department', value: currentAssignment?.departmentName ?? employee.departmentName ?? 'Not Assigned' },
              { label: 'Supervisor', value: currentAssignment?.supervisorName ?? employee.supervisorName ?? 'Not Assigned' },
              { label: 'Work Location', value: currentAssignment?.siteName ?? employee.siteName ?? 'Not Assigned' },
              { label: 'Cost Centre', value: employee.cost_center ?? 'Not Assigned' },
              { label: 'Effective From', value: fmtDate(currentAssignment?.effective_from) },
            ]} /></Card>
            <Card title="Employment Terms" icon="ShieldCheck"><DetailList items={[
              { label: 'Employment Basis', value: humanize(employee.employment_type ?? employee.workerType) },
              { label: 'Work Arrangement', value: employee.work_schedule ?? 'Not On File' },
              { label: 'Start Date', value: fmtDate(employee.start_date) },
              { label: 'End Date', value: fmtDate(employee.end_date) },
              { label: 'Probation End', value: fmtDate(employee.probation_end_date) },
              { label: 'Employee Grade', value: employee.employee_grade ?? 'Not Assigned' },
            ]} /></Card>
            <Card title="HR Administration" icon="ClipboardList"><DetailList items={[
              { label: 'Pay Group', value: d.payGroup?.name ?? 'Not Assigned' },
              { label: 'Pay Frequency', value: d.payGroup ? humanize(d.payGroup.frequency) : DASH },
              { label: 'Worker Category', value: employee.contractor_flag ? 'Contractor' : 'Employee' },
              { label: 'Employee Number', value: employee.employee_number ?? 'Not Assigned' },
              { label: 'Record Created', value: fmtDate(employee.created_at) },
              { label: 'Continuous Service', value: tenure(employee.start_date) },
            ]} /></Card>
            {can('finance.bank_accounts.view') && can('finance.payroll.statutory_forms.view')
              ? <FinanceSnapshot employeeId={employeeId} tab="employment" />
              : <Card title="Pay Administration & Legal Employer" icon="LockKeyhole"><div class="epf-restricted">Finance Capabilities Are Required.</div></Card>}
            {access.viewStatutory && <Card title="Trinidad & Tobago Statutory Status" icon="Landmark" wide><DetailList items={[
              { label: 'NIS Registration', value: <Pill tone={d.statutory?.nis_status === 'verified' ? 'green' : 'amber'}>{humanize(d.statutory?.nis_status ?? 'Not On File')}</Pill> },
              { label: 'Tax Profile', value: d.statutory?.bir_file_number ? <Pill tone="green">On File</Pill> : <Pill tone="amber">Required</Pill> },
              { label: 'PAYE', value: d.statutory?.paye_applicable ? 'Applicable' : 'Not Applicable' },
              { label: 'Payroll Readiness', value: <Pill tone={d.payrollReadiness?.status === 'ready' ? 'green' : 'amber'}>{humanize(d.payrollReadiness?.status ?? 'Restricted')}</Pill> },
            ]} /></Card>}
            <Card title="Complete Employment History" icon="History" wide>
              <div class="epf-timeline">{d.assignmentHistory.map((assignment: HrEmployeeAssignment) => <div><span /><div><strong>{assignment.positionTitle ?? 'Employment Assignment'}</strong><small>{assignment.departmentName ?? 'Department Not Recorded'} · {assignment.siteName ?? 'Location Not Recorded'} · Supervisor: {assignment.supervisorName ?? 'Not Assigned'}</small></div><time>{fmtDate(assignment.effective_from)}{assignment.effective_to ? ` – ${fmtDate(assignment.effective_to)}` : ' – Present'}</time></div>)}</div>
            </Card>
          </div>
        </>}

        {tab === 'Documents' && <>
          <SectionHead title="Documents" text="Authorised employee documents, verification state, expiries, and evidence management."
            actions={access.uploadDocument && <button class="ui-btn-primary" type="button" onClick={() => onAction('Upload HR Document')}><LucideIcon name="Plus" size={16} /> Add Document</button>} />
          {docsQ.isError ? <EmptyState icon="fa-file-circle-xmark" title="Documents Unavailable" text="The authorised employee documents could not be loaded." /> : <>
          <div class="epf-stat-grid">
            <div><span>Total Documents</span><strong>{documents.length}</strong><small>Authorised Records</small></div>
            <div><span>Verified</span><strong>{verifiedDocs}</strong><small>{documents.length ? Math.round(verifiedDocs / documents.length * 100) : 0}% Verified</small></div>
            <div><span>Expiring Soon</span><strong>{expiring.length}</strong><small>Within 30 Days</small></div>
            <div><span>Needs Review</span><strong>{documents.filter(doc => ['uploaded', 'rejected'].includes(doc.status)).length}</strong><small>Unverified Or Rejected</small></div>
          </div>
          <Card title="Employee Document Health" icon="FileCheck2" wide>
            <div class="epf-document-health"><div><b style={{ width: `${documents.length ? verifiedDocs / documents.length * 100 : 0}%` }} /><i style={{ width: `${documents.length ? expiring.length / documents.length * 100 : 0}%` }} /></div><p>Verified records are shown in green; expiring records require follow-up.</p></div>
          </Card>
          <div class="epf-table-wrap"><table class="epf-table"><thead><tr><th>Document</th><th>Category</th><th>Status</th><th>Uploaded</th><th>Expiry Date</th><th>Confidentiality</th></tr></thead><tbody>
            {documents.map((doc: HrDocument) => <tr><td><strong>{doc.title}</strong><small>{doc.file_name}</small></td><td>{humanize(doc.document_type)}</td><td><Pill tone={doc.status === 'verified' ? 'green' : doc.status === 'rejected' ? 'red' : 'amber'}>{humanize(doc.status)}</Pill></td><td>{fmtDate(doc.uploaded_at)}</td><td>{fmtDate(doc.expiry_date)}</td><td>{humanize(doc.confidentiality)}</td></tr>)}
          </tbody></table></div>
          </>}
        </>}

        {tab === 'Readiness' && <>
          <SectionHead title="Readiness" text="Evidence-based controls showing whether this employee record can support authorised HR and operational workflows." />
          <div class="epf-grid-2">
            <Card title="Overall Readiness" icon="ChartNoAxesCombined"><div class="epf-readiness-overview"><Gauge value={readiness?.percent ?? 0} /><div><Pill tone={(readiness?.blockers.length ?? 0) ? 'amber' : 'green'}>{readiness?.blockers.length ?? 0} Blocking Controls</Pill><p>Readiness is calculated from assignment, payroll, training, and document evidence.</p></div></div></Card>
            <Card title="Blocking Actions" icon="TriangleAlert"><div class="epf-action-list">
              {attention.length ? attention.map(item => <button type="button" onClick={() => setTab(item.target)}><LucideIcon name={item.icon} size={18} /><span><strong>{item.title}</strong><small>{item.detail}</small></span><LucideIcon name="ChevronRight" size={16} /></button>) : <div class="epf-no-attention">No Blocking Actions.</div>}
            </div></Card>
            <Card title="Readiness Control Matrix" icon="ShieldCheck" wide><div class="epf-table-wrap"><table class="epf-table"><thead><tr><th>Control Area</th><th>Score</th><th>Evidence</th><th>Owner</th><th>State</th></tr></thead><tbody>
              {readinessRows.map(row => <tr><td><strong>{row.name}</strong></td><td>{row.value}%</td><td>{row.state}</td><td>{row.owner}</td><td><Pill tone={row.value === 100 ? 'green' : row.value === 0 ? 'red' : 'amber'}>{row.value === 100 ? 'Complete' : 'Review'}</Pill></td></tr>)}
            </tbody></table></div></Card>
          </div>
        </>}

        {tab === 'Access' && <>
          <SectionHead title="Access" text="Authoritative account state, assigned access profile, and controlled support workflows."
            actions={<button class="ui-btn-primary" type="button" onClick={() => showSection('s-tickets')}><LucideIcon name="Headset" size={16} /> Request Account Assistance</button>} />
          {!mayViewSecurity ? <div class="epf-restricted"><LucideIcon name="LockKeyhole" size={20} /> Account Security Requires <code>auth.security.view</code>.</div>
            : securityQ.isLoading ? <SkeletonText lines={8} />
            : securityQ.isError || !security ? <EmptyState icon="fa-shield-halved" title="Account Security Unavailable" text="The authoritative account-security state could not be loaded." />
            : <>
            <div class="epf-access-cards">
              <div><span><LucideIcon name="CircleCheckBig" size={21} /></span><div><small>Account Status</small><strong>{humanize(employee.accountStatus)}</strong></div></div>
              <div><span><LucideIcon name="ShieldCheck" size={21} /></span><div><small>MFA Status</small><strong>{mfaEnabled ? 'Enabled' : 'Not Enrolled'}</strong></div></div>
              <div><span><LucideIcon name="LogIn" size={21} /></span><div><small>Last Sign-In</small><strong>{fmtDateTime(security.lastSeenAt)}</strong></div></div>
            </div>
            <div class="epf-grid-2">
              <Card title="User Account" icon="CircleUserRound"><DetailList items={[
                { label: 'Username', value: employee.username },
                { label: 'Primary Email', value: employee.email ?? DASH },
                { label: 'Provisioned', value: fmtDate(employee.created_at) },
                { label: 'Account Owner', value: employee.full_name ?? employee.username },
                { label: 'Passkeys', value: security.passkeyCount },
                { label: 'Trusted Devices', value: security.trustedDeviceCount },
              ]} /></Card>
              <Card title="Authorised Access" icon="KeyRound"><DetailList items={[
                { label: 'Access Profile', value: d.accessProfile?.label ?? humanize(employee.role) },
                { label: 'System Role', value: humanize(employee.role) },
                { label: 'Department Scope', value: employee.departmentName ?? 'Not Assigned' },
                { label: 'MFA Required', value: d.accessProfile?.requiresMfa ? 'Yes' : 'No' },
                { label: 'Profile Status', value: d.accessProfile ? <Pill tone="green">Active</Pill> : <Pill tone="amber">Unmapped</Pill> },
                { label: 'Exceptions', value: mfaEnabled || !d.accessProfile?.requiresMfa ? 'None' : 'MFA Required' },
              ]} /></Card>
              <Card title="Access Assignment" icon="Shield" wide>
                <div class="epf-table-wrap"><table class="epf-table"><thead><tr><th>Access Profile</th><th>Source</th><th>Scope</th><th>MFA Policy</th><th>Status</th></tr></thead><tbody><tr>
                  <td><strong>{d.accessProfile?.label ?? humanize(employee.role)}</strong><small>{d.accessProfile?.description ?? 'System role assignment'}</small></td>
                  <td>Employee Access Profile</td><td>{employee.departmentName ?? 'Organisation'}</td><td>{d.accessProfile?.requiresMfa ? 'Required' : 'Standard'}</td><td><Pill tone="green">Active</Pill></td>
                </tr></tbody></table></div>
                <div class="epf-support-banner"><span><LucideIcon name="Headset" size={20} /></span><div><strong>Sensitive Account Actions</strong><small>Password reset, session revocation, device removal, MFA enforcement, and suspension are routed to the authorised Account Support owner.</small></div><button type="button" class="ui-btn-primary" onClick={() => showSection('s-tickets')}>Request Assistance</button></div>
              </Card>
            </div>
          </>}
        </>}

        {tab === 'Activity & Audit' && <>
          <SectionHead title="Activity & Audit" text="Employee-record history with actor, source, outcome, and authorised audit details." />
          {auditQ.isError ? <EmptyState icon="fa-clock-rotate-left" title="Audit History Unavailable" text="The authorised employee audit history could not be loaded." /> : <>
          <div class="epf-stat-grid">
            <div><span>Last Record Change</span><strong>{fmtDate(auditQ.data?.[0]?.created_at)}</strong><small>Most Recent Audit Entry</small></div>
            <div><span>Most Recent Actor</span><strong>{auditQ.data?.[0]?.actorName ?? 'System'}</strong><small>Authorised Actor</small></div>
            <div><span>Recorded Events</span><strong>{auditQ.data?.length ?? 0}</strong><small>In This View</small></div>
            <div><span>Open Workflows</span><strong>{workflowQ.data?.open_count ?? 0}</strong><small>{workflowQ.data?.urgent_count ?? 0} Urgent</small></div>
          </div>
          <div class="epf-table-wrap"><table class="epf-table"><thead><tr><th>Date & Time</th><th>Activity</th><th>Area</th><th>Actor</th><th>Reason</th><th>Outcome</th></tr></thead><tbody>
            {(auditQ.data ?? []).map(entry => <tr><td>{fmtDateTime(entry.created_at)}</td><td><strong>{humanize(entry.action)}</strong></td><td>{humanize(entry.submodule_key ?? 'Employee Record')}</td><td>{entry.actorName ?? 'System'}</td><td>{entry.reason ?? DASH}</td><td><Pill tone="green">Recorded</Pill></td></tr>)}
          </tbody></table></div>
          <p class="epf-timezone-note">All Dates And Times Are Displayed In AST (Atlantic Standard Time).</p>
          </>}
        </>}

        {tab === 'Offboarding' && <>
          <SectionHead title="Offboarding" text="Controlled termination, resignation, retirement, redundancy, and contract-completion workflows." />
          <OffboardingPanel employeeId={employeeId} canStart={access.startOffboarding} onAction={onAction} />
        </>}
      </main>
    </div>
  );
}
