import { sb } from '../../db';
import { payrollRpcHttpError } from './rpcError';

export interface PayrollCertification {
  id: string;
  runId: string;
  calculationVersionId: string;
  inputSnapshotId: string;
  certificationNo: number;
  certificationType: 'processor';
  evidence: Record<string, unknown>;
  stateChecksum: string;
  checksum: string;
  supersedesId: string | null;
  certifiedBy: string;
  certifiedAt: string;
  createdAt: string;
}

export interface PayrollFundingConfirmation {
  id: string;
  runId: string;
  calculationVersionId: string;
  confirmationNo: number;
  confirmedAmount: number;
  currency: 'TTD';
  confirmationReference: string;
  accountReference: string | null;
  evidence: Record<string, unknown>;
  checksum: string;
  supersedesId: string | null;
  confirmedBy: string;
  confirmedAt: string;
  createdAt: string;
}

export interface PayrollReleaseCertificate {
  id: string;
  runId: string;
  calculationVersionId: string;
  certificationId: string;
  fundingConfirmationId: string;
  glJournalId: string;
  disbursementId: string;
  controlTotals: Record<string, unknown>;
  payslipManifest: Record<string, unknown>;
  artifactChecksums: Record<string, unknown>;
  checksum: string;
  releasedBy: string;
  releasedAt: string;
  createdAt: string;
  remittances?: Array<{
    id: string;
    authority: string;
    periodYear: number;
    periodMonth: number;
  }>;
}

export interface PayrollReleasePreflight {
  runId: string;
  runNo: string;
  status: string;
  ready: boolean;
  alreadyReleased: boolean;
  blockers: Array<{ code: string; message: string }>;
  calculationVersionId: string | null;
  certificationId: string | null;
  fundingConfirmationId: string | null;
  glJournalId: string | null;
  glDebit: number;
  glCredit: number;
  invalidGlAccountCount: number;
  invalidNisPeriodCount: number;
  payslipCount: number;
  renderedPayslipCount: number;
  missingBankAccountCount: number;
  disbursementId: string | null;
  netPayroll: number;
  employeeCount: number;
}

interface DbCertification {
  id: string;
  run_id: string;
  calculation_version_id: string;
  input_snapshot_id: string;
  certification_no: number;
  certification_type: 'processor';
  evidence: Record<string, unknown>;
  state_checksum: string;
  checksum: string;
  supersedes_id: string | null;
  certified_by: string;
  certified_at: string;
  created_at: string;
}

interface DbFundingConfirmation {
  id: string;
  run_id: string;
  calculation_version_id: string;
  confirmation_no: number;
  confirmed_amount: number;
  currency: 'TTD';
  confirmation_reference: string;
  account_reference: string | null;
  evidence: Record<string, unknown>;
  checksum: string;
  supersedes_id: string | null;
  confirmed_by: string;
  confirmed_at: string;
  created_at: string;
}

interface DbReleaseCertificate {
  id: string;
  run_id: string;
  calculation_version_id: string;
  certification_id: string;
  funding_confirmation_id: string;
  gl_journal_id: string;
  disbursement_id: string;
  control_totals: Record<string, unknown>;
  payslip_manifest: Record<string, unknown>;
  artifact_checksums: Record<string, unknown>;
  checksum: string;
  released_by: string;
  released_at: string;
  created_at: string;
}

function toCertification(row: DbCertification): PayrollCertification {
  return {
    id: row.id,
    runId: row.run_id,
    calculationVersionId: row.calculation_version_id,
    inputSnapshotId: row.input_snapshot_id,
    certificationNo: row.certification_no,
    certificationType: row.certification_type,
    evidence: row.evidence,
    stateChecksum: row.state_checksum,
    checksum: row.checksum,
    supersedesId: row.supersedes_id,
    certifiedBy: row.certified_by,
    certifiedAt: row.certified_at,
    createdAt: row.created_at,
  };
}

