/**
 * src/components/sections/HSE/Incidents.tsx
 *
 * Incidents area. Four in-page tabs:
 *   • Register       — KPI strip + table (left) + open-work sidebar (right)
 *   • Report         — Full intake form rendered directly on the page
 *   • Investigations — KPI strip + investigations table (left) + 5-Whys chain
 *                      detail panel (right, updates on row click)
 *   • CAPA           — KPI strip + CAPA table (left) + priority / overdue panel
 *
 * UI/mock only — actions mutate local state and submit real workflows.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, HseModal, Field,
  TextInput, SelectInput, TextareaInput,
  type AreaTab,
} from './_shared';
import { mockTrend } from './types';
import {
  mockIncidents, mockInvestigations, mockCapa, hsePill, HSE_SITES,
  type IncidentRecord, type Investigation, type CapaItem, type IncidentType,
} from './types';
import { useWorkflow } from '@lib/workflow';

const TABS: AreaTab[] = [
  { key: 'register',       label: 'Register',        icon: 'fa-clipboard-list' },
  { key: 'report',         label: 'Report Incident',  icon: 'fa-circle-plus' },
  { key: 'investigations', label: 'Investigations',   icon: 'fa-magnifying-glass-chart' },
  { key: 'capa',           label: 'CAPA / Actions',   icon: 'fa-list-check' },
];

const INCIDENT_TYPES: IncidentType[] = ['Injury', 'Near Miss', 'Environmental', 'Property Damage', 'Unsafe Act', 'Unsafe Condition'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

export function IncidentsArea({ tab }: { tab: string }): VNode {
  const wf = useWorkflow();
  const [active, setActive]             = useState(tab);
  const [incidents, setIncidents]       = useState<IncidentRecord[]>(mockIncidents);
  const [openIncident, setOpenIncident] = useState<IncidentRecord | null>(null);
  const [reportOpen, setReportOpen]     = useState(false);

  const openCount    = incidents.filter(i => !/closed/i.test(i.status)).length;
  const critCount    = incidents.filter(i => i.severity === 'danger').length;
  const openCapa     = mockCapa.filter(c => !/closed/i.test(c.status)).length;

  const stats = [
    { icon: 'fa-clipboard-list',       label: 'Total Incidents',  value: incidents.length, color: 'blue'  },
    { icon: 'fa-folder-open',          label: 'Open',             value: openCount,        color: 'gold'  },
    { icon: 'fa-triangle-exclamation', label: 'Critical / High',  value: critCount,        color: 'red'   },
    { icon: 'fa-list-check',           label: 'Open CAPA',        value: openCapa,         color: 'green' },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-triangle-exclamation"
        areaIcon="fa-shield-exclamation"
        title="Incidents"
        crumb="Incidents"
        context={['Trinidad & Tobago Operations', '2026 HSE Programme']}
        stats={stats}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'register' && (
        <RegisterTab
          incidents={incidents}
          onOpen={setOpenIncident}
          onReport={() => { setActive('report'); }}
        />
      )}
      {active === 'report' && (
        <ReportTab
          onSubmit={(rec) => {
            setIncidents([rec, ...incidents]);
            wf.submit({ templateId: 'incident-investigation', recordRef: rec.ref, reason: rec.description, priority: rec.severity === 'danger' ? 'critical' : 'high' });
            setActive('register');
          }}
        />
      )}
      {active === 'investigations' && <InvestigationsTab />}
      {active === 'capa' && <CapaTab />}

      <IncidentDrawer
        incident={openIncident}
        onClose={() => setOpenIncident(null)}
        onInvestigate={() => {
          if (!openIncident) return;
          wf.submit({ templateId: 'incident-investigation', recordRef: openIncident.ref, reason: openIncident.description });
          setOpenIncident(null); setActive('investigations');
        }}
      />

      {/* Quick-report modal (also reachable from the Register tab's Report button) */}
      <ReportModal
        open={reportOpen} onClose={() => setReportOpen(false)}
        onSubmit={(rec) => {
          setIncidents([rec, ...incidents]);
          wf.submit({ templateId: 'incident-investigation', recordRef: rec.ref, reason: rec.description, priority: rec.severity === 'danger' ? 'critical' : 'high' });
          setReportOpen(false); setActive('register');
        }}
      />
    </div>
  );
}

// ── Register tab ──────────────────────────────────────────────────────────────

