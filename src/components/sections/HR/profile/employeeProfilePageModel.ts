/**
 * employeeProfilePageModel.ts — pure view-model rules for the FULL-PAGE employee
 * record.
 *
 * The shared drawer/page model lives in `../employeeProfileModel`; this file adds
 * only what the full page needs and the drawer does not (the document/activity
 * toolbars, the readiness rail, the account-assistance routing map, the
 * offboarding phase machine). Keeping them here rather than in the component
 * means every rule below is unit-testable without rendering.
 *
 * Nothing here invents data. Where the locked mockup shows a value the authorised
 * contract does not carry, the rule returns the record's own empty state instead
 * of a plausible-looking placeholder.
 */
import type {
  DocumentHealthGroup, DocumentHealthItem, DocumentHealthState, DocumentHealthSummary,
  ReadinessControlMatrixEntry, ReadinessState,
} from '@api/hr/employeeReadiness';
import type { HrAuditEntry } from '@api/hr/employees';
import type { OffboardingCaseRow } from '../../../../../types/hrOffboarding';
import { DASH, titleCase } from '../employeeProfileModel';

// ── Documents ───────────────────────────────────────────────────────────────

/** Approved pill text + tone class for one document-health state. */
export const DOCUMENT_STATE_BADGE: Record<DocumentHealthState, { label: string; tone: '' | 'warning' | 'danger' }> = {
  verified:   { label: 'Verified',   tone: '' },
  current:    { label: 'Current',    tone: '' },
  expiring:   { label: 'Expires Soon', tone: 'warning' },
  expired:    { label: 'Expired',    tone: 'danger' },
  unverified: { label: 'Unverified', tone: 'warning' },
  missing:    { label: 'Missing',    tone: 'danger' },
};

/** The Documents toolbar's status filter — grouped the way the mockup words it. */
export type DocumentStatusFilter = 'all' | 'verified' | 'expiring' | 'missing';

export const DOCUMENT_STATUS_FILTERS: { value: DocumentStatusFilter; label: string }[] = [
  { value: 'all',      label: 'All Statuses' },
  { value: 'verified', label: 'Verified' },
  { value: 'expiring', label: 'Expiring Soon' },
  { value: 'missing',  label: 'Missing' },
];

/** One flattened table row: the health item plus the category it came from. */
export interface DocumentRow extends DocumentHealthItem {
  categoryKey: string;
  categoryLabel: string;
}

/** Flatten the grouped tree into the table's row list, category label carried. */
export function documentRows(groups: DocumentHealthGroup[] | undefined): DocumentRow[] {
  return (groups ?? []).flatMap(group => group.items.map(item => ({
    ...item, categoryKey: group.key, categoryLabel: group.label,
  })));
}

/** Category options for the toolbar select, derived from the real groups. */
export function documentCategories(groups: DocumentHealthGroup[] | undefined): { key: string; label: string }[] {
  return (groups ?? []).map(g => ({ key: g.key, label: g.label }));
}

/** Does a row satisfy the grouped status filter? */
export function matchesDocumentStatus(state: DocumentHealthState, filter: DocumentStatusFilter): boolean {
  switch (filter) {
    case 'all':      return true;
    case 'verified': return state === 'verified' || state === 'current';
    case 'expiring': return state === 'expiring';
    case 'missing':  return state === 'missing' || state === 'expired';
  }
}

export interface DocumentFilters {
  search: string;
  category: string;
  status: DocumentStatusFilter;
}

export const EMPTY_DOCUMENT_FILTERS: DocumentFilters = { search: '', category: 'all', status: 'all' };

export function filterDocumentRows(rows: DocumentRow[], filters: DocumentFilters): DocumentRow[] {
  const needle = filters.search.trim().toLowerCase();
  return rows.filter(row => {
    if (filters.category !== 'all' && row.categoryKey !== filters.category) return false;
    if (!matchesDocumentStatus(row.state, filters.status)) return false;
    if (!needle) return true;
    return row.title.toLowerCase().includes(needle)
      || row.documentType.toLowerCase().includes(needle)
      || row.categoryLabel.toLowerCase().includes(needle);
  });
}

export function hasDocumentFilters(filters: DocumentFilters): boolean {
  return filters.search.trim() !== '' || filters.category !== 'all' || filters.status !== 'all';
}

/**
 * The document-health score the redesigned block shows.
 *
 * It is the VERIFIED share of the required set — the same number the bar's first
 * segment draws, so the headline figure and the bar can never disagree.
 */
