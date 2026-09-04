/**
 * src/ui/registry/definitions.tsx — component metadata for the Gallery.
 *
 * The inspector renders itself from these. Adding a component to the workbench
 * means adding a definition here, not writing another settings panel.
 *
 * Two rules that keep the Gallery honest:
 *
 *  1. `render` must use the component's REAL props. Nothing may be faked with
 *     inline CSS — if the preview and the shipped component can diverge, the
 *     Gallery stops being evidence of anything.
 *
 *  2. `style` may only list `--ui-<component>-*` recipe variables. Global tokens
 *     belong in the Foundations editor; mixing them here would let someone think
 *     they were nudging one Button while re-theming the entire app.
 */

import { LucideIcon } from '../LucideIcon';
import { Button } from '../primitives/Button';
import { BackActionButton } from '../patterns/BackActionButton';
import { FormField, FormGrid } from '../forms/FormField';
import { TextInput } from '../primitives/TextInput';
import { PersonSearchSelect, type PersonOption } from '../forms/PersonSearchSelect';
import { type ComponentDef, type PropValues } from './types';
import { type ValidationState, type ControlSize } from '../tokens';
import avatarOlivia from '../../assets/avatars/untitled-ui/Olivia Rhye.jpg';
import avatarPhoenix from '../../assets/avatars/untitled-ui/Phoenix Baker.jpg';
import avatarLana from '../../assets/avatars/untitled-ui/Lana Steiner.jpg';
import avatarDemi from '../../assets/avatars/untitled-ui/Demi Wilkinson.jpg';
import avatarSarah from '../../assets/avatars/untitled-ui/Sarah Page.jpg';

/* Helpers — the props bag is loosely typed by design (it is user-edited), so
   these narrow it once at the boundary rather than casting at every use. */
type PropValue = PropValues[string] | undefined;
const s = (v: PropValue, fallback = ''): string => (typeof v === 'string' ? v : fallback);
const b = (v: PropValue): boolean => v === true;
const size = (v: PropValue): ControlSize => (v === 'sm' || v === 'lg' ? v : 'md');
const validation = (v: PropValue): ValidationState =>
  (v === 'error' || v === 'warning' || v === 'success' ? v : 'none');

/* ── Demo data ─────────────────────────────────────────────────────────────
   Realistic, not lorem. A picker demoed with "Option 1 / Option 2" hides every
   layout problem that real names and job titles cause. */

const DEMO_PEOPLE: PersonOption[] = [
  { id: 'p1', name: 'Olivia Rhye',       employeeNo: 'EMP-00484', jobTitle: 'Safety Officer',      department: 'HSE',        site: 'Point Lisas', photoUrl: avatarOlivia },
  { id: 'p2', name: 'Phoenix Baker',     employeeNo: 'EMP-00010', jobTitle: 'Field Engineer',      department: 'Operations', badges: ['On leave'], photoUrl: avatarPhoenix },
  { id: 'p3', name: 'Lana Steiner',      employeeNo: 'EMP-00034', jobTitle: 'HR Officer',          department: 'People', photoUrl: avatarLana },
  { id: 'p4', name: 'Demi Wilkinson',    employeeNo: 'EMP-00021', jobTitle: 'Shift Supervisor',    department: 'Operations', photoUrl: avatarDemi },
  { id: 'p5', name: 'Sarah Page',        employeeNo: 'EMP-00097', jobTitle: 'Maintenance Planner', department: 'Engineering', disabled: true, photoUrl: avatarSarah },
];

const DEMO_DEPARTMENTS = [
  { group: 'Operational', options: [
    { value: 'ops',   label: 'Operations',  subtitle: '148 employees' },
    { value: 'eng',   label: 'Engineering', subtitle: '62 employees' },
    { value: 'hse',   label: 'HSE',         subtitle: '19 employees' },
  ] },
  { group: 'Corporate', options: [
    { value: 'fin',   label: 'Finance',     subtitle: '24 employees' },
    { value: 'hr',    label: 'People',      subtitle: '11 employees' },
    { value: 'legal', label: 'Legal',       subtitle: 'Vacant', disabled: true },
  ] },
];

