import { type VNode } from 'preact';
import { type ThumbnailKind } from '../registry';
import { LucideIcon } from '../LucideIcon';
import { Breadcrumbs } from '../navigation/Breadcrumbs';
import { ThemeModeSwitchArtwork } from '../patterns/ThemeModeSwitch';
import { Checkbox, SwitchArtwork } from '../primitives/choice';
import avatarOlivia from '../../assets/avatars/untitled-ui/Olivia Rhye.jpg';
import avatarPhoenix from '../../assets/avatars/untitled-ui/Phoenix Baker.jpg';
import avatarLana from '../../assets/avatars/untitled-ui/Lana Steiner.jpg';
import avatarSarah from '../../assets/avatars/untitled-ui/Sarah Page.jpg';
import { UserPillArtwork } from '../../components/shared/AppTopBar';
import { Illustration } from '../feedback/Illustration';
import { QrCode } from '../data/QrCode';
import { ActivityGauge } from '../data/ActivityGauge';
import countryFlagsThumbnail from '../../assets/studio/thumbnails/country-flags-clean.png';
import fileTypesThumbnail from '../../assets/studio/thumbnails/file-types-clean.png';


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

function ActivityGaugeScene(): VNode {
  return <div class="ui-gallery-dialog-frame sds-thumb-activity-gauge">
    <section class="ui-dialog ui-dialog--sm ui-dialog--info ui-dialog--layout-frame" role="presentation">
      <header class="ui-dialog-head">
        <span class="ui-dialog-icon ui-dialog-icon--rounded" aria-hidden="true"><LucideIcon name="ChartNoAxesCombined" size={12} /></span>
        <div class="ui-dialog-titles"><h2 class="ui-dialog-title">Workforce activity</h2><p class="ui-dialog-sub">Live employee utilisation</p></div>
        <span class="ui-dialog-close" aria-hidden="true"><LucideIcon name="X" size={12} /></span>
      </header>
      <div class="ui-dialog-body">
        <ActivityGauge value={866} label="Active employees" max={1000} size="xs" showLegend={false} showTooltip={false} />
      </div>
      <footer class="ui-dialog-foot"><span>Updated just now</span><strong>View report</strong></footer>
    </section>
  </div>;
}

function PersonSelectScene(): VNode {
  return <div class="sds-thumb-person-select">
    <div class="sds-thumb-person-select__trigger"><i><img src={avatarOlivia} alt="" /></i><span><b>Olivia Rhye</b><small>@olivia</small></span><LucideIcon name="ChevronDown" size={20} /></div>
    <div class="sds-thumb-person-select__menu">
      <span><i><img src={avatarPhoenix} alt="" /></i><b>Phoenix Baker</b><small>@phoenix</small></span>
      <span class="is-selected"><i><img src={avatarOlivia} alt="" /></i><b>Olivia Rhye</b><small>@olivia</small></span>
      <span class="is-preview-muted"><i><img src={avatarLana} alt="" /></i><b>Lana Steiner</b><small>@lana</small></span>
    </div>
  </div>;
}

function ChoiceScene({ kind }: { kind: 'check' | 'radio' | 'switch' }): VNode {
  if (kind === 'check') {
    return <div class="sds-thumb-choice sds-thumb-choice--check">
      <Checkbox checked={false} onChange={() => undefined} label="Email notifications" />
      <Checkbox checked onChange={() => undefined} label="Approval alerts" />
      <Checkbox checked onChange={() => undefined} label="Product updates" class="is-preview-muted" />
      <Checkbox checked={false} onChange={() => undefined} label="Marketing news" class="is-preview-muted" />
    </div>;
  }
  if (kind === 'radio') {
    return <div class="sds-thumb-radio-cards">
      <span class="is-on"><i><img src={avatarOlivia} alt="" /></i><b>Olivia Rhye<small>HSE Manager</small></b><em>✓</em></span>
      <span><i><img src={avatarPhoenix} alt="" /></i><b>Phoenix Baker<small>Operations Supervisor</small></b><em /></span>
      <span class="is-muted"><i><img src={avatarLana} alt="" /></i><b>Lana Steiner<small>HR Business Partner</small></b><em /></span>
    </div>;
  }
  return <div class={`sds-thumb-choice sds-thumb-choice--${kind}`}><span><i />Email notifications</span><span class="is-on"><i />Approval alerts</span><span class="is-preview-muted"><i />Product updates</span></div>;
}

