/**
 * src/config/index.ts
 *
 * Single source of truth for all app-wide constants.
 * Values are sourced from the validated env object (see src/lib/env.ts) so a
 * misconfigured deploy fails immediately rather than silently at runtime.
 *
 * IMPORTANT: env.ts is imported first — it throws on missing required vars.
 *
 * @see docs/ARCHITECTURE.md
 * @see docs/CODING_STANDARDS.md
 */

import { env } from '@lib/env';

// ── API ───────────────────────────────────────────────────────────────────────

/** Prefix for all backend calls.  Empty string = same-origin (/api/*). */
export const API_BASE = env.API_BASE;

/** Full prefix used for every fetch call in src/lib/api.ts */
export const API_URL = `${API_BASE}/api`;

// ── Supabase ──────────────────────────────────────────────────────────────────

export const SUPABASE_URL      = env.SUPABASE_URL;
export const SUPABASE_ANON_KEY = env.SUPABASE_ANON_KEY;

// ── App ───────────────────────────────────────────────────────────────────────

export const APP_NAME = import.meta.env.VITE_APP_NAME ?? 'Siomac';

/** localStorage key for the persisted session object */
export const SESSION_KEY = 'siomac_session_v1';

/** IndexedDB database name — must match cache.js during the transition period */
export const IDB_DB_NAME = 'siomac_cache';

// ── Token lifetimes (mirrors server-side constants — kept in sync manually) ───

/** Access token TTL in ms (15 minutes) */
export const ACCESS_TOKEN_TTL_MS = 15 * 60 * 1000;

/** Refresh headroom: refresh the token this many ms before it expires */
export const TOKEN_REFRESH_HEADROOM_MS = 60 * 1000;

// ── Navigation / sections ─────────────────────────────────────────────────────

/** Sidebar accordion groups, in display order (Meridian-style IA). */
export type NavGroup =
  | 'overview'
  | 'workforce'
  | 'operations'
  | 'finance'
  | 'hse'
  | 'administration'
  | 'personal'
  | 'account';

export interface NavGroupDef {
  id:    NavGroup;
  label: string;   // uppercase group header text ('' = no header, render flat)
}

/**
 * Group order + labels for the accordion sidebar. The 'overview' group renders
 * its single item flat (no collapsible header), matching Meridian's pinned
 * Dashboard row. Groups with no items for the current role are skipped.
 */
export const NAV_GROUPS: NavGroupDef[] = [
  { id: 'overview',       label: '' },
  { id: 'workforce',      label: 'Workforce' },
  { id: 'operations',     label: 'Operations' },
  { id: 'finance',        label: 'Finance' },
  { id: 'hse',            label: 'HSE' },
  { id: 'administration', label: 'Administration' },
  { id: 'personal',       label: 'Personal' },
  { id: 'account',        label: 'Account' },
];

export interface SectionDef {
  id:    string;
  label: string;
  icon:  string;   // Font Awesome class, e.g. 'fa-tachometer-alt'
  sub:   string;   // subtitle shown in nav
  group?: NavGroup; // accordion group; defaults applied in nav builder
}

export type UserRole = 'superadmin' | 'admin' | 'manager' | 'employee';

/**
 * Self-service sections EVERY authenticated user gets — the employee baseline.
 * "Admins and managers are also employees": these are prepended to every role's
 * sidebar, so an admin sees their own attendance/leaves/payslips alongside the
 * management sections their role adds.
 */
export const BASELINE_SECTIONS: SectionDef[] = [
  { id: 's-emp-attendance', label: 'My Attendance', icon: 'fa-calendar-check',      sub: "Today's check-in status and work hours",  group: 'personal' },
  { id: 's-emp-history',    label: 'My History',    icon: 'fa-history',             sub: 'Your attendance log for the past 30 days', group: 'personal' },
  { id: 's-emp-leave',      label: 'My Leaves',     icon: 'fa-umbrella-beach',      sub: 'Submit requests and track approval status', group: 'personal' },
  { id: 's-emp-payroll',    label: 'My Payslips',   icon: 'fa-file-invoice-dollar', sub: 'View and print your approved payslips',     group: 'personal' },
];

