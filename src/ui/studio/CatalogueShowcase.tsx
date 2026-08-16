import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { AppTopBarArtwork } from '../../components/shared/AppTopBar';
import { DataTable } from '../data/DataTable/DataTable';
import { type DataTableColumn, type DataTableSort } from '../data/DataTable/types';
import { FormField } from '../forms/FormField';
import { Select } from '../forms/Select';
import { LucideIcon } from '../LucideIcon';
import { Tabs } from '../navigation/Tabs/Tabs';
import { Badge } from '../primitives/Badge';
import { Button, type ButtonVariant } from '../primitives/Button';
import { Checkbox, Radio } from '../primitives/choice';
import { SegmentedControl } from '../primitives/actions';
import { TextInput } from '../primitives/TextInput';
import { isBuilt, type CategoryGroup, type CatalogueNode } from '../registry';

interface CatalogueShowcaseProps {
  groups: readonly CategoryGroup[];
  onOpen: (id: string) => void;
}

function SectionHeading({ number, title, text }: { number: string; title: string; text: string }): VNode {
  return (
    <header class="sds-showcase-heading">
      <span>{number}</span>
      <div><h2>{title}</h2><p>{text}</p></div>
    </header>
  );
}

const BUTTON_VARIANTS: readonly { variant: ButtonVariant; label: string }[] = [
  { variant: 'primary', label: 'Primary' },
  { variant: 'secondary', label: 'Secondary' },
  { variant: 'outline', label: 'Outline' },
  { variant: 'ghost', label: 'Ghost' },
  { variant: 'danger', label: 'Danger' },
  { variant: 'link', label: 'Link' },
];

function ButtonsShowcase(): VNode {
  return (
    <article id="library-buttons" class="sds-showcase-panel sds-showcase-buttons">
      <SectionHeading number="03" title="Buttons" text="One system, multiple semantic treatments." />
      <div class="sds-showcase-button-matrix">
        <span class="sds-showcase-state-label">Treatment</span><span>Default</span><span>Hover</span><span>Pressed</span><span>Disabled</span>
        {BUTTON_VARIANTS.map(item => (
          <div class="sds-showcase-button-row" key={item.variant}>
            <strong>{item.label}</strong>
            <Button variant={item.variant}>Button</Button>
            <Button variant={item.variant} forceState="hover">Button</Button>
            <Button variant={item.variant} forceState="active">Button</Button>
            <Button variant={item.variant} disabled>Button</Button>
          </div>
        ))}
      </div>
      <div class="sds-showcase-button-examples">
        <Button variant="primary" iconLeft={<LucideIcon name="Upload" />}>Upload</Button>
        <Button variant="secondary" iconLeft={<LucideIcon name="Download" />}>Download</Button>
        <Button variant="outline" iconLeft={<LucideIcon name="Plus" />}>Add new</Button>
        <Button variant="ghost" iconOnly aria-label="More actions" iconLeft={<LucideIcon name="Ellipsis" />} />
      </div>
    </article>
  );
}

const FIELD_OPTIONS = [
  { value: 'operations', label: 'Operations' },
  { value: 'finance', label: 'Finance' },
  { value: 'hse', label: 'HSE' },
] as const;

