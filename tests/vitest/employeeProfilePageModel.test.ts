/**
 * Unit coverage for the FULL-PAGE employee record's own view-model rules: the
 * document and activity toolbars, the readiness rail and work-item pills, the
 * account-assistance routing map, and the offboarding phase machine.
 *
 * These are the rules a rendered assertion cannot pin down cheaply — the exact
 * filter semantics, the priority a business impact maps to, and the fact that
 * every assistance option the dialog offers is a service domain the backend
 * actually validates.
 */
import { describe, expect, it } from 'vitest';
import {
  ACCOUNT_ASSISTANCE_TYPES, DOCUMENT_STATE_BADGE, EMPTY_ACTIVITY_FILTERS,
  EMPTY_DOCUMENT_FILTERS, activityArea, activityTitle, assistanceBody, assistanceLabel,
  assistancePriority, auditActors, changesThisMonth, coverageSentence, documentCategories,
  documentHealthBand, documentHealthScore, documentRowAction, documentRows, filterAuditRows,
  filterDocumentRows, hasActivityFilters, hasDocumentFilters, matchesDocumentStatus,
  matchesSupportFilter, offboardingPhase, offboardingTaskBadge, rangeStart,
  readinessMatrixBadge, readinessRailLabel, readinessRailState, readinessWorkStateBadge,
  supportStatusBadge, taskCompletion,
} from '../../src/components/sections/HR/profile/employeeProfilePageModel';
import { zServiceDomain } from '../../netlify/functions/lib/validate';
import type { DocumentHealthGroup, ReadinessControlMatrixEntry } from '../../types/hrEmployeeProfile';
import type { HrAuditEntry } from '../../src/api/hr/employees';
import type { OffboardingCaseRow } from '../../types/hrOffboarding';

const groups: DocumentHealthGroup[] = [
  {
    key: 'identity', label: 'Identity', currentCount: 1, expiringCount: 0, missingCount: 0,
    items: [{
      documentId: 'd1', requirementId: 'r1', documentType: 'identity_card',
      title: 'National Identification', state: 'verified', expiryDate: null,
      issuedAt: '2025-01-08', detail: 'Verified 2025-01-08', required: true,
    }],
  },
  {
    key: 'training', label: 'Training', currentCount: 0, expiringCount: 1, missingCount: 1,
    items: [
      {
        documentId: 'd2', requirementId: 'r2', documentType: 'training_safety',
        title: 'Safety Awareness Certification', state: 'expiring', expiryDate: '2026-06-03',
        issuedAt: '2024-06-03', detail: 'Expires 2026-06-03', required: true,
      },
      {
        documentId: null, requirementId: 'r3', documentType: 'training_emergency',
        title: 'Emergency Response Refresher', state: 'missing', expiryDate: null,
        issuedAt: null, detail: 'Not provided', required: true,
      },
    ],
  },
];

