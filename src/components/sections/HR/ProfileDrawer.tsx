/**
 * src/components/sections/HR/ProfileDrawer.tsx
 *
 * HR ▸ Employee Master — the employee profile drawer, rebuilt to emit the DOM of
 * the LOCKED reference `docs/mockups/employee-profile-drawer-unified-command-brief.html`.
 *
 * This is a REPLACEMENT, not an adaptation. The previous drawer composed the @ui
 * primitives (Drawer/EntityHead/PanelStats/InfoCard/FieldList/MiniTable), which
 * render a different structure from the approved one; the implementation
 * contract forbids substituting a generic UI-kit component where doing so
 * changes the approved appearance. Every class name below is the mockup's own,
 * scoped under `.epd-root` by the generated stylesheet.
 *
 * STYLING — two stylesheets, one job each:
 *   ProfileDrawer.mockup.css  generated verbatim from the locked reference; owns
 *                             every content style. Never hand-edited.
 *   ProfileDrawer.css         production chrome only (overlay, backdrop, slide-in,
 *                             approved drawer width). The mockup is a static page
 *                             with no overlay, so this cannot come from it.
 *
 * THEME comes only from the global `body[data-theme="dark"]`, which the generated
 * stylesheet already scopes. There is deliberately no local theme control.
 *
 * DATA — the shell opens the drawer; every large dataset is tab-scoped and loads
 * only when its tab is selected, so switching employees costs one request.
 */

import { type VNode } from 'preact';
import { useEffect, useMemo, useRef, useState } from 'preact/hooks';
import { toast } from '@store';
import { ListSkeleton, Skeleton, SkeletonFields, SkeletonText } from '@ui';
import {
  useEmployeeProfileShell, useEmployeeAttention, tabIndicatorFor,
  type ProfileTabKey, type EmployeeAttentionItem, type EmployeeProfileShell,
} from '@api/hr/employeeProfile';
import {
  useReadinessMatrix, useEmployeeDocumentHealth, useEmployeeAccessAssignments,
  useEmploymentDetail, useReadinessFollowUp,
  type DocumentHealthGroup, type ReadinessControlMatrixEntry,
} from '@api/hr/employeeReadiness';
import { useHrAudit, useUpdateHrContact } from '@api/hr/employees';
import {
  DASH, DRAWER_TABS, DRAWER_TAB_LABEL, titleCase, formatDate, formatDateTime,
  formatTenure, formatNoticePeriod, formatWeeklyHours, formatArrangementAndFte,
  probationState, readinessLabel, readinessExplanation, readinessHeadline,
  attentionSubtitle, severityToneClass, tabAriaLabel, visibleTabs, identitySubtitle,
} from './employeeProfileModel';
import {
  exportDocumentIndex, exportReadinessBreakdown, exportAuditHistory,
} from '@api/hr/employeeExports';
import { ProfileIconSprite, Icon, type ProfileIconId } from './profile/ProfileIconSprite';
import type { EmployeeMasterAccess } from './employeeMasterAccess';
import './ProfileDrawer.mockup.css';
import './ProfileDrawer.css';

export interface ProfileDrawerProps {
  employeeId: string | null;
  onClose: () => void;
  /** Routed to EmployeeMaster's dialog map. Labels match its `openAction` keys. */
  onAction: (label: string) => void;
  /**
   * Leave the drawer and open the full employee record at the requested tab.
   * The drawer tab strip remains local navigation; contextual links drill through.
   */
  onOpenFullRecord?: ((tab: ProfileTabKey) => void) | undefined;
  access: EmployeeMasterAccess;
}

/** Attention domain → the mockup's icon for that row. */
const DOMAIN_ICON: Record<EmployeeAttentionItem['domain'], ProfileIconId> = {
  employment: 'briefcase', statutory: 'shield', payroll: 'key', documents: 'file',
  training: 'calendar', access: 'lock', onboarding: 'user', offboarding: 'user',
};

/** Readiness domain → matrix row icon. */
const CONTROL_ICON: Record<string, ProfileIconId> = {
  assignment: 'briefcase', payroll: 'key', training: 'calendar',
  documents: 'file', statutory: 'shield', access: 'lock',
};

/** Document health state → the approved pill text and tone. */
const DOC_STATE_LABEL: Record<string, { label: string; tone: string }> = {
  verified:   { label: 'Verified',   tone: '' },
  current:    { label: 'Current',    tone: '' },
  expiring:   { label: 'Expiring',   tone: 'warn' },
  expired:    { label: 'Expired',    tone: 'danger' },
  unverified: { label: 'Unverified', tone: 'warn' },
  missing:    { label: 'Missing',    tone: 'danger' },
};

/** Activity area → timeline icon and tone, from the record's own area field. */
function activityVisual(area: string): { icon: ProfileIconId; tone: string } {
  if (area.includes('document')) return { icon: 'file', tone: '' };
  if (area.includes('readiness') || area.includes('training')) return { icon: 'check', tone: 'green' };
  if (area.includes('access')) return { icon: 'lock', tone: '' };
  if (area.includes('offboard')) return { icon: 'alert', tone: 'amber' };
  return { icon: 'briefcase', tone: 'amber' };
}

/** A value row inside the approved `.data-list` grid. */
function DataRow({ label, value }: { label: string; value: VNode | string | null }): VNode {
  return <><span>{label}</span><strong>{value ?? DASH}</strong></>;
}

/**
 * The approved semicircle uses a red-to-green gradient only when progress
 * exists. At 0%, drawing a zero-length round-capped gradient path exposes both
 * gradient endpoints in some browsers, producing a false green marker. Render
 * one explicit red origin marker instead.
 */
function ReadinessGauge({
  percent, label,
}: {
  percent: number;
  label: string;
}): VNode {
  return (
    <svg class="gauge" viewBox="0 0 140 92" role="img" aria-label={`${percent} percent ready`}>
      <path class="gauge-track" pathLength="100" d="M15 76 A55 55 0 0 1 125 76" />
      {percent > 0
        ? (
          <path
            class="gauge-value" pathLength="100" d="M15 76 A55 55 0 0 1 125 76"
            style={{ strokeDasharray: `${percent} 100` }}
          />
        )
        : <circle class="gauge-zero-dot" cx="15" cy="76" r="6.5" />}
      <text class="gauge-score" x="70" y="67">{percent}%</text>
      <text class="gauge-label" x="70" y="84">{label}</text>
    </svg>
  );
}

