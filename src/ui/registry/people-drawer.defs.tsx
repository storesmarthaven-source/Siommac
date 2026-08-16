import { type VNode } from 'preact';
import { useState } from 'preact/hooks';
import { Avatar, type AvatarNamedSize, type AvatarPresence } from '../people/Avatar';
import { AvatarGroup } from '../people/AvatarGroup';
import { Drawer, type DrawerSide, type DrawerSize } from '../components/Drawer';
import { Button } from '../primitives/Button';
import { Badge } from '../primitives/Badge';
import { type ComponentDef, type PropValues } from './types';
import { ProfileDrawerTemplate } from '../../components/sections/HR/ProfileDrawerTemplate';
import avatarOlivia from '../../assets/avatars/untitled-ui/Olivia Rhye.jpg';
import avatarPhoenix from '../../assets/avatars/untitled-ui/Phoenix Baker.jpg';
import avatarLana from '../../assets/avatars/untitled-ui/Lana Steiner.jpg';
import avatarDemi from '../../assets/avatars/untitled-ui/Demi Wilkinson.jpg';
import avatarSarah from '../../assets/avatars/untitled-ui/Sarah Page.jpg';

const s = (v: PropValues[string] | undefined, fallback = ''): string => typeof v === 'string' ? v : fallback;
const b = (v: PropValues[string] | undefined): boolean => v === true;
const n = (v: PropValues[string] | undefined, fallback: number): number => typeof v === 'number' ? v : fallback;

const PEOPLE = [
  { id: 'emp-484', name: 'Olivia Rhye', src: avatarOlivia, presence: 'online' as const },
  { id: 'emp-010', name: 'Phoenix Baker', src: avatarPhoenix, presence: 'away' as const },
  { id: 'emp-034', name: 'Lana Steiner', src: avatarLana },
  { id: 'emp-021', name: 'Demi Wilkinson', src: avatarDemi, presence: 'busy' as const },
  { id: 'emp-097', name: 'Sarah Page', src: avatarSarah },
];

function DrawerPreview({ props }: { props: PropValues }): VNode {
  const [open, setOpen] = useState(false);
  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open employee drawer</Button>
      <Drawer
        open={open}
        onClose={() => setOpen(false)}
        title={s(props.title, 'Employee details')}
        sub={b(props.subtitle) ? 'EMP-00484 · HSE' : undefined}
        side={s(props.side, 'right') as DrawerSide}
        size={s(props.size, 'lg') as DrawerSize}
        closeOnBackdrop={b(props.closeOnBackdrop)}
        foot={<><Button variant="outline" onClick={() => setOpen(false)}>Close</Button><Button variant="primary">Edit employee</Button></>}
      >
        <div style={{ display: 'grid', gap: '16px' }}>
          <div style={{ display: 'flex', alignItems: 'center', gap: '12px' }}>
            <Avatar name="Sarah James" seed="emp-484" size="lg" />
            <div><strong>Sarah James</strong><div style={{ color: 'var(--ui-color-text-secondary)', fontSize: '0.78rem' }}>Safety Officer · Point Lisas</div></div>
            <Badge tone="success" size="sm">Active</Badge>
          </div>
          <p style={{ margin: 0, color: 'var(--ui-color-text-secondary)' }}>Canonical drawer content composes existing primitives; the Drawer owns only the viewport edge, sheet and focus behavior.</p>
        </div>
      </Drawer>
    </>
  );
}

function EmployeeSideDrawerPreview({ props }: { props: PropValues }): VNode {
  const [open, setOpen] = useState(false);

  return (
    <>
      <Button variant="secondary" onClick={() => setOpen(true)}>Open profile drawer</Button>
      <ProfileDrawerTemplate
        open={open}
        onClose={() => setOpen(false)}
        facts={b(props.facts)}
        tabs={b(props.tabs)}
        footer={b(props.footer)}
      />
    </>
  );
}

