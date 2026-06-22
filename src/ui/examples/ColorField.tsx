/**
 * src/ui/examples/ColorField.tsx
 *
 * A richer colour control for the theme editor than the bare OS swatch:
 *   • a checkerboard-backed swatch button that opens a popover
 *   • a large native colour area + a hex field
 *   • an ALPHA slider (when `withAlpha`) so rgba tokens (the status tints, the
 *     focus ring) get a real picker too — output stays rgba(…) with the chosen alpha
 *   • a row of brand/status preset swatches for quick, consistent choices
 *
 * Emits a hex string when opaque, or `rgba(r,g,b,a)` when `withAlpha` and a < 1.
 */

import { type VNode } from 'preact';
import { useState, useRef, useEffect } from 'preact/hooks';

interface RGBA { r: number; g: number; b: number; a: number; }

const PRESETS = [
  '#1b2d54', '#2A4270', '#E40C0C', '#B20808', '#FFB712', '#1a2c53',
  '#ef4444', '#f59e0b', '#16a34a', '#2563eb', '#7c3aed', '#5E6F8D',
];

function clamp(n: number, lo: number, hi: number): number { return Math.max(lo, Math.min(hi, n)); }

function parseColor(value: string): RGBA {
  const v = (value ?? '').trim();
  const rgba = v.match(/rgba?\(\s*([\d.]+)\s*,\s*([\d.]+)\s*,\s*([\d.]+)\s*(?:,\s*([\d.]+)\s*)?\)/i);
  if (rgba) {
    return {
      r: clamp(Math.round(+(rgba[1] ?? 0)), 0, 255),
      g: clamp(Math.round(+(rgba[2] ?? 0)), 0, 255),
      b: clamp(Math.round(+(rgba[3] ?? 0)), 0, 255),
      a: rgba[4] !== undefined ? clamp(+rgba[4], 0, 1) : 1,
    };
  }
  let hex = v.replace('#', '');
  if (hex.length === 3) hex = hex.split('').map(c => c + c).join('');
  if (/^[0-9a-f]{6}$/i.test(hex)) {
    return { r: parseInt(hex.slice(0, 2), 16), g: parseInt(hex.slice(2, 4), 16), b: parseInt(hex.slice(4, 6), 16), a: 1 };
  }
  return { r: 27, g: 45, b: 84, a: 1 };
}

function toHex({ r, g, b }: RGBA): string {
  return '#' + [r, g, b].map(n => clamp(Math.round(n), 0, 255).toString(16).padStart(2, '0')).join('');
}

function format(c: RGBA, withAlpha: boolean): string {
  if (withAlpha && c.a < 1) return `rgba(${c.r}, ${c.g}, ${c.b}, ${+c.a.toFixed(2)})`;
  return toHex(c);
}

function cssOf(c: RGBA): string { return `rgba(${c.r}, ${c.g}, ${c.b}, ${c.a})`; }

const CHECKER = 'repeating-conic-gradient(#ccc 0% 25%, #fff 0% 50%) 50% / 10px 10px';

export function ColorField({ value, withAlpha, onChange }: {
  value: string; withAlpha?: boolean; onChange: (v: string) => void;
}): VNode {
  const [open, setOpen] = useState(false);
  const c = parseColor(value);
  const ref = useRef<HTMLDivElement>(null);

  useEffect(() => {
    if (!open) return;
    const onDoc = (e: MouseEvent) => { if (ref.current && !ref.current.contains(e.target as Node)) setOpen(false); };
    document.addEventListener('mousedown', onDoc);
    return () => document.removeEventListener('mousedown', onDoc);
  }, [open]);

  const emit = (next: RGBA) => onChange(format(next, !!withAlpha));

  return (
    <div ref={ref} style={{ position: 'relative', display: 'flex', alignItems: 'center', gap: '6px', flex: 1, minWidth: 0 }}>
      {/* Swatch */}
      <button type="button" onClick={() => setOpen(o => !o)} title="Pick colour"
        style={{ width: '32px', height: '32px', flexShrink: 0, borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', cursor: 'pointer', padding: 0, background: CHECKER }}>
        <span style={{ display: 'block', width: '100%', height: '100%', borderRadius: 'inherit', background: cssOf(c) }} />
      </button>

      {/* Live value text field */}
      <input type="text" class="ui-input" value={value} onInput={e => onChange((e.target as HTMLInputElement).value)}
        style={{ fontFamily: 'var(--font-mono)', fontSize: '0.72rem', minHeight: '32px' }} />

      {open && (
        <div style={{
          position: 'absolute', top: '38px', left: 0, zIndex: 'var(--z-popover)',
          width: '232px', padding: 'var(--space-3)', background: 'var(--bg-card)',
          border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', boxShadow: 'var(--elev-4)',
          display: 'grid', gap: 'var(--space-2)',
        }}>
          <input type="color" value={toHex(c)} onInput={e => { const n = parseColor((e.target as HTMLInputElement).value); emit({ ...n, a: c.a }); }}
            style={{ width: '100%', height: '40px', padding: 0, border: '1px solid var(--border)', borderRadius: 'var(--radius-xs)', cursor: 'pointer', background: 'none' }} />

          {withAlpha && (
            <label style={{ display: 'grid', gap: '4px' }}>
              <span style={{ fontSize: '0.66rem', color: 'var(--text-muted)', display: 'flex', justifyContent: 'space-between' }}>
                <span>Opacity</span><span>{Math.round(c.a * 100)}%</span>
              </span>
              <input type="range" min={0} max={100} value={Math.round(c.a * 100)}
                onInput={e => emit({ ...c, a: clamp(+(e.target as HTMLInputElement).value, 0, 100) / 100 })}
                style={{ width: '100%', accentColor: 'var(--siomac-navy)' }} />
            </label>
          )}

          <div style={{ display: 'grid', gridTemplateColumns: 'repeat(6, 1fr)', gap: '5px' }}>
            {PRESETS.map(p => {
              const pc = parseColor(p);
              return (
                <button key={p} type="button" title={p} onClick={() => emit({ ...pc, a: withAlpha ? c.a : 1 })}
                  style={{ width: '100%', aspectRatio: '1', borderRadius: 'var(--radius-xs)', border: '1px solid var(--border)', cursor: 'pointer', background: p }} />
              );
            })}
          </div>
        </div>
      )}
    </div>
  );
}
