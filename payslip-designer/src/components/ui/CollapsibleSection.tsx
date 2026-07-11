import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';

export function CollapsibleSection({
  title,
  defaultOpen = true,
  children,
}: {
  title: string;
  defaultOpen?: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(defaultOpen);
  return (
    <div class={`section${open ? '' : ' collapsed'}`}>
      <h4 class="collapsible" onClick={() => setOpen((o) => !o)}>
        {title}
        <svg class="chev" width="14" height="14" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </h4>
      {open && <div class="grp-body">{children}</div>}
    </div>
  );
}
