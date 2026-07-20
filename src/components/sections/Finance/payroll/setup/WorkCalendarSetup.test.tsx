// Mounted UI tests for the Work Calendar (F-CAL) admin console — UT-CAL-U1/U3/U4/U5/U6/U7/U8.
// The API layer + permissions + pay groups are mocked; the REAL HrfinWizardModal (overlay a11y) is
// used so keyboard/focus/aria behaviour is genuinely exercised.
import { render, screen, fireEvent, cleanup } from '@testing-library/preact';
import { describe, it, expect, vi, beforeEach, afterEach } from 'vitest';

const H = vi.hoisted(() => {
  const q = () => ({ data: undefined as unknown, isLoading: false, isError: false, refetch: () => {} });
  return {
    can: (_k: string): boolean => true,
    holidayList: q(), workList: q(), holidayDetail: q(), workDetail: q(), holidays: q(), assignments: q(),
    payGroups: [] as Array<{ id: string; code: string; name: string; frequency: string; active: boolean; statutoryCountry: string }>,
    resolveResult: null as unknown,
    mutate: (..._a: unknown[]) => Promise.resolve({}),
  };
});

vi.mock('@lib/permissions', async orig => ({ ...(await orig() as object), can: (k: string) => H.can(k) }));
vi.mock('@store', () => ({ toast: () => {} }));
vi.mock('@lib/dialog', () => ({ dialog: { confirm: () => Promise.resolve(true), prompt: () => Promise.resolve('2026-02-28'), error: () => Promise.resolve(undefined) } }));
vi.mock('@api/finance/payroll', () => ({ usePayGroups: () => ({ data: H.payGroups }) }));
vi.mock('@api/hr/workCalendars', () => ({
  requestKey: () => 'test-key',
  workCalendarsApi: {
    resolve: () => Promise.resolve(H.resolveResult),
    holidaySetCommand: (a: unknown) => H.mutate(a),
    workCalendarCommand: (a: unknown) => H.mutate(a),
    assignmentCommand: (a: unknown) => H.mutate(a),
  },
  useHolidayCalendars: () => H.holidayList,
  useWorkCalendars: () => H.workList,
  useHolidayCalendar: () => H.holidayDetail,
  useWorkCalendar: () => H.workDetail,
  useHolidays: () => H.holidays,
  useAssignments: () => H.assignments,
  useWorkCalendarMutation: (fn: (a: unknown) => Promise<unknown>) => ({ mutateAsync: fn, isPending: false }),
}));

import {
  WorkCalendarSetup, HolidaySetsPanel, PatternFields, PublishedHolidayVersionPicker, AssignModal, ResolveResultView, HolidayEditorModal,
} from './WorkCalendarSetup';
import { emptyPatternForm } from './workCalendarRules';
import type { ResolvePreview } from '../../../../../../types/workCalendars';

const loaded = <T,>(items: T[], nextCursor: string | null = null) => ({ data: { items, nextCursor }, isLoading: false, isError: false, refetch: () => {} });

beforeEach(() => {
  H.can = () => true;
  H.holidayList = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.workList = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.holidayDetail = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.workDetail = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.holidays = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.assignments = { data: undefined, isLoading: false, isError: false, refetch: () => {} };
  H.payGroups = [];
  H.resolveResult = null;
});
afterEach(() => cleanup());

// ── UT-CAL-U1 — directory loading / skeleton / empty / error / populated ──────
describe('UT-CAL-U1 directory states', () => {
  it('shows a skeleton while the first page is loading', () => {
    H.holidayList = { data: undefined, isLoading: true, isError: false, refetch: () => {} };
    const { container } = render(<HolidaySetsPanel />);
    expect(container.querySelector('.wcal-skel')).toBeTruthy();
  });
  it('shows an error state with a retry control', () => {
    H.holidayList = { data: undefined, isLoading: false, isError: true, refetch: () => {} };
    render(<HolidaySetsPanel />);
    expect(screen.getByText(/could not be loaded/i)).toBeTruthy();
    expect(screen.getByRole('button', { name: 'Retry' })).toBeTruthy();
  });
  it('shows an empty state when there are no rows', () => {
    H.holidayList = loaded([]);
    render(<HolidaySetsPanel />);
    expect(screen.getByText(/No holiday sets yet/i)).toBeTruthy();
  });
  it('renders the populated register', () => {
    H.holidayList = loaded([{ id: 'c1', name: 'Trinidad & Tobago National', jurisdiction: 'TT', lockVersion: 1, createdAt: '2026-01-01T00:00:00Z' }]);
    render(<HolidaySetsPanel />);
    expect(screen.getByText('Trinidad & Tobago National')).toBeTruthy();
    expect(screen.getByText('TT')).toBeTruthy();
  });
});

