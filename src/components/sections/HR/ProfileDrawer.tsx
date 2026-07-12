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
 *   Overview/Employment/Assignments/Statutory ← useHrEmployee (get)
 *   Training ← useHrTrainingSummary · Documents ← useHrDocuments
 *   Workflows ← useHrWorkflowSummary · Audit ← useHrAudit (actor names server-side)
 * Leave & Attendance have no HR read endpoint (separate modules) — they render an
 * honest "lives in its own module" panel rather than fabricated numbers.
 *
 * Write actions (Request Change / Change Status / Upload / Offboard / Edit Contact)
 * surface via onAction — EmployeeMaster maps them to the dialogs in ActionDialogs.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  Drawer, Menu, EntityHead, PanelStats, PanelTabs,
  InfoCard, FieldList, FieldRow, MiniTable, Pill, PanelEmpty, Callout, ActivityList,
  Skeleton, SkeletonText, Spinner, EmptyState,
  type ActivityEntry,
} from '@ui';
import {
  useHrEmployee, useHrWorkflowSummary, useHrAudit, useHrDocuments, useHrTrainingSummary,
  useVerifyHrDocument, useArchiveHrDocument, getHrDocumentDownloadUrl, useDecideHrEmployeePhoto,
  type HrEmployeeDetail, type HrStatutoryRow, type HrAuditEntry, type HrDocument, type HrTrainingSummary,
  type HrWorkflowSummary,
} from '@api/hr/employees';
import { can } from '@lib/permissions';
import { toast } from '@store';
import { ActivityTimeline } from '@shared/orchestration/ActivityTimeline';
import { EmployeeOnboardingSummary } from './EmployeeOnboardingSummary';
import {
  humanize, initials, statusTone, TRAINING_TONE, TRAINING_LABEL, type PillTone,
} from './shared';

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
function trainBadge(s: string): { label: string; tone: PillTone } {
  const label = (TRAINING_LABEL as Record<string, string>)[s];
  const tone = (TRAINING_TONE as Record<string, PillTone>)[s];
  return { label: label ?? humanize(s || 'none'), tone: tone ?? 'gray' };
}

