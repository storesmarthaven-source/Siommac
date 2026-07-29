/**
 * src/components/sections/HR/EmployeeProfilePage.tsx
 *
 * HR ▸ Employee Master — the FULL employee record, rebuilt to emit the DOM of the
 * LOCKED reference `docs/mockups/employee-profile-full-page.html`.
 *
 * This is a REPLACEMENT, not an adaptation. The superseded page composed the @ui
 * primitives (PageHeader / Pill / LucideIcon / EmptyState) into a structure the
 * approved reference does not have, and derived readiness, attention and document
 * health in the browser from whatever queries happened to be loaded. Both are
 * gone: every class name below is the reference's own, scoped under `.epf-root`
 * by the generated stylesheet, and every number comes from the authorised
 * contract that computes it.
 *
 * STYLING — two stylesheets, one job each:
 *   EmployeeProfilePage.mockup.css  generated verbatim from the locked reference;
 *                                   owns every content style. Never hand-edited.
 *   EmployeeProfilePage.chrome.css  what a static page cannot carry: the root
 *                                   type scale the dropped `body` rule held, the
 *                                   dialog centring layer, the loading/empty/
 *                                   error states, and the DERIVED dark palette.
 *
 * DARK MODE is derived from the approved drawer treatment (the full-page
 * reference carries none) and changes tokens only — never layout.
 *
 * DATA — the shell opens the page; every large dataset is tab-scoped and loads
 * only when its tab is selected.
 */

