// src/ui/widgets/WidgetBoardToolbar.tsx — the board's Customize control (top-right of the
// board / in the PageHeader actions). An ICON-ONLY trigger (sliders) sized to match the
// standard header buttons, that opens a DROPDOWN MENU: Edit layout · Widget Library · Reset
// layout · Set as default. While editing, the trigger stays solid navy so the active state is
// visible with the menu closed. Menu icons are Lucide in #667085 (page-header standard).
import './widgetBoard.css';
import type { VNode } from 'preact';
import { useState } from 'preact/hooks';
import { dialog } from '@lib/dialog';
import { toast } from '@store';
import { LucideIcon, type LucideName } from '../LucideIcon';
import { MENU_ICON_COLOR } from '../components/NewMenu';
import { serializeBoardLayout } from './serializeLayout';
import type { WidgetInstance } from './types';

export interface WidgetBoardToolbarProps {
  editing: boolean;
  canSetDefault?: boolean;
  onToggleEdit: () => void;
  onOpenLibrary: () => void;
  onReset: () => void;
  onSetDefault: () => void;
  /** Current board items — when provided (admin only), a "Copy layout" item appears that
   *  captures the live arrangement as ready-to-paste `defInst(...)` code. Dev tool, temporary. */
  layoutItems?: WidgetInstance[];
}

export function WidgetBoardToolbar({ editing, canSetDefault, onToggleEdit, onOpenLibrary, onReset, onSetDefault, layoutItems }: WidgetBoardToolbarProps): VNode {
  const [open, setOpen] = useState(false);

  async function copyLayout(): Promise<void> {
    if (!layoutItems) return;
    const code = serializeBoardLayout(layoutItems);
    try { await navigator.clipboard.writeText(code); toast.success('Layout copied — paste it to hard-code as the default'); }
    catch { toast('Copied below — select and copy it'); }
    await dialog.prompt({
      title: 'Board layout coordinates',
      text: 'The exact arrangement on screen. Already on your clipboard — paste it to hard-code as the default layout.',
      type: 'textarea', value: code, confirmText: 'Done', cancelText: 'Close',
    });
  }

  const items: { label: string; icon: LucideName; onClick: () => void }[] = [
    { label: editing ? 'Finish editing' : 'Edit layout', icon: editing ? 'Check' : 'Pencil', onClick: onToggleEdit },
    { label: 'Widget Library', icon: 'LayoutGrid', onClick: onOpenLibrary },
    { label: 'Reset layout', icon: 'RotateCcw', onClick: onReset },
    ...(canSetDefault ? [{ label: 'Set as default', icon: 'Users' as LucideName, onClick: onSetDefault }] : []),
    ...(canSetDefault && layoutItems ? [{ label: 'Copy layout', icon: 'Crosshair' as LucideName, onClick: () => void copyLayout() }] : []),
  ];

  return (
    <div class="wbi-toolbar">
      {/* Icon-only trigger → dropdown menu. Same footprint as the standard header buttons. */}
      <button type="button" class={`wbi-tb-btn wbi-tb-trigger${editing ? ' solid' : ''}`}
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        aria-label="Customize widgets" title="Customize widgets">
        <LucideIcon name="SlidersHorizontal" size={17} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div class="ui-menu ui-menu-pop" role="menu" style={{ top: 'calc(100% + 6px)', right: 0 }}>
            {items.map(it => (
              <button key={it.label} type="button" role="menuitem" class="ui-menu-item"
                onClick={() => { it.onClick(); setOpen(false); }}>
                <LucideIcon name={it.icon} size={16} style={{ color: MENU_ICON_COLOR, flexShrink: 0 }} />
                {it.label}
              </button>
            ))}
          </div>
        </>
      )}
    </div>
  );
}
