/**
 * Unit coverage for the shared Employee Profile view-model: the formatting and
 * gating rules the drawer and the full page both depend on.
 */
import { describe, expect, it } from 'vitest';
import {
  DASH, DRAWER_TABS, FULL_PAGE_TABS, attentionSubtitle, formatDate, formatDateTime,
  formatTenure, identitySubtitle, readinessExplanation, readinessHeadline, readinessLabel,
  severityToneClass, tabAriaLabel, titleCase, visibleTabs,
} from '../../src/components/sections/HR/employeeProfileModel';
import { tenureMonths, readinessSummary } from '../../netlify/functions/lib/hr/employeeProfileShell';
import type { EmployeeProfileShell, EmployeeAttentionItem } from '../../types/hrEmployeeProfile';

function shell(over: Partial<EmployeeProfileShell> = {}): EmployeeProfileShell {
  return {
    identity: {
      employeeId: 'EMP-1', employeeNo: 'E-001', displayName: 'Test Employee',
      profileImageUrl: null, employmentStatus: 'active', accountStatus: 'active',
      position: 'Technician', departmentName: 'Operations', siteName: 'Point Lisas',
    },
    employment: {
      employmentBasis: 'full_time', workArrangement: 'on_site', startDate: '2024-04-15',
      tenureMonths: 27, supervisorName: 'A Supervisor', payGroupName: 'Monthly',
    },
    readiness: null, attentionPreview: [], attentionTotal: 0, tabIndicators: [],
    contact: null, accountHealth: null, recentActivity: [],
    capabilities: {
      viewStatutory: true, viewReadiness: true, viewDocuments: true, viewAudit: true,
      viewOnboarding: true, viewOffboarding: true, viewAccountSecurity: true,
    },
    ...over,
  };
}

describe('title case', () => {
  it('humanises machine tokens', () => {
    expect(titleCase('on_leave')).toBe('On Leave');
    expect(titleCase('full_time')).toBe('Full Time');
  });
  it('keeps minor words lower-case unless they lead', () => {
    expect(titleCase('head_of_operations')).toBe('Head of Operations');
    expect(titleCase('of_counsel')).toBe('Of Counsel');
  });
  it('renders a dash for an absent value rather than an empty string', () => {
    expect(titleCase(null)).toBe(DASH);
    expect(titleCase('')).toBe(DASH);
  });
});

describe('date formatting', () => {
  it('uses the approved dd MMM yyyy form', () => {
    expect(formatDate('2025-01-08')).toBe('08 Jan 2025');
    expect(formatDate('2025-12-31T10:00:00Z')).toBe('31 Dec 2025');
  });
  it('appends the time for timestamps', () => {
    expect(formatDateTime('2025-01-08T11:04:00Z')).toBe('08 Jan 2025 11:04');
  });
  it('dashes an absent or unparseable value', () => {
    expect(formatDate(null)).toBe(DASH);
    expect(formatDate('not-a-date')).toBe(DASH);
    expect(formatDateTime(undefined)).toBe(DASH);
  });
});

describe('continuous service', () => {
  it('counts only completed months', () => {
    expect(tenureMonths('2026-06-30', '2026-07-28')).toBe(0);
    expect(tenureMonths('2026-06-28', '2026-07-28')).toBe(1);
    expect(tenureMonths('2024-04-15', '2026-07-28')).toBe(27);
  });
  it('never returns a negative tenure for a future start date', () => {
    expect(tenureMonths('2027-01-01', '2026-07-28')).toBe(0);
  });
  it('returns null when there is no start date', () => {
    expect(tenureMonths(null, '2026-07-28')).toBeNull();
  });
  it('formats as an approved label', () => {
    expect(formatTenure(0)).toBe('Less Than A Month');
    expect(formatTenure(1)).toBe('1 Month');
    expect(formatTenure(12)).toBe('1 Year');
    expect(formatTenure(27)).toBe('2 Years 3 Months');
    expect(formatTenure(null)).toBe(DASH);
  });
});

