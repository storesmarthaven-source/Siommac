/**
 * employeeProfileModel.ts — shared Employee Profile view-model and formatters.
 *
 * ONE model for the drawer and the full page, so the two surfaces cannot drift.
 * Pure functions only: no hooks, no rendering — every rule here is unit-testable.
 */
import type {
  EmployeeProfileShell, EmployeeAttentionItem, ProfileTabIndicator, ProfileTabKey,
  AttentionSeverity, ProfileReadinessSummary,
} from '@api/hr/employeeProfile';

/** Placeholder for a value the record genuinely does not carry. */
export const DASH = '—';

/** Tabs in approved order. The drawer renders all but `offboarding`. */
export const FULL_PAGE_TABS: ProfileTabKey[] = [
  'overview', 'employment', 'documents', 'readiness', 'access', 'activity', 'offboarding',
];
export const DRAWER_TABS: ProfileTabKey[] = [
  'overview', 'employment', 'documents', 'readiness', 'access', 'activity',
];

/** Approved visible labels. `activity` reads "Activity & Audit" on the full page. */
export const TAB_LABEL: Record<ProfileTabKey, string> = {
  overview: 'Overview',
  employment: 'Employment',
  documents: 'Documents',
  readiness: 'Readiness',
  access: 'Access',
  activity: 'Activity & Audit',
  offboarding: 'Offboarding',
};

/** The drawer's tab strip uses the short form. */
export const DRAWER_TAB_LABEL: Record<ProfileTabKey, string> = {
  ...TAB_LABEL, activity: 'Activity',
};

/**
 * Title Case for machine tokens (`on_leave` → `On Leave`).
 *
 * Small joining words stay lower-case unless they lead, matching the register
 * conventions the approved mockups use.
 */
const MINOR_WORDS = new Set(['of', 'to', 'in', 'on', 'at', 'by', 'for', 'and', 'or', 'the', 'a', 'an']);
export function titleCase(value: string | null | undefined): string {
  if (!value) return DASH;
  const words = value.replace(/[_.-]+/g, ' ').trim().split(/\s+/);
  if (!words.length || !words[0]) return DASH;
  return words
    .map((w, i) => {
      const lower = w.toLowerCase();
      if (i > 0 && MINOR_WORDS.has(lower)) return lower;
      return lower.charAt(0).toUpperCase() + lower.slice(1);
    })
    .join(' ');
}

/** `dd MMM yyyy`, matching the approved references. */
const MONTHS = ['Jan', 'Feb', 'Mar', 'Apr', 'May', 'Jun', 'Jul', 'Aug', 'Sep', 'Oct', 'Nov', 'Dec'];
export function formatDate(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso.length <= 10 ? `${iso}T00:00:00Z` : iso);
  if (Number.isNaN(d.getTime())) return DASH;
  return `${String(d.getUTCDate()).padStart(2, '0')} ${MONTHS[d.getUTCMonth()]} ${d.getUTCFullYear()}`;
}

export function formatDateTime(iso: string | null | undefined): string {
  if (!iso) return DASH;
  const d = new Date(iso);
  if (Number.isNaN(d.getTime())) return DASH;
  const hh = String(d.getUTCHours()).padStart(2, '0');
  const mm = String(d.getUTCMinutes()).padStart(2, '0');
  return `${formatDate(iso)} ${hh}:${mm}`;
}

/**
 * Continuous service as an approved label: `2 Years 3 Months`, `7 Months`,
 * `Less Than A Month`. Never a bare month count.
 */
export function formatTenure(months: number | null | undefined): string {
  if (months === null || months === undefined || months < 0) return DASH;
  if (months === 0) return 'Less Than A Month';
  const years = Math.floor(months / 12);
  const rem = months % 12;
  const parts: string[] = [];
  if (years) parts.push(`${years} ${years === 1 ? 'Year' : 'Years'}`);
  if (rem) parts.push(`${rem} ${rem === 1 ? 'Month' : 'Months'}`);
  return parts.join(' ');
}

/** Gauge caption under the readiness score. */
export function readinessLabel(readiness: ProfileReadinessSummary | null): string {
  if (!readiness) return DASH;
  if (readiness.percent >= 100) return 'Ready';
  if (readiness.blockedDomains.length >= 2) return 'Needs Review';
  return 'Almost Ready';
}

