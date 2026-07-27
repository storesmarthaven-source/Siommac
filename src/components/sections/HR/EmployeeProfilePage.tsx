import { type VNode } from 'preact';
import { useMemo, useState } from 'preact/hooks';
import {
  EmptyState, InfoCard, LucideIcon, PageHeader, PanelEmpty, PanelStats, Pill,
  SkeletonText,
} from '@ui';
import {
  useHrAudit, useHrDocuments, useHrEmployee, useHrTrainingSummary,
  useHrWorkflowSummary,
} from '@api/hr/employees';
import { useAdminUserSecurityStatus } from '@api/security';
import { useBankAccounts } from '@api/finance/bankAccounts';
import { useEmployerProfile } from '@api/finance/statutoryForms';
import { can } from '@lib/permissions';
import { showSection } from '@components/nav/navCore';
import { humanize, statusTone } from './shared';
import type { EmployeeMasterAccess } from './employeeMasterAccess';
import {
  AuditTab, DocumentsTab, EmploymentTab, StatutoryTab, TrainingTab, WorkflowsTab,
} from './ProfileDrawer';
import './EmployeeProfilePage.css';

type ProfileTab = 'Overview' | 'Employment' | 'Documents' | 'Readiness' | 'Access' | 'Activity & Audit' | 'Offboarding';

export interface EmployeeProfilePageProps {
  employeeId: string;
  access: EmployeeMasterAccess;
  onBack: () => void;
  onAction: (label: string) => void;
}

function fmtDate(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleDateString('en-TT', { day: '2-digit', month: 'short', year: 'numeric' });
}

function fmtDateTime(value: string | null | undefined): string {
  if (!value) return '—';
  const date = new Date(value);
  if (Number.isNaN(date.getTime())) return value;
  return date.toLocaleString('en-TT', { day: '2-digit', month: 'short', year: 'numeric', hour: 'numeric', minute: '2-digit' });
}

function tenure(startDate: string | null): string {
  if (!startDate) return 'Not on file';
  const start = new Date(startDate);
  if (Number.isNaN(start.getTime()) || start > new Date()) return 'Not on file';
  const today = new Date();
  let months = (today.getFullYear() - start.getFullYear()) * 12 + today.getMonth() - start.getMonth();
  if (today.getDate() < start.getDate()) months -= 1;
  const years = Math.floor(months / 12);
  const remaining = months % 12;
  if (years === 0) return `${remaining} ${remaining === 1 ? 'Month' : 'Months'}`;
  if (remaining === 0) return `${years} ${years === 1 ? 'Year' : 'Years'}`;
  return `${years} ${years === 1 ? 'Year' : 'Years'} ${remaining} ${remaining === 1 ? 'Month' : 'Months'}`;
}

function RestrictedPanel({ title, text }: { title: string; text: string }): VNode {
  return (
    <InfoCard title={title}>
      <div class="epf-restricted">
        <LucideIcon name="LockKeyhole" size={20} />
        <div><strong>Restricted</strong><span>{text}</span></div>
      </div>
    </InfoCard>
  );
}

function FinanceEmploymentDetails({ employeeId }: { employeeId: string }): VNode {
  const bankQ = useBankAccounts({ employeeId });
  const employerQ = useEmployerProfile();
  const primary = bankQ.data?.find(account => account.isPrimary && account.isActive);
  return (
    <div class="epf-two-col">
      <InfoCard title="Legal Employer">
        {employerQ.isLoading ? <SkeletonText lines={3} /> : employerQ.isError ? (
          <PanelEmpty>Employer profile is unavailable.</PanelEmpty>
        ) : (
          <dl class="epf-definition-list">
            <div><dt>Legal Name</dt><dd>{employerQ.data?.legalName ?? '—'}</dd></div>
            <div><dt>Trading Name</dt><dd>{employerQ.data?.tradingName ?? '—'}</dd></div>
            <div><dt>Country</dt><dd>{employerQ.data?.country ?? 'Trinidad and Tobago'}</dd></div>
          </dl>
        )}
      </InfoCard>
      <InfoCard title="Pay Administration">
        {bankQ.isLoading ? <SkeletonText lines={3} /> : bankQ.isError ? (
          <PanelEmpty>Bank details are unavailable.</PanelEmpty>
        ) : primary ? (
          <dl class="epf-definition-list">
            <div><dt>Primary Bank</dt><dd>{primary.bankName}</dd></div>
            <div><dt>Account</dt><dd>{primary.accountNumberMasked}</dd></div>
            <div><dt>Account Type</dt><dd>{humanize(primary.accountType)}</dd></div>
          </dl>
        ) : <PanelEmpty>No primary payroll account is on file.</PanelEmpty>}
      </InfoCard>
    </div>
  );
}

