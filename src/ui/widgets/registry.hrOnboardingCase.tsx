/**
 * src/ui/widgets/registry.hrOnboardingCase.tsx — HR Onboarding CASE-DETAIL KPI tiles.
 *
 * A SMALL set of vibrant, glanceable "iOS health/control-center" tiles (gauge / ring / battery /
 * hero / pill-list) for the per-case board — they INSPIRE a few widgets, not the whole page. The
 * substantive content (Active Tasks, Required Documents, Custom Actions, Handoffs) lives as
 * page-local TABLE widgets in OnboardingCaseDetail. Styles: onboardingCaseWidgets.css.
 *
 * DATA IS REAL & PER-CASE. Board widgets render into DETACHED gridstack roots (no React context),
 * so each tile reads the active `caseId` from the module store (@store/onboardingCase) and fetches
 * with the caseId-scoped onboarding hooks. `renderPreview` (catalogue thumbnail only) uses demo data.
 * Auto-registered via the `widgets` export + registry.ts glob.
 */
import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import type { WidgetDef } from './types';
import {
  useOnboardingTasksList, useOnboardingHandoffsList, useOnboardingBlockersList,
  useOnboardingAudit, useOnboardingResolveBlocker,
  useOnboardingCommunications, useOnboardingTimeline, useOnboardingSendCommunication, useOnboardingResendCommunication,
} from '@api/hr/onboarding';
import type { OnboardingHandoffRow, OnboardingBlockerRow, OnboardingAuditRow, OnboardingCommunicationType } from '../../../types/hrOnboarding';
import { useOnboardingCaseStore, selectCaseId, selectCaseRow } from '@store/onboardingCase';
import { dialog } from '@lib/dialog';
import { humanize } from '@/components/sections/HR/onboardingStatus';
import {
  Ring, GaugeArc, bucket, matchDocs, matchTraining, matchProvision, matchIT,
  isOpen, daysUntil, pctOf, initials,
} from '@/components/sections/HR/onboardingCase.helpers';
import './onboardingCaseWidgets.css';

const CASE_PAGES = ['hr.onboarding.case'];
const CASE_ZONES = ['main'];
const CASE_SOURCE = { sourceKey: 'hr_onboarding', label: 'HR Onboarding', refreshIntervalMs: 120000, permissions: ['hr.onboarding.view'] };
// Nil UUID: passes the backend's z.string().uuid() validation (unlike a plain string,
// which 400s) and `.eq(case_id, …)` legitimately matches zero rows, since no real case
// is ever assigned this id — the intended "no case open ⇒ empty result" behavior.
const SENTINEL = '00000000-0000-0000-0000-000000000000';

const S  = { key: 'compact'  as const, label: 'Small',  grid: { w: 3, h: 2 }, description: 'Compact tile.' };
const ST = { key: 'tall'     as const, label: 'Tall',   grid: { w: 3, h: 3 }, description: 'Compact + viz.' };
const M  = { key: 'standard' as const, label: 'Medium', grid: { w: 4, h: 3 }, description: 'Roomy tile.' };

const AC = { blue: '#2563eb', green: '#11a86b', amber: '#e08600', red: '#e11d48', purple: '#6746f2' };
type Accent = keyof typeof AC;

const useCid = (): string => useOnboardingCaseStore(selectCaseId) ?? SENTINEL;

// ── shared shell bits ────────────────────────────────────────────────────────────
function Head({ title, sub, icon, color }: { title: string; sub?: string; icon: string; color: Accent }): VNode {
  return (
    <div class="ocw-head">
      <div class="ocw-titles">
        <div class="ocw-title">{title}</div>
        {sub && <div class="ocw-sub">{sub}</div>}
      </div>
      <span class={`ocw-chip ${color}`}><i class={`fas ${icon}`} /></span>
    </div>
  );
}
type FootCell = { label: string; val: VNode | string | number; tone?: 'green' | 'amber' | 'red' | 'blue' };
function Foot({ cells }: { cells: FootCell[] }): VNode {
  return (
    <div class="ocw-foot">
      {cells.map((c, i) => (
        <div class="ocw-foot-cell" key={i}>
          <div class="ocw-foot-label">{c.label}</div>
          <div class={`ocw-foot-val${c.tone ? ` ${c.tone}` : ''}`}>{c.val}</div>
        </div>
      ))}
    </div>
  );
}