function CalendarScene(): VNode {
  const days = [28, 29, 30, 1, 2, 3, 4, 5, 6, 7, 8, 9, 10, 11, 12, 13, 14, 15, 16, 17, 18];
  return <div class="sds-thumb-calendar">
    <header><button type="button"><LucideIcon name="ChevronLeft" size={11} /></button><strong>August 2026</strong><button type="button"><LucideIcon name="ChevronRight" size={11} /></button></header>
    <div class="sds-thumb-calendar__week"><b>S</b><b>M</b><b>T</b><b>W</b><b>T</b><b>F</b><b>S</b></div>
    <div class="sds-thumb-calendar__days">{days.map((day, index) => <i key={`${day}-${index}`} class={day === 6 ? 'is-selected' : day > 6 && day < 11 ? 'is-range' : day > 27 ? 'is-outside' : ''}>{day}</i>)}</div>
    <footer><span>Cancel</span><strong>Apply</strong></footer>
  </div>;
}

function ColorPickerScene(): VNode {
  return <div class="sds-thumb-color-picker">
    <header><strong>Choose color</strong><i aria-hidden="true">×</i></header>
    <div class="sds-thumb-color-picker__spectrum"><span /></div>
    <footer><i aria-hidden="true" /><span><small>HEX</small><b>#7F56D9</b></span></footer>
  </div>;
}

