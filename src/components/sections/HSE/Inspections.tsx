/**
 * src/components/sections/HSE/Inspections.tsx
 * Inspections & Audits area — schedule + findings tabs.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, MetricRow, ReorderableRow, TabBar, withCounts, SparkCard, HseModal, Field, SelectInput, TextInput,
  type AreaTab, type SparkDef,
} from '@ui';
import {
  mockInspections, mockFindings, hsePill, HSE_SITES,
  type InspectionRow, type FindingRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'schedule', label: 'Schedule',  sublabel: 'Upcoming & overdue', icon: 'fa-calendar-check' },
  { key: 'findings', label: 'Findings',  sublabel: 'Non-conformances',   icon: 'fa-magnifying-glass' },
];

const INSP_TYPES = ['Fire', 'Equipment', 'Housekeeping', 'Chemical', 'Emergency', 'PPE', 'Environmental'] as const;

const TYPE_ICONS: Record<string, string> = {
  Fire: 'fa-fire-extinguisher', Equipment: 'fa-wrench', Housekeeping: 'fa-broom',
  Chemical: 'fa-flask', Emergency: 'fa-kit-medical', PPE: 'fa-helmet-safety', Environmental: 'fa-leaf',
};

function ScheduleTab({ inspections, onNew }: { inspections: InspectionRow[]; onNew: () => void }): VNode {
  const overdue   = inspections.filter(i => /overdue/i.test(i.status)).length;
  const due       = inspections.filter(i => /^due$/i.test(i.status)).length;
  const scheduled = inspections.filter(i => /scheduled/i.test(i.status)).length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <ReorderableRow pageKey="hse.inspections.0">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Overdue</span></div>
          <div class="hse-spark-val" style={{ color: overdue > 0 ? '#ef4444' : '#22c55e' }}>{overdue}</div>
          <div class="hse-spark-sub">Past due date, not completed</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Due This Week</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div>
          <div class="hse-spark-sub">Action required by end of week</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Scheduled</span></div>
          <div class="hse-spark-val">{scheduled}</div>
          <div class="hse-spark-sub">Upcoming inspections confirmed</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Completion Rate</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>92%</div>
          <div class="hse-spark-sub">YTD inspections completed on time</div>
        </div>
      </ReorderableRow>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-calendar-check" /></span>
            <div>
              <div class="vt-section-title">Inspection Schedule</div>
              <div class="vt-section-sub">Scheduled and overdue inspections across all sites. Click a row to record findings.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search inspections…" />
            </div>
            <select class="emp-filter-select">
              <option>All types</option>
              {INSP_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button class="hse-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> Schedule Inspection</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Inspection</th><th>Type</th><th>Site</th><th>Assignee</th><th>Due</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {inspections.map(i => (
                    <tr key={i.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{i.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{i.title}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          <i class={`fas ${TYPE_ICONS[i.type] ?? 'fa-clipboard'}`} style={{ fontSize: '0.72rem' }} /> {i.type}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{i.site}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{i.assignee}</td>
                      <td style={{ color: /overdue/i.test(i.status) ? 'var(--siomac-red)' : 'inherit', fontWeight: /overdue/i.test(i.status) ? 600 : 400 }}>{i.due}</td>
                      <td><span class={hsePill(i.status)}>{i.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar — inspection type breakdown */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-chart-bar" /> By Type · YTD</h4>
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { label: 'Fire',         count: 18, color: '#ef4444' },
              { label: 'Housekeeping', count: 14, color: '#f59e0b' },
              { label: 'Equipment',    count: 12, color: '#60a5fa' },
              { label: 'Chemical',     count: 9,  color: '#a78bfa' },
              { label: 'PPE',          count: 7,  color: '#34d399' },
              { label: 'Emergency',    count: 5,  color: '#fb923c' },
            ].map(b => {
              const pct = Math.round((b.count / 65) * 100);
              return (
                <div key={b.label}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.69rem', color: 'rgba(255,255,255,.7)', marginBottom: '4px' }}>
                    <span>{b.label}</span><span style={{ fontWeight: 600, color: b.color }}>{b.count}</span>
                  </div>
                  <div style={{ height: '5px', borderRadius: '999px', background: 'rgba(255,255,255,.12)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '999px', background: b.color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-triangle-exclamation" /> Attention Required</h4>
          <div class="ppe-signals-list">
            {inspections.filter(i => /overdue|due/i.test(i.status)).map(i => (
              <div class="ppe-signal" key={i.ref}>
                <i class={`fas ${TYPE_ICONS[i.type] ?? 'fa-clipboard'} ${/overdue/i.test(i.status) ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{i.title}</strong>
                  <span>{i.assignee} · {i.due}</span>
                </div>
                <span class={`ppe-signal-tag ${/overdue/i.test(i.status) ? 'is-high' : 'is-due'}`}>{i.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function FindingsTab({ findings }: { findings: FindingRow[] }): VNode {
  const open     = findings.filter(f => /open/i.test(f.status)).length;
  const critical = findings.filter(f => f.severity === 'danger').length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <ReorderableRow pageKey="hse.inspections.1">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Open Findings</span></div>
          <div class="hse-spark-val" style={{ color: open > 0 ? '#f59e0b' : '#22c55e' }}>{open}</div>
          <div class="hse-spark-sub">Require corrective action</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Critical</span></div>
          <div class="hse-spark-val" style={{ color: critical > 0 ? '#ef4444' : '#22c55e' }}>{critical}</div>
          <div class="hse-spark-sub">Immediate action required</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Closed YTD</span></div>
          <div class="hse-spark-val">31</div>
          <div class="hse-spark-sub">Findings resolved this year</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Closure Rate</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>91%</div>
          <div class="hse-spark-sub">Findings closed within SLA</div>
        </div>
      </ReorderableRow>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-magnifying-glass" /></span>
            <div>
              <div class="vt-section-title">Inspection Findings</div>
              <div class="vt-section-sub">Non-conformances and observations raised from inspections. Critical findings auto-raise a CAPA.</div>
            </div>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Finding</th><th>Inspection</th><th>Site</th><th>Severity</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {findings.map(f => (
                    <tr key={f.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{f.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{f.finding}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}><span class="vt-cell-mono">{f.inspection}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{f.site}</td>
                      <td>
                        <span class={`vt-pill ${f.severity === 'danger' ? 'is-off' : f.severity === 'warning' ? 'is-warn' : 'is-info'}`}>
                          {f.severity === 'danger' ? 'Critical' : f.severity === 'warning' ? 'High' : 'Medium'}
                        </span>
                      </td>
                      <td><span class={hsePill(f.status)}>{f.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-gauge-high" /> Finding Summary</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { val: findings.length, label: 'Total findings',  color: '#fff' },
              { val: open,            label: 'Open',            color: '#f59e0b' },
              { val: critical,        label: 'Critical',        color: '#ef4444' },
              { val: findings.filter(f => /closed/i.test(f.status)).length, label: 'Closed', color: '#4ade80' },
            ].map(k => (
              <div key={k.label} style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.val}</div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,.5)', marginTop: '3px' }}>{k.label}</div>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-circle-exclamation" /> Open Findings</h4>
          <div class="ppe-signals-list">
            {findings.filter(f => /open/i.test(f.status)).map(f => (
              <div class="ppe-signal" key={f.ref}>
                <i class={`fas fa-circle-exclamation ${f.severity === 'danger' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{f.finding}</strong>
                  <span>{f.site} · {f.inspection}</span>
                </div>
                <span class={`ppe-signal-tag ${f.severity === 'danger' ? 'is-high' : 'is-due'}`}>
                  {f.severity === 'danger' ? 'Critical' : 'High'}
                </span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function InspectionsArea({ tab }: { tab: string }): VNode {
  const [active, setActive]         = useState(tab);
  const [inspections, setInspections] = useState<InspectionRow[]>(mockInspections);
  const [findings]                  = useState<FindingRow[]>(mockFindings);
  const [modalOpen, setModal]       = useState(false);
  const [newType, setNewType]       = useState<string>(INSP_TYPES[0]);
  const [newSite, setNewSite]       = useState<string>(HSE_SITES[0]);
  const [newTitle, setNewTitle]     = useState('');

  const overdue      = inspections.filter(i => /overdue/i.test(i.status)).length;
  const scheduled    = inspections.filter(i => /scheduled/i.test(i.status)).length;
  const openFindings = findings.filter(f => /open/i.test(f.status)).length;
  const critFindings = findings.filter(f => f.severity === 'danger' && /open/i.test(f.status)).length;

  const sparks: SparkDef[] = [
    {
      label: 'Scheduled', value: String(scheduled), sub: 'Upcoming inspections',
      delta: 'Confirmed', deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, scheduled], sparkColor: '#60a5fa',
    },
    {
      label: 'Overdue', value: String(overdue), sub: 'Past due date',
      delta: overdue > 0 ? 'Action required' : 'On track', deltaUp: overdue > 0, color: overdue > 0 ? '#ef4444' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, overdue], sparkColor: '#ef4444',
    },
    {
      label: 'Completion Rate', value: '92%', sub: 'YTD · Target 90%',
      progress: { pct: 92, color: '#22c55e', target: 'Target: 90%' },
    },
    {
      label: 'Open Findings', value: String(openFindings), sub: `${critFindings} critical · ${openFindings - critFindings} minor`,
      delta: critFindings > 0 ? `${critFindings} critical` : 'No critical', deltaUp: critFindings > 0, color: openFindings > 0 ? '#f59e0b' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, openFindings], sparkColor: '#f59e0b',
    },
  ];

  const tabsWithCounts = withCounts(TABS, { schedule: inspections.length, findings: findings.length });

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-clipboard-check"
        module="HSE"
        title="Inspections & Audits"
        sub="Schedule inspections, track findings, and manage non-conformances across all sites."
        meta={[
          { icon: 'fa-calendar-check', label: `${inspections.length} inspections` },
          { icon: 'fa-triangle-exclamation', label: `${overdue} overdue` },
          { icon: 'fa-circle-exclamation', label: `${critFindings} critical findings` },
          { icon: 'fa-chart-pie', label: '92% completion rate' },
        ]}
      />

      <MetricRow pageKey="hse.inspections" cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))} />

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />

          {active === 'schedule' && (
            <ScheduleTab inspections={inspections} onNew={() => setModal(true)} />
          )}
          {active === 'findings' && <FindingsTab findings={findings} />}
        </div>

        <div class="hse-right-col">
          <div class="oq-dark-card">
            <div class="oq-dark-header">
              <i class="fas fa-circle-exclamation" />
              <span>Critical Findings</span>
              <span class="oq-dark-count">{critFindings}</span>
            </div>
            <div class="oq-dark-vertical">
              {findings.filter(f => f.severity === 'danger' && /open/i.test(f.status)).slice(0, 5).map(f => (
                <div class="oq-dark-item" key={f.ref}>
                  <div class="icon-badge red"><i class="fas fa-circle-exclamation" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{f.ref}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{f.finding?.slice(0, 50)}</div>
                  </div>
                  <span class="oq-dark-tag danger">Critical</span>
                </div>
              ))}
              {critFindings === 0 && <div style={{ padding: '16px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>No critical findings</div>}
            </div>
            <div class="oq-dark-header" style={{ marginTop: '12px' }}>
              <i class="fas fa-calendar-clock" />
              <span>Overdue Inspections</span>
              <span class="oq-dark-count">{overdue}</span>
            </div>
            <div class="oq-dark-vertical">
              {inspections.filter(i => /overdue/i.test(i.status)).slice(0, 4).map(i => (
                <div class="oq-dark-item" key={i.ref}>
                  <div class="icon-badge amber"><i class="fas fa-clock" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{i.ref} — {i.type}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{i.site}</div>
                  </div>
                  <span class="oq-dark-tag warning">Overdue</span>
                </div>
              ))}
              {overdue === 0 && <div style={{ padding: '12px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>Schedule on track</div>}
            </div>
          </div>
        </div>
      </div>

      <HseModal
        open={modalOpen} onClose={() => setModal(false)}
        title="Schedule Inspection" sub="Schedule a new inspection or audit for any site."
        submitLabel="Schedule"
        onSubmit={() => {
          const ref = `INSP-${200 + inspections.length + 1}`;
          setInspections([{ ref, title: newTitle || `${newType} inspection`, type: newType, site: newSite, due: 'TBD', status: 'Scheduled', assignee: 'Unassigned' }, ...inspections]);
          setModal(false); setNewTitle('');
        }}
      >
        <div class="hse-form-grid">
          <Field label="Inspection type"><SelectInput value={newType} onInput={setNewType} options={[...INSP_TYPES]} /></Field>
          <Field label="Site"><SelectInput value={newSite} onInput={setNewSite} options={[...HSE_SITES]} /></Field>
          <Field label="Title / description" wide><TextInput value={newTitle} onInput={setNewTitle} placeholder="e.g. Monthly fire equipment check" /></Field>
        </div>
      </HseModal>
    </div>
  );
}
