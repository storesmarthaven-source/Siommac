import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { Modal } from '@ui';
import {
  useCreateTicket,
  useTicketRequestTypes,
  useTicketRequesterSearch,
  type CreateTicketArgs,
  type TicketRequesterOption,
} from '@api/communications';
import { useCan } from '@lib/permissions';
import { toast } from '@store/ui';

type CreationMode = 'self' | 'team' | 'on_behalf' | 'internal';

// Ordered so the mode selector always reads self → team → on-behalf → internal.
const MODE_ORDER: CreationMode[] = ['self', 'team', 'on_behalf', 'internal'];

const MODE_META: Record<CreationMode, { label: string; hint: string; icon: string }> = {
  self:      { label: 'For myself',        icon: 'fa-user',       hint: 'Raise a request for yourself.' },
  team:      { label: 'For a team member', icon: 'fa-user-group', hint: 'Raise a request for one of your active direct reports.' },
  on_behalf: { label: 'On behalf of…',     icon: 'fa-user-pen',   hint: 'Raise a request for another employee. A reason is required.' },
  internal:  { label: 'Internal work',     icon: 'fa-briefcase',  hint: 'Log internal work for a service queue you handle.' },
};

function initials(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(word => word[0]).join('').toUpperCase() || 'U';
}

// Searchable async requester picker, tc-scoped to match the Ticket Center design.
// The server scopes results: team ⇒ active direct reports; on-behalf ⇒ active
// users only when the actor holds tickets.create_on_behalf.
function RequesterPicker({ mode, value, selectedLabel, onSelect, onBlur, hasError }: {
  mode: 'team' | 'on_behalf';
  value: string;
  selectedLabel: string;
  onSelect: (option: TicketRequesterOption | null) => void;
  onBlur: () => void;
  hasError: boolean;
}): VNode {
  const [query, setQuery] = useState('');
  const [debounced, setDebounced] = useState('');
  const [open, setOpen] = useState(false);
  const rootRef = useRef<HTMLDivElement>(null);
  const inputRef = useRef<HTMLInputElement>(null);

  useEffect(() => {
    const timer = window.setTimeout(() => setDebounced(query.trim()), 250);
    return () => window.clearTimeout(timer);
  }, [query]);

  // Fetch only while the dropdown is open (empty query lists the default set).
  const searchQ = useTicketRequesterSearch(mode, debounced, open);
  const options = searchQ.data ?? [];

  useEffect(() => {
    if (!open) return;
    const handler = (event: MouseEvent): void => {
      if (rootRef.current && !rootRef.current.contains(event.target as Node)) {
        setOpen(false);
        setQuery('');
        onBlur();
      }
    };
    document.addEventListener('mousedown', handler);
    return () => document.removeEventListener('mousedown', handler);
  }, [open, onBlur]);

  function select(option: TicketRequesterOption): void {
    onSelect(option);
    setOpen(false);
    setQuery('');
  }

  const display = open ? query : selectedLabel;

  return (
    <div class={`tc-picker${open ? ' open' : ''}${hasError ? ' error' : ''}`} ref={rootRef}>
      <div class="tc-picker-control">
        <i class="fas fa-magnifying-glass" />
        <input
          ref={inputRef}
          type="text"
          value={display}
          placeholder={mode === 'team' ? 'Search your team…' : 'Search employees…'}
          aria-expanded={open}
          aria-autocomplete="list"
          autocomplete="off"
          onInput={event => { setQuery(event.currentTarget.value); setOpen(true); }}
          onFocus={() => setOpen(true)}
          onKeyDown={event => { if (event.key === 'Escape') { setOpen(false); setQuery(''); } }}
        />
        {value && !open && (
          <button
            type="button"
            class="tc-picker-clear"
            aria-label="Clear selection"
            onMouseDown={event => event.preventDefault()}
            onClick={() => { onSelect(null); setQuery(''); inputRef.current?.focus(); }}
          ><i class="fas fa-xmark" /></button>
        )}
      </div>
      {open && (
        <div class="tc-picker-menu" role="listbox">
          {searchQ.isLoading
            ? <div class="tc-picker-state">Searching…</div>
            : searchQ.isError
              ? <div class="tc-picker-state">Could not load employees.</div>
              : options.length === 0
                ? <div class="tc-picker-state">{mode === 'team' ? 'No active direct reports found.' : 'No employees match your search.'}</div>
                : options.map(option => (
                    <button
                      type="button"
                      key={option.id}
                      role="option"
                      aria-selected={option.id === value}
                      class={`tc-picker-option${option.id === value ? ' selected' : ''}`}
                      onMouseDown={event => event.preventDefault()}
                      onClick={() => select(option)}
                    >
                      <span class="tc-picker-avatar">{initials(option.displayName)}</span>
                      <span class="tc-picker-copy"><strong>{option.displayName}</strong>{option.email && <small>{option.email}</small>}</span>
                      {option.id === value && <i class="fas fa-check" />}
                    </button>
                  ))}
        </div>
      )}
    </div>
  );
}

