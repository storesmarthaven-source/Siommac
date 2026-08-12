/**
 * src/ui/registry/wizard.def.tsx — the Wizard entry.
 *
 * ONE Wizard card. Validation errors, optional/skipped steps, review/submit,
 * vertical presentation and the busy state are PRESETS of this entry, not
 * sibling entries — and there is no `WizardModal` card, because a modal wizard
 * is `<Dialog><Wizard /></Dialog>`.
 */

import { LucideIcon } from '../LucideIcon';
import { Badge } from '../primitives/Badge';
import { Wizard, type WizardStep } from '../navigation/Wizard';
import { type WizardOrientation } from '../navigation/Wizard';
import { type ComponentDef, type PropValues } from './types';

const s = (v: PropValues[string] | undefined, f = ''): string => (typeof v === 'string' ? v : f);
const b = (v: PropValues[string] | undefined): boolean => v === true;
const noop = (): void => { /* preview */ };

/** Step bodies are ordinary content — the wizard never invents business UI. */
function Body({ title, text }: { title: string; text: string }): preact.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <strong style={{ fontSize: '0.9rem' }}>{title}</strong>
      <p style={{ margin: 0, fontSize: '0.8rem', color: 'var(--text-muted)', lineHeight: 1.5 }}>{text}</p>
    </div>
  );
}

function ReviewBody(): preact.JSX.Element {
  return (
    <div style={{ display: 'flex', flexDirection: 'column', gap: '8px' }}>
      <strong style={{ fontSize: '0.9rem' }}>Review &amp; submit</strong>
      {[['Vendor', 'Atlantic Supplies Ltd'], ['Lines', '4'], ['Total', 'TT$18,420.00']].map(([k, v]) => (
        <div key={k} style={{ display: 'flex', justifyContent: 'space-between', fontSize: '0.8rem' }}>
          <span style={{ color: 'var(--text-muted)' }}>{k}</span><b>{v}</b>
        </div>
      ))}
      <Badge tone="warning" size="sm">Routes for approval — creator ≠ approver</Badge>
    </div>
  );
}

