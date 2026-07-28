/**
 * Unit coverage for the canonical unresolved-work aggregation.
 *
 * The rules are pure, so they are exercised directly — no database, no mocks of
 * the boundary the E2E suite covers.
 */
import { describe, expect, it } from 'vitest';
import {
  buildAttentionItems, buildTabIndicators, filterAttentionByCapability, sortAttention,
  type AttentionInput,
} from '../../netlify/functions/lib/hr/employeeAttention';
import { resolveRequiredTypesForEmployee } from '../../netlify/functions/lib/hr/documentsCompliance';

const TODAY = '2026-07-28';

function input(over: Partial<AttentionInput> = {}): AttentionInput {
  return {
    employee: {
      id: 'EMP-1', supervisor_id: 'SUP-1', department_id: 'DEP-1', site_id: 'SITE-1',
      employment_status: 'active', status: 'active', role: 'employee', employment_type: 'employee',
    },
    statutory: { payroll_ready_status: 'ready', missing_blockers: [] },
    documents: [], requirements: [], certificates: [], changeRequests: [],
    onboarding: null, offboarding: null, today: TODAY,
    ...over,
  };
}

describe('employee attention aggregation', () => {
  it('reports nothing when the record is complete', () => {
    expect(buildAttentionItems(input())).toEqual([]);
  });

  it('raises one warning per missing assignment field', () => {
    const items = buildAttentionItems(input({
      employee: {
        id: 'EMP-1', supervisor_id: null, department_id: null, site_id: null,
        employment_status: 'active', status: 'active', role: 'employee', employment_type: 'employee',
      },
    }));
    expect(items.map(i => i.id).sort()).toEqual([
      'employment.missing:department', 'employment.missing:site', 'employment.missing:supervisor',
    ]);
    expect(items.every(i => i.severity === 'warning')).toBe(true);
    expect(items.every(i => i.actionTarget === 'employment')).toBe(true);
  });

  it('emits one critical item per recorded payroll blocker, not a single summary row', () => {
    const items = buildAttentionItems(input({
      statutory: { payroll_ready_status: 'blocked', missing_blockers: ['bir_file_number', 'td1_received'] },
    }));
    expect(items).toHaveLength(2);
    expect(items.map(i => i.title)).toEqual(['Bir File Number Required', 'Td1 Received Required']);
    expect(items.every(i => i.severity === 'critical')).toBe(true);
    expect(items.every(i => i.actionTarget === 'readiness')).toBe(true);
  });

  it('still reports a blocked payroll record that carries no reason', () => {
    const items = buildAttentionItems(input({
      statutory: { payroll_ready_status: 'blocked', missing_blockers: [] },
    }));
    expect(items.map(i => i.id)).toEqual(['payroll.blocker:unspecified']);
  });

  it('separates expired, expiring and unverified documents', () => {
    const items = buildAttentionItems(input({
      documents: [
        { id: 'D1', document_type: 'id', title: 'National ID', status: 'verified', expiry_date: '2026-07-01' },
        { id: 'D2', document_type: 'cert', title: 'Safety Card', status: 'verified', expiry_date: '2026-08-10' },
        { id: 'D3', document_type: 'ctr', title: 'Contract', status: 'uploaded', expiry_date: null },
      ],
    }));
    const byId = Object.fromEntries(items.map(i => [i.id, i]));
    expect(byId['documents.expired:D1']?.severity).toBe('critical');
    expect(byId['documents.expired:D1']?.detail).toBe('Expired 27 days ago.');
    expect(byId['documents.expiring:D2']?.severity).toBe('warning');
    expect(byId['documents.expiring:D2']?.detail).toBe('Expires in 13 days.');
    expect(byId['documents.unverified:D3']?.severity).toBe('warning');
  });

  it('ignores archived and rejected documents entirely', () => {
    const items = buildAttentionItems(input({
      documents: [
        { id: 'D1', document_type: 'id', title: 'Old ID', status: 'archived', expiry_date: '2020-01-01' },
        { id: 'D2', document_type: 'id', title: 'Bad ID', status: 'rejected', expiry_date: '2020-01-01' },
      ],
    }));
    expect(items).toEqual([]);
  });

  it('flags a required document only when no live document of that type exists', () => {
    const requirements = [{ document_type: 'nis', label: 'NIS Registration', requires_expiry: false }];
    const missing = buildAttentionItems(input({ requirements }));
    expect(missing.map(i => i.id)).toEqual(['documents.missing:nis']);
    expect(missing[0]?.responsibleParty).toBe('Employee');

    const satisfied = buildAttentionItems(input({
      requirements,
      documents: [{ id: 'D9', document_type: 'nis', title: 'NIS', status: 'verified', expiry_date: null }],
    }));
    expect(satisfied).toEqual([]);
  });

  it('treats an expired certificate as critical and an expiring one as warning', () => {
    const items = buildAttentionItems(input({
      certificates: [
        { id: 'C1', course_name: 'Working At Heights', status: 'current', expires_at: '2026-06-30' },
        { id: 'C2', course_name: 'First Aid', status: 'current', expires_at: '2026-08-05' },
        { id: 'C3', course_name: 'Revoked Course', status: 'revoked', expires_at: '2020-01-01' },
      ],
    }));
    const ids = items.map(i => i.id);
    expect(ids).toContain('training.expired:C1');
    expect(ids).toContain('training.expiring:C2');
    expect(ids).not.toContain('training.expired:C3');
  });

  it('surfaces a pending change request as access work in review', () => {
    const items = buildAttentionItems(input({
      changeRequests: [
        { id: 'CR1', change_no: 'CR-0007', change_type: 'contact_update', status: 'pending' },
        { id: 'CR2', change_no: 'CR-0008', change_type: 'contact_update', status: 'approved' },
      ],
    }));
    expect(items.map(i => i.id)).toEqual(['access.change_request:CR1']);
    expect(items[0]?.actionTarget).toBe('access');
  });

  it('escalates an overdue onboarding case to critical', () => {
    const open = buildAttentionItems(input({
      onboarding: { id: 'ON1', case_no: 'ONB-1', status: 'in_progress', dueAt: '2026-08-30' },
    }));
    expect(open[0]?.severity).toBe('info');

    const overdue = buildAttentionItems(input({
      onboarding: { id: 'ON1', case_no: 'ONB-1', status: 'in_progress', dueAt: '2026-07-01' },
    }));
    expect(overdue[0]?.severity).toBe('critical');
    expect(overdue[0]?.dueState).toBe('overdue');
  });

  it('reports an active offboarding case, and a blocked one as critical', () => {
    expect(buildAttentionItems(input({
      offboarding: { id: 'OF1', case_no: 'OFB-1', status: 'in_progress', dueAt: null },
    }))[0]?.severity).toBe('info');
    expect(buildAttentionItems(input({
      offboarding: { id: 'OF1', case_no: 'OFB-1', status: 'blocked', dueAt: null },
    }))[0]?.severity).toBe('critical');
    expect(buildAttentionItems(input({
      offboarding: { id: 'OF1', case_no: 'OFB-1', status: 'completed', dueAt: null },
    }))).toEqual([]);
  });

  it('orders by severity, then nearest due date, then stable id', () => {
    const sorted = sortAttention([
      { id: 'b', domain: 'documents', title: '', detail: '', severity: 'warning', dueState: 'none', dueDate: null, owner: null, responsibleParty: null, actionLabel: '', actionTarget: 'documents', requiredCapability: null },
      { id: 'a', domain: 'payroll', title: '', detail: '', severity: 'critical', dueState: 'none', dueDate: '2026-09-01', owner: null, responsibleParty: null, actionLabel: '', actionTarget: 'readiness', requiredCapability: null },
      { id: 'c', domain: 'payroll', title: '', detail: '', severity: 'critical', dueState: 'none', dueDate: '2026-08-01', owner: null, responsibleParty: null, actionLabel: '', actionTarget: 'readiness', requiredCapability: null },
    ]);
    expect(sorted.map(i => i.id)).toEqual(['c', 'a', 'b']);
  });
});

