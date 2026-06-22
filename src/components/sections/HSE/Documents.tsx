/**
 * src/components/sections/HSE/Documents.tsx
 * Documents & SDS area — document library + SDS register.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, withCounts, HseModal, Field, SelectInput, TextInput,
  type AreaTab,
} from './_shared';
import { useCreateWorkflow } from '@api/workflows';
import {
  mockHseDocs, mockSds, hsePill, HSE_DOC_TYPES,
  type HseDocRow, type SdsRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'docs', label: 'Documents',  sublabel: 'Controlled library', icon: 'fa-folder-open' },
  { key: 'sds',  label: 'SDS Library', sublabel: 'Chemical register', icon: 'fa-flask' },
];

const TYPE_ICONS: Record<string, string> = {
  Policy: 'fa-landmark', Procedure: 'fa-list-check', SOP: 'fa-file-lines',
  Plan: 'fa-map', Form: 'fa-file-pen', Register: 'fa-table-list',
};

const HAZARD_COLORS: Record<string, string> = {
  'Flammable Liquid 3': '#ef4444', 'Flammable Gas 2': '#ef4444',
  'Corrosive 8': '#f59e0b', 'Not classified': '#94a3b8',
};

function DocsTab({ docs, onUpload }: { docs: HseDocRow[]; onUpload: () => void }): VNode {
  const reviewDue = docs.filter(d => /review due|draft/i.test(d.status)).length;
  const published = docs.filter(d => /published/i.test(d.status)).length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Published</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{published}</div>
          <div class="hse-spark-sub">Active controlled documents</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Review Due / Draft</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{reviewDue}</div>
          <div class="hse-spark-sub">Require review or approval</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Documents</span></div>
          <div class="hse-spark-val">{docs.length}</div>
          <div class="hse-spark-sub">Across all document types</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Next Review</span></div>
          <div class="hse-spark-val" style={{ fontSize: '0.9rem' }}>30 Jun</div>
          <div class="hse-spark-sub">Emergency Response Plan · v1.4</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-folder-open" /></span>
            <div>
              <div class="vt-section-title">HSE Document Library</div>
              <div class="vt-section-sub">Controlled documents — policies, procedures, SOPs, plans. Upload opens a document-approval workflow.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search documents…" />
            </div>
            <select class="emp-filter-select">
              <option>All types</option>
              {HSE_DOC_TYPES.map(t => <option key={t}>{t}</option>)}
            </select>
            <button class="hse-btn primary" onClick={onUpload}><i class="fas fa-arrow-up-from-bracket" /> Upload Document</button>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Title</th><th>Type</th><th>Owner</th><th>Version</th><th>Review date</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {docs.map(d => (
                    <tr key={d.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{d.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{d.title}</span></td>
                      <td>
                        <div style={{ display: 'flex', alignItems: 'center', gap: '6px', color: 'var(--text-muted)', fontSize: '0.78rem' }}>
                          <i class={`fas ${TYPE_ICONS[d.type] ?? 'fa-file'}`} style={{ fontSize: '0.72rem' }} /> {d.type}
                        </div>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{d.owner}</td>
                      <td style={{ color: 'var(--text-muted)' }}>{d.version}</td>
                      <td style={{ color: /jun 2026/i.test(d.review) ? 'var(--siomac-red)' : 'inherit', fontWeight: /jun 2026/i.test(d.review) ? 600 : 400 }}>{d.review}</td>
                      <td><span class={hsePill(d.status)}>{d.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-chart-bar" /> By Type</h4>
          <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { label: 'Procedures', count: 8,  color: '#60a5fa' },
              { label: 'SOPs',       count: 14, color: '#a78bfa' },
              { label: 'Policies',   count: 5,  color: '#34d399' },
              { label: 'Plans',      count: 4,  color: '#f59e0b' },
              { label: 'Forms',      count: 11, color: '#fb923c' },
              { label: 'Registers',  count: 3,  color: '#94a3b8' },
            ].map(b => {
              const pct = Math.round((b.count / 45) * 100);
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
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-clock" /> Review Due</h4>
          <div class="ppe-signals-list">
            {docs.filter(d => /review due|draft/i.test(d.status)).map(d => (
              <div class="ppe-signal" key={d.ref}>
                <i class={`fas ${TYPE_ICONS[d.type] ?? 'fa-file'} is-warn`} />
                <div class="ppe-signal-text">
                  <strong>{d.title}</strong>
                  <span>{d.version} · Review {d.review}</span>
                </div>
                <span class="ppe-signal-tag is-due">{d.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

function SdsTab({ sds }: { sds: SdsRow[] }): VNode {
  const expired = sds.filter(s => /expired/i.test(s.status)).length;
  const review  = sds.filter(s => /review/i.test(s.status)).length;

  return (
    <div class="ppe-tab-content">
      {/* Analytics strip */}
      <div class="hse-spark-row">
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Total Chemicals</span></div>
          <div class="hse-spark-val">{sds.length}</div>
          <div class="hse-spark-sub">Registered in SDS library</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Current SDS</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{sds.filter(s => /current/i.test(s.status)).length}</div>
          <div class="hse-spark-sub">Up to date and accessible</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Under Review</span></div>
          <div class="hse-spark-val" style={{ color: '#f59e0b' }}>{review}</div>
          <div class="hse-spark-sub">Awaiting supplier confirmation</div>
        </div>
        <div class="hse-spark">
          <div class="hse-spark-header"><span class="hse-spark-label">Expired SDS</span></div>
          <div class="hse-spark-val" style={{ color: expired > 0 ? '#ef4444' : '#22c55e' }}>{expired}</div>
          <div class="hse-spark-sub">Must not be used on-site</div>
        </div>
      </div>

      <div class="ppe-screen-grid">
        <div class="ppe-screen-main">
          <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
            <span class="vt-section-icon"><i class="fas fa-flask" /></span>
            <div>
              <div class="vt-section-title">Safety Data Sheet Library</div>
              <div class="vt-section-sub">Chemical register with GHS/OSHA hazard classification. Expired SDS must be updated before chemical use.</div>
            </div>
          </div>
          <div class="vt-toolbar">
            <div class="vt-search" style={{ flex: '1 1 220px' }}>
              <i class="fas fa-search" /><input type="search" placeholder="Search chemicals…" />
            </div>
            <select class="emp-filter-select">
              <option>All statuses</option>
              {['Current', 'Review', 'Expired'].map(s => <option key={s}>{s}</option>)}
            </select>
          </div>
          <div class="vt-table-card">
            <div class="vt-table-scroll">
              <table class="vt-table">
                <thead>
                  <tr><th>Ref</th><th>Chemical</th><th>Supplier</th><th>Hazard class</th><th>Revision</th><th>Status</th></tr>
                </thead>
                <tbody>
                  {sds.map(s => (
                    <tr key={s.ref} style={{ cursor: 'pointer' }}>
                      <td><span class="vt-cell-mono">{s.ref}</span></td>
                      <td><span class="vt-cell-name" style={{ fontWeight: 500 }}>{s.chemical}</span></td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.supplier}</td>
                      <td>
                        <span style={{ display: 'inline-flex', alignItems: 'center', gap: '5px', fontSize: '0.74rem' }}>
                          <i class="fas fa-diamond" style={{ color: HAZARD_COLORS[s.hazardClass] ?? '#94a3b8', fontSize: '0.6rem' }} />
                          {s.hazardClass}
                        </span>
                      </td>
                      <td style={{ color: 'var(--text-muted)' }}>{s.revision}</td>
                      <td><span class={`vt-pill ${/current/i.test(s.status) ? 'is-on' : /review/i.test(s.status) ? 'is-warn' : 'is-off'}`}>{s.status}</span></td>
                    </tr>
                  ))}
                </tbody>
              </table>
            </div>
          </div>
        </div>

        {/* Sidebar */}
        <aside class="ppe-signals-panel">
          <h4><i class="fas fa-gauge-high" /> SDS Status</h4>
          <div style={{ display: 'grid', gridTemplateColumns: '1fr 1fr', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
            {[
              { val: sds.length,                                              label: 'Total',    color: '#fff' },
              { val: sds.filter(s => /current/i.test(s.status)).length,      label: 'Current',  color: '#4ade80' },
              { val: review,                                                  label: 'Review',   color: '#fcd34d' },
              { val: expired,                                                 label: 'Expired',  color: '#fca5a5' },
            ].map(k => (
              <div key={k.label} style={{ padding: '10px', borderRadius: '10px', background: 'rgba(255,255,255,.08)', textAlign: 'center' }}>
                <div style={{ fontSize: '1.4rem', fontWeight: 700, color: k.color, lineHeight: 1 }}>{k.val}</div>
                <div style={{ fontSize: '0.62rem', color: 'rgba(255,255,255,.5)', marginTop: '3px' }}>{k.label}</div>
              </div>
            ))}
          </div>
          <div class="hse-panel-divider" />
          <h4 style={{ marginBottom: '8px' }}><i class="fas fa-triangle-exclamation" /> Attention</h4>
          <div class="ppe-signals-list">
            {sds.filter(s => !/current/i.test(s.status)).map(s => (
              <div class="ppe-signal" key={s.ref}>
                <i class={`fas fa-flask ${/expired/i.test(s.status) ? 'is-danger' : 'is-warn'}`} />
                <div class="ppe-signal-text">
                  <strong>{s.chemical}</strong>
                  <span>{s.hazardClass} · Rev {s.revision}</span>
                </div>
                <span class={`ppe-signal-tag ${/expired/i.test(s.status) ? 'is-high' : 'is-due'}`}>{s.status}</span>
              </div>
            ))}
          </div>
        </aside>
      </div>
    </div>
  );
}

