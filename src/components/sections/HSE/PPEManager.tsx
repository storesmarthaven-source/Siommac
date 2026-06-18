/**
 * src/components/sections/HSE/PPEManager.tsx
 *
 * PPE Manager tab bodies. Each PPE area is a small presentational function;
 * the active one is chosen by the section id (the sidebar drives navigation, so
 * there is no in-page sub-nav). UI-only: static data from types.ts.
 *
 * Exports PPE_TAB_BODIES (tab key → component) + PpeBody (hero + active tab),
 * consumed by PpeShell.tsx which maps the active section id to a tab.
 */

import { type VNode } from 'preact';
import { StatCard } from '../Employees/StatCard';
import { ProfilePill } from '@shared/ProfilePill';
import {
  mockPpeItems, mockPpeEmployees, mockRoleMatrix, PPE_MATRIX_COLUMNS, ppePillClass,
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
  const required = (role: string) => mockRoleMatrix.find(r => r.role === role)?.required ?? [];
  return (
    <div class="ppe-tab-content">
      <div class="hse-kpi-row">
        <StatCard icon="fa-shield-halved" label="Compliance"    value={94} color="#16a34a" />
        <StatCard icon="fa-list-check"    label="Open Actions"  value={18} color="#2563eb" />
        <StatCard icon="fa-box-open"      label="Critical Stock" value={6} color="#dc2626" />
      </div>
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
            <thead><tr><th>Employee</th><th>Role</th><th>Required Items</th><th>Assigned</th><th>Missing</th><th>Status</th></tr></thead>
            <tbody>
              {mockPpeEmployees.map(emp => {
                const req = required(emp.role);
                return (
                  <tr key={emp.id}>
                    <td><span class="vt-cell-name">{emp.name}</span></td>
                    <td>{emp.role}</td>
                    <td style={{ color: 'var(--text-muted)' }}>{req.join(', ') || '—'}</td>
                    <td style={{ color: 'var(--text-muted)' }}>—</td>
                    <td>{req.join(', ') || 'None'}</td>
                    <td><span class={ppePillClass(req.length ? 'missing' : 'compliant')}>{req.length ? 'Missing PPE' : 'Compliant'}</span></td>
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

function AssignTab(): VNode {
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-user-plus" title="Visual PPE Assignment"
        sub="Select PPE on the worker diagram, then assign it to an employee with date, notes, acknowledgement, and renewal tracking."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-wand-magic-sparkles" /> Load Role Kit</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-check" /> Assign Selected</button></>} />
      <div class="ppe-assign-layout">
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-person" /> Interactive Worker Picker</h4><span class="ppe-panel-tag">Hover + select</span></div>
          <div class="ppe-panel-body">
            <div class="ppe-worker-map">
              <span class="ppe-map-title">Trace PPE Zones</span>
              {[['Helmet', 8, 50], ['Glasses', 18, 36], ['Hi-vis vest', 44, 50], ['Harness', 56, 52], ['Gloves', 12, 14], ['Coveralls', 52, 30], ['Boots', 88, 48]].map(([label, top, left]) => (
                <button type="button" class="ppe-zone" style={{ top: `${top}%`, left: `${left}%` }} key={label as string}>{label}</button>
              ))}
            </div>
            <div class="ppe-selected-strip"><span class="text-muted">Select traced PPE zones on the image.</span></div>
          </div>
        </article>
        <div class="ppe-assign-side">
          <article class="ppe-panel">
            <div class="ppe-panel-head"><h4><i class="fas fa-clipboard-check" /> Issue Record</h4></div>
            <div class="ppe-panel-body ppe-form-grid">
              <div class="form-group"><label>Employee</label><select>{mockPpeEmployees.map(e => <option key={e.id}>{e.name} ({e.role})</option>)}</select></div>
              <div class="form-group"><label>Issue Date</label><input type="date" /></div>
              <div class="form-group"><label>Renewal Rule</label><select><option>Auto renew after 12 months</option><option>Inspect after 6 months</option><option>One-time issue</option></select></div>
              <div class="form-group"><label>Cost Center</label><select><option>HSE Operations</option><option>Maintenance</option><option>Construction</option></select></div>
              <div class="form-group" style={{ gridColumn: '1 / -1' }}><label>Issue Notes</label><textarea rows={3} placeholder="Condition, serials, hazard task, training evidence…" /></div>
            </div>
          </article>
          <aside class="ppe-panel">
            <div class="ppe-panel-head"><h4><i class="fas fa-user-shield" /> Assignment Controls</h4></div>
            <div class="ppe-panel-body">
              <div class="ppe-record-list">
                <Record icon="fa-user" title="Select employee" sub="Role requirements appear here." pill="Pending" pillClass="vt-pill is-warn" />
                <Record icon="fa-box" title="Stock validation" sub="Checks available inventory before assignment." pill="Auto" />
                <Record icon="fa-signature" title="Acknowledgement" sub="Employee signature required for issue record." pill="On" pillClass="vt-pill is-on" />
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
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-users" title="Employee PPE Profiles"
        sub="Track role, department, site, assigned PPE, missing PPE, supervisor ownership, and compliance readiness."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-id-badge" /> Import HR</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-user-plus" /> Add Employee</button></>} />
      <div class="vt-toolbar"><div class="vt-search" style={{ flex: '1 1 260px' }}><i class="fas fa-search" /><input type="search" placeholder="Search employee, role, or site…" /></div></div>
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Name</th><th>Role</th><th>Department</th><th>Site</th><th>Assigned PPE</th><th>Missing PPE</th></tr></thead>
            <tbody>
              {mockPpeEmployees.map(emp => (
                <tr key={emp.id}>
                  <td><span class="vt-cell-name">{emp.name}</span></td>
                  <td>{emp.role}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{emp.department}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{emp.site}</td>
                  <td style={{ color: 'var(--text-muted)' }}>—</td>
                  <td>{required(emp.role).join(', ') || 'None'}</td>
                </tr>
              ))}
            </tbody>
          </table>
        </div>
      </div>
    </div>
  );
}

function RenewalsTab(): VNode {
  const rows = [
    { emp: 'John Doe', item: 'Hard Hat Type A', issue: '2026-01-10', expiry: '2027-01-10', status: 'active' },
    { emp: 'Jane Smith', item: 'Leather Gloves', issue: '2026-02-15', expiry: '2026-12-01', status: 'upcoming' },
    { emp: 'Carlos Garcia', item: 'Fall Harness', issue: '2026-03-01', expiry: '2026-09-30', status: 'overdue' },
  ];
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-clock-rotate-left" title="Renewal Automation"
        sub="Review overdue and upcoming PPE replacement cycles with automatic task generation and stock reservation."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-envelope" /> Send Reminders</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-sync" /> Auto-Renew</button></>} />
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Employee</th><th>Item</th><th>Issue Date</th><th>Expiry Date</th><th>Status</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.emp + r.item}>
                  <td><span class="vt-cell-name">{r.emp}</span></td>
                  <td>{r.item}</td>
                  <td class="vt-cell-mono">{r.issue}</td>
                  <td class="vt-cell-mono">{r.expiry}</td>
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
  const rows = [
    { item: 'Ear Muffs', emp: 'Jane Smith', date: '2026-06-01', condition: 'Damaged', disposition: 'Disposal' },
    { item: 'Fall Harness', emp: 'Carlos Garcia', date: '2026-05-15', condition: 'Good', disposition: 'Return to Stock' },
  ];
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-rotate-left" title="Returns, Disposal & Quarantine"
        sub="Record returned PPE condition, disposition, reuse eligibility, quarantine decision, and handover evidence."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-camera" /> Evidence Photos</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-rotate-left" /> New Return</button></>} />
      <div class="vt-table-card">
        <div class="vt-table-scroll">
          <table class="vt-table">
            <thead><tr><th>Item</th><th>Employee</th><th>Return Date</th><th>Condition</th><th>Disposition</th></tr></thead>
            <tbody>
              {rows.map(r => (
                <tr key={r.item + r.emp}>
                  <td><span class="vt-cell-name">{r.item}</span></td>
                  <td>{r.emp}</td>
                  <td class="vt-cell-mono">{r.date}</td>
                  <td>{r.condition}</td>
                  <td style={{ color: 'var(--text-muted)' }}>{r.disposition}</td>
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
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-clipboard-list" title="PPE Request Management"
        sub="Manage new issue, replacement, lost, damaged, role kit, and urgent safety-critical requests."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-filter" /> My Queue</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-plus" /> New Request</button></>} />
      <div class="ppe-four-col">
        <MiniCard icon="fa-clipboard-list" value="12" label="Open requests for new issue, replacement, or lost PPE." />
        <MiniCard icon="fa-user-check" value="5" label="Supervisor approvals awaiting decision." />
        <MiniCard icon="fa-triangle-exclamation" value="3" label="Urgent safety-critical requests." />
        <MiniCard icon="fa-truck-ramp-box" value="7" label="Ready for warehouse issue." />
      </div>
      <div class="ppe-screen-grid">
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
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-inbox" /> Active Requests</h4></div>
          <div class="ppe-panel-body"><div class="ppe-record-list">
            <Record icon="fa-helmet-safety" title="REQ-PPE-1048 · Confined Space Kit" sub="Jane Smith · Maintenance · Dubai · approval due today." pill="Review" pillClass="vt-pill is-warn" />
            <Record icon="fa-hand" title="REQ-PPE-1049 · Chemical Gloves" sub="John Doe · replacement due to contamination." pill="Urgent" pillClass="vt-pill is-off" />
            <Record icon="fa-shoe-prints" title="REQ-PPE-1050 · Steel Toe Boots" sub="Carlos Garcia · new site assignment kit." pill="Ready" pillClass="vt-pill is-on" />
          </div></div>
        </article>
      </div>
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
    { emp: 'Jane Smith', req: 'Half-mask respirator', last: '2026-02-12', next: '2027-02-12', status: 'current' },
    { emp: 'John Doe', req: 'Welding shield training', last: '2025-08-01', next: '2026-08-01', status: 'upcoming' },
    { emp: 'Carlos Garcia', req: 'Harness competency', last: '2025-05-15', next: '2026-05-15', status: 'expired' },
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
              <tr><td>Leather Gloves</td><td class="vt-cell-mono">8</td><td class="vt-cell-mono">15</td><td><span class="vt-pill is-off">Order 50</span></td></tr>
              <tr><td>Welding Shield</td><td class="vt-cell-mono">3</td><td class="vt-cell-mono">5</td><td><span class="vt-pill is-warn">Order 10</span></td></tr>
              <tr><td>Ear Muffs</td><td class="vt-cell-mono">0</td><td class="vt-cell-mono">5</td><td><span class="vt-pill is-off">Emergency PO</span></td></tr>
            </tbody>
          </table></div></div>
        </article>
        <article class="ppe-panel">
          <div class="ppe-panel-head"><h4><i class="fas fa-handshake" /> Supplier Controls</h4></div>
          <div class="ppe-panel-body"><div class="ppe-record-list">
            <Record icon="fa-star" title="3M Safety" sub="Helmets, goggles, ear protection. Contract active." pill="Approved" pillClass="vt-pill is-on" />
            <Record icon="fa-star" title="Guardian Fall" sub="Harness and lanyard systems. Certification required." pill="Approved" pillClass="vt-pill is-on" />
            <Record icon="fa-circle-info" title="Ironclad" sub="Gloves. Price review due next quarter." pill="Review" pillClass="vt-pill is-warn" />
          </div></div>
        </article>
      </div>
    </div>
  );
}

function KitsTab(): VNode {
  const kits = [
    { icon: 'fa-briefcase-medical', title: 'Confined Space Kit', desc: 'Respirator, gloves, eye protection, rescue harness, gas monitor.', chips: ['Houston', '3 assigned', '1 missing'] },
    { icon: 'fa-person-falling', title: 'Working at Height Kit', desc: 'Harness, lanyard, helmet chin strap, gloves, boots.', chips: ['Singapore', '6 assigned', '2 due inspection'] },
    { icon: 'fa-flask', title: 'Chemical Handling Kit', desc: 'Chemical gloves, goggles, face shield, apron, spill response PPE.', chips: ['Dubai', '4 assigned', 'Current'] },
  ];
  return (
    <div class="ppe-tab-content">
      <SectionHead icon="fa-briefcase-medical" title="Site & Task PPE Kits"
        sub="Bundle PPE by hazard task, site, custodian, audit cadence, missing-item alerts, and deployment readiness."
        actions={<><button class="btn btn-outline-secondary btn-sm has-label"><i class="fas fa-map-location-dot" /> Site View</button><button class="btn btn-danger-primary btn-sm"><i class="fas fa-plus" /> Build Kit</button></>} />
      <div class="ppe-three-col">
        {kits.map(k => (
          <div class="ppe-kit-card" key={k.title}>
            <h4><i class={`fas ${k.icon}`} /> {k.title}</h4>
            <p class="text-muted">{k.desc}</p>
            <div class="ppe-chip-row">{k.chips.map(c => <span class="ppe-chip" key={c}>{c}</span>)}</div>
          </div>
        ))}
      </div>
      <article class="ppe-panel">
        <div class="ppe-panel-head"><h4><i class="fas fa-map-location-dot" /> Site Kit Deployment</h4></div>
        <div class="ppe-panel-body"><div class="vt-table-scroll"><table class="vt-table">
          <thead><tr><th>Site</th><th>Kit</th><th>Custodian</th><th>Last Audit</th><th>Status</th></tr></thead>
          <tbody>
            <tr><td>Houston</td><td>Confined Space</td><td>Jane Smith</td><td class="vt-cell-mono">2026-06-01</td><td><span class="vt-pill is-warn">Missing item</span></td></tr>
            <tr><td>Singapore</td><td>Working at Height</td><td>Carlos Garcia</td><td class="vt-cell-mono">2026-06-07</td><td><span class="vt-pill is-on">Ready</span></td></tr>
            <tr><td>Dubai</td><td>Chemical Handling</td><td>Mike Okafor</td><td class="vt-cell-mono">2026-05-29</td><td><span class="vt-pill is-on">Ready</span></td></tr>
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
            <thead><tr><th>Employee</th><th>Items Issued</th><th>Total Value</th></tr></thead>
            <tbody>{mockPpeEmployees.map((e, i) => (
              <tr key={e.id}><td><span class="vt-cell-name">{e.name}</span></td><td class="vt-cell-mono">{[2, 1, 1, 1, 1][i]}</td><td class="vt-cell-mono">${[300, 150, 150, 150, 150][i]}</td></tr>
            ))}</tbody>
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
          <div class="ppe-panel-head"><h4><i class="fas fa-building" /> Locations</h4></div>
          <div class="ppe-record-list">
            <Record icon="fa-warehouse" title="Warehouse A" sub="Main controlled stock and quarantine cage." pill="HQ" />
            <Record icon="fa-location-dot" title="Site B" sub="Field issue and return station." pill="Site" />
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
  return (
    <div class="ppe-console">
      {/* PPE overview panel — same structure/skin as the admin "Today's Overview"
          (always dark via .ppe-hero-panel), hard-hat watermark, profile pill,
          summary stat cards, and a footer with breadcrumb + Edit Layout. */}
      <div class="dash-overview-panel ppe-hero-panel">
        <div class="dash-panel-content">
          <div class="overview-top-bar">
            <div class="overview-title-section">
              <i class="fas fa-hard-hat" />
              <h2>PPE Manager</h2>
            </div>
            {/* Reusable, self-populating profile pill (id-free). */}
            <ProfilePill variant="onDark" />
          </div>

          <div class="dash-stats-row">
            <StatCard icon="fa-helmet-safety"        label="Total Issued"    value={6} color="#2563eb" />
            <StatCard icon="fa-circle-check"         label="Fully Compliant" value={2} color="#16a34a" />
            <StatCard icon="fa-triangle-exclamation" label="Missing PPE"     value={3} color="#d97706" />
            <StatCard icon="fa-clock"                label="Expiring Soon"   value={1} color="#dc2626" />
            <StatCard icon="fa-box"                  label="Low Stock Items" value={3} color="#7c3aed" />
          </div>

          {/* Live control signals — full-width row inside the dark hero. */}
          <div class="ppe-hero-signals">
            <div class="ppe-hero-signals-head"><i class="fas fa-satellite-dish" /> Live Control Signals</div>
            <div class="ppe-hero-signals-list">
              <div class="ppe-signal"><i class="fas fa-triangle-exclamation" /><div><strong>Respirator evidence gap</strong><span>2 employees require fit-test evidence before issue.</span></div><span class="ppe-signal-tag is-high">High</span></div>
              <div class="ppe-signal"><i class="fas fa-warehouse" /><div><strong>Warehouse stock action</strong><span>Ear protection and gloves below reorder threshold.</span></div><span class="ppe-signal-tag is-stock">Stock</span></div>
              <div class="ppe-signal"><i class="fas fa-clipboard-check" /><div><strong>Inspection cadence</strong><span>Harness checks are due this week for Site B.</span></div><span class="ppe-signal-tag is-due">Due</span></div>
            </div>
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