// Per-role ADDITIONAL sections (stacked on top of BASELINE_SECTIONS). A custom
// role not listed here gets only the baseline + whatever its modules grant.
export const SECTION_DEFS: Record<UserRole, SectionDef[]> = {
  employee: [],   // employee is the pure baseline — no extra sections
  manager: [
    { id: 's-adm-dashboard',  label: 'Dashboard',    icon: 'fa-tachometer-alt',      sub: "What's happening across the company right now", group: 'overview' },
    { id: 's-adm-employees',  label: 'Employees',    icon: 'fa-users',               sub: 'View the workforce',                            group: 'workforce' },
    { id: 's-adm-attendance', label: 'Attendance',   icon: 'fa-calendar-check',      sub: 'Full daily log — filter by month, dept or status', group: 'workforce' },
    { id: 's-adm-projects',   label: 'Project Sites',icon: 'fa-map-marker-alt',      sub: 'Field locations and site details',              group: 'operations' },
    { id: 's-projectMap',     label: 'Live Map',     icon: 'fa-map-marked-alt',      sub: 'Live positions of everyone currently clocked in', group: 'operations' },
    { id: 's-hse',            label: 'HSE',          icon: 'fa-hard-hat',            sub: 'Health, Safety & Environment — incidents and PPE', group: 'hse' },
  ],
  admin: [
    { id: 's-adm-dashboard',   label: 'Dashboard',    icon: 'fa-tachometer-alt',      sub: "What's happening across the company right now", group: 'overview' },
    { id: 's-adm-employees',   label: 'Employees',    icon: 'fa-users',               sub: 'Add, edit and manage the workforce',            group: 'workforce' },
    { id: 's-adm-attendance',  label: 'Attendance',   icon: 'fa-calendar-check',      sub: 'Full daily log — filter by month, dept or status', group: 'workforce' },
    { id: 's-adm-leaves',      label: 'Leaves',       icon: 'fa-umbrella-beach',      sub: 'Approve, reject or flag leave applications',    group: 'workforce' },
    { id: 's-adm-projects',    label: 'Project Sites',icon: 'fa-map-marker-alt',      sub: 'Field locations, boundaries and site details',  group: 'operations' },
    { id: 's-projectMap',      label: 'Live Map',     icon: 'fa-map-marked-alt',      sub: 'Live positions of everyone currently clocked in', group: 'operations' },
    { id: 's-adm-rates',       label: 'Hourly Rates', icon: 'fa-money-bill-wave',     sub: 'Per-employee and per-department pay configuration', group: 'finance' },
    { id: 's-payroll',         label: 'Payroll',      icon: 'fa-file-invoice-dollar', sub: 'Hours worked, rates applied and export-ready reports', group: 'finance' },
    { id: 's-hse',             label: 'HSE',          icon: 'fa-hard-hat',            sub: 'Health, Safety & Environment — incidents and PPE', group: 'hse' },
  ],
  // Superadmin has the same nav as admin — permission management is via a
  // dedicated settings panel, not a separate section.
  superadmin: [
    { id: 's-adm-dashboard',   label: 'Dashboard',    icon: 'fa-tachometer-alt',      sub: "What's happening across the company right now", group: 'overview' },
    { id: 's-adm-employees',   label: 'Employees',    icon: 'fa-users',               sub: 'Add, edit and manage the workforce',            group: 'workforce' },
    { id: 's-adm-departments', label: 'Departments',  icon: 'fa-building',            sub: 'Structure your organisation and assign leads',  group: 'workforce' },
    { id: 's-adm-attendance',  label: 'Attendance',   icon: 'fa-calendar-check',      sub: 'Full daily log — filter by month, dept or status', group: 'workforce' },
    { id: 's-adm-leaves',      label: 'Leaves',       icon: 'fa-umbrella-beach',      sub: 'Approve, reject or flag leave applications',    group: 'workforce' },
    { id: 's-adm-projects',    label: 'Project Sites',icon: 'fa-map-marker-alt',      sub: 'Field locations, boundaries and site details',  group: 'operations' },
    { id: 's-projectMap',      label: 'Live Map',     icon: 'fa-map-marked-alt',      sub: 'Live positions of everyone currently clocked in', group: 'operations' },
    { id: 's-adm-rates',       label: 'Hourly Rates', icon: 'fa-money-bill-wave',     sub: 'Per-employee and per-department pay configuration', group: 'finance' },
    { id: 's-payroll',         label: 'Payroll',      icon: 'fa-file-invoice-dollar', sub: 'Hours worked, rates applied and export-ready reports', group: 'finance' },
    { id: 's-hse',             label: 'HSE',          icon: 'fa-hard-hat',            sub: 'Health, Safety & Environment — incidents and PPE', group: 'hse' },
    { id: 's-superadmin-console', label: 'Console',   icon: 'fa-shield-halved',       sub: 'Modules, permissions and administration tools', group: 'administration' },
  ],
};

