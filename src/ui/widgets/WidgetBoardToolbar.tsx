// src/ui/widgets/WidgetBoardToolbar.tsx — the board's Customize control (top-right of the
// board / in the PageHeader actions). An ICON-ONLY trigger (sliders) sized to match the
// standard header buttons, that opens a DROPDOWN MENU: Edit layout · Widget Library · Reset
// layout · Set as default. The board's edit-mode banner (WidgetBoard, Option B) — not a navy
// trigger state — signals when you're editing. Menu icons are Lucide in #667085 (page-header standard).
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
  /** When `false`, "Set as default" renders DISABLED (the current layout already matches the org
   *  default, so there's nothing to promote). `undefined` = enabled (callers that don't track it). */
  defaultDirty?: boolean;
  /** When true, the board's edit banner owns the edit-mode actions (Done + Set as default), so the
   *  dropdown drops the now-redundant "Finish editing" and "Set as default" items (it only offers
   *  "Edit layout" to ENTER edit mode). Boards without a banner leave this off and keep both. */
  finishInBanner?: boolean;
  onToggleEdit: () => void;
  onOpenLibrary: () => void;
  onReset: () => void;
  onSetDefault: () => void;
  onSaveEditing?: () => void | Promise<void>;
  onCancelEditing?: () => void | Promise<void>;
  /** Current board items — when provided (admin only), a "Copy layout" item appears that
   *  captures the live arrangement as ready-to-paste `defInst(...)` code. Dev tool, temporary. */
  layoutItems?: WidgetInstance[];
}

export function WidgetBoardToolbar({ editing, canSetDefault, defaultDirty, finishInBanner, onToggleEdit, onOpenLibrary, onReset, onSetDefault, onSaveEditing, onCancelEditing, layoutItems }: WidgetBoardToolbarProps): VNode {
  const [open, setOpen] = useState(false);

  // Reset wipes the user's personal arrangement — confirm first (popup system), never silently.
  async function confirmReset(): Promise<void> {
    const ok = await dialog.confirm({
      title: 'Reset layout?',
      text: 'This clears your personal arrangement for this page and restores the default layout.',
      confirmText: 'Reset Layout',
    });
    if (ok) onReset();
  }

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

  const items: { label: string; icon: LucideName; onClick: () => void; disabled?: boolean; disabledReason?: string }[] = [
    // Edit toggle. When the banner owns the exit (finishInBanner), don't duplicate "Finish editing"
    // here — only offer "Edit layout" to ENTER; the banner's Done finishes.
    ...(editing && !finishInBanner && onSaveEditing
      ? [
          { label: 'Save Layout', icon: 'Check' as LucideName, onClick: () => void onSaveEditing() },
          { label: 'Cancel Changes', icon: 'X' as LucideName, onClick: () => void onCancelEditing?.() },
        ]
      : finishInBanner
      ? (editing ? [] : [{ label: 'Edit Layout', icon: 'Pencil' as LucideName, onClick: onToggleEdit }])
      : [{ label: editing ? 'Finish Editing' : 'Edit Layout', icon: (editing ? 'Check' : 'Pencil') as LucideName, onClick: onToggleEdit }]),
    { label: 'Widget Library', icon: 'LayoutGrid', onClick: onOpenLibrary },
    { label: 'Reset Layout', icon: 'RotateCcw', onClick: () => void confirmReset() },
    ...(canSetDefault && !finishInBanner ? [{ label: 'Set as Default', icon: 'Users' as LucideName, onClick: onSetDefault,
      disabled: defaultDirty === false, disabledReason: 'Rearrange the board to enable' }] : []),
    ...(canSetDefault && layoutItems ? [{ label: 'Copy Layout', icon: 'Crosshair' as LucideName, onClick: () => void copyLayout() }] : []),
  ];

  return (
    <div class="wbi-toolbar">
      {/* Icon-only trigger → dropdown menu. Same footprint as the standard header buttons.
          The edit-mode banner (not a navy trigger state) now signals when you're editing. */}
      <button type="button" class="wbi-tb-btn wbi-tb-trigger"
        aria-haspopup="menu" aria-expanded={open}
        onClick={() => setOpen(o => !o)}
        aria-label="Customize Widgets" title="Customize Widgets">
        <LucideIcon name="SlidersHorizontal" size={17} />
      </button>
      {open && (
        <>
          <div style={{ position: 'fixed', inset: 0, zIndex: 40 }} onClick={() => setOpen(false)} />
          <div class="ui-menu ui-menu-pop" role="menu" style={{ top: 'calc(100% + 6px)', right: 0 }}>
            {items.map(it => (
              <button key={it.label} type="button" role="menuitem"
                class={`ui-menu-item${it.disabled ? ' is-disabled' : ''}`}
                disabled={it.disabled}
                title={it.disabled ? it.disabledReason : undefined}
                onClick={() => { if (it.disabled) return; it.onClick(); setOpen(false); }}>
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
