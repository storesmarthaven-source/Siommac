import { registerModule, type ModuleDefinition } from '@lib/moduleRegistry';
import { mountMeetingsSection, unmountMeetingsSection } from './mount';

export const meetingsModule: ModuleDefinition = {
  id: 'meetings', navGroup: { id: 'overview', label: '' },
  navItems: [{ id: 's-meetings', label: 'Meetings', icon: 'fa-video', sub: 'Agendas, attendance, recordings, reviewed outcomes and follow-up actions', permission: 'meetings.view' }],
  roles: ['superadmin', 'admin', 'manager', 'employee', 'hr_staff', 'hr_manager', 'finance_staff', 'finance_manager', 'hse_staff'],
  mount: { sectionId: 's-meetings', rootId: 'preact-meetings-root', mount: (root, context) => mountMeetingsSection(root, { queryClient: context.queryClient as never }), unmount: unmountMeetingsSection },
  visibilityNamespace: 'meetings',
};

registerModule(meetingsModule);
