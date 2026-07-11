/**
 * src/api/finance/payroll.ts
 *
 * Typed client + TanStack hooks for the Finance Payroll backend
 * (routes/financePayroll.ts + routes/financeNis.ts — POST `finance/payroll/*`).
 * Finance owns payroll runs, run lines, warnings, payslips, exports, reports, and
 * NIS-profile verification. `actorId` is server-derived — never sent by the client.
 */
import { useQuery, useMutation, useQueryClient } from '@tanstack/preact-query';
import { apiPost } from '@lib/api';

// ── DTOs ──────────────────────────────────────────────────────────────────────

export interface PayrollRun {
  id: string;
  runNo: string;
  periodMonth: string;
  payFrequency: string;
  status: string;
  statutoryVersionId: string;
  weeksInPeriod: number;
  payGroup: string | null;
  payGroupId: string | null;
  payDate: string | null;
  cutOffDate: string | null;
  employeeCount: number;
  grossTotal: number;
  deductionTotal: number;
  netTotal: number;
  nisEmployerTotal: number;
  workflowId: string | null;
  inputLockedBy: string | null;
  inputLockedAt: string | null;
  createdBy: string | null;
  approvedBy: string | null;
  lockedBy: string | null;
  lockedAt: string | null;
  reopenedBy: string | null;
  reopenedAt: string | null;
  reopenReason: string | null;
  exportedAt: string | null;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunInput {
  id: string;
  runId: string;
  employeeId: string;
  sourceType: string;
  sourceId: string | null;
  componentCode: string | null;
  label: string | null;
  amount: number | null;
  quantity: number | null;
  rate: number | null;
  metadata: Record<string, unknown>;
  createdAt: string;
}

export interface PayrollRunLine {
  id: string;
  runId: string;
  employeeId: string;
  base: number;
  taxableGross: number;
  gross: number;
  nisEmployee: number;
  nisEmployer: number;
  healthSurcharge: number;
  chargeableIncome: number;
  paye: number;
  voluntaryDeductions: number;
  net: number;
  breakdown: Record<string, unknown>;
  departmentId: string | null;
  costCenterId: string | null;
  nisNumberMasked: string | null;
  nisStatus: string | null;
  nisClassNo: number | null;
  openingYtdNisEmployee: number;
  openingYtdNisEmployer: number;
  createdAt: string;
  updatedAt: string;
}

export interface PayrollRunWarning {
  id: string;
  runId: string;
  employeeId: string | null;
  warningType: string;
  severity: string;
  message: string;
  metadata: Record<string, unknown>;
  resolved: boolean;
  resolvedBy: string | null;
  resolvedAt: string | null;
}

export interface Payslip {
  id: string;
  payslipNo: string;
  runId: string;
  runLineId: string;
  employeeId: string;
  filePath: string | null;
  generatedAt: string;
  generatedBy: string | null;
  metadata: Record<string, unknown>;
}

export interface PayslipDelivery {
  id: string;
  payslipId: string;
  runId: string;
  employeeId: string;
  channel: string;
  recipient: string | null;
  status: 'queued' | 'sent' | 'failed' | 'skipped';
  passwordProtected: boolean;
  attempts: number;
  error: string | null;
  sentAt: string | null;
  createdAt: string;
}

export interface GlPreviewLine {
  mappingKey: string;
  accountCode: string | null;
  accountName: string | null;
  side: 'debit' | 'credit';
  amount: number;
}
export interface GlPreview {
  runId: string;
  lines: GlPreviewLine[];
  totalDebit: number;
  totalCredit: number;
  balanced: boolean;
  missingMappings: string[];
  alreadyPosted: boolean;
  journalId: string | null;
}
export interface GlJournalLine {
  lineNo: number; accountCode: string; debit: number; credit: number;
  description: string | null; costCenterId: string | null;
}
export interface GlJournal {
  id: string; journalNo: string; entryDate: string; memo: string | null;
  status: 'draft' | 'posted' | 'reversed';
  sourceModule: string; sourceRef: string | null;
  postedAt: string | null; postedBy: string | null;
  reversedAt: string | null; reversalOf: string | null; createdAt: string;
  lines: GlJournalLine[]; totalDebit: number; totalCredit: number;
}

export interface PayrollExport {
  id: string;
  exportNo: string;
  runId: string;
  format: string;
  filePath: string;
  checksum: string | null;
  generatedBy: string | null;
  generatedAt: string;
  isCurrent: boolean;
  metadata: Record<string, unknown>;
}

export interface PayrollReportResult {
  report: string;
  generatedAt: string;
  rows: Array<Record<string, unknown>>;
}

export interface NisProfileRow { [k: string]: unknown }

export interface RunAuditLogEntry {
  id:            string;
  action:        string;
  actorId:       string | null;
  previousState: Record<string, unknown> | null;
  newState:      Record<string, unknown> | null;
  reason:        string | null;
  createdAt:     string;
}

export interface CreateRunArgs {
  periodMonth: string;      // YYYY-MM-DD (first of month)
  payFrequency?: string;
  weeksInPeriod?: number;
  payGroup?: string;
  payGroupId?: string;      // when set, the group drives frequency + population
  payDate?: string;         // YYYY-MM-DD actual payment date
  cutOffDate?: string;      // YYYY-MM-DD cut-off date for changes
}

export interface PayGroup {
  id: string;
  code: string;
  name: string;
  frequency: 'weekly' | 'fortnightly' | 'semi_monthly' | 'monthly';
  defaultPayDay: number | null;
  defaultCutoffOffsetDays: number;
  statutoryCountry: string;
  active: boolean;
  memberCount?: number;
  createdAt: string;
}
export interface PayGroupMember { employeeId: string; effectiveFrom: string; effectiveTo: string | null }

export interface PopulationPreview {
  total:                   number;
  salaried:                number;
  hourly:                  number;
  missingPayBasis:         number;
  newHires:                number;
  terminations:            number;
  missingStatutoryProfile: number;
}

export interface ExportDownload {
  exportId:  string;
  exportNo:  string;
  runId:     string;
  format:    string;
  content:   string;
  mimeType:  string;
  filename:  string;
}

export interface ResolveWarningResult {
  id:         string;
  resolved:   boolean;
  resolvedBy: string;
  resolvedAt: string;
}

// ── Core call helper ────────────────────────────────────────────────────────────

async function call<T>(path: string, args: object = {}): Promise<T> {
  const res = await apiPost<{ success: boolean; data: T; message?: string }>(path, args as Record<string, unknown>);
  if (!res.success) throw new Error(res.message ?? `Request to ${path} failed.`);
  return res.data;
}

// ── API object ──────────────────────────────────────────────────────────────────

export const financePayrollApi = {
  // Runs
  listRuns:    (a: { status?: string; from?: string; to?: string; limit?: number } = {}) => call<PayrollRun[]>('finance/payroll/runs/list', a),
  getRun:      (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/get', a),
  createRun:   (a: CreateRunArgs)                       => call<PayrollRun>('finance/payroll/runs/create', a),
  lockInputs:  (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/lock-inputs', a),
  calculate:   (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/calculate', a),
  submitRun:   (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/submit', a),
  approveRun:  (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/approve', a),
  rejectRun:   (a: { id: string; reason: string })     => call<PayrollRun>('finance/payroll/runs/reject', a),
  lockRun:     (a: { id: string })                     => call<PayrollRun>('finance/payroll/runs/lock', a),
  reopenRun:   (a: { id: string; reason?: string })    => call<PayrollRun>('finance/payroll/runs/reopen', a),
  exportRun:   (a: { id: string; format?: string })    => call<PayrollExport>('finance/payroll/runs/export', a),

  // Run detail
  listInputs:   (a: { runId: string })                 => call<PayrollRunInput[]>('finance/payroll/inputs/list', a),
  listRunLines: (a: { runId: string })                 => call<PayrollRunLine[]>('finance/payroll/run-lines/list', a),
  listWarnings: (a: { runId: string })                 => call<PayrollRunWarning[]>('finance/payroll/warnings/list', a),

  // Exports
  listExports:  (a: { runId: string })                 => call<PayrollExport[]>('finance/payroll/exports/list', a),

  // Payslips
  generatePayslips: (a: { runId: string })             => call<{ generated: number }>('finance/payroll/payslips/generate', a),
  renderRunPayslips:(a: { runId: string })             => call<{ rendered: number; failed: number; total: number }>('finance/payroll/payslips/render-run', a),
  renderPayslip:    (a: { payslipId: string })         => call<Payslip>('finance/payroll/payslips/render', a),
  deliverRunPayslips:(a: { runId: string })            => call<{ sent: number; failed: number; skipped: number; total: number }>('finance/payroll/payslips/deliver-run', a),
  deliverPayslip:   (a: { payslipId: string })         => call<PayslipDelivery>('finance/payroll/payslips/deliver', a),
  listDeliveries:   (a: { runId: string })             => call<PayslipDelivery[]>('finance/payroll/payslips/deliveries/list', a),

  // Pay groups
  listPayGroups:  (a: { activeOnly?: boolean } = {})   => call<PayGroup[]>('finance/payroll/pay-groups/list', a),
  createPayGroup: (a: { code: string; name: string; frequency: string; defaultPayDay?: number; defaultCutoffOffsetDays?: number }) => call<PayGroup>('finance/payroll/pay-groups/create', a),
  assignPayGroup: (a: { employeeId: string; payGroupId: string; effectiveFrom: string; effectiveTo?: string | null }) => call<{ employeeId: string; payGroupId: string }>('finance/payroll/pay-groups/assign', a),
  payGroupMembers:(a: { payGroupId: string })          => call<PayGroupMember[]>('finance/payroll/pay-groups/members', a),

  // GL posting
  glPreview:  (a: { runId: string })                   => call<GlPreview>('finance/payroll/gl/preview', a),
  glPost:     (a: { runId: string })                   => call<{ journalId: string; journalNo: string; totalDebit: number; totalCredit: number }>('finance/payroll/gl/post', a),
  glReverse:  (a: { runId: string; reason: string })   => call<{ reversingJournalId: string; reversingJournalNo: string }>('finance/payroll/gl/reverse', a),
  glGet:      (a: { runId: string })                   => call<GlJournal | null>('finance/payroll/gl/get', a),
  listPayslips:     (a: { runId: string })             => call<Payslip[]>('finance/payroll/payslips/list', a),
  myPayslips:       (a: object = {})                   => call<Payslip[]>('finance/payroll/payslips/my', a),
  getPayslip:       (a: { id: string })                => call<Payslip>('finance/payroll/payslips/get', a),
  payslipSignedUrl: (a: { id: string })                => call<{ url: string }>('finance/payroll/payslips/signed-url', a),

  // Reports — 'report' is the key; additional filters go inside 'params' (the route's
  // Zod schema is z.object({ report, params?: z.record(...) }), so top-level unknown
  // keys are stripped).  Pass { report, params: { runId, from, to, ... } }.
  runReport:   (a: { report: string; params?: Record<string, unknown> }) => call<PayrollReportResult>('finance/payroll/reports/run', a),
  listReports: (a: object = {})                        => call<Array<{ key: string; label: string }>>('finance/payroll/reports/list', a),

  // Warning resolve
  resolveWarning: (a: { warningId: string; note?: string }) =>
    call<ResolveWarningResult>('finance/payroll/warnings/resolve', a),

  // Audit log for a run (drawer Audit tab)
  listRunAuditLog: (a: { runId: string }) =>
    call<RunAuditLogEntry[]>('finance/payroll/runs/audit/list', a),

  // Population preview (wizard step 2)
  populationPreview: (a: { periodMonth?: string } = {}) =>
    call<PopulationPreview>('finance/payroll/runs/population-preview', a),

  // Export download (returns content + metadata for browser download)
  exportDownload: (a: { exportId: string }) =>
    call<ExportDownload>('finance/payroll/exports/download', a),

  // NIS-profile verification (Finance verifies HR-captured continuity)
  listNisProfiles:  (a: { status?: string; limit?: number } = {}) => call<NisProfileRow[]>('finance/payroll/nis/list', a),
  getNisProfile:    (a: { id: string })                => call<NisProfileRow>('finance/payroll/nis/get', a),
  verifyNisProfile: (a: { id: string; verificationNote?: string | null }) => call<NisProfileRow>('finance/payroll/nis/verify', a),
  rejectNisProfile: (a: { id: string; reason?: string })=> call<NisProfileRow>('finance/payroll/nis/reject', a),
};

// ── Query keys ────────────────────────────────────────────────────────────────

export const financePayrollKeys = {
  runs:     (o: object = {}) => ['finance', 'payroll', 'runs', o] as const,
  run:      (id: string)     => ['finance', 'payroll', 'run', id] as const,
  inputs:   (id: string)     => ['finance', 'payroll', 'inputs', id] as const,
  runLines: (id: string)     => ['finance', 'payroll', 'run-lines', id] as const,
  warnings: (id: string)     => ['finance', 'payroll', 'warnings', id] as const,
  exports:  (id: string)     => ['finance', 'payroll', 'exports', id] as const,
  payslips: (id: string)     => ['finance', 'payroll', 'payslips', id] as const,
  glPreview:(id: string)     => ['finance', 'payroll', 'gl-preview', id] as const,
  nisProfiles: (o: object = {}) => ['finance', 'payroll', 'nis', o] as const,
};

// ── Query hooks ─────────────────────────────────────────────────────────────────

export function usePayrollRuns(opts: { status?: string; from?: string; to?: string; limit?: number } = {}) {
  return useQuery({ queryKey: financePayrollKeys.runs(opts), queryFn: () => financePayrollApi.listRuns(opts) });
}
export function usePayrollRun(id: string | null) {
  return useQuery({ queryKey: financePayrollKeys.run(id ?? ''), queryFn: () => financePayrollApi.getRun({ id: id! }), enabled: !!id });
}
export function useRunLines(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.runLines(runId ?? ''), queryFn: () => financePayrollApi.listRunLines({ runId: runId! }), enabled: !!runId });
}
export function useRunWarnings(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.warnings(runId ?? ''), queryFn: () => financePayrollApi.listWarnings({ runId: runId! }), enabled: !!runId });
}
export function useRunPayslips(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.payslips(runId ?? ''), queryFn: () => financePayrollApi.listPayslips({ runId: runId! }), enabled: !!runId });
}
export function useRunGlPreview(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.glPreview(runId ?? ''), queryFn: () => financePayrollApi.glPreview({ runId: runId! }), enabled: !!runId });
}
export function usePayGroups(activeOnly = true) {
  return useQuery({ queryKey: ['finance', 'payroll', 'pay-groups', activeOnly], queryFn: () => financePayrollApi.listPayGroups({ activeOnly }) });
}
export function useRunExports(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.exports(runId ?? ''), queryFn: () => financePayrollApi.listExports({ runId: runId! }), enabled: !!runId });
}
export function useRunInputs(runId: string | null) {
  return useQuery({ queryKey: financePayrollKeys.inputs(runId ?? ''), queryFn: () => financePayrollApi.listInputs({ runId: runId! }), enabled: !!runId });
}
export function useNisProfiles(opts: { status?: string; limit?: number } = {}) {
  return useQuery({ queryKey: financePayrollKeys.nisProfiles(opts), queryFn: () => financePayrollApi.listNisProfiles(opts) });
}
export function useRunAuditLog(runId: string | null) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'audit', runId ?? ''],
    queryFn:  () => financePayrollApi.listRunAuditLog({ runId: runId! }),
    enabled:  !!runId,
  });
}
export function usePopulationPreview(periodMonth?: string) {
  return useQuery({
    queryKey: ['finance', 'payroll', 'population-preview', periodMonth],
    queryFn:  () => financePayrollApi.populationPreview(periodMonth ? { periodMonth } : {}),
  });
}

// ── Mutation hook (invalidates the whole finance-payroll subtree) ───────────────

export function usePayrollMutation<A, R>(fn: (a: A) => Promise<R>) {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: fn,
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] }); },
  });
}

// ── Targeted mutation hooks ─────────────────────────────────────────────────────

/** Resolve a payroll run warning — invalidates the run's warnings cache. */
export function useResolveWarning() {
  const qc = useQueryClient();
  return useMutation({
    mutationFn: (a: { warningId: string; note?: string }) => financePayrollApi.resolveWarning(a),
    onSuccess: () => { void qc.invalidateQueries({ queryKey: ['finance', 'payroll'] }); },
  });
}

/** Download export — mutation so it's not cached (content is always fresh). */
export function useExportDownload() {
  return useMutation({
    mutationFn: (a: { exportId: string }) => financePayrollApi.exportDownload(a),
  });
}
