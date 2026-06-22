/**
 * src/components/sections/HSE/EmergencyResponse.tsx
 *
 * Emergency Response area — emergency plans per site, muster points, drill log,
 * and ERT (Emergency Response Team) member register. T&T context: TTFS/MFSC
 * requirements, marine MOB drills at Galeota, SOPEP at the marine base.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { AreaHero, AreaTabs, withCounts, HseModal, Field, TextInput, SelectInput, type AreaTab } from '@ui';
import { HSE_SITES, hsePill, type HseSeverity } from './types';

// ── Mock data ─────────────────────────────────────────────────────────────────

interface EmergencyPlan {
  ref:       string;
  site:      string;
  planType:  string;
  version:   string;
  owner:     string;
  reviewed:  string;
  nextReview:string;
  status:    string;
  severity:  HseSeverity;
}

const mockPlans: EmergencyPlan[] = [
  { ref: 'ERP-001', site: 'Point Lisas Plant',   planType: 'Fire & Explosion Response Plan',       version: 'v3.2', owner: 'S. Chen',      reviewed: '15 Jan 2026', nextReview: '15 Jan 2027', status: 'Current',    severity: 'success' },
  { ref: 'ERP-002', site: 'Point Lisas Plant',   planType: 'Chemical Spill Response Plan',         version: 'v2.1', owner: 'S. Chen',      reviewed: '15 Jan 2026', nextReview: '15 Jan 2027', status: 'Current',    severity: 'success' },
  { ref: 'ERP-003', site: 'Galeota Marine Base', planType: 'Ship Oil Pollution Emergency Plan (SOPEP)', version: 'v1.4', owner: 'A. Mohammed', reviewed: '01 Mar 2026', nextReview: '01 Mar 2027', status: 'Current',    severity: 'success' },
  { ref: 'ERP-004', site: 'Galeota Marine Base', planType: 'Man Overboard (MOB) Drill Plan',       version: 'v2.0', owner: 'A. Mohammed', reviewed: '01 Mar 2026', nextReview: '01 Mar 2027', status: 'Current',    severity: 'success' },
  { ref: 'ERP-005', site: 'La Brea Yard',        planType: 'Medical Emergency & First Aid Plan',   version: 'v1.1', owner: 'A. Mohammed', reviewed: '20 Nov 2025', nextReview: '20 Nov 2026', status: 'Review Due', severity: 'warning' },
  { ref: 'ERP-006', site: 'Piarco Logistics',    planType: 'Forklift Accident & Traffic Emergency', version: 'v1.0', owner: 'L. Ramnarine', reviewed: '10 Oct 2025', nextReview: '10 Oct 2026', status: 'Review Due', severity: 'warning' },
  { ref: 'ERP-007', site: 'Port of Spain Office', planType: 'Building Evacuation Plan',             version: 'v2.3', owner: 'S. Chen',      reviewed: '05 Jun 2026', nextReview: '05 Jun 2027', status: 'Current',    severity: 'success' },
];

interface MusterPoint {
  ref:      string;
  site:     string;
  location: string;
  type:     string;
  capacity: number;
  warden:   string;
  lastDrill:string;
  status:   string;
}

const mockMusterPoints: MusterPoint[] = [
  { ref: 'MST-001', site: 'Point Lisas Plant',   location: 'North car park — gate 1 side', type: 'Primary',   capacity: 80, warden: 'A. Mohammed',   lastDrill: '10 Jun 2026', status: 'Active' },
  { ref: 'MST-002', site: 'Point Lisas Plant',   location: 'South compound — tank farm end', type: 'Secondary', capacity: 40, warden: 'T. Baptiste',   lastDrill: '10 Jun 2026', status: 'Active' },
  { ref: 'MST-003', site: 'Galeota Marine Base', location: 'Jetty head — assembly area A',   type: 'Primary',   capacity: 50, warden: 'A. Mohammed',   lastDrill: '15 May 2026', status: 'Active' },
  { ref: 'MST-004', site: 'Galeota Marine Base', location: 'Vessel MOB station — starboard', type: 'Marine',    capacity: 20, warden: 'R. Khan',        lastDrill: '15 May 2026', status: 'Active' },
  { ref: 'MST-005', site: 'La Brea Yard',        location: 'Workshop yard — painted grid',   type: 'Primary',   capacity: 60, warden: 'J. Lewis',       lastDrill: '22 Apr 2026', status: 'Active' },
  { ref: 'MST-006', site: 'Piarco Logistics',    location: 'Loading bay 1 — north end',      type: 'Primary',   capacity: 45, warden: 'L. Ramnarine',  lastDrill: '18 Apr 2026', status: 'Active' },
  { ref: 'MST-007', site: 'Port of Spain Office',location: 'Ground floor lobby — rear exit', type: 'Primary',   capacity: 30, warden: 'S. Chen',        lastDrill: '01 Jun 2026', status: 'Active' },
];

interface DrillRow {
  ref:      string;
  site:     string;
  drillType:string;
  date:     string;
  duration: string;
  scenario: string;
  participants: number;
  score:    number;
  findings: string;
  status:   string;
}

const mockDrills: DrillRow[] = [
  { ref: 'DRL-022', site: 'Point Lisas Plant',   drillType: 'Fire & Evacuation',    date: '10 Jun 2026', duration: '18 min', scenario: 'Fire in tank farm pump room — full site evacuation', participants: 74, score: 88, findings: 'Gate 2 blocked briefly; corrected during drill', status: 'Complete' },
  { ref: 'DRL-023', site: 'Galeota Marine Base', drillType: 'Spill Response',        date: '15 May 2026', duration: '25 min', scenario: 'Simulated diesel sheen from barge transfer',          participants: 22, score: 92, findings: 'EMA notification drill included — good response',  status: 'Complete' },
  { ref: 'DRL-024', site: 'Galeota Marine Base', drillType: 'Man Overboard (MOB)',   date: '15 May 2026', duration: '12 min', scenario: 'Worker overboard at jetty during transfer ops',       participants: 18, score: 95, findings: 'Rescue time within TTFS requirement',              status: 'Complete' },
  { ref: 'DRL-025', site: 'La Brea Yard',        drillType: 'Medical Emergency',     date: '22 Apr 2026', duration: '10 min', scenario: 'Simulated hand laceration — first aid and evacuation', participants: 38, score: 79, findings: 'First aid box location sign missing in workshop',  status: 'Complete' },
  { ref: 'DRL-026', site: 'Piarco Logistics',    drillType: 'Fire & Evacuation',    date: '25 Jun 2026', duration: '—',      scenario: 'Full loading bay evacuation — scheduled',             participants: 0,  score: 0,  findings: '—',                                               status: 'Scheduled' },
];

interface ErtMember {
  ref:      string;
  name:     string;
  role:     string;
  site:     string;
  ertRole:  string;
  firstAid: string;
  fireWarden:string;
  lastTraining: string;
  status:   string;
}

const mockErtMembers: ErtMember[] = [
  { ref: 'ERT-001', name: 'Sarah Chen',       role: 'HSE Manager',    site: 'Port of Spain Office', ertRole: 'ERT Coordinator',     firstAid: 'Current', fireWarden: 'Current', lastTraining: '15 Mar 2026', status: 'Active' },
  { ref: 'ERT-002', name: 'Anya Mohammed',    role: 'Site HSE Officer', site: 'La Brea Yard',       ertRole: 'Area Warden',         firstAid: 'Current', fireWarden: 'Current', lastTraining: '12 Feb 2026', status: 'Active' },
  { ref: 'ERT-003', name: 'Reza Khan',        role: 'CS Attendant',   site: 'Galeota Marine Base', ertRole: 'Rescue Team Member',  firstAid: 'Current', fireWarden: 'Due',     lastTraining: '20 Jan 2026', status: 'Active' },
  { ref: 'ERT-004', name: 'Terrence Baptiste',role: 'Electrician',    site: 'Point Lisas Plant',   ertRole: 'Area Warden',         firstAid: 'Due',     fireWarden: 'Current', lastTraining: '05 Jan 2026', status: 'Active' },
  { ref: 'ERT-005', name: 'Lisa Ramnarine',   role: 'Warehouse Lead', site: 'Piarco Logistics',    ertRole: 'Area Warden',         firstAid: 'Expired', fireWarden: 'Current', lastTraining: '10 Jun 2025', status: 'Renewal Required' },
];

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'plans',  label: 'Emergency Plans', icon: 'fa-map-location-dot' },
  { key: 'muster', label: 'Muster Points',   icon: 'fa-people-group' },
  { key: 'drills', label: 'Drill Log',       icon: 'fa-stopwatch' },
  { key: 'ert',    label: 'ERT Register',    icon: 'fa-shield-halved' },
];

function PlansTab(): VNode {
  const reviewDue = mockPlans.filter(p => p.status === 'Review Due').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Plans</span></div><div class="hse-spark-val">{mockPlans.length}</div><div class="hse-spark-sub">Across 5 T&T sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Current</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockPlans.filter(p => p.status === 'Current').length}</div><div class="hse-spark-sub">Reviewed and approved</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Review Due</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{reviewDue}</div><div class="hse-spark-sub">Annual review overdue</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Plan Types</span></div><div class="hse-spark-val" style={{ fontSize: '0.85rem', color: '#60a5fa' }}>Fire · Spill · MOB</div><div class="hse-spark-sub">Site-specific scenarios</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search plan or site…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> Add Plan</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Site</th><th>Plan Type</th><th>Ver.</th><th>Owner</th><th>Last Review</th><th>Next Review</th><th>Status</th></tr></thead>
                <tbody>
                  {mockPlans.map(p => (
                    <tr key={p.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{p.ref}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{p.site}</td>
                      <td style={{ fontSize: '0.76rem' }}>{p.planType}</td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.73rem' }}>{p.version}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.owner}</td>
                      <td class="vt-cell-mono">{p.reviewed}</td>
                      <td class="vt-cell-mono" style={{ color: p.status === 'Review Due' ? '#d97706' : 'inherit', fontWeight: p.status === 'Review Due' ? 600 : 400 }}>{p.nextReview}</td>
                      <td><span class={hsePill(p.status)}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-circle-exclamation" /> Plan Review Actions</h4>
          <div class="ppe-signals-list">
            {mockPlans.filter(p => p.status !== 'Current').map(p => (
              <div class="ppe-signal" key={p.ref}>
                <i class="fas fa-map-location-dot is-warn" />
                <div class="ppe-signal-text">
                  <strong>{p.site}</strong>
                  <span>{p.planType.slice(0, 40)}…</span>
                </div>
                <span class="ppe-signal-tag is-due">Review Due</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-ship" /> T&T Marine Requirements</h4>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.7)', lineHeight: 1.6, display: 'grid', gap: '5px' }}>
            <div><strong style={{ color: '#60a5fa' }}>SOPEP</strong> — Ship Oil Pollution Emergency Plan required for Galeota marine transfer operations.</div>
            <div><strong style={{ color: '#60a5fa' }}>MOB Drill</strong> — TTFS/MFSC requires quarterly man-overboard drill at marine terminals.</div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function MusterTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Muster Points</span></div><div class="hse-spark-val">{mockMusterPoints.length}</div><div class="hse-spark-sub">Registered across all sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Capacity</span></div><div class="hse-spark-val">{mockMusterPoints.reduce((s, m) => s + m.capacity, 0)}</div><div class="hse-spark-sub">Workers accounted for per site</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Wardens Assigned</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockMusterPoints.length}</div><div class="hse-spark-sub">Named warden per point</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Marine Stations</span></div><div class="hse-spark-val" style={{ color: '#60a5fa' }}>{mockMusterPoints.filter(m => m.type === 'Marine').length}</div><div class="hse-spark-sub">MOB / vessel assembly</div></div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Site</th><th>Location</th><th>Type</th><th>Capacity</th><th>Warden</th><th>Last Drill</th><th>Status</th></tr></thead>
            <tbody>
              {mockMusterPoints.map(m => (
                <tr key={m.ref}>
                  <td><span class="vt-cell-mono">{m.ref}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{m.site}</td>
                  <td style={{ fontSize: '0.76rem' }}>{m.location}</td>
                  <td><span class={`vt-pill ${m.type === 'Primary' ? 'is-on' : m.type === 'Marine' ? 'is-info' : 'is-warn'}`}>{m.type}</span></td>
                  <td class="vt-cell-mono">{m.capacity}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{m.warden}</td>
                  <td class="vt-cell-mono">{m.lastDrill}</td>
                  <td><span class={hsePill(m.status)}>{m.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function DrillsTab(): VNode {
  const [drills, setDrills]   = useState(mockDrills);
  const [modalOpen, setModal] = useState(false);
  const [newSite, setSite]    = useState<string>(HSE_SITES[0]);
  const [newType, setType]    = useState('Fire & Evacuation');
  const [newScenario, setScenario] = useState('');

  const avgScore = drills.filter(d => d.score > 0).reduce((s, d) => s + d.score, 0) / (drills.filter(d => d.score > 0).length || 1);

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Drills YTD</span></div><div class="hse-spark-val">{drills.filter(d => d.status === 'Complete').length}</div><div class="hse-spark-sub">Completed across all sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Avg Score</span></div><div class="hse-spark-val" style={{ color: avgScore >= 85 ? '#22c55e' : '#f59e0b' }}>{Math.round(avgScore)}%</div><div class="hse-spark-sub">Drill performance rating</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Participants</span></div><div class="hse-spark-val">{drills.reduce((s, d) => s + d.participants, 0)}</div><div class="hse-spark-sub">Workers drilled YTD</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Scheduled</span></div><div class="hse-spark-val" style={{ color: '#60a5fa' }}>{drills.filter(d => d.status === 'Scheduled').length}</div><div class="hse-spark-sub">Upcoming drills planned</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search drill or site…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary" onClick={() => setModal(true)}><i class="fas fa-circle-plus" /> Log Drill</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Site</th><th>Drill Type</th><th>Date</th><th>Duration</th><th>Participants</th><th>Score</th><th>Status</th></tr></thead>
                <tbody>
                  {drills.map(d => (
                    <tr key={d.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{d.ref}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{d.site}</td>
                      <td style={{ fontSize: '0.76rem' }}>{d.drillType}</td>
                      <td class="vt-cell-mono">{d.date}</td>
                      <td class="vt-cell-mono">{d.duration}</td>
                      <td class="vt-cell-mono">{d.participants || '—'}</td>
                      <td>
                        {d.score > 0
                          ? <span style={{ fontWeight: 600, color: d.score >= 85 ? '#22c55e' : d.score >= 70 ? '#f59e0b' : '#ef4444' }}>{d.score}%</span>
                          : <span style={{ color: 'var(--text-muted)' }}>—</span>}
                      </td>
                      <td><span class={hsePill(d.status)}>{d.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-stopwatch" /> Recent Drills</h4>
          <div class="ppe-signals-list">
            {drills.slice(0, 4).map(d => (
              <div class="ppe-signal" key={d.ref}>
                <i class={`fas fa-fire-extinguisher ${d.status === 'Complete' ? 'is-ok' : 'is-info'}`} />
                <div class="ppe-signal-text">
                  <strong>{d.drillType}</strong>
                  <span>{d.site} · {d.date}</span>
                </div>
                <span class={`ppe-signal-tag ${d.score >= 85 ? 'is-ok' : d.score > 0 ? 'is-due' : 'is-info'}`}>
                  {d.score > 0 ? `${d.score}%` : d.status}
                </span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-calendar-check" /> Drill Cadence</h4>
          <div style={{ display: 'grid', gap: '5px' }}>
            {[
              ['Fire & Evacuation', 'Quarterly per site'],
              ['Spill Response', 'Bi-annually — all spill risk sites'],
              ['MOB (Galeota)', 'Quarterly — TTFS/MFSC requirement'],
              ['Medical', 'Annually per site'],
            ].map(([type, cadence]) => (
              <div key={type} style={{ fontSize: '0.69rem', color: 'rgba(255,255,255,.75)', lineHeight: 1.5 }}>
                <strong style={{ color: 'rgba(255,255,255,.95)' }}>{type}</strong> — {cadence}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <HseModal open={modalOpen} onClose={() => setModal(false)}
        title="Log Emergency Drill" sub="Record a completed or scheduled emergency drill."
        submitLabel="Log Drill"
        onSubmit={() => {
          const ref = `DRL-${String(drills.length + 20).padStart(3, '0')}`;
          setDrills([{ ref, site: newSite, drillType: newType, date: '25 Jun 2026', duration: '—', scenario: newScenario || 'Full site drill', participants: 0, score: 0, findings: '—', status: 'Scheduled' }, ...drills]);
          setModal(false); setScenario('');
        }}>
        <div class="hse-form-grid">
          <Field label="Site"><SelectInput value={newSite} onInput={setSite} options={[...HSE_SITES]} /></Field>
          <Field label="Drill type"><SelectInput value={newType} onInput={setType} options={['Fire & Evacuation', 'Spill Response', 'Man Overboard (MOB)', 'Medical Emergency', 'Chemical Incident', 'Confined Space Rescue']} /></Field>
          <Field label="Scenario description" wide><TextInput value={newScenario} onInput={setScenario} placeholder="Describe the drill scenario…" /></Field>
        </div>
      </HseModal>
    </div>
  );
}

function ErtTab(): VNode {
  const renewalRequired = mockErtMembers.filter(m => m.status !== 'Active').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">ERT Members</span></div><div class="hse-spark-val">{mockErtMembers.length}</div><div class="hse-spark-sub">Registered across all sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Active</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockErtMembers.filter(m => m.status === 'Active').length}</div><div class="hse-spark-sub">First aid and fire warden current</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Renewal Required</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{renewalRequired}</div><div class="hse-spark-sub">Training expired or due</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Coordinators</span></div><div class="hse-spark-val">{mockErtMembers.filter(m => m.ertRole === 'ERT Coordinator').length}</div><div class="hse-spark-sub">Overall ERT leadership</div></div>
      </div>
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search ERT member…" /></div>
        <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
        <button class="hse-btn primary"><i class="fas fa-user-plus" /> Add ERT Member</button>
      </div>
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Name</th><th>Role</th><th>Site</th><th>ERT Role</th><th>First Aid</th><th>Fire Warden</th><th>Last Training</th><th>Status</th></tr></thead>
                <tbody>
                  {mockErtMembers.map(m => (
                    <tr key={m.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{m.ref}</span></td>
                      <td><span class="vt-cell-name">{m.name}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{m.role}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{m.site}</td>
                      <td style={{ fontSize: '0.75rem', fontWeight: 500 }}>{m.ertRole}</td>
                      <td><span class={hsePill(m.firstAid)}>{m.firstAid}</span></td>
                      <td><span class={hsePill(m.fireWarden)}>{m.fireWarden}</span></td>
                      <td class="vt-cell-mono">{m.lastTraining}</td>
                      <td><span class={hsePill(m.status)}>{m.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-shield-halved" /> Training Alerts</h4>
          <div class="ppe-signals-list">
            {mockErtMembers.filter(m => m.firstAid !== 'Current' || m.fireWarden !== 'Current').map(m => (
              <div class="ppe-signal" key={m.ref}>
                <i class={`fas fa-kit-medical ${m.status !== 'Active' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{m.name}</strong>
                  <span>{m.firstAid !== 'Current' ? `First Aid ${m.firstAid}` : `Fire Warden ${m.fireWarden}`}</span>
                </div>
                <span class={`ppe-signal-tag ${m.status !== 'Active' ? 'is-high' : 'is-due'}`}>{m.status !== 'Active' ? 'Renewal Req.' : 'Due'}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Area export ───────────────────────────────────────────────────────────────

export function EmergencyResponseArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(tab);

  const reviewDue = mockPlans.filter(p => p.status !== 'Current').length;
  const drillsDone = mockDrills.filter(d => d.status === 'Complete').length;

  const stats = [
    { icon: 'fa-map-location-dot', label: 'Emergency Plans', value: mockPlans.length,        sub: 'on file',       color: 'blue'  as const },
    { icon: 'fa-people-group',     label: 'Muster Points',   value: mockMusterPoints.length, sub: 'across sites',  color: 'blue'  as const },
    { icon: 'fa-stopwatch',        label: 'Drills YTD',      value: drillsDone,              sub: 'completed',     color: 'green' as const },
    { icon: 'fa-triangle-exclamation', label: 'Review Due',  value: reviewDue,               sub: 'plans to review',color: 'gold' as const },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-truck-medical"
        areaIcon="fa-siren-on"
        title="Emergency Response"
        watermarkClass="hse-wm-emergency"
        stats={stats}
        footerItems={[
          { icon: 'fa-stopwatch', label: 'Drills Completed YTD', value: String(drillsDone), pill: '● On Track', pillVariant: 'green' },
          { icon: 'fa-people-group', label: 'ERT Members Active', value: String(mockErtMembers.filter(m => m.status === 'Active').length), pill: '● Certified', pillVariant: 'green' },
          { icon: 'fa-triangle-exclamation', label: 'Plans Review Due', value: String(reviewDue), trend: reviewDue > 0 ? 'review' : undefined, trendUp: false },
          { icon: 'fa-ship', label: 'SOPEP / MOB — Galeota', value: 'Current', pill: '● Monitoring', pillVariant: 'amber' },
        ]}
      />
      <AreaTabs
        icon="fa-truck-medical"
        title="Emergency Response"
        sub="Emergency plans, muster points, drills, and ERT register"
        tabs={withCounts(TABS, { plans: mockPlans.length, muster: mockMusterPoints.length })}
        active={active} onSelect={setActive}
      />
      {active === 'plans'  && <PlansTab />}
      {active === 'muster' && <MusterTab />}
      {active === 'drills' && <DrillsTab />}
      {active === 'ert'    && <ErtTab />}
    </div>
  );
}
