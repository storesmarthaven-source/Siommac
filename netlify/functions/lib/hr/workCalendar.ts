// Shared Work Calendar (F-CAL) service layer. Command RPCs derive the idempotency hash in SQL, so the lib
// passes only (actor, command, requestKey, payload) and maps the raw jsonb result into camelCase DTOs.
// Reads are bounded + keyset-paginated with opaque, filter-fingerprinted cursors.
// Contract: docs/module-contracts/shared-work-calendar-delivery-contract.md.
import { createHash } from 'node:crypto';
import { sb } from '../db';

// PR4xx errcodes raised by the RPCs -> HTTP (incl. this build's calendar.* codes).
const SQLSTATE_HTTP: Record<string, number> = { PR400: 400, PR403: 403, PR409: 409, PR422: 422 };
function rpcError(error: { code?: string | null; message: string }): never {
  const status = (error.code && SQLSTATE_HTTP[error.code]) || 500;
  throw Object.assign(new Error(error.message), { status });
}

type Row = Record<string, unknown>;
const asText = (v: unknown): string => (v == null ? '' : String(v));

// ── DTO mappers (snake_case row -> camelCase DTO) ────────────────────────────
const holidayCalendarDto = (r: Row) => ({ id: asText(r.id), name: asText(r.name), jurisdiction: asText(r.jurisdiction), lockVersion: Number(r.lock_version), createdAt: asText(r.created_at) });
const workCalendarDto    = (r: Row) => ({ id: asText(r.id), name: asText(r.name), lockVersion: Number(r.lock_version), createdAt: asText(r.created_at) });
const holidayVersionDto  = (r: Row) => ({ id: asText(r.id), holidayCalendarId: asText(r.holiday_calendar_id), versionNo: Number(r.version_no), status: asText(r.status), effectiveFrom: asText(r.effective_from), effectiveTo: r.effective_to ? asText(r.effective_to) : null, timezone: asText(r.timezone), checksum: r.canonical_checksum ? asText(r.canonical_checksum) : null, provenance: asText(r.provenance), lockVersion: Number(r.lock_version) });
const workVersionDto     = (r: Row) => ({ id: asText(r.id), workCalendarId: asText(r.work_calendar_id), versionNo: Number(r.version_no), status: asText(r.status), effectiveFrom: asText(r.effective_from), effectiveTo: r.effective_to ? asText(r.effective_to) : null, timezone: asText(r.timezone), workingWeekdays: (r.working_weekdays as number[]) ?? [], weekdayFractions: (r.weekday_fractions as Record<string, number>) ?? {}, holidayCalendarVersionId: asText(r.holiday_calendar_version_id), checksum: r.canonical_checksum ? asText(r.canonical_checksum) : null, provenance: asText(r.provenance), lockVersion: Number(r.lock_version) });
const holidayDateDto     = (r: Row) => ({ id: asText(r.id), holidayDate: asText(r.holiday_date), observedDate: r.observed_date ? asText(r.observed_date) : null, effectiveDate: asText(r.effective_date), dayFraction: Number(r.day_fraction), year: Number(r.year), jurisdiction: asText(r.jurisdiction), nameStatutory: asText(r.name_statutory), nameCommon: asText(r.name_common), holidayType: asText(r.holiday_type), sourceReference: asText(r.source_reference), sourcePublishedDate: asText(r.source_published_date), provenanceNote: asText(r.provenance_note) });
const assignmentDto      = (r: Row) => ({ id: asText(r.id), scope: asText(r.scope), payGroupId: r.pay_group_id ? asText(r.pay_group_id) : null, workCalendarVersionId: asText(r.work_calendar_version_id), effectiveFrom: asText(r.effective_from), effectiveTo: r.effective_to ? asText(r.effective_to) : null, status: asText(r.status) });

// ── Command RPCs ─────────────────────────────────────────────────────────────
export interface WorkCalendarCommand { command: string; requestKey: string; payload: Record<string, unknown>; }

async function callRpc(rpc: string, actorId: string, c: WorkCalendarCommand): Promise<Row> {
  const { data, error } = await sb.rpc(rpc, {
    p_actor_id: actorId, p_command: c.command, p_request_key: c.requestKey, p_payload: c.payload,
  });
  if (error) rpcError(error);
  return (data ?? {}) as Row;
}
export async function holidaySetCommand(actorId: string, c: WorkCalendarCommand) {
  const d = await callRpc('holiday_set_command_tx', actorId, c);
  return { calendar: holidayCalendarDto(d.calendar as Row), version: holidayVersionDto(d.version as Row), ...(d.holiday ? { holiday: holidayDateDto(d.holiday as Row) } : {}) };
}
export async function workCalendarCommand(actorId: string, c: WorkCalendarCommand) {
  const d = await callRpc('work_calendar_command_tx', actorId, c);
  return { calendar: workCalendarDto(d.calendar as Row), version: workVersionDto(d.version as Row) };
}
export async function assignmentCommand(actorId: string, c: WorkCalendarCommand) {
  const d = await callRpc('work_calendar_assign_tx', actorId, c);
  return { assignment: assignmentDto(d.assignment as Row) };
}

export async function resolveWorkCalendar(payGroupId: string, periodStart: string, periodEnd: string): Promise<unknown> {
  const { data, error } = await sb.rpc('work_calendar_resolve', { p_pay_group_id: payGroupId, p_start: periodStart, p_end: periodEnd });
  if (error) rpcError(error);
  return data;
}

