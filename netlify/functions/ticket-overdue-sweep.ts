import './lib/bootstrapEnv';
import { schedule } from '@netlify/functions';
import { emitSignal } from './lib/communications';
import {
  cleanupStaleTicketAttachments,
  runTicketOverdueSweep,
} from './lib/tickets/ticketRpc';

interface ScheduleEvent {
  headers?: Record<string, string | undefined>;
}

export const handler = schedule('7 * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'Scheduled invocation only' };
  }

  try {
    const [result, staleAttachmentsRemoved] = await Promise.all([
      runTicketOverdueSweep(500),
      cleanupStaleTicketAttachments(),
    ]);
    await Promise.all([
      emitSignal(result.recipientIds, 'tickets'),
      emitSignal(result.recipientIds, 'notifications'),
    ]);
    return {
      statusCode: 200,
      body: JSON.stringify({ ...result, staleAttachmentsRemoved }),
    };
  } catch (error) {
    console.error('ticket-overdue-sweep failed:', error);
    return {
      statusCode: 500,
      body: error instanceof Error ? error.message : 'Ticket overdue sweep failed',
    };
  }
});
