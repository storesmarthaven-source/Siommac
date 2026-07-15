/**
 * src/api/finance/statutory.ts
 *
 * Typed client + TanStack hooks for the Finance Statutory Configuration backend
 * (routes/financeStatutory.ts — POST `finance/statutory/*` + `finance/payroll/components/*`,
 * camelCase `body.args`). Finance owns the statutory treatment (NIS / PAYE / Health Surcharge
 * rate versions + the pay-component catalogue). `actorId` is derived server-side from auth —
 * clients never send it.
 *
 * `call<T>` throws on `success:false`; callers surface errors via @lib/dialog or toast.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── DTOs (mirror the backend lib return shapes exactly) ─────────────────────────

export type StatutoryVersionStatus = 'draft' | 'pending_approval' | 'approved' | 'active' | 'retired';

export interface StatutoryVersion {
  id: string;
  effectiveFrom: string;
  label: string;
  jurisdiction: string;
  currency: string;
  payePersonalAllowance: number;
  payeBand1Ceiling: number;
  payeBand1Rate: number;
  payeBand2Rate: number;
  hsMonthlyThreshold: number;
  hsWeeklyHigh: number;
  hsWeeklyLow: number;
  nisMonthyCeiling: number | null;
  status: StatutoryVersionStatus;
  workflowId: string | null;
  isActive: boolean;
  createdBy: string | null;
  approvedBy: string | null;
  activatedBy: string | null;
  activatedAt: string | null;
  retiredBy: string | null;
  retiredAt: string | null;
  createdAt: string;
  updatedAt: string;
  /** Payroll runs referencing this version. Populated by listVersions endpoint. */
  linkedPayrollRunCount?: number;
  /** Headline NIS contribution rate (%) — derived from the version's earnings classes.
   *  Populated by listVersions; null if the version has no NIS classes. */
  nisRatePercent?: number | null;
}

export interface NisClass {
  id: string;
  statutoryVersionId: string;
  classNo: number;
  weeklyMin: number;
  weeklyMax: number | null;
  /** NIBTT assumed average weekly earnings — the contribution + benefit basis. */
  assumedAverageWeekly: number | null;
  employeeWeekly: number;
  employerWeekly: number;
  /** Reduced weekly contribution for workers over pensionable age (injury portion only). */
  classZWeekly: number | null;
  createdAt: string;
}

export interface PayComponent {
  id: string;
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory: boolean;
  isTaxable: boolean;
  reducesChargeable: boolean;
  glAccountCode: string | null;
  costAllocationRequired: boolean;
  isActive: boolean;
  createdBy: string | null;
  updatedBy: string | null;
  createdAt: string;
  updatedAt: string;
}

export type StatutoryReportRow = Record<string, unknown>;

export interface CreateStatutoryVersionArgs {
  effectiveFrom: string;
  label: string;
  jurisdiction?: 'TT';
  currency?: 'TTD';
  payePersonalAllowance: number;
  payeBand1Ceiling: number;
  payeBand1Rate: number;
  payeBand2Rate: number;
  hsMonthlyThreshold: number;
  hsWeeklyHigh: number;
  hsWeeklyLow: number;
  nisMonthyCeiling?: number | null;
}

export interface UpsertNisClassArgs {
  statutoryVersionId: string;
  classNo: number;
  weeklyMin: number;
  weeklyMax?: number | null;
  assumedAverageWeekly?: number | null;
  employeeWeekly: number;
  employerWeekly: number;
  classZWeekly?: number | null;
}

export interface NisClassImportRow {
  classNo: number;
  weeklyMin: number;
  weeklyMax?: number | null;
  assumedAverageWeekly?: number | null;
  employeeWeekly: number;
  employerWeekly: number;
  classZWeekly?: number | null;
}

export interface NisClassImportResult {
  imported: number;
  errors: { row: number; message: string }[];
}

export interface ApprovalTimelineEntry {
  id: string;
  action: string;
  actorId: string;
  reason: string | null;
  previousState: unknown;
  newState: unknown;
  createdAt: string;
}

export interface StatutoryVersionDetail extends StatutoryVersion {
  nisClasses: NisClass[];
  approvalTimeline: ApprovalTimelineEntry[];
  linkedPayrollRunCount: number;
}

export interface StatutoryReportResult {
  report: string;
  generatedAt: string;
  rows: Record<string, unknown>[];
}

export type StatutoryReportKey = 'statutory_version_summary' | 'nis_class_summary' | 'pay_component_map' | 'statutory_approval_history';

