/**
 * src/components/sections/Calendar/module.ts
 *
 * Platform Calendar & Tasks feature module. A single top-level "Calendar & Tasks"
 * nav item (flat 'overview' group, so it renders bare like the mockup) that mounts
 * the full calendar page. Self-registers at import.
 */

import { registerModule, type ModuleDefinition } from '@lib/moduleRegistry';
import { mountCalendarSection, unmountCalendarSection } from './mount';

const CALENDAR_ROOT_ID = 'preact-calendar-root';

export const calendarModule: ModuleDefinition = {
  id: 'calendar',
  navGroup: { id: 'overview', label: '' },   // flat top-level item, no group header
  navItems: [{
    id:   's-calendar',
    label: 'Calendar & Tasks',
    icon: 'fa-calendar-days',
    sub:  'Deadlines, tasks and activities across every module — one calendar',
  }],
  roles: ['superadmin', 'admin', 'manager', 'employee'],
  mount: {
    sectionId: 's-calendar',
    rootId:    CALENDAR_ROOT_ID,
    mount:   (root, ctx) => mountCalendarSection(root, { queryClient: ctx.queryClient as never }),
    unmount: (root) => unmountCalendarSection(root),
  },
  visibilityNamespace: 'calendar',
};

registerModule(calendarModule);
