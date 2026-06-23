/**
 * src/components/sections/NotificationCenter/NotificationPreferencesPanel.tsx
 *
 * Per-user notification preferences + snooze, on the canonical engine
 * (notification_preferences + notification_mutes). The Default ('*') row
 * controls everything; specific event types override it. Snooze writes a
 * notification_mutes 'all' scope that the backend honours before delivering.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal } from '@ui';
import {
  useNotificationPreferences, useSetNotificationPreference, useMuteNotifications,
  type NotificationPreference,
} from '@api/communications';

/** Curated, friendly preference rows. '*' is the catch-all default. */
const ROWS: Array<{ eventType: string; label: string; sub: string }> = [
  { eventType: '*',                        label: 'All notifications',      sub: 'Default for everything not overridden below' },
  { eventType: 'hse.incident.submitted',   label: 'Incidents reported',     sub: 'A new incident is logged' },
  { eventType: 'hse.capa.assigned',        label: 'CAPA assigned to me',    sub: 'You are made the owner of a corrective action' },
  { eventType: 'hse.capa.overdue',         label: 'CAPA overdue',           sub: 'A corrective action passes its due date' },
  { eventType: 'hse.risk.approval_required', label: 'Risk/JSA approvals',   sub: 'A risk assessment or JSA needs your decision' },
  { eventType: 'workflow.task.assigned',   label: 'Workflow tasks',         sub: 'A workflow step is assigned to you' },
  { eventType: 'communications.broadcast', label: 'Announcements',          sub: 'Organisation-wide broadcasts' },
];

const DEFAULT_PREF: NotificationPreference = { event_type: '*', in_app: true, email: false, whatsapp: false };

function Toggle({ on, onClick }: { on: boolean; onClick: () => void }): VNode {
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

export function NotificationPreferencesPanel({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const { data, isLoading } = useNotificationPreferences();
  const setPref = useSetNotificationPreference();
  const mute = useMuteNotifications();
  const [snoozeMsg, setSnoozeMsg] = useState('');

  const byType = new Map<string, NotificationPreference>();
  if (data) {
    byType.set('*', data.defaults ?? DEFAULT_PREF);
    for (const p of data.preferences) byType.set(p.event_type, p);
  }
  const prefFor = (et: string): NotificationPreference => byType.get(et) ?? (et === '*' ? DEFAULT_PREF : { event_type: et, ...{ in_app: byType.get('*')?.in_app ?? true, email: byType.get('*')?.email ?? false, whatsapp: byType.get('*')?.whatsapp ?? false } });

  function toggle(et: string, field: 'in_app' | 'email' | 'whatsapp') {
    const cur = prefFor(et);
    setPref.mutate({ ...cur, event_type: et, eventType: et, [field]: !cur[field] });
  }

  function snooze(label: string, until: string | null) {
    mute.mutate({ scope: 'all', mutedUntil: until });
    setSnoozeMsg(`Notifications snoozed ${label}.`);
  }
  function resume() {
    mute.mutate({ scope: 'all', clear: true });
    setSnoozeMsg('Notifications resumed.');
  }

  const oneHour = () => new Date(Date.now() + 3_600_000).toISOString();
  const tomorrow = () => { const d = new Date(); d.setHours(24, 0, 0, 0); return d.toISOString(); };

  return (
    <Modal open={open} title="Notification Preferences" icon="fa-sliders" size="lg"
      onClose={onClose} footer={<button class="hse-btn primary" onClick={onClose}>Done</button>}>
      {/* Channels per type */}
      <div style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 80px', gap: '8px', alignItems: 'center', padding: '0 4px 8px', fontSize: '0.7rem', color: 'var(--text-muted)', textTransform: 'uppercase', letterSpacing: '.05em', fontWeight: 600 }}>
        <span>Notification</span><span style={{ textAlign: 'center' }}>In-app</span><span style={{ textAlign: 'center' }}>Email</span><span style={{ textAlign: 'center' }}>WhatsApp</span>
      </div>
      {isLoading && <div style={{ padding: '16px', color: 'var(--text-muted)' }}>Loading…</div>}
      {!isLoading && ROWS.map(r => {
        const p = prefFor(r.eventType);
        return (
          <div key={r.eventType} style={{ display: 'grid', gridTemplateColumns: '1fr 60px 60px 80px', gap: '8px', alignItems: 'center', padding: '10px 4px', borderTop: '1px solid var(--border)' }}>
            <div>
              <div style={{ fontSize: '0.84rem', fontWeight: 600, color: 'var(--siomac-navy)' }}>{r.label}</div>
              <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>{r.sub}</div>
            </div>
            <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={p.in_app} onClick={() => toggle(r.eventType, 'in_app')} /></span>
            <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={p.email} onClick={() => toggle(r.eventType, 'email')} /></span>
            <span style={{ display: 'flex', justifyContent: 'center' }}><Toggle on={p.whatsapp} onClick={() => toggle(r.eventType, 'whatsapp')} /></span>
          </div>
        );
      })}

      {/* Snooze / DND */}
      <div style={{ marginTop: '18px', paddingTop: '14px', borderTop: '2px solid var(--border)' }}>
        <div style={{ fontSize: '0.8rem', fontWeight: 700, color: 'var(--siomac-navy)', marginBottom: '8px' }}>
          <i class="fas fa-moon" style={{ marginRight: '6px' }} /> Snooze all notifications
        </div>
        <div style={{ display: 'flex', gap: '8px', flexWrap: 'wrap' }}>
          <button class="inc-action-btn" onClick={() => snooze('for 1 hour', oneHour())}>1 hour</button>
          <button class="inc-action-btn" onClick={() => snooze('until tomorrow', tomorrow())}>Until tomorrow</button>
          <button class="inc-action-btn" onClick={() => snooze('indefinitely', null)}>Indefinitely</button>
          <button class="inc-action-btn primary" onClick={resume}><i class="fas fa-bell" /> Resume</button>
        </div>
        {snoozeMsg && <div style={{ marginTop: '8px', fontSize: '0.76rem', color: 'var(--text-muted)' }}>{snoozeMsg}</div>}
      </div>
    </Modal>
  );
}
