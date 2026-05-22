/**
 * src/api/schemas/ticket.ts
 *
 * Zod schemas for the Support Tickets domain.
 * Matches the shape returned by the /getTickets backend route exactly.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md §2-TypeScript-Rules
 */

import { z } from 'zod';

// ── Enums ─────────────────────────────────────────────────────────────────────

export const TICKET_STATUSES = ['open', 'in_progress', 'resolved', 'closed', 'deleted'] as const;
export type  TicketStatus    = typeof TICKET_STATUSES[number];

export const TICKET_STATUS_LABEL: Record<TicketStatus, string> = {
  open:        'Open',
  in_progress: 'In Progress',
  resolved:    'Resolved',
  closed:      'Closed',
  deleted:     'Deleted',
};

/** CSS modifier class applied to status badges */
export const TICKET_STATUS_CSS: Record<TicketStatus, string> = {
  open:        'open',
  in_progress: 'pending',
  resolved:    'closed',
  closed:      'closed',
  deleted:     'deleted',
};

export const TICKET_CATEGORIES = [
  { value: 'general',    label: 'General' },
  { value: 'attendance', label: 'Attendance Issue' },
  { value: 'leave',      label: 'Leave Problem' },
  { value: 'payroll',    label: 'Payroll / Hours' },
  { value: 'technical',  label: 'Technical Problem' },
  { value: 'other',      label: 'Other' },
] as const;

/** How long before an open ticket is flagged as overdue (milliseconds) */
export const SLA_OVERDUE_MS = 48 * 60 * 60 * 1000;   // 48 hours

// ── Reply ─────────────────────────────────────────────────────────────────────

export const TicketReplySchema = z.object({
  id:           z.union([z.string(), z.number()]).transform(String),
  ticketId:     z.union([z.string(), z.number()]).transform(String).optional(),
  fromUsername: z.string(),
  fromName:     z.string(),
  fromPhoto:    z.string().default(''),
  body:         z.string(),
  createdAt:    z.string(),
});

export type TicketReply = z.infer<typeof TicketReplySchema>;

// ── Ticket ────────────────────────────────────────────────────────────────────

export const TicketRowSchema = z.object({
  id:           z.union([z.string(), z.number()]).transform(String),
  ticketNumber: z.string(),
  status:       z.enum(TICKET_STATUSES),
  fromUsername: z.string(),
  fromName:     z.string().default(''),
  fromPhoto:    z.string().default(''),
  subject:      z.string(),
  body:         z.string(),
  createdAt:    z.string(),
  replies:      z.array(TicketReplySchema).default([]),
});

export type TicketRow = z.infer<typeof TicketRowSchema>;

// ── Derived helpers ───────────────────────────────────────────────────────────

/** Latest activity timestamp for sorting */
export function ticketLatestAt(t: TicketRow): string {
  return t.replies.length
    ? t.replies[t.replies.length - 1]!.createdAt
    : t.createdAt;
}

/** True when an open ticket has exceeded the SLA window */
export function isOverdue(t: TicketRow): boolean {
  return t.status === 'open' &&
    (Date.now() - new Date(t.createdAt).getTime()) > SLA_OVERDUE_MS;
}

/** True when the ticket cannot accept new replies */
export function isClosed(t: TicketRow): boolean {
  return t.status === 'closed' || t.status === 'resolved' || t.status === 'deleted';
}

// ── Write payloads ────────────────────────────────────────────────────────────

export const CreateTicketPayloadSchema = z.object({
  category: z.string().min(1),
  subject:  z.string().min(1).max(120),
  body:     z.string().min(1).max(4000),
});

export type CreateTicketPayload = z.infer<typeof CreateTicketPayloadSchema>;
