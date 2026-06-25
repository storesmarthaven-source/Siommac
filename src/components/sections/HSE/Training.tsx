/**
 * src/components/sections/HSE/Training.tsx
 *
 * Training / Competency area — Competency Matrix + Certifications tabs, wired to
 * the live API (hse/training/*). Siomac page standard: PageHeader → StatsCard row
 * → tab bar [TabBar | NewMenu] → compact spark row → register table (left) + navy
 * signals rail (right). Matrix rows open the Worker Profile drawer; cert rows open
 * the Certificate drawer.
 */

import { type VNode, type ComponentChildren } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, TabBar, NewMenu, withCounts, SidePanel,
  type AreaTab, type SidePanelSection,
} from '@ui';
import { TrainingInsightCards } from './training/TrainingInsightCards';
import {
  useTrainingStats, useCompetencyMatrix, useCertificates,
  type MatrixRow, type CertificateRow,
} from '@api/hse/training';
import { hsePill } from './types';
import { WorkerProfileDrawer } from './training/WorkerProfileDrawer';
import { CertificateDetailDrawer } from './training/CertificateDetailDrawer';
import { AddCertificateDialog, AssignTrainingDialog, CreateRequirementDialog } from './training/TrainingDialogs';

const TABS: AreaTab[] = [
  { key: 'matrix', label: 'Competency Matrix', sublabel: 'Coverage by role',   icon: 'fa-table-cells' },
  { key: 'certs',  label: 'Certifications',    sublabel: 'Certificate records', icon: 'fa-certificate' },
];

const titleCase = (s?: string | null) => (s ?? '').replace(/_/g, ' ').replace(/\b\w/g, c => c.toUpperCase());
const fmtDate = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';
const WORKER_PILL: Record<string, string> = { compliant: 'is-on', due_soon: 'is-warn', non_compliant: 'is-critical', pending_verification: 'is-info', not_applicable: 'is-off' };
const CERT_PILL: Record<string, string> = { current: 'is-on', due_soon: 'is-warn', pending_verification: 'is-info', expired: 'is-critical', rejected: 'is-critical', revoked: 'is-off', archived: 'is-off', draft: 'is-off' };
const isExpiredCert = (c: CertificateRow) => c.status === 'expired' || (!!c.expires_at && new Date(c.expires_at).getTime() < Date.now() && !['revoked', 'archived', 'rejected'].includes(c.status));

// ── Right rail ────────────────────────────────────────────────────────────────

function Signal({ icon, tone, title, sub, tag, tagTone, onClick }: {
  icon: string; tone: string; title: string; sub: string; tag: string; tagTone: string; onClick: () => void;
}): VNode {
  return (
    <div class="ppe-signal" onClick={onClick}>
      <i class={`fas ${icon} ${tone}`} />
      <div class="ppe-signal-text"><strong>{title}</strong><span>{sub}</span></div>
      <span class={`ppe-signal-tag ${tagTone}`}>{tag}</span>
    </div>
  );
}

function MatrixRail({ matrix, onOpen }: { matrix: MatrixRow[]; onOpen: (row: MatrixRow) => void }): VNode {
  const nonCompliant = matrix.filter(m => m.overallStatus === 'non_compliant');
  const dueWorkers   = matrix.filter(m => m.overallStatus === 'due_soon');
  const pending      = matrix.filter(m => m.overallStatus === 'pending_verification');
  const sections: SidePanelSection[] = [
    { id: 'noncompliant', label: 'Gaps', icon: 'fa-user-xmark', title: 'Non-Compliant', count: nonCompliant.length, empty: 'All workers compliant',
      children: nonCompliant.slice(0, 6).map(m => <Signal key={m.workerId} icon="fa-user-xmark" tone="is-danger" title={m.workerName} sub={`${m.expiredCount} expired · ${m.missingCount} missing`} tag="Gap" tagTone="is-high" onClick={() => onOpen(m)} />) },
    { id: 'due', label: 'Due Soon', icon: 'fa-hourglass-half', title: 'Due Soon', count: dueWorkers.length, empty: 'None due soon',
      children: dueWorkers.slice(0, 6).map(m => <Signal key={m.workerId} icon="fa-hourglass-half" tone="is-warn" title={m.workerName} sub={`${m.dueSoonCount} renewing`} tag="Due" tagTone="is-due" onClick={() => onOpen(m)} />) },
    { id: 'pending', label: 'Pending', icon: 'fa-clock', title: 'Pending Verification', count: pending.length, empty: 'None pending',
      children: pending.slice(0, 6).map(m => <Signal key={m.workerId} icon="fa-clock" tone="is-info" title={m.workerName} sub="Awaiting verification" tag="Pending" tagTone="is-info" onClick={() => onOpen(m)} />) },
  ];
  return <SidePanel title="Competency Signals" icon="fa-bell" sections={sections} />;
}

