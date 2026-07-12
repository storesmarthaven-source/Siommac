import type {
  DesignElement,
  DividerElement,
  ElementPatch,
  FieldElement,
  ImageElement,
  SummaryElement,
  TableElement,
  TextElement,
} from '@payslip/types';
import type { StyledElement } from '@payslip/model/guards';
import { FONT_OPTIONS } from '@payslip/constants/fonts';
import { TOKEN_GROUPS } from '@payslip/constants/tokens';
import { pickFile, readImageFile } from '@payslip/lib/download';
import { ColorField } from '@payslip/components/color/ColorField';
import { NumberInput, Row, Select, SubHead, TextArea, TextInput } from '@payslip/components/ui/controls';

export type Setter = (patch: ElementPatch) => void;

interface Props<T> {
  el: T;
  set: Setter;
  commit: () => void;
}

/* ---------- reusable pickers ---------- */

function TokenSelect({ value, onChange }: { value: string; onChange: (v: string) => void }) {
  return (
    <select value={value} onChange={(e) => onChange((e.target as HTMLSelectElement).value)}>
      {TOKEN_GROUPS.map((g) => (
        <optgroup key={g.label} label={g.label}>
          {g.keys.map((k) => (
            <option key={k} value={k}>
              {k}
            </option>
          ))}
        </optgroup>
      ))}
    </select>
  );
}

function ColorRow({
  label,
  value,
  alpha,
  transparent,
  set,
  commit,
  prop,
}: {
  label: string;
  value: string;
  alpha?: boolean;
  transparent?: boolean;
  set: Setter;
  commit: () => void;
  prop: 'color' | 'bg' | 'borderColor' | 'accent' | 'headColor' | 'totalColor' | 'stripeBg';
}) {
  return (
    <Row label={label}>
      <ColorField
        value={value}
        alpha={alpha}
        transparent={transparent}
        onChange={(c) => {
          const patch: ElementPatch = {};
          (patch as Record<string, string>)[prop] = c;
          set(patch);
        }}
        onCommit={commit}
      />
    </Row>
  );
}

/* ---------- sections ---------- */

export function GeometrySection({ el, set, commit }: Props<DesignElement>) {
  const num = (prop: 'x' | 'y' | 'w' | 'h') => (
    <NumberInput value={el[prop]} onInput={(v) => set({ [prop]: v })} onCommit={commit} />
  );
  return (
    <>
      <SubHead>Position &amp; size</SubHead>
      <div class="grid2">
        <Row label="X">{num('x')}</Row>
        <Row label="Y">{num('y')}</Row>
        <Row label="W">{num('w')}</Row>
        <Row label="H">{num('h')}</Row>
      </div>
    </>
  );
}

export function TypographySection({ el, set, commit }: Props<StyledElement>) {
  return (
    <>
      <SubHead>Typography</SubHead>
      <div class="grid2">
        <Row label="Size">
          <NumberInput value={el.fontSize} onInput={(v) => set({ fontSize: v })} onCommit={commit} />
        </Row>
        <Row label="Line">
          <NumberInput value={el.lineHeight} step={0.1} onInput={(v) => set({ lineHeight: v })} onCommit={commit} />
        </Row>
      </div>
      <Row label="Font">
        <Select value={el.fontFamily} options={FONT_OPTIONS} onChange={(v) => { set({ fontFamily: v }); commit(); }} />
      </Row>
      <ColorRow label="Color" prop="color" value={el.color} alpha set={set} commit={commit} />
      <Row label="Style">
        <div class="seg">
          <button class={el.bold ? 'on' : ''} style={{ fontWeight: 800 }} onClick={() => { set({ bold: !el.bold }); commit(); }}>B</button>
          <button class={el.italic ? 'on' : ''} style={{ fontStyle: 'italic' }} onClick={() => { set({ italic: !el.italic }); commit(); }}>I</button>
          <button class={el.underline ? 'on' : ''} style={{ textDecoration: 'underline' }} onClick={() => { set({ underline: !el.underline }); commit(); }}>U</button>
        </div>
      </Row>
    </>
  );
}

