/**
 * src/shell/sections/AppSection.tsx
 *
 * Wrapper for a routed section panel. Renders `<section class="app-section">`
 * and owns its own `active` class, derived from the shared active-section store
 * (see useActiveSection.ts). This is the single place the visibility class is
 * applied in the render tree, so Preact reconciliation preserves it across shell
 * re-renders — fixing the "main content goes blank until refresh" bug where an
 * imperatively-toggled class was wiped on the next render.
 *
 * Drop-in for `<section class="app-section" id=… data-role=…>`: same element,
 * same attributes, plus reactive `active`.
 */

import { type ComponentChildren, type VNode } from 'preact';
import { useActiveSection } from './useActiveSection';

interface AppSectionProps {
  id: string;
  role?: string;
  /** Extra classes appended after `app-section` (and `active` when shown). */
  class?: string;
  children?: ComponentChildren;
}

export function AppSection({ id, role, class: extra, children }: AppSectionProps): VNode {
  const isActive = useActiveSection();
  const cls = `app-section${isActive(id) ? ' active' : ''}${extra ? ' ' + extra : ''}`;
  return (
    <section class={cls} id={id} data-role={role}>
      {children}
    </section>
  );
}