export const wizardDef: ComponentDef = {
  id: 'wizard',
  name: 'Wizard',
  category: 'navigation',
  description: 'ONE multi-step flow. Step validation, navigation gating, optional/skipped steps, an async on-the-way-out check and the Back/Skip/Continue/Submit footer are its behaviour. It owns NO overlay — a modal wizard is <Dialog><Wizard /></Dialog>.',
  status: 'stable',
  componentPath: 'src/ui/navigation/Wizard/Wizard.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.wz-modal', '.wz-step-tab', '.ui-wz-modal', '.ui-wz-step', '.hrfin-wiz-modal', '.hrfin-wiz-step-bar', '.ui-stepper-step'],
    deprecatedImports: ['LegacyWizard', 'WizardShell', 'HrfinWizardModal', 'Stepper'],
    nextSurface: 'Finance — the remaining 13 HrfinWizardModal flows',
    notes: [
      'Each of the three implementations owned its own backdrop, sheet, header and close button. That is what made them un-reusable on a page, and why a wizard never looked like the app\'s other dialogs. The canonical one owns the STEPS; Dialog owns the sheet.',
      'It is not a Tabs variant, and that is deliberate (RECIPES.md §7): a wizard is an ORDERED, GATED sequence with completed/skipped states and a terminal submit. Its steps are aria-current="step" in a <nav>, never role="tab".',
      'Validation does not disable the primary button. A disabled control states no reason — the wizard refuses the click and announces exactly what is missing in a role="alert" list. `submitDisabled` remains for server preconditions validation cannot express.',
      'Use `onBeforeNext` for work that must happen on the way OUT of a step (a duplicate check, a reservation). It is awaited and the wizard shows its own busy state, so the caller keeps no spinner flag.',
      '`Stepper` is absorbed: the step rail IS the wizard\'s. Its 5 remaining consumers move as their flows migrate.',
    ],
  },

  props: {
    orientation: { type: 'segmented', label: 'Orientation', options: ['horizontal', 'vertical'], default: 'horizontal' },
    step:        { type: 'select',    label: 'Current step', options: ['Vendor', 'Lines', 'Attachments', 'Review'], default: 'Lines' },
    invalid:     { type: 'boolean',   label: 'Current step invalid', default: false, help: 'Continue is refused and the issues are announced — the button is never silently disabled.' },
    revealed:    { type: 'boolean',   label: 'Issues already revealed', default: false, help: 'What the user sees after Continue was refused once.' },
    optional:    { type: 'boolean',   label: 'Attachments is optional', default: true },
    skippedStep: { type: 'boolean',   label: 'Attachments was skipped', default: false },
    disabledStep:{ type: 'boolean',   label: 'Lock a step (no permission)', default: false },
    busy:        { type: 'boolean',   label: 'Submitting', default: false },
    saveDraft:   { type: 'boolean',   label: 'Save-draft slot', default: false },
    cancel:      { type: 'boolean',   label: 'Cancel', default: true },
    aside:       { type: 'boolean',   label: 'Rail summary (vertical)', default: false },
  },

  style: [
    { label: 'Frame', controls: [
      { name: '--ui-wizard-pad',        label: 'Padding', kind: 'size' },
      { name: '--ui-wizard-rail-width', label: 'Rail width (vertical)', kind: 'size' },
      { name: '--ui-wizard-rail-bg',    label: 'Rail background', kind: 'color' },
      { name: '--ui-wizard-divider',    label: 'Divider', kind: 'color' },
      { name: '--ui-wizard-foot-bg',    label: 'Footer background', kind: 'color' },
    ] },
    { label: 'Step marker', controls: [
      { name: '--ui-wizard-marker-size',   label: 'Marker size', kind: 'size' },
      { name: '--ui-wizard-marker-bg',     label: 'Marker background', kind: 'color' },
      { name: '--ui-wizard-marker-border', label: 'Marker border', kind: 'color' },
      { name: '--ui-wizard-connector',     label: 'Connector', kind: 'color' },
      { name: '--ui-wizard-connector-done',label: 'Connector — done', kind: 'color' },
    ] },
    { label: 'Step states', controls: [
      { name: '--ui-wizard-current-bg',  label: 'Current', kind: 'color' },
      { name: '--ui-wizard-complete-bg', label: 'Complete', kind: 'color' },
      { name: '--ui-wizard-invalid-bg',  label: 'Invalid', kind: 'color' },
      { name: '--ui-wizard-skipped-fg',  label: 'Skipped text', kind: 'color' },
    ] },
    { label: 'Issues', controls: [
      { name: '--ui-wizard-issue-bg',     label: 'Background', kind: 'color-alpha' },
      { name: '--ui-wizard-issue-fg',     label: 'Text', kind: 'color' },
      { name: '--ui-wizard-issue-radius', label: 'Corner radius', kind: 'size' },
    ] },
  ],

  states: ['default', 'error', 'loading', 'disabled'],
  compare: ['default', 'error', 'loading'],

  a11y: {
    role: 'A <nav> containing an ordered list of step buttons. NOT a tablist — a gated sequence announced as tabs promises navigation the user does not have.',
    name: 'The required `label` names the step navigation. Each step is named by its label plus its state ("Attachments, optional, skipped").',
    keyboard: [
      { keys: 'Tab',           does: 'Reaches the reachable steps, then the footer. Steps you have not earned are disabled, so they are skipped rather than being dead stops.' },
      { keys: 'Enter / Space', does: 'Activates a step button (jump back), or the footer action.' },
    ],
    focus: 'On every step change focus moves to the step body, which is labelled by its step button. Without that, activating Continue leaves focus on a button that is now labelled differently, above content the user has never seen. The FIRST render is deliberately skipped — the wizard usually mounts inside a Dialog that has just placed focus itself.',
    notes: [
      'A refused Continue is announced through role="alert", not signalled by a disabled button. This is the single biggest accessibility difference from the three implementations it replaces, all of which disabled the primary control and explained nothing.',
      'The current step carries aria-current="step". Only the CURRENT step can be `invalid` — a step you have not reached has not been validated and must not be shown as failing.',
      'Forward jumping is impossible by construction: a step button is disabled until the step is reachable, and says why in its title.',
      'On phones the step list is replaced by a "Step 2 of 4" summary and a progress bar. The list is aria-hidden there, because the <ol> already announces the position.',
    ],
  },

  render: (p, st) => {
    const orientation = s(p.orientation, 'horizontal') as WizardOrientation;
    const currentLabel = s(p.step, 'Lines');
    const ids = ['vendor', 'lines', 'attachments', 'review'];
    const value = ids[['Vendor', 'Lines', 'Attachments', 'Review'].indexOf(currentLabel)] ?? 'lines';
    const invalid = b(p.invalid) || st === 'error';

    const steps: WizardStep[] = [
      { id: 'vendor', label: 'Vendor & header', description: 'Who and when',
        icon: <LucideIcon name="Building2" />,
        render: () => <Body title="Vendor & header" text="Pick the vendor, the invoice number and the dates. Terms and the default GL auto-fill from the vendor record." /> },
      { id: 'lines', label: 'Line items', description: 'What was billed',
        icon: <LucideIcon name="ListOrdered" />,
        validate: invalid
          ? () => ['Every line needs a description.', 'The bill total must be greater than zero.']
          : undefined,
        render: () => <Body title="Line items" text="One row per charge, each with its GL account, cost centre and tax code — pickers, never free text." /> },
      { id: 'attachments', label: 'Attachments', description: 'Supporting evidence',
        icon: <LucideIcon name="Paperclip" />,
        optional: b(p.optional),
        disabled: b(p.disabledStep),
        disabledReason: 'Requires finance.bills.attach',
        nextLabel: 'Review',
        render: () => <Body title="Attachments" text="Attach the supplier invoice. Optional — a bill can be created and evidence added from its drawer later." /> },
      { id: 'review', label: 'Review & submit', description: 'Confirm the totals',
        icon: <LucideIcon name="CircleCheck" />,
        render: () => <ReviewBody /> },
    ];

    return (
      <div style={{ height: orientation === 'vertical' ? '420px' : 'auto', minHeight: '360px', border: '1px solid var(--border)', borderRadius: 'var(--radius-sm)', overflow: 'hidden' }}>
        <Wizard
          id="gallery-wizard"
          label="New bill steps"
          steps={steps}
          value={invalid && b(p.revealed) ? 'lines' : value}
          onChange={noop}
          onSubmit={noop}
          submitLabel="Create & submit"
          orientation={orientation}
          busy={b(p.busy) || st === 'loading'}
          skipped={b(p.skippedStep) ? ['attachments'] : undefined}
          onSkip={noop}
          onCancel={b(p.cancel) ? noop : undefined}
          onSaveDraft={b(p.saveDraft) ? noop : undefined}
          footNote={b(p.saveDraft) ? 'Drafts are kept for 30 days.' : undefined}
          aside={b(p.aside)
            ? (
              <div style={{ fontSize: '0.72rem', color: 'var(--text-muted)', display: 'flex', flexDirection: 'column', gap: '6px' }}>
                <strong style={{ color: 'var(--text-primary)' }}>This bill</strong>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Lines</span><b>4</b></div>
                <div style={{ display: 'flex', justifyContent: 'space-between' }}><span>Total</span><b>TT$18,420.00</b></div>
              </div>
            )
            : undefined}
        />
      </div>
    );
  },

  code: p => `const steps: WizardStep[] = [
  { id: 'vendor', label: 'Vendor & header', description: 'Who and when',
    validate: () => [
      header.vendorId ? null : 'Pick a vendor.',
      header.billDate ? null : 'Enter the bill date.',
    ].filter((m): m is string => m !== null),
    render: () => <VendorStep value={header} onChange={setHeader} /> },

  { id: 'lines', label: 'Line items',
    // Work that must happen on the way OUT — awaited, with the wizard's own busy state.
    onBeforeNext: async () => { setDupes(await checkDuplicates(header, total)); },
    nextLabel: 'Check duplicates',
    render: () => <LineEditor lines={lines} onChange={setLines} /> },
${b(p.optional) ? `
  { id: 'attachments', label: 'Attachments', optional: true,
    render: () => <EvidenceUploader billId={draftId} /> },