function activityIcon(action: string): string {
  const a = action.toLowerCase();
  if (/approv|verif|pass/.test(a))              return 'fa-circle-check';
  if (/complet|done|finish/.test(a))            return 'fa-check';
  if (/document|upload|file|attach/.test(a))    return 'fa-file';
  if (/status|transfer|offboard/.test(a))       return 'fa-arrow-right-arrow-left';
  if (/assign|move/.test(a))                    return 'fa-user-group';
  if (/creat|add|new|onboard/.test(a))          return 'fa-user-plus';
  if (/delet|remov|archiv/.test(a))             return 'fa-trash';
  if (/reject|deny|fail/.test(a))               return 'fa-circle-xmark';
  if (/updat|edit|chang|modif/.test(a))         return 'fa-pen';
  return 'fa-bolt';
}

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
      {trainQ.isLoading && !trainQ.data
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

function OverviewTab(
  { d, trainQ, auditQ, onEditContact, onViewHistory, onViewTraining, onViewTimeline }:
  { d: HrEmployeeDetail; trainQ: ReturnType<typeof useHrTrainingSummary>; auditQ: ReturnType<typeof useHrAudit>;
    onEditContact: () => void; onViewHistory: () => void; onViewTraining: () => void; onViewTimeline: () => void },
): VNode {
  const e = d.employee;
  const riskRed = e.trainingStatus === 'expired';
  return (
    <>
      <InfoCard title="Personal Summary"
        action={<button class="ui-mini-btn" type="button" onClick={onEditContact}>Edit Contact</button>}>
        <FieldList>
          <FieldRow icon="fa-user"        label="Full Name"      value={e.full_name ?? e.username} />
          <FieldRow icon="fa-envelope"    label="Email"          value={e.email ?? '—'} />
          <FieldRow icon="fa-phone"       label="Phone"          value={e.phone ?? '—'} />
          <FieldRow icon="fa-id-badge"    label="Employee No."   value={e.employee_number ?? '—'} />
          <FieldRow icon="fa-at"          label="Personal Email" value={e.personal_email ?? '—'} />
          <FieldRow icon="fa-cake-candles" label="Date of Birth" value={fmtDate(e.date_of_birth)} />
          <FieldRow icon="fa-flag"         label="Nationality"   value={e.nationality ?? '—'} />
        </FieldList>
      </InfoCard>
      <InfoCard title="Current Assignment"
        action={<button class="ui-mini-btn" type="button" onClick={onViewHistory}>View History</button>}>
        <FieldList>
          <FieldRow label="Position" value={e.position ?? '—'} />
          <FieldRow label="Department" value={e.departmentName ?? '—'} />
          <FieldRow label="Site" value={e.siteName ?? '—'} />
          <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
          <FieldRow label="Effective Date" value={fmtDate(e.start_date)} />
        </FieldList>
      </InfoCard>
      <Callout
        mark="♜"
        title="Workforce Risk"
        status={riskRed ? 'training exception found' : '✓ no risk items'}
        alert={riskRed}
      >
        {riskRed
          ? 'This employee has a training or assignment blocker that should be reviewed.'
          : 'This employee has no workforce risks.'}
      </Callout>
      <TrainingSnapshot trainQ={trainQ} onViewTraining={onViewTraining} />
      <InfoCard title="Recent Activity"
        action={<button class="ui-mini-btn" type="button" onClick={onViewTimeline}>View full timeline</button>}>
        {auditQ.isLoading && !auditQ.data
          ? <Spinner center label="Loading activity…" />
          : auditQ.data?.length
            ? <ActivityList items={auditQ.data.slice(0, 5).map((a): ActivityEntry => ({
                icon: <i class={`fas ${activityIcon(a.action)}`} aria-hidden="true" />,
                title: humanize(a.action),
                desc: a.reason ?? a.actorName ?? undefined,
                time: relativeTime(a.created_at),
              }))} />
            : <PanelEmpty>{gated(auditQ, 'No recent activity.')}</PanelEmpty>}
      </InfoCard>
    </>
  );
}

function EmploymentTab({ d }: { d: HrEmployeeDetail }): VNode {
  const e = d.employee;
  return (
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
        <FieldRow label="Login / Access" value={e.status === 'active' ? 'Enabled' : 'Disabled'} />
      </FieldList>
    </InfoCard>
  );
}

function AssignmentsTab({ d }: { d: HrEmployeeDetail }): VNode {
  const e = d.employee;
  const hist = d.statusHistory;
  return (
    <>
      <InfoCard title="Current Assignment">
        <FieldList>
          <FieldRow label="Position" value={e.position ?? '—'} />
          <FieldRow label="Department" value={e.departmentName ?? '—'} />
          <FieldRow label="Site" value={e.siteName ?? '—'} />
          <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
          <FieldRow label="Effective From" value={fmtDate(e.start_date)} />
        </FieldList>
      </InfoCard>
      <InfoCard title="Status History">
        <MiniTable cols={['Effective', 'From', 'To', 'Reason']}
          empty={<EmptyState icon="fa-clock-rotate-left" tone="purple" title="No status changes recorded"
            text="Employment status updates appear here once a change is submitted."
            note="Tracks active, suspended, terminated, leave and reinstatement changes with effective dates and workflow references." />}>
          {hist.map(r => (
            <tr>
              <td>{fmtDate((r.effective_date ?? r.changed_at) as string)}</td>
              <td>{humanize(String(r.previous_status ?? '—'))}</td>
              <td>{humanize(String(r.new_status ?? '—'))}</td>
              <td>{(r.reason as string) ?? '—'}</td>
            </tr>
          ))}
        </MiniTable>
      </InfoCard>
    </>
  );
}

function DocumentsTab({ docsQ, employeeId, onUpload }: { docsQ: ReturnType<typeof useHrDocuments>; employeeId: string; onUpload: () => void }): VNode {
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
      action={<button class="ui-mini-btn" type="button" onClick={onUpload}>Upload Document</button>}>
      {docErr ? <div class="ui-warn">{docErr}</div> : null}
      {actErr ? <div class="ui-warn">{actErr instanceof Error ? actErr.message : 'Action failed'}</div> : null}
      {docsQ.isLoading && !docsQ.data
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
                      <button class="ui-mini-btn" type="button" onClick={() => download(doc.id)}>Download</button>
                      {pending && <button class="ui-mini-btn" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'approve' })}>Verify</button>}
                      {pending && <button class="ui-mini-btn" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'reject' })}>Reject</button>}
                      {doc.status !== 'archived' && <button class="ui-mini-btn" type="button" disabled={archive.isPending} onClick={() => archive.mutate(doc.id)}>Archive</button>}
                    </div>
                  </td>
                </tr>
              );
            })}
          </MiniTable>}
    </InfoCard>
  );
}