/** Cold-path drawer shell built entirely from the shared SIOMAC skeleton kit. */
function ProfileDrawerSkeleton({ onClose }: { onClose: () => void }): VNode {
  return (
    <div class="epd-overlay" role="presentation">
      <div class="epd-root">
        <ProfileIconSprite />
        <main class="drawer" aria-busy="true" aria-label="Loading employee profile">
          <span class="sr-only" role="status">Loading employee profile…</span>
          <header class="topbar">
            <div class="brand"><strong>SIOMAC</strong><span>Employee Profile</span></div>
            <button class="icon-btn" type="button" aria-label="Close employee profile" onClick={onClose}>
              <Icon id="close" />
            </button>
          </header>
          <section class="identity">
            <div class="identity-grid">
              <Skeleton circle width={80} />
              <div style={{ display: 'grid', gap: '10px', alignContent: 'center' }}>
                <Skeleton width={240} height={24} radius={8} />
                <Skeleton width={96} height={12} radius={999} />
                <SkeletonText lines={2} width={210} lastWidth={170} />
              </div>
            </div>
            <div class="facts"><SkeletonStatStrip /></div>
          </section>
          <nav class="tabs" aria-hidden="true">
            {Array.from({ length: 6 }, (_, index) => (
              <span class="tab" key={index}><Skeleton width={index === 0 ? 62 : 74} height={12} radius={999} /></span>
            ))}
          </nav>
          <div class="scroll">
            <section class="panel active">
              <div class="overview-grid">
                {Array.from({ length: 4 }, (_, index) => (
                  <section class={`card${index > 1 ? ' wide' : ''}`} key={index}>
                    <Skeleton width="42%" height={15} radius={999} />
                    {index === 3 ? <ListSkeleton rows={3} avatar={false} /> : <SkeletonFields rows={4} />}
                  </section>
                ))}
              </div>
            </section>
          </div>
          <footer class="footer"><Skeleton width={180} height={38} radius={9} /><Skeleton width={140} height={38} radius={9} /></footer>
        </main>
      </div>
    </div>
  );
}

function SkeletonStatStrip(): VNode {
  return (
    <>
      {Array.from({ length: 4 }, (_, index) => (
        <div class="fact" key={index}>
          <Skeleton circle width={22} />
          <Skeleton width={84} height={9} radius={999} />
          <Skeleton width={index % 2 ? 72 : 96} height={12} radius={999} />
        </div>
      ))}
    </>
  );
}

function DrawerSectionSkeleton({ label, rows = 3 }: { label: string; rows?: number }): VNode {
  return (
    <div aria-busy="true">
      <span class="sr-only" role="status">{label}</span>
      <SkeletonFields rows={rows} />
    </div>
  );
}

