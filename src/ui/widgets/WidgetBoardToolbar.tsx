// src/ui/widgets/WidgetBoardToolbar.tsx — the board's Customize control (top-right of the
// board, where it lived in v1). Collapsed: a single "Customize" button. Customize → the
// Widget Library / Reset layout / Set as default controls SLIDE OUT right-to-left; the
// button becomes Done. (The Demo-data toggle lives in the Widget Library, next to Live preview.)
import './widgetBoard.css';
import type { VNode } from 'preact';

export interface WidgetBoardToolbarProps {
  editing: boolean;
  canSetDefault?: boolean;
  onToggleEdit: () => void;
  onOpenLibrary: () => void;
  onReset: () => void;
  onSetDefault: () => void;
}

export function WidgetBoardToolbar({ editing, canSetDefault, onToggleEdit, onOpenLibrary, onReset, onSetDefault }: WidgetBoardToolbarProps): VNode {
  return (
    <div class="wbi-toolbar">
      {/* The expanded controls slide out from the right when customizing. */}
      <div class={`wbi-tb-slide${editing ? ' open' : ''}`} aria-hidden={!editing}>
        <button type="button" class="wbi-tb-btn" tabIndex={editing ? 0 : -1} onClick={onOpenLibrary}><i class="fas fa-table-cells-large" /> Widget Library</button>
        <button type="button" class="wbi-tb-btn" tabIndex={editing ? 0 : -1} onClick={onReset}><i class="fas fa-rotate-left" /> Reset layout</button>
        {canSetDefault ? <button type="button" class="wbi-tb-btn" tabIndex={editing ? 0 : -1} onClick={onSetDefault}><i class="fas fa-users" /> Set as default</button> : null}
      </div>

      <button type="button" class={`wbi-tb-btn${editing ? ' solid' : ''}`} onClick={onToggleEdit}>
        <i class={`fas ${editing ? 'fa-check' : 'fa-sliders'}`} /> {editing ? 'Done' : 'Customize'}
      </button>
    </div>
  );
}
