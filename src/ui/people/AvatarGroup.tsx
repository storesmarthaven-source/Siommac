import { type VNode } from 'preact';
import { Avatar, type AvatarPresence, type AvatarSize, type AvatarVariant } from './Avatar';
import './Avatar.recipe.css';

export interface AvatarGroupPerson {
  id: string;
  name: string;
  src?: string | null;
  presence?: AvatarPresence;
}

export interface AvatarGroupProps {
  people: readonly AvatarGroupPerson[];
  max?: number;
  size?: AvatarSize;
  variant?: AvatarVariant;
  label?: string;
  class?: string;
}

export function AvatarGroup({ people, max = 4, size = 'md', variant = 'circle', label = 'People', class: extra }: AvatarGroupProps): VNode | null {
  if (people.length === 0) return null;
  const visibleCount = Math.max(1, Math.min(Math.floor(max), people.length));
  const visible = people.slice(0, visibleCount);
  const hidden = people.slice(visibleCount);
  return (
    <ul
      class={`ui-avatar-group ui-avatar-group--${typeof size === 'number' ? 'custom' : size}${extra ? ` ${extra}` : ''}`}
      aria-label={label}
      style={typeof size === 'number' ? `--ui-avatar-group-size:${Math.max(16, size)}px` : undefined}
    >
      {visible.map(person => (
        <li class="ui-avatar-group__item" aria-label={person.name} key={person.id}>
          <Avatar name={person.name} src={person.src} seed={person.id} size={size} variant={variant} presence={person.presence} decorative />
        </li>
      ))}
      {hidden.length > 0 && (
        <li class="ui-avatar-group__item ui-avatar-group__overflow" aria-label={`${hidden.length} more: ${hidden.map(person => person.name).join(', ')}`}>
          <span aria-hidden="true">+{hidden.length}</span>
        </li>
      )}
    </ul>
  );
}
