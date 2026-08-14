import { type VNode } from 'preact';
import { type ComponentCategory } from '../registry';
import { LucideIcon } from '../LucideIcon';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import fileUploadersPreview from './assets/file-uploaders.webp';

type ThumbnailKind =
  | 'buttons' | 'segmented' | 'menu' | 'field' | 'date' | 'select' | 'upload' | 'otp'
  | 'check' | 'radio' | 'switch' | 'theme-switch' | 'people' | 'dialog' | 'drawer' | 'tooltip'
  | 'table' | 'badge' | 'tabs' | 'wizard' | 'header' | 'alert' | 'progress'
  | 'spinner' | 'skeleton' | 'card' | 'accordion' | 'color-picker' | 'breadcrumbs' | 'tree' | 'planned';

function kindFor(id: string, built: boolean): ThumbnailKind {
  if (!built) return 'planned';
  if (id === 'buttons' || id === 'button') return 'buttons';
  if (id === 'segmented-control') return 'segmented';
  if (['menu', 'dropdown-button', 'split-button'].includes(id)) return 'menu';
  if (id === 'text-input') return 'field';
  if (id === 'date-input') return 'date';
  if (id === 'select') return 'select';
  if (id === 'file-input') return 'upload';
  if (id === 'color-picker') return 'color-picker';
  if (id === 'otp-input') return 'otp';
  if (id === 'checkbox') return 'check';
  if (id === 'radio-group') return 'radio';
  if (id === 'switch') return 'switch';
  if (id === 'theme-mode-switch' || id === 'switches') return 'theme-switch';
  if (['avatar', 'avatar-group', 'person-search-select'].includes(id)) return 'people';
  if (id === 'drawer') return 'drawer';
  if (id === 'tooltip') return 'tooltip';
  if (['dialog', 'popover'].includes(id)) return 'dialog';
  if (id === 'data-table') return 'table';
  if (id === 'badge') return 'badge';
  if (id === 'tabs') return 'tabs';
  if (id === 'breadcrumbs') return 'breadcrumbs';
  if (id === 'tree-view') return 'tree';
  if (id === 'wizard') return 'wizard';
  if (['page-header', 'page-action-bar'].includes(id)) return 'header';
  if (id === 'alert') return 'alert';
  if (id === 'progress') return 'progress';
  if (id === 'spinner') return 'spinner';
  if (id === 'skeleton') return 'skeleton';
  if (id === 'accordion') return 'accordion';
  return 'card';
}

function FieldScene({ kind }: { kind: 'field' | 'date' }): VNode {
  const label = kind === 'field' ? 'Employee name' : 'Start date';
  const value = kind === 'field' ? 'Sarah James' : '13 Aug 2026';
  return <div class="sds-thumb-field"><strong>{label}</strong><span>{value}{kind === 'date' ? <LucideIcon name="Calendar" size={13} /> : null}</span><small>{kind === 'field' ? 'As shown on government ID' : 'Required'}</small></div>;
}

function SelectScene(): VNode {
  return <div class="sds-thumb-select">
    <header><span>Team <LucideIcon name="ChevronDown" size={11} /></span><span>Does not contain <LucideIcon name="ChevronDown" size={11} /></span></header>
    <button type="button">2 selected <small>16 users</small><LucideIcon name="ChevronDown" size={12} /></button>
    <div>
      <b><LucideIcon name="Search" size={12} />Search</b>
      <span><i />Engineering <small>12 users</small></span>
      <span class="is-on"><i>✓</i>Design <small>10 users</small></span>
      <span class="is-on"><i>✓</i>Product <small>6 users</small></span>
      <span class="is-preview-blurred"><i />Marketing <small>8 users</small></span>
    </div>
  </div>;
}

function ChoiceScene({ kind }: { kind: 'check' | 'radio' | 'switch' }): VNode {
  return <div class={`sds-thumb-choice sds-thumb-choice--${kind}`}><span><i />Email notifications</span><span class="is-on"><i />Approval alerts</span></div>;
}

function ColorPickerScene(): VNode {
  return <div class="sds-thumb-color-picker">
    <header><strong>Choose color</strong><i aria-hidden="true">×</i></header>
    <div class="sds-thumb-color-picker__spectrum"><span /></div>
    <footer><i aria-hidden="true" /><span><small>HEX</small><b>#7F56D9</b></span></footer>
  </div>;
}

