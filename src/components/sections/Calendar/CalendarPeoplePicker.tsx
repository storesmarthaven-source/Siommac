import { type VNode } from 'preact';
import { Avatar, Button, LucideIcon, PersonSearchSelect, type PersonOption } from '@ui';

export interface CalendarPeoplePickerProps {
  mode: 'event' | 'task';
  people: readonly PersonOption[];
  selected: readonly PersonOption[];
  onAdd: (userId: string) => void;
  onRemove: (userId: string) => void;
  onSearch?: (query: string) => void;
  loading?: boolean;
  error?: string | null;
  disabled?: boolean;
  readOnly?: boolean;
  emptyText?: string;
}

/** Shared Calendar employee control used by create and full edit. Tasks have
 * one accountable assignee; events support a removable participant list. */
export function CalendarPeoplePicker({
  mode,
  people,
  selected,
  onAdd,
  onRemove,
  onSearch,
  loading,
  error,
  disabled = false,
  readOnly = false,
  emptyText = mode === 'event' ? 'No employees have been added.' : 'No assignee selected.',
}: CalendarPeoplePickerProps): VNode {
  const selectedIds = new Set(selected.map(person => person.id));
  const availablePeople = mode === 'event' ? people.filter(person => !selectedIds.has(person.id)) : people;
  const assignee = selected[0] ?? null;

  return (
    <div class={`cal-people-picker${readOnly ? ' is-readonly' : ''}`}>
      {!readOnly ? (
        <PersonSearchSelect
          value={mode === 'task' ? assignee?.id ?? null : null}
          onChange={userId => {
            if (mode === 'task' && !userId && assignee) onRemove(assignee.id);
            else if (userId) onAdd(userId);
          }}
          people={availablePeople}
          onSearch={onSearch}
          loading={loading}
          error={error}
          placeholder={mode === 'event' ? 'Search employees to add…' : 'Search for an assignee…'}
          emptyLabel="No matching employees"
          clearable={mode === 'task'}
          disabled={disabled}
        />
      ) : null}

      {mode === 'event' ? (
        selected.length ? (
          <div class="cal-people-selected" aria-label="Selected employees">
            {selected.map(person => (
              <article key={person.id}>
                <Avatar name={person.name} src={person.photoUrl} seed={person.id} size={36} decorative />
                <span>
                  <strong>{person.name}</strong>
                  <small>{[person.jobTitle, person.department].filter(Boolean).join(' · ') || 'Employee'}</small>
                </span>
                {!readOnly ? (
                  <Button variant="ghost" size="sm" iconOnly aria-label={`Remove ${person.name}`} iconLeft={<LucideIcon name="X" size={15} />} disabled={disabled} onClick={() => onRemove(person.id)} />
                ) : null}
              </article>
            ))}
          </div>
        ) : (
          <div class="cal-people-empty">
            <LucideIcon name="UserRoundPlus" size={17} />
            <span>{emptyText}</span>
          </div>
        )
      ) : null}
    </div>
  );
}
