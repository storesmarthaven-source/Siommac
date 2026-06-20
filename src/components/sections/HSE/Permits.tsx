/**
 * src/components/sections/HSE/Permits.tsx
 * Permits to Work (PTW) area — register + new-permit modal + workflow gate.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, HseModal, Field, SelectInput, TextInput, TextareaInput,
  type AreaTab,
} from './_shared';
import { useWorkflow } from '@lib/workflow';
import {
  mockPermitRows, hsePill, HSE_SITES, PERMIT_TYPES,
  type PermitRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'register', label: 'Permit Register',  icon: 'fa-clipboard-list' },
  { key: 'new',      label: 'New Permit',       icon: 'fa-circle-plus' },
];

const TYPE_ICONS: Record<string, string> = {
  'Confined Space':       'fa-person-shelter',
  'Hot Work':             'fa-fire',
  'Work at Height':       'fa-person-falling',
  'Electrical (LOTO)':    'fa-bolt',
  'Excavation':           'fa-helmet-safety',
  'Lifting':              'fa-arrow-up-from-bracket',
};

const STATUS_COLORS: Record<string, string> = {
  Blocked: 'is-danger', Overdue: 'is-danger', Hold: 'is-warn', Live: 'is-ok',
};

function RegisterTab({ permits, onNew }: { permits: PermitRow[]; onNew: () => void }): VNode {
  const active  = permits.filter(p => p.status === 'Live').length;
  const blocked = permits.filter(p => /blocked|overdue/i.test(p.status)).length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header">
            <span class="hse-spark-label">Active Permits</span>
          </div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{active}</div>
          <div class="hse-spark-sub">Currently live on-site</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header">
            <span class="hse-spark-label">Blocked / Overdue</span>
          </div>
          <div class="hse-spark-val" style={{ color: '#ef4444' }}>{blocked}</div>
          <div class="hse-spark-sub">Evidence gate not cleared</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header">
            <span class="hse-spark-label">Avg. Issue Time</span>
          </div>
          <div class="hse-spark-val">42 min</div>
          <div class="hse-spark-sub">From request to live</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header">
            <span class="hse-spark-label">Permit Compliance</span>
          </div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>88%</div>
          <div class="hse-spark-sub">Evidence attached on issue</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-clipboard-list" /></span>
            <div>
              <div class="vt-section-title">Permit Register</div>
              <div class="vt-section-sub">All active and recent permits-to-work. Click a row to view evidence gates.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search permits…" />
            </div>
            <select class="emp-filter-select">
              <option>All types</option>
              {PERMIT_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <select class="emp-filter-select">
              <option>All statuses</option>
              {['Live', 'Blocked', 'Overdue', 'Hold'].map(s => <option key={s}>{s}</option>)}
            </select>
            <button class="hse-btn primary" onClick={onNew}><i class="fas fa-circle-plus" /> New Permit</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Type</th><th>Site</th><th>Evidence gate</th><th>Holder</th><th>Expiry</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {permits.map(p => (
                    <tr key={p.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{p.ref}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                          <i class={`fas ${TYPE_ICONS[p.type] ?? 'fa-file-signature'}`} style={{ color: 'var(--siomac-navy)', opacity: 0.6, fontSize: '0.8rem' }} />
                          {p.type}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.site}</td>
                      <td style={{ color: 'var(--text-muted)', fontSize: '0.78rem' }}>{p.gate}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{p.holder}</td>
                      <td style={{ color: /today/i.test(p.expiry) ? 'var(--siomac-red)' : 'inherit', fontWeight: /today/i.test(p.expiry) ? 600 : 400 }}>{p.expiry}</td>
                      <td><span class={hsePill(p.status)}>{p.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Evidence gate sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-triangle-exclamation" /> Blocked Permits</h4>
          <div class="ppe-signals-list" style={{ marginBottom: '14px' }}>
            {permits.filter(p => /blocked|overdue/i.test(p.status)).map(p => (
              <div class="ppe-signal" key={p.ref}>
                <i class={`fas ${TYPE_ICONS[p.type] ?? 'fa-file'} ${STATUS_COLORS[p.status] ?? ''}`} />
                <div class="ppe-signal-text">
                  <strong>{p.ref} · {p.type}</strong>
                  <span>Gate: {p.gate}</span>
                </div>
                <span class={`ppe-signal-tag ${STATUS_COLORS[p.status] ?? ''}`}>{p.status}</span>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-shield-halved" /> Evidence Required</h4>
          <div class="ppe-signals-list">
            {[
              { icon: 'fa-person-shelter', label: 'Confined Space', items: ['Gas test result', 'Rescue plan', 'Standby attendant'] },
              { icon: 'fa-fire',           label: 'Hot Work',       items: ['Gas-free certificate', 'Fire watch assigned', 'Extinguisher check'] },
              { icon: 'fa-bolt',           label: 'Electrical',     items: ['LOTO locks applied', 'Isolation verified', 'Test & tag'] },
            ].map(g => (
              <div class="ppe-signal" key={g.label} style={{ flexDirection: 'column', alignItems: 'flex-start', gap: '6px' }}>
                <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                  <i class={`fas ${g.icon} is-info`} />
                  <strong style={{ fontSize: '0.74rem', color: 'rgba(255,255,255,.85)' }}>{g.label}</strong>
                </div>
                <ul style={{ margin: 0, paddingLeft: '32px', display: 'grid', gap: '3px' }}>
                  {g.items.map(it => (
                    <li key={it} style={{ fontSize: '0.68rem', color: 'rgba(255,255,255,.5)', lineHeight: 1.4 }}>{it}</li>
                  ))}
                </ul>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function NewPermitTab({ onSubmit }: { onSubmit: (p: PermitRow) => void }): VNode {
  const [type, setType]     = useState<string>(PERMIT_TYPES[0]);
  const [site, setSite]     = useState<string>(HSE_SITES[0]);
  const [holder, setHolder] = useState('');
  const [scope, setScope]   = useState('');
  const [expiry, setExpiry] = useState('');

  function submit() {
    const ref = `PTW-${Math.floor(1000 + Math.random() * 9000)}`;
    onSubmit({ ref, type, site, gate: 'Evidence pending review', status: 'Hold', holder: holder || 'Unassigned', expiry: expiry || 'TBD' });
    setHolder(''); setScope(''); setExpiry('');
  }

  return (
    <div class="ppe-tab-content">
      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '18px' }}>
            <span class="vt-section-icon"><i class="fas fa-circle-plus" /></span>
            <div>
              <div class="vt-section-title">New Permit to Work</div>
              <div class="vt-section-sub">Submitting raises a PTW record and routes it to the Permit Controller for evidence gate clearance.</div>
            </div>
          </div>
          <div class="hse-intake-card">
            <div class="hse-form-grid">
              <Field label="Permit type">
                <SelectInput value={type} onInput={setType} options={[...PERMIT_TYPES]} />
              </Field>
              <Field label="Site / Location">
                <SelectInput value={site} onInput={setSite} options={[...HSE_SITES]} />
              </Field>
              <Field label="Permit holder / Applicant">
                <TextInput value={holder} onInput={setHolder} placeholder="Name of the person performing the work" />
              </Field>
              <Field label="Planned expiry">
                <TextInput value={expiry} onInput={setExpiry} placeholder="e.g. Today 18:00 / 20 Jun 2026 14:00" />
              </Field>
              <Field label="Scope of work" wide>
                <TextareaInput value={scope} onInput={setScope} placeholder="Describe the work to be performed, equipment involved, people at risk, and any isolations required…" />
              </Field>
            </div>
            <div class="hse-intake-foot">
              <button class="hse-btn primary" onClick={submit}>
                <i class="fas fa-paper-plane" /> Submit for Permit Controller Review
              </button>
            </div>
          </div>
        </div>

        {/* Guide sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-chart-bar" /> Permits by Type · YTD</h4>
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { label: 'Hot Work',       count: 38, color: '#ef4444' },
              { label: 'Confined Space', count: 24, color: '#f59e0b' },
              { label: 'Electrical',     count: 19, color: '#60a5fa' },
              { label: 'Work at Height', count: 14, color: '#a78bfa' },
              { label: 'Lifting',        count: 9,  color: '#34d399' },
              { label: 'Excavation',     count: 4,  color: '#94a3b8' },
            ].map(b => {
              const pct = Math.round((b.count / 108) * 100);
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
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-diagram-project" /> Approval flow</h4>
          <div class="ppe-signals-list">
            {[
              { icon: 'fa-file-circle-plus',   label: 'PTW raised', note: 'Reference assigned, status: Hold' },
              { icon: 'fa-shield-check',        label: 'Evidence gate', note: 'Permit Controller validates all pre-conditions' },
              { icon: 'fa-circle-check',        label: 'Permit live', note: 'Work may begin — expiry clock starts' },
              { icon: 'fa-lock',                label: 'Closed out', note: 'Signed off on completion, record archived' },
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

export function PermitsArea({ tab }: { tab: string }): VNode {
  const wf = useWorkflow();
  const [active, setActive]   = useState(tab);
  const [permits, setPermits] = useState<PermitRow[]>(mockPermitRows);
  const [modalOpen, setModal] = useState(false);

  const live    = permits.filter(p => p.status === 'Live').length;
  const blocked = permits.filter(p => /blocked|overdue/i.test(p.status)).length;
  const hold    = permits.filter(p => p.status === 'Hold').length;

  const stats = [
    { icon: 'fa-file-signature',    label: 'Total Permits',      value: permits.length, color: 'blue' },
    { icon: 'fa-circle-check',      label: 'Live',               value: live,           color: 'green' },
    { icon: 'fa-triangle-exclamation', label: 'Blocked / Overdue', value: blocked,     color: 'red' },
    { icon: 'fa-clock',             label: 'On Hold',            value: hold,           color: 'gold' },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-file-signature"
        areaIcon="fa-file-contract"
        title="Permits to Work"
        crumb="Permits (PTW)"
        watermarkClass="hse-wm-permits"
        context={['Evidence-gated work authorisation', 'Trinidad & Tobago Operations']}
        badges={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-location-dot', label: '5 Active Sites' },
          { icon: 'fa-shield-halved', label: 'PTW Standard v3.0' },
        ]}
        stats={stats}
        metrics={[
          { label: 'Avg. issue time', value: '42 min' },
          { label: 'Evidence compliance', value: '88%' },
          { label: 'Permits issued YTD', value: '108' },
          { label: 'Zero LTIs on permits', value: 'YTD', highlight: true },
        ]}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'register' && (
        <RegisterTab permits={permits} onNew={() => setActive('new')} />
      )}
      {active === 'new' && (
        <NewPermitTab
          onSubmit={p => {
            setPermits([p, ...permits]);
            wf.submit({ templateId: 'permit-approval', recordRef: p.ref, reason: `${p.type} — ${p.site}`, priority: 'high' });
            setActive('register');
          }}
        />
      )}
    </div>
  );
}
