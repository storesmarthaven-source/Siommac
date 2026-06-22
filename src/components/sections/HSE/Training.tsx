/**
 * src/components/sections/HSE/Training.tsx
 * Training & Competency area — competency matrix + certifications.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, withCounts, HseModal, Field, SelectInput, TextInput,
  type AreaTab,
} from '@ui';
import {
  mockCompetency, mockCertifications, TRAINING_COURSES, HSE_SITES,
  type CompetencyStatus, type CertificationRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'matrix', label: 'Competency Matrix', sublabel: 'Team overview',    icon: 'fa-table-cells-large' },
  { key: 'certs',  label: 'Certifications',    sublabel: 'Individual certs', icon: 'fa-certificate' },
];

const STATUS_STYLE: Record<CompetencyStatus, { bg: string; color: string; label: string }> = {
  current:  { bg: 'rgba(34,197,94,.18)',   color: '#4ade80', label: 'OK'  },
  due:      { bg: 'rgba(245,158,11,.18)',  color: '#fcd34d', label: 'Due' },
  expired:  { bg: 'rgba(239,68,68,.18)',   color: '#fca5a5', label: 'Exp' },
  none:     { bg: 'rgba(255,255,255,.06)', color: 'rgba(255,255,255,.3)', label: '–' },
};

function MatrixTab(): VNode {
  const totalCells = mockCompetency.length * TRAINING_COURSES.length;
  const current    = mockCompetency.flatMap(r => r.cells).filter(c => c.status === 'current').length;
  const expired    = mockCompetency.flatMap(r => r.cells).filter(c => c.status === 'expired').length;
  const due        = mockCompetency.flatMap(r => r.cells).filter(c => c.status === 'due').length;
  const compliance = Math.round((current / totalCells) * 100);

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Overall Compliance</span></div>
          <div class="hse-spark-val" style={{ color: compliance >= 85 ? '#22c55e' : '#f59e0b' }}>{compliance}%</div>
          <div class="hse-spark-sub">Current / total competency slots</div>
          <div class="hse-spark-bar-track" style={{ marginTop: '6px' }}>
            <div class="hse-spark-bar-fill" style={{ width: `${compliance}%`, background: compliance >= 85 ? '#22c55e' : '#f59e0b' }} />
          </div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Current</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{current}</div>
          <div class="hse-spark-sub">Valid competencies</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Due for Renewal</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div>
          <div class="hse-spark-sub">Renewal within 90 days</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Expired</span></div>
          <div class="hse-spark-val" style={{ color: '#ef4444' }}>{expired}</div>
          <div class="hse-spark-sub">Immediate action required</div>
        </div>
      </div>

      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead>
              <tr>
                <th>Worker</th><th>Role</th><th>Site</th>
                {TRAINING_COURSES.map(c => <th key={c} style={{ whiteSpace: 'nowrap', fontSize: '0.66rem' }}>{c}</th>)}
              </tr>
            </thead>
            <tbody>
              {mockCompetency.map(row => (
                <tr key={row.worker.id}>
                  <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{row.worker.name}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{row.worker.role}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{row.worker.site}</td>
                  {row.cells.map(cell => {
                    const s = STATUS_STYLE[cell.status];
                    return (
                      <td key={cell.course} style={{ padding: '6px 8px' }}>
                        <span style={{ display: 'inline-block', padding: '3px 8px', borderRadius: '6px', fontSize: '0.62rem', fontWeight: 600, background: s.bg, color: s.color }}>
                          {s.label}
                        </span>
                      </td>
                    );
                  })}
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function CertsTab({ certs, onAdd }: { certs: CertificationRow[]; onAdd: () => void }): VNode {
  const expired = certs.filter(c => /expired/i.test(c.status)).length;
  const due     = certs.filter(c => /due/i.test(c.status)).length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Certificates</span></div>
          <div class="hse-spark-val">{certs.length}</div>
          <div class="hse-spark-sub">Across all workers and courses</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Due for Renewal</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div>
          <div class="hse-spark-sub">Within 90 days</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Expired</span></div>
          <div class="hse-spark-val" style={{ color: '#ef4444' }}>{expired}</div>
          <div class="hse-spark-sub">Must not perform task</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Current</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{certs.filter(c => /current/i.test(c.status)).length}</div>
          <div class="hse-spark-sub">Valid certifications</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search certifications…" />
            </div>
            <select class="emp-filter-select">
              <option>All courses</option>
              {TRAINING_COURSES.map(c => <option key={c}>{c}</option>)}
            </select>
            <button class="hse-btn primary" onClick={onAdd}><i class="fas fa-circle-plus" /> Add Certificate</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Worker</th><th>Course</th><th>Issued</th><th>Expiry</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {certs.map(c => (
                    <tr key={c.ref}>
                      <td><span class="vt-cell-mono">{c.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{c.worker}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.course}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.issued}</td>
                      <td style={{ color: /expired/i.test(c.status) ? 'var(--siomac-red)' : /due/i.test(c.status) ? '#d97706' : 'inherit', fontWeight: /expired|due/i.test(c.status) ? 600 : 400 }}>{c.expiry}</td>
                      <td>
                        <span class={`vt-pill ${/current/i.test(c.status) ? 'is-on' : /due/i.test(c.status) ? 'is-warn' : 'is-off'}`}>{c.status}</span>
                      </td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-chart-bar" /> By Course · Expiry Status</h4>
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {TRAINING_COURSES.map(course => {
              const courseCerts = certs.filter(c => c.course === course);
              const expired = courseCerts.filter(c => /expired/i.test(c.status)).length;
              const due     = courseCerts.filter(c => /due/i.test(c.status)).length;
              const color   = expired > 0 ? '#ef4444' : due > 0 ? '#f59e0b' : '#4ade80';
              return (
                <div key={course} style={{ display: 'flex', alignItems: 'center', gap: '10px' }}>
                  <span style={{ fontSize: '0.69rem', color: 'rgba(255,255,255,.7)', flex: 1, minWidth: 0 }}>{course}</span>
                  {expired > 0 && <span style={{ fontSize: '0.6rem', fontWeight: 600, color: '#fca5a5', background: 'rgba(239,68,68,.18)', padding: '2px 7px', borderRadius: '999px' }}>{expired} exp</span>}
                  {due > 0     && <span style={{ fontSize: '0.6rem', fontWeight: 600, color: '#fcd34d', background: 'rgba(245,158,11,.18)', padding: '2px 7px', borderRadius: '999px' }}>{due} due</span>}
                  {expired === 0 && due === 0 && <span style={{ fontSize: '0.6rem', fontWeight: 600, color: '#4ade80', background: 'rgba(34,197,94,.18)', padding: '2px 7px', borderRadius: '999px' }}>OK</span>}
                </div>
              );
            })}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-circle-exclamation" /> Action Required</h4>
          <div class="ppe-signals-list">
            {certs.filter(c => /expired|due/i.test(c.status)).map(c => (
              <div class="ppe-signal" key={c.ref}>
                <i class={`fas fa-certificate ${/expired/i.test(c.status) ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{c.worker}</strong>
                  <span>{c.course} · Expires {c.expiry}</span>
                </div>
                <span class={`ppe-signal-tag ${/expired/i.test(c.status) ? 'is-high' : 'is-due'}`}>{c.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function TrainingArea({ tab }: { tab: string }): VNode {
  const [active, setActive]   = useState(tab);
  const [certs, setCerts]     = useState<CertificationRow[]>(mockCertifications);
  const [modalOpen, setModal] = useState(false);
  const [newWorker, setWorker] = useState('');
  const [newCourse, setCourse] = useState<string>(TRAINING_COURSES[0]);
  const [newExpiry, setExpiry] = useState('');

  const totalCells = mockCompetency.length * TRAINING_COURSES.length;
  const current    = mockCompetency.flatMap(r => r.cells).filter(c => c.status === 'current').length;
  const expired    = certs.filter(c => /expired/i.test(c.status)).length;
  const due        = certs.filter(c => /due/i.test(c.status)).length;

  const compliance = totalCells > 0 ? Math.round((current / totalCells) * 100) : 0;

  const stats = [
    { icon: 'fa-users',          label: 'Workers tracked',  value: mockCompetency.length, sub: 'in matrix',      color: 'blue'  as const },
    { icon: 'fa-circle-check',   label: 'Current',          value: current,               sub: 'valid certs',    color: 'green' as const },
    { icon: 'fa-clock',          label: 'Due for renewal',  value: due,                   sub: 'within 90 days', color: 'gold'  as const },
    { icon: 'fa-circle-xmark',   label: 'Expired',          value: expired,               sub: 'must not work',  color: 'red'   as const },
  ];

  const tabsWithCounts = withCounts(TABS, { matrix: mockCompetency.length, certs: certs.length });

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-graduation-cap"
        areaIcon="fa-user-graduate"
        title="Training & Competency"
        watermarkClass="hse-wm-training"
        stats={stats}
        footerItems={[
          { icon: 'fa-chart-pie', label: 'Overall Compliance', value: `${compliance}%`, progress: compliance, pill: compliance >= 85 ? '● Compliant' : '● At Risk', pillVariant: compliance >= 85 ? 'green' : 'amber' },
          { icon: 'fa-book-open', label: 'Courses Tracked', value: `${TRAINING_COURSES.length} courses`, pill: '● Active', pillVariant: 'green' },
          { icon: 'fa-clock', label: 'Expiring in 90 Days', value: String(due), trend: due > 0 ? 'renew soon' : undefined, trendUp: false },
          { icon: 'fa-circle-xmark', label: 'Expired Certs', value: String(expired), pill: expired > 0 ? '● Action Required' : '● All Clear', pillVariant: expired > 0 ? 'red' : 'green' },
        ]}
      />

      <div class="hse-spark-grid">
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Overall Compliance</span></div>
          <div class="hse-spark-val" style={{ color: compliance >= 85 ? '#22c55e' : '#f59e0b' }}>{compliance}%</div>
          <div class="hse-spark-sub">Current / total competency slots</div>
          <div class="hse-spark-bar-track" style={{ marginTop: '8px' }}>
            <div class="hse-spark-bar-fill" style={{ width: `${compliance}%`, background: compliance >= 85 ? '#22c55e' : '#f59e0b' }} />
          </div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Current Certs</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{current}</div>
          <div class="hse-spark-sub">Valid competencies on file</div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Due for Renewal</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div>
          <div class="hse-spark-sub">Within next 90 days</div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Expired</span></div>
          <div class="hse-spark-val" style={{ color: expired > 0 ? '#ef4444' : '#4ade80' }}>{expired}</div>
          <div class="hse-spark-sub">Must not perform task</div>
        </div>
      </div>

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <AreaTabs
            icon="fa-graduation-cap"
            title="Training & Competency"
            sub="Competency matrix, certifications, and renewal tracking"
            tabs={tabsWithCounts} active={active} onSelect={setActive}
            actionLabel="Add Certificate" onAction={() => setModal(true)}
          />

          {active === 'matrix' && <MatrixTab />}
          {active === 'certs'  && <CertsTab certs={certs} onAdd={() => setModal(true)} />}
        </div>

        <div class="hse-right-col">
          <div class="oq-dark-card">
            <div class="oq-dark-header">
              <i class="fas fa-circle-xmark" />
              <span>Expired Certificates</span>
              <span class="oq-dark-count">{expired}</span>
            </div>
            <div class="oq-dark-vertical">
              {certs.filter(c => /expired/i.test(c.status)).slice(0, 5).map(c => (
                <div class="oq-dark-item" key={c.ref}>
                  <div class="icon-badge red"><i class="fas fa-certificate" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{c.worker}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{c.course} · Expired {c.expiry}</div>
                  </div>
                  <span class="oq-dark-tag danger">Expired</span>
                </div>
              ))}
              {expired === 0 && <div style={{ padding: '16px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>No expired certificates</div>}
            </div>
            <div class="oq-dark-header" style={{ marginTop: '12px' }}>
              <i class="fas fa-clock" />
              <span>Renewing Soon</span>
              <span class="oq-dark-count">{due}</span>
            </div>
            <div class="oq-dark-vertical">
              {certs.filter(c => /due/i.test(c.status)).slice(0, 4).map(c => (
                <div class="oq-dark-item" key={c.ref}>
                  <div class="icon-badge amber"><i class="fas fa-clock" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{c.worker}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{c.course} · Due {c.expiry}</div>
                  </div>
                  <span class="oq-dark-tag warning">Due</span>
                </div>
              ))}
              {due === 0 && <div style={{ padding: '12px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>All current</div>}
            </div>
          </div>
        </div>
      </div>

      <HseModal
        open={modalOpen} onClose={() => setModal(false)}
        title="Add Certificate" sub="Record a training certificate for a worker."
        submitLabel="Add Certificate"
        onSubmit={() => {
          const ref = `CERT-${1200 + certs.length}`;
          setCerts([{ ref, worker: newWorker || 'Unknown', course: newCourse, issued: '19 Jun 2026', expiry: newExpiry || 'TBD', status: 'Current' }, ...certs]);
          setModal(false); setWorker(''); setExpiry('');
        }}
      >
        <div class="hse-form-grid">
          <Field label="Worker name"><TextInput value={newWorker} onInput={setWorker} placeholder="Full name" /></Field>
          <Field label="Course"><SelectInput value={newCourse} onInput={setCourse} options={[...TRAINING_COURSES]} /></Field>
          <Field label="Expiry date"><TextInput value={newExpiry} onInput={setExpiry} placeholder="e.g. 19 Jun 2027" /></Field>
        </div>
      </HseModal>
    </div>
  );
}
