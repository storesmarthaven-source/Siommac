import { useEffect, useRef } from 'preact/hooks';
import type { Design } from '@payslip/types';
import { saveDraft } from '@payslip/lib/store/autosave';

/** Debounced auto-save of the current design to the per-user DB draft slot. */
export function useAutosave(design: Design): void {
  const timer = useRef(0);
  const first = useRef(true);

  useEffect(() => {
    if (first.current) {
      first.current = false; // the initial design is already persisted / restored
      return;
    }
    window.clearTimeout(timer.current);
    timer.current = window.setTimeout(() => saveDraft(design), 1000);
    return () => window.clearTimeout(timer.current);
  }, [design]);
}
