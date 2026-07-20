import { sb } from './db';
import { expandRecurrence, type OccurrenceException } from './calendarRecurrence';
import { notify } from './notify';
import { emitSignal } from './communications';

const DAY_MS = 86_400_000;
const LOOKBACK_MS = 24 * 60 * 60 * 1000;
const PAGE_SIZE = 500;
const IN_CHUNK_SIZE = 200;

interface ReminderRow {
  id: string;
  calendar_entry_id: string;
  user_id: string;
  offset_minutes: number;
}

interface EntryRow {
  id: string;
  type: 'task' | 'activity';
  title: string;
  all_day: boolean;
  starts_on: string | null;
  ends_on: string | null;
  starts_at: string | null;
  ends_at: string | null;
  owner_user_id: string;
  assignee_user_id: string | null;
  status: string | null;
  recurrence_rule: string | null;
  recurrence_series_id: string | null;
}

interface DeliveryResult {
  claimed?: boolean;
  notificationId?: string | null;
  email?: boolean;
  whatsapp?: boolean;
  dedupeKey?: string;
}

export interface CalendarSweepResult {
  remindersScanned: number;
  remindersDelivered: number;
  overdueScanned: number;
  overdueDelivered: number;
}

function trinidadDateKey(date: Date): string {
  const parts = new Intl.DateTimeFormat('en-CA', {
    timeZone: 'America/Port_of_Spain',
    year: 'numeric',
    month: '2-digit',
    day: '2-digit',
  }).formatToParts(date);
  const part = (type: Intl.DateTimeFormatPartTypes): string =>
    parts.find(value => value.type === type)?.value ?? '';
  return `${part('year')}-${part('month')}-${part('day')}`;
}

function allDayStart(key: string): Date {
  // SIOMAC's statutory operating timezone is Trinidad and Tobago (UTC-04, no DST).
  return new Date(`${key}T09:00:00-04:00`);
}

function dueInstant(entry: Pick<EntryRow, 'all_day' | 'starts_on' | 'starts_at'>): Date | null {
  if (entry.all_day && entry.starts_on) {
    return new Date(allDayStart(entry.starts_on).getTime() + 15 * 60 * 60 * 1000);
  }
  return entry.starts_at ? new Date(entry.starts_at) : null;
}

async function recordDelivery(args: {
  entryId: string;
  reminderId: string | null;
  userId: string;
  kind: 'reminder' | 'overdue';
  occurrenceKey: string;
  scheduledFor: string;
  eventType: string;
  title: string;
  body: string;
  dueAt: string;
  severity: 'info' | 'warning';
  metadata: Record<string, unknown>;
}): Promise<boolean> {
  const rpcResult = await sb.rpc('calendar_record_delivery_tx', {
    p_calendar_entry_id: args.entryId,
    p_reminder_id: args.reminderId,
    p_user_id: args.userId,
    p_delivery_kind: args.kind,
    p_occurrence_key: args.occurrenceKey,
    p_scheduled_for: args.scheduledFor,
    p_event_type: args.eventType,
    p_title: args.title,
    p_body: args.body,
    p_due_at: args.dueAt,
    p_severity: args.severity,
    p_metadata: args.metadata,
  }) as { data: unknown; error: { message: string } | null };
  const { data, error } = rpcResult;
  if (error) throw new Error(`calendar delivery claim failed: ${error.message}`);
  const result = (data ?? {}) as DeliveryResult;
  if (!result.claimed) return false;

  if (result.notificationId) {
    await emitSignal([args.userId], 'notifications');
  }

  if ((result.email || result.whatsapp) && result.dedupeKey) {
    await notify({
      userId: args.userId,
      type: args.eventType,
      title: args.title,
      body: args.body,
      module: 'calendar',
      severity: args.severity,
      sourceType: 'calendar_entry',
      sourceId: args.entryId,
      actionRoute: 's-calendar',
      link: 's-calendar',
      metadata: args.metadata,
      dedupeKey: result.dedupeKey,
      actionRequired: args.kind === 'overdue',
      dueAt: args.dueAt,
    });
  }
  return true;
}

