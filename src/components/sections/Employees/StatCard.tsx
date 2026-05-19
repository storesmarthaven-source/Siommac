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
  color?:   string;   // icon background tint (hex)
  loading?: boolean;
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

export function StatCard({ icon, label, value, color = '#6366f1', loading = false }: StatCardProps): VNode {
  const displayed = useCountUp(loading ? 0 : value);

  return (
    <div
      style={{
        background:   '#fff',
        borderRadius: '12px',
        padding:      '20px 24px',
        display:      'flex',
        alignItems:   'center',
        gap:          '16px',
        boxShadow:    '0 1px 3px rgba(0,0,0,.08)',
        flex:         '1 1 180px',
        minWidth:     '160px',
      }}
    >
      <div
        style={{
          width:          '48px',
          height:         '48px',
          borderRadius:   '12px',
          background:     `${color}18`,
          display:        'flex',
          alignItems:     'center',
          justifyContent: 'center',
          flexShrink:     0,
        }}
      >
        <i
          class={`fas ${icon}`}
          style={{ color, fontSize: '20px' }}
          aria-hidden="true"
        />
      </div>
      <div>
        {loading ? (
          <div style={{ width: '48px', height: '28px', background: '#f3f4f6', borderRadius: '4px', marginBottom: '4px' }} />
        ) : (
          <div style={{ fontSize: '26px', fontWeight: '700', color: '#111827', lineHeight: 1 }}>
            {displayed}
          </div>
        )}
        <div style={{ fontSize: '13px', color: '#6b7280', marginTop: '4px' }}>{label}</div>
      </div>
    </div>
  );
}
