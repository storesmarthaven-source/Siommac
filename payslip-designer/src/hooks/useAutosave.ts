import { useEffect, useRef } from 'preact/hooks';
import type { Design } from '@/types';
import { setAutosave } from '@/lib/store/autosave';

/** Debounced auto-save of the current design to the autosave slot. */
export function useAutosave(design: Design): void {
  const timer = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the initial design is already persisted / restored
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => setAutosave(design), 800);
    return () => window.clearTimeout(timer.current);
  }, [design]);
}
