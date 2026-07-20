import { registerModule, type ModuleDefinition } from '@lib/moduleRegistry';
import { mountTicketCenter, unmountTicketCenter } from './mount';

export const ticketModule: ModuleDefinition = {
  id: 'tickets',
  navGroup: { id: 'overview', label: '' },
  navItems: [{
    id: 's-tickets',
    label: 'Ticket Center',
    icon: 'fa-ticket',
    sub: 'Requests, queues and service support',
    permission: 'communications.view',
  }],
  roles: ['superadmin', 'admin', 'manager', 'employee'],
  mount: {
    sectionId: 's-tickets',
    rootId: 'preact-ticket-center-root',
    mount: (root, context) => mountTicketCenter(root, { queryClient: context.queryClient as never }),
    unmount: unmountTicketCenter,
  },
  visibilityNamespace: 'tickets',
};

registerModule(ticketModule);