function CertRail({ certs, onOpen }: { certs: CertificateRow[]; onOpen: (id: string) => void }): VNode {
  const expiredCerts  = certs.filter(isExpiredCert);
  const renewingCerts = certs.filter(c => c.status === 'due_soon');
  const pendingCerts  = certs.filter(c => c.status === 'pending_verification');
  const sections: SidePanelSection[] = [
    { id: 'expired', label: 'Expired', icon: 'fa-triangle-exclamation', title: 'Expired', count: expiredCerts.length, empty: 'None expired',
      children: expiredCerts.slice(0, 6).map(c => <Signal key={c.id} icon="fa-triangle-exclamation" tone="is-danger" title={c.worker_name ?? c.worker_id} sub={c.course_name} tag="Expired" tagTone="is-high" onClick={() => onOpen(c.id)} />) },
    { id: 'renewing', label: 'Renewing', icon: 'fa-hourglass-half', title: 'Renewing Soon', count: renewingCerts.length, empty: 'None renewing',
      children: renewingCerts.slice(0, 6).map(c => <Signal key={c.id} icon="fa-hourglass-half" tone="is-warn" title={c.worker_name ?? c.worker_id} sub={`${c.course_name} · ${fmtDate(c.expires_at)}`} tag="Due" tagTone="is-due" onClick={() => onOpen(c.id)} />) },
    { id: 'pending', label: 'Pending', icon: 'fa-clock', title: 'Pending Verification', count: pendingCerts.length, empty: 'Nothing to verify',
      children: pendingCerts.slice(0, 6).map(c => <Signal key={c.id} icon="fa-clock" tone="is-info" title={c.worker_name ?? c.worker_id} sub={c.course_name} tag="Verify" tagTone="is-info" onClick={() => onOpen(c.id)} />) },
  ];
  return <SidePanel title="Certificate Signals" icon="fa-bell" sections={sections} />;
}

// ── Spark row ─────────────────────────────────────────────────────────────────

function Spark({ label, value, sub, color }: { label: string; value: ComponentChildren; sub: string; color?: string }): VNode {
  return (
    <div class="hse-spark">
      <div class="hse-spark-header"><span class="hse-spark-label">{label}</span></div>
      <div class="hse-spark-val" style={color ? { color } : undefined}>{value}</div>
      <div class="hse-spark-sub">{sub}</div>
    </div>
  );
}

// ── Page ──────────────────────────────────────────────────────────────────────

