/**
 * src/components/sections/HR/ProfileDrawer.tsx
 *
 * HR ▸ Employee Master — the employee profile drawer (faithful port of the v36
 * source's ProfileDrawer), rendered inside the Siomac shell. Opens when a register
 * row is selected. Every tab is wired to a real read endpoint:
 *   Overview/Employment/Assignments/Statutory ← useHrEmployee (get)
 *   Training ← useHrTrainingSummary · Documents ← useHrDocuments
 *   Workflows ← useHrWorkflowSummary · Audit ← useHrAudit (actor names resolved server-side)
 * Leave & Attendance have no HR read endpoint (separate modules) — they render an
 * honest "lives in its own module" panel rather than fabricated numbers.
 *
 * Write actions (Request Change / Change Status / Upload / Offboard / Edit Contact)
 * surface via onAction — their dialogs are Phase D. Styling: ./HR.css (.hr-emp-master).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  useHrEmployee, useHrWorkflowSummary, useHrAudit, useHrDocuments, useHrTrainingSummary,
  useVerifyHrDocument, useArchiveHrDocument, getHrDocumentDownloadUrl,
  type HrEmployeeDetail, type HrStatutoryRow, type HrAuditEntry, type HrDocument, type HrTrainingSummary,
  type HrWorkflowSummary,
} from '@api/hr/employees';
import { useHrOnboardingCase, useCompleteOnboardingTask, useCancelOnboarding } from '@api/hr/onboarding';
import {
  humanize, initials, statusTone, TRAINING_TONE, TRAINING_LABEL, TinyAvatar, type PillTone,
} from './shared';

// ── small presentational helpers ───────────────────────────────────────────────

function fmtDate(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleDateString('en-US', { year: 'numeric', month: 'short', day: 'numeric' });
}
function fmtDateTime(s: string | null | undefined): string {
  if (!s) return '—';
  const d = new Date(s);
  if (isNaN(d.getTime())) return String(s);
  return d.toLocaleString('en-US', { year: 'numeric', month: 'short', day: 'numeric', hour: 'numeric', minute: '2-digit' });
}
const yn = (b: unknown): string => (b ? 'Yes' : 'No');

function Pill({ label, tone }: { label: string; tone: PillTone }): VNode {
  return <span class={`pill ${tone}`}>{label}</span>;
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

function InfoCard({ title, action, children }: { title: string; action?: VNode; children: VNode | (VNode | null)[] }): VNode {
  return (
    <section class="info-card">
      <div class="card-head"><h4>{title}</h4>{action}</div>
      {children}
    </section>
  );
}
function FieldRow({ label, value }: { label: string; value: string | VNode }): VNode {
  return <div class="field-row"><div class="field-label">{label}</div><div class="field-value">{value}</div></div>;
}
function MiniTable({ cols, children, empty }: { cols: string[]; children: VNode[]; empty: string }): VNode {
  return children.length
    ? <table class="mini-table"><thead><tr>{cols.map(c => <th>{c}</th>)}</tr></thead><tbody>{children}</tbody></table>
    : <div class="em-empty">{empty}</div>;
}
function GatedState({ q, empty }: { q: { isLoading: boolean; isError: boolean }; empty: string }): VNode {
  return <div class="em-empty">{q.isLoading ? 'Loading…' : q.isError ? 'You don’t have permission to view this, or nothing is on file.' : empty}</div>;
}

// ── tabs ────────────────────────────────────────────────────────────────────────

function OverviewTab(
  { d, trainQ, auditQ, onEditContact }:
  { d: HrEmployeeDetail; trainQ: ReturnType<typeof useHrTrainingSummary>; auditQ: ReturnType<typeof useHrAudit>; onEditContact: () => void },
): VNode {
  const e = d.employee;
  const riskRed = e.trainingStatus === 'expired';
  return (
    <div>
      <InfoCard title="Personal Summary" action={<button class="small-outline" type="button" onClick={onEditContact}>Edit Contact</button>}>
        <div class="field-list">
          <FieldRow label="Full Name" value={e.full_name ?? e.username} />
          <FieldRow label="Email" value={e.email ?? '—'} />
          <FieldRow label="Phone" value={e.phone ?? '—'} />
          <FieldRow label="Employee No." value={e.employee_number ?? '—'} />
          <FieldRow label="Personal Email" value={e.personal_email ?? '—'} />
        </div>
      </InfoCard>
      <InfoCard title="Current Assignment">
        <div class="field-list">
          <FieldRow label="Position" value={e.position ?? '—'} />
          <FieldRow label="Department" value={e.departmentName ?? '—'} />
          <FieldRow label="Site" value={e.siteName ?? '—'} />
          <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
          <FieldRow label="Effective Date" value={fmtDate(e.start_date)} />
        </div>
      </InfoCard>
      <section class={`info-card risk-card ${riskRed ? 'risk-card-alert' : ''}`}>
        <div class="shield">{riskRed ? '!' : '✓'}</div>
        <div>
          <strong>Workforce Risk</strong>
          <span>{riskRed ? 'training exception found' : 'no risk items'}</span>
          <p>{riskRed
            ? 'This employee has a training/assignment blocker that should be reviewed.'
            : 'This employee has no outstanding workforce risks.'}</p>
        </div>
      </section>
      <TrainingTab trainQ={trainQ} trainingStatus={e.trainingStatus} compact />
      <InfoCard title="Recent Activity">
        {auditQ.data && auditQ.data.length
          ? <div class="activity-list">{auditQ.data.slice(0, 4).map(a => (
              <div class="activity-item">
                <div class="activity-icon">•</div>
                <div><div class="activity-title">{humanize(a.action)}</div><div class="activity-desc">{a.reason ?? a.actorName ?? '—'}</div></div>
                <div class="activity-time">{fmtDate(a.created_at)}</div>
              </div>
            ))}</div>
          : <GatedState q={auditQ} empty="No recent activity." />}
      </InfoCard>
    </div>
  );
}

function EmploymentTab({ d }: { d: HrEmployeeDetail }): VNode {
  const e = d.employee;
  return (
    <InfoCard title="Employment Details">
      <div class="field-list">
        <FieldRow label="Employment Type" value={humanize(e.employment_type ?? e.workerType)} />
        <FieldRow label="Status" value={<Pill label={humanize(e.status)} tone={statusTone(e.status)} />} />
        <FieldRow label="Position / Role" value={e.position ?? '—'} />
        <FieldRow label="Department" value={e.departmentName ?? '—'} />
        <FieldRow label="Site" value={e.siteName ?? '—'} />
        <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
        <FieldRow label="Start Date" value={fmtDate(e.start_date)} />
        <FieldRow label="Login / Access" value={e.status === 'active' ? 'Enabled' : 'Disabled'} />
      </div>
    </InfoCard>
  );
}

function AssignmentsTab({ d }: { d: HrEmployeeDetail }): VNode {
  const e = d.employee;
  const hist = d.statusHistory as Array<Record<string, unknown>>;
  return (
    <div>
      <InfoCard title="Current Assignment">
        <div class="field-list">
          <FieldRow label="Position" value={e.position ?? '—'} />
          <FieldRow label="Department" value={e.departmentName ?? '—'} />
          <FieldRow label="Site" value={e.siteName ?? '—'} />
          <FieldRow label="Supervisor" value={e.supervisorName ?? '—'} />
          <FieldRow label="Effective From" value={fmtDate(e.start_date)} />
        </div>
      </InfoCard>
      <InfoCard title="Status History">
        <MiniTable cols={['Effective', 'From', 'To', 'Reason']} empty="No status changes recorded.">
          {hist.map(r => (
            <tr>
              <td>{fmtDate((r['effective_date'] ?? r['changed_at']) as string)}</td>
              <td>{humanize(String(r['previous_status'] ?? '—'))}</td>
              <td>{humanize(String(r['new_status'] ?? '—'))}</td>
              <td>{(r['reason'] as string) ?? '—'}</td>
            </tr>
          ))}
        </MiniTable>
      </InfoCard>
    </div>
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
    <InfoCard title="Employee Documents" action={<button class="small-outline" type="button" onClick={onUpload}>Upload Document</button>}>
      {docErr ? <div class="em-empty" style={{ color: '#dc2626' }}>{docErr}</div> : null}
      {actErr ? <div class="em-empty" style={{ color: '#dc2626' }}>{actErr instanceof Error ? actErr.message : 'Action failed'}</div> : null}
      {docsQ.isLoading || docsQ.isError
        ? <GatedState q={docsQ} empty="No documents on file." />
        : <MiniTable cols={['Document', 'Type', 'Status', 'Expiry', '']} empty="No documents on file.">
            {rows.map((doc: HrDocument) => {
              const pending = !['verified', 'rejected', 'archived'].includes(doc.status);
              return (
                <tr>
                  <td>{doc.title}</td>
                  <td>{humanize(doc.document_type)}</td>
                  <td><Pill label={humanize(doc.status)} tone={docTone(doc.status)} /></td>
                  <td>{fmtDate(doc.expiry_date)}</td>
                  <td style={{ display: 'flex', gap: '6px', justifyContent: 'flex-end', flexWrap: 'wrap' }}>
                    <button class="small-outline" type="button" onClick={() => download(doc.id)}>Download</button>
                    {pending && <button class="small-outline" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'approve' })}>Verify</button>}
                    {pending && <button class="small-outline" type="button" disabled={verify.isPending} onClick={() => verify.mutate({ documentId: doc.id, decision: 'reject' })}>Reject</button>}
                    {doc.status !== 'archived' && <button class="small-outline" type="button" disabled={archive.isPending} onClick={() => archive.mutate(doc.id)}>Archive</button>}
                  </td>
                </tr>
              );
            })}
          </MiniTable>}
    </InfoCard>
  );
}

function TrainingTab(
  { trainQ, trainingStatus, compact }:
  { trainQ: ReturnType<typeof useHrTrainingSummary>; trainingStatus: HrEmployeeDetail['employee']['trainingStatus']; compact?: boolean },
): VNode {
  const t: HrTrainingSummary | undefined = trainQ.data;
  return (
    <div>
      <InfoCard title="Training Snapshot">
        <div class="training-row">
          <div class="training-cell"><small>Overall</small><Pill label={TRAINING_LABEL[trainingStatus]} tone={TRAINING_TONE[trainingStatus]} /></div>
          <div class="training-cell"><small>Total</small><strong>{t?.total ?? '—'}</strong></div>
          <div class="training-cell"><small>Current</small><strong>{t?.current ?? '—'}</strong></div>
          <div class="training-cell"><small>Expired</small><strong>{t?.expired ?? '—'}</strong></div>
          <div class="training-cell"><small>Due Soon</small><strong>{t?.dueSoon ?? '—'}</strong></div>
        </div>
      </InfoCard>
      {!compact && (
        <InfoCard title="Certificates">
          {trainQ.isLoading || trainQ.isError
            ? <GatedState q={trainQ} empty="No certificates on file." />
            : <MiniTable cols={['Course', 'Status', 'Expiry']} empty="No certificates on file.">
                {(t?.certificates ?? []).map(cert => (
                  <tr>
                    <td>{cert.course_name}</td>
                    <td>{humanize(cert.status)}</td>
                    <td>{fmtDate(cert.expires_at)}</td>
                  </tr>
                ))}
              </MiniTable>}
        </InfoCard>
      )}
    </div>
  );
}

function StatutoryTab({ d, onEdit }: { d: HrEmployeeDetail; onEdit: () => void }): VNode {
  const s: HrStatutoryRow | null = d.statutory;
  const readiness = d.payrollReadiness;
  if (!s) {
    return <InfoCard title="Trinidad & Tobago Statutory Profile">
      <div class="em-empty">Statutory details are not available — they require the statutory.view permission, or none are on file yet.</div>
    </InfoCard>;
  }
  const readyLabel = readiness ? humanize(readiness.status) : '—';
  const readySub = readiness && readiness.blockers.length ? readiness.blockers.join(', ') : 'Ready for Finance / Payroll handoff';
  return (
    <div class="summary-list">
      <section class="info-card statutory-hero-card">
        <div class="card-head"><h4>Trinidad &amp; Tobago Statutory Profile</h4><button class="small-outline" type="button" onClick={onEdit}>Edit Statutory Profile</button></div>
        <div class="statutory-status-grid">
          <div class="statutory-ready-card"><small>Payroll Readiness</small><strong>{readyLabel}</strong><span>{readySub}</span></div>
          <div class="statutory-ready-card"><small>NIS Profile</small><strong>{humanize(s.nis_status)}</strong><span>{s.nis_number ? `NIS No. ${s.nis_number}` : 'No NIS number on file'}</span></div>
          <div class="statutory-ready-card"><small>BIR / PAYE</small><strong>{s.bir_file_number ? 'Complete' : 'Incomplete'}</strong><span>{`PAYE ${s.paye_applicable ? 'applicable' : 'n/a'} · TD1 ${s.td1_received ? 'received' : 'pending'}`}</span></div>
          <div class="statutory-ready-card"><small>Health Surcharge</small><strong>{s.hs_applicable ? 'Applicable' : 'Exempt'}</strong><span>{s.hs_exemption_reason ?? 'Standard employee deduction'}</span></div>
        </div>
      </section>
      <InfoCard title="NIS Profile">
        <div class="field-list">
          <FieldRow label="NIS Number" value={s.nis_number ?? '—'} />
          <FieldRow label="Registration Status" value={humanize(s.nis_status)} />
          <FieldRow label="Effective Date" value={fmtDate(s.nis_effective_date)} />
        </div>
      </InfoCard>
      <InfoCard title="BIR / PAYE & TD1">
        <div class="field-list">
          <FieldRow label="BIR File Number" value={s.bir_file_number ?? 'Missing'} />
          <FieldRow label="PAYE Applicable" value={yn(s.paye_applicable)} />
          <FieldRow label="TD1 Received" value={yn(s.td1_received)} />
          <FieldRow label="TD1 Effective Year" value={s.td1_effective_year ? String(s.td1_effective_year) : '—'} />
        </div>
      </InfoCard>
      <InfoCard title="Health Surcharge">
        <div class="field-list">
          <FieldRow label="Applicable" value={yn(s.hs_applicable)} />
          <FieldRow label="Exemption Reason" value={s.hs_exemption_reason ?? 'None'} />
          <FieldRow label="Payroll Handoff" value={readiness?.financeHandoffEligible ? 'Available to Finance / Payroll' : 'Blocked until statutory profile complete'} />
        </div>
      </InfoCard>
    </div>
  );
}

function WorkflowsTab({ wfQ }: { wfQ: ReturnType<typeof useHrWorkflowSummary> }): VNode {
  const data: HrWorkflowSummary | undefined = wfQ.data;
  return (
    <InfoCard title="Open Workflows">
      {wfQ.isLoading || wfQ.isError
        ? <GatedState q={wfQ} empty="No open workflows." />
        : <MiniTable cols={['Workflow', 'Current Step', 'Status', 'Due']} empty="No open workflows.">
            {(data?.items ?? []).map(w => (
              <tr>
                <td>{humanize(w.workflow_type)}</td>
                <td>{w.current_step ?? '—'}</td>
                <td><Pill label={humanize(w.status)} tone={wfTone(w.status)} /></td>
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
      {auditQ.isLoading || auditQ.isError
        ? <GatedState q={auditQ} empty="No audit entries." />
        : <MiniTable cols={['Time', 'Actor', 'Action', 'Reason']} empty="No audit entries.">
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

function OnboardingTab({ employeeId }: { employeeId: string }): VNode {
  const q = useHrOnboardingCase(employeeId);
  const complete = useCompleteOnboardingTask(employeeId);
  const cancel = useCancelOnboarding(employeeId);
  if (q.isLoading) return <InfoCard title="Onboarding"><div class="em-empty">Loading…</div></InfoCard>;
  if (q.isError || !q.data) return <InfoCard title="Onboarding"><div class="em-empty">No onboarding case for this employee.</div></InfoCard>;
  const kase = q.data.case;
  const tasks = q.data.tasks;
  const handoffs = q.data.handoffs;
  const status = String(kase['status'] ?? '');
  const actErr = (complete.error ?? cancel.error);
  return (
    <div>
      <InfoCard title="Onboarding Case"
        action={status === 'in_progress'
          ? <button class="small-outline" type="button" disabled={cancel.isPending} onClick={() => cancel.mutate({ caseId: kase['id'] as string, reason: 'Cancelled from profile' })}>Cancel</button>
          : undefined}>
        <div class="field-list">
          <FieldRow label="Case" value={String(kase['case_no'] ?? '—')} />
          <FieldRow label="Package" value={humanize(String(kase['package_key'] ?? '—'))} />
          <FieldRow label="Status" value={<Pill label={humanize(status)} tone={status === 'completed' ? 'green' : status === 'cancelled' ? 'red' : status === 'blocked' ? 'amber' : 'blue'} />} />
          <FieldRow label="Started" value={fmtDate(kase['started_at'] as string)} />
          <FieldRow label="Due" value={fmtDate(kase['due_at'] as string | null)} />
        </div>
        {actErr ? <div class="em-empty" style={{ color: '#dc2626' }}>{actErr instanceof Error ? actErr.message : 'Action failed'}</div> : null}
      </InfoCard>
      <InfoCard title={`Tasks (${tasks.length})`}>
        <MiniTable cols={['Task', 'Owner', 'Status', '']} empty="No tasks.">
          {tasks.map(t => {
            const ts = String(t['status'] ?? '');
            const open = ts === 'pending' || ts === 'in_progress';
            return (
              <tr>
                <td>{String(t['task_title'] ?? '—')}</td>
                <td>{humanize(String(t['owner_role'] ?? '—'))}</td>
                <td><Pill label={humanize(ts)} tone={ts === 'completed' ? 'green' : ts === 'blocked' ? 'red' : ts === 'skipped' ? 'gray' : 'amber'} /></td>
                <td>{open ? <button class="small-outline" type="button" disabled={complete.isPending} onClick={() => complete.mutate(t['id'] as string)}>Complete</button> : '—'}</td>
              </tr>
            );
          })}
        </MiniTable>
      </InfoCard>
      {handoffs.length > 0 && (
        <InfoCard title="Handoffs">
          <MiniTable cols={['Module', 'Type', 'Status']} empty="No handoffs.">
            {handoffs.map(h => <tr><td>{humanize(String(h['target_module'] ?? '—'))}</td><td>{humanize(String(h['handoff_type'] ?? '—'))}</td><td>{humanize(String(h['status'] ?? '—'))}</td></tr>)}
          </MiniTable>
        </InfoCard>
      )}
    </div>
  );
}

function ModuleLinkTab({ title, body, action, onAction }: { title: string; body: string; action: string; onAction: () => void }): VNode {
  return (
    <InfoCard title={title} action={<button class="small-outline" type="button" onClick={onAction}>{action}</button>}>
      <div class="em-empty">{body}</div>
    </InfoCard>
  );
}

// ── drawer shell ─────────────────────────────────────────────────────────────────

const PRIMARY_TABS = ['Overview', 'Employment', 'Assignments', 'Documents', 'Training'];
const MORE_TABS = ['Statutory Profile', 'Onboarding', 'Leave', 'Attendance', 'Workflows', 'Audit'];

export function ProfileDrawer(
  { employeeId, onClose, onAction }:
  { employeeId: string | null; onClose: () => void; onAction: (label: string) => void },
): VNode {
  const [tab, setTab] = useState('Overview');
  const [menu, setMenu] = useState<string | null>(null);

  const detailQ = useHrEmployee(employeeId);
  const wfQ     = useHrWorkflowSummary(employeeId);
  const trainQ  = useHrTrainingSummary((tab === 'Overview' || tab === 'Training') ? employeeId : null);
  const auditQ  = useHrAudit((tab === 'Overview' || tab === 'Audit') ? employeeId : null);
  const docsQ   = useHrDocuments(tab === 'Documents' ? employeeId : null);

  if (!employeeId) return <aside class="drawer" aria-hidden="true" />;
  const d = detailQ.data;
  const e = d?.employee;
  const openWf = wfQ.data?.open_count ?? 0;

  const toggle = (id: string) => (ev: Event) => { ev.stopPropagation(); setMenu(menu === id ? null : id); };
  const act = (label: string) => { onAction(label); setMenu(null); };

  return (
    <aside class="drawer open" onClick={() => setMenu(null)}>
      <div class="drawer-top">
        <div class="drawer-title">Employee Profile</div>
        <div class="drawer-icons">
          <div class="dropdown-wrap">
            <button class="drawer-icon-btn" type="button" onClick={toggle('kebab')} aria-label="More">⋮</button>
            {menu === 'kebab' && (
              <div class="dropdown-menu right" onClick={ev => ev.stopPropagation()}>
                <div class="dropdown-list">
                  <button class="menu-row" type="button" onClick={() => act('Request Change')}><span class="menu-ico"><i class="fas fa-pen" /></span>Request Change</button>
                  <button class="menu-row" type="button" onClick={() => act('Upload HR Document')}><span class="menu-ico"><i class="fas fa-file" /></span>Upload HR Document</button>
                  <button class="menu-row" type="button" onClick={() => { setTab('Audit'); setMenu(null); }}><span class="menu-ico"><i class="fas fa-clock-rotate-left" /></span>View Audit</button>
                  <button class="menu-row danger" type="button" onClick={() => act('Start Offboarding')}><span class="menu-ico"><i class="fas fa-triangle-exclamation" /></span>Start Offboarding</button>
                </div>
              </div>
            )}
          </div>
          <button class="drawer-icon-btn" type="button" onClick={onClose} aria-label="Close profile">×</button>
        </div>
      </div>

      <div class="drawer-scroll">
        {!e ? (
          <div class="em-empty">{detailQ.isError ? 'Could not load this employee.' : 'Loading…'}</div>
        ) : (
          <>
            <div class="profile-head">
              <div class="profile-photo">{e.profile_image_url ? <img src={e.profile_image_url} alt={e.full_name ?? e.username} /> : <span class="profile-photo-initials">{initials(e.full_name ?? e.username)}</span>}</div>
              <div class="profile-name">
                <div class="profile-name-row"><h2>{e.full_name ?? e.username}</h2></div>
                <div class="employee-ref">ⓘ {e.employee_number ?? '—'} <Pill label={humanize(e.status)} tone={statusTone(e.status)} /></div>
                <div class="profile-meta">{e.position ?? '—'}<span>•</span>{e.departmentName ?? '—'}<span>•</span>{e.siteName ?? '—'}</div>
              </div>
            </div>

            <div class="profile-stats">
              <div class="profile-stat"><small>Training</small><Pill label={TRAINING_LABEL[e.trainingStatus]} tone={TRAINING_TONE[e.trainingStatus]} /></div>
              <div class="profile-stat"><small>Supervisor</small><div class="stat-line">{e.supervisorName ? <><TinyAvatar name={e.supervisorName} />{e.supervisorName}</> : '—'}</div></div>
              <div class="profile-stat profile-workflow-stat">
                <small>Open Workflows</small>
                <button class="workflow-mini-summary" type="button" onClick={() => setTab('Workflows')} title="Open workflow queue">
                  <span class="workflow-mini-left">
                    <span class="workflow-mini-icon" aria-hidden="true"><i class="fas fa-list-check" /></span>
                    <span class="workflow-mini-copy"><strong>{openWf} open</strong><em>{openWf ? 'Needs attention' : 'No pending approvals'}</em></span>
                  </span>
                  <span class="workflow-mini-action">{openWf ? 'Review' : 'Clear'}</span>
                </button>
              </div>
            </div>

            <div class="drawer-actions">
              <button class="primary-btn" type="button" onClick={() => act('Request Change')}>Request Change</button>
              <button class="secondary-btn" type="button" onClick={() => act('Change Status')}>Change Status</button>
              <div class="dropdown-wrap">
                <button class="secondary-btn drawer-more-button" type="button" onClick={toggle('more')} aria-label="More actions"><span class="more-ellipsis">•••</span></button>
                {menu === 'more' && (
                  <div class="dropdown-menu right" onClick={ev => ev.stopPropagation()}>
                    <div class="dropdown-list">
                      <button class="menu-row" type="button" onClick={() => act('Upload HR Document')}><span class="menu-ico"><i class="fas fa-file" /></span>Upload HR Document</button>
                      <button class="menu-row" type="button" onClick={() => { setTab('Statutory Profile'); setMenu(null); }}><span class="menu-ico"><i class="fas fa-file-shield" /></span>View Statutory Profile</button>
                      <button class="menu-row danger" type="button" onClick={() => act('Start Offboarding')}><span class="menu-ico"><i class="fas fa-triangle-exclamation" /></span>Start Offboarding</button>
                    </div>
                  </div>
                )}
              </div>
            </div>

            <div class="drawer-tabs">
              <div class="drawer-tab-list">
                {PRIMARY_TABS.map(t => <button class={`tab ${tab === t ? 'active' : ''}`} type="button" onClick={() => setTab(t)}>{t}</button>)}
              </div>
              <div class="dropdown-wrap">
                <button class={`tab drawer-tab-more-button ${MORE_TABS.includes(tab) ? 'active' : ''}`} type="button" onClick={toggle('tabmore')}>
                  <span>{MORE_TABS.includes(tab) ? tab : 'More'}</span><span class="tab-more-caret" aria-hidden="true">▾</span>
                </button>
                {menu === 'tabmore' && (
                  <div class="dropdown-menu right" onClick={ev => ev.stopPropagation()}>
                    <div class="dropdown-list">
                      {MORE_TABS.map(t => <button class="menu-row" type="button" onClick={() => { setTab(t); setMenu(null); }}><span class="menu-ico"><i class="fas fa-angle-right" /></span>{t}</button>)}
                    </div>
                  </div>
                )}
              </div>
            </div>

            {tab === 'Overview'          && <OverviewTab d={d!} trainQ={trainQ} auditQ={auditQ} onEditContact={() => onAction('Edit Contact')} />}
            {tab === 'Employment'        && <EmploymentTab d={d!} />}
            {tab === 'Assignments'       && <AssignmentsTab d={d!} />}
            {tab === 'Documents'         && <DocumentsTab docsQ={docsQ} employeeId={employeeId} onUpload={() => onAction('Upload HR Document')} />}
            {tab === 'Training'          && <TrainingTab trainQ={trainQ} trainingStatus={e.trainingStatus} />}
            {tab === 'Statutory Profile' && <StatutoryTab d={d!} onEdit={() => onAction('Edit Statutory Profile')} />}
            {tab === 'Onboarding'        && <OnboardingTab employeeId={employeeId} />}
            {tab === 'Leave'             && <ModuleLinkTab title="Leave" body="Leave balances and requests are managed in the Leave module." action="Open Leave" onAction={() => onAction('Open Leave')} />}
            {tab === 'Attendance'        && <ModuleLinkTab title="Attendance" body="Timesheets and clock events are managed in the Attendance module." action="Open Attendance" onAction={() => onAction('Open Attendance')} />}
            {tab === 'Workflows'         && <WorkflowsTab wfQ={wfQ} />}
            {tab === 'Audit'             && <AuditTab auditQ={auditQ} />}
          </>
        )}
      </div>
    </aside>
  );
}
