/**
 * src/components/sections/Settings/settingsNav.ts
 *
 * Settings navigation model + the sidebar-menu HTML that is swapped INTO the real
 * Siomac sidebar while Settings is active. Page titles/descriptions are ported
 * from the "Enterprise Clean v5" design. Groups + order match the design; the
 * Security page is added (kept from the existing 2FA/passkeys panel).
 */

import { navIconSvg } from '@/components/nav/navIcons';

export type SwzPageKind = 'catalog' | 'myprefs' | 'critical' | 'manifests' | 'legacy' | 'console' | 'placeholder';
export type SwzLegacy = 'company' | 'attendance' | 'layout' | 'security';

export interface SwzPage {
  page: string;          // data-stg-page id + breadcrumb leaf key
  label: string;
  faIcon: string;        // sidebar Font-Awesome icon
  iconKey: string;       // top-panel Lucide icon key (swzIcons)
  group: string;         // nav group label
  kind: SwzPageKind;
  moduleKey?: string;    // kind 'catalog'
  legacy?: SwzLegacy;    // kind 'legacy'
  title: string;
  desc: string;
  adminOnly?: boolean;
  superOnly?: boolean;
}

export const SWZ_PAGES: SwzPage[] = [
  // ── My Settings (all roles) ──
  { page: 'my-preferences', label: 'My Preferences', faIcon: 'fa-user', iconKey: 'USER', group: 'My Settings', kind: 'myprefs',
    title: 'My Preferences', desc: 'Personalize appearance, notifications, messages, dashboard widgets, and date/time formats for your workspace.' },
  { page: 'security', label: 'Security & Privacy', faIcon: 'fa-shield-halved', iconKey: 'SHIELD', group: 'My Settings', kind: 'legacy', legacy: 'security',
    title: 'Security & Privacy', desc: 'Two-factor authentication, passkeys, trusted devices, and session timeout for your account.' },

  // ── General (admin) ──
  { page: 'company-branding', label: 'Company & Branding', faIcon: 'fa-building', iconKey: 'BUILDING', group: 'General', kind: 'legacy', legacy: 'company', adminOnly: true,
    title: 'Company & Branding', desc: 'Control company profile, brand marks, legal display name, and default identity shown across SIOMAC.' },
  { page: 'attendance-rules', label: 'Attendance Rules', faIcon: 'fa-clock', iconKey: 'CLOCK', group: 'General', kind: 'placeholder', adminOnly: true,
    title: 'Attendance Rules', desc: 'Configure attendance thresholds, location requirements, exception review, and overtime policy.' },
  { page: 'layout-navigation', label: 'Layout & Navigation', faIcon: 'fa-table-columns', iconKey: 'LAYOUT', group: 'General', kind: 'placeholder', adminOnly: true,
    title: 'Layout & Navigation', desc: 'Control navigation behavior, dashboard layout, sidebar grouping, and module visibility defaults.' },

  // ── Module Policy (admin) ──
  { page: 'employee-master', label: 'Employee Master', faIcon: 'fa-id-badge', iconKey: 'PEOPLE', group: 'Module Policy', kind: 'catalog', moduleKey: 'employees', adminOnly: true,
    title: 'Employee Master', desc: 'Control employee creation, assignment rules, workflow approvals, statutory profile, documents, and workforce risk behavior.' },
  { page: 'training', label: 'Training', faIcon: 'fa-graduation-cap', iconKey: 'GRAD', group: 'Module Policy', kind: 'catalog', moduleKey: 'training', adminOnly: true,
    title: 'Training & Competency', desc: 'Control renewal windows, validation, workflow behavior, notifications, and safety-critical competency rules.' },
  { page: 'permit-to-work', label: 'Permit to Work', faIcon: 'fa-clipboard-check', iconKey: 'PERMIT', group: 'Module Policy', kind: 'catalog', moduleKey: 'ptw', adminOnly: true,
    title: 'Permit to Work', desc: 'Configure permit validation, JSA dependency, approvals, closeout, extensions, and safety-critical permit rules.' },
  { page: 'sds-chemicals', label: 'SDS / Chemicals', faIcon: 'fa-flask', iconKey: 'FLASK', group: 'Module Policy', kind: 'catalog', moduleKey: 'sds', adminOnly: true,
    title: 'SDS / Chemicals', desc: 'Control SDS registration, chemical restrictions, expiry review, hazard classification, and work-blocking behavior.' },
  { page: 'incidents-investigations', label: 'Incidents · Investigations', faIcon: 'fa-triangle-exclamation', iconKey: 'ALERT', group: 'Module Policy', kind: 'catalog', moduleKey: 'incidents', adminOnly: true,
    title: 'Incidents · Investigations', desc: 'Control incident reporting, classification, investigation triggers, evidence rules, and escalation behavior.' },
  { page: 'capa-jsa-inspections', label: 'CAPA · JSA · Inspections', faIcon: 'fa-list-check', iconKey: 'SHIELD', group: 'Module Policy', kind: 'catalog', moduleKey: 'capa_jsa_inspections', adminOnly: true,
    title: 'CAPA · JSA · Inspections', desc: 'Control corrective action closure, JSA risk controls, inspection findings, and safety validation rules.' },
  { page: 'documents-ppe', label: 'Documents · PPE', faIcon: 'fa-folder-open', iconKey: 'BOX', group: 'Module Policy', kind: 'catalog', moduleKey: 'documents_ppe', adminOnly: true,
    title: 'Documents · PPE', desc: 'Control controlled documents, acknowledgements, revision rules, PPE requirements, and evidence handling.' },

  // ── Platform Policy (admin) ──
  { page: 'notifications-delivery', label: 'Notifications', faIcon: 'fa-bell', iconKey: 'BELL', group: 'Platform Policy', kind: 'catalog', moduleKey: 'notifications', adminOnly: true,
    title: 'Notifications Delivery', desc: 'Control notification delivery, required notifications, digests, quiet hours, and escalations.' },
  { page: 'messages-delivery', label: 'Messages', faIcon: 'fa-comments', iconKey: 'MSG', group: 'Platform Policy', kind: 'catalog', moduleKey: 'messages', adminOnly: true,
    title: 'Messages Delivery', desc: 'Control message delivery classes, participant rules, attachments, read receipts, and retention.' },
  { page: 'files-evidence', label: 'Files / Evidence', faIcon: 'fa-file-shield', iconKey: 'FILE', group: 'Platform Policy', kind: 'catalog', moduleKey: 'files', adminOnly: true,
    title: 'Files / Evidence', desc: 'Control file storage, signed URLs, private buckets, evidence requirements, scan rules, and audit behavior.' },
  { page: 'workflow', label: 'Workflow', faIcon: 'fa-diagram-project', iconKey: 'FLOW', group: 'Platform Policy', kind: 'catalog', moduleKey: 'workflow', adminOnly: true,
    title: 'Workflow', desc: 'Control approval behavior, task assignment, returns, rejections, escalations, and handoffs.' },
  { page: 'system', label: 'System', faIcon: 'fa-gear', iconKey: 'GEAR', group: 'Platform Policy', kind: 'catalog', moduleKey: 'system', adminOnly: true,
    title: 'System', desc: 'Control default timezone, date formats, security behavior, audit defaults, and platform-level policies.' },

  // ── Governance (admin) ──
  { page: 'critical-governance', label: 'Critical Governance', faIcon: 'fa-lock', iconKey: 'LOCK', group: 'Governance', kind: 'critical', adminOnly: true,
    title: 'Critical Governance', desc: 'Review settings that affect safety, security, audit, workflow, and compliance controls.' },
  { page: 'manifest-review', label: 'Manifest Review', faIcon: 'fa-clipboard-list', iconKey: 'CHECK', group: 'Governance', kind: 'manifests', adminOnly: true,
    title: 'Manifest Review', desc: 'Approve module settings manifests before modules are marked complete.' },

  // ── Administration (superadmin) ──
  // Roles / Modules / Permissions / Approvals / Sessions / Audit Log MOVED OUT to the
  // top-level "Access Control" section (src/components/sections/AccessControl). Only the
  // non-RBAC security tooling stays under Settings.
  { page: 'user-security', label: 'User Security', faIcon: 'fa-user-shield', iconKey: 'SHIELD', group: 'Administration', kind: 'console', superOnly: true,
    title: 'User Security', desc: 'Inspect and manage authentication factors for individual users. Revoke passkeys or trusted devices (requires step-up verification).' },
  { page: 'security-policy', label: 'Security Policy', faIcon: 'fa-shield-halved', iconKey: 'SHIELD', group: 'Administration', kind: 'console', superOnly: true,
    title: 'Security Policy', desc: 'Organisation-wide authentication policy — MFA requirements, password rules, session timeout, and lockout policy.' },
  { page: 'ui-kit', label: 'UI Kit', faIcon: 'fa-palette', iconKey: 'GEAR', group: 'Administration', kind: 'console', superOnly: true,
    title: 'UI Kit', desc: 'The living catalog of the Siomac design system — every shared @ui component with all its variants.' },
];