export function TrainingArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(TABS.some(t => t.key === tab) ? tab : 'matrix');
  const [openWorker, setOpenWorker] = useState<MatrixRow | null>(null);
  const [openCert, setOpenCert] = useState<string | null>(null);
  const [addCertOpen, setAddCertOpen] = useState(false);
  const [assignOpen, setAssignOpen] = useState(false);
  const [reqOpen, setReqOpen] = useState(false);
  const [presetWorker, setPresetWorker] = useState<string | undefined>(undefined);

  const s = useTrainingStats().data?.data;
  const matrix = useCompetencyMatrix({}).data?.data ?? [];
  const certs = useCertificates({ limit: 200 }).data?.data ?? [];

  const compliancePct = s?.overallCompliancePercent ?? 0;
  const currentCerts = s?.currentCerts ?? 0;
  const dueForRenewal = s?.dueForRenewal ?? 0;
  const expired = s?.expired ?? 0;

  const nonCompliant = matrix.filter(m => m.overallStatus === 'non_compliant');
  const dueWorkers   = matrix.filter(m => m.overallStatus === 'due_soon');
  const pendingCerts  = certs.filter(c => c.status === 'pending_verification');

  const tabsWithCounts = withCounts(TABS, { matrix: matrix.length, certs: certs.length });

  return (
    <div class="hse-tab hse-dash" style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
      <PageHeader
        icon="fa-graduation-cap" module="HSE" title="Training & Competency"
        sub="Worker competency, certificate verification, role requirements, and compliance readiness across all sites."
        meta={[
          { icon: 'fa-chart-pie', label: `${compliancePct}% compliant` },
          { icon: 'fa-certificate', label: `${currentCerts} current certs` },
          { icon: 'fa-hourglass-half', label: `${dueForRenewal} due for renewal` },
          { icon: 'fa-triangle-exclamation', label: `${expired} expired` },
        ]}
      />

      <TrainingInsightCards active={active} />

      <div style={{ display: 'flex', alignItems: 'stretch', gap: '12px', marginTop: '6px' }}>
        <div style={{ flex: 1, minWidth: 0 }}>
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />
        </div>
        <div style={{ flexShrink: 0 }}>
          <NewMenu label="Add Certificate" fill items={[
            { label: 'Add Certificate', icon: 'fa-certificate', sub: 'Record a worker certificate', onSelect: () => { setPresetWorker(undefined); setAddCertOpen(true); } },
            { label: 'Assign Training', icon: 'fa-graduation-cap', sub: 'Assign training to a worker', onSelect: () => { setPresetWorker(undefined); setAssignOpen(true); } },
            { label: 'Create Role Requirement', icon: 'fa-list-check', sub: 'Define a role competency rule', onSelect: () => setReqOpen(true) },
          ]} />
        </div>
      </div>

      {/* Compact KPI spark row (under the nav) */}
      {active === 'matrix' ? (
        <div class="hse-spark-row">
          <Spark label="Overall Compliance" value={`${compliancePct}%`} sub="Target 85%" color={compliancePct >= 85 ? '#22c55e' : '#f59e0b'} />
          <Spark label="Non-compliant" value={nonCompliant.length} sub="Workers with gaps" color={nonCompliant.length > 0 ? '#ef4444' : '#22c55e'} />
          <Spark label="Due Soon" value={dueWorkers.length} sub="Workers renewing" color="#f59e0b" />
          <Spark label="Tracked" value={s?.trackedWorkers ?? matrix.length} sub="Workers in matrix" />
        </div>
      ) : (
        <div class="hse-spark-row">
          <Spark label="Current" value={currentCerts} sub="Valid on file" color="#22c55e" />
          <Spark label="Due For Renewal" value={dueForRenewal} sub="Within 90 days" color="#f59e0b" />
          <Spark label="Expired" value={expired} sub="Must not perform task" color={expired > 0 ? '#ef4444' : '#22c55e'} />
          <Spark label="Pending" value={pendingCerts.length} sub="Awaiting verification" color="#60a5fa" />
        </div>
      )}

      {/* Competency Matrix tab */}
      {active === 'matrix' && (
        <div class="hse-main-grid">
          <div class="hse-left-col">
            <div class="vt-table-card">
              <div class="vt-table-scroll">
                <table class="vt-table">
                  <thead>
                    <tr>
                      <th>Worker</th><th>Role</th>
                      <th style={{ textAlign: 'center' }}>Compliance</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {matrix.map(m => (
                      <tr key={m.workerId} style={{ cursor: 'pointer' }} onClick={() => setOpenWorker(m)}>
                        <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{m.workerName}</span></td>
                        <td class="vt-cell-subtext">{titleCase(m.roleName)}</td>
                        <td style={{ textAlign: 'center' }}>{m.requiredCount > 0 ? `${m.compliantCount}/${m.requiredCount}` : '—'}</td>
                        <td style={{ textAlign: 'center' }}><span class={`vt-pill ${WORKER_PILL[m.overallStatus] ?? 'is-off'}`}>{titleCase(m.overallStatus)}</span></td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button class="hse-btn" style={{ padding: '4px 10px' }} onClick={() => setOpenWorker(m)}>View</button>
                        </td>
                      </tr>
                    ))}
                    {matrix.length === 0 && <tr><td colSpan={5} class="hse-muted" style={{ textAlign: 'center', padding: '24px' }}>No workers / requirements yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="hse-right-col">
            <MatrixRail matrix={matrix} onOpen={setOpenWorker} />
          </div>
        </div>
      )}

      {/* Certifications tab */}
      {active === 'certs' && (
        <div class="hse-main-grid">
          <div class="hse-left-col">
            <div class="vt-table-card">
              <div class="vt-table-scroll">
                <table class="vt-table">
                  <thead>
                    <tr>
                      <th>Ref</th><th>Worker</th><th>Course</th>
                      <th style={{ textAlign: 'center' }}>Expiry</th>
                      <th style={{ textAlign: 'center' }}>Status</th>
                      <th style={{ textAlign: 'center' }}>Actions</th>
                    </tr>
                  </thead>
                  <tbody>
                    {certs.map(c => (
                      <tr key={c.id} style={{ cursor: 'pointer' }} onClick={() => setOpenCert(c.id)}>
                        <td><span class="vt-cell-mono">{c.certificate_no}</span></td>
                        <td class="vt-cell-subtext">{c.worker_name ?? c.worker_id}</td>
                        <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{c.course_name}</span></td>
                        <td style={{ textAlign: 'center', color: isExpiredCert(c) ? 'var(--siomac-red)' : 'inherit', fontWeight: isExpiredCert(c) ? 600 : 400 }}>{fmtDate(c.expires_at)}</td>
                        <td style={{ textAlign: 'center' }}><span class={`vt-pill ${CERT_PILL[c.status] ?? 'is-info'}`}>{titleCase(c.status)}</span></td>
                        <td style={{ textAlign: 'center' }} onClick={e => e.stopPropagation()}>
                          <button class="hse-btn" style={{ padding: '4px 10px' }} onClick={() => setOpenCert(c.id)}>View</button>
                        </td>
                      </tr>
                    ))}
                    {certs.length === 0 && <tr><td colSpan={6} class="hse-muted" style={{ textAlign: 'center', padding: '24px' }}>No certificates yet.</td></tr>}
                  </tbody>
                </table>
              </div>
            </div>
          </div>
          <div class="hse-right-col">
            <CertRail certs={certs} onOpen={setOpenCert} />
          </div>
        </div>
      )}

      <AddCertificateDialog open={addCertOpen} onClose={() => setAddCertOpen(false)} presetWorkerId={presetWorker} />
      <AssignTrainingDialog open={assignOpen} onClose={() => setAssignOpen(false)} presetWorkerId={presetWorker} />
      <CreateRequirementDialog open={reqOpen} onClose={() => setReqOpen(false)} />

      <WorkerProfileDrawer
        row={openWorker} onClose={() => setOpenWorker(null)}
        onOpenCert={id => { setOpenWorker(null); setOpenCert(id); }}
        onAssign={wid => { setPresetWorker(wid); setOpenWorker(null); setAssignOpen(true); }}
        onAddCert={wid => { setPresetWorker(wid); setOpenWorker(null); setAddCertOpen(true); }}
      />
      <CertificateDetailDrawer certificateId={openCert} onClose={() => setOpenCert(null)} />
    </div>
  );
}