// 1 · Package Progress (gauge arc) ─────────────────────────────────────────────────
function ProgressView({ pct, done, total, blocking }: { pct: number; done: number; total: number; blocking: number }): VNode {
  const color = pct >= 80 ? AC.green : pct >= 40 ? AC.blue : AC.amber;
  const label = pct >= 100 ? 'Complete' : pct >= 80 ? 'On track' : pct >= 40 ? 'In progress' : 'Behind';
  return (
    <div class="ocw tint-blue">
      <Head title="Package Progress" sub="Overall completion" icon="fa-rocket" color="blue" />
      <div class="ocw-body center">
        <div class="ocw-gauge">
          <GaugeArc percent={pct} color={color} />
          <div class="ocw-gauge-center"><strong style={{ color }}>{pct}%</strong><span style={{ color }}>{label}</span></div>
        </div>
      </div>
      <Foot cells={[
        { label: 'Done', val: done, tone: 'green' },
        { label: 'Open', val: Math.max(0, total - done) },
        { label: 'Blocking', val: blocking, tone: blocking ? 'red' : undefined },
      ]} />
    </div>
  );
}

// 2 · Activation Readiness (ring) ──────────────────────────────────────────────────
function ReadinessView({ pct, docs, training, access }: { pct: number; docs: number; training: number; access: number }): VNode {
  const color = pct >= 80 ? AC.green : pct >= 40 ? AC.amber : AC.red;
  return (
    <div class="ocw tint-green">
      <Head title="Activation Readiness" sub="Ready to activate" icon="fa-shield-halved" color="green" />
      <div class="ocw-body center">
        <Ring percent={pct} color={color} size={118}><strong style={{ color }}>{pct}%</strong><span>ready</span></Ring>
      </div>
      <Foot cells={[{ label: 'Docs', val: `${docs}%` }, { label: 'Training', val: `${training}%` }, { label: 'Access', val: `${access}%` }]} />
    </div>
  );
}

// 3 · SLA Countdown (gauge) ────────────────────────────────────────────────────────
function SlaView({ days, due }: { days: number | null; due: string }): VNode {
  const tone: Accent = days === null ? 'green' : days < 0 ? 'red' : days < 7 ? 'amber' : 'green';
  const pct = days === null ? 72 : Math.max(0, Math.min(100, Math.round((days / 60) * 100)));
  const label = days === null ? 'No due date' : days < 0 ? 'Overdue' : days < 7 ? 'Due soon' : 'On track';
  return (
    <div class={`ocw tint-${tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : 'red'}`}>
      <Head title="SLA Countdown" sub="Time to target" icon="fa-clock" color={tone} />
      <div class="ocw-body center">
        <div class="ocw-gauge">
          <GaugeArc percent={pct} color={AC[tone]} />
          <div class="ocw-gauge-center">
            <strong style={{ color: AC[tone] }}>{days === null ? '—' : Math.abs(days)}</strong>
            <span style={{ color: AC[tone] }}>{days === null ? '' : days < 0 ? 'days over' : 'days left'}</span>
          </div>
        </div>
      </div>
      <Foot cells={[{ label: 'Target', val: due }, { label: 'Status', val: label, tone: tone === 'green' ? 'green' : tone === 'amber' ? 'amber' : 'red' }]} />
    </div>
  );
}

// 4 · Blockers (bold hero tile) ────────────────────────────────────────────────────
function BlockersView(
  { count, critical, high, top, onResolve }:
  { count: number; critical: number; high: number; top: { id: string; title: string; module: string }[]; onResolve?: (id: string) => void },
): VNode {
  const clear = count === 0;
  return (
    <div class={`ocw hero ${clear ? 'green' : 'red'}`}>
      <Head title="Blockers" sub={clear ? 'Nothing blocking activation' : 'Active dependencies'} icon={clear ? 'fa-circle-check' : 'fa-triangle-exclamation'} color={clear ? 'green' : 'red'} />
      <div class="ocw-body">
        <div class="ocw-num">{count}</div>
        {clear
          ? <div class="ocw-statline" style={{ color: 'rgba(255,255,255,.85)' }}>All clear — no active blockers.</div>
          : <div class="ocw-list">
              {top.map(b => (
                <div class="ocw-li" key={b.id}>
                  <span class="ocw-li-ico"><i class="fas fa-ban" /></span>
                  <div class="ocw-li-main"><div class="ocw-li-title">{b.title}</div><div class="ocw-li-sub">{humanize(b.module)}</div></div>
                  {onResolve && <button type="button" class="ocw-act-btn" onClick={() => onResolve(b.id)}>Resolve</button>}
                </div>
              ))}
            </div>}
      </div>
      <Foot cells={[{ label: 'Critical', val: critical }, { label: 'High', val: high }, { label: 'Total', val: count }]} />
    </div>
  );
}