export const SWZ_GROUP_ORDER = ['My Settings', 'General', 'Module Policy', 'Platform Policy', 'Governance', 'Administration'];

export function getSwzPage(page: string): SwzPage | undefined {
  return SWZ_PAGES.find(p => p.page === page);
}

/** Pages visible to the current actor. */
export function visibleSwzPages(isAdmin: boolean, isSuper: boolean): SwzPage[] {
  return SWZ_PAGES.filter(p => (p.superOnly ? isSuper : p.adminOnly ? isAdmin : true));
}

const escAttr = (s: string) => s.replace(/"/g, '&quot;');

/**
 * Build the sidebar-menu innerHTML swapped into #sidebarMenu for Settings:
 * a mode header (Back + "Settings"), then each group as a rounded container with
 * a larger label and its items nested inside.
 */
export function buildSettingsMenuHtml(isAdmin: boolean, isSuper: boolean, activePage: string): string {
  const pages = visibleSwzPages(isAdmin, isSuper);
  let html =
    '<li class="stg-mode-head">'
    + '<button type="button" class="stg-back" data-stg-exit title="Back to app" aria-label="Back to app">' + navIconSvg('fa-arrow-left') + '</button>'
    + '<span class="stg-mode-title">Settings</span>'
    + '</li>';
  // Groups reuse the app's own accordion classes (.sb-group / .sb-group-header /
  // .sb-group-items) so the headers + sub-items match the main navigation exactly.
  for (const group of SWZ_GROUP_ORDER) {
    const items = pages.filter(p => p.group === group);
    if (!items.length) continue;
    html += '<li class="sb-group open" data-stg-group>'
      + '<button type="button" class="sb-group-header" data-stg-group-toggle aria-expanded="true">'
      + `<span class="sb-group-label">${group}</span>`
      + `<span class="sb-group-count">${items.length}</span>`
      + '<i class="fas fa-chevron-down sb-group-chevron"></i>'
      + '</button>'
      + '<ul class="sb-group-items">';
    for (const p of items) {
      html += `<li><button type="button" data-stg-page="${escAttr(p.page)}"${p.page === activePage ? ' class="active"' : ''} title="${escAttr(p.label)}">`
        + `${navIconSvg(p.faIcon)}<span>${p.label}</span></button></li>`;
    }
    html += '</ul></li>';
  }
  return html;
}
