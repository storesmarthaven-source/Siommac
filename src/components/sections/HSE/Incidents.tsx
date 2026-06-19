/**
 * src/components/sections/HSE/Incidents.tsx
 *
 * Incidents area — the workflow showcase. In-page tabs:
 *   • Register       — incident table (click a row → detail drawer)
 *   • Report         — full report form (modal) → submits an Incident
 *                      Investigation workflow via the engine
 *   • Investigations — 5-Whys investigations (drawer with the why-chain)
 *   • CAPA           — corrective/preventive actions table
 *
 * UI/mock only: the report form adds to a local list AND submits a real
 * workflow (which on approval emits Finance + HR handoffs and an audit event).
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, HseModal, HseDrawer, Field, TextInput, SelectInput, TextareaInput,
  type AreaTab, type DrawerDetail,
} from './_shared';
import {
  mockIncidents, mockInvestigations, mockCapa, hsePill, HSE_SITES,
  type IncidentRecord, type Investigation, type CapaItem, type IncidentType,
} from './types';
import { useWorkflow } from '@lib/workflow';

const TABS: AreaTab[] = [
  { key: 'register',       label: 'Register',       icon: 'fa-clipboard-list' },
  { key: 'report',         label: 'Report Incident', icon: 'fa-circle-plus' },
  { key: 'investigations', label: 'Investigations',  icon: 'fa-magnifying-glass-chart' },
  { key: 'capa',           label: 'CAPA / Actions',  icon: 'fa-list-check' },
];

const INCIDENT_TYPES: IncidentType[] = ['Injury', 'Near Miss', 'Environmental', 'Property Damage', 'Unsafe Act', 'Unsafe Condition'];
const SEVERITIES = ['Critical', 'High', 'Medium', 'Low'] as const;

export function IncidentsArea({ tab }: { tab: string }): VNode {
  const wf = useWorkflow();
  const [active, setActive] = useState(tab);
  const [incidents, setIncidents] = useState<IncidentRecord[]>(mockIncidents);
  const [openIncident, setOpenIncident] = useState<IncidentRecord | null>(null);
  const [openInv, setOpenInv] = useState<Investigation | null>(null);
  const [reportOpen, setReportOpen] = useState(false);

  const openCount = incidents.filter(i => !/closed/i.test(i.status)).length;
  const criticalCount = incidents.filter(i => i.severity === 'danger').length;

  const stats = [
    { icon: 'fa-clipboard-list', label: 'Total Incidents', value: incidents.length, color: 'blue' },
    { icon: 'fa-folder-open', label: 'Open', value: openCount, color: 'gold' },
    { icon: 'fa-triangle-exclamation', label: 'Critical', value: criticalCount, color: 'red' },
    { icon: 'fa-list-check', label: 'Open CAPA', value: mockCapa.filter(c => !/closed/i.test(c.status)).length, color: 'green' },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-triangle-exclamation" title="Incidents" crumb="Incidents" stats={stats}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'register' && (
        <RegisterTab incidents={incidents} onOpen={setOpenIncident} onReport={() => setActive('report')} />
      )}
      {active === 'report' && (
        <ReportTab onOpenForm={() => setReportOpen(true)} />
      )}
      {active === 'investigations' && (
        <InvestigationsTab onOpen={setOpenInv} />
      )}
      {active === 'capa' && <CapaTab />}

      {/* Incident detail drawer */}
      <HseDrawer
        open={!!openIncident} onClose={() => setOpenIncident(null)}
        title={openIncident ? `${openIncident.ref} · ${openIncident.type}` : ''}
        sub={openIncident?.site}
        details={openIncident ? incidentDetails(openIncident) : []}
        foot={openIncident ? (
          <>
            <button class="hse-btn" onClick={() => setOpenIncident(null)}>Close</button>
            <button class="hse-btn primary" onClick={() => {
              wf.submit({ templateId: 'incident-investigation', recordRef: openIncident.ref, reason: openIncident.description });
              setOpenIncident(null); setActive('investigations');
            }}>Open Investigation</button>
          </>
        ) : undefined}
      >
        {openIncident && (
          <section class="wf-section">
            <div class="wf-section-title"><i class="fas fa-bolt" /> Immediate actions</div>
            <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{openIncident.immediateActions}</p>
          </section>
        )}
      </HseDrawer>

      {/* Investigation (5-Whys) drawer */}
      <HseDrawer
        open={!!openInv} onClose={() => setOpenInv(null)}
        title={openInv ? `${openInv.ref} · ${openInv.method}` : ''}
        sub={openInv ? `Incident ${openInv.incidentRef} · Lead ${openInv.lead}` : ''}
        details={openInv ? [
          { label: 'Status', value: <span class={hsePill(openInv.status)}>{openInv.status}</span> },
          { label: 'Method', value: openInv.method },
        ] : []}
      >
        {openInv && (
          <>
            <section class="wf-section">
              <div class="wf-section-title"><i class="fas fa-list-ol" /> Why chain</div>
              <div class="hse-whys">
                {openInv.whys.map((w, i) => (
                  <div class="hse-why" key={i}><b>{i + 1}</b><span>{w}</span></div>
                ))}
              </div>
            </section>
            <section class="wf-section">
              <div class="wf-section-title"><i class="fas fa-bullseye" /> Root cause</div>
              <p style={{ color: 'var(--text-muted)', fontSize: '0.8rem', lineHeight: 1.5 }}>{openInv.rootCause}</p>
            </section>
          </>
        )}
      </HseDrawer>

      {/* Report incident modal */}
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