describe('readiness summary and copy', () => {
  const emp = { supervisor_id: 'S', department_id: 'D', site_id: 'X' };

  it('expresses readiness as ready-of-total controls', () => {
    expect(readinessSummary(emp, 'ready', 'current', 0)).toMatchObject({
      percent: 100, readyControls: 3, totalControls: 3, blockers: [],
    });
    expect(readinessSummary(emp, 'blocked', 'expired', 2)).toMatchObject({
      percent: 33, readyControls: 1, totalControls: 3, blockers: ['payroll', 'training'],
    });
    expect(readinessSummary({ supervisor_id: null, department_id: 'D', site_id: 'X' }, 'ready', 'current', 0))
      .toMatchObject({ percent: 67, blockers: ['assignment'] });
  });

  it('labels the gauge from the score and blocker count', () => {
    expect(readinessLabel(readinessSummary(emp, 'ready', 'current', 0))).toBe('Ready');
    expect(readinessLabel(readinessSummary(emp, 'blocked', 'current', 1))).toBe('Almost Ready');
    expect(readinessLabel(readinessSummary(emp, 'blocked', 'expired', 2))).toBe('Needs Review');
    expect(readinessLabel(null)).toBe(DASH);
  });

  it('writes the approved headline and explanation', () => {
    const two = readinessSummary(emp, 'blocked', 'expired', 2);
    expect(readinessHeadline(two)).toBe('Two Controls Need Follow-Up');
    expect(readinessExplanation(two)).toBe('Payroll and training are preventing this record from being fully ready.');

    const one = readinessSummary(emp, 'blocked', 'current', 1);
    expect(readinessHeadline(one)).toBe('One Control Needs Follow-Up');
    expect(readinessExplanation(one)).toBe('Payroll is preventing this record from being fully ready.');

    const none = readinessSummary(emp, 'ready', 'current', 0);
    expect(readinessHeadline(none)).toBe('All Controls Are Ready');
    expect(readinessExplanation(none)).toBe('Every readiness control has passed for this record.');
  });
});

describe('attention presentation', () => {
  const item = (over: Partial<EmployeeAttentionItem> = {}): EmployeeAttentionItem => ({
    id: 'x', domain: 'payroll', title: 'Bank Account Reverification Due',
    detail: 'Confirm account ending 4821', severity: 'critical', dueState: 'none', dueDate: null,
    owner: 'Payroll Team', responsibleParty: 'Payroll Team', actionLabel: 'Open Readiness',
    actionTarget: 'readiness', requiredCapability: null, ...over,
  });

  it('renders owner and detail in the approved order', () => {
    expect(attentionSubtitle(item())).toBe('Owner: Payroll Team · Confirm account ending 4821');
  });

  it('omits the owner prefix rather than printing "Owner: —"', () => {
    expect(attentionSubtitle(item({ owner: null }))).toBe('Confirm account ending 4821');
  });

  it('maps severity to the approved indicator tone class', () => {
    expect(severityToneClass('critical')).toBe('');
    expect(severityToneClass('warning')).toBe('warning');
    expect(severityToneClass('info')).toBe('info');
    expect(severityToneClass(null)).toBe('');
  });
});

describe('tab labels and gating', () => {
  it('describes indicator counts for assistive technology', () => {
    expect(tabAriaLabel('documents', { tab: 'documents', unresolvedCount: 2, highestSeverity: 'critical' }))
      .toBe('Documents, 2 items need attention');
    expect(tabAriaLabel('readiness', { tab: 'readiness', unresolvedCount: 2, highestSeverity: 'critical' }))
      .toBe('Readiness, 2 unresolved blockers');
    expect(tabAriaLabel('access', { tab: 'access', unresolvedCount: 1, highestSeverity: 'warning' }))
      .toBe('Access, 1 request in review');
    expect(tabAriaLabel('employment', null)).toBe('Employment');
  });

  it('hides capability-gated tabs entirely rather than showing an empty tab', () => {
    const denied = shell({
      capabilities: {
        viewStatutory: false, viewReadiness: false, viewDocuments: false, viewAudit: false,
        viewOnboarding: false, viewOffboarding: false, viewAccountSecurity: false,
      },
    });
    expect(visibleTabs(denied, FULL_PAGE_TABS)).toEqual(['overview', 'employment', 'access']);
    expect(visibleTabs(shell(), FULL_PAGE_TABS)).toEqual(FULL_PAGE_TABS);
  });

  it('keeps the drawer to its approved six tabs', () => {
    expect(DRAWER_TABS).not.toContain('offboarding');
    expect(visibleTabs(shell(), DRAWER_TABS)).toHaveLength(6);
  });

  it('falls back to overview only while the shell is unknown', () => {
    expect(visibleTabs(undefined, FULL_PAGE_TABS)).toEqual(['overview']);
  });
});

describe('identity subtitle', () => {
  it('joins department and location', () => {
    expect(identitySubtitle(shell())).toBe('Operations · Point Lisas');
  });
  it('omits a missing part instead of printing an empty separator', () => {
    expect(identitySubtitle(shell({
      identity: { ...shell().identity, siteName: null },
    }))).toBe('Operations');
  });
});
