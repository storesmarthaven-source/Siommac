/**
 * src/components/sections/Messages/ComposePane.tsx
 *
 * New message compose pane. Admins/managers can select a recipient;
 * employees always send to admin.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { h }               from 'preact';
import { useState }        from 'preact/hooks';
import { useSessionStore } from '@store/session';
import { useSendMessage, useEmployeesForMsg } from './hooks';

interface ComposePaneProps {
  onBack:    () => void;
  onSuccess: () => void;
}

export function ComposePane({ onBack, onSuccess }: ComposePaneProps) {
  const role    = useSessionStore(s => s.role);
  const isAdmin = role === 'admin' || role === 'manager';

  const [toUsername, setToUsername] = useState('');
  const [subject,    setSubject]    = useState('');
  const [body,       setBody]       = useState('');

  const { data: employees = [] } = useEmployeesForMsg();
  const sendMut = useSendMessage({ onSuccess });

  const canSend = (isAdmin ? !!toUsername : true) && !!subject.trim() && !!body.trim();

  function handleSend() {
    if (!canSend || sendMut.isPending) return;
    sendMut.mutate({ subject: subject.trim(), body: body.trim(), toUsername: isAdmin ? toUsername : '' });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px' }}>
      {/* Recipient — admins only */}
      {isAdmin && (
        <div>
          <select
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none' }}
            value={toUsername}
            onChange={(e: Event) => setToUsername((e.target as HTMLSelectElement).value)}
          >
            <option value="">— Select employee —</option>
            {employees.map(emp => (
              <option key={emp.username} value={emp.username}>
                {emp.fullName} ({emp.role})
              </option>
            ))}
          </select>
        </div>
      )}

      {/* Subject */}
      <input
        type="text"
        placeholder="Subject"
        maxLength={120}
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none' }}
        value={subject}
        onInput={(e: Event) => setSubject((e.target as HTMLInputElement).value)}
      />

      {/* Body */}
      <textarea
        rows={4}
        placeholder="Write your message…"
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.82rem', fontFamily: 'inherit', resize: 'none', outline: 'none' }}
        value={body}
        onInput={(e: Event) => setBody((e.target as HTMLTextAreaElement).value)}
      />

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between' }}>
        <button class="hdr-foot-link" onClick={onBack} disabled={sendMut.isPending}>
          <i class="fas fa-times" /> Cancel
        </button>
        <button
          class="hdr-foot-link"
          style={{ color: 'var(--siomac-blue)', opacity: (!canSend || sendMut.isPending) ? 0.4 : 1 }}
          disabled={!canSend || sendMut.isPending}
          onClick={handleSend}
        >
          <i class={`fas fa-${sendMut.isPending ? 'spinner fa-spin' : 'paper-plane'}`} /> Send
        </button>
      </div>
    </div>
  );
}
