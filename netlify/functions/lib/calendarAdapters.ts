/**
 * netlify/functions/lib/calendarAdapters.ts
 *
 * Source adapters: project module-owned DEADLINES into CalendarItemDTO at read
 * time. Deadlines are NEVER copied into calendar_entries — each module stays the
 * single source of truth; the adapter reads its real rows, scoped to what the
 * user may see, and returns read-only DTO projections with a valid drill-through.
 *
 * Calendar access never grants SOURCE access: an adapter includes a module's
 * deadlines only when the caller holds that module's view capability (or is the
 * assignee), and the drill-through opens the source record — which re-checks the
 * source module's own permissions.
 *
 * Phase 1 adapters: Finance/Statutory remittances, HR/Onboarding task due dates.
 */

import { sb } from './db';
import type { CalendarItemDTO, CalendarSourceDepartment, CalendarSourcePriority, CalendarTaskStatus } from '../../../types/calendar';

export interface AdapterContext {
  userId:  string;
  /** Effective-permission check (already superadmin-aware, no throw). */
  can:     (key: string) => boolean;
  fromKey: string;   // inclusive 'YYYY-MM-DD'
  toKey:   string;   // inclusive 'YYYY-MM-DD'
}

const MONTHS = ['January','February','March','April','May','June','July','August','September','October','November','December'];

/** Base read-only deadline projection with the capability flags a deadline carries. */
function deadline(partial: Partial<CalendarItemDTO> & Pick<CalendarItemDTO, 'id' | 'title' | 'sourceModule' | 'sourceRef' | 'sourceRoute'>): CalendarItemDTO {
  return {
    type:               'deadline',
    origin:             'module',
    notes:              null,
    allDay:             true,
    startsOn:           null,
    endsOn:             null,
    startsAt:           null,
    endsAt:             null,
    status:             null,
    priority:           null,
    ownerUserId:        null,
    ownerName:          null,
    assigneeUserId:     null,
    assigneeName:       null,
    departmentId:       null,
    departmentName:     null,
    attendeeCount:      0,
    visibility:         'org',
    sourceLabel:        null,
    sourceDepartment:   null,
    sourceDepartmentLabel: null,
    recurrenceSeriesId: null,
    recurrenceRule:     null,
    occurrenceDate:     null,
    // Deadlines are read-only in the calendar; you act on the SOURCE record.
    editable:           false,
    completable:        false,
    assignable:         false,
    cancelable:         false,
    drillThrough:       true,
    ...partial,
  };
}

// ── Finance / Statutory remittances ─────────────────────────────────────────

interface RemittanceRow {
  id: string; remittance_no: string; authority: string;
  period_year: number; period_month: number;
  total_due: number; currency: string; status: string; due_date: string | null;
}

const AUTHORITY_LABEL: Record<string, string> = {
  paye_bir:         'PAYE / BIR',
  nis_nibtt:        'NIS / NIBTT',
  health_surcharge: 'Health Surcharge',
};

const DEPARTMENT_META: Record<string, { key: CalendarSourceDepartment; label: string }> = {
  hr:         { key: 'human_resource', label: 'Human Resource' },
  onboarding: { key: 'human_resource', label: 'Human Resource' },
  payroll:    { key: 'payroll', label: 'Payroll' },
  hse:        { key: 'hse', label: 'HSE' },
  it:         { key: 'it', label: 'IT' },
  supervisor: { key: 'operations', label: 'Operations' },
  operations: { key: 'operations', label: 'Operations' },
};

/** Remittance lifecycle → the DTO's task-style status (for the UI's done/overdue cues). */
function remittanceStatus(s: string): CalendarTaskStatus {
  if (s === 'paid' || s === 'filed') return 'done';
  if (s === 'submitted' || s === 'approved') return 'in_progress';
  return 'not_started';
}

