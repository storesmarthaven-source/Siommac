/**
 * StatCard.tsx
 *
 * Animated counter stat card used in section headers
 * (Employee stats, Department stats, Leave stats, Dashboard stats).
 *
 * Uses a requestAnimationFrame count-up animation that mirrors the legacy
 * _countUp() function from employees.js.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/UI_DESIGN_SYSTEM.md
 */

import { type VNode }            from 'preact';
import { useState, useEffect, useRef } from 'preact/hooks';

interface StatCardProps {
  icon:     string;   // Font Awesome class e.g. 'fa-users'
  label:    string;
  value:    number;
  color?:   string;   // icon tint — hex (mapped to a branded variant) or a variant name
  loading?: boolean;
}

/** Map an arbitrary hex tint (or variant name) to a branded .stat-card-icon variant. */
function iconVariant(color: string): 'blue' | 'green' | 'gold' | 'red' {
  switch (color.toLowerCase()) {
    case 'blue': case '#2563eb': case '#1b2d54': case '#1b2d55': return 'blue';
    case 'green': case '#16a34a': case '#2e7d32': return 'green';
    case 'gold': case '#d97706': case '#c67c00': case '#7c3aed': return 'gold';
    case 'red': case '#dc2626': case '#e40c0c': return 'red';
    default: return 'blue';
  }
}

function useCountUp(target: number, duration = 600): number {
  const [current, setCurrent] = useState(0);
  const prevRef = useRef(0);
  const rafRef  = useRef<number>(0);

  useEffect(() => {
    const start = prevRef.current;
    const startTime = performance.now();

    cancelAnimationFrame(rafRef.current);

    function step(now: number) {
      const elapsed  = now - startTime;
      const progress = Math.min(elapsed / duration, 1);
      // ease-out cubic
      const eased    = 1 - Math.pow(1 - progress, 3);
      const val      = Math.round(start + (target - start) * eased);
      setCurrent(val);
      if (progress < 1) {
        rafRef.current = requestAnimationFrame(step);
      } else {
        prevRef.current = target;
      }
    }

    rafRef.current = requestAnimationFrame(step);
    return () => cancelAnimationFrame(rafRef.current);
  }, [target, duration]);

  return current;
}

export function StatCard({ icon, label, value, color = 'blue', loading = false }: StatCardProps): VNode {
  const displayed = useCountUp(loading ? 0 : value);
  const variant   = iconVariant(color);

  return (
    <div class="stat-card" style={{ flex: '1 1 180px', minWidth: '160px' }}>
      <div class={`stat-card-icon ${variant}`}>
        <i class={`fas ${icon}`} aria-hidden="true" />
      </div>
      <div class="stat-card-body">
        <div class="stat-card-value">{loading ? '' : displayed}</div>
        <div class="stat-card-label">{label}</div>
      </div>
    </div>
  );
}