function toFundingConfirmation(
  row: DbFundingConfirmation,
): PayrollFundingConfirmation {
  return {
    id: row.id,
    runId: row.run_id,
    calculationVersionId: row.calculation_version_id,
    confirmationNo: row.confirmation_no,
    confirmedAmount: Number(row.confirmed_amount),
    currency: row.currency,
    confirmationReference: row.confirmation_reference,
    accountReference: row.account_reference,
    evidence: row.evidence,
    checksum: row.checksum,
    supersedesId: row.supersedes_id,
    confirmedBy: row.confirmed_by,
    confirmedAt: row.confirmed_at,
    createdAt: row.created_at,
  };
}

function toReleaseCertificate(
  row: DbReleaseCertificate,
): PayrollReleaseCertificate {
  return {
    id: row.id,
    runId: row.run_id,
    calculationVersionId: row.calculation_version_id,
    certificationId: row.certification_id,
    fundingConfirmationId: row.funding_confirmation_id,
    glJournalId: row.gl_journal_id,
    disbursementId: row.disbursement_id,
    controlTotals: row.control_totals,
    payslipManifest: row.payslip_manifest,
    artifactChecksums: row.artifact_checksums,
    checksum: row.checksum,
    releasedBy: row.released_by,
    releasedAt: row.released_at,
    createdAt: row.created_at,
  };
}

function asPreflight(value: unknown): PayrollReleasePreflight {
  const row = (value ?? {}) as Record<string, unknown>;
  return {
    runId: String(row.runId ?? ''),
    runNo: String(row.runNo ?? ''),
    status: String(row.status ?? ''),
    ready: row.ready === true,
    alreadyReleased: row.alreadyReleased === true,
    blockers: Array.isArray(row.blockers)
      ? row.blockers as Array<{ code: string; message: string }>
      : [],
    calculationVersionId: typeof row.calculationVersionId === 'string'
      ? row.calculationVersionId
      : null,
    certificationId: typeof row.certificationId === 'string'
      ? row.certificationId
      : null,
    fundingConfirmationId: typeof row.fundingConfirmationId === 'string'
      ? row.fundingConfirmationId
      : null,
    glJournalId: typeof row.glJournalId === 'string' ? row.glJournalId : null,
    glDebit: Number(row.glDebit ?? 0),
    glCredit: Number(row.glCredit ?? 0),
    invalidGlAccountCount: Number(row.invalidGlAccountCount ?? 0),
    invalidNisPeriodCount: Number(row.invalidNisPeriodCount ?? 0),
    payslipCount: Number(row.payslipCount ?? 0),
    renderedPayslipCount: Number(row.renderedPayslipCount ?? 0),
    missingBankAccountCount: Number(row.missingBankAccountCount ?? 0),
    disbursementId: typeof row.disbursementId === 'string'
      ? row.disbursementId
      : null,
    netPayroll: Number(row.netPayroll ?? 0),
    employeeCount: Number(row.employeeCount ?? 0),
  };
}

export async function certifyPayrollRun(input: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
  attestations: {
    populationReconciled: true;
    inputsReviewed: true;
    statutoryReviewed: true;
    variancesReviewed: true;
    paymentReadinessReviewed: true;
    glReadinessReviewed: true;
  };
  note?: string;
}): Promise<{
  certification: PayrollCertification;
  controlState: Record<string, unknown>;
  eventId: string;
  duplicate: boolean;
}> {
  const { data, error } = await sb.rpc('finance_payroll_certify_run_tx', {
    p_run_id: input.runId,
    p_actor_id: input.actorId,
    p_idempotency_key: input.idempotencyKey,
    p_attestations: input.attestations,
    p_note: input.note ?? null,
  });
  if (error) throw payrollRpcHttpError(error);
  const result = (data ?? {}) as {
    certification?: DbCertification;
    controlState?: Record<string, unknown>;
    eventId?: string;
    duplicate?: boolean;
  };
  if (!result.certification || !result.eventId) {
    throw Object.assign(
      new Error('Certification committed but returned an invalid result.'),
      { status: 500 },
    );
  }
  return {
    certification: toCertification(result.certification),
    controlState: result.controlState ?? {},
    eventId: result.eventId,
    duplicate: result.duplicate === true,
  };
}

