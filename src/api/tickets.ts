/**
 * src/api/tickets.ts
 *
 * Typed API functions for the Support Tickets domain.
 *
 * All calls go through the Netlify backend action-dispatch layer (not direct
 * Supabase) because tickets require server-side role checks, ticket-number
 * generation, and join queries across support_tickets + ticket_replies.
 *
 * Realtime events (support_tickets INSERT/UPDATE, ticket_replies INSERT) are
 * subscribed in src/store/realtime.ts and fire TanStack Query invalidations
 * via onRealtimeEvent() — components never poll.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md §8-API-&-Data-Fetching-Rules
 */

import { apiPost }         from '@lib/api';
import { logger }          from '@lib/logger';
import { TicketRowSchema } from './schemas/ticket';
import type { TicketRow, CreateTicketPayload } from './schemas/ticket';

// ── Read ──────────────────────────────────────────────────────────────────────

/**
 * Fetch all tickets visible to the current user.
 * Admins/managers see all non-cleared tickets.
 * Employees see their own non-cleared tickets.
 * Replies are joined server-side and included in each row.
 */
export async function fetchTickets(): Promise<TicketRow[]> {
  const res = await apiPost<{ success: boolean; data?: unknown[]; message?: string }>(
    'getTickets', {},
  );

  if (!res.success) {
    logger.warn('[api/tickets] fetchTickets failed', { message: res.message });
    throw new Error(res.message ?? 'Failed to load tickets.');
  }
  return (res.data ?? []).flatMap(raw => {
    const parsed = TicketRowSchema.safeParse(raw);
    if (!parsed.success) {
      logger.warn('[api/tickets] Malformed ticket row skipped', {
        issues: parsed.error.issues,
        raw,
      });
      return [];
    }
    return [parsed.data];
  });
}

// ── Write ─────────────────────────────────────────────────────────────────────

export async function createTicket(
  payload: CreateTicketPayload,
): Promise<{ id: string; ticketNumber: string }> {
  const res = await apiPost<{ success: boolean; id?: string; ticketNumber?: string; message?: string }>(
    'createTicket', payload as unknown as Record<string, unknown>,
  );
  if (!res.success || !res.id) {
    throw new Error(res.message ?? 'Failed to create ticket.');
  }
  return { id: res.id, ticketNumber: res.ticketNumber ?? '' };
}

export async function replyToTicket(ticketId: string, body: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'replyTicket', { ticketId, body },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to send reply.');
}

export async function updateTicketStatus(ticketId: string, status: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'updateTicketStatus', { ticketId, status },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to update status.');
}

export async function deleteTicket(ticketId: string): Promise<void> {
  const res = await apiPost<{ success: boolean; message?: string }>(
    'deleteTicket', { ticketId },
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to delete ticket.');
}

export async function clearClosedTickets(): Promise<number> {
  const res = await apiPost<{ success: boolean; count?: number; message?: string }>(
    'clearClosedTickets', {},
  );
  if (!res.success) throw new Error(res.message ?? 'Failed to clear tickets.');
  return res.count ?? 0;
}
