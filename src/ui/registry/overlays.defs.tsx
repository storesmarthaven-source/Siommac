import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { Popover } from '../overlays/Popover';
import { Tooltip } from '../overlays/Tooltip';
import type { CpopOptions } from '../../lib/popup';
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

function SweetAlertPreview({ props }: { props: PropValues }): VNode {
  const mode = s(props.mode, 'confirm');
  const showIcon = b(props.showIcon);
  const tone = s(props.tone, 'question');
  const timed = mode === 'timed';
  const prompt = mode === 'prompt';
  const loading = mode === 'loading';
  const options: CpopOptions = {
    icon: showIcon ? tone : false,
    loading,
    title: loading ? 'Updating application' : prompt ? 'Name this version' : 'Publish these changes?',
    text: loading ? 'Please wait while the design system is updated.' : 'This version will update every canonical consumer in the application.',
    input: prompt ? s(props.inputType, 'text') as CpopOptions['input'] : undefined,
    inputPlaceholder: prompt ? 'Version name' : undefined,
    showConfirmButton: !loading,
    showCancelButton: (mode === 'confirm' || prompt) && b(props.showCancel),
    confirmButtonText: 'Publish',
    cancelButtonText: 'Cancel',
    allowOutsideClick: !loading && b(props.allowDismiss),
    timer: timed && typeof props.duration === 'number' ? props.duration : undefined,
    timerProgressBar: timed && b(props.progress),
  };
  return (
    <div style={{ minHeight: '190px', display: 'grid', placeItems: 'center' }}>
      <Button variant="primary" onClick={() => {
        void import('../../lib/popup').then(({ cpop }) => cpop.fire(options));
      }}>Preview alert</Button>
    </div>
  );
}