/* ── PersonSearchSelect ────────────────────────────────────────────────────*/

const personDef: ComponentDef = {
  id: 'person-search-select',
  thumbnail: 'person-select',
  name: 'PersonSearchSelect',
  category: 'people',
  description: 'The canonical person / employee picker. Use it anywhere a person FK is set — free text for employee ownership is a data-integrity bug.',
  status: 'stable',
  componentPath: 'src/ui/forms/PersonSearchSelect.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.ui-person-search'],
    deprecatedImports: ['EntityPicker', '@ui/components/PersonSearchSelect'],
    nextSurface: 'HR Onboarding',
  },

  props: {
    label:      { type: 'text',    label: 'Field label', default: 'Case owner' },
    placeholder:{ type: 'text',    label: 'Placeholder', default: 'Search by name…' },
    value:      { type: 'select',  label: 'Selected', options: ['none', 'p1', 'p2', 'p3'], default: 'none' },
    async:      { type: 'boolean', label: 'Async lookup', default: false, help: 'Simulates a 500ms directory search.' },
    showBadges: { type: 'boolean', label: 'Show badges', default: true },
    clearable:  { type: 'boolean', label: 'Clearable', default: true },
    size:       { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg'], default: 'md' },
    validation: { type: 'select',  label: 'Validation', options: ['none', 'error', 'warning', 'success'], default: 'none' },
    required:   { type: 'boolean', label: 'Required', default: true },
    disabled:   { type: 'boolean', label: 'Disabled', default: false },
    readOnly:   { type: 'boolean', label: 'Read-only', default: false },
  },

  style: [
    { label: 'Person row', controls: [
      { name: '--ui-option-height',      label: 'Row height', kind: 'size' },
      { name: '--ui-option-subtitle-fg', label: 'Meta line colour', kind: 'color' },
      { name: '--ui-option-bg-active',   label: 'Keyboard cursor fill', kind: 'color' },
    ] },
    { label: 'Control', controls: [
      { name: '--ui-control-md',           label: 'Height (md)', kind: 'size' },
      { name: '--ui-control-radius',       label: 'Corner radius', kind: 'size' },
      { name: '--ui-control-border-focus', label: 'Border — focus', kind: 'color' },
    ] },
  ],

  states: ['default', 'focus', 'open', 'disabled', 'readonly', 'error'],
  compare: ['default', 'focus', 'error', 'disabled', 'readonly'],

  a11y: {
    role: 'combobox with aria-autocomplete="list"',
    name: 'The FormField label.',
    keyboard: [
      { keys: 'Typing', does: 'Searches by name, employee number, job title or department.' },
      { keys: '↓ / ↑',  does: 'Moves through results. Disabled people (e.g. terminated) are skipped.' },
      { keys: 'Enter',  does: 'Selects the active person.' },
      { keys: 'Escape', does: 'Closes without changing the selection.' },
    ],
    focus: 'Focus returns to the field after selection, so the next Tab continues from the form.',
    notes: [
      'Emits `null` when cleared, never an empty string — the consumer writes this into a nullable FK column.',
      'Avatars are decorative (aria-hidden); the name is the accessible content.',
      'Trailing affordance priority is fixed: spinner → clear → search icon. They can never overlap.',
    ],
  },

  render: (p, state) => {
    const search = b(p.async)
      ? (q: string): Promise<PersonOption[]> => new Promise(res => setTimeout(
        () => res(DEMO_PEOPLE.filter(x => `${x.name} ${x.employeeNo ?? ''} ${x.department ?? ''}`.toLowerCase().includes(q.toLowerCase()))), 500))
      : undefined;
    const selected = s(p.value, 'none');
    return (
      <FormField
        label={s(p.label, 'Person')}
        required={b(p.required)}
        error={validation(p.validation) === 'error' ? 'Select an owner before submitting.' : undefined}
        warning={validation(p.validation) === 'warning' ? 'This person is on leave until 14 Sep.' : undefined}
        success={validation(p.validation) === 'success' ? 'Owner confirmed.' : undefined}
        disabled={b(p.disabled) || state === 'disabled'}
        readOnly={b(p.readOnly) || state === 'readonly'}
      >
        <PersonSearchSelect
          value={selected === 'none' ? null : selected}
          onChange={() => { /* preview */ }}
          people={search ? undefined : DEMO_PEOPLE}
          search={search}
          placeholder={s(p.placeholder)}
          showBadges={b(p.showBadges)}
          clearable={b(p.clearable)}
          size={size(p.size)}
          forceState={state}
        />
      </FormField>
    );
  },

  code: (p) => `<FormField label="${s(p.label, 'Case owner')}"${b(p.required) ? ' required' : ''} error={errors.ownerId}>
  <PersonSearchSelect
    value={ownerId}
    onChange={setOwnerId}${b(p.async)
      ? '\n    search={q => api.searchEmployees(q)}'
      : '\n    people={teamMembers}'}${b(p.clearable) ? '\n    clearable' : ''}
  />
</FormField>`,

  presets: [
    { label: 'Empty',      props: { label: 'Case owner', placeholder: 'Search by name…', value: 'none', async: false, showBadges: true, clearable: true, size: 'md', validation: 'none', required: true, disabled: false, readOnly: false } },
    { label: 'Selected',   props: { label: 'Case owner', placeholder: 'Search by name…', value: 'p1', async: false, showBadges: true, clearable: true, size: 'md', validation: 'none', required: true, disabled: false, readOnly: false } },
    { label: 'Invalid',    props: { label: 'Case owner', placeholder: 'Search by name…', value: 'none', async: false, showBadges: true, clearable: true, size: 'md', validation: 'error', required: true, disabled: false, readOnly: false } },
    { label: 'Directory',  props: { label: 'Assign to', placeholder: 'Search the directory…', value: 'none', async: true, showBadges: true, clearable: true, size: 'md', validation: 'none', required: false, disabled: false, readOnly: false } },
  ],
};

