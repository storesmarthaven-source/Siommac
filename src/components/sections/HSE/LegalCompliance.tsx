/**
 * src/components/sections/HSE/LegalCompliance.tsx
 *
 * Legal & Compliance Register — OSH Act 2004 T&T obligations tracker, EMA permit
 * register, breach log, and regulatory calendar. Covers the primary T&T regulatory
 * landscape: OSH Act, EMA (Environmental Management Authority), ISO 45001 alignment.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader, MetricRow, TabBar, withCounts, SparkCard, HseModal, Field, TextInput, SelectInput, type AreaTab, type SparkDef } from '@ui';
import { HSE_SITES, hsePill, type HseSeverity } from './types';

// ── Mock data ────────────────────────────────────────────────────────────────

interface ObligationRow {
  ref:        string;
  regulation: string;
  section:    string;
  topic:      string;
  owner:      string;
  due:        string;
  status:     string;
  severity:   HseSeverity;
}

const mockObligations: ObligationRow[] = [
  { ref: 'OBL-001', regulation: 'OSH Act 2004',    section: 'S.13',    topic: 'Employer duty of care — safe workplace and safe systems of work',         owner: 'HSE Manager',       due: 'Ongoing',      status: 'Compliant',  severity: 'success' },
  { ref: 'OBL-002', regulation: 'OSH Act 2004',    section: 'S.32',    topic: 'Occupational Safety & Health Officer (OSHO) appointment on site',          owner: 'HR / HSE',         due: 'Ongoing',      status: 'Compliant',  severity: 'success' },
  { ref: 'OBL-003', regulation: 'OSH Act 2004',    section: 'S.52',    topic: 'Notify OSH Authority within 4 hours of any fatal or major injury',          owner: 'HSE Manager',       due: 'Event-driven', status: 'Compliant',  severity: 'success' },
  { ref: 'OBL-004', regulation: 'OSH Act 2004',    section: 'S.56',    topic: 'Annual OSH statutory return to OSHA — employee count, incidents reported',   owner: 'HSE Manager',       due: '31 Jan 2027',  status: 'Upcoming',   severity: 'info'    },
  { ref: 'OBL-005', regulation: 'EMA Act',         section: 'S.58',    topic: 'Certificate of Environmental Clearance (CEC) for major plant activities',   owner: 'HSE / Legal',      due: '30 Sep 2026',  status: 'Due',        severity: 'warning' },
  { ref: 'OBL-006', regulation: 'EMA Act',         section: 'S.22',    topic: 'Notify EMA within 24 hours of any Tier 1 or Tier 2 spill event',            owner: 'HSE Manager',       due: 'Event-driven', status: 'Compliant',  severity: 'success' },
  { ref: 'OBL-007', regulation: 'Factories Act',   section: 'S.8',     topic: 'Annual factory inspection by Division of Occupational Safety and Health',    owner: 'Site Manager',      due: '30 Jun 2026',  status: 'Overdue',    severity: 'danger'  },
  { ref: 'OBL-008', regulation: 'ISO 45001:2018',  section: '9.2',     topic: 'Internal HSE management system audit — all sites minimum annual cycle',     owner: 'HSE Manager',       due: '30 Nov 2026',  status: 'Scheduled',  severity: 'info'    },
];

interface EmaPermitRow {
  ref:      string;
  type:     string;
  activity: string;
  site:     string;
  issued:   string;
  expiry:   string;
  status:   string;
  severity: HseSeverity;
}

const mockEmaPermits: EmaPermitRow[] = [
  { ref: 'EMA-2024-018', type: 'CEC',                 activity: 'Fuel storage tank expansion',    site: 'Point Lisas Plant',   issued: '15 Mar 2024', expiry: '14 Mar 2027', status: 'Current',  severity: 'success' },
  { ref: 'EMA-2023-041', type: 'Trade Effluent Permit', activity: 'Process water discharge',       site: 'Point Lisas Plant',   issued: '01 Jun 2023', expiry: '31 May 2026', status: 'Expired',  severity: 'danger'  },
  { ref: 'EMA-2025-009', type: 'Noise Permit',         activity: 'Pile driving and blasting',      site: 'La Brea Yard',        issued: '10 Jan 2025', expiry: '09 Jan 2027', status: 'Current',  severity: 'success' },
  { ref: 'EMA-2024-033', type: 'Air Emission Permit',  activity: 'Generator bank operation',       site: 'Galeota Marine Base', issued: '20 Aug 2024', expiry: '19 Aug 2026', status: 'Due',      severity: 'warning' },
  { ref: 'EMA-2026-002', type: 'CEC',                  activity: 'Marine terminal dredging',       site: 'Galeota Marine Base', issued: '04 Feb 2026', expiry: '03 Feb 2029', status: 'Current',  severity: 'success' },
];

interface BreachRow {
  ref:        string;
  regulation: string;
  site:       string;
  date:       string;
  description:string;
  status:     string;
  action:     string;
  severity:   HseSeverity;
}

const mockBreaches: BreachRow[] = [
  { ref: 'BRE-001', regulation: 'EMA Act', site: 'Point Lisas Plant',   date: '18 Jun 2026', description: 'Diesel sheen to storm drain — Tier 2 spill. EMA notification submitted within 24h.', status: 'Open',     action: 'EMA notification sent; cleanup ongoing', severity: 'danger'  },
  { ref: 'BRE-002', regulation: 'Factories Act', site: 'La Brea Yard',  date: '02 May 2026', description: 'Factory inspection overdue — Division of OSAH notified; rescheduled.', status: 'Pending',  action: 'Inspection rescheduled for 28 Jun 2026',  severity: 'warning' },
  { ref: 'BRE-003', regulation: 'OSH Act 2004',  site: 'La Brea Yard',  date: '17 Jun 2026', description: 'Contractor injury — notification to OSH Authority within required 4-hour window.', status: 'Closed',   action: 'OSH notified; CAPA CA-303 raised',        severity: 'info'    },
];

interface CalendarEvent {
  ref:        string;
  event:      string;
  regulation: string;
  due:        string;
  owner:      string;
  status:     string;
}

const mockCalendar: CalendarEvent[] = [
  { ref: 'CAL-001', event: 'OSH Annual Return submission',      regulation: 'OSH Act S.56',     due: '31 Jan 2027', owner: 'HSE Manager',  status: 'Upcoming' },
  { ref: 'CAL-002', event: 'CEC renewal — trade effluent',      regulation: 'EMA Act',          due: '01 Jun 2026', owner: 'HSE / Legal',  status: 'Overdue'  },
  { ref: 'CAL-003', event: 'Factory inspection — La Brea Yard', regulation: 'Factories Act',    due: '28 Jun 2026', owner: 'Site Manager', status: 'Pending'  },
  { ref: 'CAL-004', event: 'Air emission permit renewal',       regulation: 'EMA Act',          due: '19 Aug 2026', owner: 'HSE / Legal',  status: 'Due'      },
  { ref: 'CAL-005', event: 'ISO 45001 internal audit',          regulation: 'ISO 45001:2018',   due: '30 Nov 2026', owner: 'HSE Manager',  status: 'Scheduled'},
  { ref: 'CAL-006', event: 'CEC application — Galeota dredge',  regulation: 'EMA Act',          due: '04 Feb 2029', owner: 'HSE / Legal',  status: 'Current'  },
];

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'obligations', label: 'OSH Obligations',    icon: 'fa-list-check' },
  { key: 'permits',     label: 'EMA Permits',         icon: 'fa-file-contract' },
  { key: 'breaches',    label: 'Breach Log',          icon: 'fa-triangle-exclamation' },
  { key: 'calendar',   label: 'Regulatory Calendar', icon: 'fa-calendar-days' },
];

function ObligationsTab(): VNode {
  const overdue   = mockObligations.filter(o => o.status === 'Overdue').length;
  const due       = mockObligations.filter(o => o.status === 'Due').length;
  const compliant = mockObligations.filter(o => o.status === 'Compliant').length;

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Obligations</span></div><div class="hse-spark-val">{mockObligations.length}</div><div class="hse-spark-sub">Tracked against T&T legislation</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Compliant</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{compliant}</div><div class="hse-spark-sub">No action required</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Due</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div><div class="hse-spark-sub">Action within 30 days</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Overdue</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{overdue}</div><div class="hse-spark-sub">Regulatory risk — escalate</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 240px' }}><i class="fas fa-search" /><input type="search" placeholder="Search obligation or regulation…" /></div>
            <select class="emp-filter-select"><option>All regulations</option>{['OSH Act 2004', 'EMA Act', 'Factories Act', 'ISO 45001:2018'].map(r => <option key={r}>{r}</option>)}</select>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> Add Obligation</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Regulation</th><th>Section</th><th>Topic</th><th>Owner</th><th>Due</th><th>Status</th></tr></thead>
                <tbody>
                  {mockObligations.map(o => (
                    <tr key={o.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{o.ref}</span></td>
                      <td><span style={{ fontWeight: 600, fontSize: '0.76rem', color: 'var(--siomac-navy)' }}>{o.regulation}</span></td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.75rem' }}>{o.section}</span></td>
                      <td style={{ fontSize: '0.76rem', maxWidth: '260px' }}>{o.topic}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{o.owner}</td>
                      <td class="vt-cell-mono" style={{ fontSize: '0.76rem', color: o.status === 'Overdue' ? 'var(--siomac-red)' : o.status === 'Due' ? '#d97706' : 'inherit' }}>{o.due}</td>
                      <td><span class={hsePill(o.status)}>{o.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-scale-balanced" /> Action Required</h4>
          <div class="ppe-signals-list">
            {mockObligations.filter(o => o.status === 'Overdue' || o.status === 'Due').map(o => (
              <div class="ppe-signal" key={o.ref}>
                <i class={`fas fa-scale-balanced ${o.status === 'Overdue' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{o.regulation} {o.section}</strong>
                  <span>{o.topic.slice(0, 55)}…</span>
                </div>
                <span class={`ppe-signal-tag ${o.status === 'Overdue' ? 'is-high' : 'is-due'}`}>{o.status}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-book-open" /> Key T&T Regulations</h4>
          <div style={{ display: 'grid', gap: '6px' }}>
            {[
              ['OSH Act 2004', 'Primary workplace safety legislation'],
              ['EMA Act Chap 35:05', 'Environmental Management Authority'],
              ['Factories Act Chap 88:01', 'Plant and machinery safety'],
              ['ISO 45001:2018', 'OHSMS management system standard'],
            ].map(([reg, desc]) => (
              <div key={reg} style={{ fontSize: '0.69rem', color: 'rgba(255,255,255,.75)', lineHeight: 1.5 }}>
                <strong style={{ color: '#60a5fa' }}>{reg}</strong><br />{desc}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmaPermitsTab(): VNode {
  const [permits, setPermits] = useState(mockEmaPermits);
  const [modalOpen, setModal] = useState(false);
  const [newType, setType]    = useState('CEC');
  const [newActivity, setActivity] = useState('');
  const [newSite, setSite]    = useState<string>(HSE_SITES[0]);
  const [newExpiry, setExpiry] = useState('');

  const expired = permits.filter(p => p.status === 'Expired').length;
  const due     = permits.filter(p => p.status === 'Due').length;

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total EMA Permits</span></div><div class="hse-spark-val">{permits.length}</div><div class="hse-spark-sub">All T&T sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Current</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{permits.filter(p => p.status === 'Current').length}</div><div class="hse-spark-sub">Valid and in force</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Renewal Due</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div><div class="hse-spark-sub">Within 60 days</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Expired</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{expired}</div><div class="hse-spark-sub">Activity must cease</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search permit or activity…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary" onClick={() => setModal(true)}><i class="fas fa-circle-plus" /> Add Permit</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Type</th><th>Activity</th><th>Site</th><th>Issued</th><th>Expiry</th><th>Status</th></tr></thead>
                <tbody>
                  {permits.map(p => (
                    <tr key={p.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{p.ref}</span></td>
                      <td><span style={{ fontWeight: 600, fontSize: '0.75rem' }}>{p.type}</span></td>
                      <td style={{ fontSize: '0.76rem' }}>{p.activity}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{p.site}</td>
                      <td class="vt-cell-mono">{p.issued}</td>
                      <td class="vt-cell-mono" style={{ color: p.status === 'Expired' ? 'var(--siomac-red)' : p.status === 'Due' ? '#d97706' : 'inherit', fontWeight: p.status !== 'Current' ? 600 : 400 }}>{p.expiry}</td>
                      <td><span class={hsePill(p.status)}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-circle-exclamation" /> Permit Actions</h4>
          <div class="ppe-signals-list">
            {permits.filter(p => p.status !== 'Current').map(p => (
              <div class="ppe-signal" key={p.ref}>
                <i class={`fas fa-file-contract ${p.status === 'Expired' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{p.type}</strong>
                  <span>{p.site} · Expires {p.expiry}</span>
                </div>
                <span class={`ppe-signal-tag ${p.status === 'Expired' ? 'is-high' : 'is-due'}`}>{p.status}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-leaf" /> EMA Permit Types</h4>
          <div style={{ display: 'grid', gap: '5px' }}>
            {['Certificate of Environmental Clearance (CEC)', 'Trade Effluent Permit', 'Air Emission Permit', 'Noise Permit', 'Waste Management Approval'].map(t => (
              <div key={t} style={{ fontSize: '0.69rem', color: 'rgba(255,255,255,.7)', display: 'flex', gap: '6px', alignItems: 'center' }}>
                <i class="fas fa-circle" style={{ fontSize: '0.4rem', color: '#34d399' }} />{t}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <HseModal open={modalOpen} onClose={() => setModal(false)}
        title="Add EMA Permit" sub="Record an EMA permit or environmental clearance for a T&T site activity."
        submitLabel="Add Permit"
        onSubmit={() => {
          const ref = `EMA-2026-${String(permits.length + 1).padStart(3, '0')}`;
          setPermits([{ ref, type: newType, activity: newActivity || 'New activity', site: newSite, issued: '19 Jun 2026', expiry: newExpiry || 'TBD', status: 'Current', severity: 'success' }, ...permits]);
          setModal(false); setActivity(''); setExpiry('');
        }}>
        <div class="hse-form-grid">
          <Field label="Permit type"><SelectInput value={newType} onInput={setType} options={['CEC', 'Trade Effluent Permit', 'Air Emission Permit', 'Noise Permit', 'Waste Management Approval']} /></Field>
          <Field label="Site"><SelectInput value={newSite} onInput={setSite} options={[...HSE_SITES]} /></Field>
          <Field label="Activity description" wide><TextInput value={newActivity} onInput={setActivity} placeholder="e.g. Fuel storage tank expansion" /></Field>
          <Field label="Expiry date"><TextInput value={newExpiry} onInput={setExpiry} placeholder="e.g. 14 Mar 2027" /></Field>
        </div>
      </HseModal>
    </div>
  );
}

function BreachesTab(): VNode {
  const open   = mockBreaches.filter(b => b.status === 'Open').length;
  const closed = mockBreaches.filter(b => b.status === 'Closed').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Breaches</span></div><div class="hse-spark-val">{mockBreaches.length}</div><div class="hse-spark-sub">Logged YTD</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Open</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{open}</div><div class="hse-spark-sub">Regulatory action pending</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Pending</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{mockBreaches.filter(b => b.status === 'Pending').length}</div><div class="hse-spark-sub">Evidence / response in progress</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Closed</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{closed}</div><div class="hse-spark-sub">Resolved and evidenced</div></div>
      </div>
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search breach or regulation…" /></div>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> Log Breach</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Regulation</th><th>Site</th><th>Date</th><th>Description</th><th>Action Taken</th><th>Status</th></tr></thead>
                <tbody>
                  {mockBreaches.map(b => (
                    <tr key={b.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{b.ref}</span></td>
                      <td style={{ fontWeight: 600, fontSize: '0.75rem', color: 'var(--siomac-navy)' }}>{b.regulation}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{b.site}</td>
                      <td class="vt-cell-mono">{b.date}</td>
                      <td style={{ fontSize: '0.75rem', maxWidth: '220px' }}>{b.description}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.73rem' }}>{b.action}</td>
                      <td><span class={hsePill(b.status)}>{b.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-triangle-exclamation" /> Open Breach Actions</h4>
          <div class="ppe-signals-list">
            {mockBreaches.filter(b => b.status !== 'Closed').map(b => (
              <div class="ppe-signal" key={b.ref}>
                <i class={`fas fa-scale-balanced ${b.status === 'Open' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{b.regulation} · {b.site}</strong>
                  <span>{b.action}</span>
                </div>
                <span class={`ppe-signal-tag ${b.status === 'Open' ? 'is-high' : 'is-due'}`}>{b.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function CalendarTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Tracked Events</span></div><div class="hse-spark-val">{mockCalendar.length}</div><div class="hse-spark-sub">Regulatory milestones</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Overdue</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{mockCalendar.filter(e => e.status === 'Overdue').length}</div><div class="hse-spark-sub">Past deadline</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Due Soon</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{mockCalendar.filter(e => e.status === 'Due' || e.status === 'Pending').length}</div><div class="hse-spark-sub">Action within 90 days</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Scheduled</span></div><div class="hse-spark-val" style={{ color: '#60a5fa' }}>{mockCalendar.filter(e => e.status === 'Scheduled').length}</div><div class="hse-spark-sub">Date confirmed</div></div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Regulatory Event</th><th>Regulation</th><th>Due Date</th><th>Owner</th><th>Status</th></tr></thead>
            <tbody>
              {mockCalendar.map(e => (
                <tr key={e.ref}>
                  <td><span class="vt-cell-mono">{e.ref}</span></td>
                  <td><span class="vt-cell-name">{e.event}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{e.regulation}</td>
                  <td class="vt-cell-mono" style={{ color: e.status === 'Overdue' ? 'var(--siomac-red)' : e.status === 'Due' ? '#d97706' : 'inherit', fontWeight: e.status === 'Overdue' || e.status === 'Due' ? 600 : 400 }}>{e.due}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{e.owner}</td>
                  <td><span class={hsePill(e.status)}>{e.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

// ── Area export ───────────────────────────────────────────────────────────────

export function LegalComplianceArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(tab);

  const compliantCount = mockObligations.filter(o => o.status === 'Compliant').length;
  const overdue        = mockObligations.filter(o => o.status === 'Overdue').length + mockEmaPermits.filter(p => p.status === 'Expired').length;
  const breaches       = mockBreaches.filter(b => b.status !== 'Closed').length;

  const sparks: SparkDef[] = [
    {
      label: 'OSH Obligations', value: String(mockObligations.length), sub: 'Tracked against T&T legislation',
      delta: `${compliantCount} compliant`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, mockObligations.length], sparkColor: '#60a5fa',
    },
    {
      label: 'Compliant', value: String(compliantCount), sub: 'No action required',
      delta: `${mockObligations.length - compliantCount} need attention`, deltaUp: mockObligations.length - compliantCount > 0, color: '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, compliantCount], sparkColor: '#4ade80',
    },
    {
      label: 'EMA Permits', value: String(mockEmaPermits.length), sub: 'Environmental clearances on register',
      delta: `${mockEmaPermits.filter(p => p.status === 'Current').length} current`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, mockEmaPermits.length], sparkColor: '#60a5fa',
    },
    {
      label: 'Overdue / Expired', value: String(overdue), sub: 'Obligations and permits needing action',
      delta: `${breaches} open breaches`, deltaUp: (overdue + breaches) > 0, color: overdue > 0 ? '#ef4444' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, overdue], sparkColor: '#ef4444',
    },
  ];

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-scale-balanced"
        module="HSE"
        title="Legal & Compliance"
        sub="OSH Act 2004 obligations tracker, EMA permit register, breach log, and regulatory calendar for T&T operations."
        meta={[
          { icon: 'fa-list-check', label: `${mockObligations.length} obligations` },
          { icon: 'fa-circle-check', label: `${compliantCount} compliant` },
          { icon: 'fa-file-contract', label: `${mockEmaPermits.length} EMA permits` },
          ...(overdue > 0 ? [{ icon: 'fa-triangle-exclamation', label: `${overdue} overdue / expired` }] : []),
        ]}
      />

      <MetricRow pageKey="hse.legal" cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))} />

      <TabBar tabs={withCounts(TABS, { obligations: mockObligations.length, permits: mockEmaPermits.length })} active={active} onSelect={setActive} />
      {active === 'obligations' && <ObligationsTab />}
      {active === 'permits'     && <EmaPermitsTab />}
      {active === 'breaches'    && <BreachesTab />}
      {active === 'calendar'    && <CalendarTab />}
    </div>
  );
}