/** Theme-aware catalogue illustration; deliberately not the interactive runtime component. */
export function ComponentThumbnail({ kind }: { kind: ThumbnailKind }): VNode {
  const fogged = kind === 'select';
  return (
    <div class={`sds-card__art sds-thumb sds-thumb--${kind}${fogged ? ' is-fogged' : ''}`} aria-hidden="true">
      {kind === 'buttons' && <div class="sds-thumb-buttons"><span>Cancel</span><strong><LucideIcon name="Check" size={13} />Continue</strong></div>}
      {kind === 'button-group' && <div class="sds-thumb-button-group"><span><LucideIcon name="Archive" size={15} />Archive</span><span><LucideIcon name="Pencil" size={15} />Edit</span><span><LucideIcon name="Trash2" size={15} />Delete</span></div>}
      {kind === 'segmented' && <div class="sds-thumb-segmented"><strong><LucideIcon name="Grid2X2" size={11} />Grid</strong><span>List</span><span>Board</span></div>}
      {kind === 'menu' && <div class="sds-thumb-menu"><strong>Actions <LucideIcon name="ChevronDown" size={12} /></strong><div><span>View record</span><span>Edit details</span><span class="is-danger">Delete</span></div></div>}
      {(['field', 'date'] as ThumbnailKind[]).includes(kind) && <FieldScene kind={kind as 'field' | 'date'} />}
      {kind === 'calendar' && <CalendarScene />}
      {kind === 'select' && <SelectScene />}
      {kind === 'person-select' && <PersonSelectScene />}
      {kind === 'upload' && <div class="sds-thumb-upload">
        <section><LucideIcon name="UploadCloud" size={16} /><strong>Click to upload <span>or drag and drop</span></strong><small>SVG, PNG, JPG or PDF</small></section>
        <article><LucideIcon name="FileText" size={18} /><div><strong>Safety inspection.pdf</strong><small>200 KB · Complete</small><i /></div><b>100%</b></article>
        <article class="is-preview-muted"><LucideIcon name="FileVideo" size={18} /><div><strong>Site walkthrough.mp4</strong><small>Uploading…</small><i /></div></article>
      </div>}
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
      {kind === 'otp' && <div class="sds-thumb-otp"><div>{['8', '2', '', ''].map((value, index) => <i class={`${value ? 'is-filled' : ''}${index === 2 ? ' is-active' : ''}`.trim()} key={index}>{value}</i>)}</div></div>}
      {(['check', 'radio', 'switch'] as ThumbnailKind[]).includes(kind) && <ChoiceScene kind={kind as 'check' | 'radio' | 'switch'} />}
      {kind === 'theme-switch' && <div class="ui-theme-mode-switch sds-thumb-theme-switch" data-theme-mode="light"><ThemeModeSwitchArtwork /></div>}
      {kind === 'app-top-bar' && <div class="sds-thumb-app-frame">
        <span class="sds-thumb-app-frame__brand"><i /><b /></span>
        <div class="sds-thumb-app-frame__icons"><i /><i /><i /></div>
        <span class="sds-thumb-app-frame__divider" />
        <section class="sds-thumb-app-frame__profile"><i /><span><b /><small /></span><em /></section>
      </div>}
      {kind === 'user-pill' && <div class="app-topbar sds-thumb-user-pill"><div class="app-topbar-main"><div class="app-topbar-pill"><UserPillArtwork /></div></div></div>}
      {kind === 'switch-family' && <div class="sds-thumb-switch-family">
        <div class="ui-choice sds-thumb-switch-family__general" data-ui-state="selected"><SwitchArtwork /></div>
        <div class="ui-choice sds-thumb-switch-family__off is-preview-muted"><SwitchArtwork /></div>
      </div>}
      {kind === 'avatar' && <div class="sds-thumb-avatar"><img src={avatarSarah} alt="Sarah Page" /></div>}
      {kind === 'people' && <div class="sds-thumb-people"><i><img src={avatarOlivia} alt="" /></i><i><img src={avatarPhoenix} alt="" /></i><i><img src={avatarLana} alt="" /></i><strong>+2</strong></div>}
      {kind === 'dialog' && <div class="sds-thumb-dialog sds-thumb-dialog--sidebar-left">
        <header><i><LucideIcon name="CircleCheck" size={12} /></i><span><strong>Modal title</strong><small>Supporting context</small></span><b><LucideIcon name="X" size={10} /></b></header>
        <div class="sds-thumb-dialog__columns">
          <aside><strong>Details</strong><span /><span /><span /></aside>
          <main><span /><span /><span /><span /></main>
        </div>
        <footer><i>Cancel</i><b>Save</b></footer>
      </div>}
      {kind === 'popover' && <div class="sds-thumb-dialog"><strong>Confirm action</strong><span>This change will be recorded.</span><footer><i>Cancel</i><b>Confirm</b></footer></div>}
      {kind === 'drawer' && <div class="sds-thumb-drawer"><aside /><div><strong>Employee details</strong><span>Sarah James</span><span>Safety Officer</span><b>Active</b></div></div>}
      {kind === 'employee-drawer' && <div class="sds-thumb-employee-drawer">
        <section><img src={avatarSarah} alt="" /><div><strong>Sarah Page</strong><small>EMP-0097 · Active</small><span>HR Business Partner</span></div><em>Permanent</em></section>
        <nav><b>Overview</b><span>Employment</span><span>Documents</span><span>Readiness</span><span>Access</span><span>Activity</span></nav>
        <main><LucideIcon name="LayoutDashboard" size={13} /><strong>Build the overview</strong><small>Add employee summary components.</small></main>
        <footer><span>View Full Record</span><b>Request Change</b></footer>
      </div>}
      {kind === 'tooltip' && <div class="sds-thumb-tooltip">More information<i /></div>}
      {kind === 'sweet-alert' && <div class="sds-thumb-sweet-alert"><i><LucideIcon name="CircleHelp" size={19} /></i><strong>Publish changes?</strong><span>This version will update the application.</span><footer><em>Cancel</em><b>Publish</b></footer></div>}
      {kind === 'table' && <div class="sds-thumb-table"><header><span>Employee</span><span>Status</span><span>Site</span></header><p><span>Sarah James</span><b>Active</b><span>Point Lisas</span></p><p><span>Amara Diallo</span><b>Leave</b><span>Chaguaramas</span></p></div>}
      {kind === 'badge' && <div class="sds-thumb-badges"><span>● Active</span><strong>● Overdue</strong></div>}
      {kind === 'tabs' && <div class="sds-thumb-tabs"><span class="is-on">Overview</span><span>People</span><span>Evidence</span><i /></div>}
      {kind === 'breadcrumbs' && <Breadcrumbs class="sds-thumb-breadcrumbs" items={[
        { label: 'Home', icon: <LucideIcon name="Home" size={19} />, iconOnly: true },
        { label: 'Settings' }, { label: 'Team members' }, { label: 'Olivia Rhye' },
      ]} />}
      {kind === 'wizard' && <div class="sds-thumb-wizard"><i class="is-done">✓</i><em /><i class="is-on">2</i><em /><i>3</i><small><span>Details</span><span>Evidence</span><span>Review</span></small></div>}
      {kind === 'progress-steps' && <div class="sds-thumb-progress-steps">
        <i class="is-done"><b>✓</b><span><strong>Details</strong><small>Identity</small></span></i>
        <i class="is-current"><b>2</b><span><strong>Employment</strong><small>Role and placement</small></span></i>
        <i><b>3</b><span><strong>Documents</strong><small>Required records</small></span></i>
      </div>}
      {kind === 'header' && <div class="sds-thumb-header"><small>Human Resources / Employees</small><strong>Employee records</strong><span>Manage people, roles and employment details.</span><b>Add employee</b></div>}
      {kind === 'alert' && <div class="sds-thumb-alert"><LucideIcon name="TriangleAlert" size={18} /><div><strong>Approval required</strong><span>A second approver must review this payroll run.</span></div></div>}
      {kind === 'progress' && <div class="sds-thumb-progress-suite"><span><i /><b>64%</b></span><span><i /><b>40%</b></span><em><i /><b>72%</b></em></div>}
      {kind === 'activity-gauge' && <ActivityGaugeScene />}
      {kind === 'illustration' && <Illustration class="sds-thumb-illustration" variant="search" treatment="contrast" />}
      {kind === 'qr-code' && <QrCode class="sds-thumb-qr" value="https://siomac.app/assets/AST-00482" label="Asset QR code preview" variant="scanning" />}
      {kind === 'file-icon' && <img class="sds-thumb-reference-grid" src={fileTypesThumbnail} alt="" />}
      {kind === 'flag-icons' && <img class="sds-thumb-reference-grid" src={countryFlagsThumbnail} alt="" />}
      {kind === 'spinner' && <div class="sds-thumb-spinner"><i /><span>Loading records…</span></div>}
      {kind === 'skeleton' && <div class="sds-thumb-skeleton"><i /><div><span /><span /></div><footer><span /><span /></footer></div>}
      {kind === 'toast' && <div class="sds-thumb-toast"><i><LucideIcon name="CircleCheck" size={16} /></i><div><strong>Changes saved</strong><span>Your changes are now available.</span></div><LucideIcon name="X" size={14} /></div>}
      {kind === 'empty-state' && <div class="sds-thumb-empty-state"><div><span><LucideIcon name="Search" size={19} /></span></div><strong>No records found</strong><small>Adjust your filters or create the first record.</small><footer><em>Clear filters</em><b>Create record</b></footer></div>}
      {kind === 'card' && <div class="sds-thumb-card"><small>OPEN INCIDENTS</small><strong>24</strong><span><b>↓ 8%</b> from last month</span></div>}
      {kind === 'accordion' && <div class="sds-thumb-accordion"><span>Scope and eligibility <b>⌄</b></span><span>Approval rules <b>⌄</b></span><span>Audit retention <b>⌄</b></span></div>}
      {kind === 'planned' && <div class="sds-thumb-planned"><LucideIcon name="Plus" size={18} /><span>Planned component</span></div>}
    </div>
  );
}
