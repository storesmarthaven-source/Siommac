/**
 * src/components/sections/HSE/Toolbox.tsx
 * Toolbox Talks area — log + new-talk modal.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import {
  PageHeader, MetricRow, TabBar, withCounts, SparkCard, HseModal, Field, SelectInput, TextInput,
  type AreaTab, type SparkDef,
} from '@ui';
import {
  mockToolboxTalks, TOOLBOX_TOPICS, HSE_SITES, hsePill,
  type ToolboxTalkRow,
} from './types';

const TABS: AreaTab[] = [
  { key: 'log', label: 'Talk Log', sublabel: 'All briefings', icon: 'fa-clipboard-list' },
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

  const completionRate = talks.length > 0 ? Math.round((completed / talks.length) * 100) : 0;
  const talksThisMonth = talks.filter(t => /jun/i.test(t.date)).length;

  const sparks: SparkDef[] = [
    {
      label: 'Talks This Month', value: String(talksThisMonth), sub: 'June 2026 · Target 12/month',
      delta: `${talksThisMonth} of 12 target`, deltaUp: false, color: '#60a5fa',
      sparkPoints: [0, 0, 0, 0, 0, talksThisMonth], sparkColor: '#60a5fa',
    },
    {
      label: 'Avg. Attendance', value: String(avgAtt), sub: 'Workers per talk · target 8',
      delta: avgAtt >= 8 ? 'On target' : 'Below target', deltaUp: avgAtt < 8, color: avgAtt >= 8 ? '#22c55e' : '#f59e0b',
      sparkPoints: [0, 0, 0, 0, 0, avgAtt], sparkColor: '#22c55e',
    },
    {
      label: 'Most Common Topic', value: 'Spill Response', sub: '4 talks YTD on this topic',
      color: '#a78bfa',
    },
    {
      label: 'Completion Rate', value: `${completionRate}%`, sub: 'Scheduled talks delivered',
      progress: { pct: completionRate, color: completionRate >= 80 ? '#22c55e' : '#f59e0b', target: 'Target: 80%' },
    },
  ];

  const tabsWithCounts = withCounts(TABS, { log: talks.length });

  return (
    <div class="hse-tab hse-dash">
      <PageHeader
        icon="fa-comments"
        module="HSE"
        title="Toolbox Talks"
        sub="Daily pre-task safety briefings across all sites and crews — log, track, and report on toolbox talk delivery."
        meta={[
          { icon: 'fa-comments', label: `${talks.length} total talks` },
          { icon: 'fa-circle-check', label: `${completed} completed` },
          { icon: 'fa-users', label: `${totalAtt} attendees` },
          { icon: 'fa-chart-pie', label: `${completionRate}% completion` },
        ]}
      />

      <MetricRow pageKey="hse.toolbox" cards={sparks.map(s => ({ key: s.label, node: <SparkCard spark={s} /> }))} />

      <div class="hse-main-grid">
        <div class="hse-left-col">
          <TabBar tabs={tabsWithCounts} active={active} onSelect={setActive} />

      {active === 'log' && (
        <div class="ppe-tab-content">
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
        </div>

        <div class="hse-right-col">
          <div class="oq-dark-card">
            <div class="oq-dark-header">
              <i class="fas fa-comments" />
              <span>Recent Talks Queue</span>
              <span class="oq-dark-count">{talks.length}</span>
            </div>
            <div class="oq-dark-vertical">
              {talks.slice(0, 6).map(t => (
                <div class="oq-dark-item" key={t.ref}>
                  <div class={`icon-badge ${/complete/i.test(t.status) ? 'green' : 'amber'}`}>
                    <i class={`fas ${TOPIC_ICONS[t.topic] ?? 'fa-comments'}`} />
                  </div>
                  <div style={{ flex: 1, minWidth: 0 }}>
                    <div style={{ fontSize: '0.75rem', fontWeight: 600, color: '#f1f5f9' }}>{t.topic}</div>
                    <div style={{ fontSize: '0.65rem', color: 'rgba(241,245,249,.55)', marginTop: '2px' }}>{t.site} · {t.date}</div>
                  </div>
                  <span class={`oq-dark-tag ${/complete/i.test(t.status) ? 'ok' : 'warning'}`}>
                    {/complete/i.test(t.status) ? `${t.attendees}` : t.status}
                  </span>
                </div>
              ))}
            </div>
          </div>
        </div>
      </div>

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
