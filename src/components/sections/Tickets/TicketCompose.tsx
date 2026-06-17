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
        class="form-select"
        value={category}
        onChange={e => setCategory((e.target as HTMLSelectElement).value)}
      >
        {TICKET_CATEGORIES.map(c => (
          <option key={c.value} value={c.value}>{c.label}</option>
        ))}
      </select>

      {/* Subject */}
      <div>
        <input
          type="text"
          class={`form-control${errors.subject ? ' field-invalid' : ''}`}
          placeholder="Subject"
          maxLength={120}
          value={subject}
          onInput={e => { setSubject((e.target as HTMLInputElement).value); setErrors(p => ({ ...p, subject: undefined })); }}
        />
        {errors.subject && (
          <p class="field-error-msg">{errors.subject}</p>
        )}
      </div>

      {/* Body */}
      <div>
        <textarea
          rows={5}
          class={`form-control${errors.body ? ' field-invalid' : ''}`}
          placeholder="Describe your issue…"
          value={body}
          onInput={e => { setBody((e.target as HTMLTextAreaElement).value); setErrors(p => ({ ...p, body: undefined })); }}
          style={{ resize: 'none' }}
        />
        {errors.body && (
          <p class="field-error-msg">{errors.body}</p>
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
