/**
 * src/components/sections/HSE/Contractors.tsx
 *
 * Contractor Management area — register, induction log, HSE files (STOW/insurance/
 * medicals), site access gate with expired-file blocker. T&T context: OSH Act 2004
 * contractor obligations + STOW-style safety passport scheme.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { PageHeader, MetricRow, TabBar, withCounts, SparkCard, HseModal, Field, TextInput, SelectInput, type AreaTab, type SparkDef } from '@ui';
import { HSE_SITES, hsePill, type HseSeverity } from './types';

// ── Mock data ────────────────────────────────────────────────────────────────

interface ContractorRow {
  ref:        string;
  company:    string;
  contact:    string;
  trade:      string;
  site:       string;
  stow:       string;    // STOW cert status
  insurance:  string;
  medicals:   string;
  status:     string;
  severity:   HseSeverity;
}

const mockContractors: ContractorRow[] = [
  { ref: 'CON-001', company: 'Caribbean Civil Works',    contact: 'D. Pierre',    trade: 'Civil / Excavation',     site: 'Point Lisas Plant',   stow: 'Current',  insurance: 'Current',  medicals: 'Current',  status: 'Active',   severity: 'success' },
  { ref: 'CON-002', company: 'TT Industrial Services',   contact: 'M. Ramlal',   trade: 'Mechanical Maintenance',  site: 'La Brea Yard',        stow: 'Expired',  insurance: 'Current',  medicals: 'Due',      status: 'Blocked',  severity: 'danger'  },
  { ref: 'CON-003', company: 'Gulf Marine Contractors',  contact: 'A. Dass',     trade: 'Marine / Offshore',       site: 'Galeota Marine Base', stow: 'Current',  insurance: 'Current',  medicals: 'Current',  status: 'Active',   severity: 'success' },
  { ref: 'CON-004', company: 'Primus Electrical Ltd',    contact: 'R. Seecharan', trade: 'Electrical / LOTO',      site: 'Point Lisas Plant',   stow: 'Current',  insurance: 'Due',      medicals: 'Current',  status: 'Pending',  severity: 'warning' },
  { ref: 'CON-005', company: 'Island Scaffolding Co.',   contact: 'J. Boodoo',   trade: 'Scaffolding / Height',    site: 'Piarco Logistics',    stow: 'Due',      insurance: 'Current',  medicals: 'Due',      status: 'Review',   severity: 'warning' },
  { ref: 'CON-006', company: 'NP Logistics Partners',    contact: 'C. Boodram',  trade: 'Heavy Transport',         site: 'La Brea Yard',        stow: 'Current',  insurance: 'Current',  medicals: 'Current',  status: 'Active',   severity: 'success' },
];

interface InductionRow {
  ref:          string;
  contractorRef: string;
  company:      string;
  worker:       string;
  site:         string;
  date:         string;
  conductor:    string;
  topics:       string;
  status:       string;
}

const mockInductions: InductionRow[] = [
  { ref: 'IND-088', contractorRef: 'CON-001', company: 'Caribbean Civil Works',   worker: 'T. Charles',     site: 'Point Lisas Plant',   date: '18 Jun 2026', conductor: 'A. Mohammed', topics: 'Site rules, PTW, emergency, spill response', status: 'Complete' },
  { ref: 'IND-089', contractorRef: 'CON-003', company: 'Gulf Marine Contractors', worker: 'J. Mark',        site: 'Galeota Marine Base', date: '17 Jun 2026', conductor: 'S. Chen',     topics: 'Marine safety, confined space, MOB drill',  status: 'Complete' },
  { ref: 'IND-090', contractorRef: 'CON-005', company: 'Island Scaffolding Co.',  worker: 'P. Ramkhelawan', site: 'Piarco Logistics',    date: '16 Jun 2026', conductor: 'A. Mohammed', topics: 'Work at height, harness, TBT',               status: 'Overdue'  },
  { ref: 'IND-091', contractorRef: 'CON-004', company: 'Primus Electrical Ltd',   worker: 'S. Maharaj',     site: 'Point Lisas Plant',   date: '20 Jun 2026', conductor: 'S. Chen',     topics: 'LOTO, electrical isolation, PTW',            status: 'Scheduled' },
];

interface HseFileRow {
  ref:          string;
  contractorRef: string;
  company:      string;
  docType:      string;
  expiry:       string;
  status:       string;
  severity:     HseSeverity;
}

const mockHseFiles: HseFileRow[] = [
  { ref: 'FILE-001', contractorRef: 'CON-001', company: 'Caribbean Civil Works',   docType: 'STOW Certificate',     expiry: '30 Nov 2026', status: 'Current',  severity: 'success' },
  { ref: 'FILE-002', contractorRef: 'CON-001', company: 'Caribbean Civil Works',   docType: 'Liability Insurance',  expiry: '31 Dec 2026', status: 'Current',  severity: 'success' },
  { ref: 'FILE-003', contractorRef: 'CON-002', company: 'TT Industrial Services',  docType: 'STOW Certificate',     expiry: '01 Jan 2026', status: 'Expired',  severity: 'danger'  },
  { ref: 'FILE-004', contractorRef: 'CON-002', company: 'TT Industrial Services',  docType: 'Medical Certificates', expiry: '15 Jul 2026', status: 'Due',      severity: 'warning' },
  { ref: 'FILE-005', contractorRef: 'CON-003', company: 'Gulf Marine Contractors', docType: 'STOW Certificate',     expiry: '15 Feb 2027', status: 'Current',  severity: 'success' },
  { ref: 'FILE-006', contractorRef: 'CON-004', company: 'Primus Electrical Ltd',   docType: 'Liability Insurance',  expiry: '30 Jun 2026', status: 'Due',      severity: 'warning' },
];

interface AccessRow {
  ref:     string;
  company: string;
  worker:  string;
  site:    string;
  date:    string;
  gate:    string;
  allowed: boolean;
}

const mockAccess: AccessRow[] = [
  { ref: 'ACC-101', company: 'Caribbean Civil Works',   worker: 'T. Charles',  site: 'Point Lisas Plant',   date: '19 Jun 2026', gate: 'All files current',        allowed: true  },
  { ref: 'ACC-102', company: 'TT Industrial Services',  worker: 'B. Singh',    site: 'La Brea Yard',        date: '19 Jun 2026', gate: 'STOW expired — access denied', allowed: false },
  { ref: 'ACC-103', company: 'Gulf Marine Contractors', worker: 'J. Mark',     site: 'Galeota Marine Base', date: '19 Jun 2026', gate: 'All files current',        allowed: true  },
  { ref: 'ACC-104', company: 'Island Scaffolding Co.',  worker: 'P. Ramkhelawan', site: 'Piarco Logistics', date: '19 Jun 2026', gate: 'STOW due — supervisor must approve', allowed: false },
];

const TRADES = ['Civil / Excavation', 'Mechanical Maintenance', 'Marine / Offshore', 'Electrical / LOTO', 'Scaffolding / Height', 'Heavy Transport', 'Painting / Coating', 'Instrumentation'] as const;

// ── Tabs ──────────────────────────────────────────────────────────────────────

const TABS: AreaTab[] = [
  { key: 'register',  label: 'Contractor Register', icon: 'fa-clipboard-list' },
  { key: 'induction', label: 'Induction Log',       icon: 'fa-person-chalkboard' },
  { key: 'files',     label: 'HSE Files',           icon: 'fa-folder-open' },
  { key: 'access',    label: 'Site Access',         icon: 'fa-door-open' },
];

function RegisterTab(): VNode {
  const [contractors, setContractors] = useState(mockContractors);
  const [modalOpen, setModal]   = useState(false);
  const [newCompany, setCompany] = useState('');
  const [newContact, setContact] = useState('');
  const [newTrade, setTrade]    = useState<string>(TRADES[0]);
  const [newSite, setSite]      = useState<string>(HSE_SITES[0]);

  const blocked  = contractors.filter(c => c.status === 'Blocked').length;
  const pending  = contractors.filter(c => c.status === 'Pending' || c.status === 'Review').length;
  const active   = contractors.filter(c => c.status === 'Active').length;

  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Contractors</span></div><div class="hse-spark-val">{contractors.length}</div><div class="hse-spark-sub">Registered with HSE file</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Active</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{active}</div><div class="hse-spark-sub">All files current</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Pending Review</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{pending}</div><div class="hse-spark-sub">Document action required</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Blocked</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{blocked}</div><div class="hse-spark-sub">Expired file — site access denied</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search company, trade, or site…" /></div>
            <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
            <button class="hse-btn primary" onClick={() => setModal(true)}><i class="fas fa-circle-plus" /> Register Contractor</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Company</th><th>Contact</th><th>Trade</th><th>Site</th><th>STOW</th><th>Insurance</th><th>Medicals</th><th>Status</th></tr></thead>
                <tbody>
                  {contractors.map(c => (
                    <tr key={c.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{c.ref}</span></td>
                      <td><span class="vt-cell-name">{c.company}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{c.contact}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{c.trade}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{c.site}</td>
                      <td><span class={hsePill(c.stow)}>{c.stow}</span></td>
                      <td><span class={hsePill(c.insurance)}>{c.insurance}</span></td>
                      <td><span class={hsePill(c.medicals)}>{c.medicals}</span></td>
                      <td><span class={hsePill(c.status)}>{c.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-triangle-exclamation" /> File Blockers</h4>
          <div class="ppe-signals-list">
            {contractors.filter(c => c.status !== 'Active').map(c => (
              <div class="ppe-signal" key={c.ref}>
                <i class={`fas fa-id-card-clip ${c.status === 'Blocked' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{c.company}</strong>
                  <span>{c.site} · {c.stow !== 'Current' ? `STOW ${c.stow}` : c.insurance !== 'Current' ? `Insurance ${c.insurance}` : `Medicals ${c.medicals}`}</span>
                </div>
                <span class={`ppe-signal-tag ${c.status === 'Blocked' ? 'is-high' : 'is-due'}`}>{c.status}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-circle-info" /> T&T Requirements</h4>
          <div style={{ fontSize: '0.72rem', color: 'rgba(255,255,255,.65)', lineHeight: 1.6, display: 'grid', gap: '6px' }}>
            <div><strong style={{ color: 'rgba(255,255,255,.9)' }}>STOW</strong> — Safety Training Observation Worksite passport required for all site workers.</div>
            <div><strong style={{ color: 'rgba(255,255,255,.9)' }}>OSH Act 2004</strong> — Contractors share employer duty of care for on-site workers.</div>
            <div><strong style={{ color: 'rgba(255,255,255,.9)' }}>Insurance</strong> — Liability & Workers' Compensation must be current before any task.</div>
          </div>
        </aside>
      </div>

      <HseModal open={modalOpen} onClose={() => setModal(false)}
        title="Register Contractor" sub="Add a company to the approved contractor register. All HSE files must be uploaded before site access is granted."
        submitLabel="Register"
        onSubmit={() => {
          const ref = `CON-${String(contractors.length + 1).padStart(3, '0')}`;
          setContractors([{ ref, company: newCompany || 'New Contractor', contact: newContact || '—', trade: newTrade, site: newSite, stow: 'Pending', insurance: 'Pending', medicals: 'Pending', status: 'Pending', severity: 'warning' }, ...contractors]);
          setModal(false); setCompany(''); setContact('');
        }}>
        <div class="hse-form-grid">
          <Field label="Company name"><TextInput value={newCompany} onInput={setCompany} placeholder="e.g. Caribbean Civil Works Ltd" /></Field>
          <Field label="HSE contact"><TextInput value={newContact} onInput={setContact} placeholder="Full name of HSE representative" /></Field>
          <Field label="Trade / scope"><SelectInput value={newTrade} onInput={setTrade} options={[...TRADES]} /></Field>
          <Field label="Primary site"><SelectInput value={newSite} onInput={setSite} options={[...HSE_SITES]} /></Field>
        </div>
      </HseModal>
    </div>
  );
}

function InductionTab(): VNode {
  const overdue   = mockInductions.filter(i => i.status === 'Overdue').length;
  const complete  = mockInductions.filter(i => i.status === 'Complete').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Inductions</span></div><div class="hse-spark-val">{mockInductions.length}</div><div class="hse-spark-sub">All contractor workers</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Completed</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{complete}</div><div class="hse-spark-sub">Induction record on file</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Overdue</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{overdue}</div><div class="hse-spark-sub">Worker on site without induction</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Scheduled</span></div><div class="hse-spark-val" style={{ color: '#60a5fa' }}>{mockInductions.filter(i => i.status === 'Scheduled').length}</div><div class="hse-spark-sub">Booked with HSE Officer</div></div>
      </div>
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search worker or company…" /></div>
        <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
        <button class="hse-btn primary"><i class="fas fa-circle-plus" /> Log Induction</button>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Company</th><th>Worker</th><th>Site</th><th>Date</th><th>Conductor</th><th>Topics</th><th>Status</th></tr></thead>
            <tbody>
              {mockInductions.map(i => (
                <tr key={i.ref}>
                  <td><span class="vt-cell-mono">{i.ref}</span></td>
                  <td><span class="vt-cell-name">{i.company}</span></td>
                  <td>{i.worker}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{i.site}</td>
                  <td class="vt-cell-mono">{i.date}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{i.conductor}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.73rem', maxWidth: '200px' }}>{i.topics}</td>
                  <td><span class={hsePill(i.status)}>{i.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function FilesTab(): VNode {
  const expired = mockHseFiles.filter(f => f.status === 'Expired').length;
  const due     = mockHseFiles.filter(f => f.status === 'Due').length;
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Documents</span></div><div class="hse-spark-val">{mockHseFiles.length}</div><div class="hse-spark-sub">Across all contractors</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Expired</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{expired}</div><div class="hse-spark-sub">Contractor site access blocked</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Due Soon</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{due}</div><div class="hse-spark-sub">Action required within 30 days</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Current</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockHseFiles.filter(f => f.status === 'Current').length}</div><div class="hse-spark-sub">Files in good standing</div></div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}><i class="fas fa-search" /><input type="search" placeholder="Search company or document type…" /></div>
            <button class="hse-btn primary"><i class="fas fa-file-arrow-up" /> Upload Document</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Company</th><th>Document Type</th><th>Expiry</th><th>Status</th></tr></thead>
                <tbody>
                  {mockHseFiles.map(f => (
                    <tr key={f.ref}>
                      <td><span class="vt-cell-mono">{f.ref}</span></td>
                      <td><span class="vt-cell-name">{f.company}</span></td>
                      <td>{f.docType}</td>
                      <td class="vt-cell-mono" style={{ color: f.status === 'Expired' ? 'var(--siomac-red)' : f.status === 'Due' ? '#d97706' : 'inherit', fontWeight: f.status !== 'Current' ? 600 : 400 }}>{f.expiry}</td>
                      <td><span class={hsePill(f.status)}>{f.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-circle-exclamation" /> Urgent File Actions</h4>
          <div class="ppe-signals-list">
            {mockHseFiles.filter(f => f.status !== 'Current').map(f => (
              <div class="ppe-signal" key={f.ref}>
                <i class={`fas fa-file-circle-exclamation ${f.status === 'Expired' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{f.company}</strong>
                  <span>{f.docType} · Expires {f.expiry}</span>
                </div>
                <span class={`ppe-signal-tag ${f.status === 'Expired' ? 'is-high' : 'is-due'}`}>{f.status}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-folder-open" /> Required File Types</h4>
          <div style={{ display: 'grid', gap: '6px' }}>
            {['STOW Certificate', 'Liability Insurance', 'Workers\' Compensation', 'Medical Certificates', 'HSE Plan / Method Statement'].map(doc => (
              <div key={doc} style={{ display: 'flex', gap: '8px', alignItems: 'center', fontSize: '0.7rem', color: 'rgba(255,255,255,.7)' }}>
                <i class="fas fa-file-check" style={{ color: '#4ade80', fontSize: '0.65rem', flexShrink: 0 }} />{doc}
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function AccessTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <div class="hse-spark-row">
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Access Attempts Today</span></div><div class="hse-spark-val">{mockAccess.length}</div><div class="hse-spark-sub">Gate checks logged</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Granted</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockAccess.filter(a => a.allowed).length}</div><div class="hse-spark-sub">All HSE files verified</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Denied</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{mockAccess.filter(a => !a.allowed).length}</div><div class="hse-spark-sub">Expired or missing file</div></div>
        <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Gate Rule</span></div><div class="hse-spark-val" style={{ fontSize: '0.78rem', color: '#60a5fa' }}>Auto-block</div><div class="hse-spark-sub">Expired STOW/insurance = deny</div></div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Company</th><th>Worker</th><th>Site</th><th>Date</th><th>Gate Check Result</th><th>Access</th></tr></thead>
            <tbody>
              {mockAccess.map(a => (
                <tr key={a.ref}>
                  <td><span class="vt-cell-mono">{a.ref}</span></td>
                  <td><span class="vt-cell-name">{a.company}</span></td>
                  <td>{a.worker}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{a.site}</td>
                  <td class="vt-cell-mono">{a.date}</td>
                  <td style={{ color: a.allowed ? 'var(--text-muted)' : 'var(--siomac-red)', fontSize: '0.76rem' }}>{a.gate}</td>
                  <td>
                    <span class={`vt-pill ${a.allowed ? 'is-on' : 'is-off'}`}>
                      <i class={`fas ${a.allowed ? 'fa-check' : 'fa-xmark'}`} style={{ marginRight: '4px' }} />
                      {a.allowed ? 'Granted' : 'Denied'}
                    </span>
                  </td>
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

export function ContractorsArea({ tab }: { tab: string }): VNode {
  const [active, setActive] = useState(tab);

  const blocked    = mockContractors.filter(c => c.status === 'Blocked').length;
  const fileIssues = mockHseFiles.filter(f => f.status !== 'Current').length;
  const activeCount = mockContractors.filter(c => c.status === 'Active').length;

  const sparks: SparkDef[] = [
    {
      label: 'Contractors', value: String(mockContractors.length), sub: 'Registered with HSE file',
      delta: `${activeCount} active`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, mockContractors.length], sparkColor: '#60a5fa',
    },
    {
      label: 'Files Current', value: String(activeCount), sub: 'All compliance files clear',
      delta: 'STOW + insurance + medicals', deltaUp: false, color: '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, activeCount], sparkColor: '#4ade80',
    },
    {
      label: 'File Issues', value: String(fileIssues), sub: 'Expired or due for renewal',
      delta: fileIssues > 0 ? 'Action required' : 'All clear', deltaUp: fileIssues > 0, color: fileIssues > 0 ? '#f59e0b' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, fileIssues], sparkColor: '#f59e0b',
    },
    {
      label: 'Access Blocked', value: String(blocked), sub: 'Denied — expired file',
      delta: blocked > 0 ? 'Action required' : 'All clear', deltaUp: blocked > 0, color: blocked > 0 ? '#ef4444' : '#4ade80',
      sparkPoints: [0, 0, 0, 0, 0, blocked], sparkColor: '#ef4444',
    },
  ];

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-id-card-clip"
        module="HSE"
        title="Contractor Management"
        sub="STOW induction, HSE file register, and site access gate control for all contracted companies."
      />

      <MetricRow pageKey="hse.contractors" cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))} />

      <TabBar tabs={withCounts(TABS, { register: mockContractors.length })} active={active} onSelect={setActive} />
      {active === 'register'  && <RegisterTab />}
      {active === 'induction' && <InductionTab />}
      {active === 'files'     && <FilesTab />}
      {active === 'access'    && <AccessTab />}
    </div>
  );
}
