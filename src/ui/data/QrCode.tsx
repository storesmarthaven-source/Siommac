import { type VNode } from 'preact';
import { useMemo } from 'preact/hooks';
import QRCodeEncoder from 'qrcode';
import './QrCode.recipe.css';

export interface QrCodeProps {
  value: string;
  label?: string;
  quietZone?: number;
  errorCorrection?: 'L' | 'M' | 'Q' | 'H';
  variant?: 'plain' | 'framed' | 'scanning';
  class?: string;
}

/** A real encoded QR matrix rendered as themeable inline SVG. */
export function QrCode({ value, label = 'QR code', quietZone = 4, errorCorrection = 'M', variant = 'framed', class: extra }: QrCodeProps): VNode {
  const matrix = useMemo(() => QRCodeEncoder.create(value || ' ', { errorCorrectionLevel: errorCorrection }).modules, [errorCorrection, value]);
  const safeQuietZone = Math.min(16, Math.max(0, Math.round(quietZone)));
  const viewSize = matrix.size + safeQuietZone * 2;
  const cells: VNode[] = [];
  for (let row = 0; row < matrix.size; row++) {
    for (let column = 0; column < matrix.size; column++) {
      if (matrix.get(row, column)) cells.push(<rect key={`${row}-${column}`} x={column + safeQuietZone} y={row + safeQuietZone} width="1" height="1" />);
    }
  }

  return (
    <figure class={`ui-qr ui-qr--${variant}${extra ? ` ${extra}` : ''}`}>
      <svg viewBox={`0 0 ${viewSize} ${viewSize}`} role="img" aria-label={label} shape-rendering="crispEdges">
        <rect class="ui-qr__background" width={viewSize} height={viewSize} />
        <g class="ui-qr__modules">{cells}</g>
      </svg>
      {variant !== 'plain' && <span class="ui-qr__corners" aria-hidden="true"><i /><i /><i /><i /></span>}
      {variant === 'scanning' && <span class="ui-qr__scan" aria-hidden="true" />}
    </figure>
  );
}
