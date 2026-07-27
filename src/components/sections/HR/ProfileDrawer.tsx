/**
 * src/components/sections/HR/ProfileDrawer.tsx
 *
 * HR ▸ Employee Master — the employee profile panel. Built on the @ui design
 * system's canonical rich slide-in (<Drawer> = SidePanel) and panel primitives
 * (<EntityHead>, <PanelStats>, <PanelTabs>, <InfoCard>/<FieldList>/<MiniTable>/
 * <Pill>/<Callout>), so every colour/style comes from Siomac tokens defined once
 * in the design system — not from page-scoped CSS. The same components back the
 * HSE Incident/Risk/CAPA panels.
 *
 * Every tab is wired to a real read endpoint:
 *   Overview/Employment/Compliance ← useHrEmployee (get)
 *   Compliance training ← useHrTrainingSummary · Documents ← useHrDocuments
 *   Workflows ← useHrWorkflowSummary · Audit ← useHrAudit (actor names server-side)
 *
 * Write actions (Request Change / Change Status / Upload / Offboard / Edit Contact)
 * surface via onAction — EmployeeMaster maps them to the dialogs in ActionDialogs.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  Drawer, Menu, EntityHead, PanelStats, PanelTabs,
  InfoCard, FieldList, FieldRow, MiniTable, Pill, PanelEmpty, ActivityList,
  Skeleton, SkeletonText, Spinner, EmptyState, LucideIcon,
  type ActivityEntry,
} from '@ui';
import {
  useHrEmployee, useHrWorkflowSummary, useHrAudit, useHrDocuments, useHrTrainingSummary,
  useVerifyHrDocument, useArchiveHrDocument, getHrDocumentDownloadUrl, useDecideHrEmployeePhoto,
  type HrEmployeeDetail, type HrStatutoryRow, type HrAuditEntry, type HrDocument, type HrTrainingSummary,
  type HrWorkflowSummary,
} from '@api/hr/employees';
import { useAdminUserSecurityStatus } from '@api/security';
import { can } from '@lib/permissions';
import { toast } from '@store';
import { ActivityTimeline } from '@shared/orchestration/ActivityTimeline';
import { showSection } from '@components/nav/navCore';
import { EmployeeOnboardingSummary } from './EmployeeOnboardingSummary';
import { humanize, statusTone, type PillTone } from './shared';
import type { EmployeeMasterAccess } from './employeeMasterAccess';
import './ProfileDrawer.css';

/** Employee Master only launches/shows onboarding — the full case workspace lives on
 *  the Onboarding page. Switches the HR nav section AND tells it which case to land
 *  on; HRSection.tsx listens for this dedicated event separately from the generic
 *  'siomac:section' nav switch (which only ever carries a plain section-id string). */
function openOnboardingCase(caseId: string): void {
  window.dispatchEvent(new CustomEvent('siomac:hr-onboarding-open-case', { detail: { caseId } }));
}

// ── small presentational helpers ───────────────────────────────────────────────

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const yn = (b: unknown): string => (b ? 'Yes' : 'No');

function relativeTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return s;
  const secs = Math.round((Date.now() - d.getTime()) / 1000);
  const day = 86400;
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)} min ago`;
  if (secs < day) return `${Math.floor(secs / 3600)}h ago`;
  if (secs < day * 7) return `${Math.floor(secs / day)} days ago`;
  if (secs < day * 30) return `${Math.floor(secs / (day * 7))} weeks ago`;
  return fmtDate(s);
}

// Overall training status, DERIVED from the actual counts so it always agrees
// with the numbers shown and never renders blank (the employee row's
// `trainingStatus` can be a value outside the FE union). Matches v36 semantics.
function overallTraining(t: HrTrainingSummary | undefined): { label: string; tone: PillTone } {
  if (!t || t.total === 0) return { label: 'Not Required', tone: 'gray' };
  if (t.expired > 0) return { label: 'Non-Compliant', tone: 'red' };
  if (t.dueSoon > 0) return { label: 'Due Soon', tone: 'amber' };
  if (t.current >= t.total) return { label: 'Compliant', tone: 'green' };
  return { label: 'In Progress', tone: 'amber' };
}

// Robust label/tone for the employee row's trainingStatus (tolerates values
// outside the FE union — never blank).
function docTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s.includes('verif')) return 'green';
  if (s.includes('reject')) return 'red';
  if (s.includes('pending')) return 'amber';
  return 'gray';
}
function wfTone(status: string): PillTone {
  const s = status.toLowerCase();
  if (s.includes('complete') || s.includes('approved')) return 'green';
  if (s.includes('progress')) return 'blue';
  if (s.includes('reject') || s.includes('return')) return 'red';
  if (s.includes('pending')) return 'amber';
  return 'gray';
}

function gated(q: { isLoading: boolean; isError: boolean }, empty: string): string {
  return q.isLoading ? 'Loading…' : q.isError ? 'You don’t have permission to view this, or nothing is on file.' : empty;
}

// ── tabs ────────────────────────────────────────────────────────────────────────

function TrainingSnapshot(
  { trainQ, onViewTraining }:
  { trainQ: ReturnType<typeof useHrTrainingSummary>; onViewTraining?: () => void },
): VNode {
  const t: HrTrainingSummary | undefined = trainQ.data;
  const ov = overallTraining(t);
  return (
    <InfoCard title="Training Snapshot"
      action={onViewTraining ? <button class="ui-mini-btn" type="button" onClick={onViewTraining}>View Training Profile</button> : undefined}>
      {trainQ.isLoading
        ? <Spinner center label="Loading…" />
        : <PanelStats plain items={[
            { label: 'Overall Status', value: <Pill tone={ov.tone}>{ov.label}</Pill> },
            { label: 'Required', value: <strong>{t?.total ?? '—'}</strong> },
            { label: 'Current', value: <strong>{t?.current ?? '—'}</strong> },
            { label: 'Expired', value: <strong>{t?.expired ?? '—'}</strong> },
            { label: 'Due Soon', value: <strong>{t?.dueSoon ?? '—'}</strong> },
          ]} />}
    </InfoCard>
  );
}

function ProfileOverview(
  { d, docsQ, auditQ, securityQ, onEditContact, onViewEmployment, onViewCompliance, onViewDocuments, onViewTimeline, onManageAccess, showDocuments, showStatutory, showAudit, showSecurity }:
  { d: HrEmployeeDetail; docsQ: ReturnType<typeof useHrDocuments>; auditQ: ReturnType<typeof useHrAudit>;
    securityQ: ReturnType<typeof useAdminUserSecurityStatus>; onEditContact?: () => void; onViewEmployment: () => void;
    onViewCompliance: () => void; onViewDocuments: () => void; onViewTimeline: () => void; onManageAccess?: () => void;
    showDocuments: boolean; showStatutory: boolean; showAudit: boolean; showSecurity: boolean },
): VNode {
  // Capture "now" once at mount via a lazy state initializer — calling Date.now() directly in
  // the render body is impure (it changes every render); this keeps the expiry countdown stable.
  const [nowMs] = useState(() => Date.now());
  const e = d.employee;
  const docs = docsQ.data ?? [];
  const readiness = e.readiness;
  const readinessPercent = readiness?.percent ?? 0;
  const expiringDocument = docs
    .filter(doc => doc.expiry_date)
    .sort((a, b) => new Date(a.expiry_date!).getTime() - new Date(b.expiry_date!).getTime())[0];
  const daysToExpiry = expiringDocument?.expiry_date
    ? Math.ceil((new Date(expiringDocument.expiry_date).getTime() - nowMs) / 86_400_000)
    : null;
  const security = securityQ.data;
  const mfaEnabled = !!security && (security.totpEnabled || security.passkeyCount > 0);
  const attention: { icon: 'IdCard' | 'ShieldCheck' | 'GraduationCap' | 'BriefcaseBusiness' | 'BadgeDollarSign'; title: string; detail: string; action?: () => void }[] = [];
  if (showDocuments && daysToExpiry !== null && daysToExpiry <= 30) attention.push({
    icon: 'IdCard', title: daysToExpiry < 0
      ? `${expiringDocument?.title ?? 'Document'} expired ${Math.abs(daysToExpiry)} days ago`
      : `${expiringDocument?.title ?? 'Document'} expires in ${daysToExpiry} days`,
    detail: `${humanize(expiringDocument?.document_type ?? 'employee document')} · Expires ${fmtDate(expiringDocument?.expiry_date)}`,
    action: onViewDocuments,
  });
  if (showSecurity && securityQ.isSuccess && !mfaEnabled) attention.push({
    icon: 'ShieldCheck', title: 'MFA not enrolled', detail: 'Improve account security', action: onManageAccess,
  });
  if (readiness?.blockers.includes('assignment')) attention.push({
    icon: 'BriefcaseBusiness', title: 'Assignment details are incomplete', detail: 'Department, site and supervisor are required', action: onViewEmployment,
  });
  if (readiness?.blockers.includes('payroll')) attention.push({
    icon: 'BadgeDollarSign', title: `Payroll readiness is ${readiness.payrollStatus}`, detail: 'Review the statutory payroll controls', action: showStatutory ? onViewCompliance : undefined,
  });
  if (readiness?.blockers.includes('training')) attention.push({
    icon: 'GraduationCap', title: `Training status is ${humanize(readiness.trainingStatus)}`, detail: 'Review required learning and certificates', action: onViewCompliance,
  });

  const readinessTone = readinessPercent >= 100 ? 'is-green' : readinessPercent >= 67 ? 'is-amber' : 'is-red';
  const assignmentLabel = readiness?.assignmentComplete ? 'Complete' : 'Needs attention';
  const payrollLabel = readiness ? humanize(readiness.payrollStatus) : 'Restricted';
  const trainingLabel = readiness ? humanize(readiness.trainingStatus === 'none' ? 'not on file' : readiness.trainingStatus) : 'Restricted';

  return (
    <div class="epd-overview-grid">
      <InfoCard title={attention.length ? 'Needs Attention' : 'Record Status'}>
        <div class={`epd-attention-list${attention.length ? '' : ' is-clear'}`}>
          {attention.length ? attention.slice(0, 4).map(item => item.action ? (
            <button type="button" onClick={item.action}>
              <span class="epd-attention-icon"><LucideIcon name={item.icon} size={18} /></span>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
              <LucideIcon name="ChevronRight" size={16} />
            </button>
          ) : (
            <div class="epd-attention-note">
              <span class="epd-attention-icon"><LucideIcon name={item.icon} size={18} /></span>
              <span><strong>{item.title}</strong><small>{item.detail}</small></span>
            </div>
          )) : <div class="epd-clear-state"><LucideIcon name="CircleCheck" size={18} /> No open attention items.</div>}
        </div>
      </InfoCard>

      <div class="epd-summary-grid">
        <InfoCard title="Personal & Contact"
          action={onEditContact ? <button class="ui-mini-btn" type="button" onClick={onEditContact}>Edit</button> : undefined}>
          <FieldList>
            <FieldRow icon="fa-envelope" label="Work Email" value={e.email ?? '—'} />
            <FieldRow icon="fa-phone" label="Phone" value={e.phone ?? '—'} />
            <FieldRow icon="fa-at" label="Personal Email" value={e.personal_email ?? '—'} />
            <FieldRow icon="fa-cake-candles" label="Date of Birth" value={fmtDate(e.date_of_birth)} />
            <FieldRow icon="fa-flag" label="Nationality" value={e.nationality ?? '—'} />
          </FieldList>
        </InfoCard>

        <InfoCard title="Current Assignment"
          action={<button class="ui-mini-btn" type="button" onClick={onViewEmployment}>View Details</button>}>
          <FieldList>
            <FieldRow label="Position" value={e.position ?? '—'} />
            <FieldRow label="Department" value={e.departmentName ?? '—'} />
            <FieldRow label="Site" value={e.siteName ?? '—'} />
            <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
            <FieldRow label="Effective Date" value={fmtDate(e.start_date)} />
          </FieldList>
        </InfoCard>
      </div>

      <InfoCard title="Record Readiness">
        {readiness ? <>
          <div class="epd-readiness-head"><strong>{readinessPercent}%</strong><span>Ready across assignment, payroll and training</span></div>
          <div class={`epd-progress ${readinessTone}`}><span style={{ width: `${readinessPercent}%` }} /></div>
          <div class="epd-readiness-grid">
            <button type="button" onClick={onViewEmployment}><LucideIcon name="BriefcaseBusiness" size={18} /><span>Assignment</span><strong>{assignmentLabel}</strong></button>
            <button type="button" onClick={onViewCompliance}><LucideIcon name="BadgeDollarSign" size={18} /><span>Payroll</span><strong>{payrollLabel}</strong></button>
            <button type="button" onClick={onViewCompliance}><LucideIcon name="GraduationCap" size={18} /><span>Training</span><strong>{trainingLabel}</strong></button>
          </div>
        </> : <div class="epd-restricted"><LucideIcon name="LockKeyhole" size={18} /> Readiness requires payroll-readiness access.</div>}
      </InfoCard>

      <InfoCard title="Account Access"
        action={onManageAccess ? <button class="ui-mini-btn" type="button" onClick={onManageAccess}>Manage Access</button> : undefined}>
        <PanelStats plain items={[
          { label: 'Login', value: <Pill tone={e.status === 'active' ? 'green' : 'red'}>{e.status === 'active' ? 'Enabled' : 'Disabled'}</Pill> },
          { label: 'Username', value: <strong>{e.username}</strong> },
          { label: 'Last Sign-in', value: <strong>{showSecurity ? (security?.lastSeenAt ? fmtDateTime(security.lastSeenAt) : 'No active session') : 'Restricted'}</strong> },
          { label: 'MFA', value: <Pill tone={!showSecurity ? 'gray' : mfaEnabled ? 'green' : 'red'}>{showSecurity ? (mfaEnabled ? 'Enrolled' : 'Not enrolled') : 'Restricted'}</Pill> },
        ]} />
      </InfoCard>

      {showAudit && <InfoCard title="Recent Activity"
        action={<button class="ui-mini-btn" type="button" onClick={onViewTimeline}>View Full Timeline</button>}>
        {auditQ.isLoading
          ? <Spinner center label="Loading activity…" />
          : auditQ.data?.length
            ? <ActivityList items={auditQ.data.slice(0, 3).map((a): ActivityEntry => ({
                icon: <i class={`fas ${activityIcon(a.action)}`} aria-hidden="true" />,
                title: humanize(a.action),
                desc: a.reason ?? a.actorName ?? undefined,
                time: relativeTime(a.created_at),
              }))} />
            : <PanelEmpty>{gated(auditQ, 'No recent activity.')}</PanelEmpty>}
      </InfoCard>}
    </div>
  );
}

function activityIcon(action: string): string {
  const a = action.toLowerCase();
  if (/approv|verif|pass/.test(a)) return 'fa-circle-check';
  if (/complet|done|finish/.test(a)) return 'fa-check';
  if (/document|upload|file|attach/.test(a)) return 'fa-file';
  if (/status|transfer|offboard/.test(a)) return 'fa-arrow-right-arrow-left';
  if (/assign|move/.test(a)) return 'fa-user-group';
  if (/creat|add|new|onboard/.test(a)) return 'fa-user-plus';
  if (/delet|remov|archiv/.test(a)) return 'fa-trash';
  if (/reject|deny|fail/.test(a)) return 'fa-circle-xmark';
  if (/updat|edit|chang|modif/.test(a)) return 'fa-pen';
  return 'fa-bolt';
}

export function EmploymentTab({ d }: { d: HrEmployeeDetail }): VNode {
  const e = d.employee;
  const hist = d.statusHistory;
  return (
    <>
      <InfoCard title="Employment Details">
        <FieldList>
          <FieldRow label="Employment Type" value={humanize(e.employment_type ?? e.workerType)} />
          <FieldRow label="Status" value={<Pill tone={statusTone(e.status)}>{humanize(e.status)}</Pill>} />
          <FieldRow label="Position / Role" value={e.position ?? '—'} />
          <FieldRow label="Employee Grade" value={e.employee_grade ?? '—'} />
          <FieldRow label="Work Schedule" value={e.work_schedule ?? '—'} />
          <FieldRow label="Department" value={e.departmentName ?? '—'} />
          <FieldRow label="Site" value={e.siteName ?? '—'} />
          <FieldRow label="Cost Center" value={e.cost_center ?? '—'} />
          <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
          <FieldRow label="Start Date" value={fmtDate(e.start_date)} />
          <FieldRow label="Probation End" value={fmtDate(e.probation_end_date)} />
          <FieldRow label="Government ID" value={e.government_id ?? '—'} />
        </FieldList>
      </InfoCard>
      <InfoCard title="Employment History">
        <MiniTable cols={['Effective', 'From', 'To', 'Reason']}
          empty={<EmptyState icon="fa-clock-rotate-left" tone="purple" title="No status changes recorded"
            text="Employment status updates appear here once a change is submitted."
            note="Tracks active, suspended, terminated, leave and reinstatement changes with effective dates and workflow references." />}>
          {hist.map(r => (
            <tr>
              <td>{fmtDate((r.effective_date ?? r.changed_at) as string)}</td>
              <td>{humanize((r.previous_status as string | undefined) ?? '—')}</td>
              <td>{humanize((r.new_status as string | undefined) ?? '—')}</td>
              <td>{(r.reason as string | undefined) ?? '—'}</td>
            </tr>
          ))}
        </MiniTable>
      </InfoCard>
    </>
  );
}

export function DocumentsTab({ docsQ, employeeId, onUpload, access }: { docsQ: ReturnType<typeof useHrDocuments>; employeeId: string; onUpload?: () => void; access: EmployeeMasterAccess }): VNode {
  const rows = docsQ.data ?? [];
  const verify = useVerifyHrDocument(employeeId);
  const archive = useArchiveHrDocument(employeeId);
  const [docErr, setDocErr] = useState<string | null>(null);
  const actErr = (verify.error ?? archive.error);
  async function download(id: string) {
    setDocErr(null);
    try { const url = await getHrDocumentDownloadUrl(id); window.open(url, '_blank', 'noopener'); }
    catch (e) { setDocErr(e instanceof Error ? e.message : 'Download failed.'); }
  }
  return (
    <InfoCard title="Employee Documents"
      action={onUpload ? <button class="ui-mini-btn" type="button" onClick={onUpload}>Upload Document</button> : undefined}>
      {docErr ? <div class="ui-warn">{docErr}</div> : null}
      {actErr ? <div class="ui-warn">{actErr instanceof Error ? actErr.message : 'Action failed'}</div> : null}
      {docsQ.isLoading
        ? <Spinner center label="Loading documents…" />
        : docsQ.isError
        ? <PanelEmpty>{gated(docsQ, 'No documents on file.')}</PanelEmpty>
        : <MiniTable cols={['Document', 'Type', 'Status', 'Expiry', '']}
            empty={<EmptyState icon="fa-folder-open" title="No documents uploaded"
              text="Add employee IDs, contracts, certificates, medical files or onboarding records."
              note="Uploaded files appear here with type, expiry, verification status and audit history." />}>
            {rows.map((doc: HrDocument) => {
              const pending = !['verified', 'rejected', 'archived'].includes(doc.status);
              return (
                <tr>
                  <td>{doc.title}</td>
                  <td>{humanize(doc.document_type)}</td>
                  <td><Pill tone={docTone(doc.status)}>{humanize(doc.status)}</Pill></td>
                  <td>{fmtDate(doc.expiry_date)}</td>
                  <td>
                    <div class="ui-mini-btn-row">
                      {access.downloadDocument && <button class="ui-mini-btn" type="button" onClick={() => void download(doc.id)}>Download</button>}
                      {access.verifyDocument && pending && <button class="ui-mini-btn" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'approve' })}>Verify</button>}
                      {access.verifyDocument && pending && <button class="ui-mini-btn" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'reject' })}>Reject</button>}
                      {access.archiveDocument && doc.status !== 'archived' && <button class="ui-mini-btn" type="button" disabled={archive.isPending} onClick={() => archive.mutate(doc.id)}>Archive</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </MiniTable>}
    </InfoCard>
  );
}

export function TrainingTab(
  { trainQ }:
  { trainQ: ReturnType<typeof useHrTrainingSummary> },
): VNode {
  const t: HrTrainingSummary | undefined = trainQ.data;
  return (
    <>
      <TrainingSnapshot trainQ={trainQ} />
      <InfoCard title="Certificates">
        {trainQ.isError
          ? <PanelEmpty>{gated(trainQ, 'No certificates on file.')}</PanelEmpty>
          : <MiniTable loading={trainQ.isLoading && !trainQ.data} cols={['Course', 'Status', 'Expiry']}
              empty={<EmptyState icon="fa-certificate" tone="green" title="No certificates on file"
                text="Completed courses and competencies appear here."
                note="Each certificate shows its course, current status and expiry, synced from the Training module." />}>
              {(t?.certificates ?? []).map(cert => (
                <tr>
                  <td>{cert.course_name}</td>
                  <td>{humanize(cert.status)}</td>
                  <td>{fmtDate(cert.expires_at)}</td>
                </tr>
              ))}
            </MiniTable>}
      </InfoCard>
    </>
  );
}

export function StatutoryTab({ d, onEdit }: { d: HrEmployeeDetail; onEdit?: () => void }): VNode {
  const s: HrStatutoryRow | null = d.statutory;
  const readiness = d.payrollReadiness;
  if (!s) {
    return <InfoCard title="Trinidad & Tobago Statutory Profile">
      <EmptyState icon="fa-shield-halved" tone="amber" title="Statutory profile unavailable"
        text="Details require the statutory.view permission, or none are on file yet."
        note="NIS, BIR / PAYE, TD1 and health-surcharge fields appear here once access is granted and the profile is completed." />
    </InfoCard>;
  }
  const readyLabel = readiness ? humanize(readiness.status) : '—';
  const readySub = readiness?.blockers.length ? readiness.blockers.join(', ') : 'Ready for Finance / Payroll handoff';
  return (
    <>
      <InfoCard title="Trinidad & Tobago Statutory Profile"
        action={onEdit ? <button class="ui-mini-btn" type="button" onClick={onEdit}>Edit Statutory Profile</button> : undefined}>
        <div class="ui-stat-tiles">
          <div class="ui-stat-tile"><small>Payroll Readiness</small><strong>{readyLabel}</strong><span>{readySub}</span></div>
          <div class="ui-stat-tile"><small>NIS Profile</small><strong>{humanize(s.nis_status)}</strong><span>{s.nis_number ? `NIS No. ${s.nis_number}` : 'No NIS number on file'}</span></div>
          <div class="ui-stat-tile"><small>BIR / PAYE</small><strong>{s.bir_file_number ? 'Complete' : 'Incomplete'}</strong><span>{`PAYE ${s.paye_applicable ? 'applicable' : 'n/a'} · TD1 ${s.td1_received ? 'received' : 'pending'}`}</span></div>
          <div class="ui-stat-tile"><small>Health Surcharge</small><strong>{s.hs_applicable ? 'Applicable' : 'Exempt'}</strong><span>{s.hs_exemption_reason ?? 'Standard employee deduction'}</span></div>
        </div>
      </InfoCard>
      <InfoCard title="NIS Profile">
        <FieldList>
          <FieldRow label="NIS Number" value={s.nis_number ?? '—'} />
          <FieldRow label="Registration Status" value={humanize(s.nis_status)} />
          <FieldRow label="Effective Date" value={fmtDate(s.nis_effective_date)} />
        </FieldList>
      </InfoCard>
      <InfoCard title="BIR / PAYE & TD1">
        <FieldList>
          <FieldRow label="BIR File Number" value={s.bir_file_number ?? 'Missing'} />
          <FieldRow label="PAYE Applicable" value={yn(s.paye_applicable)} />
          <FieldRow label="TD1 Received" value={yn(s.td1_received)} />
          <FieldRow label="TD1 Effective Year" value={s.td1_effective_year ? String(s.td1_effective_year) : '—'} />
        </FieldList>
      </InfoCard>
      <InfoCard title="Health Surcharge">
        <FieldList>
          <FieldRow label="Applicable" value={yn(s.hs_applicable)} />
          <FieldRow label="Exemption Reason" value={s.hs_exemption_reason ?? 'None'} />
          <FieldRow label="Payroll Handoff" value={readiness?.financeHandoffEligible ? 'Available to Finance / Payroll' : 'Blocked until statutory profile complete'} />
        </FieldList>
      </InfoCard>
    </>
  );
}

export function WorkflowsTab({ wfQ }: { wfQ: ReturnType<typeof useHrWorkflowSummary> }): VNode {
  const data: HrWorkflowSummary | undefined = wfQ.data;
  return (
    <InfoCard title="Open Workflows">
      {wfQ.isError
        ? <PanelEmpty>{gated(wfQ, 'No open workflows.')}</PanelEmpty>
        : <MiniTable loading={wfQ.isLoading && !wfQ.data} cols={['Workflow', 'Current Step', 'Status', 'Due']}
            empty={<EmptyState icon="fa-list-check" title="No open workflows"
              text="Approvals and change requests for this employee appear here."
              note="Sensitive-change, onboarding and offboarding workflows show their current step, status and due date." />}>
            {(data?.items ?? []).map(w => (
              <tr>
                <td>{humanize(w.workflow_type)}</td>
                <td>{w.current_step ?? '—'}</td>
                <td><Pill tone={wfTone(w.status)}>{humanize(w.status)}</Pill></td>
                <td>{fmtDate(w.due_at)}</td>
              </tr>
            ))}
          </MiniTable>}
    </InfoCard>
  );
}

export function AuditTab({ auditQ }: { auditQ: ReturnType<typeof useHrAudit> }): VNode {
  return (
    <InfoCard title="Audit Trail">
      {auditQ.isError
        ? <PanelEmpty>{gated(auditQ, 'No audit entries.')}</PanelEmpty>
        : <MiniTable loading={auditQ.isLoading && !auditQ.data} cols={['Time', 'Actor', 'Action', 'Reason']}
            empty={<EmptyState icon="fa-clipboard-list" tone="gray" title="No audit entries"
              text="Changes to this employee's record will be logged here."
              note="Every status change, contact edit, document action and approval is recorded with the actor and time." />}>
            {(auditQ.data ?? []).map((a: HrAuditEntry) => (
              <tr>
                <td>{fmtDateTime(a.created_at)}</td>
                <td>{a.actorName ?? (a.actor_id ? '—' : 'System')}</td>
                <td>{humanize(a.action)}</td>
                <td>{a.reason ?? '—'}</td>
              </tr>
            ))}
          </MiniTable>}
    </InfoCard>
  );
}

// Leave / Attendance live in their own modules; there is no in-drawer action to
// wire here yet, so this is an honest informational panel — no dead button.
// ── drawer shell ─────────────────────────────────────────────────────────────────

const PRIMARY_TABS = ['Overview', 'Employment', 'Documents', 'Compliance', 'Timeline'];
const MORE_TABS = ['Onboarding', 'Workflows', 'Audit'];

// Whole-drawer skeleton — shown until the detail data belongs to the requested
// employee, so a previous employee's header/tags never flash on switch.
function DrawerSkeleton(): VNode {
  return (
    <>
      <div style={{ display: 'flex', alignItems: 'center', gap: '14px', margin: '4px 0 18px' }}>
        <Skeleton circle width={56} />
        <div style={{ flex: 1, display: 'flex', flexDirection: 'column', gap: '8px', minWidth: 0 }}>
          <Skeleton height={18} width="45%" />
          <Skeleton height={12} width="65%" />
        </div>
      </div>
      <div style={{ display: 'flex', gap: '12px', marginBottom: '18px' }}>
        <Skeleton height={56} width="33%" radius={10} />
        <Skeleton height={56} width="33%" radius={10} />
        <Skeleton height={56} width="33%" radius={10} />
      </div>
      <InfoCard title="Personal Summary"><SkeletonText lines={5} /></InfoCard>
      <InfoCard title="Current Assignment"><SkeletonText lines={4} /></InfoCard>
    </>
  );
}

export function ProfileDrawer(
  { employeeId, onClose, onAction, onOpenFullRecord, access }:
  { employeeId: string | null; onClose: () => void; onAction: (label: string) => void; onOpenFullRecord?: () => void; access: EmployeeMasterAccess },
): VNode {
  const [tab, setTab] = useState('Overview');

  const detailQ = useHrEmployee(employeeId);
  const wfQ     = useHrWorkflowSummary(employeeId);
  const trainQ  = useHrTrainingSummary(access.viewTraining && tab === 'Compliance' ? employeeId : null);
  const auditQ  = useHrAudit(access.viewAudit && (tab === 'Overview' || tab === 'Audit') ? employeeId : null);
  const docsQ   = useHrDocuments(access.viewDocuments && (tab === 'Overview' || tab === 'Documents') ? employeeId : null);
  const securityQ = useAdminUserSecurityStatus(employeeId ?? '', can('auth.security.view') && !!employeeId);
  const decidePhoto = useDecideHrEmployeePhoto();

  const handlePhotoDecision = (approve: boolean): void => {
    if (!employeeId) return;
    decidePhoto.mutate({ employeeId, approve }, {
      onSuccess: () => toast.success(approve ? 'Profile photo approved.' : 'Profile photo rejected.'),
      onError:   (err) => toast.error(err instanceof Error ? err.message : 'Could not update the photo.'),
    });
  };

  const d = detailQ.data;
  const e = d?.employee;
  // useRecordQuery guarantees `data`/`ready` belong to the requested employee, so
  // a previous employee's header/tags can never flash through on an A→B switch.
  // (`&& !!e` is redundant at runtime — ready implies data — but lets TS narrow e.)
  const ready = detailQ.ready && !!e;
  const primaryTabs = access.viewDocuments ? PRIMARY_TABS : PRIMARY_TABS.filter(item => item !== 'Documents');
  const visiblePrimaryTabs = (access.viewTraining || access.viewStatutory)
    ? primaryTabs
    : primaryTabs.filter(item => item !== 'Compliance');
  const moreTabs = MORE_TABS.filter(item =>
    (item !== 'Onboarding' || access.viewOnboarding) &&
    (item !== 'Audit' || access.viewAudit));
  const panelMenuItems = [
    ...(access.uploadDocument ? [{ label: 'Upload HR Document', icon: 'fa-file', onSelect: () => onAction('Upload HR Document') }] : []),
    ...(access.viewAudit ? [{ label: 'View Audit', icon: 'fa-clock-rotate-left', onSelect: () => setTab('Audit') }] : []),
    ...(access.startOffboarding ? [{ label: 'Start Offboarding', icon: 'fa-triangle-exclamation', danger: true, onSelect: () => onAction('Start Offboarding') }] : []),
  ];
  const hasPanelActions = !!onOpenFullRecord || access.requestChange || access.changeStatus || panelMenuItems.length > 0;
  const manageAccess = can('permissions.manage') ? () => {
    onClose();
    showSection('s-ac-users');
  } : undefined;
  const actionBar = hasPanelActions ? (
    <div class={`epd-action-bar${panelMenuItems.length ? ' has-overflow' : ''}`}>
      {onOpenFullRecord && <button class="ui-btn-secondary" type="button" onClick={onOpenFullRecord}>View Full Employee Record</button>}
      {access.requestChange && <button class="ui-btn-primary" type="button" onClick={() => onAction('Request Change')}>Request Change</button>}
      {access.changeStatus && <button class="ui-btn-secondary" type="button" onClick={() => onAction('Change Status')}>Change Status</button>}
      {panelMenuItems.length > 0 && <Menu align="right" items={panelMenuItems} trigger={({ toggle }) => (
        <button class="ui-btn-secondary epd-more-action" type="button" onClick={toggle} aria-label="More employee actions"><LucideIcon name="Ellipsis" size={18} /></button>
      )} />}
    </div>
  ) : undefined;

  return (
    <Drawer rich open={!!employeeId} title="Employee Profile" onClose={onClose} foot={actionBar} panelClass="employee-profile-drawer">
      {!employeeId ? null : detailQ.isError ? (
        <PanelEmpty>Could not load this employee.</PanelEmpty>
      ) : !ready ? (
        <DrawerSkeleton />
      ) : (
        <>
          <EntityHead
            name={e.full_name ?? e.username}
            avatarUrl={e.profile_image_url}
            reference={<>{e.employee_number ?? '—'} <Pill tone={statusTone(e.status)}>{humanize(e.status)}</Pill></>}
            meta={[e.position, e.departmentName, e.siteName]}
          />

          {/* Pending profile photo — reviewers (hr.employees.photo_approve) can
              approve/reject a self-submitted photo before it goes live. */}
          {can('hr.employees.photo_approve') && e.profile_image_pending_thumb_url && (
            <div class="ui-pending-photo">
              <img class="ui-pending-photo-thumb" src={e.profile_image_pending_thumb_url} alt="Pending profile photo" />
              <div class="ui-pending-photo-copy">
                <strong>Profile photo pending review</strong>
                <span>Submitted {relativeTime(e.profile_image_pending_submitted_at)}. The current photo stays active until you approve.</span>
              </div>
              <div class="ui-pending-photo-actions">
                <button class="ui-btn-primary" type="button" disabled={decidePhoto.isPending} onClick={() => handlePhotoDecision(true)}>Approve</button>
                <button class="ui-btn-secondary" type="button" disabled={decidePhoto.isPending} onClick={() => handlePhotoDecision(false)}>Reject</button>
              </div>
            </div>
          )}

          <PanelTabs primary={visiblePrimaryTabs} more={moreTabs} active={tab} onChange={setTab} />

          <div class="ui-panel-body">
            {tab === 'Overview'          && <ProfileOverview d={d} docsQ={docsQ} auditQ={auditQ} securityQ={securityQ} onEditContact={access.editContact ? () => onAction('Edit Contact') : undefined} onViewEmployment={() => setTab('Employment')} onViewCompliance={() => setTab('Compliance')} onViewDocuments={() => setTab('Documents')} onViewTimeline={() => setTab('Timeline')} onManageAccess={manageAccess} showDocuments={access.viewDocuments} showStatutory={access.viewStatutory} showAudit={access.viewAudit} showSecurity={can('auth.security.view')} />}
            {tab === 'Employment'        && <EmploymentTab d={d} />}
            {access.viewDocuments && tab === 'Documents' && <DocumentsTab docsQ={docsQ} employeeId={employeeId} onUpload={access.uploadDocument ? () => onAction('Upload HR Document') : undefined} access={access} />}
            {tab === 'Compliance' && <>
              {access.viewTraining && <TrainingTab trainQ={trainQ} />}
              {access.viewStatutory && <StatutoryTab d={d} onEdit={access.editStatutory ? () => onAction('Edit Statutory Profile') : undefined} />}
            </>}
            {access.viewOnboarding && tab === 'Onboarding' && <EmployeeOnboardingSummary employeeId={employeeId} onOpenCase={openOnboardingCase} />}
            {tab === 'Timeline'          && <ActivityTimeline module="hr" recordType="employee" recordId={employeeId} />}
            {tab === 'Workflows'         && <WorkflowsTab wfQ={wfQ} />}
            {access.viewAudit && tab === 'Audit' && <AuditTab auditQ={auditQ} />}
          </div>
        </>
      )}
    </Drawer>
  );
}
