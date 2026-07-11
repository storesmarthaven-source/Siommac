import type { JSX } from 'preact';
import type { DesignElement } from '@payslip/types';
import { TokenText } from './TokenText';
import { alignFor, boxCss, fontCss, justifyFor } from './elementStyles';
import { columnFractions } from '@payslip/lib/tableCols';

function parseAmount(v: string): number {
  return parseFloat(String(v).replace(/[^0-9.-]/g, '')) || 0;
}

/** Presentational render of a single element's inner content. */
export function ElementContent({ el, preview }: { el: DesignElement; preview: boolean }) {
  switch (el.type) {
    case 'heading':
    case 'text':
      return (
        <div
          class="el-content"
          style={{ ...boxCss(el, true), overflow: 'hidden', display: 'flex' }}
        >
          <div
            style={{
              width: '100%',
              height: '100%',
              display: 'flex',
              justifyContent: justifyFor(el.align),
              alignItems: alignFor(el.valign),
              whiteSpace: 'pre-wrap',
              overflow: 'hidden',
              ...fontCss(el),
            }}
          >
            <TokenText text={el.text} preview={preview} />
          </div>
        </div>
      );

    case 'field':
      return (
        <div class="el-content" style={boxCss(el, true)}>
          <div
            style={{
              display: 'flex',
              alignItems: alignFor(el.valign),
              justifyContent: justifyFor(el.align),
              gap: '8px',
              height: '100%',
              ...fontCss(el),
            }}
          >
            {el.label && (
              <span style={{ minWidth: `${el.labelWidth}px`, color: el.color, opacity: 0.6, fontWeight: 600 }}>
                {el.label}
              </span>
            )}
            <span style={{ fontWeight: el.bold ? 700 : 600 }}>
              <TokenText text={`{{${el.token}}}`} preview={preview} />
            </span>
          </div>
        </div>
      );

    case 'divider':
      return (
        <div class="el-content" style={{ display: 'flex', alignItems: 'center' }}>
          <div style={{ width: '100%', height: 0, borderTop: `${el.thickness}px ${el.style} ${el.color}` }} />
        </div>
      );

    case 'image':
      return (
        <div class="el-content">
          {el.src ? (
            <img
              src={el.src}
              alt=""
              draggable={false}
              style={{ width: '100%', height: '100%', objectFit: el.fit, borderRadius: `${el.radius}px`, pointerEvents: 'none' }}
            />
          ) : (
            <div class="image-placeholder" style={{ borderRadius: `${el.radius}px` }}>
              🖼 Logo — double-click to upload
            </div>
          )}
        </div>
      );

    case 'summary': {
      const jc = el.align === 'center' ? 'center' : el.align === 'right' ? 'flex-end' : 'flex-start';
      return (
        <div class="el-content" style={boxCss(el, true)}>
          <div
            style={{
              height: '100%',
              display: 'flex',
              flexDirection: 'column',
              justifyContent: 'center',
              alignItems: jc,
              textAlign: el.align,
              gap: '2px',
            }}
          >
            <div style={{ fontSize: '11px', letterSpacing: '.08em', fontWeight: 700, opacity: 0.7 }}>{el.label}</div>
            <div
              style={{
                fontSize: `${el.fontSize + 11}px`,
                fontWeight: el.bold ? 700 : 500,
                fontFamily: el.fontFamily,
                color: el.accent,
                lineHeight: 1.05,
                letterSpacing: '-0.01em',
                fontVariantNumeric: 'tabular-nums',
              }}
            >
              {el.value ? el.value : <TokenText text={`{{${el.token}}}`} preview={preview} />}
            </div>
            {el.sub && (
              <div style={{ fontSize: '11px', opacity: 0.75, marginTop: '2px' }}>
                <TokenText text={el.sub} preview={preview} />
              </div>
            )}
          </div>
        </div>
      );
    }

    case 'table': {
      const detailed = el.showHoursRate;
      let total = 0;
      const stripe = el.stripeBg ?? '#f6f8fd';
      const rows = el.rows.map((r, i) => {
        total += parseAmount(r.amount);
        const cellStyle: JSX.CSSProperties = {};
        const rowBg = r.bg ?? (i % 2 === 1 ? stripe : undefined);
        if (rowBg && rowBg !== 'transparent') cellStyle.background = rowBg;
        if (r.color) cellStyle.color = r.color;
        return (
          <tr key={i} style={r.height ? { height: `${r.height}px` } : undefined}>
            <td style={cellStyle}>{r.label}</td>
            {detailed && <td class="amt" style={cellStyle}>{r.hours ?? ''}</td>}
            {detailed && <td class="amt" style={cellStyle}>{r.rate ?? ''}</td>}
            <td class="amt" style={cellStyle}>{r.amount}</td>
          </tr>
        );
      });
      const ff = el.fontFamily;
      const cols = detailed ? 4 : 2;
      const fractions = columnFractions(el);
      const spacerRow = Math.max(18, Math.round(el.fontSize) + 11); // ruled-line spacing ≈ a data row
      const totalText = total.toLocaleString(undefined, { minimumFractionDigits: 2, maximumFractionDigits: 2 });
      return (
        <div class="el-content" style={{ ...boxCss(el, true), display: 'flex', flexDirection: 'column' }}>
          {el.title && (
            <div style={{ fontSize: `${el.titleFontSize ?? el.fontSize + 2}px`, fontWeight: 800, marginBottom: '6px', color: el.accent, fontFamily: ff }}>
              {el.title}
            </div>
          )}
          <table
            class="pay-tbl"
            style={{ fontSize: `${el.fontSize}px`, fontFamily: ff, flex: '1 1 auto', height: '100%', tableLayout: 'fixed' }}
          >
            <colgroup>
              {fractions.map((f, i) => (
                <col key={i} style={{ width: `${f * 100}%` }} />
              ))}
            </colgroup>
            {el.showHead && (() => {
              const thStyle: JSX.CSSProperties = {
                background: el.accent,
                color: el.headColor,
                // Always explicit so the header row never inherits (and is never
                // resized by) the body text size.
                fontSize: `${el.headFontSize ?? 11}px`,
                fontWeight: el.headBold === false ? 500 : 700,
                fontFamily: el.headFontFamily || el.fontFamily,
              };
              if (el.headHeight) thStyle.height = `${el.headHeight}px`;
              return (
                <thead>
                  <tr style={el.headHeight ? { height: `${el.headHeight}px` } : undefined}>
                    <th style={thStyle}>{el.labelCol}</th>
                    {detailed && <th class="amt" style={thStyle}>{el.hoursCol}</th>}
                    {detailed && <th class="amt" style={thStyle}>{el.rateCol}</th>}
                    <th class="amt" style={thStyle}>{el.amtCol}</th>
                  </tr>
                </thead>
              );
            })()}
            <tbody>
              {rows}
              {/* Growing spacer keeps the total pinned to the bottom — no manual blank
                  rows. Faint ruled lines fill the empty space (like ruled paper). */}
              {el.showTotal && (
                <tr class="pt-spacer">
                  <td
                    colSpan={cols}
                    style={
                      el.showRules === false
                        ? undefined
                        : {
                            backgroundImage: `repeating-linear-gradient(to bottom, transparent 0, transparent ${spacerRow - 0.5}px, #edf0f6 ${spacerRow - 0.5}px, #edf0f6 ${spacerRow}px)`,
                          }
                    }
                  />
                </tr>
              )}
              {el.showTotal && (
                <tr class="total">
                  <td colSpan={detailed ? 3 : 1} style={{ color: el.totalColor }}>{el.totalLabel}</td>
                  <td class="amt" style={{ color: el.totalColor }}>{totalText}</td>
                </tr>
              )}
            </tbody>
          </table>
        </div>
      );
    }

    case 'box':
      return <div class="el-content" style={boxCss(el, true)} />;

    default: {
      const exhaustive: never = el;
      return <>{String(exhaustive)}</>;
    }
  }
}