// ── UT-CAL-U3 — pattern editor starts with no selected weekdays ───────────────
describe('UT-CAL-U3 pattern editor', () => {
  it('starts with no weekday selected', () => {
    render(<PatternFields state={emptyPatternForm()} setState={() => {}} showHolidayPicker />);
    const days = screen.getAllByRole('checkbox');
    expect(days).toHaveLength(7);
    days.forEach(d => expect(d.getAttribute('aria-checked')).toBe('false'));
  });
});

// ── UT-CAL-U4 — published holiday picker shows names/version/range, not raw IDs ─
// initialCalendarId pre-opens the picker so the published-version list renders (the calendar select
// itself is exercised in operator browser QA; jsdom + preact/compat can't drive a controlled select).
describe('UT-CAL-U4 published holiday-set picker', () => {
  it('displays name, version and effective range instead of raw UUIDs', () => {
    H.holidayDetail = {
      data: {
        calendar: { id: 'cal-uuid-9999', name: 'Trinidad & Tobago National', jurisdiction: 'TT', lockVersion: 1, createdAt: '2026-01-01T00:00:00Z' },
        versions: [
          { id: 'ver-uuid-8888', holidayCalendarId: 'cal-uuid-9999', versionNo: 1, status: 'published', effectiveFrom: '2026-01-01', effectiveTo: null, timezone: 'America/Port_of_Spain', checksum: 'abc', provenance: 'user', lockVersion: 2 },
          { id: 'ver-uuid-7777', holidayCalendarId: 'cal-uuid-9999', versionNo: 2, status: 'draft', effectiveFrom: '2027-01-01', effectiveTo: null, timezone: 'America/Port_of_Spain', checksum: null, provenance: 'user', lockVersion: 1 },
        ],
      }, isLoading: false, isError: false, refetch: () => {},
    };
    render(<PublishedHolidayVersionPicker value="" onChange={() => {}} initialCalendarId="cal-uuid-9999" />);
    expect(screen.getByText(/v1 .*2026-01-01/)).toBeTruthy();     // published version + effective range
    expect(screen.queryByText(/v2 .*2027-01-01/)).toBeNull();     // draft version excluded
    expect(screen.queryByText('ver-uuid-8888')).toBeNull();       // raw UUID never shown
  });
});

// ── UT-CAL-U5 — assignment editor: org/pay-group scope + inline window/overlap errors ─
// (the window/overlap inline copy is unit-tested in workCalendarRules.test.ts — assignmentWindowError
// and friendlyError; here we prove the scope options + pay-group picker render.)
describe('UT-CAL-U5 assignment editor', () => {
  it('offers organization and pay-group scope with a pay-group picker', () => {
    H.payGroups = [{ id: 'pg1', code: 'WK', name: 'Weekly Ops', frequency: 'weekly', active: true, statutoryCountry: 'TT' }];
    render(<AssignModal onClose={() => {}} onSaved={() => {}} />);
    const scope = screen.getByLabelText('Scope') as HTMLSelectElement;
    expect([...scope.options].map(o => o.value)).toEqual(['pay_group', 'organization']);
    expect(screen.getByLabelText('Pay group')).toBeTruthy();
  });
});

