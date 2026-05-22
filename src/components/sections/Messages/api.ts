/**
 * src/components/sections/Messages/api.ts
 *
 * Typed fetch wrappers for the Messages domain.
 * Delegates to the existing Netlify function routes — no logic lives here.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { apiPost } from '@lib/api';
import type { MsgItem } from '@components/nav/types';

interface MsgResponse   { success: boolean; data?: MsgItem[]; unreadCount?: number; }
interface BasicResponse { success: boolean; message?: string; id?: string | number; }
interface EmpItem       { username: string; fullName: string; role: string; }
interface EmpResponse   { success: boolean; data?: EmpItem[]; }

export const fetchMessages = (): Promise<MsgItem[]> =>
  apiPost<MsgResponse>('getMessages', {}).then(res => {
    if (!res.success) throw new Error('Failed to fetch messages');
    return res.data ?? [];
  });

export const sendMessage = (args: {
  subject:    string;
  body:       string;
  toUsername: string;
}): Promise<BasicResponse> =>
  apiPost<BasicResponse>('sendMessage', args as unknown as Record<string, unknown>);

export const replyMessage = (args: {
  messageId: string | number;
  body:      string;
}): Promise<BasicResponse> =>
  apiPost<BasicResponse>('replyMessage', args as unknown as Record<string, unknown>);

export const markMessageRead = (messageId: string | number): Promise<BasicResponse> =>
  apiPost<BasicResponse>('markMessageRead', { messageId } as unknown as Record<string, unknown>);

export const deleteMessage = (messageId: string | number): Promise<BasicResponse> =>
  apiPost<BasicResponse>('deleteMessage', { messageId } as unknown as Record<string, unknown>);

export const fetchEmployeesForMsg = (): Promise<EmpItem[]> =>
  apiPost<EmpResponse>('getEmployeesForMsg', {}).then(res => res.data ?? []);