// 5 · Account Provisioning (battery fill) ──────────────────────────────────────────
function ProvisionView({ pct, done, total, email, login, mailbox }: { pct: number; done: number; total: number; email: string; login: string; mailbox: string }): VNode {
  const status = pct >= 100 ? 'Provisioned' : pct > 0 ? 'In progress' : 'Not started';
  return (
    <div class="ocw tint-green">
      <Head title="Account Provisioning" sub="Email · login · mailbox" icon="fa-key" color="green" />
      <div class="ocw-body row">
        <div class="ocw-batt"><div class="ocw-batt-fill" style={{ height: `${pct}%` }} /><div class="ocw-batt-bolt">⚡</div></div>
        <div>
          <div class="ocw-num" style={{ color: AC.green }}>{pct}<em>%</em></div>
          <div class="ocw-statline">{status} · {done}/{total} steps</div>
        </div>
      </div>
      <Foot cells={[
        { label: 'Work email', val: email, tone: email === 'Done' ? 'green' : undefined },
        { label: 'Login', val: login, tone: login === 'Done' ? 'green' : undefined },
        { label: 'Mailbox', val: mailbox, tone: mailbox === 'Done' ? 'green' : undefined },
      ]} />
    </div>
  );
}

// 6 · Training (progress + tag) ────────────────────────────────────────────────────
function TrainingView({ pct, done, total }: { pct: number; done: number; total: number }): VNode {
  const tag = pct >= 100 ? { t: 'Compliant', c: 'green' as const } : pct > 0 ? { t: 'In Progress', c: 'amber' as const } : { t: 'Not Started', c: 'gray' as const };
  return (
    <div class="ocw tint-amber">
      <Head title="Training" sub="Courses & inductions" icon="fa-graduation-cap" color="amber" />
      <div class="ocw-body">
        <div class="ocw-num" style={{ color: AC.amber }}>{pct}<em>%</em></div>
        <div class="ocw-tags"><span class={`ocw-pill ${tag.c}`}>{tag.t}</span><span class="ocw-statline">{done} of {total} done</span></div>
      </div>
    </div>
  );
}