function InputsShowcase(): VNode {
  const [selected, setSelected] = useState<string>('');
  const [checked, setChecked] = useState(true);
  const [radio, setRadio] = useState(true);
  return (
    <article id="library-inputs" class="sds-showcase-panel sds-showcase-inputs">
      <SectionHeading number="04" title="Inputs & Select" text="Neutral form surfaces with restrained brand focus." />
      <div class="sds-showcase-form-grid">
        <FormField label="Text input"><TextInput placeholder="Type something…" /></FormField>
        <FormField label="Select"><Select value={selected} onChange={setSelected} options={FIELD_OPTIONS} placeholder="Choose an option" /></FormField>
        <FormField label="Focused input"><TextInput value="Active input" forceState="focus" aria-label="Focused input preview" /></FormField>
        <div class="sds-showcase-open-select">
          <strong>Select — open state</strong>
          <div class="ui-ctrl" data-ui-state="open"><span>Choose an option</span><LucideIcon name="ChevronUp" /></div>
          <div class="sds-showcase-option-list" role="listbox" aria-label="Select open state preview">
            <span role="option">Option one</span>
            <span role="option" aria-selected="true">Option two <LucideIcon name="Check" /></span>
            <span role="option">Option three</span>
            <span role="option">Option four</span>
          </div>
        </div>
        <FormField label="Disabled" disabled><TextInput value="Disabled input" disabled aria-label="Disabled input preview" /></FormField>
        <div class="sds-showcase-choices">
          <Checkbox checked={checked} onChange={setChecked} label="Checked" />
          <Radio checked={radio} onChange={() => setRadio(true)} name="showcase-radio" value="selected" label="Selected" />
        </div>
      </div>
    </article>
  );
}

interface ProjectRow {
  id: string;
  name: string;
  status: 'Active' | 'Planning' | 'On hold';
  progress: number;
  updated: string;
}

const PROJECTS: readonly ProjectRow[] = [
  { id: 'mercury', name: 'Project Mercury', status: 'Active', progress: 72, updated: 'May 12, 2025' },
  { id: 'gemini', name: 'Project Gemini', status: 'Planning', progress: 48, updated: 'May 11, 2025' },
  { id: 'apollo', name: 'Project Apollo', status: 'Active', progress: 89, updated: 'May 10, 2025' },
  { id: 'skylab', name: 'Project Skylab', status: 'On hold', progress: 23, updated: 'May 9, 2025' },
];

const PROJECT_COLUMNS: readonly DataTableColumn<ProjectRow>[] = [
  { id: 'name', header: 'Name', cell: row => row.name, sortable: true, sortValue: row => row.name, minWidth: 160 },
  { id: 'status', header: 'Status', cell: row => (
    <Badge tone={row.status === 'Active' ? 'success' : row.status === 'Planning' ? 'info' : 'warning'} size="sm">{row.status}</Badge>
  ), minWidth: 105 },
  { id: 'progress', header: 'Progress', cell: row => (
    <div class="sds-showcase-progress"><i style={{ width: `${row.progress}%` }} /><span>{row.progress}%</span></div>
  ), minWidth: 130 },
  { id: 'updated', header: 'Updated', cell: row => row.updated, sortable: true, sortValue: row => row.updated, minWidth: 130 },
];

function TableShowcase(): VNode {
  const [query, setQuery] = useState('');
  const [sort, setSort] = useState<DataTableSort | null>(null);
  const [selectedIds, setSelectedIds] = useState<string[]>(['apollo']);
  return (
    <article id="library-data" class="sds-showcase-panel sds-showcase-table">
      <SectionHeading number="05" title="Data table" text="Neutral data surface with brand indicators and selections." />
      <DataTable
        rows={PROJECTS}
        columns={PROJECT_COLUMNS}
        getRowId={row => row.id}
        label="Example projects"
        density="compact"
        sorting={{ value: sort, onChange: setSort, client: true }}
        selection={{ selectedIds, onChange: setSelectedIds }}
        search={{ value: query, onChange: setQuery, placeholder: 'Search projects…' }}
        isRowActive={row => row.id === 'apollo'}
        toolbarActions={<><Button variant="secondary" iconLeft={<LucideIcon name="Download" />}>Export</Button><Button variant="primary" iconLeft={<LucideIcon name="Plus" />}>New item</Button></>}
      />
    </article>
  );
}

