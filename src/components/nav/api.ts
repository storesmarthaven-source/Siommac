/**
 * src/components/nav/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { apiAction } from '@lib/api';
import type { HeaderCounts, NotifItem, MsgItem, TicketItem } from './types';

interface HeaderCountsResponse { success: boolean; data?: HeaderCounts; }
interface NotifResponse        { success: boolean; data?: NotifItem[]; }
interface MsgResponse          { success: boolean; data?: MsgItem[]; unreadCount?: number; }
interface TicketResponse       { success: boolean; data?: TicketItem[]; }
interface BasicResponse        { success: boolean; message?: string; id?: string | number; ticketNumber?: string; count?: number; }

export const getHeaderCounts = (args: { managerUsername: string; role: string; ticketSeenSince: string | null }) =>
  apiAction<HeaderCountsResponse>('getHeaderCounts', args as unknown as Record<string, unknown>);

export const getNotifications = () =>
  apiAction<NotifResponse>('getNotifications', {});

export const getMessages = () =>
  apiAction<MsgResponse>('getMessages', {});

export const markMessageRead = (messageId: string | number) =>
  apiAction<BasicResponse>('markMessageRead', { messageId } as unknown as Record<string, unknown>);

export const sendMessage = (args: { subject: string; body: string; toUsername: string }) =>
  apiAction<BasicResponse>('sendMessage', args as unknown as Record<string, unknown>);

export const replyMessage = (args: { messageId: string | number; body: string }) =>
  apiAction<BasicResponse>('replyMessage', args as unknown as Record<string, unknown>);

export const deleteMessage = (messageId: string | number) =>
  apiAction<BasicResponse>('deleteMessage', { messageId } as unknown as Record<string, unknown>);

export const getEmployeesForMsg = () =>
  apiAction<{ success: boolean; data?: Array<{ username: string; fullName: string; role: string }> }>('getEmployeesForMsg', {});

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
