import { type ComponentChildren, type VNode } from 'preact';

interface StudioInspectorProps {
  ariaLabel: string;
  title: string;
  eyebrow?: string;
  className?: string;
  onReset?: () => void;
  children: ComponentChildren;
  footer?: ComponentChildren;
}

/**
 * The single structural shell for every Studio inspector.
 *
 * Components own their schema and specialized controls, but they do not own a
 * second header/body/footer implementation. Keeping the shell here makes page
 * rhythm, reset placement and accessibility consistent across every family.
 */
export function StudioInspector({
  ariaLabel,
  title,
  eyebrow = 'Preview settings',
  className = 'sds-button-settings',
  onReset,
  children,
  footer,
}: StudioInspectorProps): VNode {
  return (
    <aside class={className} aria-label={ariaLabel}>
      <header class="sds-button-settings__head">
        <div><span>{eyebrow}</span><strong>{title}</strong></div>
        {onReset && <button type="button" onClick={onReset}>Reset</button>}
      </header>
      {children}
      {footer}
    </aside>
  );
}

export function StudioInspectorBody({ children, className = 'sds-button-settings__body' }: {
  children: ComponentChildren;
  className?: string;
}): VNode {
  return <div class={className}>{children}</div>;
}