describe('document toolbar', () => {
  const rows = documentRows(groups);

  it('flattens the grouped tree and carries the category label onto every row', () => {
    expect(rows).toHaveLength(3);
    expect(rows.map(r => r.categoryLabel)).toEqual(['Identity', 'Training', 'Training']);
    expect(documentCategories(groups)).toEqual([
      { key: 'identity', label: 'Identity' }, { key: 'training', label: 'Training' },
    ]);
  });

  it('groups status the way the toolbar words it, counting expired as missing', () => {
    expect(matchesDocumentStatus('verified', 'verified')).toBe(true);
    expect(matchesDocumentStatus('current', 'verified')).toBe(true);
    expect(matchesDocumentStatus('expiring', 'expiring')).toBe(true);
    // An expired record is a compliance failure, not merely "expiring".
    expect(matchesDocumentStatus('expired', 'missing')).toBe(true);
    expect(matchesDocumentStatus('missing', 'missing')).toBe(true);
    expect(matchesDocumentStatus('verified', 'missing')).toBe(false);
  });

  it('filters on search, category and status together', () => {
    expect(filterDocumentRows(rows, EMPTY_DOCUMENT_FILTERS)).toHaveLength(3);
    expect(filterDocumentRows(rows, { ...EMPTY_DOCUMENT_FILTERS, category: 'training' })).toHaveLength(2);
    expect(filterDocumentRows(rows, { ...EMPTY_DOCUMENT_FILTERS, status: 'missing' })
      .map(r => r.title)).toEqual(['Emergency Response Refresher']);
    // Search matches the title, the raw type and the category label.
    expect(filterDocumentRows(rows, { ...EMPTY_DOCUMENT_FILTERS, search: '  SAFETY ' })).toHaveLength(1);
    expect(filterDocumentRows(rows, { ...EMPTY_DOCUMENT_FILTERS, search: 'identity' })).toHaveLength(1);
    expect(filterDocumentRows(rows, {
      search: 'refresher', category: 'identity', status: 'all',
    })).toHaveLength(0);
  });

  it('knows when a filter is actually active, so Clear cannot look enabled for nothing', () => {
    expect(hasDocumentFilters(EMPTY_DOCUMENT_FILTERS)).toBe(false);
    expect(hasDocumentFilters({ ...EMPTY_DOCUMENT_FILTERS, search: '   ' })).toBe(false);
    expect(hasDocumentFilters({ ...EMPTY_DOCUMENT_FILTERS, status: 'missing' })).toBe(true);
  });

  it('scores health from the verified share and names the band', () => {
    expect(documentHealthScore(undefined)).toBe(0);
    expect(documentHealthBand(95)).toBe('Strong Document Health');
    expect(documentHealthBand(83)).toBe('Good Document Health');
    expect(documentHealthBand(60)).toBe('Document Health Needs Attention');
    expect(documentHealthBand(10)).toBe('Document Health At Risk');
  });

  it('offers only the row action the row can actually perform', () => {
    // A requirement with no document can only be REQUESTED.
    expect(documentRowAction(rows[2]!)).toBe('request');
    expect(documentRowAction(rows[1]!)).toBe('review');
    expect(documentRowAction(rows[0]!)).toBe('open');
  });

  it('gives every health state an approved pill', () => {
    for (const state of Object.keys(DOCUMENT_STATE_BADGE) as (keyof typeof DOCUMENT_STATE_BADGE)[]) {
      expect(DOCUMENT_STATE_BADGE[state].label).toBeTruthy();
    }
    expect(DOCUMENT_STATE_BADGE.missing.tone).toBe('danger');
    expect(DOCUMENT_STATE_BADGE.expiring.tone).toBe('warning');
  });
});

describe('activity toolbar', () => {
  const rows: HrAuditEntry[] = [
    {
      id: 'a1', employee_id: 'e1', submodule_key: 'employees', actor_id: 'u1',
      actorName: 'Lila Auguste', action: 'hr.employee.updated', reason: 'Reassignment',
      created_at: '2026-07-20T09:00:00Z',
    },
    {
      id: 'a2', employee_id: 'e1', submodule_key: 'employee_documents', actor_id: null,
      actorName: null, action: 'hr.document.uploaded', reason: null,
      created_at: '2026-01-05T09:00:00Z',
    },
  ];
  const now = new Date('2026-07-28T00:00:00Z');

  it('maps a submodule key onto one of the four filterable areas', () => {
    expect(activityArea('employee_documents')).toBe('documents');
    expect(activityArea('readiness_work_items')).toBe('readiness');
    expect(activityArea('access_assignments')).toBe('account');
    // An unrecognised key falls to the record itself — history never vanishes.
    expect(activityArea('something_new')).toBe('employment');
    expect(activityArea(null)).toBe('employment');
  });

  it('filters by area, actor, range and free text', () => {
    expect(filterAuditRows(rows, { ...EMPTY_ACTIVITY_FILTERS, range: 'all' }, now)).toHaveLength(2);
    expect(filterAuditRows(rows, { ...EMPTY_ACTIVITY_FILTERS, range: 'all', area: 'documents' }, now))
      .toHaveLength(1);
    expect(filterAuditRows(rows, { ...EMPTY_ACTIVITY_FILTERS, range: 'all', actor: 'System' }, now)
      .map(r => r.id)).toEqual(['a2']);
    expect(filterAuditRows(rows, { ...EMPTY_ACTIVITY_FILTERS, range: 'all', search: 'reassign' }, now))
      .toHaveLength(1);
    // The default 90-day window excludes the January row.
    expect(filterAuditRows(rows, EMPTY_ACTIVITY_FILTERS, now)).toHaveLength(1);
  });

  it('computes the range bounds it filters on', () => {
    expect(rangeStart('all', now)).toBeNull();
    expect(rangeStart('this_month', now)?.toISOString()).toBe('2026-07-01T00:00:00.000Z');
    expect(rangeStart('this_year', now)?.toISOString()).toBe('2026-01-01T00:00:00.000Z');
    expect(rangeStart('last_90', now)?.toISOString()).toBe('2026-04-29T00:00:00.000Z');
  });

  it('offers actors as a picker and counts this month’s changes', () => {
    expect(auditActors(rows)).toEqual(['Lila Auguste', 'System']);
    expect(changesThisMonth(rows, now)).toBe(1);
  });

  it('turns a dotted audit action into a readable title', () => {
    expect(activityTitle('hr.employee.updated')).toBe('Employee Updated');
    expect(activityTitle('hr.document.uploaded')).toBe('Document Uploaded');
  });

  it('knows when an activity filter is active', () => {
    expect(hasActivityFilters(EMPTY_ACTIVITY_FILTERS)).toBe(false);
    expect(hasActivityFilters({ ...EMPTY_ACTIVITY_FILTERS, range: 'all' })).toBe(true);
  });
});

