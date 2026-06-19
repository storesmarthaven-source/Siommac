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

        {/* Guide sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-circle-info" /> Reporting Guide</h4>
          <div class="ppe-signals-list">
            {[
              { icon: 'fa-person-falling', label: 'Injury / First Aid',  note: 'All injuries — from first aid to lost-time cases' },
              { icon: 'fa-eye',            label: 'Near Miss',            note: 'Events that could have caused harm but did not' },
              { icon: 'fa-droplet',        label: 'Environmental',        note: 'Spills, discharges, emissions — notify EMA where required' },
              { icon: 'fa-helmet-safety',  label: 'Unsafe Act',           note: 'Observed deviation from safe work practice' },
              { icon: 'fa-construction',   label: 'Unsafe Condition',     note: 'Hazardous physical condition identified at site' },
            ].map(g => (
              <div class="ppe-signal" key={g.label}>
                <i class={`fas ${g.icon}`} />
                <div class="ppe-signal-text"><strong>{g.label}</strong><span>{g.note}</span></div>
              </div>
            ))}
          </div>
          <div style={{ borderTop: '1px solid rgba(255,255,255,.14)', marginTop: '12px', paddingTop: '12px' }}>
            <h4 style={{ marginBottom: '8px' }}><i class="fas fa-diagram-project" /> What happens next</h4>
            <div class="ppe-signals-list">
              {[
                { icon: 'fa-file-circle-check', label: 'Incident record created',   note: 'Auto-assigned reference number' },
                { icon: 'fa-route',             label: 'Routed to HSE Manager',     note: 'Appears in their approval inbox' },
                { icon: 'fa-magnifying-glass',  label: 'Investigation opened',      note: '5-Whys or RCA process begins' },
                { icon: 'fa-list-check',        label: 'CAPA raised on approval',   note: 'Corrective actions tracked to closure' },
              ].map(s => (
                <div class="ppe-signal" key={s.label}>
                  <i class={`fas ${s.icon}`} />
                  <div class="ppe-signal-text"><strong>{s.label}</strong><span>{s.note}</span></div>
                </div>
              ))}
            </div>
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

        {/* 5-Whys detail panel */}
        <aside class="ppe-signals-panel">
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
          {overdue.length > 0 && (
            <>
              <h4><i class="fas fa-triangle-exclamation" /> {overdue.length} Overdue</h4>
              <div class="ppe-signals-list" style={{ marginBottom: '14px' }}>
                {overdue.map(c => (
                  <div class="ppe-signal" key={c.ref}>
                    <i class="fas fa-clock is-danger" />
                    <div class="ppe-signal-text">
                      <strong>{c.title}</strong>
                      <span>{c.owner} · Due {c.due}</span>
                    </div>
                    <span class="ppe-signal-tag is-high">Overdue</span>
                  </div>
                ))}
              </div>
              <div style={{ borderTop: '1px solid rgba(255,255,255,.14)', paddingTop: '12px' }} />
            </>
          )}
          <h4><i class="fas fa-chart-bar" /> By Priority</h4>
          <div style={{ display: 'grid', gap: '10px', marginTop: '8px' }}>
            {(['danger', 'warning', 'info', 'success'] as const).map(p => {
              const label = p === 'danger' ? 'Critical' : p === 'warning' ? 'High' : p === 'info' ? 'Medium' : 'Low';
              const count = mockCapa.filter(c => c.priority === p).length;
              const pct   = Math.round((count / mockCapa.length) * 100);
              const color = p === 'danger' ? '#ef4444' : p === 'warning' ? '#f59e0b' : p === 'info' ? '#60a5fa' : '#4ade80';
              return (
                <div key={p}>
                  <div style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.74rem', color: 'rgba(255,255,255,.7)', marginBottom: '5px' }}>
                    <span>{label}</span><span>{count}</span>
                  </div>
                  <div style={{ height: '6px', borderRadius: '999px', background: 'rgba(255,255,255,.14)' }}>
                    <div style={{ width: `${pct}%`, height: '100%', borderRadius: '999px', background: color }} />
                  </div>
                </div>
              );
            })}
          </div>
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