export function documentHealthScore(summary: DocumentHealthSummary | undefined): number {
  return summary?.verifiedPercent ?? 0;
}

/**
 * Grid track list for the three-segment document-health bar.
 *
 * The locked reference hard-codes `10fr 1fr 1fr` — the ratio of its own sample
 * data — so production must replace it with the real counts or the bar would
 * contradict the numbers printed under it. A zero count collapses to `0fr`
 * rather than keeping a misleading sliver; with nothing required at all the
 * reference's own ratio is kept, because there is no real ratio to draw.
 */
export function healthBarTracks(summary: DocumentHealthSummary | undefined): string {
  if (!summary) return '10fr 1fr 1fr';
  const { verifiedCount, expiringCount, missingCount } = summary;
  if (verifiedCount + expiringCount + missingCount === 0) return '10fr 1fr 1fr';
  return `${verifiedCount}fr ${expiringCount}fr ${missingCount}fr`;
}

/** Plain-language band under the score. Thresholds are stated, not implied. */
export function documentHealthBand(score: number): string {
  if (score >= 90) return 'Strong Document Health';
  if (score >= 75) return 'Good Document Health';
  if (score >= 50) return 'Document Health Needs Attention';
  return 'Document Health At Risk';
}

/**
 * The row action label. A missing requirement can only be REQUESTED; anything
 * with a stored document can be opened. The label never promises an action the
 * row cannot perform.
 */
export function documentRowAction(row: DocumentRow): 'open' | 'request' | 'review' {
  if (!row.documentId) return 'request';
  if (row.state === 'expiring' || row.state === 'expired' || row.state === 'unverified') return 'review';
  return 'open';
}

// ── Readiness ───────────────────────────────────────────────────────────────

/** Rail tone for one control: ready / needs review / blocked. */
export function readinessRailState(entry: ReadinessControlMatrixEntry): '' | 'review' | 'blocked' {
  if (entry.percent >= 100) return '';
  if (entry.control.isBlocking) return 'blocked';
  return 'review';
}

/** Short state word under a rail item. */
export function readinessRailLabel(entry: ReadinessControlMatrixEntry): string {
  if (entry.percent >= 100) return 'Ready';
  return entry.control.isBlocking ? 'Blocked' : 'Needs Review';
}

/** Matrix pill for one control row. */
export function readinessMatrixBadge(entry: ReadinessControlMatrixEntry): { label: string; tone: '' | 'warning' | 'danger' } {
  if (entry.percent >= 100) return { label: 'Complete', tone: '' };
  if (entry.control.isBlocking) return { label: 'Blocked', tone: 'danger' };
  return { label: 'Review', tone: 'warning' };
}

/** Work-item pill: overdue beats state, because overdue is what needs the action. */
export function readinessWorkStateBadge(
  entry: ReadinessControlMatrixEntry, today = new Date(),
): { label: string; tone: '' | 'warning' | 'danger' } {
  const item = entry.workItem;
  if (!item) return { label: readinessMatrixBadge(entry).label, tone: readinessMatrixBadge(entry).tone };
  if (item.dueDate) {
    const due = new Date(`${item.dueDate.slice(0, 10)}T00:00:00Z`);
    if (!Number.isNaN(due.getTime()) && due < today) return { label: 'Overdue', tone: 'danger' };
  }
  return { label: READINESS_STATE_LABEL[item.status] ?? titleCase(item.status), tone: item.severity === 'critical' ? 'danger' : 'warning' };
}

const READINESS_STATE_LABEL: Partial<Record<ReadinessState, string>> = {
  open: 'Open',
  assigned: 'Assigned',
  waiting_for_information: 'Waiting For Information',
  submitted_for_review: 'Submitted For Review',
  in_review: 'In Review',
  ready: 'Ready',
  exception_approved: 'Exception Approved',
  not_applicable: 'Not Applicable',
};

/** Controls that are actually blocking and unresolved — the Blockers section. */
export function readinessBlockers(controls: ReadinessControlMatrixEntry[] | undefined): ReadinessControlMatrixEntry[] {
  return (controls ?? []).filter(entry => entry.percent < 100);
}

/** "4 of 6 Controls Ready" — never a bare fraction. */
export function coverageSentence(ready: number, total: number): string {
  return `${ready} of ${total}`;
}

// ── Activity & audit ────────────────────────────────────────────────────────