export const popoverDef: ComponentDef = {
  id: 'popover',
  thumbnail: 'popover',
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
  thumbnail: 'tooltip',
  name: 'Tooltip',
  category: 'overlays',
  description: 'A short, non-interactive explanation for any single control, shown on hover and keyboard focus and portalled beyond clipping ancestors.',
  status: 'stable',
  componentPath: 'src/ui/overlays/Tooltip.tsx',
  importFrom: '@ui',
  props: {
    content: { type: 'text', label: 'Title', default: 'Locked after approval' },
    description: { type: 'text', label: 'Supporting text', default: '' },
    arrow: { type: 'boolean', label: 'Show arrow', default: false },
    disabled: { type: 'boolean', label: 'Disabled', default: false },
    showDelay: { type: 'number', label: 'Hover delay', default: 300, min: 0, max: 1000, step: 50 },
    maxWidth: { type: 'number', label: 'Maximum width', default: 320, min: 140, max: 420, step: 10 },
  },
  style: [{ label: 'Bubble', controls: [
    { name: '--ui-tooltip-bg', label: 'Background', kind: 'color' },
    { name: '--ui-tooltip-fg', label: 'Text', kind: 'color' },
    { name: '--ui-tooltip-radius', label: 'Corner radius', kind: 'size' },
    { name: '--ui-tooltip-padding', label: 'Padding', kind: 'text' },
    { name: '--ui-tooltip-font-size', label: 'Text size', kind: 'size' },
    { name: '--ui-tooltip-supporting-fg', label: 'Supporting text', kind: 'color' },
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
      description={s(p.description) || undefined}
      arrow={b(p.arrow)}
      disabled={b(p.disabled)}
      showDelay={typeof p.showDelay === 'number' ? p.showDelay : 300}
      maxWidth={typeof p.maxWidth === 'number' ? p.maxWidth : 320}
    >
      <Button variant="ghost" iconOnly aria-label="Approval policy" iconLeft={<LucideIcon name="LockKeyhole" />} />
    </Tooltip>
  ),
  code: p => `<Tooltip content="${s(p.content, 'Locked after approval')}"${s(p.description) ? ` description="${s(p.description)}"` : ''}${b(p.arrow) ? ' arrow' : ''}${b(p.disabled) ? ' disabled' : ''}>
  <Button variant="ghost" iconOnly aria-label="Approval policy" iconLeft={<LockKeyhole />} />
</Tooltip>`,
};

export const sweetAlertDef: ComponentDef = {
  id: 'sweet-alert',
  thumbnail: 'sweet-alert',
  name: 'SweetAlert2 Popup',
  category: 'overlays',
  description: 'The existing app popup for alerts, confirmations, prompts and blocking progress, exposed through the SweetAlert2-compatible API.',
  status: 'stable',
  componentPath: 'src/lib/popup.ts',
  importFrom: '@lib/popup',
  props: {
    mode: { type: 'segmented', label: 'Type', options: ['alert', 'confirm', 'prompt', 'loading', 'timed'], default: 'confirm' },
    tone: { type: 'segmented', label: 'Icon', options: ['success', 'error', 'warning', 'info', 'question'], default: 'question' },
    showIcon: { type: 'boolean', label: 'Show icon', default: true },
    showCancel: { type: 'boolean', label: 'Cancel action', default: true, visibleWhen: { prop: 'mode', in: ['confirm', 'prompt'] } },
    allowDismiss: { type: 'boolean', label: 'Backdrop dismiss', default: true, visibleWhen: { prop: 'mode', in: ['confirm', 'prompt', 'timed'] } },
    inputType: { type: 'select', label: 'Input type', options: ['text', 'email', 'password', 'number', 'textarea'], default: 'text', visibleWhen: { prop: 'mode', equals: 'prompt' } },
    duration: { type: 'number', label: 'Duration (ms)', default: 4000, min: 1000, max: 15000, step: 500, visibleWhen: { prop: 'mode', equals: 'timed' } },
    progress: { type: 'boolean', label: 'Timer progress', default: true, visibleWhen: { prop: 'mode', equals: 'timed' } },
  },
  style: [
    { label: 'Surface', controls: [
      { name: '--ui-sweet-alert-width', label: 'Maximum width', kind: 'size' },
      { name: '--ui-sweet-alert-radius', label: 'Corner radius', kind: 'size' },
      { name: '--ui-sweet-alert-padding', label: 'Content padding', kind: 'text' },
      { name: '--ui-sweet-alert-background', label: 'Background', kind: 'color' },
      { name: '--ui-sweet-alert-backdrop', label: 'Backdrop', kind: 'color-alpha' },
      { name: '--ui-sweet-alert-backdrop-blur', label: 'Backdrop blur', kind: 'size' },
    ] },
    { label: 'Icon and type', controls: [
      { name: '--ui-sweet-alert-icon-size', label: 'Icon size', kind: 'size' },
      { name: '--ui-sweet-alert-title-size', label: 'Title size', kind: 'size' },
      { name: '--ui-sweet-alert-text-size', label: 'Message size', kind: 'size' },
      { name: '--ui-sweet-alert-title-color', label: 'Title color', kind: 'color' },
      { name: '--ui-sweet-alert-text-color', label: 'Message color', kind: 'color' },
    ] },
    { label: 'Actions', controls: [
      { name: '--ui-sweet-alert-action-radius', label: 'Button radius', kind: 'size' },
      { name: '--ui-sweet-alert-action-height', label: 'Button height', kind: 'size' },
      { name: '--ui-sweet-alert-action-gap', label: 'Button gap', kind: 'size' },
    ] },
  ],
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'dialog with aria-modal="true".',
    name: 'The visible popup title labels the dialog.',
    keyboard: [
      { keys: 'Escape', does: 'Dismisses only when the alert contract allows dismissal.' },
      { keys: 'Tab / Shift+Tab', does: 'Cycles within the alert.' },
      { keys: 'Enter', does: 'Confirms a single-line prompt.' },
    ],
    focus: 'The prompt receives focus when present; the popup remains modal until it resolves.',
    notes: ['Errors, warnings and loading alerts require an explicit resolution and cannot be dismissed through the backdrop.'],
  },
  migration: { notes: ['The existing SweetAlert2-compatible runtime remains in place and now consumes the published Studio variables for its surface, typography, icon, backdrop and actions.'] },
  render: p => <SweetAlertPreview props={p} />,
  code: p => `await cpop.fire({\n  icon: ${b(p.showIcon) ? `'${s(p.tone, 'question')}'` : 'false'},\n  title: 'Publish these changes?',${b(p.showCancel) ? '\n  showCancelButton: true,' : ''}${s(p.mode) === 'prompt' ? `\n  input: '${s(p.inputType, 'text')}',` : ''}${s(p.mode) === 'timed' ? `\n  timer: ${typeof p.duration === 'number' ? p.duration : 4000},\n  timerProgressBar: ${b(p.progress)},` : ''}\n  confirmButtonText: 'Publish'\n});`,
};

export const OVERLAY_DEFS: readonly ComponentDef[] = [popoverDef, tooltipDef, sweetAlertDef];
