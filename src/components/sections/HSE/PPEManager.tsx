/**
 * src/components/sections/HSE/PPEManager.tsx
 *
 * PPE Manager tab bodies. Each PPE area is a small presentational function;
 * the active one is chosen by the section id (the sidebar drives navigation, so
 * there is no in-page sub-nav). UI-only: data from types.ts.
 *
 * Exports PPE_TAB_BODIES (tab key → component) + PpeBody (hero + active tab),
 * consumed by PpeShell.tsx which maps the active section id to a tab.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { StatCard } from '../Employees/StatCard';
import { useMyWorkflowTasks } from '@api/workflows';
import { HseModal, Field, SelectInput, TextInput, TextareaInput } from '@ui';
import {
  mockPpeItems, mockPpeEmployees, mockRoleMatrix, PPE_MATRIX_COLUMNS, ppePillClass,
  mockPpeAssignments, mockPpeRenewals, mockPpeReturns, mockPpeRequests, mockPpeKits,
  type PpeAssignment, type PpeRequestRow,
  HSE_SITES,
} from './types';

type PpeTab =
  | 'dashboard' | 'inventory' | 'assign' | 'employees' | 'renewals' | 'returns'
  | 'requests' | 'inspections' | 'fitTesting' | 'procurement' | 'kits' | 'matrix'
  | 'reports' | 'settings';

// ── Shared presentational helpers ─────────────────────────────────────────────

function SectionHead({ icon, title, sub, actions }: {
  icon: string; title: string; sub: string; actions?: VNode;
}): VNode {
  return (
    <div class="ppe-section-head">
      <div class="ppe-section-title">
        <span class="ppe-title-icon"><i class={`fas ${icon}`} /></span>
        <div><h3>{title}</h3><p>{sub}</p></div>
      </div>
      {actions && <div class="ppe-section-actions">{actions}</div>}
    </div>
  );
}

function MiniCard({ icon, value, label }: { icon: string; value: string; label: string }): VNode {
  return (
    <div class="ppe-mini-card">
      <i class={`fas ${icon}`} />
      <strong>{value}</strong>
      <span>{label}</span>
    </div>
  );
}

function Record({ icon, title, sub, pill, pillClass }: {
  icon: string; title: string; sub: string; pill: string; pillClass?: string;
}): VNode {
  return (
    <div class="ppe-record">
      <i class={`fas ${icon}`} />
      <div><strong>{title}</strong><span>{sub}</span></div>
      <span class={pillClass ?? 'vt-pill is-info'}>{pill}</span>
    </div>
  );
}

// ── Tabs ──────────────────────────────────────────────────────────────────────

function DashboardTab(): VNode {
  const assignments = mockPpeAssignments;
  const required = (role: string) => mockRoleMatrix.find(r => r.role === role)?.required ?? [];

  return (
    <div class="ppe-tab-content">
      <div class="hse-kpi-row">
        <StatCard icon="fa-shield-halved" label="Compliance"     value={94}                                        color="#16a34a" />
        <StatCard icon="fa-list-check"    label="Active Assigns"  value={assignments.filter(a => a.status === 'active').length} color="#2563eb" />
        <StatCard icon="fa-clock"         label="Due / Overdue"   value={assignments.filter(a => a.status !== 'active').length}  color="#d97706" />
        <StatCard icon="fa-box-open"      label="Critical Stock"  value={mockPpeItems.filter(i => i.status === 'low' || i.stock === 0).length} color="#dc2626" />
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-list-check" /></span>
            <div>
              <div class="vt-section-title">Compliance Overview</div>
              <div class="vt-section-sub">Required vs. assigned PPE per employee, with compliance status.</div>
            </div>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Employee</th><th>Role</th><th>Site</th><th>Required Items</th><th>Assigned</th><th>Missing</th><th>Status</th></tr></thead>
                <tbody>
                  {mockPpeEmployees.map(emp => {
                    const req   = required(emp.role);
                    const asnd  = assignments.filter(a => a.empId === emp.id).map(a => a.ppeType);
                    const miss  = req.filter(r => !asnd.some(a => a.toLowerCase().includes(r.toLowerCase())));
                    const compliant = miss.length === 0;
                    return (
                      <tr key={emp.id}>
                        <td><span class="vt-cell-name">{emp.name}</span></td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{emp.role}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{emp.site}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{req.join(', ') || '—'}</td>
                        <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{asnd.length ? asnd.join(', ') : '—'}</td>
                        <td style={{ color: miss.length ? 'var(--siomac-red)' : 'var(--text-muted)', fontSize: '0.75rem' }}>{miss.length ? miss.join(', ') : 'None'}</td>
                        <td><span class={ppePillClass(compliant ? 'compliant' : 'missing')}>{compliant ? 'Compliant' : 'Missing PPE'}</span></td>
                      </tr>
                    );
                  })}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-satellite-dish" /> Live Control Signals</h4>
          <div class="ppe-signals-list">
            {mockPpeAssignments.filter(a => a.status !== 'active').map(a => (
              <div class="ppe-signal" key={a.id}>
                <i class={`fas fa-helmet-safety ${a.status === 'expired' ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{a.empName}</strong>
                  <span>{a.item} · {a.status === 'expired' ? 'Expired' : 'Due for renewal'}</span>
                </div>
                <span class={`ppe-signal-tag ${a.status === 'expired' ? 'is-high' : 'is-due'}`}>{a.status === 'expired' ? 'Expired' : 'Due'}</span>
              </div>
            ))}
            <div class="ppe-signal">
              <i class="fas fa-warehouse is-info" />
              <div class="ppe-signal-text">
                <strong>Stock alert</strong>
                <span>{mockPpeItems.filter(i => i.status === 'low' || i.stock === 0).length} items below reorder threshold.</span>
              </div>
              <span class="ppe-signal-tag is-stock">Stock</span>
            </div>
          </div>
        </aside>
      </div>
    </div>
  );
}

function InventoryTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-boxes-stacked" title="Controlled PPE Inventory"
        sub="Manage stocked items, thresholds, serial/lot control, expiry, quarantine, and warehouse location."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-barcode" /> Scan</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-plus" /> Add PPE</button></>} />
      <div class="ppe-insight-strip">
        <div class="ppe-insight"><i class="fas fa-box-open" /><div><span>Stock Policy</span><strong>Min/max thresholds</strong></div></div>
        <div class="ppe-insight"><i class="fas fa-fingerprint" /><div><span>Traceability</span><strong>Serial and lot ready</strong></div></div>
        <div class="ppe-insight"><i class="fas fa-ban" /><div><span>Quarantine</span><strong>Damaged item control</strong></div></div>
        <div class="ppe-insight"><i class="fas fa-calendar-xmark" /><div><span>Expiry</span><strong>Auto renewal feed</strong></div></div>
      </div>
      <div class="vt-toolbar">
        <div class="vt-search" style={{ flex: '1 1 260px' }}><i class="fas fa-search" /><input type="search" placeholder="Search item, brand, or model…" /></div>
        <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Item</th><th>Type</th><th>Brand/Model</th><th>Stock</th><th>Location</th><th>Threshold</th><th>Status</th></tr></thead>
            <tbody>
              {mockPpeItems.map(p => (
                <tr key={p.id}>
                  <td><span class="vt-cell-name">{p.name}</span></td>
                  <td>{p.type}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.brand}</td>
                  <td class="vt-cell-mono">{p.stock}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{p.location}</td>
                  <td class="vt-cell-mono">{p.threshold}</td>
                  <td><span class={ppePillClass(p.status)} style={{ textTransform: 'capitalize' }}>{p.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

const PPE_ZONES: [string, number, number][] = [
  ['Helmet',    8,  50],
  ['Glasses',  18,  36],
  ['Hi-vis vest', 44, 50],
  ['Harness',  56,  52],
  ['Gloves',   12,  14],
  ['Coveralls',52,  30],
  ['Boots',    88,  48],
];

function AssignTab(): VNode {
  const [selectedZones, setZones] = useState<Set<string>>(new Set());
  const [empId, setEmpId]         = useState<number>(mockPpeEmployees[0]?.id ?? 1);
  const [issueDate, setIssueDate] = useState('2026-06-19');
  const [renewal, setRenewal]     = useState('Auto renew after 12 months');
  const [notes, setNotes]         = useState('');
  const [assignments, setAssignments] = useState<PpeAssignment[]>(mockPpeAssignments);
  const [success, setSuccess]     = useState(false);

  const toggleZone = (label: string) => {
    setZones(prev => {
      const next = new Set(prev);
      if (next.has(label)) next.delete(label); else next.add(label);
      return next;
    });
  };

  const emp = mockPpeEmployees.find(e => e.id === empId)!;

  const handleAssign = () => {
    if (!selectedZones.size) return;
    const newItems: PpeAssignment[] = Array.from(selectedZones).map((z, i) => ({
      id:      `ASN-${100 + assignments.length + i}`,
      empId:   emp.id,
      empName: emp.name,
      ppeType: z,
      item:    z,
      issued:  issueDate,
      expiry:  '19 Jun 2027',
      status:  'active',
    }));
    setAssignments(prev => [...prev, ...newItems]);
    setZones(new Set());
    setNotes('');
    setSuccess(true);
    setTimeout(() => setSuccess(false), 3000);
  };

  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-user-plus" title="Visual PPE Assignment"
        sub="Select PPE on the worker diagram, then assign it to an employee with date, notes, acknowledgement, and renewal tracking."
        actions={<>
          <button class="btn btn-outline-secondary btn-sm has-label" onClick={() => { const req = mockRoleMatrix.find(r => r.role === emp.role)?.required ?? []; setZones(new Set(req)); }}><i class="fas fa-wand-magic-sparkles" /> Load Role Kit</button>
          <button class="btn btn-danger-primary btn-sm" disabled={!selectedZones.size} onClick={handleAssign}><i class="fas fa-check" /> Assign Selected{selectedZones.size ? ` (${selectedZones.size})` : ''}</button>
        </>} />
      {success && <div style={{ background: 'rgba(34,197,94,.12)', border: '1px solid #4ade80', borderRadius: '8px', padding: '10px 16px', marginBottom: '14px', color: '#4ade80', fontSize: '0.82rem' }}><i class="fas fa-circle-check" style={{ marginRight: '8px' }} />PPE assigned to {emp.name} — {mockRoleMatrix.find(r => r.role === emp.role)?.required.length ?? 0} items recorded.</div>}
      <div class="ppe-assign-layout">
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-person" /> Interactive Worker Picker</h4><span class="ppe-panel-tag">Click zones to select</span></div>
          <div class="ppe-panel-body">
            <div class="ppe-worker-map">
              <span class="ppe-map-title">Trace PPE Zones</span>
              {PPE_ZONES.map(([label, top, left]) => (
                <button
                  type="button"
                  class={`ppe-zone${selectedZones.has(label) ? ' is-selected' : ''}`}
                  style={{ top: `${top}%`, left: `${left}%` }}
                  key={label}
                  onClick={() => toggleZone(label)}
                >{label}</button>
              ))}
            </div>
            <div class="ppe-selected-strip">
              {selectedZones.size
                ? <span style={{ color: 'var(--siomac-navy)', fontWeight: 600, fontSize: '0.8rem' }}>Selected: {Array.from(selectedZones).join(', ')}</span>
                : <span class="text-muted">Click PPE zones on the diagram to select them.</span>}
            </div>
          </div>
        </article>
        <div class="ppe-assign-side">
          <article class="ppe-panel">
            <div class="ppe-panel-head"><h4><i class="fas fa-clipboard-check" /> Issue Record</h4></div>
            <div class="ppe-panel-body ppe-form-grid">
              <div class="form-group">
                <label>Employee</label>
                <select value={empId} onChange={(e) => setEmpId(Number((e.target as HTMLSelectElement).value))}>
                  {mockPpeEmployees.map(e => <option key={e.id} value={e.id}>{e.name} ({e.role})</option>)}
                </select>
              </div>
              <div class="form-group"><label>Issue Date</label><input type="date" value={issueDate} onInput={(e) => setIssueDate((e.target as HTMLInputElement).value)} /></div>
              <div class="form-group"><label>Renewal Rule</label><select value={renewal} onChange={(e) => setRenewal((e.target as HTMLSelectElement).value)}><option>Auto renew after 12 months</option><option>Inspect after 6 months</option><option>One-time issue</option></select></div>
              <div class="form-group"><label>Cost Center</label><select><option>HSE Operations</option><option>Maintenance</option><option>Construction</option></select></div>
              <div class="form-group" style={{ gridColumn: '1 / -1' }}><label>Issue Notes</label><textarea rows={3} value={notes} onInput={(e) => setNotes((e.target as HTMLTextAreaElement).value)} placeholder="Condition, serials, hazard task, training evidence…" /></div>
            </div>
          </article>
          <aside class="ppe-panel">
            <div class="ppe-panel-head"><h4><i class="fas fa-user-shield" /> Recent Assignments</h4></div>
            <div class="ppe-panel-body">
              <div class="ppe-record-list">
                {assignments.slice(-4).reverse().map(a => (
                  <div class="ppe-record" key={a.id}>
                    <i class="fas fa-helmet-safety" />
                    <div><strong>{a.empName}</strong><span>{a.item} · Issued {a.issued}</span></div>
                    <span class={`vt-pill ${a.status === 'active' ? 'is-on' : a.status === 'due' ? 'is-warn' : 'is-off'}`}>{a.status}</span>
                  </div>
                ))}
              </div>
            </div>
          </aside>
        </div>
      </div>
    </div>
  );
}

function EmployeesTab(): VNode {
  const required = (role: string) => mockRoleMatrix.find(r => r.role === role)?.required ?? [];
  const assigned = (id: number) => mockPpeAssignments.filter(a => a.empId === id).map(a => a.ppeType);
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-users" title="Employee PPE Profiles"
        sub="Track role, department, site, assigned PPE, missing PPE, supervisor ownership, and compliance readiness."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-id-badge" /> Import HR</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-user-plus" /> Add Employee</button></>} />
      <div class="vt-toolbar"><div class="vt-search" style={{ flex: '1 1 260px' }}><i class="fas fa-search" /><input type="search" placeholder="Search employee, role, or site…" /></div>
        <select class="emp-filter-select"><option>All sites</option>{HSE_SITES.map(s => <option key={s}>{s}</option>)}</select>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Name</th><th>Role</th><th>Site</th><th>Assigned PPE</th><th>Missing PPE</th><th>Status</th></tr></thead>
            <tbody>
              {mockPpeEmployees.map(emp => {
                const req  = required(emp.role);
                const asnd = assigned(emp.id);
                const miss = req.filter(r => !asnd.some(a => a.toLowerCase().includes(r.toLowerCase())));
                return (
                  <tr key={emp.id}>
                    <td><span class="vt-cell-name">{emp.name}</span></td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{emp.role}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{emp.site}</td>
                    <td style={{ color: 'var(--text-muted)', fontSize: '0.75rem' }}>{asnd.length ? asnd.join(', ') : '—'}</td>
                    <td style={{ color: miss.length ? 'var(--siomac-red)' : 'var(--text-muted)', fontSize: '0.75rem' }}>{miss.length ? miss.join(', ') : 'None'}</td>
                    <td><span class={ppePillClass(miss.length ? 'missing' : 'compliant')}>{miss.length ? 'Missing PPE' : 'Compliant'}</span></td>
                  </tr>
                );
              })}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RenewalsTab(): VNode {
  const overdue  = mockPpeRenewals.filter(r => r.status === 'overdue').length;
  const upcoming = mockPpeRenewals.filter(r => r.status === 'upcoming').length;
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-clock-rotate-left" title="Renewal Automation"
        sub="Review overdue and upcoming PPE replacement cycles with automatic task generation and stock reservation."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-envelope" /> Send Reminders</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-sync" /> Auto-Renew</button></>} />
      <div style={{ marginBottom: '14px' }}>
        <div class="hse-spark-row">
          <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Total Tracked</span></div><div class="hse-spark-val">{mockPpeRenewals.length}</div><div class="hse-spark-sub">PPE renewal records</div></div>
          <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Overdue</span></div><div class="hse-spark-val" style={{ color: '#ef4444' }}>{overdue}</div><div class="hse-spark-sub">Immediate action required</div></div>
          <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Due Soon</span></div><div class="hse-spark-val" style={{ color: '#f59e0b' }}>{upcoming}</div><div class="hse-spark-sub">Within 90 days</div></div>
          <div class="hse-spark"><div class="hse-spark-header"><span class="hse-spark-label">Current</span></div><div class="hse-spark-val" style={{ color: '#22c55e' }}>{mockPpeRenewals.filter(r => r.status === 'active').length}</div><div class="hse-spark-sub">No action needed</div></div>
        </div>
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Employee</th><th>Site</th><th>Item</th><th>Issue Date</th><th>Expiry Date</th><th>Status</th></tr></thead>
            <tbody>
              {mockPpeRenewals.map(r => (
                <tr key={r.ref}>
                  <td><span class="vt-cell-mono">{r.ref}</span></td>
                  <td><span class="vt-cell-name">{r.empName}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{r.site}</td>
                  <td>{r.item}</td>
                  <td class="vt-cell-mono">{r.issued}</td>
                  <td class="vt-cell-mono" style={{ color: r.status === 'overdue' ? 'var(--siomac-red)' : r.status === 'upcoming' ? '#d97706' : 'inherit', fontWeight: r.status !== 'active' ? 600 : 400 }}>{r.expiry}</td>
                  <td><span class={ppePillClass(r.status)} style={{ textTransform: 'capitalize' }}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReturnsTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-rotate-left" title="Returns, Disposal & Quarantine"
        sub="Record returned PPE condition, disposition, reuse eligibility, quarantine decision, and handover evidence."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-camera" /> Evidence Photos</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-rotate-left" /> New Return</button></>} />
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Ref</th><th>Item</th><th>Employee</th><th>Site</th><th>Return Date</th><th>Condition</th><th>Disposition</th><th>Status</th></tr></thead>
            <tbody>
              {mockPpeReturns.map(r => (
                <tr key={r.ref}>
                  <td><span class="vt-cell-mono">{r.ref}</span></td>
                  <td><span class="vt-cell-name">{r.item}</span></td>
                  <td>{r.empName}</td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{r.site}</td>
                  <td class="vt-cell-mono">{r.returnDate}</td>
                  <td>{r.condition}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.disposition}</td>
                  <td><span class={ppePillClass(r.status)} style={{ textTransform: 'capitalize' }}>{r.status}</span></td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RequestsTab(): VNode {
  const tasksQ = useMyWorkflowTasks();
  const [requests, setRequests] = useState<PpeRequestRow[]>(mockPpeRequests);
  const [modalOpen, setModal]   = useState(false);
  const [reqType, setReqType]   = useState('New Issue');
  const [reqItem, setReqItem]   = useState('');
  const [reqEmp, setReqEmp]     = useState(mockPpeEmployees[0]?.name ?? '');
  const [reqSite, setReqSite]   = useState<string>(HSE_SITES[0]);
  const [reqReason, setReason]  = useState('');

  const open   = requests.filter(r => r.status !== 'closed').length;
  const urgent = requests.filter(r => r.priority === 'urgent').length;
  const ready  = requests.filter(r => r.priority === 'ready').length;

  const handleSubmit = () => {
    const ref = `REQ-${1060 + requests.length}`;
    const row: PpeRequestRow = {
      ref, type: reqType, item: reqItem || 'PPE Item', empName: reqEmp,
      site: reqSite, reason: reqReason, submitted: '19 Jun 2026',
      status: 'Pending', priority: 'pending',
    };
    setRequests(prev => [row, ...prev]);
    // PPE-request approval will start from a backend ppe.requested event (via a
    // workflow binding) when the PPE module is wired to the API.
    setModal(false);
    setReqItem(''); setReason('');
  };

  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-clipboard-list" title="PPE Request Management"
        sub="Manage new issue, replacement, lost, damaged, role kit, and urgent safety-critical requests."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-filter" /> My Queue</button><button class="btn btn-danger-primary btn-sm" onClick={() => setModal(true)}><i class="fas fa-plus" /> New Request</button></>} />
      <div class="ppe-four-col">
        <MiniCard icon="fa-clipboard-list" value={String(open)}   label="Open requests for new issue, replacement, or lost PPE." />
        <MiniCard icon="fa-triangle-exclamation" value={String(urgent)} label="Urgent safety-critical requests." />
        <MiniCard icon="fa-truck-ramp-box" value={String(ready)}  label="Ready for warehouse issue." />
        <MiniCard icon="fa-inbox"          value={String(tasksQ.data?.length ?? 0)} label="Pending approvals in workflow." />
      </div>
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead><tr><th>Ref</th><th>Type</th><th>Item</th><th>Employee</th><th>Site</th><th>Submitted</th><th>Status</th></tr></thead>
                <tbody>
                  {requests.map(r => (
                    <tr key={r.ref}>
                      <td><span class="vt-cell-mono">{r.ref}</span></td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{r.type}</td>
                      <td><span class="vt-cell-name">{r.item}</span></td>
                      <td>{r.empName}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{r.site}</td>
                      <td class="vt-cell-mono">{r.submitted}</td>
                      <td><span class={ppePillClass(r.priority)}>{r.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-route" /> PPE Request Workflow</h4></div>
          <div class="ppe-panel-body">
            <div class="ppe-process">
              {[['fa-file-circle-plus', 'Request', 'Employee or supervisor requests issue, replacement, or role kit.'],
                ['fa-user-tie', 'Supervisor', 'Confirms role, site, hazard exposure, and need.'],
                ['fa-shield-halved', 'HSE Check', 'Validates PPE matrix, fit test, and training evidence.'],
                ['fa-box-open', 'Warehouse', 'Reserves stock, serials, lot numbers, and expiry dates.'],
                ['fa-signature', 'Issue', 'Employee acknowledgement and assignment record.']].map(([ic, t, s]) => (
                <div class="ppe-step" key={t as string}><i class={`fas ${ic}`} /><strong>{t}</strong><span>{s}</span></div>
              ))}
            </div>
          </div>
        </article>
      </div>

      <HseModal
        open={modalOpen} onClose={() => setModal(false)}
        title="New PPE Request" sub="Submit a request for new, replacement, or urgent PPE."
        submitLabel="Submit Request"
        onSubmit={handleSubmit}
      >
        <div class="hse-form-grid">
          <Field label="Request type"><SelectInput value={reqType} onInput={setReqType} options={['New Issue', 'Replacement', 'Role Kit', 'Urgent Safety-Critical', 'Lost Item']} /></Field>
          <Field label="PPE item"><TextInput value={reqItem} onInput={setReqItem} placeholder="e.g. Chemical Gloves, Fall Harness" /></Field>
          <Field label="Employee"><SelectInput value={reqEmp} onInput={setReqEmp} options={mockPpeEmployees.map(e => e.name)} /></Field>
          <Field label="Site"><SelectInput value={reqSite} onInput={setReqSite} options={[...HSE_SITES]} /></Field>
          <Field label="Reason" wide><TextareaInput value={reqReason} onInput={setReason} placeholder="Explain the need, hazard exposure, or replacement reason…" /></Field>
        </div>
      </HseModal>
    </div>
  );
}

function InspectionsTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-magnifying-glass-chart" title="PPE Inspection & Condition Control"
        sub="Control inspection checklists, damaged item quarantine, pass/fail decisions, and recurring cadence."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-qrcode" /> Scan Item</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-list-check" /> New Inspection</button></>} />
      <div class="ppe-three-col">
        <MiniCard icon="fa-magnifying-glass-chart" value="18" label="Inspections completed this month." />
        <MiniCard icon="fa-ban" value="4" label="Items quarantined pending repair or disposal." />
        <MiniCard icon="fa-calendar-check" value="9" label="Harness and respirator inspections due soon." />
      </div>
      <div class="ppe-two-col">
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-list-check" /> Inspection Checklist</h4></div>
          <div class="ppe-panel-body"><div class="ppe-record-list">
            <Record icon="fa-check" title="Harness webbing and stitching" sub="No cuts, burns, chemical damage, or missing labels." pill="Pass" pillClass="vt-pill is-on" />
            <Record icon="fa-check" title="Helmet shell and suspension" sub="Check cracks, UV damage, suspension fit, manufacture date." pill="Pass" pillClass="vt-pill is-on" />
            <Record icon="fa-xmark" title="Gloves contamination check" sub="Chemical exposure requires disposal and replacement issue." pill="Fail" pillClass="vt-pill is-off" />
          </div></div>
        </article>
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-boxes-packing" /> Condition Register</h4></div>
          <div class="ppe-panel-body"><div class="vt-table-scroll"><table class="vt-table">
            <thead><tr><th>Item</th><th>Serial/Lot</th><th>Condition</th><th>Action</th></tr></thead>
            <tbody>
              <tr><td>Fall Harness</td><td class="vt-cell-mono">GH-9912</td><td><span class="vt-pill is-warn">Inspect</span></td><td style={{ color: 'var(--text-muted)' }}>Monthly check</td></tr>
              <tr><td>Ear Muffs</td><td class="vt-cell-mono">3M-4410</td><td><span class="vt-pill is-off">Damaged</span></td><td style={{ color: 'var(--text-muted)' }}>Quarantine</td></tr>
              <tr><td>Hard Hat</td><td class="vt-cell-mono">VG-8821</td><td><span class="vt-pill is-on">Good</span></td><td style={{ color: 'var(--text-muted)' }}>Return to stock</td></tr>
            </tbody>
          </table></div></div>
        </article>
      </div>
    </div>
  );
}

function FitTestingTab(): VNode {
  const rows = [
    { emp: 'Reza Khan',         req: 'Half-mask respirator',   last: '2026-02-12', next: '2027-02-12', status: 'current'  },
    { emp: 'Terrence Baptiste', req: 'Welding shield training', last: '2025-08-01', next: '2026-08-01', status: 'upcoming' },
    { emp: 'Marlon Joseph',     req: 'Harness competency',     last: '2025-05-15', next: '2026-05-15', status: 'expired'  },
  ];
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-lungs" title="Fit Testing & Competency Evidence"
        sub="Manage respirator fit tests, specialized PPE training evidence, certificates, renewals, and restrictions."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-file-arrow-up" /> Upload Evidence</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-calendar-plus" /> Schedule Test</button></>} />
      <div class="ppe-screen-grid">
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-lungs" /> Fit Testing & Training Evidence</h4></div>
          <div class="ppe-panel-body"><div class="vt-table-scroll"><table class="vt-table">
            <thead><tr><th>Employee</th><th>Requirement</th><th>Last Test</th><th>Next Due</th><th>Status</th></tr></thead>
            <tbody>{rows.map(r => (
              <tr key={r.emp}><td><span class="vt-cell-name">{r.emp}</span></td><td>{r.req}</td><td class="vt-cell-mono">{r.last}</td><td class="vt-cell-mono">{r.next}</td><td><span class={ppePillClass(r.status)} style={{ textTransform: 'capitalize' }}>{r.status}</span></td></tr>
            ))}</tbody>
          </table></div></div>
        </article>
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-certificate" /> Evidence Pack</h4></div>
          <div class="ppe-panel-body"><div class="ppe-record-list">
            <Record icon="fa-file-pdf" title="Fit Test Certificate" sub="Linked to employee profile and respirator assignment." pill="PDF" />
            <Record icon="fa-user-graduate" title="Training record" sub="Required before high-risk PPE can be assigned." pill="LMS" />
            <Record icon="fa-calendar-days" title="Automatic renewal" sub="Reminder generated 30 days before expiry." pill="Auto" />
          </div></div>
        </article>
      </div>
    </div>
  );
}

function ProcurementTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-cart-shopping" title="Procurement & Supplier Planning"
        sub="Connect PPE consumption, reorder rules, vendor approvals, pricing review, and urgent purchase planning."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-file-invoice-dollar" /> Draft PO</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-truck-fast" /> Reorder Now</button></>} />
      <div class="ppe-four-col">
        <MiniCard icon="fa-cart-shopping" value="$12.4k" label="Year-to-date PPE spend." />
        <MiniCard icon="fa-arrow-trend-up" value="6" label="Reorder recommendations." />
        <MiniCard icon="fa-truck" value="3" label="Open purchase orders." />
        <MiniCard icon="fa-building" value="5" label="Approved PPE suppliers." />
      </div>
      <div class="ppe-two-col">
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-warehouse" /> Reorder Planning</h4></div>
          <div class="ppe-panel-body"><div class="vt-table-scroll"><table class="vt-table">
            <thead><tr><th>Item</th><th>Stock</th><th>Min</th><th>Recommendation</th></tr></thead>
            <tbody>
              {mockPpeItems.filter(i => i.status === 'low' || i.stock === 0).map(i => (
                <tr key={i.id}><td>{i.name}</td><td class="vt-cell-mono">{i.stock}</td><td class="vt-cell-mono">{i.threshold}</td><td><span class={ppePillClass(i.stock === 0 ? 'expired' : 'upcoming')}>Order {i.threshold * 3}</span></td></tr>
              ))}
            </tbody>
          </table></div></div>
        </article>
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-handshake" /> Supplier Controls</h4></div>
          <div class="ppe-panel-body"><div class="ppe-record-list">
            <Record icon="fa-star" title="3M Safety T&T" sub="Helmets, goggles, ear protection. Contract active." pill="Approved" pillClass="vt-pill is-on" />
            <Record icon="fa-star" title="Guardian Fall" sub="Harness and lanyard systems. Certification required." pill="Approved" pillClass="vt-pill is-on" />
            <Record icon="fa-circle-info" title="Ironclad" sub="Gloves. Price review due next quarter." pill="Review" pillClass="vt-pill is-warn" />
          </div></div>
        </article>
      </div>
    </div>
  );
}

function KitsTab(): VNode {
  const kitCards = [
    { icon: 'fa-briefcase-medical', title: 'Confined Space Kit',    desc: 'Respirator, gloves, eye protection, rescue harness, gas monitor.', site: 'Galeota Marine Base' },
    { icon: 'fa-person-falling',    title: 'Working at Height Kit', desc: 'Harness, lanyard, helmet chin strap, gloves, boots.',              site: 'Point Lisas Plant' },
    { icon: 'fa-flask',             title: 'Chemical Handling Kit', desc: 'Chemical gloves, goggles, face shield, apron, spill response PPE.', site: 'La Brea Yard' },
  ];
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-briefcase-medical" title="Site & Task PPE Kits"
        sub="Bundle PPE by hazard task, site, custodian, audit cadence, missing-item alerts, and deployment readiness."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-map-location-dot" /> Site View</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-plus" /> Build Kit</button></>} />
      <div class="ppe-three-col">
        {kitCards.map(k => {
          const kitRow = mockPpeKits.find(r => r.site === k.site);
          return (
            <div class="ppe-kit-card" key={k.title}>
              <h4><i class={`fas ${k.icon}`} /> {k.title}</h4>
              <p class="text-muted">{k.desc}</p>
              <div class="ppe-chip-row">
                <span class="ppe-chip">{k.site}</span>
                {kitRow && <span class={`ppe-chip ${kitRow.missing > 0 ? 'is-warn' : ''}`}>{kitRow.missing > 0 ? `${kitRow.missing} missing` : 'All items present'}</span>}
                <span class={`ppe-chip ${kitRow?.status === 'Ready' ? 'is-ok' : 'is-warn'}`}>{kitRow?.status ?? 'Unknown'}</span>
              </div>
            </div>
          );
        })}
      </div>
      <article class="ppe-panel">
        <div class="ppe-panel-head"><h4><i class="fas fa-map-location-dot" /> Site Kit Deployment</h4></div>
        <div class="ppe-panel-body"><div class="vt-table-scroll"><table class="vt-table">
          <thead><tr><th>Site</th><th>Kit</th><th>Custodian</th><th>Last Audit</th><th>Missing</th><th>Status</th></tr></thead>
          <tbody>
            {mockPpeKits.map(k => (
              <tr key={k.site + k.kit}>
                <td>{k.site}</td>
                <td>{k.kit}</td>
                <td style={{ color: 'var(--text-muted)' }}>{k.custodian}</td>
                <td class="vt-cell-mono">{k.lastAudit}</td>
                <td class="vt-cell-mono" style={{ color: k.missing > 0 ? 'var(--siomac-red)' : 'inherit' }}>{k.missing > 0 ? k.missing : '—'}</td>
                <td><span class={ppePillClass(k.status === 'Ready' ? 'ready' : 'pending')}>{k.status}</span></td>
              </tr>
            ))}
          </tbody>
        </table></div></div>
      </article>
    </div>
  );
}

function MatrixTab(): VNode {
  const has = (row: string[], col: string) =>
    row.some(r => r.toLowerCase().includes(col.toLowerCase()) || (col === 'Glasses' && r.includes('Glasses')) || (col === 'Ear' && r.includes('Ear')));
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-table-cells" title="Role-Based PPE Matrix"
        sub="Define what each job role must wear and drive assignment, compliance checks, and request approvals."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-copy" /> Copy Rule</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-plus" /> Add Rule</button></>} />
      <div class="ppe-matrix-summary">
        <div class="ppe-matrix-card"><i class="fas fa-user-gear" /><div><span>Role Rules</span><strong>{mockRoleMatrix.length} active</strong></div></div>
        <div class="ppe-matrix-card"><i class="fas fa-shield-halved" /><div><span>PPE Types</span><strong>8 controlled</strong></div></div>
        <div class="ppe-matrix-card"><i class="fas fa-triangle-exclamation" /><div><span>High Risk</span><strong>2 roles</strong></div></div>
        <div class="ppe-matrix-card"><i class="fas fa-circle-check" /><div><span>Compliance Link</span><strong>Auto check</strong></div></div>
      </div>
      <article class="ppe-panel">
        <div class="ppe-panel-head"><h4><i class="fas fa-table-cells-large" /> Visual Role Matrix</h4></div>
        <div class="ppe-panel-body">
          <div class="ppe-matrix-visual" style={{ gridTemplateColumns: `160px repeat(${PPE_MATRIX_COLUMNS.length}, minmax(64px, 1fr))` }}>
            <div class="head">Role</div>
            {PPE_MATRIX_COLUMNS.map(c => <div class="head" key={c}>{c}</div>)}
            {mockRoleMatrix.map(row => (
              <>
                <div class="role" key={row.role}>{row.role}</div>
                {PPE_MATRIX_COLUMNS.map(col => (
                  <div key={row.role + col}>{has(row.required, col) ? <span class="ppe-dot"><i class="fas fa-check" /></span> : null}</div>
                ))}
              </>
            ))}
          </div>
        </div>
      </article>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Role</th><th>Required PPE Types</th></tr></thead>
            <tbody>{mockRoleMatrix.map(r => (
              <tr key={r.role}><td><span class="vt-cell-name">{r.role}</span></td><td style={{ color: 'var(--text-muted)' }}>{r.required.join(', ')}</td></tr>
            ))}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function ReportsTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-chart-simple" title="PPE Analytics & Reports"
        sub="Summarize issue cost, loss and damage, audit performance, employee issue counts, and compliance evidence."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-file-excel" /> Excel</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-file-pdf" /> PDF Pack</button></>} />
      <div class="hse-kpi-row">
        <StatCard icon="fa-dollar-sign" label="Total PPE Cost" value={12450} color="#2563eb" />
        <StatCard icon="fa-triangle-exclamation" label="Lost / Damaged" value={8} color="#d97706" />
        <StatCard icon="fa-shield-halved" label="Audit Score" value={92} color="#16a34a" />
      </div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Employee</th><th>Site</th><th>Items Issued</th><th>Active</th><th>Overdue</th></tr></thead>
            <tbody>{mockPpeEmployees.map(e => {
              const asnd    = mockPpeAssignments.filter(a => a.empId === e.id);
              const overdue = asnd.filter(a => a.status === 'expired').length;
              return (
                <tr key={e.id}>
                  <td><span class="vt-cell-name">{e.name}</span></td>
                  <td style={{ color: 'var(--text-muted)', fontSize: '0.76rem' }}>{e.site}</td>
                  <td class="vt-cell-mono">{asnd.length}</td>
                  <td class="vt-cell-mono">{asnd.filter(a => a.status === 'active').length}</td>
                  <td class="vt-cell-mono" style={{ color: overdue ? 'var(--siomac-red)' : 'inherit' }}>{overdue || '—'}</td>
                </tr>
              );
            })}</tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function SettingsTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-sliders" title="PPE System Configuration"
        sub="Configure categories, renewal rules, locations, approvals, acknowledgement controls, and business rules."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-clock-rotate-left" /> Reset</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-floppy-disk" /> Save Settings</button></>} />
      <div class="ppe-three-col">
        <article class="ppe-panel padded">
          <div class="ppe-panel-head"><h4><i class="fas fa-tags" /> PPE Categories</h4></div>
          <div class="ppe-chip-row">{['Helmet', 'Gloves', 'Safety Glasses', 'Ear Protection', 'Vest', 'Harness', 'Boots', 'Respirator'].map(c => <span class="ppe-chip" key={c}>{c}</span>)}</div>
        </article>
        <article class="ppe-panel padded">
          <div class="ppe-panel-head"><h4><i class="fas fa-bell" /> Renewal Rules</h4></div>
          <div class="ppe-record-list">
            <Record icon="fa-calendar-days" title="30-day reminder" sub="Notify employee, supervisor, HSE, and warehouse." pill="Auto" />
            <Record icon="fa-rotate" title="Auto renewal task" sub="Create task when stocked replacement exists." pill="On" pillClass="vt-pill is-on" />
          </div>
        </article>
        <article class="ppe-panel padded">
          <div class="ppe-panel-head"><h4><i class="fas fa-building" /> T&T Sites</h4></div>
          <div class="ppe-record-list">
            {HSE_SITES.map(s => <Record key={s} icon="fa-location-dot" title={s} sub="Field issue and return station." pill="Active" pillClass="vt-pill is-on" />)}
          </div>
        </article>
      </div>
    </div>
  );
}

// ── Tab body registry (tab key → component) ───────────────────────────────────

export const PPE_TAB_BODIES: Record<PpeTab, () => VNode> = {
  dashboard:   DashboardTab,
  inventory:   InventoryTab,
  assign:      AssignTab,
  employees:   EmployeesTab,
  renewals:    RenewalsTab,
  returns:     ReturnsTab,
  requests:    RequestsTab,
  inspections: InspectionsTab,
  fitTesting:  FitTestingTab,
  procurement: ProcurementTab,
  kits:        KitsTab,
  matrix:      MatrixTab,
  reports:     ReportsTab,
  settings:    SettingsTab,
};

/** PPE Manager body: hero + the requested tab. Navigation is via the sidebar. */
export function PpeBody({ tab }: { tab: string }): VNode {
  const Body = PPE_TAB_BODIES[(tab as PpeTab)] ?? PPE_TAB_BODIES.dashboard;
  const active  = mockPpeAssignments.filter(a => a.status === 'active').length;
  const overdue = mockPpeAssignments.filter(a => a.status !== 'active').length;
  return (
    <div class="ppe-console">
      <div class="dash-overview-panel ppe-hero-panel">
        <div class="dash-panel-content">
          <div class="overview-top-bar">
            <div class="overview-title-section">
              <i class="fas fa-hard-hat" />
              <h2>PPE Manager</h2>
            </div>
          </div>

          <div class="dash-stats-row">
            <StatCard icon="fa-helmet-safety"        label="Active Assigned"  value={active}  color="#2563eb" />
            <StatCard icon="fa-circle-check"         label="Compliant"        value={mockPpeEmployees.filter(e => { const req = mockRoleMatrix.find(r => r.role === e.role)?.required ?? []; const asnd = mockPpeAssignments.filter(a => a.empId === e.id).map(a => a.ppeType); return req.every(r => asnd.some(a => a.toLowerCase().includes(r.toLowerCase()))); }).length} color="#16a34a" />
            <StatCard icon="fa-clock"                label="Due / Expired"    value={overdue} color="#d97706" />
            <StatCard icon="fa-clipboard-list"       label="Open Requests"    value={mockPpeRequests.filter(r => r.status !== 'closed').length}  color="#7c3aed" />
            <StatCard icon="fa-box"                  label="Low Stock Items"  value={mockPpeItems.filter(i => i.status === 'low' || i.stock === 0).length} color="#dc2626" />
          </div>
        </div>

        <div class="dash-panel-footer">
          <nav class="page-breadcrumb ppe-hero-crumb" aria-label="Breadcrumb">
            <span class="page-breadcrumb-root">HSE</span>
            <i class="fas fa-chevron-right page-breadcrumb-sep" aria-hidden="true" />
            <span class="page-breadcrumb-current">PPE Manager</span>
          </nav>
          <button class="dash-layout-btn admin-only" type="button"><i class="fas fa-edit" /> Edit Layout</button>
        </div>
      </div>
      <Body />
    </div>
  );
}
