/**
 * src/components/sections/NotificationCenter/NotificationPreferencesPanel.tsx
 *
 * Per-user notification preferences + snooze, on the canonical engine
 * (notification_preferences + notification_mutes). Grouped by category with a
 * separated Default ('*') block that controls everything not overridden below.
 * Safety-critical alerts keep in-app delivery locked on. Snooze is state-based
 * (Resume only appears while snoozed). Changes autosave with a saved indicator.
 */

import { type VNode } from 'preact';
import { Modal } from '@ui';
import {
  useNotificationPreferences, useSetNotificationPreference, useMuteNotifications,
  type NotificationPreference,
} from '@api/communications';

interface Row { eventType: string; label: string; sub: string }
interface Group { title: string; sub?: string; locked?: boolean; rows: Row[] }

/** Safety-critical alerts: in-app delivery cannot be turned off. */
const CRITICAL: Group = {
  title: 'Critical alerts',
  sub: 'Safety-critical — in-app delivery stays on and cannot be disabled.',
  locked: true,
  rows: [
    { eventType: 'hse.incident.critical',      label: 'Critical incidents', sub: 'A critical incident is reported' },
    { eventType: 'hse.ptw.expired',            label: 'Permit expired',     sub: 'A permit to work passes its expiry' },
    { eventType: 'hse.capa.escalated',         label: 'CAPA escalated',     sub: 'An overdue corrective action is escalated' },
  ],
};

const GROUPS: Group[] = [
  CRITICAL,
  {
    title: 'HSE',
    rows: [
      { eventType: 'hse.incident.submitted',     label: 'Incidents reported',  sub: 'A new incident is logged' },
      { eventType: 'hse.capa.assigned',          label: 'CAPA assigned to me', sub: 'You are made the owner of a corrective action' },
      { eventType: 'hse.capa.overdue',           label: 'CAPA overdue',        sub: 'A corrective action passes its due date' },
      { eventType: 'hse.risk.approval_required', label: 'Risk / JSA approvals',sub: 'A risk assessment or JSA needs your decision' },
    ],
  },
  {
    title: 'Workflow',
    rows: [
      { eventType: 'workflow.task.assigned',     label: 'Workflow tasks',      sub: 'A workflow step is assigned to you' },
    ],
  },
  {
    title: 'Announcements',
    rows: [
      { eventType: 'communications.broadcast',   label: 'Announcements',       sub: 'Organisation-wide broadcasts' },
    ],
  },
];

const DEFAULT_PREF: NotificationPreference = { event_type: '*', in_app: true, email: false, whatsapp: false };
const COLS = '1fr 64px 64px 86px';

function Toggle({ on, locked, onClick }: { on: boolean; locked?: boolean; onClick?: () => void }): VNode {
  if (locked) {
    return (
      <span title="Locked on for safety-critical alerts" style={{
        display: 'inline-flex', alignItems: 'center', justifyContent: 'center',
        width: '38px', height: '20px', borderRadius: '11px', background: 'var(--siomac-navy)', color: '#fff', fontSize: '0.6rem',
      }}>
        <i class="fas fa-lock" />
      </span>
    );
  }
  return (
    <button type="button" onClick={onClick} aria-pressed={on} style={{
      width: '38px', height: '20px', borderRadius: '11px', border: 'none', cursor: 'pointer',
      background: on ? 'var(--siomac-navy)' : '#cbd5e1', position: 'relative', transition: 'background .15s',
    }}>
      <span style={{ position: 'absolute', top: '2px', left: on ? '20px' : '2px', width: '16px', height: '16px',
        borderRadius: '50%', background: '#fff', transition: 'left .15s', boxShadow: '0 1px 2px rgba(0,0,0,.25)' }} />
    </button>
  );
}

function formatUntil(iso: string | null): string {
  if (!iso) return 'indefinitely';
  const d = new Date(iso);
  const today = new Date(); today.setHours(0, 0, 0, 0);
  const tdiff = Math.round((new Date(d).setHours(0, 0, 0, 0) - today.getTime()) / 86_400_000);
  const time = d.toLocaleTimeString(undefined, { hour: 'numeric', minute: '2-digit' });
  if (tdiff === 0) return `until ${time} today`;
  if (tdiff === 1) return `until ${time} tomorrow`;
  return `until ${d.toLocaleDateString(undefined, { day: 'numeric', month: 'short' })}, ${time}`;
}

