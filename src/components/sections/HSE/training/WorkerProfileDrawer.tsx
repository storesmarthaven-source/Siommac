/**
 * src/components/sections/HSE/training/WorkerProfileDrawer.tsx
 * Worker Training Profile (opens from a Competency Matrix row): overview +
 * required competencies + certificates + assignments. Live-wired.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Drawer, Tabs, type TabDef } from '@ui';
import { useCertificates, useAssignments, type MatrixRow, type CellStatus } from '@api/hse/training';
import { hsePill } from '../types';

type TabKey = 'competencies' | 'certificates' | 'assignments';
const TABS: TabDef<TabKey>[] = [
  { key: 'competencies', label: 'Required' }, { key: 'certificates', label: 'Certificates' }, { key: 'assignments', label: 'Assignments' },
];
const fmt = (iso?: string | null) => iso ? new Date(iso).toLocaleDateString(undefined, { day: '2-digit', month: 'short', year: '2-digit' }) : '—';

const CELL_PILL: Record<CellStatus, { cls: string; label: string }> = {
  ok: { cls: 'is-on', label: 'OK' }, due_soon: { cls: 'is-warn', label: 'Due' }, expired: { cls: 'is-critical', label: 'Expired' },
  missing: { cls: 'is-critical', label: 'Missing' }, pending_verification: { cls: 'is-info', label: 'Pending' }, not_required: { cls: 'is-off', label: 'N/A' },
};

export function WorkerProfileDrawer({ row, onClose, onOpenCert, onAssign, onAddCert }: {
  row: MatrixRow | null; onClose: () => void; onOpenCert: (id: string) => void; onAssign: (workerId: string) => void; onAddCert: (workerId: string) => void;
}): VNode {
  const [tab, setTab] = useState<TabKey>('competencies');
  const certs = useCertificates(row ? { workerId: row.workerId } : {}).data?.data ?? [];
  const assignments = useAssignments(row ? { workerId: row.workerId } : {}).data?.data ?? [];

  const foot = (
    <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
      {row && <button class="hse-btn primary" onClick={() => onAddCert(row.workerId)}><i class="fas fa-plus" /> Add Certificate</button>}
      {row && <button class="hse-btn" onClick={() => onAssign(row.workerId)}><i class="fas fa-graduation-cap" /> Assign Training</button>}
      <button class="hse-btn" onClick={onClose}>Close</button>
    </div>
  );

  return (
    <Drawer open={!!row} onClose={onClose} title={row?.workerName ?? 'Worker'} sub={row?.roleName ?? undefined} foot={foot}>
      {row && (
        <>
          <div style={{ marginBottom: '12px', display: 'flex', gap: '8px', alignItems: 'center' }}>
            <span class={hsePill(row.overallStatus)}>{row.overallStatus.replace(/_/g, ' ')}</span>
            <span class="vt-cell-subtext">{row.compliantCount}/{row.requiredCount} compliant · {row.expiredCount} expired · {row.missingCount} missing</span>
          </div>
          <Tabs<TabKey> tabs={TABS} active={tab} onChange={setTab} />

          {tab === 'competencies' && (
            <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
              {row.competencies.length === 0 && <div class="hse-muted">No required competencies for this role.</div>}
              {row.competencies.map(c => {
                const p = CELL_PILL[c.status];
                return (
                  <div key={c.competencyId} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px', alignItems: 'center', cursor: c.certificateId ? 'pointer' : 'default' }}
                    onClick={() => c.certificateId && onOpenCert(c.certificateId)}>
                    <div><div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{c.competencyName}</div><div class="vt-cell-subtext">{c.requirementLevel}{c.expiresAt ? ` · expires ${fmt(c.expiresAt)}` : ''}</div></div>
                    <span class={`vt-pill ${p.cls}`}>{p.label}</span>
                  </div>
                );
              })}
            </div>
          )}

          {tab === 'certificates' && (
            <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
              {certs.length === 0 && <div class="hse-muted">No certificates on file.</div>}
              {certs.map(ct => (
                <div key={ct.id} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px', cursor: 'pointer' }} onClick={() => onOpenCert(ct.id)}>
                  <div><div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{ct.course_name}</div><div class="vt-cell-subtext">{ct.certificate_no} · expires {fmt(ct.expires_at)}</div></div>
                  <span class={hsePill(ct.status)}>{ct.status.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}

          {tab === 'assignments' && (
            <div style={{ marginTop: '12px', display: 'grid', gap: '6px' }}>
              {assignments.length === 0 && <div class="hse-muted">No training assignments.</div>}
              {assignments.map(a => (
                <div key={a.id} class="vt-table-card" style={{ padding: '10px 12px', display: 'flex', justifyContent: 'space-between', gap: '8px' }}>
                  <div><div style={{ fontSize: '0.82rem', fontWeight: 500 }}>{a.reason ?? a.assignment_no}</div><div class="vt-cell-subtext">{a.priority} · due {fmt(a.due_at)}</div></div>
                  <span class={hsePill(a.status)}>{a.status.replace(/_/g, ' ')}</span>
                </div>
              ))}
            </div>
          )}
        </>
      )}
    </Drawer>
  );
}
