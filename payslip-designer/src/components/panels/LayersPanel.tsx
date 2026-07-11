import { useState } from 'preact/hooks';
import type { ComponentChildren } from 'preact';
import type { DesignElement, ElementType } from '@/types';
import { useDesigner } from '@/state/DesignerContext';

const ICONS: Record<ElementType, string> = {
  heading: 'H',
  text: 'T',
  field: '⊞',
  table: '▦',
  summary: '◫',
  image: '🖼',
  divider: '—',
  box: '▢',
};

const CATEGORIES: Array<{ type: ElementType; label: string }> = [
  { type: 'heading', label: 'Headings' },
  { type: 'text', label: 'Text' },
  { type: 'field', label: 'Data fields' },
  { type: 'table', label: 'Tables' },
  { type: 'summary', label: 'Net boxes' },
  { type: 'image', label: 'Images' },
  { type: 'divider', label: 'Dividers' },
  { type: 'box', label: 'Boxes' },
];

function derivedName(el: DesignElement): string {
  switch (el.type) {
    case 'text':
    case 'heading':
      return el.text.replace(/\{\{|\}\}/g, '').slice(0, 24) || el.type;
    case 'field':
    case 'summary':
      return el.label;
    case 'table':
      return el.title || el.labelCol || 'Table';
    default:
      return el.type;
  }
}

function layerName(el: DesignElement): string {
  return el.name?.trim() || derivedName(el);
}

function Section({
  title,
  count,
  active,
  children,
}: {
  title: string;
  count: number;
  active: boolean;
  children: ComponentChildren;
}) {
  const [open, setOpen] = useState(true);
  return (
    <div class={`lyr-cat${open ? '' : ' collapsed'}${active ? ' active' : ''}`}>
      <div class="lyr-cat-head" onClick={() => setOpen((o) => !o)}>
        <span class="lyr-cat-title">{title}</span>
        <span class="lyr-cat-count">{count}</span>
        <svg class="chev" width="12" height="12" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2.5">
          <path d="M6 9l6 6 6-6" />
        </svg>
      </div>
      {open && <div class="lyr-cat-body">{children}</div>}
    </div>
  );
}

function LayerRow({ el, selected }: { el: DesignElement; selected: boolean }) {
  const { dispatch } = useDesigner();
  const [editing, setEditing] = useState(false);
  return (
    <div
      class={`layer${selected ? ' sel' : ''}`}
      onClick={(e) => !editing && dispatch({ kind: 'select', id: el.id, additive: (e as MouseEvent).shiftKey })}
      onDblClick={(e) => { e.stopPropagation(); setEditing(true); }}
      title="Double-click to rename"
    >
      <span class="lyr-ico">{ICONS[el.type]}</span>
      {editing ? (
        <input
          class="lyr-rename"
          autofocus
          value={el.name ?? ''}
          placeholder={derivedName(el)}
          onClick={(e) => e.stopPropagation()}
          onBlur={(e) => {
            const v = (e.target as HTMLInputElement).value.trim();
            dispatch({ kind: 'patch', id: el.id, patch: { name: v || undefined } });
            dispatch({ kind: 'endEdit' });
            setEditing(false);
          }}
          onKeyDown={(e) => { if (e.key === 'Enter' || e.key === 'Escape') (e.target as HTMLInputElement).blur(); }}
        />
      ) : (
        <span class="lyr-name">{layerName(el)}</span>
      )}
      <span class="lz">z{el.z}</span>
    </div>
  );
}

export function LayersPanel() {
  const { state } = useDesigner();
  const { elements } = state.design;
  const selected = state.selectedIds;

  if (elements.length === 0) {
    return <div class="layers-empty">No elements yet.</div>;
  }

  const byZ = (a: DesignElement, b: DesignElement) => b.z - a.z;
  const row = (el: DesignElement) => <LayerRow key={el.id} el={el} selected={selected.includes(el.id)} />;

  // Distinct groups, in order of their top-most member.
  const groupIds: string[] = [];
  for (const el of [...elements].sort(byZ)) {
    if (el.group && !groupIds.includes(el.group)) groupIds.push(el.group);
  }

  const ungrouped = elements.filter((e) => !e.group);

  return (
    <div class="layers">
      {groupIds.map((gid, i) => {
        const members = elements.filter((e) => e.group === gid).sort(byZ);
        const active = members.some((m) => selected.includes(m.id));
        return (
          <Section key={gid} title={`⛶ Group ${i + 1}`} count={members.length} active={active}>
            {members.map(row)}
          </Section>
        );
      })}

      {CATEGORIES.map((cat) => {
        const items = ungrouped.filter((e) => e.type === cat.type).sort(byZ);
        if (items.length === 0) return null;
        const active = items.some((e) => selected.includes(e.id));
        return (
          <Section key={cat.type} title={cat.label} count={items.length} active={active}>
            {items.map(row)}
          </Section>
        );
      })}
    </div>
  );
}