export async function financeStatutoryDeadlines(ctx: AdapterContext): Promise<CalendarItemDTO[]> {
  // Gate: only finance users who may view the statutory/remittance surface.
  if (!ctx.can('finance.statutory.view') && !ctx.can('finance.statutory.reports.view')) return [];

  const { data, error } = await sb
    .from('finance_remittances')
    .select('id, remittance_no, authority, period_year, period_month, total_due, currency, status, due_date')
    .not('due_date', 'is', null)
    .gte('due_date', ctx.fromKey)
    .lte('due_date', ctx.toKey)
    .neq('status', 'cancelled')
    .order('due_date', { ascending: true });
  if (error) { console.error('[calendar/adapter finance] ', error.message); return []; }

  return (data ?? []).map((r: RemittanceRow) => {
    const monthName = MONTHS[(r.period_month - 1)] ?? '';
    const label = AUTHORITY_LABEL[r.authority] ?? r.authority;
    return deadline({
      id:           `finance:${r.id}`,
      title:        `${label} Remittance — ${monthName} ${r.period_year}`,
      sourceModule: 'finance',
      sourceRef:    r.id,
      sourceRoute:  's-finance-remittances',
      sourceLabel:  'Finance',
      sourceDepartment: 'finance',
      sourceDepartmentLabel: 'Finance',
      startsOn:     r.due_date,
      status:       remittanceStatus(r.status),
      notes:        `${r.currency} ${Number(r.total_due).toLocaleString('en-US', { minimumFractionDigits: 2 })} due to ${label}.`,
    });
  });
}

// ── HR / Onboarding task due dates ──────────────────────────────────────────

interface OnboardingTaskRow {
  id: string; task_title: string; assigned_to: string | null;
  status: string; due_at: string | null; case_id: string; priority: CalendarSourcePriority | null;
  owner_role: string | null; module_key: string | null; requires_evidence: boolean; is_blocking: boolean;
  metadata: Record<string, unknown> | null;
}

function onboardingStatus(s: string): CalendarTaskStatus {
  // Onboarding task statuses map 1:1 onto the calendar task lifecycle.
  if (s === 'completed')   return 'done';
  if (s === 'skipped')     return 'cancelled';
  if (s === 'blocked')     return 'blocked';
  if (s === 'in_progress') return 'in_progress';
  return 'not_started';   // 'pending'
}

export async function hrOnboardingDeadlines(ctx: AdapterContext): Promise<CalendarItemDTO[]> {
  const canAll = ctx.can('hr.onboarding.view');
  // Without the module view, a user still sees onboarding tasks assigned to them.
  // A plain employee with only calendar.view + no assigned tasks gets nothing.
  let q = sb
    .from('hr_onboarding_tasks')
    .select('id, task_title, assigned_to, status, due_at, case_id, priority, owner_role, module_key, requires_evidence, is_blocking, metadata')
    .not('due_at', 'is', null)
    .gte('due_at', `${ctx.fromKey}T00:00:00`)
    .lte('due_at', `${ctx.toKey}T23:59:59.999`)
    .order('due_at', { ascending: true });
  if (!canAll) q = q.eq('assigned_to', ctx.userId);

  const { data, error } = await q;
  if (error) { console.error('[calendar/adapter onboarding] ', error.message); return []; }

  return (data ?? []).map((t: OnboardingTaskRow) => {
    const owner = t.owner_role ? `${t.owner_role.slice(0, 1).toUpperCase()}${t.owner_role.slice(1)}` : 'HR';
    const module = t.module_key ? t.module_key.replaceAll('_', ' ') : 'onboarding';
    const department = DEPARTMENT_META[t.module_key ?? ''] ?? DEPARTMENT_META[t.owner_role ?? ''] ?? DEPARTMENT_META.hr;
    const evidence = t.requires_evidence ? ' Evidence is required before completion.' : '';
    const blocker = t.is_blocking ? ' This is a readiness-blocking control.' : '';
    const seededNote = typeof t.metadata?.['calendarNote'] === 'string' ? t.metadata['calendarNote'] : null;
    return deadline({
      id:             `hr_onboarding:${t.id}`,
      title:          t.task_title,
      sourceModule:   'hr',
      sourceRef:      t.id,
      sourceRoute:    's-hr',
      sourceLabel:    department.label,
      sourceDepartment: department.key,
      sourceDepartmentLabel: department.label,
      startsOn:       t.due_at ? t.due_at.slice(0, 10) : null,
      status:         onboardingStatus(t.status),
      assigneeUserId: t.assigned_to,
      sourcePriority: t.priority,
      notes:          seededNote ?? `${owner} owns this ${module} onboarding control.${evidence}${blocker}`,
    });
  });
}

// ── Registry ────────────────────────────────────────────────────────────────

export type DeadlineAdapter = (ctx: AdapterContext) => Promise<CalendarItemDTO[]>;

/** Adapters keyed by their sourceModule tag (for the ?sourceModules filter). */
export const DEADLINE_ADAPTERS: Record<string, DeadlineAdapter> = {
  finance: financeStatutoryDeadlines,
  hr:      hrOnboardingDeadlines,
};