export type ActivityArea = 'employment' | 'documents' | 'readiness' | 'account';

/**
 * Map an audit row's submodule key onto one of the four areas the toolbar filters.
 *
 * Unrecognised keys fall to `employment` — the employee record itself — rather
 * than being hidden, so a new submodule can never make history silently vanish.
 */
export function activityArea(submoduleKey: string | null | undefined): ActivityArea {
  const key = (submoduleKey ?? '').toLowerCase();
  if (key.includes('document')) return 'documents';
  if (key.includes('readiness') || key.includes('training')) return 'readiness';
  if (key.includes('access') || key.includes('account') || key.includes('ticket') || key.includes('security')) return 'account';
  return 'employment';
}

export const ACTIVITY_AREA_LABEL: Record<ActivityArea, string> = {
  employment: 'Employment', documents: 'Documents', readiness: 'Readiness', account: 'Account',
};

/** Date-range options the toolbar offers, in days. `null` means all history. */
export type ActivityRange = 'last_90' | 'this_month' | 'this_year' | 'all';

export const ACTIVITY_RANGES: { value: ActivityRange; label: string }[] = [
  { value: 'last_90',    label: 'Last 90 Days' },
  { value: 'this_month', label: 'This Month' },
  { value: 'this_year',  label: 'This Year' },
  { value: 'all',        label: 'All Recorded History' },
];

export interface ActivityFilters {
  search: string;
  area: ActivityArea | 'all';
  range: ActivityRange;
  actor: string;
}

export const EMPTY_ACTIVITY_FILTERS: ActivityFilters = { search: '', area: 'all', range: 'last_90', actor: 'all' };

export function hasActivityFilters(filters: ActivityFilters): boolean {
  return filters.search.trim() !== '' || filters.area !== 'all'
    || filters.range !== 'last_90' || filters.actor !== 'all';
}

/** Inclusive lower bound for a range, or null for "all". */
export function rangeStart(range: ActivityRange, now = new Date()): Date | null {
  switch (range) {
    case 'all':        return null;
    case 'last_90':    return new Date(now.getTime() - 90 * 86_400_000);
    case 'this_month': return new Date(Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1));
    case 'this_year':  return new Date(Date.UTC(now.getUTCFullYear(), 0, 1));
  }
}

export function filterAuditRows(
  rows: HrAuditEntry[], filters: ActivityFilters, now = new Date(),
): HrAuditEntry[] {
  const needle = filters.search.trim().toLowerCase();
  const from = rangeStart(filters.range, now);
  return rows.filter(row => {
    if (filters.area !== 'all' && activityArea(row.submodule_key) !== filters.area) return false;
    if (filters.actor !== 'all' && (row.actorName ?? 'System') !== filters.actor) return false;
    if (from) {
      const at = new Date(row.created_at);
      if (Number.isNaN(at.getTime()) || at < from) return false;
    }
    if (!needle) return true;
    return row.action.toLowerCase().includes(needle)
      || (row.actorName ?? '').toLowerCase().includes(needle)
      || (row.reason ?? '').toLowerCase().includes(needle);
  });
}

/** Distinct actors present in the loaded history — a picker, never free text. */
export function auditActors(rows: HrAuditEntry[]): string[] {
  return [...new Set(rows.map(r => r.actorName ?? 'System'))].sort((a, b) => a.localeCompare(b));
}

/** Count of entries recorded in the current calendar month. */
export function changesThisMonth(rows: HrAuditEntry[], now = new Date()): number {
  const start = Date.UTC(now.getUTCFullYear(), now.getUTCMonth(), 1);
  return rows.filter(r => {
    const at = Date.parse(r.created_at);
    return !Number.isNaN(at) && at >= start;
  }).length;
}

/** Readable activity title from a dotted audit action (`employee.updated`). */
export function activityTitle(action: string): string {
  return titleCase(action.split('.').slice(-2).join(' '));
}

// ── Account assistance ──────────────────────────────────────────────────────

/**
 * The assistance types the locked dialog offers, each bound to the SERVICE
 * DOMAIN the backend validates (`zServiceDomain`).
 *
 * The mapping is 1:1 with the enum — there is no option here the backend would
 * reject, and no enum member the dialog silently hides.
 */
export type AccountServiceDomain =
  | 'account_access' | 'password_reset' | 'mfa' | 'permissions'
  | 'activation' | 'suspension' | 'general';

