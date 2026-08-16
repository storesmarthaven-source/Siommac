import { type ComponentChildren, type VNode } from 'preact';
import { LucideIcon } from '../LucideIcon';

export interface StudioSelectProps {
  id?: string;
  value: string;
  disabled?: boolean;
  class?: string;
  'aria-label'?: string;
  children: ComponentChildren;
  onChange: (event: Event) => void;
}

/** Shared dropdown field for every Studio properties panel. */
export function StudioSelect({ id, value, disabled, class: extra, children, onChange, ...aria }: StudioSelectProps): VNode {
  return (
    <span class="sds-property-select">
      <select id={id} class={extra ?? 'sds-ctl__input'} value={value} disabled={disabled} onChange={onChange} {...aria}>
        {children}
      </select>
      <span class="sds-property-select__chevron" aria-hidden="true"><LucideIcon name="ChevronDown" size={15} /></span>
    </span>
  );
}
