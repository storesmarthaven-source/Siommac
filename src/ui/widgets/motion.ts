/**
 * src/ui/widgets/motion.ts — the widget animation toolkit.
 *
 * Thin Preact hooks over the `motion` library's VANILLA API (`animate`/`stagger`/`inView`),
 * which is framework-agnostic (no preact/compat dependency, unlike `motion/react`). Every hook
 * returns a CALLBACK ref you attach to the element to animate (a callback ref attaches to any
 * element type — `<div>`, `<section>`, `<span>` — without the RefObject variance friction), and
 * every hook NO-OPS under `prefers-reduced-motion: reduce` — accessibility is not optional.
 *
 * These are the sanctioned way to animate a widget (see docs/WIDGET_AUTHORING_GUIDE.md):
 *   useMountReveal   — fade + rise a card in when it mounts (added to the board / first paint)
 *   useValuePulse    — a subtle pop when a metric's value changes (KPI count updates)
 *   useStaggerReveal — cascade a list/grid's direct children in when their data resolves
 */
import { useEffect, useRef, useCallback } from 'preact/hooks';
import { animate, stagger } from 'motion';

/** True when the user asked the OS to minimise motion — all hooks below then do nothing. */
export function reducedMotion(): boolean {
  return typeof matchMedia !== 'undefined' && matchMedia('(prefers-reduced-motion: reduce)').matches;
}

// motion's controls type varies across entrypoints; we only ever call .stop().
interface Stoppable { stop?: () => void }
const stop = (c: unknown): void => { try { (c as Stoppable)?.stop?.(); } catch { /* already done */ } };

export interface MountRevealOpts {
  /** Rise distance in px (default 8). */ y?: number;
  /** Seconds (default 0.35). */ duration?: number;
  /** Seconds before start (default 0). */ delay?: number;
}

/** Fade + rise the element in on mount. Attach the returned callback ref to the card root. */
export function useMountReveal(opts: MountRevealOpts = {}) {
  const elRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = elRef.current;
    if (!node || reducedMotion()) return;
    const controls = animate(
      node,
      { opacity: [0, 1], y: [opts.y ?? 8, 0] },
      { duration: opts.duration ?? 0.35, delay: opts.delay ?? 0, ease: [0.22, 1, 0.36, 1] },
    );
    return () => stop(controls);
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);
  return useCallback((node: HTMLElement | null) => { elRef.current = node; }, []);
}

/** Pop the element when `value` changes (e.g. a KPI number ticks). Skips the first render. */
export function useValuePulse(value: unknown) {
  const elRef = useRef<HTMLElement | null>(null);
  const firstRef = useRef(true);
  useEffect(() => {
    if (firstRef.current) { firstRef.current = false; return; }
    const node = elRef.current;
    if (!node || reducedMotion()) return;
    const controls = animate(node, { scale: [1, 1.06, 1] }, { duration: 0.4, ease: 'easeOut' });
    return () => stop(controls);
  }, [value]);
  return useCallback((node: HTMLElement | null) => { elRef.current = node; }, []);
}

/** Cascade the container's DIRECT children in whenever `dep` changes (default: on mount).
 *  Use on a list/grid so rows fade+rise in sequence once their data resolves. */
export function useStaggerReveal(dep?: unknown) {
  const elRef = useRef<HTMLElement | null>(null);
  useEffect(() => {
    const node = elRef.current;
    if (!node || reducedMotion()) return;
    const kids = Array.from(node.children) as HTMLElement[];
    if (!kids.length) return;
    const controls = animate(
      kids,
      { opacity: [0, 1], y: [6, 0] },
      { duration: 0.3, delay: stagger(0.04), ease: [0.22, 1, 0.36, 1] },
    );
    return () => stop(controls);
  }, [dep]);
  return useCallback((node: HTMLElement | null) => { elRef.current = node; }, []);
}
