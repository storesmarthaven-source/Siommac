/**
 * types/supabase.ts
 *
 * Supabase database type definitions for the typed client.
 *
 * This file provides the `Database` generic used by the Supabase client in
 * src/lib/supabase.ts. It mirrors the database schema and gives
 * `supabase.from('table').select()` full column-level type inference.
 *
 * HOW TO KEEP IN SYNC:
 *   Ideally, generate this file with the Supabase CLI:
 *     npx supabase gen types typescript --project-id <id> > types/supabase.ts
 *
 *   Until CLI access is set up, this hand-maintained file tracks types/db.ts
 *   which is the source of truth for the DB schema.
 *
 * NOTE: Row types reuse interfaces from types/db.ts rather than duplicating
 * them, keeping a single source of truth.
 *
 * @see docs/ARCHITECTURE.md §Supabase
 * @see docs/CODING_STANDARDS.md
 * @see docs/PHASE_PLAN.md §Phase-2a
 */

import type {
  AppUser, Attendance, Department, ProjectSite, ProjectSiteEmployee,
  LeaveRequest, PayrollRun, PayrollEntry, HourlyRate, Setting,
  ActivityLog, Message, Ticket, Notification, NotificationPreference,
} from './db';

// ── Supabase Database generic ─────────────────────────────────────────────────

/**
 * The `Database` type is the root generic passed to `createClient<Database>`.
 * Each table is listed under `public.Tables` with `Row`, `Insert`, and `Update`
 * shapes. `Row` is what SELECT returns; `Insert` / `Update` omit generated cols.
 */
export interface Database {
  public: {
    Tables: {
      users: {
        Row:    AppUser;
        Insert: Omit<AppUser, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<AppUser, 'id' | 'created_at'>>;
      };
      attendance: {
        Row:    Attendance;
        Insert: Omit<Attendance, 'id'>;
        Update: Partial<Omit<Attendance, 'id'>>;
      };
      departments: {
        Row:    Department;
        Insert: Omit<Department, 'id' | 'created_at'>;
        Update: Partial<Omit<Department, 'id' | 'created_at'>>;
      };
      project_sites: {
        Row:    ProjectSite;
        Insert: Omit<ProjectSite, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<ProjectSite, 'id' | 'created_at'>>;
      };
      project_site_employees: {
        Row:    ProjectSiteEmployee;
        Insert: Omit<ProjectSiteEmployee, 'assigned_at'>;
        Update: Partial<ProjectSiteEmployee>;
      };
      leave_requests: {
        Row:    LeaveRequest;
        Insert: Omit<LeaveRequest, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<LeaveRequest, 'id' | 'created_at'>>;
      };
      payroll_runs: {
        Row:    PayrollRun;
        Insert: Omit<PayrollRun, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<PayrollRun, 'id' | 'created_at'>>;
      };
      payroll_entries: {
        Row:    PayrollEntry;
        Insert: Omit<PayrollEntry, 'id' | 'created_at'>;
        Update: Partial<Omit<PayrollEntry, 'id' | 'created_at'>>;
      };
      hourly_rates: {
        Row:    HourlyRate;
        Insert: Omit<HourlyRate, 'id' | 'created_at'>;
        Update: Partial<Omit<HourlyRate, 'id' | 'created_at'>>;
      };
      settings: {
        Row:    Setting;
        Insert: Setting;
        Update: Partial<Setting>;
      };
      activity_logs: {
        Row:    ActivityLog;
        Insert: Omit<ActivityLog, 'id' | 'created_at'>;
        Update: never;  // logs are immutable
      };
      messages: {
        Row:    Message;
        Insert: Omit<Message, 'id' | 'created_at'>;
        Update: Pick<Message, 'is_read'>;
      };
      support_tickets: {
        Row:    Ticket;
        Insert: Omit<Ticket, 'id' | 'created_at' | 'updated_at'>;
        Update: Partial<Omit<Ticket, 'id' | 'created_at'>>;
      };
      notifications: {
        Row:    Notification;
        Insert: Omit<Notification, 'id' | 'created_at'>;
        Update: Pick<Notification, 'is_read'>;
      };
      notification_preferences: {
        Row:    NotificationPreference;
        Insert: NotificationPreference;
        Update: Partial<NotificationPreference>;
      };
    };
    Views:     Record<string, never>;
    Functions: Record<string, never>;
    Enums:     Record<string, never>;
  };
}

// ── Convenience row-type extractors ──────────────────────────────────────────

type Tables = Database['public']['Tables'];

/** Extract the Row type for a given table name. */
export type TableRow<T extends keyof Tables> = Tables[T]['Row'];

/** Extract the Insert type for a given table name. */
export type TableInsert<T extends keyof Tables> = Tables[T]['Insert'];

/** Extract the Update type for a given table name. */
export type TableUpdate<T extends keyof Tables> = Tables[T]['Update'];
