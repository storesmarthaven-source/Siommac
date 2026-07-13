import { useEffect, useLayoutEffect, useRef, useState } from 'preact/hooks';
import {
  CSS_EYE_DROPPER_SUPPORTED,
  hsvToRgb,
  parseColor,
  rgbToHsv,
  rgbaToHex,
  type HSV,
} from '@payslip/lib/color';
import { clamp } from '@payslip/lib/geometry';
import { COLOR_PRESETS, getRecents, pushRecent } from './presets';

interface Props {
  anchor: DOMRect;
  value: string;
  alpha: boolean;
  transparent: boolean;
  onChange: (color: string) => void;
  onClose: () => void;
}

const WIDTH = 244;

export function ColorPickerPopover({ anchor, value, alpha, transparent, onChange, onClose }: Props) {
  const ref = useRef<HTMLDivElement>(null);
  const dragging = useRef(false);
  const [pos, setPos] = useState({ left: -9999, top: -9999 });

  const initial = parseColor(value) ?? { r: 255, g: 255, b: 255, a: 1 };
  const [hsv, setHsv] = useState<HSV>(() => rgbToHsv(initial.r, initial.g, initial.b));
  const [a, setA] = useState(alpha ? initial.a : 1);
  const [isNone, setIsNone] = useState(!value || value === 'transparent');

  const colorString = (h: HSV, av: number, none: boolean): string => {
    if (none) return 'transparent';
    const rgb = hsvToRgb(h.h, h.s, h.v);
    return rgbaToHex({ ...rgb, a: av }, alpha);
  };

  const emit = (h: HSV, av: number, none: boolean) => {
    setHsv(h);
    setA(av);
    setIsNone(none);
    onChange(colorString(h, av, none));
  };

  // Position after mount (measure height to flip above if needed).
  useLayoutEffect(() => {
    const ph = ref.current?.offsetHeight ?? 340;
    const left = clamp(anchor.right - WIDTH, 8, window.innerWidth - WIDTH - 8);
    let top = anchor.bottom + 8;
    if (top + ph > window.innerHeight - 8) top = Math.max(8, anchor.top - ph - 8);
    setPos({ left, top });
  }, [anchor]);

  // Close on outside pointerdown / Escape; commit on unmount.
  useEffect(() => {
    const onDown = (e: PointerEvent) => {
      if (ref.current && !ref.current.contains(e.target as Node)) onClose();
    };
    const onKey = (e: KeyboardEvent) => {
      if (e.key === 'Escape') {
        e.stopPropagation();
        onClose();
      }
    };
    const id = window.setTimeout(() => document.addEventListener('pointerdown', onDown, true), 0);
    document.addEventListener('keydown', onKey, true);
    return () => {
      window.clearTimeout(id);
      document.removeEventListener('pointerdown', onDown, true);
      document.removeEventListener('keydown', onKey, true);
      if (!isNone) pushRecent(colorString(hsv, a, false));
    };
    // eslint-disable-next-line react-hooks/exhaustive-deps
  }, []);

  const rgb = hsvToRgb(hsv.h, hsv.s, hsv.v);
  const rgbCss = `rgb(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)})`;

  const areaHandlers = (fn: (fx: number, fy: number) => void) => {
    const handle = (e: PointerEvent) => {
      const r = (e.currentTarget as HTMLElement).getBoundingClientRect();
      fn(clamp((e.clientX - r.left) / r.width, 0, 1), clamp((e.clientY - r.top) / r.height, 0, 1));
    };
    return {
      // `dragging` is a ref so it survives the re-render each drag update triggers.
      onPointerDown: (e: PointerEvent) => {
        dragging.current = true;
        (e.currentTarget as HTMLElement).setPointerCapture(e.pointerId);
        handle(e);
      },
      onPointerMove: (e: PointerEvent) => {
        if (dragging.current) handle(e);
      },
      onPointerUp: (e: PointerEvent) => {
        dragging.current = false;
        (e.currentTarget as HTMLElement).releasePointerCapture?.(e.pointerId);
      },
    };
  };

  const eyedrop = async () => {
    const EyeDropper = (globalThis as { EyeDropper?: new () => { open: () => Promise<{ sRGBHex: string }> } }).EyeDropper;
    if (!EyeDropper) return;
    try {
      const res = await new EyeDropper().open();
      const c = parseColor(res.sRGBHex);
      if (c) emit(rgbToHsv(c.r, c.g, c.b), a, false);
    } catch {
      /* cancelled */
    }
  };

  const chooseHex = (hex: string) => {
    const c = parseColor(hex);
    if (c) emit(rgbToHsv(c.r, c.g, c.b), alpha ? c.a : 1, false);
  };

  const recents = getRecents();

  return (
    <div ref={ref} class="color-pop" style={{ left: `${pos.left}px`, top: `${pos.top}px` }}>
      <div
        class="cp-sv"
        style={{ background: `hsl(${hsv.h},100%,50%)` }}
        {...areaHandlers((fx, fy) => emit({ ...hsv, s: fx, v: 1 - fy }, a === 0 ? 1 : a, false))}
      >
        <div class="cp-sat" />
        <div class="cp-lum" />
        <div class="cp-thumb" style={{ left: `${hsv.s * 100}%`, top: `${(1 - hsv.v) * 100}%`, background: rgbCss }} />
      </div>

      <div class="cp-slider cp-hue" {...areaHandlers((fx) => emit({ ...hsv, h: fx * 360 }, a, false))}>
        <div class="cp-sthumb" style={{ left: `${(hsv.h / 360) * 100}%` }} />
      </div>

      {alpha && (
        <div class="cp-slider cp-alpha" {...areaHandlers((fx) => emit(hsv, fx, false))}>
          <div
            class="cp-alpha-fill"
            style={{ background: `linear-gradient(to right, rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},0), ${rgbCss})` }}
          />
          <div class="cp-sthumb" style={{ left: `${a * 100}%` }} />
        </div>
      )}

      <div class="cp-row">
        <span class="cp-prev">
          <i style={{ background: isNone ? 'transparent' : `rgba(${Math.round(rgb.r)},${Math.round(rgb.g)},${Math.round(rgb.b)},${alpha ? a : 1})` }} />
        </span>
        <input
          class="cp-hex"
          spellcheck={false}
          value={isNone ? '' : colorString(hsv, a, false).toUpperCase()}
          onInput={(e) => chooseHex((e.target as HTMLInputElement).value)}
        />
        {CSS_EYE_DROPPER_SUPPORTED && (
          <button class="cp-icon" title="Pick from screen" onClick={() => void eyedrop()}>
            <svg width="16" height="16" viewBox="0 0 24 24" fill="none" stroke="currentColor" stroke-width="2">
              <path d="M18 2l4 4-9 9-4 1 1-4 8-8z" />
              <path d="M13 7l-9 9v4h4l9-9" />
            </svg>
          </button>
        )}
      </div>

      <div class="cp-label">Palette</div>
      <div class="cp-swatches">
        {COLOR_PRESETS.map((c) => (
          <button key={c} class="cp-sw" title={c} onClick={() => chooseHex(c)}>
            <i style={{ background: c }} />
          </button>
        ))}
      </div>

      {recents.length > 0 && (
        <>
          <div class="cp-label">Recent</div>
          <div class="cp-swatches">
            {recents.map((c) => (
              <button key={c} class="cp-sw" title={c} onClick={() => chooseHex(c)}>
                <i style={{ background: c }} />
              </button>
            ))}
          </div>
        </>
      )}

      {transparent && (
        <button class="cp-none" onClick={() => emit(hsv, 0, true)}>
          Set transparent / none
        </button>
      )}
    </div>
  );
}
