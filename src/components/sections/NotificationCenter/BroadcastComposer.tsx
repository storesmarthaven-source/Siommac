/**
 * src/components/sections/NotificationCenter/BroadcastComposer.tsx
 *
 * Admin broadcast composer (communications.admin). Sends a notification to an
 * audience (all / role / department / specific users) through the same engine
 * (emitAppEvent → notifications) via /communications/notifications/broadcast.
 */

import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Modal, Field, TextInput, TextareaInput, SelectInput } from '@ui';
import { useBroadcastNotification } from '@api/communications';

const AUDIENCE = [
  { value: 'all',        label: 'All users' },
  { value: 'role',       label: 'Role' },
  { value: 'department', label: 'Department' },
  { value: 'users',      label: 'Specific users (ids)' },
] as const;

export function BroadcastComposer({ open, onClose }: { open: boolean; onClose: () => void }): VNode {
  const [audienceType, setAudienceType] = useState('all');
  const [audienceValue, setAudienceValue] = useState('');
  const [severity, setSeverity] = useState('info');
  const [title, setTitle] = useState('');
  const [body, setBody] = useState('');
  const [actionRoute, setActionRoute] = useState('');
  const [error, setError] = useState('');
  const [sent, setSent] = useState<number | null>(null);

  const broadcast = useBroadcastNotification();

  function reset() {
    setAudienceType('all'); setAudienceValue(''); setSeverity('info');
    setTitle(''); setBody(''); setActionRoute(''); setError(''); setSent(null);
  }
  function close() { reset(); onClose(); }

  async function send() {
    if (!title.trim() || !body.trim()) { setError('Title and message are required'); return; }
    setError('');
    try {
      const res = await broadcast.mutateAsync({
        audience: {
          type: audienceType as 'all' | 'role' | 'department' | 'users',
          value: audienceType === 'role' || audienceType === 'department' ? audienceValue.trim() : undefined,
          userIds: audienceType === 'users' ? audienceValue.split(',').map(s => s.trim()).filter(Boolean) : undefined,
        },
        severity: severity as 'info' | 'success' | 'warning' | 'critical',
        title: title.trim(), body: body.trim(),
        actionRoute: actionRoute.trim() || undefined,
      });
      setSent(res.recipientCount);
    } catch (e) {
      setError(e instanceof Error ? e.message : 'Broadcast failed');
    }
  }

  return (
    <Modal
      open={open} title="Broadcast Notification" icon="fa-bullhorn"
      sub="Send a notification to a group of users."
      onClose={close}
      onSubmit={() => { void send(); }}
      submitLabel={broadcast.isPending ? 'Sending…' : 'Send'}
      submitDisabled={broadcast.isPending}
    >
      {sent != null ? (
        <div style={{ padding: '12px', textAlign: 'center', color: 'var(--color-success, #16a34a)' }}>
          <i class="fas fa-check-circle" style={{ fontSize: '1.6rem' }} />
          <div style={{ marginTop: '6px' }}>Sent to {sent} recipient{sent === 1 ? '' : 's'}.</div>
        </div>
      ) : (
        <>
          <div style={{ display: 'flex', gap: '10px' }}>
            <div style={{ flex: 1 }}>
              <Field label="Audience">
                <SelectInput value={audienceType} onInput={v => { setAudienceType(v); setAudienceValue(''); }}
                  options={AUDIENCE.map(a => ({ value: a.value, label: a.label }))} />
              </Field>
            </div>
            {(audienceType === 'role' || audienceType === 'department' || audienceType === 'users') && (
              <div style={{ flex: 1 }}>
                <Field label={audienceType === 'users' ? 'User ids (comma-separated)' : audienceType === 'role' ? 'Role' : 'Department id'}>
                  <TextInput value={audienceValue} onInput={setAudienceValue}
                    placeholder={audienceType === 'role' ? 'e.g. manager' : audienceType === 'department' ? 'DEPT-XXXX' : 'USR-1, USR-2'} />
                </Field>
              </div>
            )}
            <div style={{ width: '160px' }}>
              <Field label="Severity">
                <SelectInput value={severity} onInput={setSeverity}
                  options={[{ value: 'info', label: 'Info' }, { value: 'success', label: 'Success' }, { value: 'warning', label: 'Warning' }, { value: 'critical', label: 'Critical' }]} />
              </Field>
            </div>
          </div>
          <Field label="Title *" wide><TextInput value={title} onInput={setTitle} placeholder="Headline" /></Field>
          <Field label="Message *" wide><TextareaInput value={body} onInput={setBody} rows={3} placeholder="What do you want people to know?" /></Field>
          <Field label="Action link (optional)" wide><TextInput value={actionRoute} onInput={setActionRoute} placeholder="/hse/incidents/INC-..." /></Field>
          {error && <div style={{ color: 'var(--siomac-red)', fontSize: '0.78rem', marginTop: '8px' }}>{error}</div>}
        </>
      )}
    </Modal>
  );
}
