/**
 * src/components/nav/api.ts
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md
 */

import { apiPost } from '@lib/api';
import type { NotifItem } from './types';

interface NotifResponse        { success: boolean; data?: NotifItem[]; }
interface BasicResponse        { success: boolean; message?: string; id?: string | number; count?: number; }

export const getNotifications = () =>
  apiPost<NotifResponse>('getNotifications', {});

// Legacy message endpoints retired — the canonical communications/messages/* API
// (src/api/communications.ts) replaces them.

export const updateColorScheme = (args: { username: string; scheme: string }) =>
  apiPost<BasicResponse>('updateColorScheme', args);

export const updateLayoutMode = (args: { username: string; mode: string }) =>
  apiPost<BasicResponse>('updateLayoutMode', args);