export function NotificationPreferencesPanel({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const { data, isLoading } = useNotificationPreferences();
  const setPref = useSetNotificationPreference();
  const mute = useMuteNotifications();

  const byType = new Map<string, NotificationPreference>();
  if (data) {
    byType.set('*', data.defaults ?? DEFAULT_PREF);
    for (const p of data.preferences) byType.set(p.event_type, p);
  }
  const def = byType.get('*') ?? DEFAULT_PREF;
  const prefFor = (et: string): NotificationPreference =>
    byType.get(et) ?? (et === '*' ? DEFAULT_PREF : { event_type: et, in_app: def.in_app, email: def.email, whatsapp: def.whatsapp });

  function toggle(et: string, field: 'in_app' | 'email' | 'whatsapp') {
    const cur = prefFor(et);
    setPref.mutate({ ...cur, event_type: et, eventType: et, [field]: !cur[field] });
  }

  const oneHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const tomorrow = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString(); };
  function snooze(until: string | null) { mute.mutate({ scope: 'all', mutedUntil: until }); }
  function resume() { mute.mutate({ scope: 'all', clear: true }); }

  const snoozed = data?.snooze ?? null;
  const saving = setPref.isPending || mute.isPending;
  const saved = !saving && (setPref.isSuccess || mute.isSuccess);

  function renderRow(r: Row, locked?: boolean): VNode {
    const p = prefFor(r.eventType);
    return (
      <div key={r.eventType} style={{ display: 'grid', gridTemplateColumns: COLS, gap: '8px', alignItems: 'center', padding: '10px 4px', borderTop: '1px solid var(--border)' }}>
        <div>
          <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--siomac-navy)' }}>{r.label}</div>
          <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.sub}</div>
        </div>
        <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={locked ? true : p.in_app} locked={locked} onClick={() => toggle(r.eventType, 'in_app')} /></span>
        <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={p.email} onClick={() => toggle(r.eventType, 'email')} /></span>
        <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={p.whatsapp} onClick={() => toggle(r.eventType, 'whatsapp')} /></span>
      </div>
    );
  }

  return (
    <Modal open={open} title="Notification Preferences" icon="fa-sliders" size="lg" onClose={onClose}
      footer={
        <div style={{ display: 'flex', alignItems: 'center', width: '100%' }}>
          <span style={{ fontSize: '0.74rem', color: 'var(--text-muted)' }}>
            {saving ? <><i class="fas fa-circle-notch fa-spin" style={{ marginRight: '6px' }} />Saving…</>
              : saved ? <><i class="fas fa-check" style={{ marginRight: '6px', color: '#16a34a' }} />All changes saved</>
              : 'Changes save automatically'}
          </span>
          <button class="hse-btn primary" style={{ marginLeft: 'auto' }} onClick={onClose}>Done</button>
        </div>
      }>
      <p style={{ fontSize: '0.78rem', color: 'var(--text-muted)', margin: '0 4px 14px' }}>
        Control how you receive ERP alerts, approvals, assignments and reminders. Email &amp; WhatsApp delivery
        activate once those channels are connected for your account.
      </p>

      {/* Column headers */}
      <div style={{ display: 'grid', gridTemplateColumns: COLS, gap: '8px', alignItems: 'center', padding: '0 4px 8px', fontSize: '0.68rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
        <span>Notification</span><span style={{ textAlign: 'center' }}>In-app</span><span style={{ textAlign: 'center' }}>Email</span><span style={{ textAlign: 'center' }}>WhatsApp</span>
      </div>

      {isLoading && <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Loading…</div>}

      {!isLoading && (
        <>
          {/* Default channels block */}
          <div style={{ background: 'var(--bg-subtle, #f7f8fa)', border: '1px solid var(--border)', borderRadius: '10px', padding: '4px 12px 10px', marginBottom: '16px' }}>
            <div style={{ fontSize: '0.72rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '.04em', padding: '10px 0 2px' }}>
              Default channels
            </div>
            <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', paddingBottom: '2px' }}>
              Applies to anything not customised below.
            </div>
            {renderRow({ eventType: '*', label: 'All notifications', sub: 'Default for every alert type' })}
          </div>

          {/* Grouped categories */}
          {GROUPS.map(g => (
            <div key={g.title} style={{ marginBottom: '18px' }}>
              <div style={{ display: 'flex', alignItems: 'center', gap: '8px' }}>
                <span style={{ fontSize: '0.74rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', textTransform: 'uppercase', letterSpacing: '.04em' }}>{g.title}</span>
                {g.locked && <i class="fas fa-shield-halved" style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }} />}
              </div>
              {g.sub && <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)', marginTop: '1px' }}>{g.sub}</div>}
              {g.rows.map(r => renderRow(r, g.locked))}
            </div>
          ))}

          {/* Snooze / Quiet mode — state-based */}
          <div style={{ marginTop: '6px', paddingTop: '14px', borderTop: '2px solid var(--border)' }}>
            <div style={{ fontSize: '0.8rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--siomac-navy)', marginBottom: '4px' }}>
              <i class="fas fa-moon" style={{ marginRight: '6px' }} /> Snooze / quiet mode
            </div>
            {snoozed ? (
              <div style={{ display: 'flex', alignItems: 'center', gap: '12px', flexWrap: 'wrap' }}>
                <span style={{ fontSize: '0.78rem', color: 'var(--siomac-navy)' }}>
                  Non-critical notifications are snoozed {formatUntil(snoozed.mutedUntil)}.
                </span>
                <button class="inc-action-btn" style={{ marginLeft: 'auto' }} disabled={mute.isPending} onClick={resume}>
                  <i class="fas fa-bell" /> Resume now
                </button>
              </div>
            ) : (
              <>
                <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', marginBottom: '8px' }}>
                  Pause non-critical notifications temporarily. Safety-critical alerts always come through.
                </div>
                <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
                  <button class="inc-action-btn" disabled={mute.isPending} onClick={() => snooze(oneHour())}>1 hour</button>
                  <button class="inc-action-btn" disabled={mute.isPending} onClick={() => snooze(tomorrow())}>Until tomorrow</button>
                  <button class="inc-action-btn" disabled={mute.isPending} onClick={() => snooze(null)}>Indefinitely</button>
                </div>
              </>
            )}
          </div>
        </>
      )}
    </Modal>
  );
}
