import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { Popover } from '../overlays/Popover';
import { Tooltip } from '../overlays/Tooltip';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, fallback = ''): string => typeof v === 'string' ? v : fallback;
const b = (v: PropValues[string] | undefined): boolean => v === true;

function PopoverPreview({ props, initiallyOpen = false }: { props: PropValues; initiallyOpen?: boolean }): VNode {
  const [anchor, setAnchor] = useState<HTMLElement | null>(null);
  const [open, setOpen] = useState(initiallyOpen);
  return (
    <div style={{ minHeight: '190px', display: 'flex', alignItems: 'flex-start', justifyContent: 'center' }}>
      <Button
        variant="secondary"
        aria-haspopup="dialog"
        aria-expanded={open}
        onClick={(e) => { setAnchor(e.currentTarget as HTMLElement); setOpen(value => !value); }}
      >
        Review details
      </Button>
      <Popover
        open={open}
        anchor={anchor}
        onClose={() => setOpen(false)}
        label={s(props.label, 'Review details')}
        align={s(props.align, 'start') as 'start' | 'center' | 'end'}
        matchAnchorWidth={b(props.matchAnchorWidth)}
        initialFocus={b(props.initialFocus)}
      >
        <div style={{ display: 'grid', gap: '10px' }}>
          <strong style={{ fontSize: '0.86rem' }}>Approval context</strong>
          <span style={{ color: 'var(--ui-color-text-secondary)', fontSize: '0.78rem', lineHeight: 1.5 }}>
            This change affects 18 active employees and will be written to the audit trail.
          </span>
          <Button variant="primary" size="sm">Review change</Button>
        </div>
      </Popover>
    </div>
  );
}

export const popoverDef: ComponentDef = {
  id: 'popover',
  name: 'Popover',
  category: 'overlays',
  description: 'A named, non-modal dialog anchored to a control. It shares the portal, collision and dismissal engine used by every canonical dropdown.',
  status: 'stable',
  componentPath: 'src/ui/overlays/Popover.tsx',
  importFrom: '@ui',
  props: {
    label: { type: 'text', label: 'Accessible label', default: 'Review details' },
    align: { type: 'segmented', label: 'Alignment', options: ['start', 'center', 'end'], default: 'start' },
    matchAnchorWidth: { type: 'boolean', label: 'Match anchor width', default: false },
    initialFocus: { type: 'boolean', label: 'Move focus inside', default: false },
  },
  style: [{ label: 'Surface', controls: [
    { name: '--ui-popover-min-width', label: 'Minimum width', kind: 'size' },
    { name: '--ui-popover-max-width', label: 'Maximum width', kind: 'size' },
    { name: '--ui-popover-padding', label: 'Padding', kind: 'text' },
    { name: '--ui-popup-bg', label: 'Background', kind: 'color' },
    { name: '--ui-popup-border', label: 'Border', kind: 'color' },
    { name: '--ui-popup-radius', label: 'Corner radius', kind: 'size' },
  ] }],
  states: ['default', 'open'],
  compare: ['default', 'open'],
  a11y: {
    role: 'dialog (non-modal)',
    name: 'The required label names the portalled surface.',
    keyboard: [
      { keys: 'Escape', does: 'Closes and returns focus to the anchor.' },
      { keys: 'Tab', does: 'Moves through interactive content without trapping focus.' },
    ],
    focus: 'Stays on the anchor by default; initialFocus moves it to the first interactive descendant when the task requires it.',
    notes: ['Use DropdownMenu for a list of actions and Tooltip for a short non-interactive hint.'],
  },
  migration: { notes: ['Promotes the existing AnchoredPopup runtime; no second positioning engine was introduced.'] },
  render: (p, state) => <PopoverPreview props={p} initiallyOpen={state === 'open'} />,
  code: p => `<Popover
  open={open}
  anchor={trigger}
  onClose={() => setOpen(false)}
  label="${s(p.label, 'Review details')}"${s(p.align, 'start') !== 'start' ? `
  align="${s(p.align)}"` : ''}${b(p.matchAnchorWidth) ? '\n  matchAnchorWidth' : ''}${b(p.initialFocus) ? '\n  initialFocus' : ''}
>
  <ApprovalContext />
</Popover>`,
};

export const tooltipDef: ComponentDef = {
  id: 'tooltip',
  name: 'Tooltip',
  category: 'overlays',
  description: 'A short, non-interactive explanation for any single control, shown on hover and keyboard focus and portalled beyond clipping ancestors.',
  status: 'stable',
  componentPath: 'src/ui/overlays/Tooltip.tsx',
  importFrom: '@ui',
  props: {
    content: { type: 'text', label: 'Content', default: 'Locked after approval' },
    disabled: { type: 'boolean', label: 'Disabled', default: false },
    showDelay: { type: 'number', label: 'Hover delay', default: 350, min: 0, max: 1000, step: 50 },
    maxWidth: { type: 'number', label: 'Maximum width', default: 260, min: 140, max: 420, step: 10 },
  },
  style: [{ label: 'Bubble', controls: [
    { name: '--ui-tooltip-bg', label: 'Background', kind: 'color' },
    { name: '--ui-tooltip-fg', label: 'Text', kind: 'color' },
    { name: '--ui-tooltip-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-tooltip-padding', label: 'Padding', kind: 'text' },
    { name: '--ui-tooltip-font-size', label: 'Text size', kind: 'size' },
  ] }],
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'tooltip',
    name: 'aria-describedby is merged onto the trigger without replacing an existing description.',
    keyboard: [
      { keys: 'Focus', does: 'Shows immediately.' },
      { keys: 'Escape', does: 'Dismisses without activating the trigger.' },
    ],
    focus: 'Never receives focus. Focus remains on the described control.',
    notes: ['Content is non-interactive. Use Popover when the surface contains actions or fields.'],
  },
  migration: { deprecatedImports: ['InfoTip'], notes: ['InfoTip now composes this component for the information-icon treatment.'] },
  render: p => (
    <Tooltip
      content={s(p.content, 'Locked after approval')}
      disabled={b(p.disabled)}
      showDelay={typeof p.showDelay === 'number' ? p.showDelay : 350}
      maxWidth={typeof p.maxWidth === 'number' ? p.maxWidth : 260}
    >
      <Button variant="ghost" iconOnly aria-label="Approval policy" iconLeft={<LucideIcon name="LockKeyhole" />} />
    </Tooltip>
  ),
  code: p => `<Tooltip content="${s(p.content, 'Locked after approval')}"${b(p.disabled) ? ' disabled' : ''}>
  <Button variant="ghost" iconOnly aria-label="Approval policy" iconLeft={<LockKeyhole />} />
</Tooltip>`,
};

export const OVERLAY_DEFS: readonly ComponentDef[] = [popoverDef, tooltipDef];