function TrainingTab(
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

function StatutoryTab({ d, onEdit }: { d: HrEmployeeDetail; onEdit: () => void }): VNode {
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
        action={<button class="ui-mini-btn" type="button" onClick={onEdit}>Edit Statutory Profile</button>}>
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

function WorkflowsTab({ wfQ }: { wfQ: ReturnType<typeof useHrWorkflowSummary> }): VNode {
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

function AuditTab({ auditQ }: { auditQ: ReturnType<typeof useHrAudit> }): VNode {
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
function ModuleLinkTab({ title, body }: { title: string; body: string }): VNode {
  return (
    <InfoCard title={title}>
      <PanelEmpty>{body}</PanelEmpty>
    </InfoCard>
  );
}

// ── drawer shell ─────────────────────────────────────────────────────────────────

const PRIMARY_TABS = ['Overview', 'Employment', 'Assignments', 'Documents', 'Timeline'];
const MORE_TABS = ['Training', 'Statutory Profile', 'Onboarding', 'Leave', 'Attendance', 'Workflows', 'Audit'];

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
  { employeeId, onClose, onAction }:
  { employeeId: string | null; onClose: () => void; onAction: (label: string) => void },
): VNode {
  const [tab, setTab] = useState('Overview');

  const detailQ = useHrEmployee(employeeId);
  const wfQ     = useHrWorkflowSummary(employeeId);
  const trainQ  = useHrTrainingSummary((tab === 'Overview' || tab === 'Training') ? employeeId : null);
  const auditQ  = useHrAudit((tab === 'Overview' || tab === 'Audit') ? employeeId : null);
  const docsQ   = useHrDocuments(tab === 'Documents' ? employeeId : null);
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
  // Open-workflow count is only trustworthy when its query matches this employee.
  const wfReady = wfQ.data?.employee_id === employeeId;
  const openWf = wfReady ? (wfQ.data?.open_count ?? 0) : 0;

  const headMenu = (
    <Menu align="right" items={[
      { label: 'Request Change', icon: 'fa-pen', onSelect: () => onAction('Request Change') },
      { label: 'Upload HR Document', icon: 'fa-file', onSelect: () => onAction('Upload HR Document') },
      { label: 'View Audit', icon: 'fa-clock-rotate-left', onSelect: () => setTab('Audit') },
      { label: 'Start Offboarding', icon: 'fa-triangle-exclamation', danger: true, onSelect: () => onAction('Start Offboarding') },
    ]} trigger={({ toggle }) => (
      <button class="ui-icon-action" type="button" onClick={toggle} aria-label="More">⋮</button>
    )} />
  );

  return (
    <Drawer rich open={!!employeeId} title="Employee Profile" onClose={onClose} headActions={headMenu}>
      {!employeeId ? null : detailQ.isError ? (
        <PanelEmpty>Could not load this employee.</PanelEmpty>
      ) : !ready ? (
        <DrawerSkeleton />
      ) : (
        <>
          <EntityHead
            name={e.full_name ?? e.username}
            avatarUrl={e.profile_image_url}
            reference={<>ⓘ {e.employee_number ?? '—'} <Pill tone={statusTone(e.status)}>{humanize(e.status)}</Pill></>}
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

          <PanelStats items={[
            { label: 'Training', value: (() => { const b = trainBadge(e.trainingStatus); return <Pill tone={b.tone}>{b.label}</Pill>; })() },
            { label: 'Supervisor', value: e.supervisorName ? <><span class="ui-avatar-xs">{initials(e.supervisorName)}</span>{e.supervisorName}</> : '—' },
            { label: 'Open Workflows', value: (
              <button class="ui-wf-mini" type="button" onClick={() => setTab('Workflows')} title="Open workflow queue">
                <span class="ui-wf-mini-ico"><i class="fas fa-list-check" /></span>
                <span class="ui-wf-mini-text">{openWf} open</span>
                <span class="ui-wf-mini-eye" aria-hidden="true"><i class="fas fa-eye" /></span>
              </button>
            ) },
          ]} />

          <div class="ui-panel-actions">
            <button class="ui-btn-primary" type="button" onClick={() => onAction('Request Change')}>Request Change</button>
            <button class="ui-btn-secondary" type="button" onClick={() => onAction('Change Status')}>Change Status</button>
            <Menu align="right" items={[
              { label: 'Upload HR Document', icon: 'fa-file', onSelect: () => onAction('Upload HR Document') },
              { label: 'View Statutory Profile', icon: 'fa-file-shield', onSelect: () => setTab('Statutory Profile') },
              { label: 'Start Offboarding', icon: 'fa-triangle-exclamation', danger: true, onSelect: () => onAction('Start Offboarding') },
            ]} trigger={({ toggle }) => (
              <button class="ui-btn-secondary" type="button" onClick={toggle} aria-label="More actions">•••</button>
            )} />
          </div>

          <PanelTabs primary={PRIMARY_TABS} more={MORE_TABS} active={tab} onChange={setTab} />

          <div class="ui-panel-body">
            {tab === 'Overview'          && <OverviewTab d={d} trainQ={trainQ} auditQ={auditQ} onEditContact={() => onAction('Edit Contact')} onViewHistory={() => setTab('Assignments')} onViewTraining={() => setTab('Training')} onViewTimeline={() => setTab('Timeline')} />}
            {tab === 'Employment'        && <EmploymentTab d={d} />}
            {tab === 'Assignments'       && <AssignmentsTab d={d} />}
            {tab === 'Documents'         && <DocumentsTab docsQ={docsQ} employeeId={employeeId} onUpload={() => onAction('Upload HR Document')} />}
            {tab === 'Training'          && <TrainingTab trainQ={trainQ} />}
            {tab === 'Statutory Profile' && <StatutoryTab d={d} onEdit={() => onAction('Edit Statutory Profile')} />}
            {tab === 'Onboarding'        && <EmployeeOnboardingSummary employeeId={employeeId} onOpenCase={openOnboardingCase} />}
            {tab === 'Timeline'          && <ActivityTimeline module="hr" recordType="employee" recordId={employeeId} />}
            {tab === 'Leave'             && <ModuleLinkTab title="Leave" body="Leave balances and requests are managed in the Leave module." />}
            {tab === 'Attendance'        && <ModuleLinkTab title="Attendance" body="Timesheets and clock events are managed in the Attendance module." />}
            {tab === 'Workflows'         && <WorkflowsTab wfQ={wfQ} />}
            {tab === 'Audit'             && <AuditTab auditQ={auditQ} />}
          </div>
        </>
      )}
    </Drawer>
  );
}
