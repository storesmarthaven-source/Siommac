/**
 * src/components/nav/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { apiAction } from '@lib/api';
import type { NotifItem, TicketItem } from './types';

interface NotifResponse        { success: boolean; data?: NotifItem[]; }
interface TicketResponse       { success: boolean; data?: TicketItem[]; }
interface BasicResponse        { success: boolean; message?: string; id?: string | number; ticketNumber?: string; count?: number; }

export const getNotifications = () =>
  apiAction<NotifResponse>('getNotifications', {});

// Legacy message endpoints retired — the canonical communications/messages/* API
// (src/api/communications.ts) replaces them.

export const getTickets = () =>
  apiAction<TicketResponse>('getTickets', {});

export const createTicket = (args: { category: string; subject: string; body: string }) =>
  apiAction<BasicResponse>('createTicket', args as unknown as Record<string, unknown>);

export const replyTicket = (args: { ticketId: string | number; body: string }) =>
  apiAction<BasicResponse>('replyTicket', args as unknown as Record<string, unknown>);

export const updateTicketStatus = (args: { ticketId: string | number; status: string }) =>
  apiAction<BasicResponse>('updateTicketStatus', args as unknown as Record<string, unknown>);

export const deleteTicket = (ticketId: string | number) =>
  apiAction<BasicResponse>('deleteTicket', { ticketId } as unknown as Record<string, unknown>);

export const clearClosedTickets = () =>
  apiAction<BasicResponse>('clearClosedTickets', {});

export const updateColorScheme = (args: { username: string; scheme: string }) =>
  apiAction<BasicResponse>('updateColorScheme', args as unknown as Record<string, unknown>);

export const updateLayoutMode = (args: { username: string; mode: string }) =>
  apiAction<BasicResponse>('updateLayoutMode', args as unknown as Record<string, unknown>);