` : ''}
  { id: 'review', label: 'Review & submit',
    render: () => <BillReview header={header} lines={lines} /> },
];

{/* A modal wizard is composed. There is no WizardModal. */}
<Dialog open={open} onClose={close} size="lg" variant="workspace" closeOnBackdrop={false} busy={saving}>
  <Dialog.Header title="New bill" />
  <Wizard
    id="ap-new-bill"
    label="New bill steps"
    steps={steps}
    value={step}
    onChange={setStep}${s(p.orientation, 'horizontal') !== 'horizontal' ? `\n    orientation="${s(p.orientation)}"` : ''}${b(p.saveDraft) ? '\n    onSaveDraft={saveDraft}' : ''}${b(p.optional) ? '\n    skipped={skipped}\n    onSkip={id => setSkipped(s => [...s, id])}' : ''}
    onCancel={close}
    onSubmit={submit}
    submitLabel="Create & submit"
    busy={saving}
  />
</Dialog>`,

  presets: [
    { label: 'Basic',            props: { orientation: 'horizontal', step: 'Lines', invalid: false, revealed: false, optional: true, skippedStep: false, disabledStep: false, busy: false, saveDraft: false, cancel: true, aside: false } },
    { label: 'Validation error', props: { orientation: 'horizontal', step: 'Lines', invalid: true, revealed: true, optional: true, skippedStep: false, disabledStep: false, busy: false, saveDraft: false, cancel: true, aside: false } },
    { label: 'Optional / skipped', props: { orientation: 'horizontal', step: 'Review', invalid: false, revealed: false, optional: true, skippedStep: true, disabledStep: false, busy: false, saveDraft: false, cancel: true, aside: false } },
    { label: 'Review / submit',  props: { orientation: 'horizontal', step: 'Review', invalid: false, revealed: false, optional: true, skippedStep: false, disabledStep: false, busy: false, saveDraft: true, cancel: true, aside: false } },
    { label: 'Vertical',         props: { orientation: 'vertical', step: 'Attachments', invalid: false, revealed: false, optional: true, skippedStep: false, disabledStep: false, busy: false, saveDraft: false, cancel: true, aside: true } },
    { label: 'Busy / submitting',props: { orientation: 'horizontal', step: 'Review', invalid: false, revealed: false, optional: true, skippedStep: false, disabledStep: false, busy: true, saveDraft: false, cancel: true, aside: false } },
    { label: 'Locked step',      props: { orientation: 'horizontal', step: 'Lines', invalid: false, revealed: false, optional: false, skippedStep: false, disabledStep: true, busy: false, saveDraft: false, cancel: true, aside: false } },
  ],
};