import { type ComponentChildren, type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import {
  useEmployeeProfileShell, useEmployeeAttention, tabIndicatorFor,
  type EmployeeAttentionItem, type ProfileTabKey,
} from '@api/hr/employeeProfile';
import {
  useEmployeeAccessAssignments, useEmployeeDocumentHealth, useEmploymentDetail,
  useReadinessMatrix, type ReadinessControlMatrixEntry,
} from '@api/hr/employeeReadiness';
import { useEmployeeAccountSupportRequests } from '@api/hr/employeeAccountSupport';
import { useHrAudit, useHrEmployee, type HrAuditEntry } from '@api/hr/employees';
import { useAdminUserSecurityStatus } from '@api/security';
import { useOffboardingCase, useOffboardingCases } from '@api/hr/offboarding';
import { showSection } from '@components/nav/navCore';
import {
  DASH, FULL_PAGE_TABS, TAB_LABEL, formatArrangementAndFte, formatDate, formatDateTime,
  formatNoticePeriod, formatTenure, formatWeeklyHours, identitySubtitle, probationState,
  readinessExplanation, readinessHeadline, readinessLabel, attentionSubtitle,
  severityToneClass, tabAriaLabel, titleCase, visibleTabs,
} from './employeeProfileModel';
import {
  ACTIVITY_AREA_LABEL, ACTIVITY_RANGES, DOCUMENT_STATE_BADGE, DOCUMENT_STATUS_FILTERS,
  EMPTY_ACTIVITY_FILTERS, EMPTY_DOCUMENT_FILTERS, activityArea, activityTitle, auditActors,
  changesThisMonth, coverageSentence, documentCategories, documentHealthBand,
  documentHealthScore, documentRowAction, documentRows, filterAuditRows, filterDocumentRows,
  healthBarTracks,
  hasActivityFilters, hasDocumentFilters, offboardingPhase, offboardingTaskBadge,
  readinessBlockers, readinessMatrixBadge, readinessRailLabel, readinessRailState,
  readinessWorkStateBadge, supportStatusBadge, taskCompletion,
  type ActivityArea, type ActivityFilters, type ActivityRange,
  type DocumentFilters, type DocumentStatusFilter,
} from './profile/employeeProfilePageModel';
import { PageIcon, ProfilePageIconSprite, type ProfilePageIconId } from './profile/ProfilePageIconSprite';
import {
  AccountAssistanceDialog, AccountRequestHistoryDialog, ActivityChangeDialog, AddDocumentDialog,
  EditEmployeeDialog, ExportAuditDialog, ExportIndexDialog, ReadinessReviewDialog,
  RequestChangeDialog, StartOffboardingDialog,
} from './profile/EmployeeProfileDialogs';
import type { EmployeeMasterAccess } from './employeeMasterAccess';
import './EmployeeProfilePage.mockup.css';
import './EmployeeProfilePage.chrome.css';

export interface EmployeeProfilePageProps {
  employeeId: string;
  access: EmployeeMasterAccess;
  onBack: () => void;
}

/** Which dialog is open. The page owns all ten; none is routed elsewhere. */
type OpenDialog =
  | { kind: 'edit' }
  | { kind: 'request-change' }
  | { kind: 'add-document' }
  | { kind: 'export-index' }
  | { kind: 'export-audit' }
  | { kind: 'account-assistance' }
  | { kind: 'account-history' }
  | { kind: 'start-offboarding' }
  | { kind: 'readiness'; entry: ReadinessControlMatrixEntry }
  | { kind: 'activity'; entry: HrAuditEntry };

/** Attention domain → the reference's icon for that row. */
const DOMAIN_ICON: Record<EmployeeAttentionItem['domain'], ProfilePageIconId> = {
  employment: 'briefcase', statutory: 'shield', payroll: 'key', documents: 'file',
  training: 'calendar', access: 'lock', onboarding: 'user', offboarding: 'exit',
};

/** Readiness domain → the rail and matrix icon. */
const CONTROL_ICON: Record<string, ProfilePageIconId> = {
  assignment: 'briefcase', payroll: 'key', training: 'calendar',
  documents: 'file-check', statutory: 'shield', access: 'lock',
};

/** Activity area → the Recent Activity timeline icon and its tone class. */
const ACTIVITY_VISUAL: Record<ActivityArea, { icon: ProfilePageIconId; tone: string }> = {
  readiness: { icon: 'check', tone: 'green' },
  documents: { icon: 'file', tone: 'blue' },
  account:   { icon: 'lock', tone: '' },
  employment: { icon: 'briefcase', tone: 'purple' },
};

/** A `<dl class="definition-list">` row pair. */
function Row({ label, value }: { label: string; value: ComponentChildren }): VNode {
  return <><dt>{label}</dt><dd>{value ?? DASH}</dd></>;
}

/** The reference's card header, with an optional tab link on the right. */
function CardHead({ icon, title, action }: {
  icon: ProfilePageIconId; title: string; action?: ComponentChildren;
}): VNode {
  return <div class="card-head"><PageIcon id={icon} />{title}{action}</div>;
}

/** The reference's `.link` control — a text button that opens a tab or dialog. */
function LinkButton({ label, onClick, hidden }: { label: string; onClick: () => void; hidden?: boolean }): VNode {
  return (
    <button class={`link${hidden ? ' is-context-hidden' : ''}`} type="button" onClick={onClick}>
      {label}<PageIcon id="chevron" />
    </button>
  );
}

/** Panel heading with its optional right-hand action cluster. */
function SectionHead({ title, text, actions }: {
  title: string; text: string; actions?: ComponentChildren;
}): VNode {
  return (
    <div class="section-head">
      <div><h2>{title}</h2><p>{text}</p></div>
      {actions && <div class="section-actions">{actions}</div>}
    </div>
  );
}

/** The reference's half-circle readiness gauge. */
function Gauge({ percent, label }: { percent: number; label: string }): VNode {
  const safe = Math.max(0, Math.min(100, percent));
  return (
    <svg class="gauge" viewBox="0 0 140 92" role="img" aria-label={`${safe} percent ready`}>
      <path class="gauge-track" pathLength="100" d="M15 76 A55 55 0 0 1 125 76" />
      <path
        class="gauge-value" pathLength="100" d="M15 76 A55 55 0 0 1 125 76"
        style={{ strokeDasharray: `${safe} 100` }}
      />
      <text class="gauge-score" x="70" y="67">{safe}%</text>
      <text class="gauge-label" x="70" y="84">{label}</text>
    </svg>
  );
}

/** Two-letter avatar for an actor cell. */
function initialsOf(name: string): string {
  return name.split(/\s+/).filter(Boolean).slice(0, 2).map(part => part.charAt(0).toUpperCase()).join('') || '?';
}

export function EmployeeProfilePage({ employeeId, access, onBack }: EmployeeProfilePageProps): VNode {
  const [tab, setTab] = useState<ProfileTabKey>('overview');
  const [dialog, setDialog] = useState<OpenDialog | null>(null);
  const [menuOpen, setMenuOpen] = useState(false);
  const [showAllAttention, setShowAllAttention] = useState(false);
  const [documentFilters, setDocumentFilters] = useState<DocumentFilters>(EMPTY_DOCUMENT_FILTERS);
  const [activityFilters, setActivityFilters] = useState<ActivityFilters>(EMPTY_ACTIVITY_FILTERS);
  const tabsRef = useRef<HTMLElement>(null);

  const shellQuery = useEmployeeProfileShell(employeeId);
  const shell = shellQuery.data;
  const detailQuery = useHrEmployee(employeeId);
  const detail = detailQuery.data;

  // Reset per-employee state on switch: a newly opened record must never inherit
  // the previous one's tab, filters or open dialog.
  useEffect(() => {
    setTab('overview'); setDialog(null); setMenuOpen(false); setShowAllAttention(false);
    setDocumentFilters(EMPTY_DOCUMENT_FILTERS); setActivityFilters(EMPTY_ACTIVITY_FILTERS);
  }, [employeeId]);

  const tabs = useMemo(() => visibleTabs(shell, FULL_PAGE_TABS), [shell]);
  useEffect(() => { if (!tabs.includes(tab)) setTab('overview'); }, [tabs, tab]);

  // Tab-scoped datasets — each stays off until its tab is opened.
  const attentionQuery = useEmployeeAttention(employeeId, showAllAttention);
  const documentHealth = useEmployeeDocumentHealth(
    employeeId, access.viewDocuments && (tab === 'documents' || tab === 'readiness'));
  const employment = useEmploymentDetail(employeeId, tab === 'employment');
  const readiness = useReadinessMatrix(employeeId, access.viewReadiness && tab === 'readiness');
  const assignments = useEmployeeAccessAssignments(employeeId, false, access.viewAccessAssignments && tab === 'access');
  const supportRequests = useEmployeeAccountSupportRequests(employeeId, tab === 'access');
  const audit = useHrAudit(access.viewAudit && (tab === 'activity') ? employeeId : null);
  const security = useAdminUserSecurityStatus(
    employeeId, access.viewAccountSecurity && (tab === 'overview' || tab === 'access'));
  const offboardingCases = useOffboardingCases(undefined, tab === 'offboarding' ? employeeId : undefined);

  const phase = offboardingPhase(tab === 'offboarding' ? offboardingCases.data : []);
  const offboardingDetail = useOffboardingCase(tab === 'offboarding' ? phase.active?.id ?? null : null);

  /** Move to a tab and put the tab strip back in view, as the reference does. */
  function goToTab(next: ProfileTabKey): void {
    setTab(next);
    tabsRef.current?.scrollIntoView({ block: 'start', behavior: 'smooth' });
  }

  /** Roving-tabindex keyboard navigation across the tab strip. */
  function onTabKeyDown(event: KeyboardEvent, index: number): void {
    if (!['ArrowLeft', 'ArrowRight', 'Home', 'End'].includes(event.key)) return;
    event.preventDefault();
    const last = tabs.length - 1;
    const next = event.key === 'ArrowLeft' ? (index - 1 + tabs.length) % tabs.length
      : event.key === 'ArrowRight' ? (index + 1) % tabs.length
        : event.key === 'Home' ? 0 : last;
    const target = tabs[next];
    if (!target) return;
    setTab(target);
    (tabsRef.current?.querySelectorAll<HTMLButtonElement>('.record-tab')[next])?.focus();
  }

  if (shellQuery.isError) {
    return (
      <div class="epf-root">
        <div class="workspace">
          <div class="epf-error" role="alert">
            {shellQuery.error instanceof Error ? shellQuery.error.message : 'This employee record could not be loaded.'}
            <button class="button" type="button" onClick={onBack}>Back To Employee Master</button>
          </div>
        </div>
      </div>
    );
  }

  if (!shell) {
    return (
      <div class="epf-root">
        <ProfilePageIconSprite />
        <div class="workspace">
          <div class="epf-loading" role="status">Loading the employee record…</div>
        </div>
      </div>
    );
  }

  const identity = shell.identity;
  const facts = shell.employment;
  const attentionItems = showAllAttention
    ? (attentionQuery.data?.items ?? shell.attentionPreview)
    : shell.attentionPreview;

  return (
    <div class="epf-root">
      <ProfilePageIconSprite />

      <div class="workspace">
        <div class="breadcrumbs">
          <button class="epf-crumb" type="button" onClick={onBack}>Employee Master</button>
          <PageIcon id="chevron" />
          <span>{identity.displayName}</span>
        </div>

        <div class="page-head">
          <div>
            <h1>Employee Record</h1>
            <p>Complete employee history, authorised administration, and readiness controls.</p>
          </div>
          <div class="page-actions">
            {/* The reference shows Request Change only to an actor who cannot edit
                directly; an actor who can edit gets the editor instead. */}
            {!access.editEmployee && access.requestChange && (
              <button class="button" type="button" onClick={() => setDialog({ kind: 'request-change' })}>
                <PageIcon id="message" />Request Change
              </button>
            )}
            {access.editEmployee && (
              <button class="button primary" type="button" onClick={() => setDialog({ kind: 'edit' })}>
                <PageIcon id="edit" />Edit Employee
              </button>
            )}
            <div class="epf-menu-wrap">
              <button
                class="button" type="button" aria-label="More employee actions"
                aria-haspopup="menu" aria-expanded={menuOpen}
                onClick={() => setMenuOpen(open => !open)}
              ><PageIcon id="more" /></button>
              {menuOpen && (
                <div class="epf-action-menu" role="menu">
                  {access.editEmployee && access.requestChange && (
                    <button
                      type="button" role="menuitem"
                      onClick={() => { setMenuOpen(false); setDialog({ kind: 'request-change' }); }}
                    >Request Employee Change</button>
                  )}
                  {access.viewAudit && (
                    <button
                      type="button" role="menuitem"
                      onClick={() => { setMenuOpen(false); setDialog({ kind: 'export-audit' }); }}
                    >Export Audit History</button>
                  )}
                  {access.startOffboarding && !phase.active && (
                    <button
                      class="danger" type="button" role="menuitem"
                      onClick={() => { setMenuOpen(false); setDialog({ kind: 'start-offboarding' }); }}
                    >Start Offboarding</button>
                  )}
                  <button type="button" role="menuitem" onClick={() => { setMenuOpen(false); onBack(); }}>
                    Back To Employee Master
                  </button>
                </div>
              )}
            </div>
          </div>
        </div>

        <section class="employee-hero" aria-label="Employee summary">
          <div class="hero-profile">
            <div class="hero-identity">
              <div class="portrait-shell">
                {identity.profileImageUrl
                  ? <img class="portrait" src={identity.profileImageUrl} alt={identity.displayName} />
                  : <span class="portrait epf-portrait-fallback" aria-hidden="true">{initialsOf(identity.displayName)}</span>}
              </div>
              <div>
                <div class="hero-name-line">
                  <h2>{identity.displayName}</h2>
                  <span class="status-pill">{titleCase(identity.employmentStatus)}</span>
                </div>
                <div class="employee-id">{identity.employeeNo ?? 'Employee Number Not Assigned'}</div>
                <div class="hero-details">
                  <span><PageIcon id="briefcase" />{identity.position ?? 'Position Not Assigned'}</span>
                  <span><PageIcon id="building" />{identitySubtitle(shell)}</span>
                </div>
              </div>
            </div>
            <div class="hero-facts">
              <div class="hero-fact"><PageIcon id="shield" /><span>Employment Basis</span><strong>{titleCase(facts.employmentBasis)}</strong></div>
              <div class="hero-fact"><PageIcon id="clock" /><span>Work Arrangement</span><strong>{facts.workArrangement ?? DASH}</strong></div>
              <div class="hero-fact"><PageIcon id="calendar" /><span>Start Date</span><strong>{formatDate(facts.startDate)}</strong></div>
              <div class="hero-fact"><PageIcon id="clock" /><span>Tenure</span><strong>{formatTenure(facts.tenureMonths)}</strong></div>
            </div>
          </div>

          {shell.readiness && (
            <aside class="hero-readiness" aria-label="Record readiness summary">
              <div class="hero-readiness-head">
                <PageIcon id="chart" /><strong>Record Readiness</strong>
                <LinkButton label="Open Breakdown" hidden={tab === 'readiness'} onClick={() => goToTab('readiness')} />
              </div>
              <div class="hero-readiness-body">
                <Gauge percent={shell.readiness.percent} label={readinessLabel(shell.readiness)} />
                <div class="hero-readiness-copy">
                  <strong>{readinessHeadline(shell.readiness)}</strong>
                  <p>{readinessExplanation(shell.readiness)}</p>
                </div>
              </div>
              <div class="hero-readiness-foot">
                <span>{shell.readiness.lastReviewedAt
                  ? `Last reviewed ${formatDate(shell.readiness.lastReviewedAt)}`
                  : 'Not yet reviewed'}</span>
              </div>
            </aside>
          )}
        </section>

        <nav class="record-tabs" role="tablist" aria-label="Employee record sections" ref={tabsRef}>
          {tabs.map((key, index) => {
            const indicator = tabIndicatorFor(shell.tabIndicators, key);
            const selected = tab === key;
            return (
              <button
                key={key} id={`tab-${key}`} class={`record-tab${selected ? ' active' : ''}`}
                data-tab={key} role="tab" aria-selected={selected} aria-controls={`panel-${key}`}
                aria-label={tabAriaLabel(key, indicator)} tabIndex={selected ? 0 : -1}
                onClick={() => setTab(key)} onKeyDown={event => onTabKeyDown(event, index)}
              >
                {TAB_LABEL[key]}
                {indicator && (
                  <span class={`tab-indicator ${severityToneClass(indicator.highestSeverity)}`.trim()} aria-hidden="true">
                    {indicator.unresolvedCount}
                  </span>
                )}
              </button>
            );
          })}
        </nav>

        <div class="tab-shell">
          {/* ── Overview ────────────────────────────────────────────────── */}
          {tab === 'overview' && (
            <section class="tab-panel active" id="panel-overview" role="tabpanel" aria-labelledby="tab-overview">
              <div class="attention-strip">
                <div class="attention-title">
                  <span class="attention-heading-icon"><PageIcon id="alert" /></span>
                  Needs Attention <span class="badge warning">{shell.attentionTotal}</span>
                </div>
                {attentionItems.length === 0 && (
                  <article class="attention-item">
                    <span class="attention-ico"><PageIcon id="check" /></span>
                    <div><strong>Nothing Needs Attention</strong><span>Every tracked item for this employee is resolved.</span></div>
                  </article>
                )}
                {attentionItems.map((item, index) => (
                  <article
                    key={item.id}
                    class={`attention-item${item.severity === 'critical' ? ' danger' : ''}`}
                    role="link" tabIndex={0}
                    onClick={() => goToTab(item.actionTarget)}
                    onKeyDown={event => { if (event.key === 'Enter' || event.key === ' ') goToTab(item.actionTarget); }}
                  >
                    <span class="attention-ico"><PageIcon id={DOMAIN_ICON[item.domain]} /></span>
                    <div><strong>{item.title}</strong><span>{attentionSubtitle(item)}</span></div>
                    {index === attentionItems.length - 1
                      && shell.attentionTotal > attentionItems.length && !showAllAttention
                      ? (
                        <button
                          class="attention-next" type="button"
                          aria-label={`Show all ${shell.attentionTotal} attention items`}
                          onClick={event => { event.stopPropagation(); setShowAllAttention(true); }}
                        ><PageIcon id="chevron" /></button>
                      )
                      : <PageIcon id="chevron" />}
                  </article>
                ))}
              </div>

              <div class="grid-3">
                <section class="card">
                  <CardHead
                    icon="briefcase" title="Employment Snapshot"
                    action={<LinkButton label="Open Employment" onClick={() => goToTab('employment')} />}
                  />
                  <dl class="definition-list">
                    <Row label="Legal Employer" value={facts.legalEmployer ?? DASH} />
                    <Row label="Employment Basis" value={titleCase(facts.employmentBasis)} />
                    <Row label="Work Arrangement" value={facts.workArrangement ?? DASH} />
                    <Row label="Cost Centre" value={facts.costCentre ?? DASH} />
                    <Row label="Work Location" value={identity.siteName ?? DASH} />
                    <Row label="Pay Group" value={facts.payGroupName ?? DASH} />
                  </dl>
                </section>

                <section class="card">
                  <CardHead icon="phone" title="Contact" />
                  {shell.contact ? (
                    <dl class="definition-list">
                      <Row label="Work Email" value={shell.contact.workEmail ?? DASH} />
                      <Row label="Work Phone" value={shell.contact.workPhone ?? DASH} />
                      <Row label="Mobile" value={shell.contact.mobilePhone ?? DASH} />
                      <Row label="Emergency Contact" value={shell.contact.emergencyContactName ?? DASH} />
                      <Row label="Relationship" value={titleCase(shell.contact.emergencyContactRelationship)} />
                      <Row label="Emergency Phone" value={shell.contact.emergencyContactPhone ?? DASH} />
                    </dl>
                  ) : (
                    <div class="epf-empty">Contact details are not available to your role.</div>
                  )}
                </section>

                <section class="card span-2">
                  <CardHead
                    icon="clock" title="Recent Employee Activity"
                    action={access.viewAudit
                      ? <LinkButton label="View Full History" onClick={() => goToTab('activity')} />
                      : undefined}
                  />
                  {!access.viewAudit ? (
                    <div class="epf-empty">Employee activity requires the HR audit capability.</div>
                  ) : shell.recentActivity.length === 0 ? (
                    <div class="epf-empty">No activity has been recorded for this employee yet.</div>
                  ) : (
                    <div class="activity-list">
                      {shell.recentActivity.map(entry => {
                        const visual = ACTIVITY_VISUAL[activityArea(entry.area)];
                        return (
                          <div class="activity-row" key={entry.id}>
                            <span class={`activity-icon ${visual.tone}`.trim()}><PageIcon id={visual.icon} /></span>
                            <div class="activity-copy">
                              <strong>{activityTitle(entry.action)}</strong>
                              <span>{titleCase(entry.area)}{entry.actorName ? ` · By ${entry.actorName}` : ''}</span>
                            </div>
                            <time class="activity-time">{formatDateTime(entry.occurredAt)}</time>
                          </div>
                        );
                      })}
                    </div>
                  )}
                </section>

                {/* Always rendered, even when restricted: it is the grid's last
                    child, and the locked layout pins that child to column 3. */}
                <section class="card">
                  <CardHead
                    icon="shield" title="Account Health"
                    action={<LinkButton label="Open Access" onClick={() => goToTab('access')} />}
                  />
                  {shell.accountHealth ? (
                    <dl class="definition-list">
                      <Row label="Account" value={<span class="badge">{titleCase(shell.accountHealth.accountStatus)}</span>} />
                      <Row
                        label="MFA"
                        value={!access.viewAccountSecurity
                          ? <span class="badge neutral">Restricted</span>
                          : security.isPending
                            ? <span class="badge neutral">Loading</span>
                            : security.data?.totpEnabled || (security.data?.passkeyCount ?? 0) > 0
                              ? <span class="badge">Enabled</span>
                              : <span class="badge warning">Not Enrolled</span>}
                      />
                      <Row
                        label="Last Sign-In"
                        value={access.viewAccountSecurity ? formatDateTime(security.data?.lastSeenAt) : 'Restricted'}
                      />
                      <Row label="Access Profile" value={shell.accountHealth.accessProfileLabel ?? DASH} />
                      <Row
                        label="Open Assistance"
                        value={shell.accountHealth.openSupportRequests > 0
                          ? <span class="badge warning">{shell.accountHealth.openSupportRequests} In Review</span>
                          : <span class="badge neutral">None</span>}
                      />
                      <Row
                        label="Sign-In Identity"
                        value={shell.accountHealth.hasLoginIdentity
                          ? <span class="badge">Provisioned</span>
                          : <span class="badge warning">Not Provisioned</span>}
                      />
                    </dl>
                  ) : (
                    <div class="epf-empty">Account health is not available to your role.</div>
                  )}
                </section>
              </div>
            </section>
          )}

          {/* ── Employment ──────────────────────────────────────────────── */}
          {tab === 'employment' && (
            <section class="tab-panel active" id="panel-employment" role="tabpanel" aria-labelledby="tab-employment">
              <SectionHead
                title="Employment"
                text="Authoritative assignment, terms, service dates, and complete employment history."
                actions={access.editEmployee
                  ? <button class="button primary" type="button" onClick={() => setDialog({ kind: 'edit' })}>
                    <PageIcon id="edit" />Edit Employment
                  </button>
                  : access.requestChange
                    ? <button class="button" type="button" onClick={() => setDialog({ kind: 'request-change' })}>
                      <PageIcon id="message" />Request Change
                    </button>
                    : undefined}
              />
              <div class="stat-grid employment-kpis">
                <div class="stat">
                  <span class="kpi-icon"><PageIcon id="shield" /></span>
                  <div class="kpi-copy">
                    <div class="kpi-line"><span>Employment Status</span><strong>{titleCase(identity.employmentStatus)}</strong></div>
                    <small>{titleCase(facts.employmentBasis)}</small>
                  </div>
                </div>
                <div class="stat">
                  <span class="kpi-icon blue"><PageIcon id="clock" /></span>
                  <div class="kpi-copy">
                    <div class="kpi-line"><span>Continuous Service</span><strong>{formatTenure(facts.tenureMonths)}</strong></div>
                    <small>Started {formatDate(facts.startDate)}</small>
                  </div>
                </div>
                <div class="stat">
                  <span class="kpi-icon purple"><PageIcon id="calendar" /></span>
                  <div class="kpi-copy">
                    <div class="kpi-line"><span>Current Appointment</span><strong>{formatDate(facts.assignmentEffectiveFrom)}</strong></div>
                    <small>{identity.position ?? 'Not Assigned'}</small>
                  </div>
                </div>
                <div class="stat">
                  <span class="kpi-icon amber"><PageIcon id="briefcase" /></span>
                  <div class="kpi-copy">
                    <div class="kpi-line"><span>Weekly Hours</span><strong>{formatWeeklyHours(facts.weeklyHours)}</strong></div>
                    <small>{formatArrangementAndFte(facts.workArrangement, facts.fte)}</small>
                  </div>
                </div>
              </div>

              <div class="grid-2" style="margin-top:13px">
                <section class="card">
                  <CardHead icon="briefcase" title="Current Assignment" />
                  <dl class="definition-list">
                    <Row label="Position" value={identity.position ?? 'Not Assigned'} />
                    <Row label="Department" value={identity.departmentName ?? 'Not Assigned'} />
                    <Row label="Supervisor" value={facts.supervisorName ?? 'Not Assigned'} />
                    <Row label="Work Location" value={identity.siteName ?? 'Not Assigned'} />
                    <Row label="Cost Centre" value={facts.costCentre ?? 'Not Assigned'} />
                    <Row label="Effective From" value={formatDate(facts.assignmentEffectiveFrom)} />
                  </dl>
                </section>

                <section class="card">
                  <CardHead icon="shield" title="Employment Terms" />
                  <dl class="definition-list">
                    <Row label="Legal Employer" value={facts.legalEmployer ?? DASH} />
                    <Row label="Contract Type" value={titleCase(facts.employmentBasis)} />
                    <Row label="Work Type / FTE" value={formatArrangementAndFte(facts.workArrangement, facts.fte)} />
                    <Row label="Standard Hours" value={formatWeeklyHours(facts.weeklyHours)} />
                    <Row label="Work Schedule" value={titleCase(facts.workSchedule)} />
                    <Row label="Notice Period" value={formatNoticePeriod(facts.noticePeriodDays)} />
                  </dl>
                </section>

                <section class="card">
                  <CardHead icon="calendar" title="HR Administration" />
                  <dl class="definition-list">
                    <Row label="Pay Group" value={facts.payGroupName ?? 'Not Assigned'} />
                    <Row label="Pay Frequency" value={titleCase(facts.payFrequency)} />
                    <Row
                      label="Probation"
                      value={(() => {
                        const state = probationState(facts.probationEndDate);
                        if (state === 'completed') return <span class="badge">Completed</span>;
                        if (state === 'in_progress') return <span class="badge warning">In Progress</span>;
                        return <span class="badge neutral">Not Recorded</span>;
                      })()}
                    />
                    <Row label="Probation Ended" value={formatDate(facts.probationEndDate)} />
                    <Row label="Classification" value={facts.employeeGrade ?? 'Not Assigned'} />
                    <Row label="Worker Category" value={facts.workerCategory ?? DASH} />
                  </dl>
                </section>

                <section class="card">
                  <CardHead icon="key" title="Bank &amp; Pay Administration" />
                  {employment.isPending && <div class="epf-loading">Loading payroll context…</div>}
                  {employment.data && !employment.data.bank && (
                    <div class="epf-empty">Payroll context requires the payroll-readiness capability.</div>
                  )}
                  {employment.data?.bank && (
                    <dl class="definition-list">
                      <Row label="Primary Bank" value={employment.data.bank.bankName ?? DASH} />
                      {/* Masked only — HR never receives the full account number. */}
                      <Row label="Account" value={employment.data.bank.accountNumberMasked ?? DASH} />
                      <Row label="Account Type" value={titleCase(employment.data.bank.accountType)} />
                      <Row label="Payment Method" value={employment.data.bank.hasPrimaryAccount ? 'Direct Deposit' : DASH} />
                      <Row
                        label="Bank Record"
                        value={employment.data.bank.verificationState === 'verified'
                          ? <span class="badge">Verified</span>
                          : employment.data.bank.verificationState === 'missing'
                            ? <span class="badge danger">Missing</span>
                            : <span class="badge warning">Reverify</span>}
                      />
                      <Row label="Last Verified" value={formatDate(employment.data.bank.lastVerifiedAt)} />
                    </dl>
                  )}
                </section>

                {shell.capabilities.viewStatutory && (
                  <section class="card span-2">
                    <CardHead icon="file" title="Trinidad &amp; Tobago Statutory Status" />
                    <dl class="definition-list statutorystatus">
                      <Row
                        label="NIS Registration"
                        value={detail?.statutory?.nis_status === 'registered'
                          ? <span class="badge">Registered</span>
                          : <span class="badge warning">{titleCase(detail?.statutory?.nis_status ?? 'not recorded')}</span>}
                      />
                      <Row
                        label="Tax Profile"
                        value={detail?.statutory?.bir_file_number
                          ? <span class="badge">On File</span>
                          : <span class="badge warning">Required</span>}
                      />
                      <Row label="PAYE" value={detail?.statutory?.paye_applicable ? 'Applicable' : 'Not Applicable'} />
                      <Row
                        label="Payroll Readiness"
                        value={shell.readiness?.payrollStatus === 'ready'
                          ? <span class="badge">Ready</span>
                          : <span class={`badge ${shell.readiness?.payrollStatus === 'blocked' ? 'danger' : 'warning'}`}>
                            {titleCase(shell.readiness?.payrollStatus ?? 'pending')}
                          </span>}
                      />
                    </dl>
                  </section>
                )}

                <section class="card span-2 history-card">
                  <CardHead icon="clock" title="Complete Employment History" />
                  {employment.isPending && <div class="epf-loading">Loading employment history…</div>}
                  {employment.data?.history.length === 0 && (
                    <div class="epf-empty">No employment changes have been recorded for this employee.</div>
                  )}
                  {employment.data && employment.data.history.length > 0 && (
                    <div class="timeline">
                      {employment.data.history.map(entry => (
                        <div class="timeline-entry" key={entry.id}>
                          <div>
                            <strong>{entry.title}</strong>
                            <span>{entry.detail}{entry.actorName ? ` · ${entry.actorName}` : ''}</span>
                          </div>
                          <time>{formatDate(entry.occurredAt)}</time>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              </div>
            </section>
          )}

          {/* ── Documents ───────────────────────────────────────────────── */}
          {tab === 'documents' && (
            <section class="tab-panel active" id="panel-documents" role="tabpanel" aria-labelledby="tab-documents">
              <SectionHead
                title="Documents"
                text="Authorised employee documents, verification state, expiries, and evidence management."
                actions={
                  <>
                    {access.downloadDocument && (
                      <button class="button" type="button" onClick={() => setDialog({ kind: 'export-index' })}>
                        <PageIcon id="download" />Export Index
                      </button>
                    )}
                    {access.uploadDocument && (
                      <button class="button primary" type="button" onClick={() => setDialog({ kind: 'add-document' })}>
                        <PageIcon id="plus" />Add Document
                      </button>
                    )}
                  </>
                }
              />
              {documentHealth.isPending && <div class="epf-loading" role="status">Loading document health…</div>}
              {documentHealth.isError && (
                <div class="epf-error" role="alert">
                  {documentHealth.error instanceof Error ? documentHealth.error.message : 'Document health could not be loaded.'}
                </div>
              )}
              {documentHealth.data && (() => {
                const summary = documentHealth.data;
                const rows = documentRows(summary.groups);
                const visible = filterDocumentRows(rows, documentFilters);
                const score = documentHealthScore(summary);
                return (
                  <>
                    <div class="stat-grid document-kpis">
                      <div class="stat">
                        <span class="kpi-icon"><PageIcon id="file" /></span>
                        <div class="kpi-copy">
                          <span>Total Documents</span><strong>{summary.totalDocuments}</strong>
                          <small>Across {summary.categoryCount} {summary.categoryCount === 1 ? 'category' : 'categories'}</small>
                        </div>
                      </div>
                      <div class="stat">
                        <span class="kpi-icon"><PageIcon id="check" /></span>
                        <div class="kpi-copy">
                          <span>Verified</span><strong>{summary.verifiedCount}</strong>
                          <small>{summary.verifiedPercent}% of required records</small>
                        </div>
                      </div>
                      <div class="stat">
                        <span class="kpi-icon"><PageIcon id="clock" /></span>
                        <div class="kpi-copy">
                          <span>Expiring Soon</span><strong>{summary.expiringCount}</strong>
                          <small>Within the next 30 days</small>
                        </div>
                      </div>
                      <div class="stat">
                        <span class="kpi-icon"><PageIcon id="alert" /></span>
                        <div class="kpi-copy">
                          <span>Missing</span><strong>{summary.missingCount}</strong>
                          <small>{summary.missingCount === 0 ? 'All required evidence held' : 'Required evidence outstanding'}</small>
                        </div>
                      </div>
                    </div>

                    <div class="document-workspace-card">
                      <div class="document-health-redesign">
                        <div class="document-health-title">
                          <span><PageIcon id="file-check" /></span>
                          <div>
                            <strong>Employee Document Health</strong>
                            <p>Required records are measured against this employee&rsquo;s employment, statutory, training,
                              and identity requirements.</p>
                          </div>
                        </div>
                        <div class="document-health-score">
                          <div><strong>{score}</strong><b>/100</b><span>{documentHealthBand(score)}</span></div>
                        </div>
                        <div class="document-health-breakdown">
                          <div class="document-health-summary-head">
                            <span>Required Document Status</span>
                            <strong>{summary.requiredCount} {summary.requiredCount === 1 ? 'Record' : 'Records'}</strong>
                          </div>
                          {/* The reference draws its three segments at a fixed
                              10fr 1fr 1fr, which is only the ratio of ITS sample
                              data. Production sizes them from the real counts by
                              overriding that same grid track list inline; a bar
                              whose segments did not match the numbers printed
                              beneath it would be a decorative graphic. */}
                          <div
                            class="document-health-bar-new"
                            style={{ gridTemplateColumns: healthBarTracks(summary) }}
                            aria-label={`${summary.verifiedCount} verified, ${summary.expiringCount} expiring, ${summary.missingCount} missing`}
                          >
                            <span /><span /><span />
                          </div>
                          <div class="document-health-states">
                            <div class="document-health-state">
                              <strong>{summary.verifiedCount}</strong><span>Verified · {summary.verifiedPercent}%</span>
                            </div>
                            <div class="document-health-state warning">
                              <strong>{summary.expiringCount}</strong><span>Expiring · {summary.expiringPercent}%</span>
                            </div>
                            <div class="document-health-state danger">
                              <strong>{summary.missingCount}</strong><span>Missing · {summary.missingPercent}%</span>
                            </div>
                          </div>
                        </div>
                      </div>

                      <div class="document-toolbar">
                        <label class="document-search">
                          <PageIcon id="search" />
                          <input
                            type="search" placeholder="Search employee documents" aria-label="Search employee documents"
                            value={documentFilters.search}
                            onInput={event => setDocumentFilters({ ...documentFilters, search: event.currentTarget.value })}
                          />
                        </label>
                        <select
                          class="document-filter-select" aria-label="Filter by category"
                          value={documentFilters.category}
                          onChange={event => setDocumentFilters({ ...documentFilters, category: event.currentTarget.value })}
                        >
                          <option value="all">All Categories</option>
                          {documentCategories(summary.groups).map(category => (
                            <option key={category.key} value={category.key}>{category.label}</option>
                          ))}
                        </select>
                        <select
                          class="document-filter-select" aria-label="Filter by status"
                          value={documentFilters.status}
                          onChange={event => setDocumentFilters({
                            ...documentFilters, status: event.currentTarget.value as DocumentStatusFilter,
                          })}
                        >
                          {DOCUMENT_STATUS_FILTERS.map(option => (
                            <option key={option.value} value={option.value}>{option.label}</option>
                          ))}
                        </select>
                        <button
                          class="button filter-reset" type="button"
                          disabled={!hasDocumentFilters(documentFilters)}
                          onClick={() => setDocumentFilters(EMPTY_DOCUMENT_FILTERS)}
                        >Clear Filters</button>
                      </div>

                      {hasDocumentFilters(documentFilters) && (
                        <p class="epf-filter-summary" role="status">
                          Showing {visible.length} of {rows.length} document records.
                        </p>
                      )}

                      {visible.length === 0 ? (
                        <div class="epf-empty">
                          {rows.length === 0
                            ? 'No document requirements apply to this employee, and no documents are held.'
                            : 'No document records match the selected filters.'}
                        </div>
                      ) : (
                        <div class="table-wrap">
                          <table class="data-table">
                            <thead>
                              <tr>
                                <th>Document</th><th>Category</th><th>Status</th>
                                <th>Issue / Effective Date</th><th>Expiry Date</th><th>Requirement</th><th />
                              </tr>
                            </thead>
                            <tbody>
                              {visible.map(row => {
                                const badge = DOCUMENT_STATE_BADGE[row.state];
                                const action = documentRowAction(row);
                                return (
                                  <tr key={`${row.categoryKey}:${row.documentId ?? row.requirementId ?? row.title}`}>
                                    <td><strong>{row.title}</strong><small>{row.detail}</small></td>
                                    <td>{row.categoryLabel}</td>
                                    <td><span class={`badge ${badge.tone}`.trim()}>{badge.label}</span></td>
                                    <td>{formatDate(row.issuedAt)}</td>
                                    <td>{formatDate(row.expiryDate)}</td>
                                    <td>{row.required ? 'Required' : 'Supplementary'}</td>
                                    <td>
                                      {action === 'request'
                                        ? access.uploadDocument && (
                                          <button class="link" type="button" onClick={() => setDialog({ kind: 'add-document' })}>
                                            Request
                                          </button>
                                        )
                                        : (
                                          <button class="link" type="button" onClick={() => showSection('s-hr-documents')}>
                                            {action === 'review' ? 'Review' : 'Open'}
                                          </button>
                                        )}
                                    </td>
                                  </tr>
                                );
                              })}
                            </tbody>
                          </table>
                        </div>
                      )}
                    </div>
                  </>
                );
              })()}
            </section>
          )}

          {/* ── Readiness ───────────────────────────────────────────────── */}
          {tab === 'readiness' && (
            <section class="tab-panel active" id="panel-readiness" role="tabpanel" aria-labelledby="tab-readiness">
              <SectionHead
                title="Readiness"
                text="Detailed evidence-based controls showing whether this employee record can support authorised HR and operational workflows."
              />
              {readiness.isPending && <div class="epf-loading" role="status">Loading readiness controls…</div>}
              {readiness.isError && (
                <div class="epf-error" role="alert">
                  {readiness.error instanceof Error ? readiness.error.message : 'Readiness controls could not be loaded.'}
                </div>
              )}
              {readiness.data && (() => {
                const matrix = readiness.data;
                const blockers = readinessBlockers(matrix.controls);
                return (
                  <>
                    <section class="readiness-command">
                      <div class="readiness-coverage-head">
                        <div class="readiness-coverage-title">
                          <span><PageIcon id="shield" /></span>
                          <div>
                            <strong>Readiness Coverage</strong>
                            <small>Authorised controls required for this employee record</small>
                          </div>
                        </div>
                      </div>
                      <div
                        class="readiness-rail"
                        aria-label={`${matrix.coverage.readyControls} of ${matrix.coverage.totalControls} controls ready`}
                      >
                        {matrix.controls.map(entry => (
                          <button
                            key={entry.control.controlKey} type="button"
                            class={`readiness-rail-item ${readinessRailState(entry)}`.trim()}
                            onClick={() => setDialog({ kind: 'readiness', entry })}
                          >
                            <span class="readiness-rail-icon">
                              <PageIcon id={CONTROL_ICON[entry.control.domain] ?? 'shield'} />
                            </span>
                            <strong>{entry.control.label}</strong>
                            <small>{readinessRailLabel(entry)}</small>
                          </button>
                        ))}
                      </div>
                      <div class="readiness-meta">
                        <span class="coverage-inline">
                          <strong>{coverageSentence(matrix.coverage.readyControls, matrix.coverage.totalControls)}</strong> Controls Ready
                        </span>
                        <span>Last Reviewed <strong>{formatDate(shell.readiness?.lastReviewedAt)}</strong></span>
                        <span>Review Owner <strong>{shell.readiness?.reviewOwnerLabel ?? 'Owner Required'}</strong></span>
                        <span>Next Review <strong>{formatDate(shell.readiness?.nextReviewAt)}</strong></span>
                      </div>
                    </section>

                    <div class="readiness-collaboration-note">
                      <span><PageIcon id="users" /></span>
                      <div>
                        <strong>Shared Readiness Work</strong>
                        <small>HR coordinates the employee record. The responsible department completes or verifies its own
                          control, and the readiness score updates automatically.</small>
                      </div>
                      <div class="collaboration-route">HR Coordinates → Department Resolves</div>
                    </div>

                    <section class="readiness-blockers" aria-labelledby="readiness-blockers-title">
                      <div class="readiness-blockers-head">
                        <div><PageIcon id="alert" /><strong id="readiness-blockers-title">Readiness Blockers</strong></div>
                        <span>{blockers.length === 0
                          ? 'No work items require action'
                          : `${blockers.length} work ${blockers.length === 1 ? 'item requires' : 'items require'} action`}</span>
                      </div>
                      {blockers.length === 0 && (
                        <div class="epf-empty">Every readiness control has passed for this record.</div>
                      )}
                      {blockers.map(entry => {
                        const state = readinessWorkStateBadge(entry);
                        return (
                          <article
                            class={`readiness-blocker${entry.control.isBlocking ? '' : ' review'}`}
                            key={entry.control.controlKey}
                          >
                            <div class="readiness-blocker-title">
                              <span><PageIcon id={CONTROL_ICON[entry.control.domain] ?? 'shield'} /></span>
                              <div>
                                <strong>{entry.control.label}</strong>
                                <small>{entry.control.description ?? `Resolved by ${titleCase(entry.control.resolutionType)}.`}</small>
                              </div>
                            </div>
                            <div class="readiness-blocker-meta">
                              <span>Department Owner</span>
                              <strong>{entry.owner.status === 'resolved' ? entry.owner.ownerLabel : 'Owner Required'}</strong>
                            </div>
                            <div class="readiness-blocker-meta">
                              <span>Action Needed Now</span>
                              <strong>{entry.workItem?.nextResponsibleParty ?? titleCase(entry.control.resolutionType)}</strong>
                            </div>
                            <div class="readiness-work-state">
                              <span class={`badge ${state.tone}`.trim()}>{state.label}</span>
                            </div>
                            <button
                              class={`button${entry.control.isBlocking ? ' primary' : ''}`} type="button"
                              onClick={() => setDialog({ kind: 'readiness', entry })}
                            >Open Work Item</button>
                          </article>
                        );
                      })}
                    </section>

                    <section class="card control-matrix-card">
                      <CardHead icon="shield" title="Readiness Control Matrix" />
                      <div class="table-wrap" style="margin-top:12px">
                        <table class="data-table">
                          <thead>
                            <tr>
                              <th>Control Area</th><th>Score</th><th>Evidence</th>
                              <th>Owner</th><th>Last Reviewed</th><th>State</th><th />
                            </tr>
                          </thead>
                          <tbody>
                            {matrix.controls.map(entry => {
                              const badge = readinessMatrixBadge(entry);
                              return (
                                <tr key={entry.control.controlKey}>
                                  <td>
                                    <strong>{entry.control.label}</strong>
                                    <small>{entry.control.description ?? titleCase(entry.control.domain)}</small>
                                  </td>
                                  <td>{entry.percent}%</td>
                                  <td>{titleCase(entry.state)}</td>
                                  <td>{entry.owner.status === 'resolved' ? entry.owner.ownerLabel : 'Owner Required'}</td>
                                  <td>{formatDate(entry.evaluatedAt)}</td>
                                  <td><span class={`badge ${badge.tone}`.trim()}>{badge.label}</span></td>
                                  <td>
                                    <button class="link" type="button" onClick={() => setDialog({ kind: 'readiness', entry })}>
                                      Open
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    </section>
                  </>
                );
              })()}
            </section>
          )}

          {/* ── Access ──────────────────────────────────────────────────── */}
          {tab === 'access' && (
            <section class="tab-panel active" id="panel-access" role="tabpanel" aria-labelledby="tab-access">
              <SectionHead
                title="Access"
                text="Sign-in identity, authorised business access, account health, and routed support for this employee."
                actions={
                  <button class="button primary" type="button" onClick={() => setDialog({ kind: 'account-assistance' })}>
                    <PageIcon id="headset" />Request Account Assistance
                  </button>
                }
              />
              {(() => {
                const health = shell.accountHealth;
                const mfaEnabled = !!security.data && (security.data.totpEnabled || security.data.passkeyCount > 0);
                const openRequests = health?.openSupportRequests ?? 0;
                const methods = [
                  'Password',
                  ...(security.data?.totpEnabled ? ['Authenticator'] : []),
                  ...((security.data?.passkeyCount ?? 0) > 0 ? [`${security.data?.passkeyCount} Passkey`] : []),
                ].join(' · ');
                const activeAssignment = assignments.data?.find(row => row.status === 'active') ?? assignments.data?.[0];
                return (
                  <>
                    <div class="access-cards">
                      <div class="access-card">
                        <span class="access-icon"><PageIcon id="check" /></span>
                        <div><span>Account Status</span><strong>{titleCase(health?.accountStatus)}</strong></div>
                      </div>
                      <div class="access-card">
                        <span class="access-icon"><PageIcon id="lock" /></span>
                        <div>
                          <span>MFA Status</span>
                          <strong>{!access.viewAccountSecurity ? 'Restricted' : mfaEnabled ? 'Enabled' : 'Not Enrolled'}</strong>
                        </div>
                      </div>
                      <div class="access-card">
                        <span class="access-icon"><PageIcon id="login" /></span>
                        <div>
                          <span>Last Sign-In</span>
                          <strong>{access.viewAccountSecurity ? formatDateTime(security.data?.lastSeenAt) : 'Restricted'}</strong>
                        </div>
                      </div>
                      <div class="access-card">
                        <span class="access-icon"><PageIcon id="headset" /></span>
                        <div>
                          <span>Open Assistance</span>
                          <strong>{openRequests === 0 ? 'None' : `${openRequests} In Review`}</strong>
                        </div>
                      </div>
                    </div>

                    <div class="grid-2" style="margin-top:13px">
                      <section class="card">
                        <CardHead icon="user" title="Sign-In Identity" />
                        <dl class="definition-list">
                          <Row label="Username" value={detail?.employee.username ?? DASH} />
                          <Row label="Sign-In Email" value={shell.contact?.workEmail ?? detail?.employee.email ?? DASH} />
                          <Row label="Account Created" value={formatDate(detail?.employee.created_at)} />
                          <Row
                            label="Sign-In Identity"
                            value={health?.hasLoginIdentity
                              ? <span class="badge">Provisioned</span>
                              : <span class="badge warning">Not Provisioned</span>}
                          />
                          <Row label="Sign-In Methods" value={access.viewAccountSecurity ? methods : 'Restricted'} />
                          <Row
                            label="Account State"
                            value={health?.accountStatus === 'active'
                              ? <span class="badge neutral">Not Restricted</span>
                              : <span class="badge warning">{titleCase(health?.accountStatus)}</span>}
                          />
                        </dl>
                      </section>

                      <section class="card">
                        <CardHead icon="key" title="Authorised Access" />
                        {!access.viewAccessAssignments ? (
                          <div class="epf-empty">Access assignments require the access-assignment capability.</div>
                        ) : assignments.isPending ? (
                          <div class="epf-loading">Loading access assignments…</div>
                        ) : !activeAssignment ? (
                          <div class="epf-empty">No access assignment is recorded for this employee.</div>
                        ) : (
                          <dl class="definition-list">
                            <Row label="Business Access Profile" value={activeAssignment.accessProfileLabel} />
                            <Row label="Assignment Source" value={titleCase(activeAssignment.assignmentType)} />
                            <Row
                              label="Organisation Scope"
                              value={activeAssignment.scopes.find(scope => scope.scopeType === 'organisation')?.scopeLabel ?? 'Whole Organisation'}
                            />
                            <Row
                              label="Department Scope"
                              value={activeAssignment.scopes.filter(scope => scope.scopeType === 'department')
                                .map(scope => scope.scopeLabel).join(', ') || 'Not Scoped'}
                            />
                            <Row label="Effective From" value={formatDate(activeAssignment.effectiveFrom)} />
                            <Row label="Granted By" value={activeAssignment.grantedByName ?? DASH} />
                          </dl>
                        )}
                      </section>
                    </div>

                    {activeAssignment && (
                      <section class="access-profile">
                        <div class="access-profile-head">
                          <div class="access-profile-title">
                            <span class="access-icon"><PageIcon id="shield" /></span>
                            <div>
                              <strong>{activeAssignment.accessProfileLabel} Access Profile</strong>
                              <span>The current approved business-access assignment for this employee.</span>
                            </div>
                          </div>
                          <span class={`badge ${activeAssignment.status === 'active' ? '' : 'warning'}`.trim()}>
                            {titleCase(activeAssignment.status)}
                          </span>
                        </div>
                        <div class="access-profile-facts">
                          <div><span>Source</span><strong>{titleCase(activeAssignment.assignmentType)}</strong></div>
                          <div>
                            <span>Scope</span>
                            <strong>{activeAssignment.scopes.map(scope => scope.scopeLabel).join(', ') || 'Organisation'}</strong>
                          </div>
                          <div><span>Effective</span><strong>{formatDate(activeAssignment.effectiveFrom)}</strong></div>
                          <div><span>MFA Policy</span><strong>{activeAssignment.requiresMfa ? 'Required' : 'Standard'}</strong></div>
                          <div>
                            <span>Exceptions</span>
                            <strong>{activeAssignment.requiresMfa && access.viewAccountSecurity && !mfaEnabled
                              ? 'MFA Not Enrolled' : 'None'}</strong>
                          </div>
                        </div>
                      </section>
                    )}

                    <div class="security-support-grid">
                      <section class="card">
                        <CardHead icon="shield" title="Account Health" />
                        <div class="access-help-note compact">
                          <PageIcon id="info" />
                          <span>HR sees whether this employee needs account help. Technical administration is handled elsewhere.</span>
                        </div>
                        <div class="security-list">
                          {(() => {
                            // Ranked most-blocking first, so the row names the one
                            // thing HR should act on rather than the longest list.
                            const concern = !health
                              ? { title: 'Account Health Is Restricted', detail: 'Your role cannot see this employee’s account state.', tone: 'neutral' }
                              : health.accountStatus !== 'active'
                                ? { title: 'Account Is Not Active', detail: `The account state is ${titleCase(health.accountStatus)}.`, tone: 'warning' }
                                : !health.hasLoginIdentity
                                  ? { title: 'No Sign-In Identity', detail: 'This employee has no sign-in account provisioned.', tone: 'warning' }
                                  : access.viewAccountSecurity && !mfaEnabled && activeAssignment?.requiresMfa
                                    ? { title: 'MFA Is Required But Not Enrolled', detail: 'The assigned access profile requires multi-factor authentication.', tone: 'danger' }
                                    : null;
                            return concern ? (
                              <div class="security-row">
                                <span class="access-icon"><PageIcon id="alert" /></span>
                                <div class="security-copy"><strong>{concern.title}</strong><span>{concern.detail}</span></div>
                                <span class={`badge ${concern.tone}`}>Needs Help</span>
                              </div>
                            ) : (
                              <div class="security-row">
                                <span class="access-icon"><PageIcon id="check" /></span>
                                <div class="security-copy">
                                  <strong>No Account Concerns</strong>
                                  <span>No lockout, suspension, or unresolved sign-in warning requires HR action</span>
                                </div>
                                <span class="badge">Healthy</span>
                              </div>
                            );
                          })()}
                        </div>
                      </section>

                      <section class="card">
                        <CardHead
                          icon="headset" title="Account Assistance"
                          action={
                            <button
                              class="link" type="button" style="margin-left:auto"
                              onClick={() => setDialog({ kind: 'account-history' })}
                            >View Request History</button>
                          }
                        />
                        <div class="access-help-note compact">
                          <PageIcon id="info" />
                          <span>Track the employee&rsquo;s current account-support request or submit a new request when help is needed.</span>
                        </div>
                        {supportRequests.isPending && <div class="epf-loading">Loading account requests…</div>}
                        {supportRequests.isError && (
                          <div class="epf-empty">Account requests are not available to your role.</div>
                        )}
                        {supportRequests.data?.length === 0 && (
                          <div class="epf-empty">No account support requests have been raised for this employee.</div>
                        )}
                        {supportRequests.data && supportRequests.data.length > 0 && (
                          <div class="support-request-list">
                            {supportRequests.data.slice(0, 3).map(request => {
                              const badge = supportStatusBadge(request.status);
                              return (
                                <div class="support-request" key={request.id}>
                                  <div>
                                    <strong>{request.requestedAction ?? request.subject}</strong>
                                    <span>{request.ticketNumber} · Submitted {formatDate(request.createdAt)}</span>
                                    <small>Owner: Account Support</small>
                                  </div>
                                  <span class={`badge ${badge.tone}`.trim()}>{badge.label}</span>
                                </div>
                              );
                            })}
                          </div>
                        )}
                        <button
                          class="button primary" type="button" style="margin-top:12px;align-self:flex-end"
                          onClick={() => setDialog({ kind: 'account-assistance' })}
                        >Request Assistance</button>
                      </section>
                    </div>
                  </>
                );
              })()}
            </section>
          )}

          {/* ── Activity & Audit ────────────────────────────────────────── */}
          {tab === 'activity' && (
            <section class="tab-panel active" id="panel-activity" role="tabpanel" aria-labelledby="tab-activity">
              <SectionHead
                title="Activity &amp; Audit"
                text="A practical history of changes to this employee record, who made them, and what still requires action."
                actions={
                  <button class="button" type="button" onClick={() => setDialog({ kind: 'export-audit' })}>
                    <PageIcon id="download" />Export Audit History
                  </button>
                }
              />
              {audit.isPending && <div class="epf-loading" role="status">Loading audit history…</div>}
              {audit.isError && (
                <div class="epf-error" role="alert">
                  {audit.error instanceof Error ? audit.error.message : 'Audit history could not be loaded.'}
                </div>
              )}
              {audit.data && (() => {
                const rows = audit.data;
                const visible = filterAuditRows(rows, activityFilters);
                const actors = auditActors(rows);
                const monthCount = changesThisMonth(rows);
                return (
                  <>
                    <div class="activity-summary">
                      <div class="activity-summary-item">
                        <span class="attention-ico"><PageIcon id="clock" /></span>
                        <div><span>Last Record Change</span><strong>{formatDate(rows[0]?.created_at)}</strong></div>
                      </div>
                      <div class="activity-summary-item">
                        <span class="attention-ico"><PageIcon id="edit" /></span>
                        <div><span>Changes This Month</span><strong>{monthCount} Recorded</strong></div>
                      </div>
                      <div class="activity-summary-item">
                        <span class="attention-ico"><PageIcon id="lock" /></span>
                        <div>
                          <span>Recorded Events</span>
                          <strong>{rows.length} In This View</strong>
                        </div>
                      </div>
                    </div>

                    <div class="document-toolbar activity-toolbar">
                      <label class="document-search">
                        <PageIcon id="search" />
                        <input
                          type="search" placeholder="Search employee activity" aria-label="Search employee activity"
                          value={activityFilters.search}
                          onInput={event => setActivityFilters({ ...activityFilters, search: event.currentTarget.value })}
                        />
                      </label>
                      <select
                        class="document-filter-select" aria-label="Filter by activity area"
                        value={activityFilters.area}
                        onChange={event => setActivityFilters({
                          ...activityFilters, area: event.currentTarget.value as ActivityArea | 'all',
                        })}
                      >
                        <option value="all">All Activity Areas</option>
                        {(Object.keys(ACTIVITY_AREA_LABEL) as ActivityArea[]).map(area => (
                          <option key={area} value={area}>{ACTIVITY_AREA_LABEL[area]}</option>
                        ))}
                      </select>
                      <select
                        class="document-filter-select" aria-label="Filter by date range"
                        value={activityFilters.range}
                        onChange={event => setActivityFilters({
                          ...activityFilters, range: event.currentTarget.value as ActivityRange,
                        })}
                      >
                        {ACTIVITY_RANGES.map(option => (
                          <option key={option.value} value={option.value}>{option.label}</option>
                        ))}
                      </select>
                      <select
                        class="document-filter-select" aria-label="Filter by actor"
                        value={activityFilters.actor}
                        onChange={event => setActivityFilters({ ...activityFilters, actor: event.currentTarget.value })}
                      >
                        <option value="all">Changed By: Anyone</option>
                        {actors.map(actor => <option key={actor} value={actor}>{actor}</option>)}
                      </select>
                      <button
                        class="button filter-reset" type="button"
                        disabled={!hasActivityFilters(activityFilters)}
                        onClick={() => setActivityFilters(EMPTY_ACTIVITY_FILTERS)}
                      >Clear Filters</button>
                    </div>

                    {visible.length === 0 ? (
                      <div class="epf-empty">
                        {rows.length === 0
                          ? 'No activity has been recorded for this employee yet.'
                          : 'No recorded activity matches the selected filters.'}
                      </div>
                    ) : (
                      <div class="table-wrap activity-table-wrap">
                        <table class="data-table">
                          <thead>
                            <tr><th>Date &amp; Time</th><th>Activity</th><th>Area</th><th>Changed By</th><th>Reason</th><th /></tr>
                          </thead>
                          <tbody>
                            {visible.map(entry => {
                              const area = activityArea(entry.submodule_key);
                              const actor = entry.actorName ?? 'System';
                              return (
                                <tr class={`event-${area}`} key={entry.id}>
                                  <td>{formatDate(entry.created_at)}<small>{formatDateTime(entry.created_at).slice(-5)}</small></td>
                                  <td><strong>{activityTitle(entry.action)}</strong><small>{entry.action}</small></td>
                                  <td><span class="activity-area">{ACTIVITY_AREA_LABEL[area]}</span></td>
                                  <td>
                                    <div class="actor-cell">
                                      <span class="actor-avatar">{initialsOf(actor)}</span>
                                      <div><strong>{actor}</strong><small>{titleCase(entry.submodule_key ?? 'employee record')}</small></div>
                                    </div>
                                  </td>
                                  <td>{entry.reason ?? DASH}</td>
                                  <td>
                                    <button class="link" type="button" onClick={() => setDialog({ kind: 'activity', entry })}>
                                      View Change
                                    </button>
                                  </td>
                                </tr>
                              );
                            })}
                          </tbody>
                        </table>
                      </div>
                    )}
                    <p class="activity-note">
                      <PageIcon id="info" />
                      Times are displayed in UTC. Sensitive values and technical correlation details are shown only to
                      authorised audit reviewers.
                    </p>
                  </>
                );
              })()}
            </section>
          )}

          {/* ── Offboarding ─────────────────────────────────────────────── */}
          {tab === 'offboarding' && (
            <section class="tab-panel active" id="panel-offboarding" role="tabpanel" aria-labelledby="tab-offboarding">
              <SectionHead
                title="Offboarding"
                text="Controlled termination, resignation, retirement, redundancy, and contract-completion workflows."
              />
              {offboardingCases.isPending && <div class="epf-loading" role="status">Loading offboarding cases…</div>}
              {offboardingCases.isError && (
                <div class="epf-error" role="alert">
                  {offboardingCases.error instanceof Error ? offboardingCases.error.message : 'Offboarding cases could not be loaded.'}
                </div>
              )}
              {offboardingCases.data && !phase.active && (
                <div class="offboarding-empty">
                  <div>
                    <span class="offboarding-empty-icon"><PageIcon id="exit" /></span>
                    <h3>No Active Offboarding Case</h3>
                    <p>Starting offboarding creates a governed case, assigns an owner, schedules required tasks, and hands
                      account-removal work to the authorised support receiver.</p>
                    {access.startOffboarding && (
                      <button class="button danger" type="button" onClick={() => setDialog({ kind: 'start-offboarding' })}>
                        <PageIcon id="exit" />Start Offboarding
                      </button>
                    )}
                    <div class="offboarding-flow" aria-label="Offboarding workflow">
                      {([
                        ['Create Case', 'Capture reason, last working day and accountable owner.'],
                        ['Assign Work', 'Schedule HR, payroll and department completion tasks.'],
                        ['Secure Access', 'Route account removal to the authorised support owner.'],
                        ['Close Record', 'Verify evidence, final status and complete the audit trail.'],
                      ] as [string, string][]).map(([title, text], index) => (
                        <div class="offboarding-step" key={title}>
                          <span>Step {index + 1}</span><strong>{title}</strong><small>{text}</small>
                        </div>
                      ))}
                    </div>
                    <div class="offboarding-notes">
                      <span><PageIcon id="shield" />Permission Required</span>
                      <span><PageIcon id="clock" />Audited Workflow</span>
                      <span><PageIcon id="users" />Cross-Team Handoffs</span>
                    </div>
                  </div>
                </div>
              )}

              {phase.active && (
                <section class="offboarding-case">
                  <div class="section-head">
                    <div>
                      <h2>Active Offboarding Case</h2>
                      <p>Case {phase.active.caseNo} is coordinating the employee&rsquo;s final working arrangements.</p>
                    </div>
                    <div class="section-actions">
                      <span class={`badge ${phase.active.status === 'blocked' ? 'danger' : 'warning'}`}>
                        {titleCase(phase.active.status)}
                      </span>
                      <button class="button primary" type="button" onClick={() => showSection('s-hr-offboarding')}>
                        Open Offboarding Workspace
                      </button>
                    </div>
                  </div>
                  <div class="offboarding-case-summary">
                    <div><span>Last Working Day</span><strong>{formatDate(phase.active.lastWorkingDay)}</strong></div>
                    <div><span>Case Owner</span><strong>{phase.active.ownerName ?? 'Not Assigned'}</strong></div>
                    <div><span>Reason</span><strong>{titleCase(phase.active.reason)}</strong></div>
                    <div>
                      <span>Tasks Complete</span>
                      <strong>{taskCompletion(phase.active.taskCount, phase.active.openTaskCount)}</strong>
                    </div>
                  </div>
                  {offboardingDetail.isPending && <div class="epf-loading">Loading case tasks…</div>}
                  {offboardingDetail.data && (
                    <div class="offboarding-task-list">
                      {offboardingDetail.data.tasks.length === 0 && (
                        <div class="epf-empty">This case has no scheduled tasks.</div>
                      )}
                      {offboardingDetail.data.tasks.map(task => {
                        const badge = offboardingTaskBadge(task.status);
                        return (
                          <div class="offboarding-task" key={task.id}>
                            <span class="access-icon">
                              <PageIcon id={task.status === 'completed' ? 'check' : 'file'} />
                            </span>
                            <div>
                              <strong>{task.taskTitle}</strong>
                              <small>{task.dueAt ? `Due ${formatDate(task.dueAt)}` : 'No due date recorded'}</small>
                            </div>
                            <span>{task.assignedToName ?? titleCase(task.ownerRole ?? task.moduleKey ?? 'Unassigned')}</span>
                            <span class={`badge ${badge.tone}`.trim()}>{badge.label}</span>
                          </div>
                        );
                      })}
                      {offboardingDetail.data.handoffs.map(handoff => (
                        <div class="offboarding-task" key={handoff.id}>
                          <span class="access-icon"><PageIcon id="lock" /></span>
                          <div>
                            <strong>{titleCase(handoff.handoffType ?? handoff.handoffKey ?? 'Cross-Module Handoff')}</strong>
                            <small>Raised {formatDate(handoff.createdAt)}</small>
                          </div>
                          <span>{titleCase(handoff.targetModule)}</span>
                          <span class={`badge ${handoff.status === 'delivered' ? '' : 'warning'}`.trim()}>
                            {titleCase(handoff.status)}
                          </span>
                        </div>
                      ))}
                    </div>
                  )}
                </section>
              )}

              {offboardingCases.data && (
                <section class="card offboarding-history">
                  <CardHead icon="clock" title="Offboarding History" />
                  {phase.history.length === 0 ? (
                    <div class="offboarding-state-card">
                      <span class="offboarding-empty-icon"><PageIcon id="check" /></span>
                      <div class="offboarding-state-copy">
                        <strong>No Previous Offboarding Cases</strong>
                        <span>Completed or cancelled cases will remain available here as protected employee history.</span>
                      </div>
                      <span class="badge neutral">None</span>
                    </div>
                  ) : phase.history.map(row => (
                    <div class="offboarding-state-card" key={row.id}>
                      <span class="offboarding-empty-icon"><PageIcon id="check" /></span>
                      <div class="offboarding-state-copy">
                        <strong>{row.caseNo} · {titleCase(row.reason)}</strong>
                        <span>
                          {row.completedAt ? `Completed ${formatDate(row.completedAt)}` : `Started ${formatDate(row.startedAt)}`}
                          {row.ownerName ? ` · Case owner ${row.ownerName}` : ''}
                        </span>
                      </div>
                      <span class={`badge ${row.status === 'completed' ? '' : 'neutral'}`.trim()}>
                        {titleCase(row.status)}
                      </span>
                    </div>
                  ))}
                </section>
              )}
            </section>
          )}
        </div>
      </div>

      {/* ── The ten dialogs ──────────────────────────────────────────────── */}
      {dialog?.kind === 'edit' && (
        <EditEmployeeDialog
          employeeId={employeeId} shell={shell} detail={detail} statutory={detail?.statutory}
          access={access} onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'request-change' && (
        <RequestChangeDialog employeeId={employeeId} shell={shell} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'add-document' && (
        <AddDocumentDialog employeeId={employeeId} shell={shell} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'export-index' && (
        <ExportIndexDialog employeeId={employeeId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'export-audit' && (
        <ExportAuditDialog employeeId={employeeId} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'account-assistance' && (
        <AccountAssistanceDialog
          employeeId={employeeId} shell={shell} onClose={() => setDialog(null)}
          onOpenHistory={() => setDialog({ kind: 'account-history' })}
        />
      )}
      {dialog?.kind === 'account-history' && (
        <AccountRequestHistoryDialog
          employeeId={employeeId} employeeName={identity.displayName} onClose={() => setDialog(null)}
        />
      )}
      {dialog?.kind === 'start-offboarding' && (
        <StartOffboardingDialog employeeId={employeeId} shell={shell} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'readiness' && (
        <ReadinessReviewDialog employeeId={employeeId} entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
      {dialog?.kind === 'activity' && (
        <ActivityChangeDialog entry={dialog.entry} onClose={() => setDialog(null)} />
      )}
    </div>
  );
}