export function AlignSection({ el, set, commit }: Props<StyledElement>) {
  const seg = <T extends string>(current: T, opts: T[], onPick: (v: T) => void) => (
    <div class="seg">
      {opts.map((o) => (
        <button key={o} class={current === o ? 'on' : ''} onClick={() => { onPick(o); commit(); }}>
          {o.charAt(0).toUpperCase()}
        </button>
      ))}
    </div>
  );
  return (
    <>
      <Row label="Align">{seg(el.align, ['left', 'center', 'right'], (v) => set({ align: v }))}</Row>
      <Row label="V-align">{seg(el.valign, ['top', 'middle', 'bottom'], (v) => set({ valign: v }))}</Row>
    </>
  );
}

export function ContentSection({ el, set, commit }: Props<TextElement>) {
  return (
    <>
      <SubHead>Content</SubHead>
      <Row>
        <TextArea value={el.text} placeholder="Use {{tokens}}" onInput={(v) => set({ text: v })} onCommit={commit} />
      </Row>
    </>
  );
}

export function FieldSection({ el, set, commit }: Props<FieldElement>) {
  return (
    <>
      <SubHead>Field</SubHead>
      <Row label="Label">
        <TextInput value={el.label} onInput={(v) => set({ label: v })} onCommit={commit} />
      </Row>
      <Row label="Token">
        <TokenSelect value={el.token} onChange={(v) => { set({ token: v }); commit(); }} />
      </Row>
      <Row label="Label w">
        <NumberInput value={el.labelWidth} onInput={(v) => set({ labelWidth: v })} onCommit={commit} />
      </Row>
    </>
  );
}

export function SummarySection({ el, set, commit }: Props<SummaryElement>) {
  return (
    <>
      <SubHead>Net / summary box</SubHead>
      <Row label="Label">
        <TextInput value={el.label} onInput={(v) => set({ label: v })} onCommit={commit} />
      </Row>
      <Row label="Amount">
        <TokenSelect value={el.token} onChange={(v) => { set({ token: v }); commit(); }} />
      </Row>
      <Row label="Static">
        <TextInput value={el.value} placeholder="overrides token" onInput={(v) => set({ value: v })} onCommit={commit} />
      </Row>
      <Row label="Subtext">
        <TextInput value={el.sub} onInput={(v) => set({ sub: v })} onCommit={commit} />
      </Row>
      <ColorRow label="Accent" prop="accent" value={el.accent} alpha set={set} commit={commit} />
      <ColorRow label="Background" prop="bg" value={el.bg} alpha transparent set={set} commit={commit} />
      <Row label="Radius">
        <NumberInput value={el.radius} onInput={(v) => set({ radius: v })} onCommit={commit} />
      </Row>
    </>
  );
}

export function DividerSection({ el, set, commit }: Props<DividerElement>) {
  return (
    <>
      <SubHead>Line</SubHead>
      <Row label="Thick">
        <NumberInput value={el.thickness} onInput={(v) => set({ thickness: v })} onCommit={commit} />
      </Row>
      <Row label="Style">
        <Select
          value={el.style}
          options={[
            { value: 'solid', label: 'solid' },
            { value: 'dashed', label: 'dashed' },
            { value: 'dotted', label: 'dotted' },
          ]}
          onChange={(v) => { set({ style: v }); commit(); }}
        />
      </Row>
      <ColorRow label="Color" prop="color" value={el.color} set={set} commit={commit} />
    </>
  );
}

export function ImageSection({ el, set, commit }: Props<ImageElement>) {
  const upload = async () => {
    const file = await pickFile('image/*');
    if (!file) return;
    set({ src: await readImageFile(file) });
    commit();
  };
  return (
    <>
      <SubHead>Image</SubHead>
      <Row>
        <button class="btn full" onClick={upload}>
          {el.src ? 'Replace image…' : 'Upload image…'}
        </button>
      </Row>
      <Row label="Fit">
        <Select
          value={el.fit}
          options={[
            { value: 'contain', label: 'contain' },
            { value: 'cover', label: 'cover' },
            { value: 'fill', label: 'fill' },
          ]}
          onChange={(v) => { set({ fit: v }); commit(); }}
        />
      </Row>
      <Row label="Radius">
        <NumberInput value={el.radius} onInput={(v) => set({ radius: v })} onCommit={commit} />
      </Row>
    </>
  );
}