// 7 · Approvals (pill list) ────────────────────────────────────────────────────────
function ApprovalsView({ items }: { items: { id: string; title: string; status: string }[] }): VNode {
  return (
    <div class="ocw tint-amber">
      <Head title="Approvals" sub={`${items.length} pending`} icon="fa-circle-check" color="amber" />
      <div class="ocw-body">
        {items.length === 0
          ? <div class="ocw-empty">No pending approvals.</div>
          : <div class="ocw-list">
              {items.slice(0, 4).map(a => (
                <div class="ocw-li" key={a.id}>
                  <span class="ocw-li-ico amber"><i class="fas fa-hourglass-half" /></span>
                  <div class="ocw-li-main"><div class="ocw-li-title">{a.title}</div></div>
                  <span class="ocw-pill amber">{humanize(a.status)}</span>
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// 8 · Due This Week (pill list) ────────────────────────────────────────────────────
function DueView({ count, overdue, items }: { count: number; overdue: number; items: { id: string; title: string; days: number }[] }): VNode {
  return (
    <div class={`ocw tint-${overdue ? 'red' : 'blue'}`}>
      <Head title="Due This Week" sub="Next 7 days" icon="fa-calendar-check" color={overdue ? 'red' : 'blue'} />
      <div class="ocw-body">
        {count === 0
          ? <div class="ocw-empty">Nothing due this week.</div>
          : <div class="ocw-list">
              {items.slice(0, 4).map(t => (
                <div class="ocw-li" key={t.id}>
                  <span class={`ocw-li-ico ${t.days < 0 ? 'red' : 'blue'}`}><i class="fas fa-clock" /></span>
                  <div class="ocw-li-main"><div class="ocw-li-title">{t.title}</div></div>
                  <span class={`ocw-pill ${t.days < 0 ? 'red' : t.days <= 1 ? 'amber' : 'blue'}`}>{t.days < 0 ? `${Math.abs(t.days)}d over` : t.days === 0 ? 'today' : `${t.days}d`}</span>
                </div>
              ))}
            </div>}
      </div>
      <Foot cells={[{ label: 'Due ≤7d', val: count }, { label: 'Overdue', val: overdue, tone: overdue ? 'red' : undefined }]} />
    </div>
  );
}

// 9 · Recent Activity (feed) ───────────────────────────────────────────────────────
function activityIcon(a: string): string {
  const s = a.toLowerCase();
  if (/complet|done|finish/.test(s)) return 'fa-check';
  if (/block/.test(s)) return 'fa-ban';
  if (/approv|verif/.test(s)) return 'fa-circle-check';
  if (/creat|add|start/.test(s)) return 'fa-plus';
  return 'fa-bolt';
}
function relTime(iso: string): string {
  const secs = Math.round((Date.now() - new Date(iso).getTime()) / 1000);
  if (secs < 60) return 'just now';
  if (secs < 3600) return `${Math.floor(secs / 60)}m`;
  if (secs < 86400) return `${Math.floor(secs / 3600)}h`;
  return `${Math.floor(secs / 86400)}d`;
}
function ActivityView({ items }: { items: { id: string; action: string; who: string; when: string }[] }): VNode {
  return (
    <div class="ocw tint-blue">
      <Head title="Recent Activity" sub="Latest case events" icon="fa-wave-square" color="blue" />
      <div class="ocw-body">
        {items.length === 0
          ? <div class="ocw-empty">No recent activity.</div>
          : <div class="ocw-list">
              {items.slice(0, 5).map(a => (
                <div class="ocw-li" key={a.id}>
                  <span class="ocw-li-ico"><i class={`fas ${activityIcon(a.action)}`} /></span>
                  <div class="ocw-li-main"><div class="ocw-li-title">{humanize(a.action)}</div><div class="ocw-li-sub">{a.who}</div></div>
                  <span class="ocw-li-sub">{a.when}</span>
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// 10 · Team (avatars) ──────────────────────────────────────────────────────────────
function TeamView({ owner, members }: { owner: string; members: string[] }): VNode {
  return (
    <div class="ocw tint-purple">
      <Head title="Team" sub="Owner & assignees" icon="fa-user-group" color="purple" />
      <div class="ocw-body">
        <div class="ocw-statline" style={{ marginBottom: 8 }}><span class="ocw-ava" style={{ display: 'inline-grid', marginRight: 8, verticalAlign: 'middle' }}>{initials(owner)}</span><b>{owner}</b> · owner</div>
        <div class="ocw-ava-stack">
          {members.slice(0, 6).map((m, i) => <span class="ocw-ava" key={i} title={m}>{initials(m)}</span>)}
          {members.length > 6 && <span class="ocw-ava">+{members.length - 6}</span>}
          {members.length === 0 && <span class="ocw-statline">No assignees yet.</span>}
        </div>
      </div>
    </div>
  );
}

// 11 · Communications ───────────────────────────────────────────────────────────--
const COMM_TYPES: { v: OnboardingCommunicationType; label: string }[] = [
  { v: 'employee_welcome', label: 'Welcome the employee' },
  { v: 'supervisor_notification', label: 'Notify the supervisor' },
  { v: 'owner_reminder', label: 'Remind the case owner' },
  { v: 'escalation_notice', label: 'Send escalation notice' },
];
const commStatusTone = (s: string): string => s === 'sent' ? 'green' : s === 'failed' ? 'red' : s === 'cancelled' ? 'gray' : 'amber';
function CommunicationsWidget(): VNode {
  const caseId = useOnboardingCaseStore(selectCaseId);
  const q = useOnboardingCommunications(caseId);
  const sendMut = useOnboardingSendCommunication();
  const resendMut = useOnboardingResendCommunication();
  const [type, setType] = useState<OnboardingCommunicationType>('employee_welcome');
  const rows = q.data ?? [];
  const send = (): void => {
    if (!caseId) return;
    void (async () => {
      try { const r = await sendMut.mutateAsync({ caseId, communicationType: type }); void dialog.toast({ text: r.status === 'sent' ? 'Message sent' : 'Saved as draft', icon: r.status === 'sent' ? 'success' : 'info' }); }
      catch (e) { void dialog.error('Send failed', e instanceof Error ? e.message : 'Could not send'); }
    })();
  };
  const resend = (id: string): void => {
    void (async () => {
      try { await resendMut.mutateAsync({ id }); void dialog.toast({ text: 'Resent', icon: 'success' }); }
      catch (e) { void dialog.error('Resend failed', e instanceof Error ? e.message : 'Could not resend'); }
    })();
  };
  return (
    <div class="ocw tint-purple">
      <Head title="Communications" sub="Welcome · notify · remind" icon="fa-envelope" color="purple" />
      <div class="ocw-body">
        <div class="ocw-commbar">
          <select class="ocw-commsel" value={type} onChange={e => setType((e.target as HTMLSelectElement).value as OnboardingCommunicationType)}>
            {COMM_TYPES.map(t => <option key={t.v} value={t.v}>{t.label}</option>)}
          </select>
          <button type="button" class="ocw-act-btn" disabled={sendMut.isPending || !caseId} onClick={send}>Send</button>
        </div>
        {rows.length === 0
          ? <div class="ocw-empty">No communications sent yet.</div>
          : <div class="ocw-list">
              {rows.slice(0, 6).map(cmt => (
                <div class="ocw-li" key={cmt.id}>
                  <span class="ocw-li-ico purple"><i class="fas fa-paper-plane" /></span>
                  <div class="ocw-li-main">
                    <div class="ocw-li-title">{cmt.subject || humanize(cmt.communicationType)}</div>
                    <div class="ocw-li-sub">{cmt.recipientName ?? '—'} · {cmt.sentAt ? relTime(cmt.sentAt) : 'draft'}</div>
                  </div>
                  <div style={{ display: 'flex', alignItems: 'center', gap: 6 }}>
                    <span class={`ocw-pill ${commStatusTone(cmt.status)}`}>{humanize(cmt.status)}</span>
                    {cmt.status !== 'cancelled' && cmt.channel !== 'manual' && cmt.recipientUserId && <button type="button" class="ocw-act-btn" onClick={() => resend(cmt.id)}>Resend</button>}
                  </div>
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// 12 · Timeline ─────────────────────────────────────────────────────────────────--
function timelineDotColor(item: { item_type: string; severity?: string }): string {
  if (item.severity === 'critical' || item.severity === 'warning') return AC.red;
  if (item.item_type === 'handoff') return AC.amber;
  if (item.item_type === 'workflow') return AC.purple;
  if (item.item_type === 'audit') return AC.blue;
  return AC.green;
}
function TimelineWidget(): VNode {
  const caseId = useOnboardingCaseStore(selectCaseId);
  const q = useOnboardingTimeline(caseId);
  const rows = q.data ?? [];
  return (
    <div class="ocw tint-blue">
      <Head title="Timeline" sub="Full case history" icon="fa-timeline" color="blue" />
      <div class="ocw-body">
        {rows.length === 0
          ? <div class="ocw-empty">No events yet.</div>
          : <div class="ocw-timeline">
              {rows.slice(0, 12).map(it => (
                <div class="ocw-tl-row" key={it.id}>
                  <span class="ocw-tl-dot" style={{ background: timelineDotColor(it) }} />
                  <div class="ocw-tl-main">
                    <div class="ocw-li-title">{it.title}</div>
                    <div class="ocw-li-sub">{it.actor_name ?? 'System'} · {relTime(it.created_at)}{it.description ? ` · ${humanize(it.description)}` : ''}</div>
                  </div>
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// 13 · Audit Trail ──────────────────────────────────────────────────────────────--
function AuditWidget(): VNode {
  const caseId = useOnboardingCaseStore(selectCaseId);
  const q = useOnboardingAudit(caseId ?? null);
  const rows = (q.data ?? []) as OnboardingAuditRow[];
  const summarize = (s: unknown): string => {
    if (!s || typeof s !== 'object') return '—';
    const keys = Object.keys(s as Record<string, unknown>);
    return keys.length ? keys.slice(0, 3).map(k => `${k}: ${String((s as Record<string, unknown>)[k])}`).join(', ') : '—';
  };
  return (
    <div class="ocw tint-blue">
      <Head title="Audit Trail" sub="Compliance record" icon="fa-clipboard-list" color="blue" />
      <div class="ocw-body">
        {q.isError ? <div class="ocw-empty">You don’t have permission to view the audit trail.</div>
          : rows.length === 0 ? <div class="ocw-empty">No audit entries.</div>
          : <div class="ocw-audit">
              {rows.slice(0, 10).map(a => (
                <div class="ocw-audit-row" key={a.id}>
                  <div class="ocw-audit-head"><b>{humanize(a.action)}</b><span class="ocw-li-sub">{relTime(a.createdAt)}</span></div>
                  <div class="ocw-li-sub">{a.actorName ?? (a.actorId ? '—' : 'System')}{a.reason ? ` · ${a.reason}` : ''}</div>
                  {(a.previousState || a.newState) && <div class="ocw-audit-diff">{summarize(a.previousState)} → {summarize(a.newState)}</div>}
                </div>
              ))}
            </div>}
      </div>
    </div>
  );
}

// ══════════════════════════════════════════════════════════════════════════════════
function def(
  id: string, title: string, description: string, icon: string, previewVariant: WidgetDef['previewVariant'],
  defaultSize: WidgetDef['defaultSize'], allowedSizes: WidgetDef['allowedSizes'],
  render: () => VNode, renderPreview: () => VNode, tags: string[],
): WidgetDef {
  return {
    id, module: 'hr', area: 'onboarding', title, description, icon, category: 'Case', tags,
    previewVariant, chrome: 'none', supportedPages: CASE_PAGES, supportedZones: CASE_ZONES,
    defaultSize, allowedSizes, defaultConfig: {}, configSchema: [], dataSource: CASE_SOURCE,
    recommendedFor: CASE_PAGES, render, renderPreview,
  };
}

export const widgets: WidgetDef[] = [
  def('hr.onboarding.case.progress', 'Package Progress', 'Overall onboarding completion for this case as a gauge.', 'fa-rocket', 'donut', 'tall', [ST, M], () => {
    const caseRow = useOnboardingCaseStore(selectCaseRow);
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const b = bucket(rows);
    return <ProgressView pct={caseRow?.progressPercent ?? pctOf(b.done, b.total)} done={b.done} total={b.total} blocking={rows.filter(t => t.isBlocking && isOpen(t.status)).length} />;
  }, () => <ProgressView pct={68} done={17} total={25} blocking={2} />, ['onboarding', 'progress', 'gauge']),

  def('hr.onboarding.case.readiness', 'Activation Readiness', 'Share of this case ready to activate, by category.', 'fa-shield-halved', 'donut', 'tall', [ST, M], () => {
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const all = bucket(rows), d = bucket(rows.filter(matchDocs)), tr = bucket(rows.filter(matchTraining)), ac = bucket(rows.filter(t => matchProvision(t) || matchIT(t)));
    return <ReadinessView pct={pctOf(all.done, all.total)} docs={pctOf(d.done, d.total)} training={pctOf(tr.done, tr.total)} access={pctOf(ac.done, ac.total)} />;
  }, () => <ReadinessView pct={78} docs={84} training={71} access={66} />, ['onboarding', 'readiness', 'ring']),

  def('hr.onboarding.case.sla', 'SLA Countdown', 'Days remaining to this case’s target completion date.', 'fa-clock', 'metric', 'tall', [ST, M], () => {
    const caseRow = useOnboardingCaseStore(selectCaseRow);
    const days = daysUntil(caseRow?.dueAt);
    return <SlaView days={days} due={caseRow?.dueAt ? new Date(caseRow.dueAt).toLocaleDateString('en-US', { month: 'short', day: 'numeric' }) : '—'} />;
  }, () => <SlaView days={9} due="Jul 12" />, ['onboarding', 'sla', 'gauge']),

  def('hr.onboarding.case.blockers', 'Blockers', 'Active blockers holding up this case, with a resolve action.', 'fa-triangle-exclamation', 'status-stack', 'tall', [ST, M], () => {
    const caseId = useCid();
    const rows = (useOnboardingBlockersList({ caseId }).data ?? []) as OnboardingBlockerRow[];
    const active = rows.filter(b => ['active', 'acknowledged', 'waiting_on_owner', 'escalated'].includes(b.status));
    const resolve = useOnboardingResolveBlocker();
    const onResolve = (id: string): void => {
      void (async () => {
        const note = await dialog.prompt({ title: 'Resolution note (optional)' });
        if (note === null) return;
        resolve.mutate({ blockerId: id, note: note || null });
      })();
    };
    return <BlockersView count={active.length} critical={active.filter(b => b.severity === 'critical').length} high={active.filter(b => b.severity === 'high').length}
      top={active.slice(0, 2).map(b => ({ id: b.blockerId, title: b.blockerTitle, module: b.blockingModule }))} onResolve={onResolve} />;
  }, () => <BlockersView count={2} critical={1} high={1} top={[{ id: '1', title: 'NIS number missing', module: 'finance' }, { id: '2', title: 'Safety induction pending', module: 'hse' }]} />, ['onboarding', 'blockers', 'risk']),

  def('hr.onboarding.case.provisioning', 'Account Provisioning', 'Work email, login and mailbox provisioning progress.', 'fa-key', 'metric', 'standard', [M, ST], () => {
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const prov = rows.filter(matchProvision);
    const b = bucket(prov);
    const stepState = (re: RegExp): string => {
      const t = prov.find(x => re.test(`${x.taskTitle} ${x.moduleKey ?? ''}`.toLowerCase()));
      return !t ? '—' : ['completed', 'delivered', 'accepted'].includes(t.status) ? 'Done' : 'Pending';
    };
    return <ProvisionView pct={pctOf(b.done, b.total)} done={b.done} total={b.total} email={stepState(/email/)} login={stepState(/login|account|credential/)} mailbox={stepState(/mailbox|365/)} />;
  }, () => <ProvisionView pct={66} done={2} total={3} email="Done" login="Done" mailbox="Pending" />, ['onboarding', 'provisioning', 'battery']),

  def('hr.onboarding.case.training', 'Training', 'Training & induction completion for this case.', 'fa-graduation-cap', 'metric', 'compact', [S, ST], () => {
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const b = bucket(rows.filter(matchTraining));
    return <TrainingView pct={pctOf(b.done, b.total)} done={b.done} total={b.total} />;
  }, () => <TrainingView pct={71} done={5} total={7} />, ['onboarding', 'training']),

  def('hr.onboarding.case.approvals', 'Approvals', 'Pending approval handoffs for this case.', 'fa-circle-check', 'task-board', 'standard', [M, ST], () => {
    const rows = (useOnboardingHandoffsList({ caseId: useCid() }).data ?? []) as OnboardingHandoffRow[];
    const items = rows.filter(h => h.handoffType === 'approval' && isOpen(h.status)).map(h => ({ id: h.handoffId, title: humanize(h.targetModule), status: h.status }));
    return <ApprovalsView items={items} />;
  }, () => <ApprovalsView items={[{ id: '1', title: 'Finance', status: 'pending' }, { id: '2', title: 'HSE', status: 'sent' }]} />, ['onboarding', 'approvals']),

  def('hr.onboarding.case.due', 'Due This Week', 'Tasks due in the next 7 days, overdue first.', 'fa-calendar-check', 'task-board', 'standard', [M, ST], () => {
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const withDays = rows.filter(t => isOpen(t.status) && t.dueAt).map(t => ({ id: t.taskId, title: t.taskTitle, days: daysUntil(t.dueAt) ?? 0 })).filter(t => t.days <= 7).sort((a, b) => a.days - b.days);
    return <DueView count={withDays.length} overdue={withDays.filter(t => t.days < 0).length} items={withDays} />;
  }, () => <DueView count={4} overdue={1} items={[{ id: '1', title: 'Collect signed contract', days: -1 }, { id: '2', title: 'IT equipment request', days: 0 }, { id: '3', title: 'Safety induction', days: 3 }]} />, ['onboarding', 'due', 'overdue']),

  def('hr.onboarding.case.activity', 'Recent Activity', 'Latest events recorded against this case.', 'fa-wave-square', 'timeline', 'standard', [M, ST], () => {
    const rows = (useOnboardingAudit(useOnboardingCaseStore(selectCaseId)).data ?? []) as OnboardingAuditRow[];
    return <ActivityView items={rows.slice(0, 5).map(a => ({ id: a.id, action: a.action, who: a.actorName ?? (a.actorId ? '—' : 'System'), when: relTime(a.createdAt) }))} />;
  }, () => <ActivityView items={[{ id: '1', action: 'task_completed', who: 'A. Mohammed', when: '2h' }, { id: '2', action: 'blocker_resolved', who: 'IT Team', when: '5h' }, { id: '3', action: 'case_started', who: 'System', when: '2d' }]} />, ['onboarding', 'activity', 'timeline']),

  def('hr.onboarding.case.team', 'Team', 'Case owner and the people assigned to its tasks.', 'fa-user-group', 'people', 'compact', [S, ST], () => {
    const caseRow = useOnboardingCaseStore(selectCaseRow);
    const rows = useOnboardingTasksList({ caseId: useCid() }).data ?? [];
    const members = Array.from(new Set(rows.map(t => t.assignedToName).filter((n): n is string => !!n)));
    return <TeamView owner={caseRow?.ownerName ?? 'Unassigned'} members={members} />;
  }, () => <TeamView owner="S. Rampersad" members={['IT Team', 'HSE Officer', 'Payroll', 'A. Khan']} />, ['onboarding', 'team', 'people']),

  def('hr.onboarding.case.communications', 'Communications', 'Send and track welcome, supervisor, owner-reminder and escalation messages for this case.', 'fa-envelope', 'timeline', 'wide', [M, ST], CommunicationsWidget, () => (
    <div class="ocw tint-purple">
      <Head title="Communications" sub="Welcome · notify · remind" icon="fa-envelope" color="purple" />
      <div class="ocw-body">
        <div class="ocw-commbar"><select class="ocw-commsel"><option>Welcome the employee</option></select><span class="ocw-act-btn">Send</span></div>
        <div class="ocw-list">
          <div class="ocw-li"><span class="ocw-li-ico purple"><i class="fas fa-paper-plane" /></span><div class="ocw-li-main"><div class="ocw-li-title">Welcome aboard</div><div class="ocw-li-sub">A. Cole · 2h</div></div><span class="ocw-pill green">Sent</span></div>
          <div class="ocw-li"><span class="ocw-li-ico purple"><i class="fas fa-paper-plane" /></span><div class="ocw-li-main"><div class="ocw-li-title">New team member</div><div class="ocw-li-sub">S. Rampersad · 1d</div></div><span class="ocw-pill green">Sent</span></div>
        </div>
      </div>
    </div>
  ), ['onboarding', 'communications', 'messages']),

  def('hr.onboarding.case.timeline', 'Timeline', 'Full chronological history of this case — events, handoffs, workflows and audit.', 'fa-timeline', 'timeline', 'wide', [M, ST], TimelineWidget, () => (
    <div class="ocw tint-blue">
      <Head title="Timeline" sub="Full case history" icon="fa-timeline" color="blue" />
      <div class="ocw-body"><div class="ocw-timeline">
        {[{ t: 'Case started', w: 'System', a: '3d' }, { t: 'Task completed: Provision laptop', w: 'IT bot', a: '2d' }, { t: 'Handoff → HSE', w: 'A. Cole', a: '1d' }, { t: 'Blocker resolved', w: 'HSE Officer', a: '4h' }].map((r, i) => (
          <div class="ocw-tl-row" key={i}><span class="ocw-tl-dot" style={{ background: AC.green }} /><div class="ocw-tl-main"><div class="ocw-li-title">{r.t}</div><div class="ocw-li-sub">{r.w} · {r.a}</div></div></div>
        ))}
      </div></div>
    </div>
  ), ['onboarding', 'timeline', 'history']),

  // Audit — permission-gated (locked in the library unless the user holds audit.view).
  {
    id: 'hr.onboarding.case.audit', module: 'hr', area: 'onboarding', title: 'Audit Trail',
    description: 'Permission-gated compliance trail: every case action with before/after state and reason.',
    icon: 'fa-clipboard-list', category: 'Case', tags: ['onboarding', 'audit', 'compliance'],
    previewVariant: 'timeline', chrome: 'none', supportedPages: CASE_PAGES, supportedZones: CASE_ZONES,
    defaultSize: 'wide', allowedSizes: [M, ST], defaultConfig: {}, configSchema: [],
    dataSource: { sourceKey: 'hr_onboarding', label: 'HR Onboarding', refreshIntervalMs: 120000, permissions: ['hr.onboarding.audit.view'] },
    recommendedFor: CASE_PAGES, render: AuditWidget,
    renderPreview: () => (
      <div class="ocw tint-blue">
        <Head title="Audit Trail" sub="Compliance record" icon="fa-clipboard-list" color="blue" />
        <div class="ocw-body"><div class="ocw-audit">
          {[{ ac: 'Onboarding started', w: 'A. Cole', a: '3d' }, { ac: 'Owner changed', w: 'HR Ops', a: '2d' }].map((r, i) => (
            <div class="ocw-audit-row" key={i}><div class="ocw-audit-head"><b>{r.ac}</b><span class="ocw-li-sub">{r.a}</span></div><div class="ocw-li-sub">{r.w}</div></div>
          ))}
        </div></div>
      </div>
    ),
  },
];
