/**
 * src/components/sections/HSE/Environmental.tsx
 *
 * Environmental Management area — spill register, waste manifests, EMA notifications,
 * and environmental monitoring log. T&T context: EMA Act, SOPEP (Galeota),
 * waste manifests to Regulated Industries Commission (RIC), EIMS monitoring.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { AreaHero, AreaTabs, HseModal, Field, TextInput, SelectInput, TextareaInput, type AreaTab } from './_shared';
import { HSE_SITES, hsePill, type HseSeverity } from './types';
import { useWorkflow } from '@lib/workflow/useWorkflow';

// ── Mock data ─────────────────────────────────────────────────────────────────

interface SpillRow {
  ref:       string;
  date:      string;
  site:      string;
  substance: string;
  volume:    string;
  tier:      string;
  media:     string;   // soil / water / drain / air
  reporter:  string;
  emaNotified: boolean;
  status:    string;
  severity:  HseSeverity;
}

const mockSpills: SpillRow[] = [
  { ref: 'SPI-2026-001', date: '18 Jun 2026', site: 'Point Lisas Plant',   substance: 'Diesel (Automotive)',  volume: '~80 L',   tier: 'Tier 2', media: 'Storm drain', reporter: 'A. Mohammed', emaNotified: true,  status: 'Open',     severity: 'danger'  },
  { ref: 'SPI-2026-002', date: '04 May 2026', site: 'La Brea Yard',        substance: 'Hydraulic Oil ISO 46', volume: '~10 L',   tier: 'Tier 1', media: 'Soil',        reporter: 'J. Lewis',    emaNotified: false, status: 'Closed',   severity: 'warning' },
  { ref: 'SPI-2026-003', date: '22 Mar 2026', site: 'Galeota Marine Base', substance: 'Diesel (Marine)',      volume: '~5 L',    tier: 'Tier 1', media: 'Water',       reporter: 'R. Khan',     emaNotified: false, status: 'Closed',   severity: 'warning' },
  { ref: 'SPI-2025-044', date: '14 Nov 2025', site: 'Point Lisas Plant',   substance: 'Sodium Hydroxide 50%', volume: '~20 L',   tier: 'Tier 2', media: 'Soil',        reporter: 'S. Chen',     emaNotified: true,  status: 'Closed',   severity: 'warning' },
];

interface WasteRow {
  ref:       string;
  date:      string;
  site:      string;
  wasteType: string;
  volume:    string;
  code:      string;
  carrier:   string;
  disposal:  string;
  manifest:  string;
  status:    string;
}

const mockWaste: WasteRow[] = [
  { ref: 'WST-001', date: '16 Jun 2026', site: 'Point Lisas Plant',   wasteType: 'Used Oil',         volume: '200 L',  code: 'HW-13', carrier: 'WasteAway T&T',    disposal: 'Re-refining',      manifest: 'MAN-2026-088', status: 'Manifested' },
  { ref: 'WST-002', date: '10 Jun 2026', site: 'La Brea Yard',        wasteType: 'Oil-soaked Rags',  volume: '45 kg',  code: 'HW-22', carrier: 'EcoCycle Ltd',     disposal: 'Incineration',     manifest: 'MAN-2026-079', status: 'Manifested' },
  { ref: 'WST-003', date: '05 Jun 2026', site: 'Galeota Marine Base', wasteType: 'Bilge Water',      volume: '1,100 L',code: 'HW-31', carrier: 'Marine Waste T&T', disposal: 'Treatment plant',  manifest: 'MAN-2026-071', status: 'Manifested' },
  { ref: 'WST-004', date: '19 Jun 2026', site: 'Piarco Logistics',    wasteType: 'Battery Acid',     volume: '10 L',   code: 'HW-08', carrier: 'Caribbean Env.',   disposal: 'Neutralisation',   manifest: '',             status: 'Pending'    },
  { ref: 'WST-005', date: '19 Jun 2026', site: 'Point Lisas Plant',   wasteType: 'Chemical Sludge',  volume: '350 kg', code: 'HW-05', carrier: 'WasteAway T&T',    disposal: 'Secure landfill',  manifest: '',             status: 'Pending'    },
];

interface EmaNotification {
  ref:          string;
  date:         string;
  site:         string;
  event:        string;
  tier:         string;
  notifiedWithin: string;
  refNumber:    string;
  status:       string;
  severity:     HseSeverity;
}

const mockEmaNotifications: EmaNotification[] = [
  { ref: 'ENF-001', date: '18 Jun 2026', site: 'Point Lisas Plant',   event: 'Diesel spill to storm drain — SPI-2026-001',         tier: 'Tier 2', notifiedWithin: '8 hours',  refNumber: 'EMA-2026-0418', status: 'Submitted',  severity: 'warning' },
  { ref: 'ENF-002', date: '14 Nov 2025', site: 'Point Lisas Plant',   event: 'Sodium hydroxide spill to soil — SPI-2025-044',      tier: 'Tier 2', notifiedWithin: '6 hours',  refNumber: 'EMA-2025-1889', status: 'Closed',     severity: 'success' },
  { ref: 'ENF-003', date: '22 Mar 2026', site: 'Galeota Marine Base', event: 'Diesel sheen — barge transfer line SPI-2026-003',    tier: 'Tier 1', notifiedWithin: 'N/A',      refNumber: '—',             status: 'Not Required',severity: 'info'   },
];

interface MonitoringRow {
  ref:        string;
  parameter:  string;
  site:       string;
  frequency:  string;
  lastSample: string;
  nextSample: string;
  result:     string;
  limit:      string;
  status:     string;
  severity:   HseSeverity;
}

const mockMonitoring: MonitoringRow[] = [
  { ref: 'MON-001', parameter: 'Trade effluent pH',         site: 'Point Lisas Plant',   frequency: 'Weekly',    lastSample: '16 Jun 2026', nextSample: '23 Jun 2026', result: '7.2',     limit: '6–9',     status: 'Compliant',    severity: 'success' },
  { ref: 'MON-002', parameter: 'Trade effluent oil & grease', site: 'Point Lisas Plant', frequency: 'Weekly',    lastSample: '16 Jun 2026', nextSample: '23 Jun 2026', result: '8 mg/L',  limit: '10 mg/L', status: 'Compliant',    severity: 'success' },
  { ref: 'MON-003', parameter: 'Ambient noise dBA',         site: 'La Brea Yard',        frequency: 'Monthly',   lastSample: '01 Jun 2026', nextSample: '01 Jul 2026', result: '68 dBA',  limit: '70 dBA',  status: 'Compliant',    severity: 'success' },
  { ref: 'MON-004', parameter: 'Air — particulate matter',  site: 'Point Lisas Plant',   frequency: 'Quarterly', lastSample: '01 Apr 2026', nextSample: '01 Jul 2026', result: 'Due',     limit: 'TBD',     status: 'Sample Due',   severity: 'warning' },
  { ref: 'MON-005', parameter: 'Marine water quality',      site: 'Galeota Marine Base', frequency: 'Monthly',   lastSample: '01 Jun 2026', nextSample: '01 Jul 2026', result: 'Pass',    limit: 'EMA std', status: 'Compliant',    severity: 'success' },
  { ref: 'MON-006', parameter: 'Groundwater monitoring',    site: 'La Brea Yard',        frequency: 'Quarterly', lastSample: '15 Jan 2026', nextSample: '15 Jul 2026', result: 'Pending', limit: 'EMA std', status: 'Sample Due',   severity: 'warning' },
];

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'spills',     label: 'Spill Register',    icon: 'fa-droplet' },
  { key: 'waste',      label: 'Waste Manifests',   icon: 'fa-trash-can' },
  { key: 'ema',        label: 'EMA Notifications', icon: 'fa-file-lines' },
  { key: 'monitoring', label: 'Env Monitoring',    icon: 'fa-chart-line' },
];

function SpillsTab(): VNode {
  const wf = useWorkflow();
  const [spills, setSpills]   = useState(mockSpills);
  const [modalOpen, setModal] = useState(false);
  const [newSite, setSite]    = useState<string>(HSE_SITES[0]);
  const [newSubstance, setSubstance] = useState('');
  const [newVolume, setVolume]  = useState('');
  const [newMedia, setMedia]    = useState('Soil');
  const [newDesc, setDesc]      = useState('');

  const open  = spills.filter(s => s.status === 'Open').length;
  const tier2 = spills.filter(s => s.tier === 'Tier 2').length;

  const handleReport = () => {
    const ref = `SPI-2026-${String(spills.length + 1).padStart(3, '0')}`;
    setSpills([{
      ref, date: '19 Jun 2026', site: newSite, substance: newSubstance || 'Unknown substance',
      volume: newVolume || 'TBD', tier: 'Tier 1', media: newMedia,
      reporter: 'S. Chen', emaNotified: false, status: 'Open', severity: 'warning',
    }, ...spills]);
    wf.submit({ templateId: 'incident-investigation', recordRef: ref, reason: `Environmental spill: ${newSubstance} at ${newSite} — ${newDesc || 'See spill register'}` });
    setModal(false);
    setSubstance(''); setVolume(''); setDesc('');
  };

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Spills YTD</span></div><div class="hse-spark-val">{spills.length}</div><div class="hse-spark-sub">All T&T sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Open</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{open}</div><div class="hse-spark-sub">Cleanup and closure pending</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Tier 2 Events</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{tier2}</div><div class="hse-spark-sub">EMA notification required</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">EMA Notified</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{spills.filter(s => s.emaNotified).length}</div><div class="hse-spark-sub">Within 24-hour window</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search spill or substance…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary" onClick={() => setModal(true)}><i class="fas fa-circle-plus" /> Report Spill</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Date</th><th>Site</th><th>Substance</th><th>Volume</th><th>Tier</th><th>Media</th><th>EMA Notified</th><th>Status</th></tr></thead>
                <tbody>
                  {spills.map(s => (
                    <tr key={s.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{s.ref}</span></td>
                      <td class="vt-cell-mono">{s.date}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{s.site}</td>
                      <td style={{ fontSize: '0.76rem' }}>{s.substance}</td>
                      <td class="vt-cell-mono">{s.volume}</td>
                      <td><span class={`vt-pill ${s.tier === 'Tier 2' ? 'is-warn' : 'is-info'}`}>{s.tier}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{s.media}</td>
                      <td>
                        <span class={`vt-pill ${s.emaNotified ? 'is-on' : s.tier === 'Tier 2' ? 'is-off' : 'is-info'}`}>
                          {s.emaNotified ? 'Yes' : s.tier === 'Tier 1' ? 'N/A' : 'Pending'}
                        </span>
                      </td>
                      <td><span class={hsePill(s.status)}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-droplet" /> Active Spill Actions</h4>
          <div class="ppe-signals-list">
            {spills.filter(s => s.status === 'Open').map(s => (
              <div class="ppe-signal" key={s.ref}>
                <i class={`fas fa-droplet ${s.tier === 'Tier 2' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{s.substance}</strong>
                  <span>{s.site} · {s.volume} · {s.media}</span>
                </div>
                <span class={`ppe-signal-tag ${s.tier === 'Tier 2' ? 'is-high' : 'is-due'}`}>{s.tier}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-leaf" /> EMA Spill Tiers</h4>
          <div style={{ display: 'grid', gap: '6px' }}>
            {[
              ['Tier 1', 'Minor spill — contained on site, no EMA notification required'],
              ['Tier 2', 'Significant spill — EMA notification within 24 hours mandatory'],
              ['Tier 3', 'Major incident — immediate EMA + TTFS response required'],
            ].map(([tier, desc]) => (
              <div key={tier} style={{ fontSize: '0.69rem', color: 'rgba(255,255,255,.75)', lineHeight: 1.5 }}>
                <strong style={{ color: tier === 'Tier 1' ? '#4ade80' : tier === 'Tier 2' ? '#fbbf24' : '#f87171' }}>{tier}</strong> — {desc}
              </div>
            ))}
          </div>
        </aside>
      </div>

      <HseModal open={modalOpen} onClose={() => setModal(false)}
        title="Report Environmental Spill" sub="Log a spill event. Tier 2 and above triggers an EMA notification task automatically."
        submitLabel="Report Spill"
        onSubmit={handleReport}>
        <div class="hse-form-grid">
          <Field label="Site"><SelectInput value={newSite} onInput={setSite} options={[...HSE_SITES]} /></Field>
          <Field label="Substance spilled"><TextInput value={newSubstance} onInput={setSubstance} placeholder="e.g. Diesel, Hydraulic Oil" /></Field>
          <Field label="Estimated volume"><TextInput value={newVolume} onInput={setVolume} placeholder="e.g. ~80 L" /></Field>
          <Field label="Environmental media"><SelectInput value={newMedia} onInput={setMedia} options={['Soil', 'Storm drain', 'Water', 'Air', 'Containment bund']} /></Field>
          <Field label="Circumstances" wide><TextareaInput value={newDesc} onInput={setDesc} placeholder="Describe how the spill occurred and immediate actions taken…" /></Field>
        </div>
      </HseModal>
    </div>
  );
}

function WasteTab(): VNode {
  const pending    = mockWaste.filter(w => w.status === 'Pending').length;
  const manifested = mockWaste.filter(w => w.status === 'Manifested').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Waste Records YTD</span></div><div class="hse-spark-val">{mockWaste.length}</div><div class="hse-spark-sub">All hazardous waste movements</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Manifested</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{manifested}</div><div class="hse-spark-sub">Cradle-to-grave evidence</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Pending Manifest</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{pending}</div><div class="hse-spark-sub">Awaiting carrier confirmation</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Hazardous Codes</span></div><div class="hse-spark-val" style={{ fontSize: '0.85rem', color: '#60a5fa' }}>RIC / EMA</div><div class="hse-spark-sub">Regulated Industries Commission</div></div>
      </div>
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search waste type or manifest…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> New Manifest</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Date</th><th>Site</th><th>Waste Type</th><th>Volume</th><th>Code</th><th>Carrier</th><th>Disposal Method</th><th>Manifest #</th><th>Status</th></tr></thead>
                <tbody>
                  {mockWaste.map(w => (
                    <tr key={w.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{w.ref}</span></td>
                      <td class="vt-cell-mono">{w.date}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{w.site}</td>
                      <td style={{ fontSize: '0.76rem' }}>{w.wasteType}</td>
                      <td class="vt-cell-mono">{w.volume}</td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.72rem', color: 'var(--siomac-navy)', fontWeight: 600 }}>{w.code}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{w.carrier}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{w.disposal}</td>
                      <td><span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{w.manifest || '—'}</span></td>
                      <td><span class={hsePill(w.status)}>{w.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-trash-can" /> Pending Manifests</h4>
          <div class="ppe-signals-list">
            {mockWaste.filter(w => w.status === 'Pending').map(w => (
              <div class="ppe-signal" key={w.ref}>
                <i class="fas fa-file-circle-exclamation is-warn" />
                <div class="ppe-signal-text">
                  <strong>{w.wasteType}</strong>
                  <span>{w.site} · {w.volume} · {w.carrier}</span>
                </div>
                <span class="ppe-signal-tag is-due">Pending</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-recycle" /> Hazardous Waste — T&T</h4>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.7)', lineHeight: 1.6 }}>
            All hazardous waste movements require a manifest signed by generator, carrier, and disposal facility. Governed by the RIC and EMA hazardous waste regulations.
          </div>
        </aside>
      </div>
    </div>
  );
}

function EmaTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Notifications YTD</span></div><div class="hse-spark-val">{mockEmaNotifications.length}</div><div class="hse-spark-sub">EMA formal notifications</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Open</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{mockEmaNotifications.filter(n => n.status === 'Submitted').length}</div><div class="hse-spark-sub">Awaiting EMA response</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Closed</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockEmaNotifications.filter(n => n.status === 'Closed').length}</div><div class="hse-spark-sub">EMA case closed</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">24-hr Rule</span></div><div class="hse-spark-val" style={{ fontSize: '0.82rem', color: '#60a5fa' }}>EMA Act S.22</div><div class="hse-spark-sub">Tier 2+ spill notification window</div></div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Date</th><th>Site</th><th>Event</th><th>Tier</th><th>Notified Within</th><th>EMA Ref #</th><th>Status</th></tr></thead>
            <tbody>
              {mockEmaNotifications.map(n => (
                <tr key={n.ref} style={{ cursor: 'pointer' }}>
                  <td><span class="vt-cell-mono">{n.ref}</span></td>
                  <td class="vt-cell-mono">{n.date}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{n.site}</td>
                  <td style={{ fontSize: '0.75rem', maxWidth: '200px' }}>{n.event}</td>
                  <td><span class={`vt-pill ${n.tier === 'Tier 2' ? 'is-warn' : 'is-info'}`}>{n.tier}</span></td>
                  <td style={{ color: 'var(--text-muted)' }}>{n.notifiedWithin}</td>
                  <td><span class="vt-cell-mono" style={{ fontSize: '0.72rem' }}>{n.refNumber}</span></td>
                  <td><span class={hsePill(n.status)}>{n.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function MonitoringTab(): VNode {
  const sampleDue  = mockMonitoring.filter(m => m.status === 'Sample Due').length;
  const compliant  = mockMonitoring.filter(m => m.status === 'Compliant').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Parameters Tracked</span></div><div class="hse-spark-val">{mockMonitoring.length}</div><div class="hse-spark-sub">Across all T&T sites</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Compliant</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{compliant}</div><div class="hse-spark-sub">Within EMA permit limits</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Sample Due</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{sampleDue}</div><div class="hse-spark-sub">Schedule sampling now</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Marine Monitoring</span></div><div class="hse-spark-val" style={{ color: '#60a5fa' }}>Galeota</div><div class="hse-spark-sub">Monthly water quality — EMA std</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search parameter or site…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary"><i class="fas fa-circle-plus" /> Add Parameter</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Parameter</th><th>Site</th><th>Frequency</th><th>Last Sample</th><th>Next Sample</th><th>Result</th><th>Limit</th><th>Status</th></tr></thead>
                <tbody>
                  {mockMonitoring.map(m => (
                    <tr key={m.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{m.ref}</span></td>
                      <td style={{ fontSize: '0.76rem' }}>{m.parameter}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{m.site}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{m.frequency}</td>
                      <td class="vt-cell-mono">{m.lastSample}</td>
                      <td class="vt-cell-mono" style={{ color: m.status === 'Sample Due' ? '#d97706' : 'inherit', fontWeight: m.status === 'Sample Due' ? 600 : 400 }}>{m.nextSample}</td>
                      <td style={{ fontWeight: 500 }}>{m.result}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.74rem' }}>{m.limit}</td>
                      <td><span class={hsePill(m.status)}>{m.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-chart-line" /> Sampling Actions</h4>
          <div class="ppe-signals-list">
            {mockMonitoring.filter(m => m.status !== 'Compliant').map(m => (
              <div class="ppe-signal" key={m.ref}>
                <i class="fas fa-flask is-warn" />
                <div class="ppe-signal-text">
                  <strong>{m.parameter}</strong>
                  <span>{m.site} · Next: {m.nextSample}</span>
                </div>
                <span class="ppe-signal-tag is-due">Due</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-water" /> T&T Environmental Monitoring</h4>
          <div style={{ fontSize: '0.7rem', color: 'rgba(255,255,255,.7)', lineHeight: 1.6 }}>
            EMA trade effluent permits specify monitoring frequency and limits. Galeota marine monitoring aligns with MARPOL Annex I requirements via the SOPEP.
          </div>
        </aside>
      </div>
    </div>
  );
}

// ── Area export ───────────────────────────────────────────────────────────────

export function EnvironmentalArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(tab);

  const openSpills = mockSpills.filter(s => s.status === 'Open').length;
  const pendingWaste = mockWaste.filter(w => w.status === 'Pending').length;

  const stats = [
    { icon: 'fa-droplet',    label: 'Spills YTD',       value: mockSpills.length,    color: 'blue'  },
    { icon: 'fa-trash-can',  label: 'Waste Records',    value: mockWaste.length,     color: 'blue'  },
    { icon: 'fa-file-lines', label: 'EMA Notifications',value: mockEmaNotifications.length, color: 'green' },
    { icon: 'fa-triangle-exclamation', label: 'Open / Pending', value: openSpills + pendingWaste, color: 'gold' },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-leaf"
        areaIcon="fa-earth-americas"
        title="Environmental Management"
        crumb="Environmental Mgmt"
        watermarkClass="hse-wm-environmental"
        context={['Spill register · waste manifests · EMA notifications · env monitoring', 'Trinidad & Tobago Operations']}
        badges={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-leaf', label: 'EMA Act' },
          { icon: 'fa-ship', label: 'SOPEP — Galeota' },
        ]}
        stats={stats}
        metrics={[
          { label: 'Spills this year',          value: String(mockSpills.length) },
          { label: 'Open spill events',          value: String(openSpills) },
          { label: 'Waste manifests pending',    value: String(pendingWaste) },
          { label: 'EMA 24-hr notification',     value: 'Compliant process', highlight: true },
        ]}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />
      {active === 'spills'     && <SpillsTab />}
      {active === 'waste'      && <WasteTab />}
      {active === 'ema'        && <EmaTab />}
      {active === 'monitoring' && <MonitoringTab />}
    </div>
  );
}