describe('capability filtering', () => {
  const items = buildAttentionItems(input({
    statutory: { payroll_ready_status: 'blocked', missing_blockers: ['td1_received'] },
    documents: [{ id: 'D1', document_type: 'id', title: 'ID', status: 'uploaded', expiry_date: null }],
    employee: { id: 'EMP-1', supervisor_id: null, department_id: 'D', site_id: 'S', employment_status: 'active', status: 'active', role: 'employee', employment_type: 'employee' },
  }));

  it('suppresses items the viewer has no capability for', () => {
    const visible = filterAttentionByCapability(items, new Set());
    // Only the uncapability-gated employment item survives.
    expect(visible.map(i => i.domain)).toEqual(['employment']);
  });

  it('returns a gated item once the capability is granted', () => {
    const visible = filterAttentionByCapability(items, new Set(['hr.employee_documents.view']));
    expect(visible.map(i => i.domain).sort()).toEqual(['documents', 'employment']);
  });
});

describe('document-requirement scope resolution (canonical engine)', () => {
  // loadAttentionInput now delegates scope resolution to the documents engine.
  // The previous local filter honoured only `all` and `department`, so role- and
  // employment_type-scoped requirements were NEVER reported missing. These cases
  // lock the canonical behaviour in.
  const REQS = [
    { id: 'r1', documentType: 'id_card', label: 'ID Card', appliesToScope: 'all' as const, appliesToValue: null, requiresExpiry: false, reminderDays: [], minConfidentiality: null, isActive: true, blocksOnboarding: false, allowWaiver: false },
    { id: 'r2', documentType: 'driver_permit', label: 'Driver Permit', appliesToScope: 'role' as const, appliesToValue: 'driver', requiresExpiry: true, reminderDays: [], minConfidentiality: null, isActive: true, blocksOnboarding: false, allowWaiver: false },
    { id: 'r3', documentType: 'contractor_agreement', label: 'Contractor Agreement', appliesToScope: 'employment_type' as const, appliesToValue: 'contractor', requiresExpiry: false, reminderDays: [], minConfidentiality: null, isActive: true, blocksOnboarding: false, allowWaiver: false },
    { id: 'r4', documentType: 'site_induction', label: 'Site Induction', appliesToScope: 'department' as const, appliesToValue: 'DEP-1', requiresExpiry: false, reminderDays: [], minConfidentiality: null, isActive: true, blocksOnboarding: false, allowWaiver: false },
    { id: 'r5', documentType: 'retired_form', label: 'Retired Form', appliesToScope: 'all' as const, appliesToValue: null, requiresExpiry: false, reminderDays: [], minConfidentiality: null, isActive: false, blocksOnboarding: false, allowWaiver: false },
  ];

  it('resolves a ROLE-scoped requirement that the old local filter dropped', () => {
    const applicable = resolveRequiredTypesForEmployee(
      { id: 'E1', full_name: null, role: 'driver', employment_type: 'employee', department_id: 'DEP-9' },
      REQS,
    );
    expect(applicable.map(r => r.documentType).sort()).toEqual(['driver_permit', 'id_card']);
  });

  it('resolves an EMPLOYMENT_TYPE-scoped requirement that the old local filter dropped', () => {
    const applicable = resolveRequiredTypesForEmployee(
      { id: 'E2', full_name: null, role: 'employee', employment_type: 'contractor', department_id: 'DEP-9' },
      REQS,
    );
    expect(applicable.map(r => r.documentType).sort()).toEqual(['contractor_agreement', 'id_card']);
  });

  it('still resolves department scope, and never applies an inactive requirement', () => {
    const applicable = resolveRequiredTypesForEmployee(
      { id: 'E3', full_name: null, role: 'employee', employment_type: 'employee', department_id: 'DEP-1' },
      REQS,
    );
    expect(applicable.map(r => r.documentType).sort()).toEqual(['id_card', 'site_induction']);
    expect(applicable.some(r => r.documentType === 'retired_form')).toBe(false);
  });

  it('applies only the unscoped requirement when nothing else matches', () => {
    const applicable = resolveRequiredTypesForEmployee(
      { id: 'E4', full_name: null, role: 'employee', employment_type: 'employee', department_id: 'DEP-9' },
      REQS,
    );
    expect(applicable.map(r => r.documentType)).toEqual(['id_card']);
  });
});

describe('tab indicators', () => {
  it('derive from the same filtered items and take the highest severity', () => {
    const indicators = buildTabIndicators(buildAttentionItems(input({
      statutory: { payroll_ready_status: 'blocked', missing_blockers: ['td1_received'] },
      certificates: [{ id: 'C2', course_name: 'First Aid', status: 'current', expires_at: '2026-08-05' }],
    })));
    const readiness = indicators.find(i => i.tab === 'readiness');
    expect(readiness).toEqual({ tab: 'readiness', unresolvedCount: 2, highestSeverity: 'critical' });
  });

  it('omit tabs with no unresolved work rather than emitting a zero badge', () => {
    expect(buildTabIndicators(buildAttentionItems(input()))).toEqual([]);
  });
});