// ── Bounded keyset reads ─────────────────────────────────────────────────────
export const MAX_LIMIT = 50;
const clampLimit = (n?: number): number => Math.min(MAX_LIMIT, Math.max(1, Number.isFinite(n) ? Number(n) : 25));

interface Cursor { c: string; i: string; }
function encodeCursor(fp: string, createdAt: string, id: string): string {
  return Buffer.from(JSON.stringify({ fp, c: createdAt, i: id })).toString('base64url');
}
function decodeCursor(cursor: string | undefined, fp: string): Cursor | null {
  if (!cursor) return null;
  let parsed: { fp?: string; c?: string; i?: string };
  try { parsed = JSON.parse(Buffer.from(cursor, 'base64url').toString('utf8')); }
  catch { throw Object.assign(new Error('calendar.bad_cursor'), { status: 422 }); }
  if (parsed.fp !== fp || !parsed.c || !parsed.i) throw Object.assign(new Error('calendar.bad_cursor'), { status: 422 });
  return { c: parsed.c, i: parsed.i };
}
const fingerprint = (parts: unknown): string => createHash('sha256').update(JSON.stringify(parts)).digest('hex').slice(0, 16);
interface Page<T> { items: T[]; nextCursor: string | null; }

async function keysetPage<T>(table: string, fp: string, opts: { cursor?: string; limit?: number; search?: string; searchCol?: string }, map: (r: Row) => T): Promise<Page<T>> {
  const limit = clampLimit(opts.limit);
  const cur = decodeCursor(opts.cursor, fp);
  let q = sb.from(table).select('*').order('created_at', { ascending: false }).order('id', { ascending: false }).limit(limit + 1);
  if (opts.search && opts.searchCol) q = q.ilike(opts.searchCol, `%${opts.search}%`);
  if (cur) q = q.or(`created_at.lt.${cur.c},and(created_at.eq.${cur.c},id.lt.${cur.i})`);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`${table} read: ${error.message}`), { status: 500 });
  const rows = (data ?? []) as Row[];
  const hasMore = rows.length > limit;
  const page = hasMore ? rows.slice(0, limit) : rows;
  const last = page[page.length - 1];
  return { items: page.map(map), nextCursor: hasMore && last ? encodeCursor(fp, asText(last.created_at), asText(last.id)) : null };
}

export const listHolidayCalendars = (o: { cursor?: string; limit?: number; search?: string }) =>
  keysetPage('holiday_calendars', fingerprint(['holiday_cal', o.search ?? '']), { ...o, searchCol: 'name' }, holidayCalendarDto);
export const listWorkCalendars = (o: { cursor?: string; limit?: number; search?: string }) =>
  keysetPage('work_calendars', fingerprint(['work_cal', o.search ?? '']), { ...o, searchCol: 'name' }, workCalendarDto);

export async function getHolidayCalendar(id: string) {
  const { data: cal, error } = await sb.from('holiday_calendars').select('*').eq('id', id).maybeSingle();
  if (error) throw Object.assign(new Error(`getHolidayCalendar: ${error.message}`), { status: 500 });
  if (!cal) throw Object.assign(new Error('calendar.unresolved'), { status: 422 });
  const { data: vers } = await sb.from('holiday_calendar_versions').select('*').eq('holiday_calendar_id', id).order('version_no', { ascending: false });
  return { calendar: holidayCalendarDto(cal as Row), versions: ((vers ?? []) as Row[]).map(holidayVersionDto) };
}
export async function getWorkCalendar(id: string) {
  const { data: cal, error } = await sb.from('work_calendars').select('*').eq('id', id).maybeSingle();
  if (error) throw Object.assign(new Error(`getWorkCalendar: ${error.message}`), { status: 500 });
  if (!cal) throw Object.assign(new Error('calendar.unresolved'), { status: 422 });
  const { data: vers } = await sb.from('work_calendar_versions').select('*').eq('work_calendar_id', id).order('version_no', { ascending: false });
  return { calendar: workCalendarDto(cal as Row), versions: ((vers ?? []) as Row[]).map(workVersionDto) };
}
export async function listHolidays(versionId: string) {
  const { data, error } = await sb.from('holiday_dates').select('*').eq('holiday_calendar_version_id', versionId).order('effective_date', { ascending: true });
  if (error) throw Object.assign(new Error(`listHolidays: ${error.message}`), { status: 500 });
  return { items: ((data ?? []) as Row[]).map(holidayDateDto) };
}
export async function listAssignments(opts: { payGroupId?: string }) {
  let q = sb.from('work_calendar_assignments').select('*, finance_pay_groups(code,name)').order('created_at', { ascending: false }).limit(MAX_LIMIT);
  if (opts.payGroupId) q = q.eq('pay_group_id', opts.payGroupId);
  const { data, error } = await q;
  if (error) throw Object.assign(new Error(`listAssignments: ${error.message}`), { status: 500 });
  return {
    items: ((data ?? []) as Row[]).map(r => {
      const pg = (r.finance_pay_groups as Row) ?? {};
      return { ...assignmentDto(r), payGroupName: pg.name ? asText(pg.name) : null, payGroupCode: pg.code ? asText(pg.code) : null };
    }),
  };
}