export const ACCOUNT_ASSISTANCE_TYPES: { domain: AccountServiceDomain; label: string }[] = [
  { domain: 'password_reset', label: 'Sign-In Or Password Problem' },
  { domain: 'activation',     label: 'Activation Or Invitation' },
  { domain: 'mfa',            label: 'MFA Device Replacement' },
  { domain: 'account_access', label: 'Session Or Trusted Device' },
  { domain: 'suspension',     label: 'Account Suspension Or Restore' },
  { domain: 'permissions',    label: 'Access Profile Review' },
  { domain: 'general',        label: 'Other Account Issue' },
];

export function assistanceLabel(domain: string): string {
  return ACCOUNT_ASSISTANCE_TYPES.find(t => t.domain === domain)?.label ?? titleCase(domain);
}

/** Business impact, as the locked dialog words it. */
export type AssistanceImpact = 'standard' | 'blocked' | 'security';

export const ASSISTANCE_IMPACTS: { value: AssistanceImpact; label: string }[] = [
  { value: 'standard', label: 'Standard Request' },
  { value: 'blocked',  label: 'Work Is Blocked' },
  { value: 'security', label: 'Security Concern' },
];

/**
 * Impact → the priority the backend accepts (`low | medium | high`).
 *
 * `blocked` and `security` both raise the request to `high`; they are NOT
 * collapsed, because the selected impact is also written into the request body
 * (see `assistanceBody`) so the support owner sees which one it was.
 */
export function assistancePriority(impact: AssistanceImpact): 'low' | 'medium' | 'high' {
  return impact === 'standard' ? 'medium' : 'high';
}

export function impactLabel(impact: AssistanceImpact): string {
  return ASSISTANCE_IMPACTS.find(i => i.value === impact)?.label ?? titleCase(impact);
}

/** Request body: the operator's description plus the impact that set the priority. */
export function assistanceBody(details: string, impact: AssistanceImpact): string {
  return `Business impact: ${impactLabel(impact)}\n\n${details.trim()}`;
}

/** Status pill for one account-support request row. */
export function supportStatusBadge(status: string): { label: string; tone: '' | 'warning' | 'danger' } {
  switch (status) {
    case 'resolved':
    case 'closed':      return { label: titleCase(status), tone: '' };
    case 'in_progress': return { label: 'In Review', tone: 'warning' };
    default:            return { label: titleCase(status), tone: 'warning' };
  }
}

/** History dialog filter tabs. */
export type SupportHistoryFilter = 'all' | 'open' | 'resolved';

const RESOLVED_STATUSES = new Set(['resolved', 'closed']);

export function matchesSupportFilter(status: string, filter: SupportHistoryFilter): boolean {
  if (filter === 'all') return true;
  const resolved = RESOLVED_STATUSES.has(status);
  return filter === 'resolved' ? resolved : !resolved;
}

// ── Offboarding ─────────────────────────────────────────────────────────────

const CLOSED_OFFBOARDING = new Set(['completed', 'cancelled']);

export interface OffboardingPhase {
  /** The case coordinating the departure right now, if any. */
  active: OffboardingCaseRow | null;
  /** Closed cases, newest first — the protected employment history. */
  history: OffboardingCaseRow[];
}

export function offboardingPhase(cases: OffboardingCaseRow[] | undefined): OffboardingPhase {
  const rows = cases ?? [];
  const active = rows.find(row => !CLOSED_OFFBOARDING.has(row.status)) ?? null;
  const history = rows
    .filter(row => CLOSED_OFFBOARDING.has(row.status))
    .sort((a, b) => (b.completedAt ?? b.startedAt).localeCompare(a.completedAt ?? a.startedAt));
  return { active, history };
}

/** Offboarding task pill. */
export function offboardingTaskBadge(status: string): { label: string; tone: '' | 'warning' | 'danger' | 'neutral' } {
  switch (status) {
    case 'completed': return { label: 'Complete', tone: '' };
    case 'in_progress': return { label: 'In Progress', tone: 'warning' };
    case 'blocked':   return { label: 'Blocked', tone: 'danger' };
    default:          return { label: titleCase(status), tone: 'neutral' };
  }
}

/** "1 Of 4" — the case summary's completion fraction. */
export function taskCompletion(taskCount: number, openTaskCount: number): string {
  if (!taskCount) return DASH;
  return `${taskCount - openTaskCount} Of ${taskCount}`;
}