function incidentDetails(i: IncidentRecord): DrawerDetail[] {
  return [
    { label: 'Status',   value: <span class={hsePill(i.status)}>{i.status}</span> },
    { label: 'Type',     value: i.type },
    { label: 'Date',     value: i.date },
    { label: 'Reporter', value: i.reporter },
    { label: 'Site',     value: i.site },
    { label: 'Severity', value: i.severity === 'danger' ? 'Critical' : i.severity === 'warning' ? 'Medium' : 'Low' },
  ];
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function RegisterTab({ incidents, onOpen, onReport }: {
  incidents: IncidentRecord[]; onOpen: (i: IncidentRecord) => void; onReport: () => void;
}): VNode {
  return (
    <>
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 240px' }}><i class="fas fa-search" /><input type="search" placeholder="Search incidents…" /></div>
        <button class="hse-btn primary" onClick={onReport}><i class="fas fa-circle-plus" /> Report Incident</button>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Record</th><th>Type</th><th>Site</th><th>Description</th><th>Status</th><th>Reporter</th></tr></thead>
            <tbody>
              {incidents.map(i => (
                <tr key={i.ref} onClick={() => onOpen(i)} style={{ cursor: 'pointer' }}>
                  <td><span class="vt-cell-mono">{i.ref}</span><div class="hse-muted">{i.date}</div></td>
                  <td>{i.type}</td>
                  <td>{i.site}</td>
                  <td style={{ maxWidth: '320px' }}><span class="vt-cell-name" style={{ fontWeight: 500 }}>{i.description}</span></td>
                  <td><span class={hsePill(i.status)}>{i.status}</span></td>
                  <td class="hse-muted">{i.reporter}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </>
  );
}

function ReportTab({ onOpenForm }: { onOpenForm: () => void }): VNode {
  return (
    <div class="vt-table-card" style={{ padding: '34px', textAlign: 'center' }}>
      <i class="fas fa-circle-plus" style={{ fontSize: '2rem', color: 'var(--siomac-navy)', display: 'block', marginBottom: '12px' }} />
      <strong style={{ color: 'var(--siomac-navy)', fontSize: '1rem' }}>Report a new incident</strong>
      <p style={{ color: 'var(--text-muted)', fontSize: '0.82rem', margin: '6px 0 16px' }}>
        Capture the event, classification and immediate actions. Submitting opens a governed investigation workflow.
      </p>
      <button class="hse-btn primary" onClick={onOpenForm}><i class="fas fa-pen-to-square" /> Open Report Form</button>
    </div>
  );
}

function InvestigationsTab({ onOpen }: { onOpen: (inv: Investigation) => void }): VNode {
  return (
    <div class="vt-table-card">
      <div class="vt-table-scroll">
        <table class="vt-table">
          <thead><tr><th>Investigation</th><th>Incident</th><th>Method</th><th>Lead</th><th>Status</th></tr></thead>
          <tbody>
            {mockInvestigations.map(inv => (
              <tr key={inv.ref} onClick={() => onOpen(inv)} style={{ cursor: 'pointer' }}>
                <td><span class="vt-cell-mono">{inv.ref}</span></td>
                <td>{inv.incidentRef}</td>
                <td>{inv.method}</td>
                <td class="hse-muted">{inv.lead}</td>
                <td><span class={hsePill(inv.status)}>{inv.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

function CapaTab(): VNode {
  return (
    <div class="vt-table-card">
      <div class="vt-table-scroll">
        <table class="vt-table">
          <thead><tr><th>Action</th><th>Title</th><th>Source</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
          <tbody>
            {mockCapa.map((c: CapaItem) => (
              <tr key={c.ref}>
                <td><span class="vt-cell-mono">{c.ref}</span></td>
                <td><span class="vt-cell-name">{c.title}</span></td>
                <td class="hse-muted">{c.source}</td>
                <td class="hse-muted">{c.owner}</td>
                <td>{c.due}</td>
                <td><span class={hsePill(c.status)}>{c.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table>
      </div>
    </div>
  );
}

// ── Report modal ────────────────────────────────────────────────────────────────

function ReportModal({ open, onClose, onSubmit }: {
  open: boolean; onClose: () => void; onSubmit: (rec: IncidentRecord) => void;
}): VNode | null {
  const [type, setType] = useState<IncidentType>('Near Miss');
  const [severity, setSeverity] = useState<string>('Medium');
  const [site, setSite] = useState<string>(HSE_SITES[0]);
  const [description, setDescription] = useState('');
  const [actions, setActions] = useState('');

  function submit() {
    const sev = severity === 'Critical' || severity === 'High' ? 'danger' : severity === 'Medium' ? 'warning' : 'success';
    const ref = `INC-2026-${Math.floor(100 + Math.random() * 800)}`;
    onSubmit({
      ref, date: new Date().toLocaleDateString('en-GB', { day: '2-digit', month: 'short', year: 'numeric' }),
      type, severity: sev as IncidentRecord['severity'], site, status: 'Open',
      reporter: 'S. Chen', description: description || 'Incident reported.', immediateActions: actions || '—',
    });
    setDescription(''); setActions('');
  }

  return (
    <HseModal open={open} title="Report Incident" sub="Opens a governed investigation workflow on submit." onClose={onClose} onSubmit={submit} submitLabel="Submit & Route">
      <div class="hse-form-grid">
        <Field label="Incident type"><SelectInput value={type} onInput={v => setType(v as IncidentType)} options={INCIDENT_TYPES} /></Field>
        <Field label="Severity"><SelectInput value={severity} onInput={setSeverity} options={SEVERITIES} /></Field>
        <Field label="Site"><SelectInput value={site} onInput={setSite} options={HSE_SITES} /></Field>
        <Field label="Reported by"><TextInput value="S. Chen" onInput={() => {}} /></Field>
        <Field label="What happened?" wide><TextareaInput value={description} onInput={setDescription} placeholder="Describe the event, location and people involved…" /></Field>
        <Field label="Immediate actions taken" wide><TextareaInput value={actions} onInput={setActions} placeholder="Containment, first aid, isolation, notifications…" /></Field>
      </div>
    </HseModal>
  );
}