export function DocumentsArea({ tab }: { tab: string }): VNode {
  const createWorkflow = useCreateWorkflow();
  const [active, setActive] = useState(tab);
  const [docs, setDocs]     = useState<HseDocRow[]>(mockHseDocs);
  const [sds]               = useState<SdsRow[]>(mockSds);
  const [modalOpen, setModal] = useState(false);
  const [newTitle, setTitle]  = useState('');
  const [newType, setType]    = useState<string>(HSE_DOC_TYPES[0]);
  const [newOwner, setOwner]  = useState('HSE');

  const published  = docs.filter(d => /published/i.test(d.status)).length;
  const reviewDue  = docs.filter(d => /review due|draft/i.test(d.status)).length;
  const expiredSds = sds.filter(s => /expired/i.test(s.status)).length;

  const stats = [
    { icon: 'fa-folder-open',    label: 'Total Documents', value: docs.length,    sub: 'on file',        color: 'blue'  as const },
    { icon: 'fa-circle-check',   label: 'Published',       value: published,      sub: 'active/current', color: 'green' as const },
    { icon: 'fa-clock',          label: 'Review / Draft',  value: reviewDue,      sub: 'need action',    color: 'gold'  as const },
    { icon: 'fa-flask',          label: 'SDS in Library',  value: sds.length,     sub: 'chemicals',      color: 'blue'  as const },
  ];

  const tabsWithCounts = withCounts(TABS, { docs: docs.length, sds: sds.length });

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-folder-open"
        areaIcon="fa-book-bookmark"
        title="Documents & SDS"
        watermarkClass="hse-wm-documents"
        stats={stats}
        footerItems={[
          { icon: 'fa-circle-check', label: 'Published Documents', value: String(published), pill: '● Version-controlled', pillVariant: 'green' },
          { icon: 'fa-clock', label: 'Pending Review', value: String(reviewDue), trend: reviewDue > 0 ? 'review needed' : undefined, trendUp: false },
          { icon: 'fa-flask', label: 'Expired SDS', value: String(expiredSds), pill: expiredSds > 0 ? '● Action Required' : '● All Current', pillVariant: expiredSds > 0 ? 'red' : 'green' },
          { icon: 'fa-calendar-alt', label: 'Next Critical Review', value: '30 Jun 2026', pill: '● Monitoring', pillVariant: 'amber' },
        ]}
      />

      <div class="hse-spark-grid">
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Published</span></div>
          <div class="hse-spark-val" style={{ color: '#22c55e' }}>{published}</div>
          <div class="hse-spark-sub">Active controlled documents</div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Review / Draft</span></div>
          <div class="hse-spark-val" style={{ color: reviewDue > 0 ? '#f59e0b' : '#4ade80' }}>{reviewDue}</div>
          <div class="hse-spark-sub">Require review or approval</div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">SDS Library</span></div>
          <div class="hse-spark-val" style={{ color: '#60a5fa' }}>{sds.length}</div>
          <div class="hse-spark-sub">Chemicals registered on-site</div>
        </div>
        <div class="hse-spark-card">
          <div class="hse-spark-header"><span class="hse-spark-label">Expired SDS</span></div>
          <div class="hse-spark-val" style={{ color: expiredSds > 0 ? '#ef4444' : '#4ade80' }}>{expiredSds}</div>
          <div class="hse-spark-sub">Must not be used on-site</div>
        </div>
      </div>

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <AreaTabs
            icon="fa-folder-open"
            title="Documents & SDS"
            sub="Controlled document library and Safety Data Sheet register"
            tabs={tabsWithCounts} active={active} onSelect={setActive}
            actionLabel="Upload Document" onAction={() => setModal(true)}
          />

          {active === 'docs' && <DocsTab docs={docs} onUpload={() => setModal(true)} />}
          {active === 'sds'  && <SdsTab sds={sds} />}
        </div>

        <div class="hse-right-col">
          <div class="oq-dark-card">
            <div class="oq-dark-header">
              <i class="fas fa-clock" />
              <span>Docs for Review</span>
              <span class="oq-dark-count">{reviewDue}</span>
            </div>
            <div class="oq-dark-vertical">
              {docs.filter(d => /review due|draft/i.test(d.status)).slice(0, 5).map(d => (
                <div class="oq-dark-item" key={d.ref}>
                  <div class="icon-badge amber"><i class={`fas ${TYPE_ICONS[d.type] ?? 'fa-file'}`} /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{d.title}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{d.version} · Review {d.review}</div>
                  </div>
                  <span class="oq-dark-tag warning">{d.status}</span>
                </div>
              ))}
              {reviewDue === 0 && <div style={{ padding: '16px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>All documents current</div>}
            </div>
            <div class="oq-dark-header" style={{ marginTop: '12px' }}>
              <i class="fas fa-flask" />
              <span>Expired SDS</span>
              <span class="oq-dark-count">{expiredSds}</span>
            </div>
            <div class="oq-dark-vertical">
              {sds.filter(s => /expired/i.test(s.status)).slice(0, 4).map(s => (
                <div class="oq-dark-item" key={s.ref}>
                  <div class="icon-badge red"><i class="fas fa-flask" /></div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{s.chemical}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{s.hazardClass} · Rev {s.revision}</div>
                  </div>
                  <span class="oq-dark-tag danger">Expired</span>
                </div>
              ))}
              {expiredSds === 0 && <div style={{ padding: '12px 0', textAlign: 'center', color: 'rgba(241,245,249,.4)', fontSize: '0.75rem' }}>All SDS current</div>}
            </div>
          </div>
        </div>
      </div>

      <HseModal
        open={modalOpen} onClose={() => setModal(false)}
        title="Upload Document" sub="Upload a new or revised controlled document. This opens a document-approval workflow."
        submitLabel="Upload & Route for Approval"
        onSubmit={() => {
          const ref = `DOC-HSE-${String(docs.length + 300).padStart(4, '0')}`;
          const newDoc: HseDocRow = { ref, title: newTitle || 'Untitled document', type: newType, owner: newOwner, version: 'v1.0', status: 'Draft', review: '19 Jun 2027' };
          setDocs([newDoc, ...docs]);
          void createWorkflow.mutate({ templateKey: 'hse_document_approval', sourceModule: 'hse', sourceEntityType: 'document', sourceEntityId: ref, reason: newDoc.title, priority: 'high' });
          setModal(false); setTitle('');
        }}
      >
        <div class="hse-form-grid">
          <Field label="Document title" wide><TextInput value={newTitle} onInput={setTitle} placeholder="e.g. Confined Space Entry Procedure" /></Field>
          <Field label="Document type"><SelectInput value={newType} onInput={setType} options={[...HSE_DOC_TYPES]} /></Field>
          <Field label="Document owner"><TextInput value={newOwner} onInput={setOwner} placeholder="Department or person responsible" /></Field>
        </div>
      </HseModal>
    </div>
  );
}