/* ── Dialog ────────────────────────────────────────────────────────────────
   Rendered INLINE in the canvas rather than as a portalled overlay: a modal
   that covers the workbench cannot be inspected while it is open. Everything
   else — chrome, sizes, variants, spacing — is the real recipe. The a11y
   behaviour (focus trap, Escape, focus return) is covered by the "Open a real
   dialog" action, which mounts the genuine component. */

const dialogDef: ComponentDef = {
  id: 'dialog',
  thumbnail: 'dialog',
  name: 'Modal Frame',
  category: 'overlays',
  description: 'One accessible window frame with a shared header, scrolling body and pinned footer across standard, sidebar, split and wide layouts.',
  status: 'stable',
  componentPath: 'src/ui/overlays/Dialog.tsx',
  importFrom: '@ui',
  migration: {
    replaces: ['.ui-modal', '.mp76-modal-btn'],
    deprecatedImports: ['@shared/Modal', 'HseModal', 'HrfinWizardModal'],
    nextSurface: 'Wizard / Stepper',
    notes: [
      'The clean HSE form family is migrated: six overview create/report flows and all four live Training flows compose Dialog.Header, Dialog.Body and Dialog.Footer with canonical Button actions.',
      'Four HseModal files remain exact lint-blocked HSE debt (Incidents, Inspections, PPEManager and InspectionDialogs). The broader pre-v2 Modal and HrfinWizardModal consumers are named debt for their owning component cycles; they do not justify keeping Dialog open indefinitely.',
      '225 distinct overlay class families exist across modules; each is removed only when its owning surface is naturally migrated.',
    ],
  },

  props: {
    title:   { type: 'text',   label: 'Title', default: 'Modal title' },
    sub:     { type: 'text',   label: 'Subtitle', default: 'Add supporting context when needed.' },
    size:    { type: 'select', label: 'Size', options: ['sm', 'md', 'lg', 'xl', 'fullscreen'], default: 'md' },
    variant: { type: 'select', label: 'Variant', options: ['standard', 'form', 'confirm', 'destructive', 'info', 'workspace'], default: 'standard' },
    layout:  { type: 'segmented', label: 'Layout', options: ['frame', 'standard', 'sidebar-left', 'sidebar-right', 'split', 'wide'], default: 'frame' },
    icon:    { type: 'select', label: 'Header icon', options: ['none', 'CircleCheck', 'TriangleAlert', 'Trash2', 'Info'], default: 'CircleCheck' },
    iconStyle: { type: 'segmented', label: 'Icon treatment', options: ['rounded', 'circle', 'plain'], default: 'rounded' },
    showClose: { type: 'boolean', label: 'Show close button', default: true },
    busy:    { type: 'boolean', label: 'Busy (submitting)', default: false },
    backLink:{ type: 'boolean', label: 'Left footer slot', default: false },
  },

  style: [
    { label: 'Sheet', controls: [
      { name: '--ui-dialog-width-md', label: 'Width (md)', kind: 'size' },
      { name: '--ui-dialog-width-lg', label: 'Width (lg)', kind: 'size' },
      { name: '--ui-dialog-radius',   label: 'Corner radius', kind: 'size' },
      { name: '--ui-dialog-bg',       label: 'Background', kind: 'color' },
      { name: '--ui-dialog-border-width', label: 'Window border width', kind: 'size' },
      { name: '--ui-dialog-border-color', label: 'Window border', kind: 'color' },
      { name: '--ui-dialog-accent-height', label: 'Top accent height', kind: 'size' },
      { name: '--ui-dialog-accent-color',  label: 'Top accent colour', kind: 'color' },
    ] },
    { label: 'Spacing', controls: [
      { name: '--ui-dialog-head-pad', label: 'Header padding', kind: 'text' },
      { name: '--ui-dialog-body-pad', label: 'Body padding', kind: 'text' },
      { name: '--ui-dialog-foot-pad', label: 'Footer padding', kind: 'text' },
      { name: '--ui-dialog-foot-min-height', label: 'Footer min height', kind: 'size' },
      { name: '--ui-dialog-foot-bg-start', label: 'Footer fade start', kind: 'color' },
      { name: '--ui-dialog-foot-bg', label: 'Footer fade end', kind: 'color' },
      { name: '--ui-dialog-gap',      label: 'Footer button gap', kind: 'size' },
      { name: '--ui-dialog-column-gap', label: 'Column gap', kind: 'size' },
      { name: '--ui-dialog-sidebar-width', label: 'Sidebar width', kind: 'size' },
      { name: '--ui-dialog-sidebar-pad', label: 'Sidebar padding', kind: 'text' },
      { name: '--ui-dialog-sidebar-bg', label: 'Sidebar background', kind: 'color' },
      { name: '--ui-dialog-sidebar-divider', label: 'Sidebar divider', kind: 'color' },
      { name: '--ui-dialog-context-icon-bg', label: 'Context icon background', kind: 'color' },
      { name: '--ui-dialog-context-icon-fg', label: 'Context icon colour', kind: 'color' },
      { name: '--ui-dialog-context-divider', label: 'Context row divider', kind: 'color' },
    ] },
    { label: 'Header', controls: [
      { name: '--ui-dialog-head-bg', label: 'Solid background', kind: 'color' },
      { name: '--ui-dialog-head-title', label: 'Title', kind: 'color' },
      { name: '--ui-dialog-head-sub', label: 'Subtitle', kind: 'color-alpha' },
      { name: '--ui-dialog-head-separator', label: 'Separator', kind: 'color' },
      { name: '--ui-dialog-head-separator-width', label: 'Separator width', kind: 'size' },
      { name: '--ui-dialog-icon-bg',       label: 'Icon chip fill', kind: 'color-alpha' },
      { name: '--ui-dialog-icon-fg',       label: 'Icon colour', kind: 'color' },
      { name: '--ui-dialog-icon-border',   label: 'Icon chip border', kind: 'color-alpha' },
    ] },
    { label: 'Backdrop', controls: [
      { name: '--ui-dialog-backdrop',      label: 'Backdrop', kind: 'color-alpha' },
      { name: '--ui-dialog-backdrop-blur', label: 'Backdrop blur', kind: 'size' },
    ] },
  ],

  states: ['default', 'loading'],
  previewAxis: 'layout',
  previewLayout: 'diagram',
  previewSamples: [
    { value: 'frame', title: 'Frame', props: { layout: 'frame' }, diagram: 'modal-layout' },
    { value: 'standard', title: 'Standard', props: { layout: 'standard' }, diagram: 'modal-layout' },
    { value: 'sidebar-left', title: 'Left sidebar', props: { layout: 'sidebar-left' }, diagram: 'modal-layout' },
    { value: 'sidebar-right', title: 'Right sidebar', props: { layout: 'sidebar-right' }, diagram: 'modal-layout' },
    { value: 'split', title: 'Split', props: { layout: 'split' }, diagram: 'modal-layout' },
    { value: 'wide', title: 'Wide', props: { layout: 'wide' }, diagram: 'modal-layout' },
  ],

  a11y: {
    role: 'dialog, aria-modal="true"',
    name: 'aria-labelledby points at the Dialog.Header title, so the sheet announces its own title instead of just "dialog".',
    keyboard: [
      { keys: 'Escape',    does: 'Closes, unless closeOnEscape={false} or the dialog is busy.' },
      { keys: 'Tab',       does: 'Cycles within the sheet — focus cannot reach the page behind it.' },
      { keys: 'Shift+Tab', does: 'Cycles backwards, wrapping at the first focusable.' },
    ],
    focus: 'Focus moves into the sheet on open and returns to the element that opened it on close — but only if that element is still in the document.',
    notes: [
      'Portalled to <body>: a fixed sheet inside a transformed ancestor (any board tile) would position against that ancestor and be clipped by it.',
      'Busy blocks the backdrop and Escape but deliberately keeps the close button reachable — a user must always be able to escape a hung request.',
      'Two dialogs open at once get distinct title ids, so a confirm over a form does not announce the form\'s title.',
    ],
  },

  render: (p, state) => {
    const iconName = s(p.icon, 'none');
    const busy = b(p.busy) || state === 'loading';
    const layout = s(p.layout, 'frame');
    const hasSidebar = layout === 'sidebar-left' || layout === 'sidebar-right' || layout === 'split';
    return (
      <div class="ui-gallery-dialog-frame">
        <section class={`ui-dialog ui-dialog--${s(p.size, 'md')} ui-dialog--${s(p.variant, 'standard')} ui-dialog--layout-${layout}`} role="group" aria-label="Modal frame preview">
          <header class="ui-dialog-head">
            {iconName !== 'none' && <span class={`ui-dialog-icon ui-dialog-icon--${s(p.iconStyle, 'rounded')}`} aria-hidden="true"><LucideIcon name={iconName as never} /></span>}
            <div class="ui-dialog-titles">
              <h2 class="ui-dialog-title">{s(p.title, 'Modal title')}</h2>
              {s(p.sub) && <p class="ui-dialog-sub">{s(p.sub)}</p>}
            </div>
            {b(p.showClose) && (
              <span class="ui-dialog-close" aria-hidden="true"><LucideIcon name="X" /></span>
            )}
          </header>
          <div class="ui-dialog-body">
            <div class="ui-dialog-layout">
              <div class="ui-dialog-content">
                {layout === 'frame'
                  ? <div class="sds-modal-frame-canvas" aria-label="Empty modal body" />
                  : <FormGrid>
                      <FormField label="Payment date" required>
                        <TextInput value="2026-08-28" onInput={() => { /* preview */ }} />
                      </FormField>
                      <FormField label="Approver" required>
                        <PersonSearchSelect value="p1" onChange={() => { /* preview */ }} people={DEMO_PEOPLE} />
                      </FormField>
                      <FormField label="Reason" wide helpText="Recorded on the audit trail.">
                        <TextInput multiline value="" onInput={() => { /* preview */ }} placeholder="Add context for the approver…" />
                      </FormField>
                    </FormGrid>}
              </div>
              {hasSidebar && (
                <aside class="ui-dialog-sidebar">
                  <div class="ui-dialog-section-head">
                    <h4>{layout === 'split' ? 'Approval summary' : 'Details'}</h4>
                    <p>Supporting information stays visible beside the main content.</p>
                  </div>
                  <dl class="ui-dialog-context-facts">
                    <div class="ui-dialog-context-fact"><span class="ui-dialog-context-fact-icon"><LucideIcon name="UsersRound" /></span><span class="ui-dialog-context-fact-copy"><dt>Employees</dt><dd>148</dd></span></div>
                    <div class="ui-dialog-context-fact"><span class="ui-dialog-context-fact-icon"><LucideIcon name="WalletCards" /></span><span class="ui-dialog-context-fact-copy"><dt>Gross total</dt><dd>$284,930</dd></span></div>
                    <div class="ui-dialog-context-fact"><span class="ui-dialog-context-fact-icon"><LucideIcon name="FileCheck2" /></span><span class="ui-dialog-context-fact-copy"><dt>Status</dt><dd>Ready</dd></span></div>
                  </dl>
                </aside>
              )}
            </div>
          </div>
          <footer class="ui-dialog-foot">
            {b(p.backLink) && <div class="ui-dialog-foot-left"><BackActionButton /></div>}
            <Button variant="outline">Cancel</Button>
            <Button variant={s(p.variant) === 'destructive' ? 'danger' : 'primary'} loading={busy} loadingText="Saving…">
              {s(p.variant) === 'destructive' ? 'Delete' : s(p.variant) === 'confirm' ? 'Confirm' : 'Save'}
            </Button>
          </footer>
          {busy && <div class="ui-dialog-busy"><span class="ui-ctrl-spinner" /></div>}
        </section>
      </div>
    );
  },

  code: (p) => `<Dialog open={open} onClose={close} size="${s(p.size, 'md')}"${s(p.variant) !== 'standard' ? ` variant="${s(p.variant)}"` : ''}${s(p.layout) !== 'frame' ? ` layout="${s(p.layout)}"` : ''}${b(p.busy) ? ' busy={saving}' : ''}>
  <Dialog.Header
    title="${s(p.title, 'Title')}"${s(p.sub) ? `\n    sub="${s(p.sub)}"` : ''}${s(p.icon) !== 'none' ? `\n    icon={<LucideIcon name="${s(p.icon)}" />}${s(p.iconStyle, 'rounded') !== 'rounded' ? `\n    iconStyle="${s(p.iconStyle)}"` : ''}` : ''}${b(p.showClose) ? '\n    onClose={close}' : ''}
  />
  <Dialog.Body>${s(p.layout, 'frame') === 'frame' ? '\n    {/* Start with your content here. */}' : `
    <Dialog.Layout>
      <Dialog.Content>{/* form fields */}</Dialog.Content>${['sidebar-left', 'sidebar-right', 'split'].includes(s(p.layout)) ? `
      <Dialog.Sidebar>
        <Dialog.SidebarHeader
          eyebrow="Planning Scope"
          title="Pelican Platform"
          description="Choose the operational groups available to this workflow."
        />
        <Dialog.ContextFacts items={[
          { label: 'Planning Window', value: '23–29 August', icon: <LucideIcon name="CalendarRange" /> },
          { label: 'Roster State', value: 'Working Draft', icon: <LucideIcon name="FilePenLine" /> },
        ]} />
      </Dialog.Sidebar>` : ''}
    </Dialog.Layout>`}
  </Dialog.Body>
  <Dialog.Footer${b(p.backLink) ? ' left={<BackActionButton />}' : ''}>
    <Button variant="outline" onClick={close}>Cancel</Button>
    <Button variant="primary" onClick={submit}>Approve</Button>
  </Dialog.Footer>
</Dialog>`,
};

/* ── Core definitions ──────────────────────────────────────────────────────
   Explicit and ordered rather than glob-collected: nav order is a design
   decision, and alphabetical would separate Select from Combobox. The Actions
   family lives in actions.defs.tsx; the registry index assembles both. */

export const COMPONENT_DEFS: readonly ComponentDef[] = [
  personDef,
  dialogDef,
];

export { DEMO_PEOPLE, DEMO_DEPARTMENTS };