/**
 * Sentence explaining what is holding the record back, e.g.
 * "Payroll and training are preventing this record from being fully ready."
 */
// Now covers every readiness DOMAIN, not just the three the superseded
// approximation could produce. A domain missing from this map would render as
// its raw key, so it lists all six.
type ReadinessBlocker = ProfileReadinessSummary['blockedDomains'][number];
const BLOCKER_NOUN: Record<ReadinessBlocker, string> = {
  assignment: 'assignment', payroll: 'payroll', training: 'training',
  documents: 'documents', statutory: 'statutory', access: 'access',
};
export function readinessExplanation(readiness: ProfileReadinessSummary | null): string {
  if (!readiness) return DASH;
  if (!readiness.blockedDomains.length) return 'Every readiness control has passed for this record.';
  const nouns = readiness.blockedDomains.map((b: ReadinessBlocker) => BLOCKER_NOUN[b]);
  const list = nouns.length === 1
    ? nouns[0]
    : `${nouns.slice(0, -1).join(', ')} and ${nouns[nouns.length - 1]}`;
  const verb = nouns.length === 1 ? 'is' : 'are';
  // Sentence case, not Title Case: the approved copy reads
  // "Payroll and training are preventing this record from being fully ready."
  const sentence = list ?? '';
  const leading = sentence.charAt(0).toUpperCase() + sentence.slice(1);
  return `${leading} ${verb} preventing this record from being fully ready.`;
}

/** Heading above the readiness copy: "Two Controls Need Follow-Up". */
const COUNT_WORD = ['No', 'One', 'Two', 'Three', 'Four', 'Five', 'Six'];
export function readinessHeadline(readiness: ProfileReadinessSummary | null): string {
  if (!readiness) return DASH;
  const n = readiness.blockedDomains.length;
  if (n === 0) return 'All Controls Are Ready';
  const word = COUNT_WORD[n] ?? String(n);
  return `${word} Control${n === 1 ? '' : 's'} Need${n === 1 ? 's' : ''} Follow-Up`;
}

/**
 * Approved attention subtitle: `Owner: Payroll Team · <detail>`.
 * Falls back to the detail alone when no owner is resolved — never "Owner: —".
 */
export function attentionSubtitle(item: EmployeeAttentionItem): string {
  return item.owner ? `Owner: ${item.owner} · ${item.detail}` : item.detail;
}

/** Indicator tone class suffix used by the approved markup (`tab-indicator warning`). */
export function severityToneClass(severity: AttentionSeverity | null): string {
  return severity === 'warning' ? 'warning' : severity === 'info' ? 'info' : '';
}

/** Accessible tab label, e.g. "Documents, 2 items need attention". */
export function tabAriaLabel(tab: ProfileTabKey, indicator: ProfileTabIndicator | null): string {
  const label = TAB_LABEL[tab];
  if (!indicator || indicator.unresolvedCount < 1) return label;
  const n = indicator.unresolvedCount;
  const noun = tab === 'readiness'
    ? `unresolved blocker${n === 1 ? '' : 's'}`
    : tab === 'access'
      ? `request${n === 1 ? '' : 's'} in review`
      : `item${n === 1 ? '' : 's'} need${n === 1 ? 's' : ''} attention`;
  return `${label}, ${n} ${noun}`;
}

/** Tabs the actor may actually see. A capability-gated tab disappears entirely. */
export function visibleTabs(shell: EmployeeProfileShell | undefined, tabs: ProfileTabKey[]): ProfileTabKey[] {
  if (!shell) return tabs.filter(t => t === 'overview');
  const c = shell.capabilities;
  return tabs.filter(tab => {
    switch (tab) {
      case 'documents':   return c.viewDocuments;
      case 'readiness':   return c.viewReadiness;
      case 'activity':    return c.viewAudit;
      case 'offboarding': return c.viewOffboarding;
      default:            return true;
    }
  });
}

/** Identity line under the name: "Department · Location", omitting missing parts. */
export function identitySubtitle(shell: EmployeeProfileShell): string {
  const parts = [shell.identity.departmentName, shell.identity.siteName].filter(Boolean);
  return parts.length ? parts.join(' · ') : DASH;
}
