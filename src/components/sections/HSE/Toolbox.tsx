/**
 * src/components/sections/HSE/Toolbox.tsx
 * Toolbox Talks area — log + new-talk modal.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  AreaHero, AreaTabs, HseModal, Field, SelectInput, TextInput,
  type AreaTab,
} from './_shared';
import {
  mockToolboxTalks, TOOLBOX_TOPICS, HSE_SITES, hsePill,
  type ToolboxTalkRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'log', label: 'Talk Log', icon: 'fa-clipboard-list' },
];

const TOPIC_ICONS: Record<string, string> = {
  'Spill Response':      'fa-droplet',
  'Confined Space':      'fa-person-shelter',
  'Work at Height':      'fa-person-falling',
  'Manual Handling':     'fa-hand-holding-box',
  'Traffic Management':  'fa-traffic-cone',
  'Hot Work':            'fa-fire',
  'PPE Use':             'fa-helmet-safety',
  'Emergency Response':  'fa-kit-medical',
};

export function ToolboxArea({ tab }: { tab: string }): VNode {
  const [active, setActive]   = useState(tab);
  const [talks, setTalks]     = useState<ToolboxTalkRow[]>(mockToolboxTalks);
  const [modalOpen, setModal] = useState(false);
  const [newTopic, setTopic]  = useState<string>(TOOLBOX_TOPICS[0]);
  const [newSite, setSite]    = useState<string>(HSE_SITES[0]);
  const [newPres, setPres]    = useState('');

  const completed  = talks.filter(t => /complete/i.test(t.status)).length;
  const scheduled  = talks.filter(t => /scheduled/i.test(t.status)).length;
  const totalAtt   = talks.filter(t => /complete/i.test(t.status)).reduce((s, t) => s + t.attendees, 0);
  const avgAtt     = completed > 0 ? Math.round(totalAtt / completed) : 0;

  const stats = [
    { icon: 'fa-comments',       label: 'Total Talks',    value: talks.length,   color: 'blue'  },
    { icon: 'fa-circle-check',   label: 'Completed',      value: completed,      color: 'green' },
    { icon: 'fa-calendar-clock', label: 'Scheduled',      value: scheduled,      color: 'gold'  },
    { icon: 'fa-users',          label: 'Total Attendees', value: totalAtt,      color: 'blue'  },
  ];

  return (
    <div class="hse-tab hse-dash">
      <AreaHero
        icon="fa-comments"
        areaIcon="fa-people-group"
        title="Toolbox Talks"
        crumb="Toolbox Talks"
        context={['Daily pre-task safety briefings', 'Trinidad & Tobago Operations']}
        badges={[
          { icon: 'fa-calendar', label: 'Jan – Jun 2026' },
          { icon: 'fa-location-dot', label: '5 Active Sites' },
          { icon: 'fa-users', label: 'All crews' },
        ]}
        stats={stats}
        metrics={[
          { label: 'Talks completed YTD', value: String(completed) },
          { label: 'Avg. attendance', value: `${avgAtt} workers` },
          { label: 'Total workers briefed', value: String(totalAtt) },
          { label: 'Target: 3 talks/week', value: 'On track', highlight: true },
        ]}
      />
      <AreaTabs tabs={TABS} active={active} onSelect={setActive} />

      {active === 'log' && (
        <div class="ppe-tab-content">
          {/* Analytics strip */}
          <div class="hse-spark-row">
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Talks This Month</span></div>
              <div class="hse-spark-val">{talks.filter(t => /jun/i.test(t.date)).length}</div>
              <div class="hse-spark-sub">June 2026 · Target 12/month</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Avg. Attendance</span></div>
              <div class="hse-spark-val">{avgAtt}</div>
              <div class="hse-spark-sub">Workers per talk · target 8</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Most Common Topic</span></div>
              <div class="hse-spark-val" style={{ fontSize: '0.9rem' }}>Spill Response</div>
              <div class="hse-spark-sub">4 talks YTD on this topic</div>
            </div>
            <div class="hse-spark">
              <div class="hse-spark-header"><span class="hse-spark-label">Completion Rate</span></div>
              <div class="hse-spark-val" style={{ color: '#22c55e' }}>{completed > 0 ? Math.round((completed / talks.length) * 100) : 0}%</div>
              <div class="hse-spark-sub">Scheduled talks delivered</div>
            </div>
          </div>

          <div class="ppe-screen-grid">
            <div class="ppe-screen-main">
              <div class="vt-section-titlewrap" style={{ marginBottom: '14px' }}>
                <span class="vt-section-icon"><i class="fas fa-clipboard-list" /></span>
                <div>
                  <div class="vt-section-title">Talk Log</div>
                  <div class="vt-section-sub">Pre-task safety briefings delivered across all sites. Each talk links to attendance and topic record.</div>
                </div>
              </div>
              <div class="vt-toolbar">
                <div class="vt-search" style={{ flex: '1 1 220px' }}>
                  <i class="fas fa-search" /><input type="search" placeholder="Search talks…" />
                </div>
                <select class="emp-filter-select">
                  <option>All sites</option>
                  {HSE_SITES.map(s => <option key={s}>{s}</option>)}
                </select>
                <button class="hse-btn primary" onClick={() => setModal(true)}><i class="fas fa-circle-plus" /> New Talk</button>
              </div>
              <div class="vt-table-card">
                <div class="vt-table-scroll">
                  <table class="vt-table">
                    <thead>
                      <tr><th>Ref</th><th>Topic</th><th>Site</th><th>Presenter</th><th>Date</th><th>Attendees</th><th>Status</th></tr>
                    </thead>
                    <tbody>
                      {talks.map(t => (
                        <tr key={t.ref} style={{ cursor: 'pointer' }}>
                          <td><span class="vt-cell-mono">{t.ref}</span></td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '7px' }}>
                              <i class={`fas ${TOPIC_ICONS[t.topic] ?? 'fa-comments'}`} style={{ color: 'var(--siomac-navy)', opacity: 0.55, fontSize: '0.78rem' }} />
                              <span class="vt-cell-name" style={{ fontWeight: 500 }}>{t.topic}</span>
                            </div>
                          </td>
                          <td style={{ color: 'var(--text-muted)' }}>{t.site}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{t.presenter}</td>
                          <td style={{ color: 'var(--text-muted)' }}>{t.date}</td>
                          <td>
                            <div style={{ display: 'flex', alignItems: 'center', gap: '6px' }}>
                              <i class="fas fa-users" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} />
                              <span style={{ fontWeight: t.attendees === 0 ? 400 : 500 }}>{t.attendees === 0 ? '—' : t.attendees}</span>
                            </div>
                          </td>
                          <td><span class={hsePill(t.status)}>{t.status}</span></td>
                        </tr>
                      ))}
                    </tbody>
                  </table>
                </div>
              </div>
            </div>

            {/* Sidebar — topic breakdown */}
            <aside class="ppe-signals-panel">
              <h4><i class="fas fa-chart-bar" /> Topics · YTD</h4>
              <div style={{ display: 'grid', gap: '8px', marginTop: '6px', marginBottom: '14px' }}>
                {[
                  { label: 'Spill Response',     count: 4, color: '#34d399' },
                  { label: 'Confined Space',     count: 4, color: '#f59e0b' },
                  { label: 'Hot Work',           count: 3, color: '#ef4444' },
                  { label: 'PPE Use',            count: 3, color: '#60a5fa' },
                  { label: 'Work at Height',     count: 2, color: '#a78bfa' },
                  { label: 'Traffic Mgmt',       count: 2, color: '#fb923c' },
                  { label: 'Emergency Response', count: 2, color: '#f472b6' },
                ].map(b => {
                  const pct = Math.round((b.count / 20) * 100);
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
              <h4 style={{ marginBottom: '8px' }}><i class="fas fa-calendar-clock" /> Recent Talks</h4>
              <div class="ppe-signals-list">
                {talks.slice(0, 4).map(t => (
                  <div class="ppe-signal" key={t.ref}>
                    <i class={`fas ${TOPIC_ICONS[t.topic] ?? 'fa-comments'} ${/complete/i.test(t.status) ? 'is-ok' : 'is-info'}`} />
                    <div class="ppe-signal-text">
                      <strong>{t.topic}</strong>
                      <span>{t.presenter} · {t.date}</span>
                    </div>
                    <span class={`ppe-signal-tag ${/complete/i.test(t.status) ? 'is-ok' : 'is-info'}`}>
                      {/complete/i.test(t.status) ? `${t.attendees} att.` : t.status}
                    </span>
                  </div>
                ))}
              </div>
            </aside>
          </div>
        </div>
      )}

      <HseModal
        open={modalOpen} onClose={() => setModal(false)}
        title="New Toolbox Talk" sub="Log a scheduled or delivered toolbox talk."
        submitLabel="Log Talk"
        onSubmit={() => {
          const ref = `TBT-${100 + talks.length}`;
          setTalks([{ ref, topic: newTopic, date: '19 Jun 2026', site: newSite, presenter: newPres || 'HSE Officer', attendees: 0, status: 'Scheduled' }, ...talks]);
          setModal(false); setPres('');
        }}
      >
        <div class="hse-form-grid">
          <Field label="Topic"><SelectInput value={newTopic} onInput={setTopic} options={[...TOOLBOX_TOPICS]} /></Field>
          <Field label="Site"><SelectInput value={newSite} onInput={setSite} options={[...HSE_SITES]} /></Field>
          <Field label="Presenter"><TextInput value={newPres} onInput={setPres} placeholder="Name of the presenter" /></Field>
        </div>
      </HseModal>
    </div>
  );
}