export interface CreatePayComponentArgs {
  code: string;
  name: string;
  kind: 'earning' | 'deduction';
  isStatutory?: boolean;
  isTaxable?: boolean;
  reducesChargeable?: boolean;
  glAccountCode?: string | null;
  costAllocationRequired?: boolean;
}

/**
 * A pending or resolved change request for a pay component.
 * Returned by create/update/retire (the mutation opens a CR, not the component directly).
 */
export interface PayComponentChangeRequest {
  id: string;
  changeType: 'create' | 'update' | 'retire';
  componentId: string | null;
  payload: Record<string, unknown>;
  status: 'pending_approval' | 'approved' | 'rejected';
  createdBy: string | null;
  approvedBy: string | null;
  workflowId: string | null;
  createdAt: string;
  updatedAt: string | null;
}

// ── Core call helper ────────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ──────────────────────────────────────────────────────────────────

export const financeStatutoryApi = {
  // Statutory rate versions
  listVersions:      (a: { jurisdiction?: string; status?: string; activeOnly?: boolean } = {}) => call<StatutoryVersion[]>('finance/statutory/versions/list', a),
  getVersion:        (a: { id: string })                                     => call<StatutoryVersion>('finance/statutory/versions/get', a),
  getVersionDetail:  (a: { id: string })                                     => call<StatutoryVersionDetail>('finance/statutory/versions/detail', a),
  createVersion:     (a: CreateStatutoryVersionArgs)                         => call<StatutoryVersion>('finance/statutory/versions/create', a),
  updateVersion:     (a: { id: string } & Partial<CreateStatutoryVersionArgs>) => call<StatutoryVersion>('finance/statutory/versions/update', a),
  submitVersion:     (a: { id: string; idempotencyKey: string })            => call<StatutoryVersion>('finance/statutory/versions/submit', a),
  approveVersion:    (a: { id: string })                                     => call<StatutoryVersion>('finance/statutory/versions/approve', a),
  rejectVersion:     (a: { id: string; reason?: string })                    => call<StatutoryVersion>('finance/statutory/versions/reject', a),
  activateVersion:   (a: { id: string })                                     => call<StatutoryVersion>('finance/statutory/versions/activate', a),
  retireVersion:     (a: { id: string })                                     => call<StatutoryVersion>('finance/statutory/versions/retire', a),
  getApprovalTimeline: (a: { id: string })                                   => call<ApprovalTimelineEntry[]>('finance/statutory/versions/approval-timeline', a),

  // NIS classes
  listNisClasses:    (a: { statutoryVersionId: string })                     => call<NisClass[]>('finance/statutory/nis-classes/list', a),
  // The upsert route takes an ARRAY (`classes`) and returns the upserted rows —
  // wrap the single-band form into that contract and unwrap the first row back.
  upsertNisClass:    async (a: UpsertNisClassArgs): Promise<NisClass> => {
    const rows = await call<NisClass[]>('finance/statutory/nis-classes/upsert', {
      statutoryVersionId: a.statutoryVersionId,
      classes: [{
        classNo: a.classNo,
        weeklyMin: a.weeklyMin,
        weeklyMax: a.weeklyMax ?? null,
        assumedAverageWeekly: a.assumedAverageWeekly ?? null,
        employeeWeekly: a.employeeWeekly,
        employerWeekly: a.employerWeekly,
        classZWeekly: a.classZWeekly ?? null,
      }],
    });
    const row = rows[0];
    if (!row) throw new Error('Upsert returned no NIS band.');
    return row;
  },
  deleteNisClass:    (a: { id: string })                                     => call<{ id: string }>('finance/statutory/nis-classes/delete', a),
  importNisClasses:  (a: { statutoryVersionId: string; rows: NisClassImportRow[] }) => call<NisClassImportResult>('finance/statutory/nis-classes/import', a),

  // Reports — legacy list (shape: raw array)
  listReports:       (a: object = {})                                        => call<StatutoryReportRow[]>('finance/statutory/reports/list', a),
  // Reports — typed run (shape: ReportResult)
  runReport:         (a: { report: StatutoryReportKey; jurisdiction?: string; versionId?: string }) => call<StatutoryReportResult>('finance/statutory/reports/run', a),

  // Pay-component catalogue (Finance-owned)
  listComponents:    (a: { activeOnly?: boolean; kind?: 'earning' | 'deduction'; isStatutory?: boolean } = {}) => call<PayComponent[]>('finance/payroll/components/list', a),
  // Mutations now open a change request (maker-checker); the return type is a CR, not the component.
  createComponent:   (a: CreatePayComponentArgs)                            => call<PayComponentChangeRequest>('finance/payroll/components/create', a),
  updateComponent:   (a: { id: string } & Partial<CreatePayComponentArgs>) => call<PayComponentChangeRequest>('finance/payroll/components/update', a),
  retireComponent:   (a: { id: string })                                    => call<PayComponentChangeRequest>('finance/payroll/components/retire', a),

  // Change-request approval queue
  listComponentChangeRequests: (a: { status?: PayComponentChangeRequest['status']; componentId?: string } = {}) =>
    call<PayComponentChangeRequest[]>('finance/payroll/components/change-requests/list', a),
  approveComponentChangeRequest: (a: { id: string }) =>
    call<PayComponentChangeRequest>('finance/payroll/components/change-requests/approve', a),
  rejectComponentChangeRequest: (a: { id: string; reason?: string }) =>
    call<PayComponentChangeRequest>('finance/payroll/components/change-requests/reject', a),
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const financeStatutoryKeys = {
  versions:         (o: object = {}) => ['finance', 'statutory', 'versions', o] as const,
  version:          (id: string)     => ['finance', 'statutory', 'version', id] as const,
  versionDetail:    (id: string)     => ['finance', 'statutory', 'version', id, 'detail'] as const,
  nisClasses:       (vid: string)    => ['finance', 'statutory', 'nis-classes', vid] as const,
  approvalTimeline: (id: string)     => ['finance', 'statutory', 'version', id, 'timeline'] as const,
  reports:          ()               => ['finance', 'statutory', 'reports'] as const,
  report:           (key: string, o: object = {}) => ['finance', 'statutory', 'report', key, o] as const,
  components:       (o: object = {}) => ['finance', 'payroll', 'components', o] as const,
  componentCRs:     (o: object = {}) => ['finance', 'payroll', 'components', 'change-requests', o] as const,
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

export function useStatutoryVersions(opts: { jurisdiction?: string; status?: string; activeOnly?: boolean } = {}) {
  return useQuery({ queryKey: financeStatutoryKeys.versions(opts), queryFn: () => financeStatutoryApi.listVersions(opts) });
}
export function useNisClasses(statutoryVersionId: string | null) {
  return useQuery({
    queryKey: financeStatutoryKeys.nisClasses(statutoryVersionId ?? ''),
    queryFn: () => financeStatutoryApi.listNisClasses({ statutoryVersionId: statutoryVersionId! }),
    enabled: !!statutoryVersionId,
  });
}
export function usePayComponents(opts: { activeOnly?: boolean; kind?: 'earning' | 'deduction'; isStatutory?: boolean } = {}) {
  return useQuery({ queryKey: financeStatutoryKeys.components(opts), queryFn: () => financeStatutoryApi.listComponents(opts) });
}

/** Live pending/approved/rejected change requests for the pay-component catalogue. */
export function usePayComponentChangeRequests(opts: {
  status?: PayComponentChangeRequest['status'];
  componentId?: string;
} = {}) {
  return useQuery({
    queryKey: financeStatutoryKeys.componentCRs(opts),
    queryFn:  () => financeStatutoryApi.listComponentChangeRequests(opts),
  });
}
export function useVersionDetail(id: string | null) {
  return useQuery({
    queryKey: financeStatutoryKeys.versionDetail(id ?? ''),
    queryFn: () => financeStatutoryApi.getVersionDetail({ id: id! }),
    enabled: !!id,
  });
}
export function useApprovalTimeline(id: string | null) {
  return useQuery({
    queryKey: financeStatutoryKeys.approvalTimeline(id ?? ''),
    queryFn: () => financeStatutoryApi.getApprovalTimeline({ id: id! }),
    enabled: !!id,
  });
}
export function useStatutoryReport(report: StatutoryReportKey | null, opts: { jurisdiction?: string; versionId?: string } = {}) {
  return useQuery({
    queryKey: financeStatutoryKeys.report(report ?? '', opts),
    queryFn: () => financeStatutoryApi.runReport({ report: report!, ...opts }),
    enabled: !!report,
  });
}

// ── Mutation hook (invalidates the whole finance-statutory subtree) ─────────────

export function useStatutoryMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => {
      void qc.invalidateQueries({ queryKey: ['finance', 'statutory'] });
      void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] });
    },
  });
}
