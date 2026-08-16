import {
  ProgressSteps,
  type ProgressStepItem,
  type ProgressStepsVariant,
} from '../navigation/ProgressSteps';
import { type ComponentDef, type PropValues } from './types';

const s = (value: PropValues[string] | undefined, fallback = ''): string => (
  typeof value === 'string' ? value : fallback
);
const b = (value: PropValues[string] | undefined): boolean => value === true;
const noop = (): void => { /* Studio preview */ };

const STEPS: readonly ProgressStepItem[] = [
  { id: 'details', label: 'Employee details', description: 'Identity and contact' },
  { id: 'employment', label: 'Employment', description: 'Role and placement' },
  { id: 'documents', label: 'Documents', description: 'Required records' },
  { id: 'review', label: 'Review', description: 'Confirm and submit' },
];

export const progressStepsDef: ComponentDef = {
  id: 'progress-steps',
  thumbnail: 'progress-steps',
  name: 'Progress Steps',
  category: 'navigation',
  description: 'An ordered progress summary for multi-step work. Three layouts share the same statuses, navigation rules and accessible ordered-list contract.',
  status: 'stable',
  componentPath: 'src/ui/navigation/ProgressSteps/ProgressSteps.tsx',
  importFrom: '@ui',
  props: {
    variant: {
      type: 'select',
      label: 'Layout',
      options: ['icon-centered-number', 'icon-with-text', 'icon-with-number'],
      default: 'icon-centered-number',
    },
    currentStep: {
      type: 'select',
      label: 'Current step',
      options: ['Employee details', 'Employment', 'Documents', 'Review'],
      default: 'Employment',
    },
    descriptions: { type: 'boolean', label: 'Descriptions', default: true },
    connectors: {
      type: 'boolean',
      label: 'Connectors',
      default: true,
      help: 'Keeps the reference connector treatment on by default. Hide it only in dense application layouts.',
    },
    backNavigation: {
      type: 'boolean',
      label: 'Previous steps are interactive',
      default: true,
      help: 'Allows users to return to the current or a completed step. Upcoming steps remain locked.',
    },
    disabledUpcoming: {
      type: 'boolean',
      label: 'Disable Documents step',
      default: false,
      help: 'Demonstrates an unavailable step caused by permissions or a business precondition.',
    },
  },
  previewAxis: 'variant',
  previewLayout: 'diagram',
  previewSamples: [
    {
      value: 'icon-centered-number',
      title: 'Icon centered with number',
      props: { variant: 'icon-centered-number' },
      diagram: 'progress-steps-layout',
    },
    {
      value: 'icon-with-text',
      title: 'Icon with text',
      props: { variant: 'icon-with-text' },
      diagram: 'progress-steps-layout',
    },
    {
      value: 'icon-with-number',
      title: 'Icon with number',
      props: { variant: 'icon-with-number' },
      diagram: 'progress-steps-layout',
    },
  ],
  style: [
    { label: 'Progress', controls: [
      { name: '--ui-progress-step-accent', label: 'Active and complete', kind: 'color', linkedTo: 'var(--ui-color-action-primary)' },
      { name: '--ui-progress-step-accent-fg', label: 'Active content', kind: 'color', linkedTo: 'var(--ui-color-text-on-primary)' },
      { name: '--ui-progress-step-success', label: 'Completed number step', kind: 'color', linkedTo: 'var(--ui-color-status-success)' },
      { name: '--ui-progress-step-track', label: 'Connector', kind: 'color', linkedTo: 'var(--ui-color-border-subtle)' },
    ] },
    { label: 'Marker and text', controls: [
      { name: '--ui-progress-step-marker-size', label: 'Marker size', kind: 'size' },
      { name: '--ui-progress-step-gap', label: 'Content gap', kind: 'size' },
      { name: '--ui-progress-step-border', label: 'Upcoming marker', kind: 'color', linkedTo: 'var(--ui-color-border-default)' },
      { name: '--ui-progress-step-fg', label: 'Title', kind: 'color', linkedTo: 'var(--ui-color-text-primary)' },
      { name: '--ui-progress-step-muted', label: 'Description', kind: 'color', linkedTo: 'var(--ui-color-text-muted)' },
    ] },
  ],
  states: ['default', 'focus', 'disabled'],
  compare: ['default', 'focus'],
  a11y: {
    role: 'A labelled nav containing an ordered list. The current item uses aria-current="step".',
    name: 'The required label names the workflow whose progress is being shown.',
    keyboard: [
      { keys: 'Tab', does: 'Moves through completed and current steps only when backward navigation is enabled.' },
      { keys: 'Enter / Space', does: 'Returns to a completed step. Upcoming steps cannot be selected early.' },
    ],
    focus: 'A visible focus ring surrounds the full step target, not only its marker.',
    notes: [
      'Progress Steps presents progress; Wizard owns validation, step bodies and footer actions. Compose them when both are needed.',
      'Labels are application content and are never editable Studio styling data.',
    ],
  },
  render: (props, state) => {
    const currentLabel = s(props.currentStep, 'Employment');
    const value = STEPS.find(step => step.label === currentLabel)?.id ?? 'employment';
    const steps = state === 'disabled' || b(props.disabledUpcoming)
      ? STEPS.map((step, index) => index === 2 ? { ...step, disabled: true } : step)
      : STEPS;
    return (
      <div style={{ width: 'min(100%, 760px)', padding: '12px 4px' }}>
        <ProgressSteps
          steps={steps}
          value={value}
          label="Employee onboarding progress"
          variant={s(props.variant, 'icon-centered-number') as ProgressStepsVariant}
          showDescriptions={b(props.descriptions)}
          showConnectors={b(props.connectors)}
          onChange={b(props.backNavigation) ? noop : undefined}
          class={state === 'focus' ? 'is-force-focus' : undefined}
        />
      </div>
    );
  },
  code: props => `<ProgressSteps
  label="Employee onboarding progress"
  steps={onboardingSteps}
  value={currentStep}
  ${b(props.backNavigation) ? 'onChange={setCurrentStep}' : ''}
  variant="${s(props.variant, 'icon-centered-number')}"${b(props.descriptions) ? '' : '\n  showDescriptions={false}'}
  ${b(props.connectors) ? '' : 'showConnectors={false}'}
/>`,
  presets: [
    { label: 'Centered numbers', props: { variant: 'icon-centered-number', currentStep: 'Employment', descriptions: true, connectors: true, backNavigation: true, disabledUpcoming: false } },
    { label: 'Icons with text', props: { variant: 'icon-with-text', currentStep: 'Documents', descriptions: true, connectors: true, backNavigation: true, disabledUpcoming: false } },
    { label: 'Numbers with text', props: { variant: 'icon-with-number', currentStep: 'Review', descriptions: true, connectors: true, backNavigation: true, disabledUpcoming: false } },
  ],
  examples: [
    {
      id: 'employee-onboarding',
      title: 'Employee onboarding',
      description: 'Shows the current stage while the full Wizard owns validation and submission.',
      render: () => <ProgressSteps steps={STEPS} value="documents" label="Employee onboarding progress" variant="icon-with-number" />,
    },
  ],
};