export function ProfileDrawer({
  employeeId, onClose, onAction, onOpenFullRecord, access,
}: ProfileDrawerProps): VNode | null {
  const [tab, setTab] = useState<ProfileTabKey>('overview');
  const [menuOpen, setMenuOpen] = useState(false);
  const [contactOpen, setContactOpen] = useState(false);
  const [attentionPage, setAttentionPage] = useState(0);
  // The audit export refuses without a business reason, so it always prompts —
  // it is never a one-click extraction of an audit trail.
  const [auditExportOpen, setAuditExportOpen] = useState(false);
  /** Which export is currently running, so its button can show progress. */
  const [exporting, setExporting] = useState<string | null>(null);

  const shellQuery = useEmployeeProfileShell(employeeId);
  const shell = shellQuery.data;

  // Reset per-employee UI state on switch, so a newly selected employee never
  // inherits the previous one's open tab, expanded attention list or menu.
  useEffect(() => {
    setTab('overview'); setMenuOpen(false); setContactOpen(false);
    setAttentionPage(0); setAuditExportOpen(false);
  }, [employeeId]);

  const tabs = useMemo(() => visibleTabs(shell, DRAWER_TABS), [shell]);
  // A capability-gated tab can disappear once the shell resolves; fall back to
  // overview rather than render an empty panel for a tab that no longer exists.
  useEffect(() => { if (!tabs.includes(tab)) setTab('overview'); }, [tabs, tab]);

  // Tab-scoped datasets. `enabled` keeps each one off until its tab is opened,
  // so opening the drawer costs the shell request alone.
  // The shell supplies the first two rows. The complete list is fetched only
  // when the pager is used; refetch() works even while this query is disabled.
  const attentionQuery = useEmployeeAttention(employeeId, false);
  const documentHealth = useEmployeeDocumentHealth(
    employeeId, access.viewDocuments && (tab === 'overview' || tab === 'documents'));
  const employment = useEmploymentDetail(employeeId, tab === 'employment');
  const readiness = useReadinessMatrix(employeeId, access.viewReadiness && tab === 'readiness');
  const assignments = useEmployeeAccessAssignments(
    employeeId, false, access.viewAccessAssignments && tab === 'access');
  const audit = useHrAudit(tab === 'activity' && access.viewAudit ? employeeId : null);

  const followUp = useReadinessFollowUp();
  const updateContact = useUpdateHrContact();

  const closeRef = useRef<HTMLButtonElement>(null);
  useEffect(() => { closeRef.current?.focus(); }, [employeeId]);

  // Escape closes the top-most layer first, then the drawer.
  useEffect(() => {
    function onKey(e: KeyboardEvent): void {
      if (e.key !== 'Escape') return;
      if (contactOpen) { setContactOpen(false); return; }
      if (menuOpen) { setMenuOpen(false); return; }
      onClose();
    }
    window.addEventListener('keydown', onKey);
    return () => window.removeEventListener('keydown', onKey);
  }, [contactOpen, menuOpen, onClose]);

  if (!employeeId) return null;

  const identity = shell?.identity;
  const facts = shell?.employment;
  const attentionSource: EmployeeAttentionItem[] =
    attentionQuery.data?.items ?? shell?.attentionPreview ?? [];
  const attentionItems = attentionSource.slice(attentionPage * 2, (attentionPage * 2) + 2);
  const attentionTotal = shell?.attentionTotal ?? 0;

  function runAction(label: string): void { setMenuOpen(false); onAction(label); }

  /**
   * Run an export and report its outcome.
   *
   * The drawer offers only the default CSV form of each export; the full page
   * carries the format/scope dialogs. The correlation id is surfaced so the
   * downloaded file can be tied to its audit row.
   */
  async function runExport(kind: string, run: () => Promise<{ fileName: string; rowCount: number }>): Promise<void> {
    setExporting(kind);
    try {
      const outcome = await run();
      toast.success(`${outcome.fileName} exported · ${outcome.rowCount} rows.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Export failed.');
    } finally {
      setExporting(null);
    }
  }

  /** Attention work is resolved on the full record, at the domain named by the backend. */
  function openAttention(item: EmployeeAttentionItem): void {
    onOpenFullRecord?.(item.actionTarget);
  }

  async function showNextAttentionPage(): Promise<void> {
    let allItems = attentionQuery.data?.items;
    if (!allItems) {
      const result = await attentionQuery.refetch();
      allItems = result.data?.items;
      if (!allItems) {
        toast.error('The remaining attention items could not be loaded.');
        return;
      }
    }
    const pageCount = Math.max(1, Math.ceil(allItems.length / 2));
    setAttentionPage(page => (page + 1) % pageCount);
  }

  async function sendReadinessReminder(entry: ReadinessControlMatrixEntry): Promise<void> {
    if (!employeeId) return;
    if (entry.owner.status !== 'resolved') {
      // Fail closed in the UI exactly as the backend does, and name the fix.
      toast.error(`Owner Required — ${entry.owner.reason ?? 'no owner is configured for this readiness area.'}`);
      return;
    }
    try {
      const result = await followUp.mutateAsync({
        employeeId, controlKey: entry.control.controlKey,
        workItemId: entry.workItem?.id ?? null, action: 'send_reminder',
      });
      toast.success(`Reminder sent to ${entry.owner.ownerLabel ?? 'the owner'} · ${result.notified} notified.`);
    } catch (e) {
      toast.error(e instanceof Error ? e.message : 'Reminder failed.');
    }
  }

  async function submitContact(e: Event): Promise<void> {
    e.preventDefault();
    if (!employeeId) return;
    const fd = new FormData(e.target as HTMLFormElement);
    // FormData values may be File; only a string is a contact value.
    const str = (k: string): string => {
      const value = fd.get(k);
      return typeof value === 'string' ? value.trim() : '';
    };
    try {
      const res = await updateContact.mutateAsync({
        employeeId,
        // `direct` when the actor may edit outright, otherwise the SAME form
        // raises a tracked change request — the backend decides either way.
        mode: access.editContact ? 'direct' : 'request',
        work: { email: str('workEmail'), phone: str('workPhone') || null, mobilePhone: str('mobile') || null },
        emergency: {
          name: str('emergencyName') || null,
          phone: str('emergencyPhone') || null,
          relationship: str('relationship') || null,
        },
      });
      toast.success(res.data.mode === 'request'
        ? `Change request ${res.data.changeNo ?? ''} submitted for approval.`.trim()
        : 'Contact information updated.');
      setContactOpen(false);
      void shellQuery.refetch();
    } catch (err) {
      toast.error(err instanceof Error ? err.message : 'Contact update failed.');
    }
  }

  if (employeeId && !shellQuery.ready && !shellQuery.isError) {
    return <ProfileDrawerSkeleton onClose={onClose} />;
  }

  return (
    <div class="epd-overlay" role="presentation" onClick={e => { if (e.target === e.currentTarget) onClose(); }}>
      <div class="epd-root">
        <ProfileIconSprite />

        <main class="drawer" aria-label="Employee profile">
          <header class="topbar">
            <div class="brand"><strong>SIOMAC</strong><span>Employee Profile</span></div>
            <div class="top-actions">
              <div class="action-menu-wrap">
                <button
                  class="icon-btn" type="button" aria-label="More employee actions"
                  aria-haspopup="menu" aria-expanded={menuOpen}
                  onClick={() => setMenuOpen(o => !o)}
                ><Icon id="more" /></button>
                {menuOpen && (
                  <div class="action-menu" role="menu">
                    {/* Only implemented, capability-appropriate actions appear here. */}
                    {access.editEmployee && (
                      <button type="button" role="menuitem" onClick={() => runAction('Edit Contact')}>Edit Employee</button>
                    )}
                    {access.changeStatus && (
                      <button type="button" role="menuitem" onClick={() => runAction('Change Status')}>Change Employment Status</button>
                    )}
                    {access.startOffboarding && (
                      <button class="danger" type="button" role="menuitem" onClick={() => runAction('Start Offboarding')}>Start Offboarding</button>
                    )}
                  </div>
                )}
              </div>
              <button ref={closeRef} class="icon-btn" type="button" aria-label="Close employee profile" onClick={onClose}>
                <Icon id="close" />
              </button>
            </div>
          </header>

          <section class="identity">
            <div class="identity-grid">
              <div class="portrait-shell">
                {identity?.profileImageUrl
                  ? <img src={identity.profileImageUrl} alt={identity.displayName} />
                  : <span class="portrait-fallback" aria-hidden="true">
                      {(identity?.displayName ?? '?').slice(0, 1).toUpperCase()}
                    </span>}
                <span class="presence" aria-label={titleCase(identity?.employmentStatus)} />
              </div>
              <div>
                <div class="name-line">
                  <h1>{identity?.displayName ?? DASH}</h1>
                  <span class="status">{titleCase(identity?.employmentStatus)}</span>
                </div>
                <div class="employee-no">{identity?.employeeNo ?? DASH}</div>
                <div class="identity-lines">
                  <span><Icon id="briefcase" />{identity?.position ?? DASH}</span>
                  <span><Icon id="building" />{shell ? identitySubtitle(shell) : DASH}</span>
                </div>
              </div>
            </div>
            <div class="facts">
              <div class="fact"><Icon id="shield" /><span>Employment Basis</span><strong>{titleCase(facts?.employmentBasis)}</strong></div>
              <div class="fact"><Icon id="clock" /><span>Work Arrangement</span><strong>{facts?.workArrangement ?? DASH}</strong></div>
              <div class="fact"><Icon id="calendar" /><span>Start Date</span><strong>{formatDate(facts?.startDate)}</strong></div>
              <div class="fact"><Icon id="clock" /><span>Tenure</span><strong>{formatTenure(facts?.tenureMonths)}</strong></div>
            </div>
          </section>

          <nav class="tabs" role="tablist" aria-label="Employee profile sections">
            {tabs.map(key => {
              const indicator = tabIndicatorFor(shell?.tabIndicators, key);
              return (
                <button
                  key={key} class={`tab${tab === key ? ' active' : ''}`} role="tab"
                  aria-selected={tab === key} data-tab={key}
                  aria-label={tabAriaLabel(key, indicator)}
                  onClick={() => setTab(key)}
                >
                  {DRAWER_TAB_LABEL[key]}
                  {indicator && (
                    <span class={`badge ${severityToneClass(indicator.highestSeverity)}`.trim()}>
                      {indicator.unresolvedCount}
                    </span>
                  )}
                </button>
              );
            })}
          </nav>

          <div class="scroll">
            {shellQuery.isError && (
              <div class="epd-error" role="alert">
                {shellQuery.error instanceof Error ? shellQuery.error.message : 'Employee profile failed to load.'}
              </div>
            )}

            {shell && tab === 'overview' && (
              <section class="panel active" id="panel-overview" role="tabpanel">
                <section class="attention-strip">
                  <div class="attention-title">
                    <span class="attention-heading-icon"><Icon id="alert" /></span>
                    Needs Attention <span class="badge warning">{attentionTotal}</span>
                  </div>
                  {attentionItems.length === 0 && (
                    <article class="attention-item">
                      <span class="attention-ico"><Icon id="check" /></span>
                      <div><strong>Nothing Needs Attention</strong><span>Every tracked item for this employee is resolved.</span></div>
                    </article>
                  )}
                  {attentionItems.map((item, i) => (
                    <article
                      key={item.id}
                      class={`attention-item${item.severity === 'critical' ? ' danger' : ''}`}
                      role="link" tabIndex={0}
                      onClick={() => openAttention(item)}
                      onKeyDown={e => { if (e.key === 'Enter' || e.key === ' ') openAttention(item); }}
                    >
                      <span class="attention-ico"><Icon id={DOMAIN_ICON[item.domain]} /></span>
                      <div><strong>{item.title}</strong><span>{attentionSubtitle(item)}</span></div>
                      {i === attentionItems.length - 1 && attentionTotal > 2
                        ? (
                          <button
                            class="attention-next" type="button"
                            aria-label="Show the next attention items"
                            disabled={attentionQuery.isFetching}
                            onClick={e => { e.stopPropagation(); void showNextAttentionPage(); }}
                          ><Icon id="chevron" /></button>
                        )
                        : <Icon id="chevron" />}
                    </article>
                  ))}
                </section>

                <div class="overview-grid">
                  {shell.readiness && (
                    <section class="card">
                      <div class="card-head"><Icon id="shield" /><h3>Record Readiness</h3>
                        <button class="text-btn" type="button" onClick={() => onOpenFullRecord?.('readiness')}>Details<Icon id="chevron" /></button>
                      </div>
                      <div class="readiness-body">
                        <ReadinessGauge
                          percent={shell.readiness.percent}
                          label={readinessLabel(shell.readiness)}
                        />
                        <div class="readiness-copy">
                          <strong>{readinessHeadline(shell.readiness)}</strong>
                          <p>{readinessExplanation(shell.readiness)}</p>
                        </div>
                      </div>
                    </section>
                  )}

                  <section class="card">
                    <div class="card-head"><Icon id="briefcase" /><h3>Employment Snapshot</h3>
                      <button class="text-btn" type="button" onClick={() => onOpenFullRecord?.('employment')}>Employment<Icon id="chevron" /></button>
                    </div>
                    <div class="data-list">
                      <DataRow label="Legal Employer" value={facts?.legalEmployer ?? DASH} />
                      <DataRow label="Cost Centre" value={facts?.costCentre ?? DASH} />
                      <DataRow label="Work Location" value={identity?.siteName ?? DASH} />
                      <DataRow label="Reports To" value={facts?.supervisorName ?? DASH} />
                      <DataRow label="Pay Group" value={facts?.payGroupName ?? DASH} />
                    </div>
                  </section>

                  {shell.contact && (
                    <section class="card">
                      <div class="card-head"><Icon id="user" /><h3>Contact</h3>
                        {access.editContact && (
                          <button
                            class="text-btn" type="button" title="Requires HR contact-management permission"
                            onClick={() => setContactOpen(true)}
                          ><Icon id="shield" />Edit Contact</button>
                        )}
                      </div>
                      <div class="contact-row"><Icon id="mail" /><span>Work Email</span><strong>{shell.contact.workEmail ?? DASH}</strong></div>
                      <div class="contact-row"><Icon id="phone" /><span>Work Phone</span><strong>{shell.contact.workPhone ?? DASH}</strong></div>
                      <div class="contact-row"><Icon id="mobile" /><span>Mobile</span><strong>{shell.contact.mobilePhone ?? DASH}</strong></div>
                      <div class="contact-sep" />
                      <div class="contact-row"><Icon id="user" />
                        <span>{shell.contact.emergencyContactRelationship
                          ? `Emergency Contact · ${titleCase(shell.contact.emergencyContactRelationship)}`
                          : 'Emergency Contact'}</span>
                        <strong>{[shell.contact.emergencyContactName, shell.contact.emergencyContactPhone]
                          .filter(Boolean).join(' · ') || DASH}</strong>
                      </div>
                    </section>
                  )}

                  {access.viewDocuments && (
                    <section class="card document-health-card">
                      <div class="card-head"><Icon id="file" /><h3>Document Health</h3>
                        <button class="text-btn" type="button" onClick={() => onOpenFullRecord?.('documents')}>Documents<Icon id="chevron" /></button>
                      </div>
                      <div class="doc-tree" aria-label="Employee document tree">
                        {documentHealth.isPending && <DrawerSectionSkeleton label="Loading documents…" />}
                        {documentHealth.data?.groups.length === 0 && (
                          <div class="epd-empty">No document requirements apply to this employee.</div>
                        )}
                        {documentHealth.data?.groups.map((group: DocumentHealthGroup) => (
                          <details key={group.key} open>
                            <summary>
                              <Icon id="folder" /><strong>{group.label}</strong>
                              <span class="folder-count">
                                {group.missingCount > 0
                                  ? `${group.missingCount} Missing`
                                  : group.expiringCount > 0
                                    ? `${group.expiringCount} Expiring`
                                    : `${group.currentCount} Current`}
                              </span>
                            </summary>
                            <div class="doc-tree-children">
                              {group.items.map(item => {
                                const state = DOC_STATE_LABEL[item.state] ?? { label: titleCase(item.state), tone: '' };
                                return (
                                  <div class="doc-leaf" key={`${group.key}:${item.documentId ?? item.requirementId ?? item.title}`}>
                                    <Icon id="file" class="doc-file-icon" />
                                    <div><strong>{item.title}</strong><span>{item.detail}</span></div>
                                    <span class={`doc-state ${state.tone}`.trim()}>{state.label}</span>
                                  </div>
                                );
                              })}
                            </div>
                          </details>
                        ))}
                      </div>
                    </section>
                  )}

                  {shell.accountHealth && (
                    <section class="card wide">
                      <div class="card-head"><Icon id="lock" /><h3>Account Health</h3>
                        <button class="text-btn" type="button" onClick={() => onOpenFullRecord?.('access')}>Access<Icon id="chevron" /></button>
                      </div>
                      <div class="account-grid">
                        <div class="account-stat"><span class="stat-icon"><Icon id="check" /></span><span>Account</span><strong>{titleCase(shell.accountHealth.accountStatus)}</strong></div>
                        <div class="account-stat"><span class="stat-icon"><Icon id="key" /></span><span>Sign-In Identity</span><strong>{shell.accountHealth.hasLoginIdentity ? 'Provisioned' : 'Not Provisioned'}</strong></div>
                        <div class="account-stat"><span class="stat-icon"><Icon id="shield" /></span><span>Access Profile</span><strong>{shell.accountHealth.accessProfileLabel ?? DASH}</strong></div>
                        <div class="account-stat"><span class="stat-icon"><Icon id="headset" /></span><span>Open Requests</span><strong>{shell.accountHealth.openSupportRequests}</strong></div>
                      </div>
                    </section>
                  )}

                  {access.viewAudit && (
                    <section class="card wide">
                      <div class="card-head"><Icon id="clock" /><h3>Recent Activity</h3>
                        <button class="text-btn" type="button" onClick={() => onOpenFullRecord?.('activity')}>View All<Icon id="chevron" /></button>
                      </div>
                      <div class="activity-list">
                        {shell.recentActivity.length === 0 && <div class="epd-empty">No recorded activity yet.</div>}
                        {shell.recentActivity.map(entry => {
                          const visual = activityVisual(entry.area);
                          return (
                            <div class="activity-row" key={entry.id}>
                              <span class={`activity-icon ${visual.tone}`.trim()}><Icon id={visual.icon} /></span>
                              <div class="activity-copy">
                                <strong>{titleCase(entry.action.split('.').pop() ?? entry.action)}</strong>
                                <span>{titleCase(entry.area)}{entry.actorName ? ` · By ${entry.actorName}` : ''}</span>
                              </div>
                              <time class="activity-time">{formatDateTime(entry.occurredAt)}</time>
                            </div>
                          );
                        })}
                      </div>
                    </section>
                  )}
                </div>
              </section>
            )}

            {shell && tab === 'employment' && (
              <section class="panel active" id="panel-employment" role="tabpanel">
                <div class="tab-heading">
                  <div><h2>Employment</h2><p>Current assignment, employment terms, payroll placement and effective-dated history.</p></div>
                  <div class="tab-heading-actions">
                    {access.requestChange && <button class="outline-btn" type="button" onClick={() => runAction('Request Change')}>Request Change</button>}
                    {access.editEmployee && <button class="primary-btn" type="button" onClick={() => runAction('Edit Contact')}>Edit Employment</button>}
                  </div>
                </div>
                <div class="summary-grid">
                  <div class="summary-stat green"><span>Employment Status</span><strong>{titleCase(identity?.employmentStatus)}</strong><small>{titleCase(facts?.employmentBasis)}</small></div>
                  <div class="summary-stat"><span>Continuous Service</span><strong>{formatTenure(facts?.tenureMonths)}</strong><small>Started {formatDate(facts?.startDate)}</small></div>
                  <div class="summary-stat"><span>Current Appointment</span><strong>{formatDate(facts?.assignmentEffectiveFrom)}</strong><small>{identity?.position ?? DASH}</small></div>
                  <div class="summary-stat"><span>Weekly Hours</span><strong>{formatWeeklyHours(facts?.weeklyHours)}</strong><small>{formatArrangementAndFte(facts?.workArrangement, facts?.fte)}</small></div>
                </div>
                <div class="tab-grid">
                  <section class="card">
                    <div class="card-head"><Icon id="briefcase" /><h3>Current Assignment</h3></div>
                    <div class="data-list">
                      <DataRow label="Position" value={identity?.position ?? DASH} />
                      <DataRow label="Department" value={identity?.departmentName ?? DASH} />
                      <DataRow label="Reports To" value={facts?.supervisorName ?? DASH} />
                      <DataRow label="Work Location" value={identity?.siteName ?? DASH} />
                      <DataRow label="Cost Centre" value={facts?.costCentre ?? DASH} />
                      <DataRow label="Effective From" value={formatDate(facts?.assignmentEffectiveFrom)} />
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-head"><Icon id="shield" /><h3>Employment Terms</h3></div>
                    <div class="data-list">
                      <DataRow label="Legal Employer" value={facts?.legalEmployer ?? DASH} />
                      <DataRow label="Employment Basis" value={titleCase(facts?.employmentBasis)} />
                      <DataRow label="Work Arrangement" value={facts?.workArrangement ?? DASH} />
                      <DataRow label="Standard Hours" value={formatWeeklyHours(facts?.weeklyHours)} />
                      <DataRow label="Work Schedule" value={titleCase(facts?.workSchedule)} />
                      <DataRow label="Notice Period" value={formatNoticePeriod(facts?.noticePeriodDays)} />
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-head"><Icon id="calendar" /><h3>HR Administration</h3></div>
                    <div class="data-list">
                      <DataRow label="Pay Group" value={facts?.payGroupName ?? DASH} />
                      <DataRow label="Pay Frequency" value={titleCase(facts?.payFrequency)} />
                      <DataRow label="Probation" value={
                        <span class={`badge${probationState(facts?.probationEndDate) === 'in_progress' ? ' warning' : ''}`}>
                          {probationState(facts?.probationEndDate) === 'completed' ? 'Completed'
                            : probationState(facts?.probationEndDate) === 'in_progress' ? 'In Progress' : 'Not Recorded'}
                        </span>} />
                      <DataRow label="Probation Ended" value={formatDate(facts?.probationEndDate)} />
                      <DataRow label="Employee Grade" value={facts?.employeeGrade ?? DASH} />
                      <DataRow label="Worker Category" value={facts?.workerCategory ?? DASH} />
                    </div>
                  </section>
                  <section class="card">
                    <div class="card-head"><Icon id="key" /><h3>Bank &amp; Pay Administration</h3></div>
                    {employment.isPending && <DrawerSectionSkeleton label="Loading payroll context…" />}
                    {employment.data && !employment.data.bank && (
                      <div class="epd-empty">Payroll context is not available to your role.</div>
                    )}
                    {employment.data?.bank && (
                      <div class="data-list">
                        <DataRow label="Primary Bank" value={employment.data.bank.bankName ?? DASH} />
                        {/* Masked only — HR never receives the full account number. */}
                        <DataRow label="Account" value={employment.data.bank.accountNumberMasked ?? DASH} />
                        <DataRow label="Account Type" value={titleCase(employment.data.bank.accountType)} />
                        <DataRow label="Payment Method" value={employment.data.bank.hasPrimaryAccount ? 'Direct Deposit' : DASH} />
                        <DataRow label="Bank Record" value={
                          <span class={`badge${employment.data.bank.verificationState === 'verified' ? '' : employment.data.bank.verificationState === 'missing' ? ' danger' : ' warning'}`}>
                            {employment.data.bank.verificationState === 'verified' ? 'Verified'
                              : employment.data.bank.verificationState === 'missing' ? 'Missing' : 'Reverify'}
                          </span>} />
                        <DataRow label="Last Verified" value={formatDate(employment.data.bank.lastVerifiedAt)} />
                      </div>
                    )}
                  </section>
                  <section class="card wide">
                    <div class="card-head"><Icon id="clock" /><h3>Employment History</h3></div>
                    <div class="history">
                      {employment.isPending && <DrawerSectionSkeleton label="Loading history…" />}
                      {employment.data?.history.length === 0 && <div class="epd-empty">No recorded employment changes.</div>}
                      {employment.data?.history.map(entry => (
                        <div class="history-row" key={entry.id}>
                          <span class="history-dot"><Icon id={entry.kind === 'assignment' ? 'briefcase' : 'check'} /></span>
                          <div><strong>{entry.title}</strong><span>{entry.detail}{entry.actorName ? ` · ${entry.actorName}` : ''}</span></div>
                          <time>{formatDate(entry.occurredAt)}</time>
                        </div>
                      ))}
                    </div>
                  </section>
                </div>
              </section>
            )}

            {shell && tab === 'documents' && access.viewDocuments && (
              <section class="panel active" id="panel-documents" role="tabpanel">
                <div class="tab-heading">
                  <div><h2>Documents</h2><p>Authorised employee records, verification state, expiry dates and missing evidence.</p></div>
                  <div class="tab-heading-actions">
                    {access.downloadDocument && (
                      <button
                        class="outline-btn" type="button" disabled={exporting === 'documents'}
                        onClick={() => void runExport('documents', () => exportDocumentIndex(employeeId, 'csv', 'all_authorised'))}
                      >{exporting === 'documents' ? 'Exporting…' : 'Export Index'}</button>
                    )}
                    {access.uploadDocument && <button class="primary-btn" type="button" onClick={() => runAction('Upload Document')}>Add Document</button>}
                  </div>
                </div>
                {documentHealth.isPending && <DrawerSectionSkeleton label="Loading document health…" />}
                {documentHealth.data && (
                  <>
                    <div class="summary-grid">
                      <div class="summary-stat"><span>Total Documents</span><strong>{documentHealth.data.totalDocuments}</strong><small>Across {documentHealth.data.categoryCount} Categories</small></div>
                      <div class="summary-stat green"><span>Verified</span><strong>{documentHealth.data.verifiedCount}</strong><small>{documentHealth.data.verifiedPercent}% Verified</small></div>
                      <div class="summary-stat amber"><span>Expiring Soon</span><strong>{documentHealth.data.expiringCount}</strong><small>Within 30 Days</small></div>
                      <div class="summary-stat"><span>Missing</span><strong>{documentHealth.data.missingCount}</strong><small>Required Evidence</small></div>
                    </div>
                    <div class="record-list">
                      {documentHealth.data.groups.flatMap(group => group.items.map(item => {
                        const state = DOC_STATE_LABEL[item.state] ?? { label: titleCase(item.state), tone: '' };
                        return (
                          <article class="record-row" key={`${group.key}:${item.documentId ?? item.requirementId ?? item.title}`}>
                            <span class="record-icon"><Icon id={item.state === 'missing' || item.state === 'expired' ? 'alert' : 'file'} /></span>
                            <div class="record-copy"><strong>{item.title}</strong><span>{group.label} · {item.detail}</span></div>
                            <div class="record-meta">
                              <span class={`badge ${state.tone === 'warn' ? 'warning' : state.tone}`.trim()}>{state.label}</span>
                            </div>
                          </article>
                        );
                      }))}
                    </div>
                  </>
                )}
              </section>
            )}

            {shell && tab === 'readiness' && access.viewReadiness && (
              <section class="panel active" id="panel-readiness" role="tabpanel">
                <div class="tab-heading">
                  <div><h2>Readiness</h2><p>Evidence-based controls showing whether this employee record can support HR and operational workflows.</p></div>
                  <div class="tab-heading-actions">
                    <button
                      class="outline-btn" type="button" disabled={exporting === 'readiness'}
                      onClick={() => void runExport('readiness', () => exportReadinessBreakdown(employeeId, 'csv'))}
                    >{exporting === 'readiness' ? 'Exporting…' : 'Export Breakdown'}</button>
                  </div>
                </div>
                {readiness.isPending && <DrawerSectionSkeleton label="Loading readiness controls…" />}
                {readiness.data && (
                  <div class="tab-grid">
                    <section class="card">
                      <div class="card-head"><Icon id="shield" /><h3>Overall Readiness</h3></div>
                      <div class="readiness-body">
                        <ReadinessGauge
                          percent={readiness.data.coverage.percent}
                          label={readinessLabel(shell.readiness)}
                        />
                        <div class="readiness-copy">
                          <strong>{readiness.data.coverage.readyControls} Of {readiness.data.coverage.totalControls} Controls Ready</strong>
                          <p>Readiness is shared work: HR coordinates, and each department resolves the controls in its own domain.</p>
                        </div>
                      </div>
                    </section>
                    <section class="card wide">
                      <div class="card-head"><Icon id="shield" /><h3>Readiness Control Matrix</h3></div>
                      <div class="progress-list">
                        {readiness.data.controls.map(entry => (
                          <div class="progress-row" key={entry.control.controlKey}>
                            <span>{entry.control.label}</span>
                            <div class="progress-track">
                              <div class={`progress-fill${entry.percent < 100 ? ' amber' : ''}`} style={{ width: `${entry.percent}%` }} />
                            </div>
                            <strong>{entry.percent}%</strong>
                          </div>
                        ))}
                      </div>
                      <div class="record-list" style="margin-top:14px">
                        {readiness.data.controls.map(entry => (
                          <article class="record-row" key={`row:${entry.control.controlKey}`}>
                            <span class="record-icon"><Icon id={CONTROL_ICON[entry.control.domain] ?? 'shield'} /></span>
                            <div class="record-copy">
                              <strong>{entry.control.label}</strong>
                              <span>
                                {entry.control.description ?? titleCase(entry.control.domain)}
                                {' · '}
                                {/* Fail-closed ownership is VISIBLE, never a blank. */}
                                {entry.owner.status === 'resolved' ? entry.owner.ownerLabel : 'Owner Required'}
                                {entry.workItem?.nextResponsibleParty ? ` · Next: ${entry.workItem.nextResponsibleParty}` : ''}
                              </span>
                            </div>
                            <div class="record-meta">
                              <span class={`badge${entry.percent === 100 ? '' : ' warning'}`}>
                                {entry.percent === 100 ? 'Complete' : titleCase(entry.state)}
                              </span>
                              {entry.percent < 100 && access.followUpReadiness && (
                                <button
                                  class="text-btn" type="button"
                                  disabled={followUp.isPending}
                                  onClick={() => void sendReadinessReminder(entry)}
                                >Send Reminder</button>
                              )}
                            </div>
                          </article>
                        ))}
                      </div>
                    </section>
                  </div>
                )}
              </section>
            )}

            {shell && tab === 'access' && (
              <section class="panel active" id="panel-access" role="tabpanel">
                <div class="tab-heading">
                  <div><h2>Access</h2><p>Authoritative account state, assigned access and capability-gated support workflows.</p></div>
                </div>
                {shell.accountHealth && (
                  <div class="access-summary">
                    <div class="access-state"><span class="record-icon"><Icon id="check" /></span><span>Account Status</span><strong>{titleCase(shell.accountHealth.accountStatus)}</strong></div>
                    <div class="access-state"><span class="record-icon"><Icon id="lock" /></span><span>Sign-In Identity</span><strong>{shell.accountHealth.hasLoginIdentity ? 'Provisioned' : 'Not Provisioned'}</strong></div>
                    <div class="access-state"><span class="record-icon"><Icon id="headset" /></span><span>Open Requests</span><strong>{shell.accountHealth.openSupportRequests}</strong></div>
                  </div>
                )}
                <div class="tab-grid">
                  {access.viewAccessAssignments && (
                    <section class="card wide">
                      <div class="card-head"><Icon id="shield" /><h3>Access Assignments</h3></div>
                      {assignments.isPending && <DrawerSectionSkeleton label="Loading access assignments…" />}
                      {assignments.data?.length === 0 && <div class="epd-empty">No access assignments are recorded.</div>}
                      <div class="record-list">
                        {assignments.data?.map(a => (
                          <article class="record-row" key={a.id}>
                            <span class="record-icon"><Icon id="shield" /></span>
                            <div class="record-copy">
                              <strong>{a.accessProfileLabel}</strong>
                              <span>{titleCase(a.assignmentType)} · {a.scopes.map(s => s.scopeLabel).join(', ') || 'No Recorded Scope'} · From {formatDate(a.effectiveFrom)}</span>
                            </div>
                            <div class="record-meta">
                              <span class={`badge${a.status === 'active' ? '' : ' warning'}`}>{titleCase(a.status)}</span>
                            </div>
                          </article>
                        ))}
                      </div>
                      <div class="support-banner">
                        <span class="record-icon"><Icon id="headset" /></span>
                        <div><strong>Sensitive Account Actions</strong><span>Password resets, session revocation, device removal, MFA enforcement and suspension route to the authorised Account Support owner.</span></div>
                      </div>
                    </section>
                  )}
                </div>
              </section>
            )}

            {shell && tab === 'activity' && access.viewAudit && (
              <section class="panel active" id="panel-activity" role="tabpanel">
                <div class="tab-heading">
                  <div><h2>Activity &amp; Audit</h2><p>Employee record history with actor, source, outcome and correlation details.</p></div>
                  <div class="tab-heading-actions">
                    <button
                      class="outline-btn" type="button" disabled={exporting === 'audit'}
                      onClick={() => setAuditExportOpen(true)}
                    >{exporting === 'audit' ? 'Exporting…' : 'Export Audit History'}</button>
                  </div>
                </div>
                {audit.isPending && <DrawerSectionSkeleton label="Loading audit history…" rows={5} />}
                {audit.data?.length === 0 && <div class="epd-empty">No audit entries recorded.</div>}
                <div class="record-list">
                  {audit.data?.map(entry => (
                    <article class="record-row" key={entry.id}>
                      <span class="record-icon"><Icon id={activityVisual(entry.submodule_key ?? '').icon} /></span>
                      <div class="record-copy">
                        <strong>{titleCase(entry.action.split('.').pop() ?? entry.action)}</strong>
                        <span>{titleCase(entry.submodule_key ?? 'employee')}{entry.actorName ? ` · ${entry.actorName}` : ''}</span>
                      </div>
                      <div class="record-meta"><time>{formatDateTime(entry.created_at)}</time></div>
                    </article>
                  ))}
                </div>
                <p style="margin:12px 0 0;color:var(--muted);font-size:10px">
                  Detailed audit records include the correlation ID and safe mutation metadata.
                </p>
              </section>
            )}
          </div>

          <footer class="footer">
            <div class="left-actions">
              {onOpenFullRecord && (
                <button class="outline-btn" type="button" onClick={() => onOpenFullRecord('overview')}>View Full Employee Record</button>
              )}
            </div>
            <div class="right-actions">
              {access.requestChange && (
                <button class="primary-btn" type="button" onClick={() => runAction('Request Change')}>Request Change</button>
              )}
            </div>
          </footer>
        </main>

        {contactOpen && shell?.contact && (
          <div class="contact-dialog-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setContactOpen(false); }}>
            <div class="contact-dialog" role="dialog" aria-modal="true" aria-labelledby="contact-dialog-title">
              <div class="contact-dialog-head">
                <div class="contact-dialog-title">
                  <span class="contact-dialog-title-icon"><Icon id="user" /></span>
                  <div>
                    <div class="contact-dialog-kicker">HR Managed Record</div>
                    <h2 id="contact-dialog-title">Edit Contact Information</h2>
                    <p>Keep verified work and emergency details current.</p>
                  </div>
                </div>
                <button class="dialog-close" type="button" aria-label="Close contact editor" onClick={() => setContactOpen(false)}>
                  <Icon id="close" />
                </button>
              </div>
              <form class="contact-form" onSubmit={e => void submitContact(e)}>
                <div class="contact-dialog-intro">
                  <Icon id="shield" />
                  <div><strong>Protected Employee Information</strong><span>Only authorised HR staff can save these changes. Every update is recorded in the employee audit trail. A changed work email is sent to Account Support for identity verification before it affects sign-in.</span></div>
                </div>
                <section class="form-section" aria-labelledby="employee-contact-heading">
                  <div class="form-section-title"><Icon id="mail" /><h3 id="employee-contact-heading">Employee Contact</h3></div>
                  <div class="form-grid">
                    <label class="form-field wide"><span>Work Email</span>
                      <input name="workEmail" type="email" required autocomplete="email" defaultValue={shell.contact.workEmail ?? ''} />
                    </label>
                    <label class="form-field"><span>Work Phone</span>
                      <input name="workPhone" type="tel" autocomplete="tel" defaultValue={shell.contact.workPhone ?? ''} />
                    </label>
                    <label class="form-field"><span>Mobile</span>
                      <input name="mobile" type="tel" autocomplete="tel" defaultValue={shell.contact.mobilePhone ?? ''} />
                    </label>
                  </div>
                </section>
                <section class="form-section" aria-labelledby="emergency-contact-heading">
                  <div class="form-section-title"><Icon id="phone" /><h3 id="emergency-contact-heading">Emergency Contact</h3></div>
                  <div class="form-grid">
                    <label class="form-field wide"><span>Full Name</span>
                      <input name="emergencyName" defaultValue={shell.contact.emergencyContactName ?? ''} />
                    </label>
                    <label class="form-field"><span>Relationship</span>
                      <select name="relationship" defaultValue={shell.contact.emergencyContactRelationship ?? ''}>
                        <option value="">Select</option>
                        <option>Spouse</option><option>Parent</option><option>Sibling</option>
                        <option>Child</option><option>Other</option>
                      </select>
                    </label>
                    <label class="form-field"><span>Phone</span>
                      <input name="emergencyPhone" type="tel" defaultValue={shell.contact.emergencyContactPhone ?? ''} />
                    </label>
                  </div>
                </section>
                <div class="contact-dialog-actions">
                  <button class="outline-btn" type="button" onClick={() => setContactOpen(false)}>Cancel</button>
                  <button class="primary-btn" type="submit" disabled={updateContact.isPending}>
                    {updateContact.isPending ? 'Saving…' : 'Save Changes'}
                  </button>
                </div>
              </form>
            </div>
          </div>
        )}

        {auditExportOpen && (
          <div class="contact-dialog-backdrop" role="presentation" onClick={e => { if (e.target === e.currentTarget) setAuditExportOpen(false); }}>
            <div class="contact-dialog" role="dialog" aria-modal="true" aria-labelledby="audit-export-title">
              <div class="contact-dialog-head">
                <div class="contact-dialog-title">
                  <span class="contact-dialog-title-icon"><Icon id="shield" /></span>
                  <div>
                    <div class="contact-dialog-kicker">Audited Extract</div>
                    <h2 id="audit-export-title">Export Audit History</h2>
                    <p>Choose the range and state why the extract is needed.</p>
                  </div>
                </div>
                <button class="dialog-close" type="button" aria-label="Close audit export" onClick={() => setAuditExportOpen(false)}>
                  <Icon id="close" />
                </button>
              </div>
              <form
                class="contact-form"
                onSubmit={e => {
                  e.preventDefault();
                  const fd = new FormData(e.target as HTMLFormElement);
                  const pick = (k: string): string => {
                    const value = fd.get(k);
                    return typeof value === 'string' ? value.trim() : '';
                  };
                  const reason = pick('reason');
                  if (!reason) return;
                  setAuditExportOpen(false);
                  void runExport('audit', () => exportAuditHistory(employeeId, pick('format') === 'pdf' ? 'pdf' : 'csv', {
                    dateFrom: pick('dateFrom') || null,
                    dateTo: pick('dateTo') || null,
                    area: pick('area') || null,
                    reason,
                  }));
                }}
              >
                <div class="contact-dialog-intro">
                  <Icon id="alert" />
                  <div><strong>This Extract Is Itself Audited</strong><span>The export is recorded against this employee with your reason and a correlation ID. Entries you are not authorised to see in full are exported with their detail withheld.</span></div>
                </div>
                <section class="form-section">
                  <div class="form-section-title"><Icon id="calendar" /><h3>Range And Scope</h3></div>
                  <div class="form-grid">
                    <label class="form-field"><span>From</span><input name="dateFrom" type="date" /></label>
                    <label class="form-field"><span>To</span><input name="dateTo" type="date" /></label>
                    <label class="form-field"><span>Activity Area</span>
                      <select name="area">
                        <option value="">All Areas</option>
                        <option value="employees">Employment</option>
                        <option value="documents">Documents</option>
                        <option value="readiness">Readiness</option>
                        <option value="access_assignments">Access</option>
                      </select>
                    </label>
                    <label class="form-field"><span>Format</span>
                      {/* XLSX is deliberately absent — see lib/reportTable.ts. */}
                      <select name="format"><option value="csv">CSV</option><option value="pdf">PDF</option></select>
                    </label>
                  </div>
                </section>
                <section class="form-section">
                  <div class="form-section-title"><Icon id="file" /><h3>Business Reason</h3></div>
                  <div class="form-grid">
                    <label class="form-field wide"><span>Why is this extract needed?</span>
                      <input name="reason" required maxLength={500} placeholder="e.g. Statutory audit request 2026-Q2" />
                    </label>
                  </div>
                </section>
                <div class="contact-dialog-actions">
                  <button class="outline-btn" type="button" onClick={() => setAuditExportOpen(false)}>Cancel</button>
                  <button class="primary-btn" type="submit">Generate Audit Export</button>
                </div>
              </form>
            </div>
          </div>
        )}
      </div>
    </div>
  );
}

export type { EmployeeProfileShell };