export async function confirmPayrollFunding(input: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
  confirmedAmount: number;
  confirmationReference: string;
  accountReference?: string;
  note?: string;
}): Promise<{
  fundingConfirmation: PayrollFundingConfirmation;
  eventId: string;
  duplicate: boolean;
}> {
  const { data, error } = await sb.rpc('finance_payroll_confirm_funding_tx', {
    p_run_id: input.runId,
    p_actor_id: input.actorId,
    p_idempotency_key: input.idempotencyKey,
    p_confirmed_amount: input.confirmedAmount,
    p_confirmation_reference: input.confirmationReference,
    p_account_reference: input.accountReference ?? null,
    p_note: input.note ?? null,
  });
  if (error) throw payrollRpcHttpError(error);
  const result = (data ?? {}) as {
    fundingConfirmation?: DbFundingConfirmation;
    eventId?: string;
    duplicate?: boolean;
  };
  if (!result.fundingConfirmation || !result.eventId) {
    throw Object.assign(
      new Error('Funding confirmation committed but returned an invalid result.'),
      { status: 500 },
    );
  }
  return {
    fundingConfirmation: toFundingConfirmation(result.fundingConfirmation),
    eventId: result.eventId,
    duplicate: result.duplicate === true,
  };
}

export async function getPayrollReleasePreflight(
  runId: string,
): Promise<PayrollReleasePreflight> {
  const { data, error } = await sb.rpc('finance_payroll_release_preflight', {
    p_run_id: runId,
  });
  if (error) throw payrollRpcHttpError(error);
  return asPreflight(data);
}

export async function releasePayrollRun(input: {
  runId: string;
  actorId: string;
  idempotencyKey: string;
}): Promise<{
  runId: string;
  status: string;
  releaseCertificate: PayrollReleaseCertificate;
  disbursementId: string;
  remittances: Array<Record<string, unknown>>;
  eventId: string | null;
  duplicate: boolean;
}> {
  const { data, error } = await sb.rpc('finance_payroll_release_run_tx', {
    p_run_id: input.runId,
    p_actor_id: input.actorId,
    p_idempotency_key: input.idempotencyKey,
  });
  if (error) throw payrollRpcHttpError(error);
  const result = (data ?? {}) as {
    run?: { id?: string; status?: string };
    releaseCertificate?: DbReleaseCertificate;
    disbursement?: { id?: string };
    remittances?: Array<Record<string, unknown>>;
    eventId?: string;
    duplicate?: boolean;
  };
  if (!result.releaseCertificate) {
    throw Object.assign(
      new Error('Payroll release committed but returned an invalid certificate.'),
      { status: 500 },
    );
  }
  const releaseCertificate = toReleaseCertificate(result.releaseCertificate);
  return {
    runId: result.run?.id ?? releaseCertificate.runId,
    status: result.run?.status ?? 'released',
    releaseCertificate,
    disbursementId: result.disbursement?.id ?? releaseCertificate.disbursementId,
    remittances: result.remittances ?? [],
    eventId: result.eventId ?? null,
    duplicate: result.duplicate === true,
  };
}

export async function getPayrollReleaseCertificate(
  runId: string,
): Promise<PayrollReleaseCertificate | null> {
  const { data, error } = await sb
    .from('finance_payroll_release_certificates')
    .select('*')
    .eq('run_id', runId)
    .maybeSingle<DbReleaseCertificate>();
  if (error) {
    throw Object.assign(
      new Error(`getPayrollReleaseCertificate: ${error.message}`),
      { status: 500 },
    );
  }
  if (!data) return null;

  const { data: links, error: linkError } = await sb
    .from('finance_payroll_release_remittances')
    .select('remittance_id, authority, period_year, period_month')
    .eq('release_certificate_id', data.id)
    .order('period_year')
    .order('period_month')
    .order('authority');
  if (linkError) {
    throw Object.assign(
      new Error(`getPayrollReleaseCertificate/remittances: ${linkError.message}`),
      { status: 500 },
    );
  }
  return {
    ...toReleaseCertificate(data),
    remittances: (links ?? []).map(link => ({
      id: String(link.remittance_id),
      authority: String(link.authority),
      periodYear: Number(link.period_year),
      periodMonth: Number(link.period_month),
    })),
  };
}