describe('readiness rail and matrix', () => {
  const entry = (over: Partial<ReadinessControlMatrixEntry> = {}): ReadinessControlMatrixEntry => ({
    control: {
      controlKey: 'payroll.bank', label: 'Payroll', domain: 'payroll',
      resolutionType: 'department_verification', description: null, isBlocking: true,
    },
    state: 'in_review', percent: 75, evaluatedAt: null,
    owner: {
      domain: 'payroll', status: 'resolved', ownerType: 'role', ownerId: 'finance_manager',
      ownerLabel: 'Payroll Team', recipientUserIds: [], reason: null,
    },
    workItem: null,
    ...over,
  });

  it('separates a blocking failure from one that only needs review', () => {
    expect(readinessRailState(entry({ percent: 100 }))).toBe('');
    expect(readinessRailState(entry())).toBe('blocked');
    expect(readinessRailLabel(entry())).toBe('Blocked');
    const advisory = entry();
    advisory.control = { ...advisory.control, isBlocking: false };
    expect(readinessRailState(advisory)).toBe('review');
    expect(readinessRailLabel(advisory)).toBe('Needs Review');
    expect(readinessRailLabel(entry({ percent: 100 }))).toBe('Ready');
  });

  it('pills the matrix row by completion and blocking status', () => {
    expect(readinessMatrixBadge(entry({ percent: 100 }))).toEqual({ label: 'Complete', tone: '' });
    expect(readinessMatrixBadge(entry())).toEqual({ label: 'Blocked', tone: 'danger' });
  });

  it('lets an overdue work item override its status, because overdue is what needs the action', () => {
    const overdue = entry({
      workItem: {
        id: 'wi', status: 'in_review', severity: 'warning', dueDate: '2020-01-01',
        ageDays: 9, ownerLabel: 'Payroll Team', responsibleTeam: 'Payroll Team',
        nextResponsibleParty: 'Payroll Review',
      },
    });
    expect(readinessWorkStateBadge(overdue, new Date('2026-07-28T00:00:00Z')))
      .toEqual({ label: 'Overdue', tone: 'danger' });

    const upcoming = entry({
      workItem: {
        id: 'wi', status: 'submitted_for_review', severity: 'warning', dueDate: '2027-01-01',
        ageDays: 1, ownerLabel: 'Payroll Team', responsibleTeam: null, nextResponsibleParty: null,
      },
    });
    expect(readinessWorkStateBadge(upcoming, new Date('2026-07-28T00:00:00Z')))
      .toEqual({ label: 'Submitted For Review', tone: 'warning' });
  });

  it('states coverage as a fraction, never a bare number', () => {
    expect(coverageSentence(4, 6)).toBe('4 of 6');
  });
});