export function TableSection({ el, set, commit }: Props<TableElement>) {
  const rows = el.rows;
  const detailed = el.showHoursRate;
  const setRow = (i: number, key: keyof TableElement['rows'][number], value: string | number | undefined) => {
    set({ rows: rows.map((r, idx) => (idx === i ? { ...r, [key]: value } : r)) });
  };
  return (
    <>
      <SubHead>Table title</SubHead>
      <Row label="Title">
        <TextInput value={el.title} onInput={(v) => set({ title: v })} onCommit={commit} />
      </Row>
      <Row label="Title size">
        <NumberInput value={el.titleFontSize ?? el.fontSize + 2} onInput={(v) => set({ titleFontSize: v })} onCommit={commit} />
      </Row>

      <SubHead>Columns &amp; body</SubHead>
      <div class="grid2">
        <Row label="Desc col">
          <TextInput value={el.labelCol} onInput={(v) => set({ labelCol: v })} onCommit={commit} />
        </Row>
        <Row label="Amt col">
          <TextInput value={el.amtCol} onInput={(v) => set({ amtCol: v })} onCommit={commit} />
        </Row>
      </div>
      <Row label="Row size">
        <NumberInput value={el.fontSize} onInput={(v) => set({ fontSize: v })} onCommit={commit} />
      </Row>
      <Row label="Font">
        <Select value={el.fontFamily} options={FONT_OPTIONS} onChange={(v) => { set({ fontFamily: v }); commit(); }} />
      </Row>
      <div class="field-note">Row size = the data lines. The column-header row has its own size below.</div>
      <div class="field-note">Tip: select the table, then drag the dividers between columns to resize each column.</div>
      {el.colFr && (
        <button class="btn full" style={{ marginTop: '2px' }} onClick={() => { set({ colFr: undefined }); commit(); }}>
          ↺ Reset column widths
        </button>
      )}
      <ColorRow label="Accent" prop="accent" value={el.accent} alpha set={set} commit={commit} />

      <SubHead>Column header row</SubHead>
      <ColorRow label="Header text" prop="headColor" value={el.headColor} set={set} commit={commit} />
      <div class="grid2">
        <Row label="Header size">
          <NumberInput value={el.headFontSize ?? 11} onInput={(v) => set({ headFontSize: v })} onCommit={commit} />
        </Row>
        <Row label="Header height">
          <NumberInput value={el.headHeight ?? 0} onInput={(v) => set({ headHeight: v || undefined })} onCommit={commit} />
        </Row>
      </div>
      <Row label="Header font">
        <Select value={el.headFontFamily || el.fontFamily} options={FONT_OPTIONS} onChange={(v) => { set({ headFontFamily: v }); commit(); }} />
      </Row>
      <Row label="Head bold">
        <input
          type="checkbox"
          checked={el.headBold !== false}
          style={{ flex: 'none', width: 'auto' }}
          onChange={(e) => { set({ headBold: (e.target as HTMLInputElement).checked }); commit(); }}
        />
        <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Bold header text</span>
      </Row>
      <ColorRow label="Total txt" prop="totalColor" value={el.totalColor} set={set} commit={commit} />
      <ColorRow label="Stripe" prop="stripeBg" value={el.stripeBg ?? '#f6f8fd'} transparent set={set} commit={commit} />
      <Row label="Total?">
        <input
          type="checkbox"
          checked={el.showTotal}
          style={{ flex: 'none', width: 'auto' }}
          onChange={(e) => { set({ showTotal: (e.target as HTMLInputElement).checked }); commit(); }}
        />
        <TextInput value={el.totalLabel} onInput={(v) => set({ totalLabel: v })} onCommit={commit} />
      </Row>
      <Row label="Hrs/Rate">
        <input
          type="checkbox"
          checked={detailed}
          style={{ flex: 'none', width: 'auto' }}
          onChange={(e) => { set({ showHoursRate: (e.target as HTMLInputElement).checked }); commit(); }}
        />
        <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Show Hours &amp; Rate columns</span>
      </Row>
      <Row label="Ruled fill">
        <input
          type="checkbox"
          checked={el.showRules !== false}
          style={{ flex: 'none', width: 'auto' }}
          onChange={(e) => { set({ showRules: (e.target as HTMLInputElement).checked }); commit(); }}
        />
        <span style={{ fontSize: '11.5px', color: 'var(--muted)' }}>Ruled lines in empty space</span>
      </Row>
      {detailed && (
        <div class="grid2">
          <Row label="Hrs col">
            <TextInput value={el.hoursCol} onInput={(v) => set({ hoursCol: v })} onCommit={commit} />
          </Row>
          <Row label="Rate col">
            <TextInput value={el.rateCol} onInput={(v) => set({ rateCol: v })} onCommit={commit} />
          </Row>
        </div>
      )}
      <SubHead>Rows</SubHead>
      {rows.map((r, i) => (
        <div class="trow-block" key={i}>
          <div class="trow" style={detailed ? { gridTemplateColumns: '1fr 46px 52px 60px 24px' } : undefined}>
            <TextInput value={r.label} onInput={(v) => setRow(i, 'label', v)} onCommit={commit} />
            {detailed && <TextInput value={r.hours ?? ''} onInput={(v) => setRow(i, 'hours', v)} onCommit={commit} />}
            {detailed && <TextInput value={r.rate ?? ''} onInput={(v) => setRow(i, 'rate', v)} onCommit={commit} />}
            <TextInput value={r.amount} onInput={(v) => setRow(i, 'amount', v)} onCommit={commit} />
            <button class="del" onClick={() => { set({ rows: rows.filter((_, idx) => idx !== i) }); commit(); }}>
              ✕
            </button>
          </div>
          <div class="trow-style">
            <span class="tsl">Row</span>
            <ColorField
              value={r.bg ?? 'transparent'}
              transparent
              compact
              title="Row background"
              onChange={(c) => setRow(i, 'bg', c === 'transparent' ? undefined : c)}
              onCommit={commit}
            />
            <ColorField
              value={r.color ?? '#243049'}
              compact
              title="Row text colour"
              onChange={(c) => setRow(i, 'color', c)}
              onCommit={commit}
            />
            <span class="tsl">H</span>
            <input
              class="trow-h"
              type="number"
              placeholder="auto"
              value={r.height ?? ''}
              onInput={(e) => {
                const v = (e.target as HTMLInputElement).value;
                setRow(i, 'height', v === '' ? undefined : parseFloat(v) || 0);
              }}
              onChange={commit}
            />
          </div>
        </div>
      ))}
      <button class="btn full" style={{ marginTop: '6px' }} onClick={() => { set({ rows: [...rows, { label: 'New line', amount: '0.00' }] }); commit(); }}>
        + Add row
      </button>
    </>
  );
}

export function FillSection({ el, set, commit }: Props<StyledElement>) {
  return (
    <>
      <SubHead>Fill &amp; border</SubHead>
      <ColorRow label="Background" prop="bg" value={el.bg} alpha transparent set={set} commit={commit} />
      <div class="grid2">
        <Row label="Border">
          <NumberInput value={el.borderW} onInput={(v) => set({ borderW: v })} onCommit={commit} />
        </Row>
        <Row label="Radius">
          <NumberInput value={el.radius} onInput={(v) => set({ radius: v })} onCommit={commit} />
        </Row>
      </div>
      <ColorRow label="B-color" prop="borderColor" value={el.borderColor} set={set} commit={commit} />
      <Row label="Padding">
        <NumberInput value={el.padding} onInput={(v) => set({ padding: v })} onCommit={commit} />
      </Row>
    </>
  );
}
