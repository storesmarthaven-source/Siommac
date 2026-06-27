/**
 * src/components/sections/Messages/ComposeThreadDialog.tsx
 *
 * New thread compose modal. Uses the @ui Modal component.
 * RecipientPicker uses useMessageRecipients for autocomplete.
 * Validates: at least 1 recipient + non-empty body. Subject optional.
 */

import { type VNode } from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';
import { Modal } from '@ui';
import {
  useCreateMessageThread, useMessageRecipients,
  type MessageRecipient,
} from '@api/communications';

interface Props {
  open:      boolean;
  onClose:   () => void;
  onCreated: (threadId: string) => void;
}

function initials(r: MessageRecipient): string {
  const n = r.displayName ?? r.username ?? '?';
  const parts = n.trim().split(/\s+/);
  return ((parts[0]?.[0] ?? '') + (parts[1]?.[0] ?? '')).toUpperCase() || '?';
}

export function ComposeThreadDialog({ open, onClose, onCreated }: Props): VNode {
  const [recipientSearch, setRecipientSearch] = useState('');
  const [selectedRecipients, setSelectedRecipients] = useState<MessageRecipient[]>([]);
  const [subject, setSubject]   = useState('');
  const [body, setBody]         = useState('');
  const [pickerOpen, setPickerOpen] = useState(false);
  const pickerRef = useRef<HTMLDivElement>(null);
  const inputRef  = useRef<HTMLInputElement>(null);

  const { data: suggestions = [] } = useMessageRecipients(recipientSearch);
  const createThread = useCreateMessageThread();

  // Close picker on outside click
  useEffect(() => {
    if (!pickerOpen) return;
    const onDown = (e: MouseEvent) => {
      if (pickerRef.current?.contains(e.target as Node)) return;
      setPickerOpen(false);
    };
    document.addEventListener('mousedown', onDown);
    return () => document.removeEventListener('mousedown', onDown);
  }, [pickerOpen]);

  // Reset on open
  useEffect(() => {
    if (open) {
      setRecipientSearch('');
      setSelectedRecipients([]);
      setSubject('');
      setBody('');
      setPickerOpen(false);
    }
  }, [open]);

  function addRecipient(r: MessageRecipient) {
    if (!selectedRecipients.find(x => x.userId === r.userId)) {
      setSelectedRecipients(prev => [...prev, r]);
    }
    setRecipientSearch('');
    setPickerOpen(false);
  }

  function removeRecipient(userId: string) {
    setSelectedRecipients(prev => prev.filter(r => r.userId !== userId));
  }

  const filteredSuggestions = suggestions.filter(
    s => !selectedRecipients.find(r => r.userId === s.userId),
  );

  const canSend = selectedRecipients.length >= 1 && body.trim().length > 0 && !createThread.isPending;

  function handleSend() {
    if (!canSend) return;
    createThread.mutate({
      threadType:         selectedRecipients.length === 1 ? 'direct' : 'group',
      subject:            subject.trim() || undefined,
      participantUserIds: selectedRecipients.map(r => r.userId),
      body:               body.trim(),
    }, {
      onSuccess: (res) => {
        onCreated(res.threadId);
      },
    });
  }

  return (
    <Modal
      open={open}
      title="New Message"
      sub="Start a conversation with one or more people."
      icon="fa-pen-to-square"
      size="md"
      onClose={onClose}
      onSubmit={handleSend}
      submitLabel={createThread.isPending ? 'Sending…' : 'Send'}
      submitDisabled={!canSend}
    >
      <div style={{ display: 'flex', flexDirection: 'column', gap: '14px' }}>
        {/* Recipient picker */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
            To <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          {/* Selected pills */}
          {selectedRecipients.length > 0 && (
            <div style={{ display: 'flex', flexWrap: 'wrap', gap: '5px', marginBottom: '6px' }}>
              {selectedRecipients.map(r => (
                <span key={r.userId} style={{ display: 'inline-flex', alignItems: 'center', gap: '5px',
                  background: 'rgba(27,45,85,0.09)', borderRadius: '20px', padding: '3px 10px 3px 7px',
                  fontSize: '0.78rem', fontWeight: 600, color: 'var(--siomac-navy)' }}>
                  <span style={{ width: '20px', height: '20px', borderRadius: '50%', background: 'var(--siomac-navy)',
                    color: '#fff', fontSize: '0.58rem', fontWeight: 'var(--font-weight-bold)', display: 'inline-flex',
                    alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                    {initials(r)}
                  </span>
                  {r.displayName ?? r.username}
                  <button onClick={() => removeRecipient(r.userId)}
                    style={{ background: 'none', border: 'none', cursor: 'pointer', color: 'var(--text-muted)',
                      padding: '0', lineHeight: 1, fontSize: '0.75rem' }} aria-label="Remove">
                    <i class="fas fa-xmark" />
                  </button>
                </span>
              ))}
            </div>
          )}
          <div style={{ position: 'relative' }} ref={pickerRef}>
            <input
              ref={inputRef}
              type="text"
              placeholder="Search by name or username…"
              value={recipientSearch}
              onInput={e => { setRecipientSearch((e.target as HTMLInputElement).value); setPickerOpen(true); }}
              onFocus={() => setPickerOpen(true)}
              style={{ width: '100%', border: '1px solid var(--border)', borderRadius: '8px',
                padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none',
                boxSizing: 'border-box' }}
            />
            {pickerOpen && filteredSuggestions.length > 0 && (
              <div style={{ position: 'absolute', top: '100%', left: 0, right: 0, zIndex: 50, marginTop: '2px',
                background: 'var(--bg-card)', border: '1px solid var(--border)', borderRadius: '8px',
                boxShadow: 'var(--elev-4)', maxHeight: '200px', overflowY: 'auto' }}>
                {filteredSuggestions.map(r => (
                  <button key={r.userId} onClick={() => addRecipient(r)}
                    style={{ display: 'flex', alignItems: 'center', gap: '10px', width: '100%', padding: '9px 12px',
                      background: 'none', border: 'none', cursor: 'pointer', textAlign: 'left',
                      borderBottom: '1px solid var(--border)' }}>
                    <span style={{ width: '28px', height: '28px', borderRadius: '50%', background: 'rgba(27,45,85,0.12)',
                      color: 'var(--siomac-navy)', fontSize: '0.7rem', fontWeight: 'var(--font-weight-bold)', display: 'inline-flex',
                      alignItems: 'center', justifyContent: 'center', flexShrink: 0 }}>
                      {initials(r)}
                    </span>
                    <div>
                      <div style={{ fontSize: '0.83rem', fontWeight: 600, color: 'var(--siomac-navy)' }}>
                        {r.displayName ?? r.username}
                      </div>
                      <div style={{ fontSize: '0.7rem', color: 'var(--text-muted)' }}>
                        {r.role}{r.department ? ` · ${r.department}` : ''}
                      </div>
                    </div>
                  </button>
                ))}
              </div>
            )}
          </div>
        </div>

        {/* Subject (optional) */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
            Subject <span style={{ color: 'var(--text-muted)', fontWeight: 400 }}>(optional)</span>
          </label>
          <input
            type="text"
            placeholder="e.g. Re: Incident report INV-001"
            maxLength={120}
            value={subject}
            onInput={e => setSubject((e.target as HTMLInputElement).value)}
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: '8px',
              padding: '8px 10px', fontSize: '0.83rem', fontFamily: 'inherit', outline: 'none',
              boxSizing: 'border-box' }}
          />
        </div>

        {/* Body */}
        <div>
          <label style={{ fontSize: '0.78rem', fontWeight: 'var(--font-weight-bold)', color: 'var(--text-muted)',
            textTransform: 'uppercase', letterSpacing: '0.05em', display: 'block', marginBottom: '6px' }}>
            Message <span style={{ color: 'var(--siomac-red)' }}>*</span>
          </label>
          <textarea
            placeholder="Write your message…"
            rows={5}
            value={body}
            onInput={e => setBody((e.target as HTMLTextAreaElement).value)}
            style={{ width: '100%', border: '1px solid var(--border)', borderRadius: '8px',
              padding: '8px 10px', fontSize: '0.82rem', fontFamily: 'inherit', resize: 'vertical',
              outline: 'none', boxSizing: 'border-box' }}
          />
        </div>

        {createThread.isError && (
          <div style={{ fontSize: '0.82rem', color: 'var(--siomac-red)' }}>
            <i class="fas fa-circle-exclamation" style={{ marginRight: '5px' }} />
            Failed to send. Please try again.
          </div>
        )}
      </div>
    </Modal>
  );
}