export const avatarDef: ComponentDef = {
  id: 'avatar', name: 'Avatar', category: 'people', status: 'stable',
  thumbnail: 'avatar',
  componentPath: 'src/ui/people/Avatar.tsx', importFrom: '@ui',
  description: 'A person image with deterministic, token-driven initials fallback, optional presence and explicit decorative semantics.',
  props: {
    name: { type: 'text', label: 'Name', default: 'Sarah James' },
    size: { type: 'segmented', label: 'Size', options: ['xs', 'sm', 'md', 'lg', 'xl'], default: 'lg' },
    presence: { type: 'select', label: 'Presence', options: ['none', 'online', 'away', 'busy', 'offline'], default: 'online' },
    decorative: { type: 'boolean', label: 'Decorative', default: false },
  },
  style: [{ label: 'Geometry and fallback', controls: [
    { name: '--ui-avatar-sm', label: 'Small size', kind: 'size' },
    { name: '--ui-avatar-md', label: 'Medium size', kind: 'size' },
    { name: '--ui-avatar-lg', label: 'Large size', kind: 'size' },
    { name: '--ui-avatar-ring', label: 'Presence ring', kind: 'color' },
    { name: '--ui-avatar-palette-1', label: 'Fallback palette 1', kind: 'color' },
    { name: '--ui-avatar-palette-2', label: 'Fallback palette 2', kind: 'color' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'img for a meaningful avatar; none when decorative.', name: 'The person name or explicit label.', keyboard: [], focus: 'Never focusable.',
    notes: ['Use decorative when the same person name is visible beside the avatar. Pass a stable user or employee id as seed so fallback colour survives a name change.'],
  },
  migration: { deprecatedImports: ['@shared/Avatar'], notes: ['@shared/Avatar now re-exports this runtime; the duplicate implementation is deleted. Module-local HR, messenger and ticket avatars remain named consumer debt.'] },
  render: p => <Avatar name={s(p.name, 'Olivia Rhye')} src={avatarOlivia} seed="studio-person" size={s(p.size, 'lg') as AvatarNamedSize} presence={s(p.presence, 'none') === 'none' ? undefined : s(p.presence) as AvatarPresence} decorative={b(p.decorative)} />,
  code: p => `<Avatar name="${s(p.name, 'Sarah James')}" seed={employee.id} size="${s(p.size, 'lg')}"${s(p.presence, 'none') !== 'none' ? ` presence="${s(p.presence)}"` : ''}${b(p.decorative) ? ' decorative' : ''} />`,
};

export const avatarGroupDef: ComponentDef = {
  id: 'avatar-group', name: 'AvatarGroup', category: 'people', status: 'stable',
  thumbnail: 'people',
  componentPath: 'src/ui/people/AvatarGroup.tsx', importFrom: '@ui',
  description: 'Overlapping canonical Avatars with a named +N overflow that preserves the identities hidden from view.',
  props: {
    max: { type: 'number', label: 'Visible people', default: 3, min: 1, max: 5, step: 1 },
    size: { type: 'segmented', label: 'Size', options: ['xs', 'sm', 'md', 'lg', 'xl'], default: 'md' },
  },
  style: [{ label: 'Group', controls: [
    { name: '--ui-avatar-group-overlap', label: 'Overlap', kind: 'size' },
    { name: '--ui-avatar-overflow-bg', label: 'Overflow background', kind: 'color' },
    { name: '--ui-avatar-overflow-fg', label: 'Overflow text', kind: 'color' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'list', name: 'The group label.', keyboard: [], focus: 'Never focusable.',
    notes: ['Visible list items are named individually. The overflow item names every hidden person, not only the count.'],
  },
  render: p => <AvatarGroup people={PEOPLE} max={n(p.max, 3)} size={s(p.size, 'md') as AvatarNamedSize} label="Case team" />,
  code: p => `<AvatarGroup people={caseTeam} max={${n(p.max, 3)}} size="${s(p.size, 'md')}" label="Case team" />`,
};

export const drawerDef: ComponentDef = {
  id: 'drawer', name: 'Drawer', category: 'overlays', status: 'stable',
  thumbnail: 'drawer',
  componentPath: 'src/ui/components/Drawer.tsx', importFrom: '@ui',
  description: 'The one focus-managed side sheet. Side and size own viewport placement; business detail layouts remain compositions inside it.',
  props: {
    title: { type: 'text', label: 'Title', default: 'Employee details' },
    side: { type: 'segmented', label: 'Side', options: ['left', 'right'], default: 'right' },
    size: { type: 'segmented', label: 'Size', options: ['sm', 'md', 'lg', 'xl'], default: 'lg' },
    subtitle: { type: 'boolean', label: 'Subtitle', default: true },
    closeOnBackdrop: { type: 'boolean', label: 'Backdrop closes', default: true },
  },
  style: [{ label: 'Width scale', controls: [
    { name: '--ui-drawer-width-sm', label: 'Small', kind: 'size' },
    { name: '--ui-drawer-width-md', label: 'Medium', kind: 'size' },
    { name: '--ui-drawer-width-lg', label: 'Large', kind: 'size' },
    { name: '--ui-drawer-width-xl', label: 'Extra large', kind: 'size' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'dialog, aria-modal="true"', name: 'aria-labelledby points to the visible drawer title.',
    keyboard: [{ keys: 'Escape', does: 'Closes and returns focus to the opener.' }, { keys: 'Tab / Shift+Tab', does: 'Cycles within the open sheet.' }],
    focus: 'Moves into the sheet on open, traps while open and returns to the opener on close.',
    notes: ['Use Dialog for a centred interruption. Drawer is for contextual work that remains anchored to a viewport edge.'],
  },
  migration: { replaces: ['.ui-rdrawer'], deprecatedImports: ['HseDrawer', 'DetailDrawer'], notes: ['The duplicate HseDrawer and DetailDrawer exports were removed; no consumer used them. Rich business panels remain compositions of the same Drawer runtime.'] },
  render: p => <DrawerPreview props={p} />,
  code: p => `<Drawer open={open} onClose={close} title="${s(p.title, 'Employee details')}" side="${s(p.side, 'right')}" size="${s(p.size, 'lg')}"${b(p.closeOnBackdrop) ? '' : ' closeOnBackdrop={false}'}>
  <EmployeeDetails employee={employee} />
</Drawer>`,
};

export const employeeSideDrawerDef: ComponentDef = {
  id: 'employee-side-drawer', name: 'Profile Drawer Modal', category: 'overlays', status: 'stable',
  thumbnail: 'employee-drawer',
  componentPath: 'src/components/sections/HR/ProfileDrawerTemplate.tsx', importFrom: '@/components/sections/HR/ProfileDrawerTemplate',
  description: 'The reusable Employee Master drawer shell: profile hero, facts, six approved sections, an empty composition area, and a pinned action footer.',
  props: {
    facts: { type: 'boolean', label: 'Employee facts', default: true },
    tabs: { type: 'boolean', label: 'Section tabs', default: true },
    footer: { type: 'boolean', label: 'Action footer', default: true },
  },
  style: [{ label: 'Slideout frame', controls: [
    { name: '--sds-employee-slideout-width', label: 'Panel width', kind: 'size' },
    { name: '--sds-employee-slideout-hero', label: 'Profile background', kind: 'color' },
    { name: '--ui-tab-indicator', label: 'Tab indicator', kind: 'color' },
    { name: '--sds-employee-slideout-footer', label: 'Footer background', kind: 'color' },
  ] }],
  states: ['default'], compare: ['default'],
  a11y: {
    role: 'dialog, aria-modal="true"', name: 'A visible title or explicit accessible label.',
    keyboard: [{ keys: 'Escape', does: 'Closes the topmost inner dialog first, then the slideout.' }, { keys: 'Tab / Shift+Tab', does: 'Moves through the slideout controls.' }],
    focus: 'Moves to the sheet when opened; the production Employee drawer preserves its existing data and permission flow.',
    notes: ['Header, summary, navigation, body and footer are composition slots. Business data and permissions never belong to the reusable frame.'],
  },
  render: p => <EmployeeSideDrawerPreview props={p} />,
  code: () => `<ProfileDrawerTemplate open={open} onClose={close} />`,
};

export const PEOPLE_DRAWER_DEFS: readonly ComponentDef[] = [avatarDef, avatarGroupDef, drawerDef, employeeSideDrawerDef];