describe('account assistance routing', () => {
  it('offers exactly the service domains the backend validates — no more, no fewer', () => {
    const offered = ACCOUNT_ASSISTANCE_TYPES.map(t => t.domain).sort();
    const accepted = [...zServiceDomain.options].sort();
    expect(offered).toEqual(accepted);
  });

  it('gives every option a distinct human label', () => {
    const labels = ACCOUNT_ASSISTANCE_TYPES.map(t => t.label);
    expect(new Set(labels).size).toBe(labels.length);
    expect(assistanceLabel('mfa')).toBe('MFA Device Replacement');
    // An unknown domain is title-cased rather than rendered raw.
    expect(assistanceLabel('some_new_domain')).toBe('Some New Domain');
  });

  it('raises priority for a blocking or security impact', () => {
    expect(assistancePriority('standard')).toBe('medium');
    expect(assistancePriority('blocked')).toBe('high');
    expect(assistancePriority('security')).toBe('high');
  });

  it('records the impact in the request body, so the two high-priority cases stay distinguishable', () => {
    expect(assistanceBody('  Cannot sign in.  ', 'security'))
      .toBe('Business impact: Security Concern\n\nCannot sign in.');
    expect(assistanceBody('Cannot sign in.', 'blocked'))
      .toContain('Business impact: Work Is Blocked');
  });

  it('classifies support request status for the pill and the history filter', () => {
    expect(supportStatusBadge('in_progress')).toEqual({ label: 'In Review', tone: 'warning' });
    expect(supportStatusBadge('resolved')).toEqual({ label: 'Resolved', tone: '' });
    expect(matchesSupportFilter('open', 'open')).toBe(true);
    expect(matchesSupportFilter('closed', 'open')).toBe(false);
    expect(matchesSupportFilter('closed', 'resolved')).toBe(true);
    expect(matchesSupportFilter('anything', 'all')).toBe(true);
  });
});

describe('offboarding phase', () => {
  const row = (over: Partial<OffboardingCaseRow>): OffboardingCaseRow => ({
    id: 'c1', caseNo: 'OFB-2026-0001', employeeId: 'e1', employeeName: 'Test',
    reason: 'resignation', packageKey: 'standard', status: 'in_progress', ownerId: null,
    ownerName: 'Lila Auguste', lastWorkingDay: '2026-08-31', exitDate: null,
    noticePeriodDays: 30, startedAt: '2026-07-01T00:00:00Z', readyAt: null, completedAt: null,
    taskCount: 4, openTaskCount: 3, blockerCount: 0,
    ...over,
  });

  it('separates the coordinating case from protected history', () => {
    const phase = offboardingPhase([
      row({ id: 'a', status: 'completed', completedAt: '2025-01-01T00:00:00Z' }),
      row({ id: 'b', status: 'in_progress' }),
      row({ id: 'c', status: 'cancelled', completedAt: '2026-01-01T00:00:00Z' }),
    ]);
    expect(phase.active?.id).toBe('b');
    // Newest closed case first.
    expect(phase.history.map(h => h.id)).toEqual(['c', 'a']);
  });

  it('reports no active case when every case is closed', () => {
    expect(offboardingPhase([row({ status: 'completed' })]).active).toBeNull();
    expect(offboardingPhase(undefined).active).toBeNull();
    expect(offboardingPhase(undefined).history).toEqual([]);
  });

  it('renders the completion fraction and the task pill', () => {
    expect(taskCompletion(4, 3)).toBe('1 Of 4');
    expect(taskCompletion(0, 0)).toBe('—');
    expect(offboardingTaskBadge('completed')).toEqual({ label: 'Complete', tone: '' });
    expect(offboardingTaskBadge('blocked')).toEqual({ label: 'Blocked', tone: 'danger' });
    expect(offboardingTaskBadge('pending')).toEqual({ label: 'Pending', tone: 'neutral' });
  });
});