export function TicketCreateDialog({ open, onClose, onCreated }: {
  open: boolean;
  onClose: () => void;
  onCreated?: (ticketId: string) => void;
}): VNode | null {
  // Resolve the four creation keys — never role names — so offered modes and the
  // priority control match exactly what the RPC will authorise.
  const canSelf = useCan('tickets.create_self');
  const canTeam = useCan('tickets.create_team');
  const canOnBehalf = useCan('tickets.create_on_behalf');
  const canInternal = useCan('tickets.create_internal');
  // A service-queue handler (on-behalf or internal grant) sets priority manually;
  // ordinary self-service uses the request type's default priority.
  const isHandler = canOnBehalf || canInternal;

  const availableModes = useMemo(() => MODE_ORDER.filter(mode => (
    (mode === 'self' && canSelf)
    || (mode === 'team' && canTeam)
    || (mode === 'on_behalf' && canOnBehalf)
    || (mode === 'internal' && canInternal)
  )), [canSelf, canTeam, canOnBehalf, canInternal]);
  const defaultMode: CreationMode = availableModes.includes('self')
    ? 'self'
    : (availableModes[0] ?? 'self');

  const [mode, setMode] = useState<CreationMode>(defaultMode);
  const [requestTypeCode, setRequestTypeCode] = useState('');
  const [priority, setPriority] = useState<'low' | 'medium' | 'high' | 'critical'>('medium');
  const [subject, setSubject] = useState('');
  const [description, setDescription] = useState('');
  const [requesterId, setRequesterId] = useState('');
  const [requesterName, setRequesterName] = useState('');
  const [creationReason, setCreationReason] = useState('');
  const [touched, setTouched] = useState<Record<string, boolean>>({});

  const typesQ = useTicketRequestTypes(mode);
  const create = useCreateTicket();

  const needsRequester = mode === 'team' || mode === 'on_behalf';
  const needsReason = mode === 'on_behalf';

  function markTouched(field: string): void {
    setTouched(previous => (previous[field] ? previous : { ...previous, [field]: true }));
  }

  function resetAll(): void {
    setRequestTypeCode('');
    setSubject('');
    setDescription('');
    setRequesterId('');
    setRequesterName('');
    setCreationReason('');
    setTouched({});
  }

  function changeMode(next: CreationMode): void {
    if (next === mode) return;
    setMode(next);
    // The allowed request types + requester scope differ per mode — drop any now-
    // invalid selections so nothing stale is submitted.
    setRequestTypeCode('');
    setRequesterId('');
    setRequesterName('');
    setCreationReason('');
    setTouched({});
  }

  // Keep the offered mode valid when the dialog (re)opens or grants change.
  useEffect(() => {
    if (!open) return;
    if (!availableModes.includes(mode)) setMode(defaultMode);
  }, [open, availableModes, mode, defaultMode]);

  // Select the first allowed request type whenever the current one is not in the
  // mode's list (initial load, mode switch, or refetch).
  useEffect(() => {
    if (!open) return;
    const list = typesQ.data ?? [];
    if (list.length === 0) return;
    if (!list.some(type => type.code === requestTypeCode)) {
      const first = list[0];
      if (first) {
        setRequestTypeCode(first.code);
        setPriority(first.defaultPriority);
      }
    }
  }, [open, mode, typesQ.data, requestTypeCode]);

  const selectedType = typesQ.data?.find(type => type.code === requestTypeCode);

  const typeError = !requestTypeCode ? 'Select a request type.' : '';
  const subjectError = !subject.trim() ? 'A subject is required.' : '';
  const descriptionError = !description.trim() ? 'A description is required.' : '';
  const requesterError = needsRequester && !requesterId ? (mode === 'team' ? 'Select a team member.' : 'Select an employee.') : '';
  const reasonError = needsReason && !creationReason.trim() ? 'A reason is required.' : '';
  const valid = !typeError && !subjectError && !descriptionError && !requesterError && !reasonError && !create.isPending;

  function close(): void {
    if (create.isPending) return;
    resetAll();
    onClose();
  }

  function submit(): void {
    // Surface every field error at once if the user submits an incomplete form.
    if (!valid) {
      setTouched({ requestType: true, subject: true, description: true, requester: true, reason: true });
      return;
    }
    const args: CreateTicketArgs = {
      requestTypeCode,
      subject: subject.trim(),
      description: description.trim(),
      creationMode: mode,
      ...(isHandler ? { priority } : {}),
      ...(needsRequester ? { requesterId } : {}),
      ...(needsReason ? { creationReason: creationReason.trim() } : {}),
    };
    create.mutate(args, {
      onSuccess: result => {
        toast.success(`Ticket ${result.data.ticketNumber} created.`);
        const ticketId = result.data.ticketId;
        close();
        onCreated?.(ticketId);
      },
      onError: error => toast.error(error instanceof Error ? error.message : 'Could not create ticket.'),
    });
  }

  if (availableModes.length === 0) {
    return (
      <Modal open={open} title="Create ticket" icon="fa-ticket" size="sm" onClose={onClose}>
        <p class="tc-form-hint">You do not have permission to create tickets. Contact an administrator if you need access.</p>
      </Modal>
    );
  }

  const showModeSelect = availableModes.length > 1;

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
        {showModeSelect && (
          <div class="tc-field">
            <span class="tc-lbl">Who is this ticket for?</span>
            <div class="tc-mode-select" role="group" aria-label="Ticket creation mode">
              {availableModes.map(option => (
                <button
                  type="button"
                  key={option}
                  class={mode === option ? 'active' : ''}
                  aria-pressed={mode === option}
                  onClick={() => changeMode(option)}
                ><i class={`fas ${MODE_META[option].icon}`} />{MODE_META[option].label}</button>
              ))}
            </div>
            <p class="tc-form-hint">{MODE_META[mode].hint}</p>
          </div>
        )}

        {needsRequester && (
          <div class="tc-field">
            <span class="tc-lbl">{mode === 'team' ? 'Team member' : 'Employee'}<em class="tc-req">*</em></span>
            <RequesterPicker
              mode={mode}
              value={requesterId}
              selectedLabel={requesterName}
              hasError={!!(touched.requester && requesterError)}
              onBlur={() => markTouched('requester')}
              onSelect={option => {
                setRequesterId(option?.id ?? '');
                setRequesterName(option?.displayName ?? '');
                markTouched('requester');
              }}
            />
            {touched.requester && requesterError && <span class="tc-field-error">{requesterError}</span>}
          </div>
        )}

        <label>
          <span class="tc-lbl">Request type<em class="tc-req">*</em></span>
          <select
            value={requestTypeCode}
            onBlur={() => markTouched('requestType')}
            onChange={event => {
              const code = event.currentTarget.value;
              setRequestTypeCode(code);
              markTouched('requestType');
              const type = typesQ.data?.find(row => row.code === code);
              if (type) setPriority(type.defaultPriority);
            }}
            disabled={typesQ.isLoading}
          >
            <option value="">{typesQ.isLoading ? 'Loading request types…' : 'Select request type'}</option>
            {(typesQ.data ?? []).map(type => <option value={type.code} key={type.code}>{type.queueLabel} · {type.label}</option>)}
          </select>
          {!typesQ.isLoading && (typesQ.data ?? []).length === 0 && (
            <span class="tc-field-error">No request types are available for this mode.</span>
          )}
          {touched.requestType && typeError && <span class="tc-field-error">{typeError}</span>}
        </label>
        {selectedType && <p class="tc-form-hint">{selectedType.description}</p>}

        {isHandler && (
          <label>
            <span class="tc-lbl">Priority</span>
            <select value={priority} onChange={event => setPriority(event.currentTarget.value as typeof priority)}>
              <option value="low">Low</option>
              <option value="medium">Medium</option>
              <option value="high">High</option>
              <option value="critical">Critical</option>
            </select>
          </label>
        )}

        {needsReason && (
          <label>
            <span class="tc-lbl">Reason for the request<em class="tc-req">*</em></span>
            <textarea
              value={creationReason}
              maxLength={1000}
              rows={2}
              onBlur={() => markTouched('reason')}
              onInput={event => setCreationReason(event.currentTarget.value)}
              placeholder="Why are you raising this on their behalf?"
            />
            {touched.reason && reasonError && <span class="tc-field-error">{reasonError}</span>}
          </label>
        )}

        <label>
          <span class="tc-lbl">Subject<em class="tc-req">*</em></span>
          <input
            value={subject}
            maxLength={200}
            onBlur={() => markTouched('subject')}
            onInput={event => setSubject(event.currentTarget.value)}
            placeholder="What do you need help with?"
          />
          {touched.subject && subjectError && <span class="tc-field-error">{subjectError}</span>}
        </label>

        <label>
          <span class="tc-lbl">Description<em class="tc-req">*</em></span>
          <textarea
            value={description}
            maxLength={5000}
            rows={6}
            onBlur={() => markTouched('description')}
            onInput={event => setDescription(event.currentTarget.value)}
            placeholder="Add the details the service team needs to respond."
          />
          {touched.description && descriptionError && <span class="tc-field-error">{descriptionError}</span>}
        </label>
      </div>
    </Modal>
  );
}
