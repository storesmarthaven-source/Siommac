import { useEffect } from 'preact/hooks';
import { selectedElements, type Action, type DesignerState } from '@/state/reducer';
import { setAutosave } from '@/lib/store/autosave';
import { showToast } from '@/lib/toast';

function isTypingTarget(el: EventTarget | null): boolean {
  const node = el as HTMLElement | null;
  if (!node) return false;
  return /input|textarea/i.test(node.tagName) || node.isContentEditable;
}

export function useKeyboardShortcuts(state: DesignerState, dispatch: (a: Action) => void): void {
  useEffect(() => {
    const onKey = (e: KeyboardEvent) => {
      if (isTypingTarget(e.target)) return;
      const meta = e.ctrlKey || e.metaKey;
      const sel = selectedElements(state);

      if (meta && e.key.toLowerCase() === 'g') {
        e.preventDefault();
        dispatch({ kind: e.shiftKey ? 'ungroup' : 'group' });
        return;
      }
      if (meta && e.key.toLowerCase() === 'z') {
        e.preventDefault();
        dispatch({ kind: e.shiftKey ? 'redo' : 'undo' });
        return;
      }
      if (meta && e.key.toLowerCase() === 'y') {
        e.preventDefault();
        dispatch({ kind: 'redo' });
        return;
      }
      if (meta && e.key.toLowerCase() === 'd') {
        e.preventDefault();
        dispatch({ kind: 'duplicateSelected' });
        return;
      }
      if (meta && e.key.toLowerCase() === 's') {
        e.preventDefault();
        setAutosave(state.design);
        showToast('Saved');
        return;
      }
      if ((e.key === 'Delete' || e.key === 'Backspace') && sel.length) {
        e.preventDefault();
        dispatch({ kind: 'deleteSelected' });
        return;
      }
      if (sel.length && e.key.startsWith('Arrow')) {
        e.preventDefault();
        const step = e.shiftKey ? 10 : 1;
        const dx = e.key === 'ArrowLeft' ? -step : e.key === 'ArrowRight' ? step : 0;
        const dy = e.key === 'ArrowUp' ? -step : e.key === 'ArrowDown' ? step : 0;
        dispatch({ kind: 'patchMany', patches: sel.map((s) => ({ id: s.id, patch: { x: s.x + dx, y: s.y + dy } })) });
        dispatch({ kind: 'endEdit' });
      }
    };
    document.addEventListener('keydown', onKey);
    return () => document.removeEventListener('keydown', onKey);
  }, [state, dispatch]);
}
