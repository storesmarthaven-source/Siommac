import { useEffect, useRef } from 'preact/hooks';
import type { Design } from '@payslip/types';
import { saveDraft } from '@payslip/lib/store/autosave';

/** Debounced auto-save of the current design to the per-user DB draft slot. */
export function useAutosave(design: Design): void {
  const timerRef = useRef(0);
  const firstRef = useRef(true);

  useEffect(() => {
    if (firstRef.current) {
      firstRef.current = false; // the initial design is already persisted / restored
      return;
    }
    window.clearTimeout(timerRef.current);
    timerRef.current = window.setTimeout(() => saveDraft(design), 1000);
    return () => window.clearTimeout(timerRef.current);
  }, [design]);
}
