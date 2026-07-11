import { useRef, useState } from 'preact/hooks';
import { isTransparent } from '@payslip/lib/color';
import { ColorPickerPopover } from './ColorPickerPopover';

interface Props {
  value: string;
  alpha?: boolean;
  transparent?: boolean;
  /** Chip-only (no hex label) — for cramped rows. */
  compact?: boolean;
  title?: string;
  /** Live updates while the picker is open. */
  onChange: (color: string) => void;
  /** Fired once when the picker closes (finalise for history). */
  onCommit?: () => void;
}

/** A colour swatch button that opens the custom picker popover. */
export function ColorField({ value, alpha = false, transparent = false, compact = false, title, onChange, onCommit }: Props) {
  const btn = useRef<HTMLButtonElement>(null);
  const [anchor, setAnchor] = useState<DOMRect | null>(null);
  const none = isTransparent(value);

  return (
    <>
      <button
        ref={btn}
        type="button"
        class={`swatch${compact ? ' compact' : ''}`}
        title={title}
        onClick={() => setAnchor(btn.current?.getBoundingClientRect() ?? null)}
      >
        <span class="chip">
          <i style={{ background: none ? 'transparent' : value }} />
        </span>
        {!compact && <span class="val">{none ? 'Transparent' : value.toUpperCase()}</span>}
      </button>
      {anchor && (
        <ColorPickerPopover
          anchor={anchor}
          value={value}
          alpha={alpha}
          transparent={transparent}
          onChange={onChange}
          onClose={() => {
            setAnchor(null);
            onCommit?.();
          }}
        />
      )}
    </>
  );
}