function NavigationControlsShowcase(): VNode {
  const [tab, setTab] = useState('overview');
  const [segment, setSegment] = useState('all');
  return (
    <article id="library-navigation-controls" class="sds-showcase-panel">
      <SectionHeading number="06" title="Tabs, Segmented & Stepper" text="Brand appears in selection and progress, not as heavy fills." />
      <div class="sds-showcase-subsection"><span>Tabs</span><Tabs id="showcase-tabs" label="Example sections" value={tab} onChange={setTab} items={[{ id: 'overview', label: 'Overview' }, { id: 'details', label: 'Details' }, { id: 'activity', label: 'Activity' }]} /></div>
      <div class="sds-showcase-subsection"><span>Segmented control</span><SegmentedControl value={segment} onChange={setSegment} label="Example filter" options={[{ value: 'all', label: 'All' }, { value: 'open', label: 'Open' }, { value: 'progress', label: 'In progress' }, { value: 'closed', label: 'Closed' }]} /></div>
      <div class="sds-showcase-subsection"><span>Stepper</span><div class="sds-showcase-stepper">
        <div class="is-done"><i><LucideIcon name="Check" /></i><strong>Details</strong></div>
        <div class="is-active"><i>2</i><strong>Review</strong></div>
        <div><i>3</i><strong>Confirm</strong></div>
        <div><i>4</i><strong>Complete</strong></div>
      </div></div>
    </article>
  );
}

function StatusShowcase(): VNode {
  return (
    <article id="library-status" class="sds-showcase-panel">
      <SectionHeading number="07" title="Badges & Status" text="Operational colors remain semantic and independent of branding." />
      <div class="sds-showcase-badges">
        <Badge tone="accent">Brand</Badge><Badge tone="success">Active</Badge><Badge tone="warning">On hold</Badge>
        <Badge tone="neutral">Archived</Badge><Badge tone="danger">Blocked</Badge><Badge tone="info">Planning</Badge>
      </div>
      <div class="sds-showcase-status-list">
        <Badge tone="success" variant="outline" dot>Success</Badge><Badge tone="warning" variant="outline" dot>Warning</Badge>
        <Badge tone="danger" variant="outline" dot>Danger</Badge><Badge tone="info" variant="outline" dot>Information</Badge>
      </div>
    </article>
  );
}

function ShellShowcase(): VNode {
  return (
    <article id="library-shell" class="sds-showcase-panel sds-showcase-shell">
      <SectionHeading number="08" title="Navigation" text="Stable enterprise shell with controlled brand accents." />
      <div class="sds-showcase-shell-frame">
        <aside>
          <strong><span>S</span> SIOMAC</strong>
          {([['LayoutDashboard', 'Dashboard'], ['FolderKanban', 'Projects'], ['ListChecks', 'Tasks'], ['CalendarDays', 'Calendar'], ['ChartNoAxesColumn', 'Reports'], ['Settings', 'Settings']] as const).map(([icon, label], index) => (
            <button type="button" class={index === 0 ? 'is-active' : ''} key={label}><LucideIcon name={icon} />{label}</button>
          ))}
        </aside>
        <div><AppTopBarArtwork layout="full" appearance="light" lightSurface="white" actionTreatment="outline" chevronTreatment="solid" /></div>
      </div>
    </article>
  );
}

function MenuShowcase(): VNode {
  return (
    <article id="library-menu" class="sds-showcase-panel">
      <SectionHeading number="09" title="Dropdown menu" text="Neutral surface, brand only in selection and focus." />
      <div class="sds-showcase-menu-demo">
        <Button variant="secondary" iconRight={<LucideIcon name="ChevronDown" />}>Actions</Button>
        <div class="sds-showcase-menu" role="menu" aria-label="Action menu preview">
          <button type="button" role="menuitem"><LucideIcon name="Eye" />View details</button>
          <button type="button" role="menuitem" class="is-active"><LucideIcon name="Pencil" />Edit item</button>
          <button type="button" role="menuitem"><LucideIcon name="Copy" />Duplicate</button>
          <button type="button" role="menuitem"><LucideIcon name="Share2" />Share</button>
          <hr />
          <button type="button" role="menuitem" class="is-danger"><LucideIcon name="Archive" />Archive</button>
          <button type="button" role="menuitem" class="is-danger"><LucideIcon name="Trash2" />Delete</button>
        </div>
      </div>
    </article>
  );
}