function RegisterTab({ incidents, onOpen, onReport }: {
  incidents: IncidentRecord[]; onOpen: (i: IncidentRecord) => void; onReport: () => void;
}): VNode {
  const open     = incidents.filter(i => !/closed/i.test(i.status));
  const critical = incidents.filter(i => i.severity === 'danger');

  return (
    <div class="ppe-tab-content">
      <TrendSparkline />
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-clipboard-list" /></span>
            <div>
              <div class="vt-section-title">Incident Register</div>
              <div class="vt-section-sub">Click any row to open the incident detail and investigation workflow.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search incidents…" />
            </div>
            <select class="emp-filter-select">
              <option>All types</option>
              {['Injury','Near Miss','Environmental','Property Damage','Unsafe Act','Unsafe Condition'].map(t => <option key={t}>{t}</option>)}
            </select>
            <select class="emp-filter-select">
              <option>All sites</option>
              {HSE_SITES.map(s => <option key={s}>{s}</option>)}
            </select>
            <button class="hse-btn primary" onClick={onReport}><i class="fas fa-circle-plus" /> Report Incident</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr>
                    <th>Record</th><th>Type</th><th>Site</th>
                    <th>Description</th><th>Status</th><th>Reporter</th>
                  </tr>
                </thead>
                <tbody>
                  {incidents.map(i => (
                    <tr key={i.ref} onClick={() => onOpen(i)} style={{ cursor: 'pointer' }}>
                      <td>
                        <span class="vt-cell-mono">{i.ref}</span>
                        <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginTop: '2px' }}>{i.date}</div>
                      </td>
                      <td>{i.type}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{i.site}</td>
                      <td style={{ maxWidth: '300px' }}>
                        <span class="vt-cell-name" style={{ fontWeight: 500 }}>{i.description}</span>
                      </td>
                      <td><span class={hsePill(i.status)}>{i.status}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{i.reporter}</td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right sidebar — open-work queue */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-exclamation-circle" /> Open Work Queue</h4>
          <div class="ppe-signals-list">
            {open.slice(0, 4).map(i => (
              <div class="ppe-signal" key={i.ref} onClick={() => onOpen(i)} style={{ cursor: 'pointer' }}>
                <i class={`fas ${i.severity === 'danger' ? 'fa-triangle-exclamation' : 'fa-circle-dot'} ${i.severity === 'danger' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{i.ref}</strong>
                  <span>{i.type} · {i.site}</span>
                </div>
                <span class={`ppe-signal-tag ${i.severity === 'danger' ? 'is-high' : 'is-due'}`}>
                  {i.status}
                </span>
              </div>
            ))}
            {open.length === 0 && (
              <div class="ppe-signal">
                <i class="fas fa-check-circle is-ok" />
                <div class="ppe-signal-text"><strong>All clear</strong><span>No open incidents.</span></div>
              </div>
            )}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,.14)', marginTop: '12px', paddingTop: '12px' }}>
            <h4 style={{ marginBottom: '8px' }}><i class="fas fa-list-check" /> CAPA Snapshot</h4>
            <div class="ppe-signals-list">
              {mockCapa.slice(0, 3).map(c => (
                <div class="ppe-signal" key={c.ref}>
                  <i class={`fas ${/overdue/i.test(c.status) ? 'fa-clock is-danger' : 'fa-circle-check is-info'}`} />
                  <div class="ppe-signal-text">
                    <strong>{c.title}</strong>
                    <span>Owner: {c.owner} · Due {c.due}</span>
                  </div>
                  <span class={`ppe-signal-tag ${/overdue/i.test(c.status) ? 'is-high' : 'is-due'}`}>
                    {c.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Report tab (full inline form) ─────────────────────────────────────────────

function ReportTab({ onSubmit }: {
  onSubmit: (rec: IncidentRecord) => void;
}): VNode {
  const [type, setType]             = useState<IncidentType>('Near Miss');
  const [severity, setSeverity]     = useState<string>('Medium');
  const [site, setSite]             = useState<string>(HSE_SITES[0]);
  const [description, setDesc]      = useState('');
  const [actions, setActions]       = useState('');

  function submit() {
    const sev = severity === 'Critical' || severity === 'High' ? 'danger' : severity === 'Medium' ? 'warning' : 'success';
    const ref = `INC-2026-${Math.floor(100 + Math.random() * 800)}`;
    onSubmit({
      ref,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      type, severity: sev as IncidentRecord['severity'], site, status: 'Open',
      reporter: 'S. Chen',
      description: description || 'Incident reported.',
      immediateActions: actions || '—',
    });
    setDesc(''); setActions('');
  }

  return (
    <div class="ppe-tab-content">
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '18px' }}>
            <span class="vt-section-icon"><i class="fas fa-circle-plus" /></span>
            <div>
              <div class="vt-section-title">Report an Incident</div>
              <div class="vt-section-sub">Submitting this form creates an incident record and opens an investigation workflow routed to the HSE Manager.</div>
            </div>
          </div>

          <div class="hse-intake-card">
            <div class="hse-form-grid">
              <Field label="Incident type">
                <SelectInput value={type} onInput={v => setType(v as IncidentType)} options={INCIDENT_TYPES} />
              </Field>
              <Field label="Severity">
                <SelectInput value={severity} onInput={setSeverity} options={[...SEVERITIES]} />
              </Field>
              <Field label="Site / Location">
                <SelectInput value={site} onInput={setSite} options={[...HSE_SITES]} />
              </Field>
              <Field label="Reported by">
                <TextInput value="S. Chen" onInput={() => {}} />
              </Field>
              <Field label="What happened?" wide>
                <TextareaInput
                  value={description} onInput={setDesc}
                  placeholder="Describe the event — location, people involved, sequence of events, environmental conditions…"
                />
              </Field>
              <Field label="Immediate actions taken" wide>
                <TextareaInput
                  value={actions} onInput={setActions}
                  placeholder="Containment measures, first aid given, isolation, notifications made, work stopped…"
                />
              </Field>
            </div>
            <div class="hse-intake-foot">
              <button class="hse-btn primary" onClick={submit}>
                <i class="fas fa-paper-plane" /> Submit &amp; Route to Investigation
              </button>
            </div>
          </div>
        </div>

        {/* Analytics + guide sidebar */}
        <aside class="ppe-signals-panel">
          {/* Type breakdown chart */}
          <h4><i class="fas fa-chart-bar" /> Incidents by Type · YTD</h4>
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { label: 'Near Miss',        count: 9, color: '#f59e0b' },
              { label: 'Unsafe Condition', count: 6, color: '#60a5fa' },
              { label: 'Injury',           count: 4, color: '#ef4444' },
              { label: 'Unsafe Act',       count: 3, color: '#a78bfa' },
              { label: 'Environmental',    count: 2, color: '#34d399' },
              { label: 'Property Damage',  count: 1, color: '#94a3b8' },
            ].map(b => {
              const pct = Math.round((b.count / 25) * 100);
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

          {/* What happens next */}
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-diagram-project" /> What happens next</h4>
          <div class="ppe-signals-list">
            {[
              { icon: 'fa-file-circle-check', label: 'Incident record created',   note: 'Auto-assigned reference number' },
              { icon: 'fa-route',             label: 'Routed to HSE Manager',     note: 'Appears in their approval inbox' },
              { icon: 'fa-magnifying-glass',  label: 'Investigation opened',      note: '5-Whys or RCA process begins' },
              { icon: 'fa-list-check',        label: 'CAPA raised on approval',   note: 'Corrective actions tracked to closure' },
            ].map(s => (
              <div class="ppe-signal" key={s.label}>
                <i class={`fas ${s.icon} is-info`} />
                <div class="ppe-signal-text"><strong>{s.label}</strong><span>{s.note}</span></div>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Investigations tab ────────────────────────────────────────────────────────

function InvestigationsTab(): VNode {
  const [selected, setSelected] = useState<Investigation | null>(null);

  return (
    <div class="ppe-tab-content">
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-magnifying-glass-chart" /></span>
            <div>
              <div class="vt-section-title">Investigations</div>
              <div class="vt-section-sub">Root-cause analyses linked to open incidents. Click a row to view the 5-Whys chain.</div>
            </div>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr>
                    <th>Ref</th><th>Incident</th><th>Method</th>
                    <th>Lead</th><th>Whys</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mockInvestigations.map(inv => (
                    <tr
                      key={inv.ref}
                      onClick={() => setSelected(inv)}
                      style={{ cursor: 'pointer' }}
                      class={selected?.ref === inv.ref ? 'selected' : ''}
                    >
                      <td><span class="vt-cell-mono">{inv.ref}</span></td>
                      <td><span class="vt-cell-mono">{inv.incidentRef}</span></td>
                      <td>{inv.method}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{inv.lead}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{inv.whys.length} steps</td>
                      <td><span class={hsePill(inv.status)}>{inv.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Analytics + 5-Whys panel */}
        <aside class="ppe-signals-panel">
          {/* Status breakdown */}
          <h4><i class="fas fa-chart-pie" /> Investigation Status</h4>
          <div style={{ display: 'grid', gap: '7px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { label: 'In Progress', color: '#60a5fa', count: mockInvestigations.filter(i => /progress/i.test(i.status)).length },
              { label: 'Open',        color: '#f59e0b', count: mockInvestigations.filter(i => /open/i.test(i.status)).length },
              { label: 'Closed',      color: '#4ade80', count: mockInvestigations.filter(i => /closed/i.test(i.status)).length },
            ].map(b => {
              const pct = Math.round((b.count / Math.max(mockInvestigations.length, 1)) * 100);
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
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginBottom: '14px' }}>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#fff', lineHeight: 1 }}>14d</div>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,.5)', marginTop: '3px' }}>Avg. time to close</div>
            </div>
            <div style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', textAlign: 'center' }}>
              <div style={{ fontSize: '1.4rem', fontWeight: 700, color: '#4ade80', lineHeight: 1 }}>82%</div>
              <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,.5)', marginTop: '3px' }}>Root cause found</div>
            </div>
          </div>
          <div class="hse-panel-divider" />

          {selected ? (
            <>
              <h4><i class="fas fa-list-ol" /> {selected.ref} · {selected.method}</h4>
              <div style={{ marginBottom: '10px' }}>
                <span class={hsePill(selected.status)} style={{ marginRight: '8px' }}>{selected.status}</span>
                <span style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,.6)' }}>Lead: {selected.lead}</span>
              </div>
              <div class="ppe-signals-list">
                {selected.whys.map((w, i) => (
                  <div class="ppe-signal" key={i}>
                    <i class="fas fa-circle-arrow-right" style={{ color: '#60a5fa' }} />
                    <div class="ppe-signal-text">
                      <strong>Why {i + 1}</strong>
                      <span>{w}</span>
                    </div>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,.14)', marginTop: '12px', paddingTop: '12px' }}>
                <h4 style={{ marginBottom: '8px' }}><i class="fas fa-bullseye" /> Root Cause</h4>
                <p style={{ fontSize: '0.78rem', color: 'rgba(255,255,255,.8)', lineHeight: 1.5 }}>
                  {selected.rootCause}
                </p>
              </div>
            </>
          ) : (
            <>
              <h4><i class="fas fa-list-ol" /> Why Chain</h4>
              <div class="ppe-signal" style={{ opacity: 0.5 }}>
                <i class="fas fa-arrow-pointer is-info" />
                <div class="ppe-signal-text">
                  <strong>Select a row</strong>
                  <span>Click any investigation to view the 5-Whys chain and root cause here.</span>
                </div>
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── CAPA tab ──────────────────────────────────────────────────────────────────

function CapaTab(): VNode {
  const overdue = mockCapa.filter(c => /overdue/i.test(c.status));
  const open    = mockCapa.filter(c => !/closed/i.test(c.status));

  return (
    <div class="ppe-tab-content">
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-list-check" /></span>
            <div>
              <div class="vt-section-title">Corrective &amp; Preventive Actions</div>
              <div class="vt-section-sub">CAPA items raised from incidents, inspections, and audits.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search actions…" />
            </div>
            <select class="emp-filter-select"><option>All statuses</option></select>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> New Action</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr>
                    <th>Ref</th><th>Title</th><th>Source</th>
                    <th>Priority</th><th>Owner</th><th>Due</th><th>Status</th>
                  </tr>
                </thead>
                <tbody>
                  {mockCapa.map((c: CapaItem) => (
                    <tr key={c.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{c.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{c.title}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.source}</td>
                      <td>
                        <span class={`vt-pill ${c.priority === 'danger' ? 'is-off' : c.priority === 'warning' ? 'is-warn' : 'is-info'}`}>
                          {c.priority === 'danger' ? 'Critical' : c.priority === 'warning' ? 'High' : 'Medium'}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.owner}</td>
                      <td>
                        <span style={{ color: /overdue/i.test(c.status) ? 'var(--siomac-red)' : 'inherit', fontWeight: /overdue/i.test(c.status) ? 600 : 400 }}>
                          {c.due}
                        </span>
                      </td>
                      <td><span class={hsePill(c.status)}>{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Right sidebar */}
        <aside class="ppe-signals-panel">
          {/* Summary KPIs */}
          <h4><i class="fas fa-gauge-high" /> CAPA Summary</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { val: open.length,    label: 'Open actions',    color: '#f59e0b' },
              { val: overdue.length, label: 'Overdue',         color: '#ef4444' },
              { val: mockCapa.filter(c => /closed/i.test(c.status)).length, label: 'Closed', color: '#4ade80' },
              { val: mockCapa.filter(c => c.priority === 'danger').length,  label: 'Critical priority', color: '#ef4444' },
            ].map(k => (
              <div key={k.label} style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.val}</div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,.5)', marginTop: '3px' }}>{k.label}</div>
              </div>
            ))}
          </div>

          {/* Priority breakdown bars */}
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-chart-bar" /> By Priority</h4>
          <div style={{ display: 'grid', gap: '8px', marginBottom: '14px' }}>
            {(['danger', 'warning', 'info', 'success'] as const).map(p => {
              const label = p === 'danger' ? 'Critical' : p === 'warning' ? 'High' : p === 'info' ? 'Medium' : 'Low';
              const count = mockCapa.filter(c => c.priority === p).length;
              const pct   = Math.round((count / Math.max(mockCapa.length, 1)) * 100);
              const color = p === 'danger' ? '#ef4444' : p === 'warning' ? '#f59e0b' : p === 'info' ? '#60a5fa' : '#4ade80';
              return (
                <div key={p}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.69rem', color: 'rgba(255,255,255,.7)', marginBottom: '4px' }}>
                    <span>{label}</span><span style={{ color }}>{count}</span>
                  </div>
                  <div style={{ height: '5px', borderRadius: '999px', background: 'rgba(255,255,255,.12)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '999px', background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
          <div class="hse-panel-divider" />

          {/* Overdue queue */}
          {overdue.length > 0 && (
            <>
              <h4 style={{ marginBottom: '8px' }}><i class="fas fa-clock" /> Overdue Actions</h4>
              <div class="ppe-signals-list">
                {overdue.map(c => (
                  <div class="ppe-signal" key={c.ref}>
                    <i class="fas fa-triangle-exclamation is-danger" />
                    <div class="ppe-signal-text">
                      <strong>{c.title}</strong>
                      <span>{c.owner} · Due {c.due}</span>
                    </div>
                    <span class="ppe-signal-tag is-high">Overdue</span>
                  </div>
                ))}
              </div>
            </>
          )}
        </aside>
      </div>
    </div>
  );
}

// ── Incident detail drawer ────────────────────────────────────────────────────

const SEVERITY_META: Record<string, { label: string; icon: string; color: string; bg: string }> = {
  danger:  { label: 'Critical', icon: 'fa-triangle-exclamation', color: '#ef4444', bg: 'rgba(239,68,68,.15)' },
  warning: { label: 'High',     icon: 'fa-circle-exclamation',   color: '#f59e0b', bg: 'rgba(245,158,11,.15)' },
  info:    { label: 'Medium',   icon: 'fa-circle-info',           color: '#3b82f6', bg: 'rgba(59,130,246,.15)' },
  success: { label: 'Low',      icon: 'fa-circle-check',          color: '#22c55e', bg: 'rgba(34,197,94,.15)' },
};

const TYPE_ICONS: Record<string, string> = {
  'Injury':           'fa-person-falling',
  'Near Miss':        'fa-eye',
  'Environmental':    'fa-droplet',
  'Property Damage':  'fa-building-circle-exclamation',
  'Unsafe Act':       'fa-user-slash',
  'Unsafe Condition': 'fa-triangle-exclamation',
};

// Per-incident static detail overlays (simulate structured data a real API would return)
const INCIDENT_DETAIL: Record<string, {
  location: string; peopleInvolved: string; oshClass: string;
  keyFactors: string[]; actionsTaken: Array<{ label: string; by: string; time: string }>;
  escalatedTo: string; responseTime: string;
}> = {
  default: {
    location: 'Site perimeter / Field area', peopleInvolved: '2 workers + 1 supervisor',
    oshClass: 'OSH Act S.19 — Notification Required',
    keyFactors: ['Inadequate pre-task risk assessment', 'Missing permits', 'No gas test performed', 'Rescue plan absent'],
    actionsTaken: [
      { label: 'Work stopped immediately and area isolated', by: 'Supervisor on site', time: '09:15' },
      { label: 'Permit suspended and HSE Manager notified', by: 'J. Mohammed', time: '09:18' },
      { label: 'Personnel accounted for and made safe', by: 'Safety Officer', time: '09:22' },
      { label: 'Incident entered into HSE register', by: 'HSE Clerk', time: '09:45' },
    ],
    escalatedTo: 'HSE Manager · Site OIM', responseTime: '< 30 min',
  },
};

function IncidentDrawer({ incident: i, onClose, onInvestigate }: {
  incident: IncidentRecord | null; onClose: () => void; onInvestigate: () => void;
}): VNode {
  const open = !!i;
  const sev  = i ? (SEVERITY_META[i.severity] ?? SEVERITY_META.info) : SEVERITY_META.info;

  const isInvestigating = /investigation/i.test(i?.status ?? '');
  const isClosed        = /closed/i.test(i?.status ?? '');
  const isCapaRaised    = /capa|action/i.test(i?.status ?? '') || isClosed;

  const steps: Array<{ icon: string; label: string; sub: string; done: boolean; active: boolean }> = [
    { icon: 'fa-file-circle-check', label: 'Incident recorded',     sub: `Reported by ${i?.reporter ?? '—'} · ${i?.date ?? ''}`, done: true,             active: false },
    { icon: 'fa-route',             label: 'Routed to HSE Manager', sub: 'Auto-routed · SLA 24 hrs',                               done: true,             active: false },
    { icon: 'fa-magnifying-glass',  label: 'Investigation opened',  sub: 'Root cause analysis · 5-Whys method',                    done: isInvestigating,  active: !isInvestigating && !isClosed },
    { icon: 'fa-list-check',        label: 'CAPA raised',           sub: 'Corrective & preventive actions assigned',               done: isCapaRaised,     active: isInvestigating && !isCapaRaised },
    { icon: 'fa-circle-check',      label: 'Closed out',            sub: 'Verified by HSE Manager · Audit trail locked',           done: isClosed,         active: isCapaRaised && !isClosed },
  ];

  return (
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer hse-drawer--rich${open ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>

        {/* ── Dark navy hero ── */}
        <div class="hse-idrawer-hero">
          <div class="hse-idrawer-hero-left">
            <div class="hse-idrawer-type-chip" style={{ background: sev.bg }}>
              <i class={`fas ${i ? (TYPE_ICONS[i.type] ?? 'fa-file-exclamation') : 'fa-file'}`} style={{ color: sev.color }} />
            </div>
            <div>
              <div class="hse-idrawer-ref">{i?.ref ?? '—'}</div>
              <div class="hse-idrawer-type">{i?.type ?? '—'}</div>
              <div class="hse-idrawer-site"><i class="fas fa-location-dot" /> {i?.site ?? '—'}</div>
            </div>
          </div>
          <div class="hse-idrawer-hero-right">
            <div class="hse-idrawer-sev-badge" style={{ background: sev.bg, color: sev.color }}>
              <i class={`fas ${sev.icon}`} /> {sev.label}
            </div>
            <button class="hse-idrawer-close" onClick={onClose} aria-label="Close">
              <i class="fas fa-xmark" />
            </button>
          </div>
        </div>

        {/* ── Scrollable body ── */}
        <div class="hse-drawer-body">

          {/* 6-cell info grid */}
          <div class="hse-idrawer-grid">
            <div class="hse-idrawer-cell">
              <i class="fas fa-circle-dot" />
              <span>Status</span>
              <strong><span class={hsePill(i?.status ?? '')}>{i?.status ?? '—'}</span></strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-calendar-day" />
              <span>Date</span>
              <strong>{i?.date ?? '—'}</strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-user-tie" />
              <span>Reporter</span>
              <strong>{i?.reporter ?? '—'}</strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-map-pin" />
              <span>Site</span>
              <strong>{i?.site ?? '—'}</strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-users" />
              <span>People involved</span>
              <strong>2 workers · 1 supervisor</strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-stopwatch" />
              <span>Response time</span>
              <strong>&lt; 30 min</strong>
            </div>
          </div>

          {/* What happened */}
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-align-left" /> What happened</div>
            <p class="hse-idrawer-body-text">{i?.description ?? '—'}</p>
            {i?.immediateActions && i.immediateActions !== '—' && (
              <div class="hse-idrawer-action-note">
                <i class="fas fa-bolt" /> <strong>Immediate action:</strong> {i.immediateActions}
              </div>
            )}
          </div>

          {/* Investigation workflow timeline */}
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-diagram-project" /> Investigation workflow</div>
            <div class="hse-idrawer-timeline">
              {steps.map((step, idx) => (
                <div class={`hse-idrawer-step${step.done ? ' done' : step.active ? ' active' : ''}`} key={idx}>
                  <div class="hse-idrawer-step-dot">
                    <i class={`fas ${step.done ? 'fa-check' : step.icon}`} />
                  </div>
                  <div class="hse-idrawer-step-body">
                    <strong>{step.label}</strong>
                    <em>{step.sub}</em>
                  </div>
                </div>
              ))}
            </div>
          </div>

        </div>

        {/* ── Footer ── */}
        <div class="hse-drawer-foot">
          <button class="hse-btn" onClick={onClose}>Close</button>
          <button class="hse-btn primary" onClick={onInvestigate}>
            <i class="fas fa-magnifying-glass-chart" /> Open Investigation
          </button>
        </div>
      </aside>
    </>
  );
}

// ── Trend dashboard strip (Register tab) ─────────────────────────────────────

function TrendSparkline(): VNode {
  const pts  = mockTrend;
  const last = pts[pts.length - 1];
  const prev = pts[pts.length - 2];
  const W = 160, H = 36;

  function xi(i: number) { return (i / (pts.length - 1)) * W; }
  function yi(v: number, max: number) { return H - 4 - ((v / max) * (H - 8)); }

  function linePath(vals: number[]): string {
    const max = Math.max(...vals, 1);
    return vals.map((v, i) => `${i === 0 ? 'M' : 'L'}${xi(i).toFixed(1)},${yi(v, max).toFixed(1)}`).join(' ');
  }
  function areaPath(vals: number[]): string {
    const max = Math.max(...vals, 1);
    const line = vals.map((v, i) => `${xi(i).toFixed(1)},${yi(v, max).toFixed(1)}`).join(' ');
    return `M0,${H} L${line} L${W},${H} Z`;
  }

  const iDelta = last.incidents - prev.incidents;
  const nDelta = last.nearMisses - prev.nearMisses;
  const cDelta = last.capaClosure - prev.capaClosure;
  const iVals  = pts.map(p => p.incidents);
  const nVals  = pts.map(p => p.nearMisses);
  const months = pts.map(p => p.month);
  const ytdInc = pts.reduce((s, p) => s + p.incidents, 0);

  return (
    <div class="hse-spark-row">
      {/* Incidents this month */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Incidents MTD</span>
          <span class={`hse-spark-delta ${iDelta < 0 ? 'down' : iDelta > 0 ? 'up' : 'flat'}`}>
            <i class={`fas ${iDelta < 0 ? 'fa-arrow-down' : iDelta > 0 ? 'fa-arrow-up' : 'fa-minus'}`} />
            {Math.abs(iDelta)}
          </span>
        </div>
        <div class="hse-spark-val">{last.incidents}</div>
        <div class="hse-spark-sub">YTD total: {ytdInc} · Target ≤3/mo</div>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <path d={areaPath(iVals)} fill="rgba(239,68,68,.08)" />
          <path d={linePath(iVals)} fill="none" stroke="#ef4444" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx={xi(pts.length - 1)} cy={yi(last.incidents, Math.max(...iVals))} r="3.5" fill="#ef4444" stroke="#fff" stroke-width="1.5" />
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* Near misses */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Near Misses MTD</span>
          <span class={`hse-spark-delta ${nDelta > 0 ? 'up' : nDelta < 0 ? 'down' : 'flat'}`}>
            <i class={`fas ${nDelta > 0 ? 'fa-arrow-up' : nDelta < 0 ? 'fa-arrow-down' : 'fa-minus'}`} />
            {Math.abs(nDelta)}
          </span>
        </div>
        <div class="hse-spark-val">{last.nearMisses}</div>
        <div class="hse-spark-sub">Near misses should exceed incidents — leading indicator</div>
        <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H}>
          <path d={areaPath(nVals)} fill="rgba(245,158,11,.08)" />
          <path d={linePath(nVals)} fill="none" stroke="#f59e0b" stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
          <circle cx={xi(pts.length - 1)} cy={yi(last.nearMisses, Math.max(...nVals))} r="3.5" fill="#f59e0b" stroke="#fff" stroke-width="1.5" />
        </svg>
        <div class="hse-spark-months">{months.map(m => <span key={m}>{m}</span>)}</div>
      </div>

      {/* CAPA closure rate */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">CAPA Closure</span>
          <span class={`hse-spark-delta ${cDelta >= 0 ? 'down' : 'up'}`}>
            <i class={`fas ${cDelta >= 0 ? 'fa-arrow-up' : 'fa-arrow-down'}`} />
            {Math.abs(cDelta)}%
          </span>
        </div>
        <div class="hse-spark-val" style={{ color: last.capaClosure >= 90 ? '#16a34a' : '#d97706' }}>
          {last.capaClosure}%
        </div>
        <div class="hse-spark-sub">Target 95% · {last.capaClosure >= 95 ? 'On target' : `${95 - last.capaClosure}% below target`}</div>
        <div class="hse-spark-bar-track" style={{ marginTop: '10px' }}>
          <div class="hse-spark-bar-fill" style={{ width: `${last.capaClosure}%`, background: last.capaClosure >= 90 ? '#16a34a' : '#d97706' }} />
        </div>
        <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.6rem', color: 'var(--text-muted)', marginTop: '4px' }}>
          <span>0%</span><span style={{ color: '#d97706' }}>Target 95%</span><span>100%</span>
        </div>
      </div>

      {/* Severity breakdown */}
      <div class="hse-spark">
        <div class="hse-spark-header">
          <span class="hse-spark-label">Severity Mix · YTD</span>
        </div>
        <div style={{ display: 'grid', gap: '5px', marginTop: '4px' }}>
          {[
            { label: 'Critical / High', count: 3, color: '#ef4444', pct: 43 },
            { label: 'Medium',          count: 2, color: '#f59e0b', pct: 29 },
            { label: 'Low',             count: 2, color: '#22c55e', pct: 28 },
          ].map(b => (
            <div key={b.label}>
              <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.64rem', color: 'var(--text-muted)', marginBottom: '3px' }}>
                <span>{b.label}</span><span style={{ fontWeight: 600, color: b.color }}>{b.count}</span>
              </div>
              <div class="hse-spark-bar-track">
                <div class="hse-spark-bar-fill" style={{ width: `${b.pct}%`, background: b.color }} />
              </div>
            </div>
          ))}
        </div>
        <div class="hse-spark-sub" style={{ marginTop: '6px' }}>YTD: {ytdInc} total incidents across all sites</div>
      </div>
    </div>
  );
}

// ── Quick-report modal (accessible from Register tab's CTA button) ─────────────

function ReportModal({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (rec: IncidentRecord) => void;
}): VNode | null {
  const [type, setType]         = useState<IncidentType>('Near Miss');
  const [severity, setSeverity] = useState<string>('Medium');
  const [site, setSite]         = useState<string>(HSE_SITES[0]);
  const [description, setDesc]  = useState('');
  const [actions, setActions]   = useState('');

  function submit() {
    const sev = severity === 'Critical' || severity === 'High' ? 'danger' : severity === 'Medium' ? 'warning' : 'success';
    const ref = `INC-2026-${Math.floor(100 + Math.random() * 800)}`;
    onSubmit({
      ref,
      date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      type, severity: sev as IncidentRecord['severity'], site, status: 'Open',
      reporter: 'S. Chen', description: description || 'Incident reported.', immediateActions: actions || '—',
    });
    setDesc(''); setActions('');
  }

  return (
    <HseModal open={open} title="Report Incident" sub="Opens a governed investigation workflow on submit." onClose={onClose} onSubmit={submit} submitLabel="Submit & Route">
      <div class="hse-form-grid">
        <Field label="Incident type"><SelectInput value={type} onInput={v => setType(v as IncidentType)} options={INCIDENT_TYPES} /></Field>
        <Field label="Severity"><SelectInput value={severity} onInput={setSeverity} options={[...SEVERITIES]} /></Field>
        <Field label="Site"><SelectInput value={site} onInput={setSite} options={[...HSE_SITES]} /></Field>
        <Field label="Reported by"><TextInput value="S. Chen" onInput={() => {}} /></Field>
        <Field label="What happened?" wide><TextareaInput value={description} onInput={setDesc} placeholder="Describe the event, location and people involved…" /></Field>
        <Field label="Immediate actions taken" wide><TextareaInput value={actions} onInput={setActions} placeholder="Containment, first aid, isolation, notifications…" /></Field>
      </div>
    </HseModal>
  );
}