export function EmployeeProfilePage({ employeeId, access, onBack, onAction }: EmployeeProfilePageProps): VNode {
  const [tab, setTab] = useState<ProfileTab>('Overview');
  const [referenceTime] = useState(() => Date.now());
  const detailQ = useHrEmployee(employeeId);
  const docsQ = useHrDocuments(access.viewDocuments && (tab === 'Overview' || tab === 'Documents') ? employeeId : null);
  const trainQ = useHrTrainingSummary(access.viewTraining && (tab === 'Overview' || tab === 'Readiness') ? employeeId : null);
  const auditQ = useHrAudit(access.viewAudit && (tab === 'Overview' || tab === 'Activity & Audit') ? employeeId : null);
  const workflowQ = useHrWorkflowSummary(tab === 'Overview' || tab === 'Activity & Audit' ? employeeId : null);
  const mayViewSecurity = can('auth.security.view');
  const securityQ = useAdminUserSecurityStatus(employeeId, mayViewSecurity && (tab === 'Overview' || tab === 'Access'));

  const tabs = useMemo(() => ([
    'Overview',
    'Employment',
    ...(access.viewDocuments ? ['Documents'] : []),
    ...((access.viewTraining || access.viewStatutory) ? ['Readiness'] : []),
    'Access',
    ...(access.viewAudit ? ['Activity & Audit'] : []),
    ...(access.startOffboarding || can('hr.offboarding.view') ? ['Offboarding'] : []),
  ] as ProfileTab[]), [access]);

  if (detailQ.isError) {
    return (
      <div class="employee-profile-page">
        <PageHeader icon={<LucideIcon name="ContactRound" size={21} />} title="Employee Record" sub="The requested employee record could not be loaded."
          actions={<button class="ui-btn-secondary" type="button" onClick={onBack}>Back to Employee Register</button>} />
        <EmptyState icon="fa-user-slash" title="Employee record unavailable" text="Check your access or return to the register and try again." />
      </div>
    );
  }
  if (!detailQ.ready || !detailQ.data) {
    return <div class="employee-profile-page"><SkeletonText lines={12} /></div>;
  }

  const d = detailQ.data;
  const employee = d.employee;
  const readiness = employee.readiness;
  const security = securityQ.data;
  const mfaEnabled = !!security && (security.totpEnabled || security.passkeyCount > 0);
  const attention = [
    ...(readiness?.blockers.includes('assignment') ? [{ label: 'Assignment details require review', icon: 'BriefcaseBusiness' as const, tab: 'Employment' as ProfileTab }] : []),
    ...(readiness?.blockers.includes('payroll') ? [{ label: 'Payroll readiness is blocked', icon: 'BadgeDollarSign' as const, tab: 'Readiness' as ProfileTab }] : []),
    ...(readiness?.blockers.includes('training') ? [{ label: 'Training requirements are incomplete', icon: 'GraduationCap' as const, tab: 'Readiness' as ProfileTab }] : []),
    ...(access.viewDocuments && (docsQ.data ?? []).some(doc => doc.expiry_date && new Date(doc.expiry_date).getTime() <= referenceTime + 30 * 86_400_000)
      ? [{ label: 'An employee document is due to expire', icon: 'FileWarning' as const, tab: 'Documents' as ProfileTab }] : []),
    ...(mayViewSecurity && securityQ.isSuccess && !mfaEnabled
      ? [{ label: 'MFA is not enrolled', icon: 'ShieldAlert' as const, tab: 'Access' as ProfileTab }] : []),
  ];

  return (
    <div class="employee-profile-page">
      <PageHeader
        icon={<LucideIcon name="ContactRound" size={21} />}
        module="Human Resources"
        title="Employee Record"
        sub="Authoritative employment, readiness, access, document, and lifecycle information."
        actions={<div class="epf-page-actions">
          <button class="ui-btn-secondary" type="button" onClick={onBack}><LucideIcon name="ArrowLeft" size={16} /> Back to Register</button>
          {access.editEmployee && <button class="ui-btn-primary" type="button" onClick={() => onAction('Edit Contact')}>Edit Employee</button>}
        </div>}
      />

      <section class="epf-identity" aria-label="Employee identity and employment summary">
        <div class="epf-avatar-wrap">
          {employee.profile_image_url
            ? <img src={employee.profile_image_url} alt="" />
            : <span>{(employee.first_name?.[0] ?? employee.username[0] ?? 'E').toUpperCase()}</span>}
          <i class={employee.status === 'active' ? 'is-active' : ''} aria-hidden="true" />
        </div>
        <div class="epf-identity-main">
          <div class="epf-name-line">
            <h2>{employee.full_name ?? employee.username}</h2>
            <Pill tone={statusTone(employee.status)}>{humanize(employee.status)}</Pill>
          </div>
          <p>{employee.employee_number ?? 'Employee number not assigned'}</p>
          <div class="epf-role-line"><span><LucideIcon name="BriefcaseBusiness" size={17} />{employee.position ?? 'Position not assigned'}</span><span><LucideIcon name="Building2" size={17} />{employee.departmentName ?? 'Department not assigned'}</span></div>
        </div>
        <div class="epf-facts">
          <div><LucideIcon name="ShieldCheck" size={19} /><span>Employment Type<strong>{humanize(employee.employment_type ?? employee.workerType)}</strong></span></div>
          <div><LucideIcon name="Clock3" size={19} /><span>Work Schedule<strong>{employee.work_schedule ?? 'Not on file'}</strong></span></div>
          <div><LucideIcon name="CalendarDays" size={19} /><span>Start Date<strong>{fmtDate(employee.start_date)}</strong></span></div>
          <div><LucideIcon name="History" size={19} /><span>Tenure<strong>{tenure(employee.start_date)}</strong></span></div>
        </div>
      </section>

      <nav class="epf-tabs" aria-label="Employee record sections">
        {tabs.map(item => <button type="button" role="tab" aria-selected={tab === item} class={tab === item ? 'is-active' : ''} onClick={() => setTab(item)}>{item}</button>)}
      </nav>

      <main class="epf-content">
        {tab === 'Overview' && <>
          <InfoCard title="Attention & Follow-Up"
            action={attention.length ? <span class="epf-count">{attention.length}</span> : undefined}>
            {attention.length ? <div class="epf-attention-grid">
              {attention.map(item => <button type="button" onClick={() => setTab(item.tab)}>
                <span><LucideIcon name={item.icon} size={20} /></span><strong>{item.label}</strong><LucideIcon name="ChevronRight" size={17} />
              </button>)}
            </div> : <div class="epf-clear"><LucideIcon name="CircleCheckBig" size={20} /> No employee record issues need attention.</div>}
          </InfoCard>
          <div class="epf-two-col">
            <InfoCard title="Readiness">
              {readiness ? <div class="epf-readiness">
                <div class="epf-readiness-score"><strong>{readiness.percent}%</strong><span>Overall Record Readiness</span></div>
                <div class="epf-readiness-track"><span style={{ width: `${readiness.percent}%` }} /></div>
                <button type="button" class="epf-text-action" onClick={() => setTab('Readiness')}>View Readiness Details <LucideIcon name="ChevronRight" size={15} /></button>
              </div> : <PanelEmpty>Readiness is restricted or unavailable.</PanelEmpty>}
            </InfoCard>
            <InfoCard title="Employment Snapshot">
              <dl class="epf-definition-list">
                <div><dt>Reports To</dt><dd>{employee.supervisorName ?? 'Not assigned'}</dd></div>
                <div><dt>Location</dt><dd>{employee.siteName ?? 'Not assigned'}</dd></div>
                <div><dt>Work Schedule</dt><dd>{employee.work_schedule ?? 'Not on file'}</dd></div>
                <div><dt>Probation End</dt><dd>{fmtDate(employee.probation_end_date)}</dd></div>
                <div><dt>Cost Centre</dt><dd>{employee.cost_center ?? 'Not on file'}</dd></div>
              </dl>
            </InfoCard>
          </div>
          <div class="epf-two-col">
            <InfoCard title="Contact & Emergency Contact">
              <dl class="epf-definition-list">
                <div><dt>Work Email</dt><dd>{employee.email ?? '—'}</dd></div>
                <div><dt>Phone</dt><dd>{employee.phone ?? '—'}</dd></div>
                <div><dt>Emergency Contact</dt><dd>{employee.emergency_contact_name ?? '—'}</dd></div>
                <div><dt>Emergency Phone</dt><dd>{employee.emergency_contact_phone ?? '—'}</dd></div>
              </dl>
            </InfoCard>
            <InfoCard title="Account & Support">
              {mayViewSecurity ? <PanelStats plain items={[
                { label: 'Account', value: <Pill tone={employee.status === 'active' ? 'green' : 'red'}>{employee.status === 'active' ? 'Active' : 'Disabled'}</Pill> },
                { label: 'MFA', value: <Pill tone={mfaEnabled ? 'green' : 'amber'}>{mfaEnabled ? 'Enabled' : 'Not Enrolled'}</Pill> },
                { label: 'Last Seen', value: <strong>{fmtDateTime(security?.lastSeenAt)}</strong> },
              ]} /> : <div class="epf-restricted"><LucideIcon name="LockKeyhole" size={20} /><span>Security posture requires account-security access.</span></div>}
              <button type="button" class="epf-outline-action" onClick={() => showSection('s-tickets')}><LucideIcon name="Headset" size={17} /> Open Account Support</button>
            </InfoCard>
          </div>
          {access.viewAudit && <AuditTab auditQ={auditQ} />}
        </>}

        {tab === 'Employment' && <>
          <EmploymentTab d={d} />
          {can('finance.bank_accounts.view') && can('finance.payroll.statutory_forms.view')
            ? <FinanceEmploymentDetails employeeId={employeeId} />
            : <RestrictedPanel title="Pay Administration & Legal Employer" text="Bank administration and legal-employer details require the corresponding Finance capabilities." />}
        </>}

        {tab === 'Documents' && access.viewDocuments && <DocumentsTab docsQ={docsQ} employeeId={employeeId}
          onUpload={access.uploadDocument ? () => onAction('Upload HR Document') : undefined} access={access} />}

        {tab === 'Readiness' && <>
          <InfoCard title="Overall Record Readiness">
            {readiness ? <div class="epf-readiness-matrix">
              <div class="epf-readiness-score"><strong>{readiness.percent}%</strong><span>Overall Record Readiness</span></div>
              <div><span>Assignment</span><Pill tone={readiness.assignmentComplete ? 'green' : 'red'}>{readiness.assignmentComplete ? 'Complete' : 'Blocked'}</Pill></div>
              <div><span>Payroll</span><Pill tone={readiness.payrollStatus === 'ready' ? 'green' : 'red'}>{humanize(readiness.payrollStatus)}</Pill></div>
              <div><span>Training</span><Pill tone={readiness.trainingStatus === 'current' ? 'green' : 'amber'}>{humanize(readiness.trainingStatus)}</Pill></div>
            </div> : <PanelEmpty>Readiness is restricted or unavailable.</PanelEmpty>}
          </InfoCard>
          {access.viewTraining && <TrainingTab trainQ={trainQ} />}
          {access.viewStatutory && <StatutoryTab d={d} onEdit={access.editStatutory ? () => onAction('Edit Statutory Profile') : undefined} />}
        </>}

        {tab === 'Access' && <>
          {mayViewSecurity ? <InfoCard title="Account Security">
            <PanelStats plain items={[
              { label: 'Username', value: <strong>{employee.username}</strong> },
              { label: 'MFA', value: <Pill tone={mfaEnabled ? 'green' : 'amber'}>{mfaEnabled ? 'Enabled' : 'Not Enrolled'}</Pill> },
              { label: 'Passkeys', value: <strong>{security?.passkeyCount ?? '—'}</strong> },
              { label: 'Trusted Devices', value: <strong>{security?.trustedDeviceCount ?? '—'}</strong> },
              { label: 'Last Seen', value: <strong>{fmtDateTime(security?.lastSeenAt)}</strong> },
            ]} />
            <div class="epf-action-row">
              {can('permissions.manage') && <button type="button" class="ui-btn-primary" onClick={() => showSection('s-ac-users')}>Manage Access Profile</button>}
              <button type="button" class="ui-btn-secondary" onClick={() => showSection('s-tickets')}>Open Account Support</button>
            </div>
          </InfoCard> : <RestrictedPanel title="Account Security" text="Account state, MFA and device posture require auth.security.view." />}
        </>}

        {tab === 'Activity & Audit' && <>
          <WorkflowsTab wfQ={workflowQ} />
          <AuditTab auditQ={auditQ} />
        </>}

        {tab === 'Offboarding' && <InfoCard title="Offboarding">
          {employee.offboardingActive ? (
            <div class="epf-lifecycle-state"><LucideIcon name="TriangleAlert" size={22} /><div><strong>Offboarding is in progress</strong><span>Open the Offboarding workspace for tasks, blockers, approvals, handoffs, and finalisation.</span></div></div>
          ) : (
            <div class="epf-lifecycle-state is-clear"><LucideIcon name="CircleCheckBig" size={22} /><div><strong>No active offboarding case</strong><span>This employee remains in the normal employment lifecycle.</span></div></div>
          )}
          <div class="epf-action-row">
            <button type="button" class="ui-btn-secondary" onClick={() => showSection('s-hr-offboarding')}>Open Offboarding Workspace</button>
            {!employee.offboardingActive && access.startOffboarding && <button type="button" class="ui-btn-primary" onClick={() => onAction('Start Offboarding')}>Start Offboarding</button>}
          </div>
        </InfoCard>}
      </main>
    </div>
  );
}