export const COMMON_SECTIONS: SectionDef[] = [
  { id: 's-profile',  label: 'My Profile', icon: 'fa-user-circle', sub: 'Your account details, photo and contact info', group: 'account' },
  { id: 's-settings', label: 'Settings',   icon: 'fa-palette',     sub: 'Themes, layout, security and company branding', group: 'account' },
  { id: 's-about',    label: 'About',      icon: 'fa-info-circle', sub: 'Version, credits and system information',      group: 'account' },
];

// ── Theming ───────────────────────────────────────────────────────────────────

export interface Palette {
  id:      string;
  name:    string;
  primary: string;
  dark:    string;
  light:   string;
  accent:  string;
  hover:   string;
}

export const PALETTES: Palette[] = [
  { id: 'navy',    name: 'Navy Blue',     primary: '#001f3f', dark: '#001529', light: '#003366', accent: '#0074D9', hover: '#002a52' },
  { id: 'royal',   name: 'Royal Purple',  primary: '#3a0ca3', dark: '#22075a', light: '#5b21b6', accent: '#7209b7', hover: '#2d0880' },
  { id: 'forest',  name: 'Forest Green',  primary: '#1a4d2e', dark: '#0d2e1a', light: '#2d6a4f', accent: '#52b788', hover: '#143d24' },
  { id: 'sunset',  name: 'Sunset Orange', primary: '#bf3a00', dark: '#7d2500', light: '#e85d04', accent: '#ff7e30', hover: '#992e00' },
  { id: 'crimson', name: 'Crimson Red',   primary: '#7d0000', dark: '#4d0000', light: '#a30000', accent: '#d40000', hover: '#5a0000' },
  { id: 'slate',   name: 'Slate Dark',    primary: '#1f2937', dark: '#111827', light: '#374151', accent: '#6b7280', hover: '#0f172a' },
  { id: 'ocean',   name: 'Ocean Teal',    primary: '#003049', dark: '#001d2e', light: '#005f73', accent: '#00afb9', hover: '#002337' },
  { id: 'rose',    name: 'Rose Pink',     primary: '#7d2c5c', dark: '#4d1837', light: '#a83a72', accent: '#e91e63', hover: '#5e1f44' },
];

export interface LayoutOption {
  id:   string;
  name: string;
  desc: string;
  icon: string;
}

export const LAYOUTS: LayoutOption[] = [
  { id: 'sidebar', name: 'Sidebar',   desc: 'Vertical menu on left',  icon: 'fa-bars' },
  { id: 'tabs',    name: 'Top Tabs',  desc: 'Horizontal tabs on top', icon: 'fa-grip-lines' },
];

export type LayoutMode  = 'sidebar' | 'tabs';
export type ColorScheme = 'navy' | 'royal' | 'forest' | 'sunset' | 'crimson' | 'slate' | 'ocean' | 'rose';
export type Theme       = 'light' | 'dark';

// ── window.SiomacConfig shim ──────────────────────────────────────────────────
// Registers the config object on window so legacy scripts (nav.js, app.js) that
// read `window.SiomacConfig` keep working unchanged during the transition.
// The shape matches what config.js previously set: { SECTION_DEFS, COMMON_ITEMS, PALETTES, LAYOUTS }.
(window as unknown as Record<string, unknown>)['SiomacConfig'] = {
  SECTION_DEFS,
  BASELINE_SECTIONS,               // self-service sections every role gets
  COMMON_ITEMS: COMMON_SECTIONS,   // legacy name was COMMON_ITEMS
  NAV_GROUPS,                      // accordion group order + labels (H)
  PALETTES,
  LAYOUTS,
};