function DialogShowcase(): VNode {
  return (
    <article id="library-dialog" class="sds-showcase-panel">
      <SectionHeading number="10" title="Dialog" text="Neutral window, semantic action emphasis." />
      <div class="sds-showcase-dialog-wrap"><section class="sds-showcase-dialog" role="dialog" aria-label="Confirm deletion preview">
        <header><strong>Confirm deletion</strong><Button variant="ghost" iconOnly aria-label="Close preview" iconLeft={<LucideIcon name="X" />} /></header>
        <div><i><LucideIcon name="TriangleAlert" /></i><p>Are you sure you want to delete <strong>Project Apollo</strong>? This action cannot be undone.</p></div>
        <footer><Button variant="secondary">Cancel</Button><Button variant="danger">Delete</Button></footer>
      </section></div>
    </article>
  );
}

function FormShowcase(): VNode {
  const [status, setStatus] = useState<string>('progress');
  const [owner, setOwner] = useState<string>('jane');
  const [priority, setPriority] = useState<string>('high');
  return (
    <article id="library-form" class="sds-showcase-panel sds-showcase-form-example">
      <SectionHeading number="11" title="Form example" text="A complete composition using the theme system." />
      <div class="sds-showcase-form-grid">
        <FormField label="Project name"><TextInput value="Project Orion" /></FormField>
        <FormField label="Status"><Select value={status} onChange={setStatus} options={[{ value: 'progress', label: 'In progress' }, { value: 'complete', label: 'Complete' }]} /></FormField>
        <FormField label="Owner"><Select value={owner} onChange={setOwner} options={[{ value: 'jane', label: 'Jane Cooper' }, { value: 'sarah', label: 'Sarah James' }]} /></FormField>
        <FormField label="Priority"><Select value={priority} onChange={setPriority} options={[{ value: 'high', label: 'High' }, { value: 'normal', label: 'Normal' }]} /></FormField>
        <FormField label="Description" wide><TextInput multiline rows={3} value="Build the next generation platform." /></FormField>
      </div>
      <footer><Button variant="secondary">Cancel</Button><Button variant="primary">Save changes</Button></footer>
    </article>
  );
}

function nodeId(node: CatalogueNode): string { return node.kind === 'family' ? node.family.id : node.def.id; }
function nodeName(node: CatalogueNode): string { return node.kind === 'family' ? node.family.name : node.def.name; }
function nodeCount(node: CatalogueNode): number { return node.kind === 'family' ? node.members.filter(isBuilt).length : 1; }

export function CatalogueShowcase({ groups, onOpen }: CatalogueShowcaseProps): VNode {
  return (
    <>
      <section class="sds-showcase-three"><ButtonsShowcase /><InputsShowcase /><TableShowcase /></section>
      <section class="sds-showcase-two"><NavigationControlsShowcase /><StatusShowcase /></section>
      <section class="sds-showcase-app-grid"><ShellShowcase /><MenuShowcase /><DialogShowcase /><FormShowcase /></section>
      <section class="sds-showcase-panel sds-showcase-index">
        <SectionHeading number="12" title="Complete component index" text="Every built registry entry is listed here. New registered components appear automatically." />
        <div class="sds-showcase-index__groups">
          {groups.map(group => {
            const nodes = group.nodes.filter(node => node.kind === 'family' ? node.members.some(isBuilt) : isBuilt(node.def));
            if (nodes.length === 0) return null;
            return <section key={group.category}><header><strong>{group.label}</strong><span>{group.built}</span></header><div>{nodes.map(node => (
              <button type="button" key={nodeId(node)} onClick={() => onOpen(nodeId(node))}>{nodeName(node)}{nodeCount(node) > 1 && <span>{nodeCount(node)}</span>}</button>
            ))}</div></section>;
          })}
        </div>
      </section>
    </>
  );
}
