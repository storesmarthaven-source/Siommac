import './lib/bootstrapEnv';
import { schedule } from '@netlify/functions';
import { runCalendarReminderSweep } from './lib/calendarReminderSweep';

interface ScheduleEvent {
  headers?: Record<string, string | undefined>;
}

export const handler = schedule('*/15 * * * *', async (event: ScheduleEvent) => {
  if (event.headers?.['x-netlify-event'] !== 'schedule') {
    return { statusCode: 403, body: 'Scheduled invocation only' };
  }
  try {
    const result = await runCalendarReminderSweep();
    return { statusCode: 200, body: JSON.stringify(result) };
  } catch (error) {
    console.error('calendar-reminder-sweep failed:', error);
    return { statusCode: 500, body: error instanceof Error ? error.message : 'Calendar reminder sweep failed' };
  }
});