export async function runCalendarReminderSweep(now = new Date()): Promise<CalendarSweepResult> {
  const reminders: ReminderRow[] = [];
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb.from('calendar_reminders')
      .select('id, calendar_entry_id, user_id, offset_minutes')
      .eq('enabled', true)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`calendar reminders fetch failed: ${error.message}`);
    reminders.push(...(data as ReminderRow[]));
    if (data.length < PAGE_SIZE) break;
  }

  const entryIds = [...new Set(reminders.map(reminder => reminder.calendar_entry_id))];
  const entries: EntryRow[] = [];
  for (let index = 0; index < entryIds.length; index += IN_CHUNK_SIZE) {
    const { data, error } = await sb.from('calendar_entries')
      .select('id,type,title,all_day,starts_on,ends_on,starts_at,ends_at,owner_user_id,assignee_user_id,status,recurrence_rule,recurrence_series_id')
      .in('id', entryIds.slice(index, index + IN_CHUNK_SIZE));
    if (error) throw new Error(`calendar reminder entries fetch failed: ${error.message}`);
    entries.push(...(data as EntryRow[]));
  }
  const entryById = new Map(entries.map(entry => [entry.id, entry]));

  const recurringIds = entries.filter(entry => entry.recurrence_rule).map(entry => entry.id);
  const exceptionData: Record<string, unknown>[] = [];
  for (let index = 0; index < recurringIds.length; index += IN_CHUNK_SIZE) {
    const { data, error } = await sb.from('calendar_recurrence_exceptions')
      .select('*')
      .in('calendar_entry_id', recurringIds.slice(index, index + IN_CHUNK_SIZE));
    if (error) throw new Error(`calendar reminder exceptions fetch failed: ${error.message}`);
    exceptionData.push(...(data as Record<string, unknown>[]));
  }
  const exceptionsByEntry = new Map<string, OccurrenceException[]>();
  for (const row of exceptionData) {
    const list = exceptionsByEntry.get(row.calendar_entry_id as string) ?? [];
    list.push({
      occurrenceDate: row.occurrence_date as string,
      exceptionType: row.exception_type as OccurrenceException['exceptionType'],
      replacementTitle: row.replacement_title as string | null,
      replacementNotes: row.replacement_notes as string | null,
      replacementAllDay: row.replacement_all_day as boolean | null,
      replacementStartsOn: row.replacement_starts_on as string | null,
      replacementEndsOn: row.replacement_ends_on as string | null,
      replacementStartsAt: row.replacement_starts_at as string | null,
      replacementEndsAt: row.replacement_ends_at as string | null,
      replacementStatus: row.replacement_status as string | null,
    });
    exceptionsByEntry.set(row.calendar_entry_id as string, list);
  }

  let remindersDelivered = 0;
  const nowMs = now.getTime();
  for (const reminder of reminders) {
    const entry = entryById.get(reminder.calendar_entry_id);
    if (!entry || entry.status === 'done' || entry.status === 'cancelled') continue;
    const target = new Date(nowMs + reminder.offset_minutes * 60_000);
    const from = trinidadDateKey(new Date(target.getTime() - LOOKBACK_MS));
    const to = trinidadDateKey(new Date(target.getTime() + DAY_MS));
    const occurrences = entry.recurrence_rule
      ? expandRecurrence({
          id: entry.id,
          allDay: entry.all_day,
          startsOn: entry.starts_on,
          endsOn: entry.ends_on,
          startsAt: entry.starts_at,
          endsAt: entry.ends_at,
          recurrenceRule: entry.recurrence_rule,
          recurrenceSeriesId: entry.recurrence_series_id,
        }, from, to, exceptionsByEntry.get(entry.id) ?? [])
      : [{
          occurrenceDate: entry.starts_on ?? entry.starts_at?.slice(0, 10) ?? '',
          allDay: entry.all_day,
          startsOn: entry.starts_on,
          startsAt: entry.starts_at,
          overrideStatus: entry.status,
        }];

    for (const occurrence of occurrences) {
      if (!occurrence.occurrenceDate || occurrence.overrideStatus === 'done' || occurrence.overrideStatus === 'cancelled') continue;
      const starts = occurrence.allDay && occurrence.startsOn
        ? allDayStart(occurrence.startsOn)
        : occurrence.startsAt ? new Date(occurrence.startsAt) : null;
      if (!starts) continue;
      const scheduled = new Date(starts.getTime() - reminder.offset_minutes * 60_000);
      if (scheduled.getTime() > nowMs || scheduled.getTime() < nowMs - LOOKBACK_MS) continue;
      const delivered = await recordDelivery({
        entryId: entry.id,
        reminderId: reminder.id,
        userId: reminder.user_id,
        kind: 'reminder',
        occurrenceKey: occurrence.occurrenceDate,
        scheduledFor: scheduled.toISOString(),
        eventType: 'calendar.reminder.due',
        title: `Reminder: ${entry.title}`,
        body: `${entry.title} is scheduled for ${starts.toLocaleString('en-TT', { timeZone: 'America/Port_of_Spain' })}.`,
        dueAt: starts.toISOString(),
        severity: 'info',
        metadata: { occurrenceDate: occurrence.occurrenceDate, offsetMinutes: reminder.offset_minutes },
      });
      if (delivered) remindersDelivered++;
    }
  }

  const overdueEntries: EntryRow[] = [];
  const localToday = trinidadDateKey(now);
  for (let from = 0; ; from += PAGE_SIZE) {
    const { data, error } = await sb.from('calendar_entries')
      .select('id,type,title,all_day,starts_on,ends_on,starts_at,ends_at,owner_user_id,assignee_user_id,status,recurrence_rule,recurrence_series_id')
      .eq('type', 'task')
      .not('status', 'in', '(done,cancelled)')
      .is('recurrence_rule', null)
      .or(`and(all_day.eq.true,starts_on.lt.${localToday}),and(all_day.eq.false,starts_at.lt.${now.toISOString()})`)
      .order('id', { ascending: true })
      .range(from, from + PAGE_SIZE - 1);
    if (error) throw new Error(`calendar overdue fetch failed: ${error.message}`);
    overdueEntries.push(...(data as EntryRow[]));
    if (data.length < PAGE_SIZE) break;
  }
  let overdueDelivered = 0;
  for (const entry of overdueEntries) {
    const due = dueInstant(entry);
    if (!due || due.getTime() >= nowMs) continue;
    const userId = entry.assignee_user_id ?? entry.owner_user_id;
    const delivered = await recordDelivery({
      entryId: entry.id,
      reminderId: null,
      userId,
      kind: 'overdue',
      occurrenceKey: entry.starts_on ?? entry.starts_at?.slice(0, 10) ?? entry.id,
      scheduledFor: due.toISOString(),
      eventType: 'calendar.task.overdue',
      title: `Task overdue: ${entry.title}`,
      body: `${entry.title} is past its due date and requires attention.`,
      dueAt: due.toISOString(),
      severity: 'warning',
      metadata: { dueAt: due.toISOString() },
    });
    if (delivered) overdueDelivered++;
  }

  return {
    remindersScanned: reminders.length,
    remindersDelivered,
    overdueScanned: overdueEntries.length,
    overdueDelivered,
  };
}
