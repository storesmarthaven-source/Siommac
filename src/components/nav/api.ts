/**
 * src/components/nav/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { NotifItem, TicketItem } from './types';

interface NotifResponse        { success: boolean; data?: NotifItem[]; }
interface TicketResponse       { success: boolean; data?: TicketItem[]; }
interface BasicResponse        { success: boolean; message?: string; id?: string | number; ticketNumber?: string; count?: number; }

export const getNotifications = () =>
  apiPost<NotifResponse>('getNotifications', {});

// Legacy message endpoints retired — the canonical communications/messages/* API
// (src/api/communications.ts) replaces them.

export const getTickets = () =>
  apiPost<TicketResponse>('getTickets', {});

export const createTicket = (args: { category: string; subject: string; body: string }) =>
  apiPost<BasicResponse>('createTicket', args);

export const replyTicket = (args: { ticketId: string | number; body: string }) =>
  apiPost<BasicResponse>('replyTicket', args);

export const updateTicketStatus = (args: { ticketId: string | number; status: string }) =>
  apiPost<BasicResponse>('updateTicketStatus', args);

export const deleteTicket = (ticketId: string | number) =>
  apiPost<BasicResponse>('deleteTicket', { ticketId });

export const clearClosedTickets = () =>
  apiPost<BasicResponse>('clearClosedTickets', {});

export const updateColorScheme = (args: { username: string; scheme: string }) =>
  apiPost<BasicResponse>('updateColorScheme', args);

export const updateLayoutMode = (args: { username: string; mode: string }) =>
  apiPost<BasicResponse>('updateLayoutMode', args);
