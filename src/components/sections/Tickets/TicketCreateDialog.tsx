import { type VNode } from 'preact';
import { useEffect, useState } from 'preact/hooks';
import { Modal } from '@ui';
import { useCreateTicket, useTicketRequestTypes } from '@api/communications';
import { toast } from '@store/ui';

export function TicketCreateDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated?: (ticketId: string) => void;
}): VNode | null {
  const typesQ = useTicketRequestTypes();
  const create = useCreateTicket();
  const [requestTypeCode, setRequestTypeCode] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');

  useEffect(() => {
    if (!open) return;
    const first = typesQ.data?.[0];
    if (first && !requestTypeCode) {
      setRequestTypeCode(first.code);
      setPriority(first.defaultPriority);
    }
  }, [open, requestTypeCode, typesQ.data]);

  const selectedType = typesQ.data?.find(type => type.code === requestTypeCode);
  const valid = !!requestTypeCode && !!subject.trim() && !!description.trim() && !create.isPending;

  function close(): void {
    if (create.isPending) return;
    setSubject('');
    setDescription('');
    onClose();
  }

  function submit(): void {
    if (!valid) return;
    create.mutate({
      requestTypeCode,
      priority,
      subject: subject.trim(),
      description: description.trim(),
    }, {
      onSuccess: result => {
        toast.success(`Ticket ${result.data.ticketNumber} created.`);
        const ticketId = result.data.ticketId;
        close();
        onCreated?.(ticketId);
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Could not create ticket.'),
    });
  }

  return (
    <Modal
      open={open}
      title="Create ticket"
      sub="Send a request to the correct SIOMAC service queue."
      icon="fa-ticket"
      size="md"
      onClose={close}
      onSubmit={submit}
      submitLabel={create.isPending ? 'Creating…' : 'Create ticket'}
      submitDisabled={!valid}
    >
      <div class="tc-form">
        <label>Request type
          <select value={requestTypeCode} onChange={event => {
            const code = event.currentTarget.value;
            setRequestTypeCode(code);
            const type = typesQ.data?.find(row => row.code === code);
            if (type) setPriority(type.defaultPriority);
          }} disabled={typesQ.isLoading}>
            <option value="">{typesQ.isLoading ? 'Loading request types…' : 'Select request type'}</option>
            {(typesQ.data ?? []).map(type => <option value={type.code} key={type.code}>{type.queueLabel} · {type.label}</option>)}
          </select>
        </label>
        {selectedType && <p class="tc-form-hint">{selectedType.description}</p>}
        <label>Priority
          <select value={priority} onChange={event => setPriority(event.currentTarget.value as typeof priority)}>
            <option value="low">Low</option>
            <option value="medium">Medium</option>
            <option value="high">High</option>
            <option value="critical">Critical</option>
          </select>
        </label>
        <label>Subject
          <input value={subject} maxLength={200} onInput={event => setSubject(event.currentTarget.value)} placeholder="What do you need help with?" />
        </label>
        <label>Description
          <textarea value={description} maxLength={5000} rows={6} onInput={event => setDescription(event.currentTarget.value)} placeholder="Add the details the service team needs to respond." />
        </label>
      </div>
    </Modal>
  );
}
