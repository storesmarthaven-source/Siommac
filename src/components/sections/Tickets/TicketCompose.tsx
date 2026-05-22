/**
 * src/components/sections/Tickets/TicketCompose.tsx
 *
 * New ticket form — replaces showCompose() / onSubmitClick() from TicketsPanel.ts.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { useState, useEffect } from 'preact/hooks';
import { Spinner }             from '@shared/Spinner';
import { useCreateTicket }     from './hooks';
import { TICKET_CATEGORIES }   from '@api/schemas/ticket';

interface TicketComposeProps {
  onBack:    () => void;
  onSuccess: (ticketNumber: string) => void;
}

export function TicketCompose({ onBack, onSuccess }: TicketComposeProps) {
  const [category, setCategory] = useState('general');
  const [subject,  setSubject]  = useState('');
  const [body,     setBody]     = useState('');
  const [errors,   setErrors]   = useState<{ subject?: string; body?: string }>({});

  const createMut = useCreateTicket({
    onSuccess: (ticketNumber) => {
      onSuccess(ticketNumber);
    },
  });

  // Reset form whenever the compose pane is freshly opened
  useEffect(() => {
    setCategory('general');
    setSubject('');
    setBody('');
    setErrors({});
  }, []);

  function validate(): boolean {
    const next: typeof errors = {};
    if (!subject.trim()) next.subject = 'Subject is required.';
    if (!body.trim())    next.body    = 'Please describe your issue.';
    setErrors(next);
    return Object.keys(next).length === 0;
  }

  function handleSubmit() {
    if (!validate() || createMut.isPending) return;
    createMut.mutate({ category, subject: subject.trim(), body: body.trim() });
  }

  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: 10, padding: '14px 16px', flex: 1, overflowY: 'auto' }}>

      {/* Category */}
      <select
        value={category}
        onChange={e => setCategory((e.target as HTMLSelectElement).value)}
        style={{ width: '100%', border: '1px solid var(--border)', borderRadius: 8, padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none' }}
      >
        {TICKET_CATEGORIES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      {/* Subject */}
      <div>
        <input
          type="text"
          placeholder="Subject"
          maxLength={120}
          value={subject}
          onInput={e => { setSubject((e.target as HTMLInputElement).value); setErrors(p => ({ ...p, subject: undefined })); }}
          style={{
            width: '100%', border: `1px solid ${errors.subject ? 'var(--siomac-red)' : 'var(--border)'}`,
            borderRadius: 8, padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none',
          }}
        />
        {errors.subject && (
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--siomac-red)' }}>{errors.subject}</p>
        )}
      </div>

      {/* Body */}
      <div>
        <textarea
          rows={5}
          placeholder="Describe your issue…"
          value={body}
          onInput={e => { setBody((e.target as HTMLTextAreaElement).value); setErrors(p => ({ ...p, body: undefined })); }}
          style={{
            width: '100%', border: `1px solid ${errors.body ? 'var(--siomac-red)' : 'var(--border)'}`,
            borderRadius: 8, padding: '8px 10px', fontSize: '0.82rem', fontFamily: 'inherit',
            resize: 'none', outline: 'none',
          }}
        />
        {errors.body && (
          <p style={{ margin: '2px 0 0', fontSize: '0.75rem', color: 'var(--siomac-red)' }}>{errors.body}</p>
        )}
      </div>

      {/* Actions */}
      <div style={{ display: 'flex', gap: 8, justifyContent: 'space-between', alignItems: 'center' }}>
        <button class="hdr-foot-link" style={{ color: 'var(--siomac-navy)' }} onClick={onBack}>
          <i class="fas fa-times" /> Cancel
        </button>
        <button
          class="hdr-foot-link"
          style={{ color: 'var(--siomac-blue)', opacity: createMut.isPending ? 0.6 : 1 }}
          disabled={createMut.isPending}
          onClick={handleSubmit}
        >
          {createMut.isPending
            ? <Spinner size={16} />
            : <><i class="fas fa-paper-plane" /> Submit Ticket</>
          }
        </button>
      </div>
    </div>
  );
}