// ── UT-CAL-U6 — resolve preview: path, names, checksums, working-day evidence ──
describe('UT-CAL-U6 resolve preview', () => {
  const result: ResolvePreview = {
    workCalendarId: 'wc', workCalendarVersionId: 'wv', workCalendarChecksum: 'abc123checksum01',
    holidayCalendarVersionId: 'hv', holidayCalendarChecksum: 'def456checksum02',
    resolutionPath: { scope: 'pay_group', assignmentId: 'as1' },
    workCalendar: { id: 'wc', name: 'Office 5-Day', versionNo: 1, status: 'published', effectiveFrom: '2026-01-01', effectiveTo: null, timezone: 'America/Port_of_Spain', workingWeekdays: [1, 2, 3, 4, 5], weekdayFractions: {} },
    holidayCalendar: { id: 'hc', name: 'Trinidad & Tobago National', jurisdiction: 'TT', versionNo: 1, status: 'published', effectiveFrom: '2026-01-01', effectiveTo: null },
    payGroup: { id: 'pg1', code: 'WK', name: 'Weekly Ops', statutoryCountry: 'TT' },
    workingDays: { count: '20', excluded: [{ date: '2026-02-01', reason: 'weekend', lostFraction: '1' }] },
  };
  it('renders path, resolved names, checksums and working-day evidence', () => {
    render(<ResolveResultView result={result} />);
    expect(screen.getByText('Path')).toBeTruthy();                 // path label
    expect(screen.getAllByText('Pay Group').length).toBeGreaterThanOrEqual(1); // pay-group path scope
    expect(screen.getByText(/Weekly Ops/)).toBeTruthy();           // resolved pay-group name (not raw id)
    expect(screen.getByText(/Office 5-Day/)).toBeTruthy();         // resolved work-calendar name
    expect(screen.getByText(/Trinidad & Tobago National/)).toBeTruthy(); // resolved holiday name
    expect(screen.getByText(/abc123checks/)).toBeTruthy();         // work checksum (shortened, not raw)
    expect(screen.getByText('20')).toBeTruthy();                   // working-day count
    expect(screen.getByText('2026-02-01')).toBeTruthy();           // excluded-date evidence
  });
});

// ── UT-CAL-U7 — permission states ─────────────────────────────────────────────
describe('UT-CAL-U7 permission states', () => {
  it('blocks the whole console without view permission', () => {
    H.can = () => false;
    render(<WorkCalendarSetup />);
    expect(screen.getByText(/do not have permission/i)).toBeTruthy();
  });
  it('view-only preserves read access but hides management commands', () => {
    H.can = (k: string) => k === 'hr.work_calendar.view';
    H.holidayList = loaded([{ id: 'c1', name: 'Trinidad & Tobago National', jurisdiction: 'TT', lockVersion: 1, createdAt: '2026-01-01T00:00:00Z' }]);
    render(<WorkCalendarSetup />);
    expect(screen.getByText('Trinidad & Tobago National')).toBeTruthy();     // read preserved
    expect(screen.queryByRole('button', { name: 'New Holiday Set' })).toBeNull(); // command hidden
  });
  it('manage permission reveals the create command', () => {
    H.can = () => true;
    H.holidayList = loaded([]);
    render(<WorkCalendarSetup />);
    expect(screen.getByRole('button', { name: 'New Holiday Set' })).toBeTruthy();
  });
});

// ── UT-CAL-U2/U8 — holiday editor gating + dialog a11y (via the real modal) ────
describe('UT-CAL-U2/U8 holiday editor + a11y', () => {
  it('disables save until the provenance form is complete, and enables it for a complete row', () => {
    render(<HolidayEditorModal versionId="v1" expectedLockVersion={1} existing={null} onClose={() => {}} onSaved={() => {}} />);
    expect(screen.getByRole('button', { name: 'Add Holiday' }).hasAttribute('disabled')).toBe(true);
    cleanup();
    render(<HolidayEditorModal versionId="v1" expectedLockVersion={1} onClose={() => {}} onSaved={() => {}}
      existing={{ id: 'h1', holidayDate: '2026-01-01', observedDate: null, effectiveDate: '2026-01-01', dayFraction: 1, year: 2026, jurisdiction: 'TT', nameStatutory: 'New Year’s Day', nameCommon: 'New Year', holidayType: 'statutory', sourceReference: 'Public Holidays Act', sourcePublishedDate: '2025-12-01', provenanceNote: 'Statutory.' }} />);
    expect(screen.getByRole('button', { name: 'Save Holiday' }).hasAttribute('disabled')).toBe(false);
  });

  it('exposes a labelled modal dialog, moves focus inside, and closes on Escape', () => {
    const onClose = vi.fn();
    render(<HolidayEditorModal versionId="v1" expectedLockVersion={1} existing={null} onClose={onClose} onSaved={() => {}} />);
    const dlg = screen.getByRole('dialog');
    expect(dlg.getAttribute('aria-modal')).toBe('true');
    expect(dlg.getAttribute('aria-label')).toBe('Add Holiday');
    expect(dlg.contains(document.activeElement)).toBe(true); // focus moved into the panel
    fireEvent.keyDown(document, { key: 'Escape' });
    expect(onClose).toHaveBeenCalled();
  });
});