function IncidentDrawer({ incident: i, onClose, onInvestigate }: {
  incident: IncidentRecord | null; onClose: () => void; onInvestigate: () => void;
}): VNode {
  const open = !!i;
  const sev  = i ? (SEVERITY_META[i.severity] ?? SEVERITY_META.info) : SEVERITY_META.info;

  return (
    <>
      <div class={`hse-drawer-backdrop${open ? ' show' : ''}`} onClick={onClose} />
      <aside class={`hse-drawer hse-drawer--rich${open ? ' show' : ''}`} role="dialog" aria-modal="true" aria-hidden={!open}>
        {/* ── Dark hero header ── */}
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

        {/* ── Body ── */}
        <div class="hse-drawer-body">
          {/* Info grid */}
          <div class="hse-idrawer-grid">
            <div class="hse-idrawer-cell">
              <i class="fas fa-circle-dot" />
              <span>Status</span>
              <strong><span class={hsePill(i?.status ?? '')}>{i?.status ?? '—'}</span></strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-calendar" />
              <span>Date</span>
              <strong>{i?.date ?? '—'}</strong>
            </div>
            <div class="hse-idrawer-cell">
              <i class="fas fa-user" />
              <span>Reporter</span>
              <strong>{i?.reporter ?? '—'}</strong>
            </div>
          </div>

          {/* Description */}
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-align-left" /> What happened</div>
            <p class="hse-idrawer-body-text">{i?.description ?? '—'}</p>
          </div>

          {/* Immediate actions */}
          <div class="hse-idrawer-section hse-idrawer-section--alert">
            <div class="hse-idrawer-section-head"><i class="fas fa-bolt" /> Immediate actions taken</div>
            <p class="hse-idrawer-body-text">{i?.immediateActions ?? '—'}</p>
          </div>

          {/* Workflow timeline */}
          <div class="hse-idrawer-section">
            <div class="hse-idrawer-section-head"><i class="fas fa-diagram-project" /> Investigation workflow</div>
            <div class="hse-idrawer-timeline">
              {[
                { icon: 'fa-file-circle-check', label: 'Incident recorded',       done: true },
                { icon: 'fa-route',             label: 'Routed to HSE Manager',   done: true },
                { icon: 'fa-magnifying-glass',  label: 'Investigation opened',    done: /investigation/i.test(i?.status ?? '') },
                { icon: 'fa-list-check',        label: 'CAPA raised',             done: false },
                { icon: 'fa-circle-check',      label: 'Closed out',              done: /closed/i.test(i?.status ?? '') },
              ].map((step, idx) => (
                <div class={`hse-idrawer-step${step.done ? ' done' : ''}`} key={idx}>
                  <div class="hse-idrawer-step-dot">
                    <i class={`fas ${step.done ? 'fa-check' : step.icon}`} />
                  </div>
                  <span>{step.label}</span>
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

// ── Mini trend sparkline (Register tab) ───────────────────────────────────────

function TrendSparkline(): VNode {
  const pts  = mockTrend;
  const maxI = Math.max(...pts.map(p => p.incidents));
  const maxN = Math.max(...pts.map(p => p.nearMisses));
  const W = 120, H = 32;
  const xi = (i: number) => (i / (pts.length - 1)) * W;
  const yi = (v: number, max: number) => H - (v / max) * H;
  const poly = (vals: number[], max: number) =>
    pts.map((_, i) => `${xi(i)},${yi(vals[i], max)}`).join(' ');

  return (
    <div class="hse-spark-row">
      {[
        { label: 'Incidents',   color: '#ef4444', vals: pts.map(p => p.incidents),   max: maxI },
        { label: 'Near Misses', color: '#f59e0b', vals: pts.map(p => p.nearMisses),  max: maxN },
      ].map(s => (
        <div class="hse-spark" key={s.label}>
          <div class="hse-spark-label">{s.label}</div>
          <svg viewBox={`0 0 ${W} ${H}`} width={W} height={H} style={{ display: 'block' }}>
            <polyline points={poly(s.vals, s.max)} fill="none" stroke={s.color} stroke-width="2" stroke-linecap="round" stroke-linejoin="round" />
            <circle cx={xi(pts.length - 1)} cy={yi(s.vals[pts.length - 1], s.max)} r="3" fill={s.color} />
          </svg>
          <div class="hse-spark-val" style={{ color: s.color }}>{s.vals[s.vals.length - 1]}</div>
        </div>
      ))}
      <div class="hse-spark">
        <div class="hse-spark-label">CAPA Closure</div>
        <div class="hse-spark-bar-track">
          <div class="hse-spark-bar-fill" style={{ width: `${pts[pts.length - 1].capaClosure}%` }} />
        </div>
        <div class="hse-spark-val" style={{ color: '#22c55e' }}>{pts[pts.length - 1].capaClosure}%</div>
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
