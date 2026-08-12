/** Canonical page identity and page-level action compositions. */
import { PageHeader } from '../components/PageHeader';
import { LucideIcon } from '../LucideIcon';
import { PageActionBar } from '../navigation/PageActionBar';
import { Button } from '../primitives/Button';
import { type ComponentDef } from './types';

const noop = (): void => { /* registry preview */ };

const previewActions = (
  <PageActionBar
    label="Employee actions"
    secondary={<Button variant="secondary">Export</Button>}
    primary={<Button variant="primary">New employee</Button>}
    overflow={[{ id: 'archive', label: 'Archive view', onSelect: noop }]}
  />
);

export const pageHeaderDef: ComponentDef = {
  id: 'page-header',
  name: 'PageHeader',
  category: 'navigation',
  description: 'The semantic page identity surface: one h1, its parent breadcrumb trail, supporting description and an optional PageActionBar.',
  status: 'stable',
  componentPath: 'src/ui/components/PageHeader.tsx',
  importFrom: '@ui',
  props: {
    title: { type: 'text', label: 'Title', default: 'Employees' },
    description: { type: 'text', label: 'Description', default: 'Employee master register' },
    breadcrumb: { type: 'boolean', label: 'Breadcrumb', default: true },
    actions: { type: 'boolean', label: 'Actions', default: true },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'Native <header> landmark containing the page h1.',
    name: 'The title is rendered as the page-level h1; breadcrumb text supplies location context without repeating the title.',
    keyboard: [],
    focus: 'The header itself is not focusable. Its composed controls retain their own keyboard behaviour.',
    notes: ['Render one PageHeader per page. Do not hide the title unless another visible page-level h1 owns the same identity.'],
  },
  migration: {
    replaces: ['.hrfin-page-header', '.section-title-row', '.page-title-row'],
    deprecatedImports: ['HrfinPageHeader'],
    nextSurface: 'EmptyState',
    notes: [
      'The canonical API no longer accepts meta or hidePill props that it does not render.',
      'Organization Structure is the first complete action-family migration. Remaining HrfinPageHeader consumers are named debt, not a reason to delay the Studio.',
    ],
  },
  render: p => (
    <PageHeader
      icon={<LucideIcon name="Users" />}
      module={p.breadcrumb === true ? 'Human Resources' : undefined}
      crumbs={p.breadcrumb === true ? ['People'] : undefined}
      title={typeof p.title === 'string' ? p.title : 'Employees'}
      sub={typeof p.description === 'string' ? p.description : undefined}
      actions={p.actions === true ? previewActions : undefined}
    />
  ),
  code: p => `<PageHeader
  icon={<Users />}
  module="Human Resources"
  crumbs={['People']}
  title="${typeof p.title === 'string' ? p.title : 'Employees'}"
  sub="${typeof p.description === 'string' ? p.description : ''}"${p.actions === true ? '\n  actions={<PageActionBar label="Employee actions" primary={<Button>New employee</Button>} />}' : ''}
/>`,
};

export const pageActionBarDef: ComponentDef = {
  id: 'page-action-bar',
  name: 'PageActionBar',
  category: 'navigation',
  description: 'The standard page-level action composition: context, visible secondary actions, one primary action and a lower-frequency overflow menu.',
  status: 'stable',
  componentPath: 'src/ui/navigation/PageActionBar/PageActionBar.tsx',
  importFrom: '@ui',
  props: {
    context: { type: 'boolean', label: 'Context', default: true },
    secondary: { type: 'boolean', label: 'Secondary action', default: true },
    overflow: { type: 'boolean', label: 'Overflow menu', default: true },
  },
  states: ['default'],
  compare: ['default'],
  a11y: {
    role: 'role="group"',
    name: 'The required label identifies the relationship between the page actions.',
    keyboard: [
      { keys: 'Tab', does: 'Moves through the composed buttons and then the overflow trigger.' },
      { keys: 'Enter / Space', does: 'Activates a button or opens the overflow menu.' },
    ],
    focus: 'Button and DropdownMenu own focus; closing the menu returns focus through the canonical menu behaviour.',
  },
  migration: {
    replaces: ['.ui-page-head-actions', '.hrfin-header-actions', '.page-actions'],
    nextSurface: 'EmptyState',
    notes: [
      'PageActionBar owns layout and grouping, not action behaviour. Compose canonical Buttons; do not restyle raw legacy buttons inside it.',
      'The overflow prop is canonical DropdownMenu data, so low-frequency actions retain the shared keyboard model.',
    ],
  },
  render: p => (
    <PageActionBar
      label="Register actions"
      start={p.context === true ? <span>24 active employees</span> : undefined}
      secondary={p.secondary === true ? <Button variant="secondary">Export</Button> : undefined}
      primary={<Button variant="primary">New employee</Button>}
      overflow={p.overflow === true ? [{ id: 'archive', label: 'Archive view', onSelect: noop }] : undefined}
    />
  ),
  code: p => `<PageActionBar
  label="Register actions"${p.context === true ? '\n  start={<span>24 active employees</span>}' : ''}${p.secondary === true ? '\n  secondary={<Button variant="secondary">Export</Button>}' : ''}
  primary={<Button variant="primary">New employee</Button>}${p.overflow === true ? '\n  overflow={REGISTER_ACTIONS}' : ''}
/>`,
};