/** Theme-aware catalogue illustration; deliberately not the interactive runtime component. */
export function ComponentThumbnail({ id, built = true }: {
  id: string;
  category: ComponentCategory | 'family';
  built?: boolean;
}): VNode {
  const kind = kindFor(id, built);
  const fogged = id === 'select';
  return (
    <div class={`sds-card__art sds-thumb sds-thumb--${kind}${fogged ? ' is-fogged' : ''}`} aria-hidden="true">
      {kind === 'buttons' && <div class="sds-thumb-buttons"><span>Cancel</span><strong><LucideIcon name="Check" size={13} />Continue</strong></div>}
      {kind === 'segmented' && <div class="sds-thumb-segmented"><strong><LucideIcon name="Grid2X2" size={11} />Grid</strong><span>List</span><span>Board</span></div>}
      {kind === 'menu' && <div class="sds-thumb-menu"><strong>Actions <LucideIcon name="ChevronDown" size={12} /></strong><div><span>View record</span><span>Edit details</span><span class="is-danger">Delete</span></div></div>}
      {(['field', 'date'] as ThumbnailKind[]).includes(kind) && <FieldScene kind={kind as 'field' | 'date'} />}
      {kind === 'select' && <SelectScene />}
      {kind === 'upload' && <img class="sds-thumb-upload-image" src={fileUploadersPreview} alt="" />}
      {kind === 'color-picker' && <ColorPickerScene />}
      {kind === 'tree' && <div class="sds-thumb-tree">
        <span class="is-folder is-open"><LucideIcon name="FolderOpen" size={13} />src</span>
        <div>
          <span class="is-folder is-open"><LucideIcon name="FolderOpen" size={13} />components</span>
          <div><span class="is-selected"><LucideIcon name="File" size={13} />button.tsx</span></div>
          <span><LucideIcon name="File" size={13} />header.tsx</span>
        </div>
        <span class="is-folder"><LucideIcon name="Folder" size={13} />lib</span>
      </div>}
      {kind === 'otp' && <div class="sds-thumb-otp"><div>{['8', '2', '4', '', '', ''].map((value, index) => <i class={`${value ? 'is-filled' : ''}${index === 3 ? ' is-active' : ''}`.trim()} key={index}>{value}</i>)}</div></div>}
      {(['check', 'radio', 'switch'] as ThumbnailKind[]).includes(kind) && <ChoiceScene kind={kind as 'check' | 'radio' | 'switch'} />}
      {kind === 'theme-switch' && <div class="sds-thumb-theme-switch"><LucideIcon name="Moon" size={19} /><i /><LucideIcon name="Sun" size={20} /></div>}
      {kind === 'people' && <div class="sds-thumb-people"><i>SJ</i><i>AD</i><i>PR</i><strong>+2</strong></div>}
      {kind === 'dialog' && <div class="sds-thumb-dialog"><strong>Confirm action</strong><span>This change will be recorded.</span><footer><i>Cancel</i><b>Confirm</b></footer></div>}
      {kind === 'drawer' && <div class="sds-thumb-drawer"><aside /><div><strong>Employee details</strong><span>Sarah James</span><span>Safety Officer</span><b>Active</b></div></div>}
      {kind === 'tooltip' && <div class="sds-thumb-tooltip">More information<i /></div>}
      {kind === 'table' && <div class="sds-thumb-table"><header><span>Employee</span><span>Status</span><span>Site</span></header><p><span>Sarah James</span><b>Active</b><span>Point Lisas</span></p><p><span>Amara Diallo</span><b>Leave</b><span>Chaguaramas</span></p></div>}
      {kind === 'badge' && <div class="sds-thumb-badges"><span>● Active</span><strong>● Overdue</strong></div>}
      {kind === 'tabs' && <div class="sds-thumb-tabs"><span class="is-on">Overview</span><span>People</span><span>Evidence</span><i /></div>}
      {kind === 'breadcrumbs' && <Breadcrumbs class="sds-thumb-breadcrumbs" items={[
        { label: 'Home', icon: <LucideIcon name="Home" size={19} />, iconOnly: true },
        { label: 'Settings' }, { label: 'Team members' }, { label: 'Olivia Rhye' },
      ]} />}
      {kind === 'wizard' && <div class="sds-thumb-wizard"><i class="is-done">✓</i><em /><i class="is-on">2</i><em /><i>3</i><small><span>Details</span><span>Evidence</span><span>Review</span></small></div>}
      {kind === 'header' && <div class="sds-thumb-header"><small>Human Resources / Employees</small><strong>Employee records</strong><span>Manage people, roles and employment details.</span><b>Add employee</b></div>}
      {kind === 'alert' && <div class="sds-thumb-alert"><LucideIcon name="TriangleAlert" size={18} /><div><strong>Approval required</strong><span>A second approver must review this payroll run.</span></div></div>}
      {kind === 'progress' && <div class="sds-thumb-progress"><span>Uploading evidence <b>64%</b></span><i><em /></i></div>}
      {kind === 'spinner' && <div class="sds-thumb-spinner"><i /><span>Loading records…</span></div>}
      {kind === 'skeleton' && <div class="sds-thumb-skeleton"><i /><div><span /><span /></div><footer><span /><span /></footer></div>}
      {kind === 'card' && <div class="sds-thumb-card"><small>OPEN INCIDENTS</small><strong>24</strong><span><b>↓ 8%</b> from last month</span></div>}
      {kind === 'accordion' && <div class="sds-thumb-accordion"><span>Scope and eligibility <b>⌄</b></span><span>Approval rules <b>⌄</b></span><span>Audit retention <b>⌄</b></span></div>}
      {kind === 'planned' && <div class="sds-thumb-planned"><LucideIcon name="Plus" size={18} /><span>Planned component</span></div>}
    </div>
  );
}
