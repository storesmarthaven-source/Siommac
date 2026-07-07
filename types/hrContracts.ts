/**
 * types/hrContracts.ts
 *
 * The ONE shared camelCase DTO for HR Contract Management — imported by BOTH the
 * backend (netlify/functions/lib/hr/contracts*) and the frontend (src/api/hr/contracts).
 * Mirrors the schema in supabase/migrations/20260915000000_hr_contract_management.sql.
 *
 * Lifecycle: draft → pending_signature → active → (expired | terminated | superseded | cancelled).
 * Renewal/amendment chain via `parentContractId`. Optional link to the onboarding case.
 */

export type ContractType =
  | 'permanent' | 'fixed_term' | 'probation' | 'contractor' | 'temporary' | 'internship';

export type ContractStatus =
  | 'draft' | 'pending_signature' | 'active' | 'expired' | 'terminated' | 'superseded' | 'cancelled';

export type CompensationPeriod =
  | 'annual' | 'monthly' | 'fortnightly' | 'weekly' | 'daily' | 'hourly';

export type TemplateStatus = 'draft' | 'active' | 'retired';

export type SignatoryParty = 'employer' | 'employee' | 'witness' | 'guarantor';
export type SignatoryStatus = 'pending' | 'signed' | 'declined';
export type SignatureMethod = 'e_signature' | 'wet_signature' | 'uploaded';

export interface ContractClause { title: string; body: string; }

// ── Templates ───────────────────────────────────────────────────────────────
export interface ContractTemplate {
  id: string;
  templateKey: string;
  name: string;
  description: string | null;
  contractType: ContractType;
  workerTypes: string[];
  bodyTemplate: string;
  clauses: ContractClause[];
  defaultDurationMonths: number | null;
  probationMonths: number | null;
  status: TemplateStatus;
  versionNo: number;
  createdAt: string;
  updatedAt: string | null;
}

// ── Signatories ──────────────────────────────────────────────────────────────
export interface ContractSignatory {
  id: string;
  contractId: string;
  party: SignatoryParty;
  signatoryId: string | null;
  signatoryName: string;
  signatoryEmail: string | null;
  status: SignatoryStatus;
  signatureMethod: SignatureMethod | null;
  signedAt: string | null;
  declineReason: string | null;
}

// ── Contracts ────────────────────────────────────────────────────────────────
export interface Contract {
  id: string;
  contractNo: string;
  employeeId: string;
  /** Resolved from app_users — never expose a raw id where a name belongs. */
  employeeName: string | null;
  templateId: string | null;
  title: string;
  contractType: ContractType;
  startDate: string | null;
  endDate: string | null;
  probationEndDate: string | null;
  compensationAmount: number | null;
  compensationCurrency: string | null;
  compensationPeriod: CompensationPeriod | null;
  body: string;
  status: ContractStatus;
  issuedAt: string | null;
  activatedAt: string | null;
  terminatedAt: string | null;
  terminationReason: string | null;
  parentContractId: string | null;
  onboardingCaseId: string | null;
  metadata: Record<string, unknown>;
  createdAt: string;
  updatedAt: string | null;
}

/** A link in a contract's renewal/amendment chain (compact). */
export interface ContractChainLink {
  id: string;
  contractNo: string;
  status: ContractStatus;
  startDate: string | null;
  endDate: string | null;
}

export interface ContractDetail {
  contract: Contract;
  signatories: ContractSignatory[];
  template: ContractTemplate | null;
  /** Ancestors + descendants ordered oldest→newest (renewal history). */
  renewalChain: ContractChainLink[];
}

export interface ContractDashboardStats {
  total: number;
  draft: number;
  pendingSignature: number;
  active: number;
  /** Active contracts whose end_date is within the next 60 days. */
  expiringSoon: number;
  terminated: number;
  byType: Partial<Record<ContractType, number>>;
}

// ── Mutation args ────────────────────────────────────────────────────────────
export interface CreateContractSignatoryInput {
  party: SignatoryParty;
  signatoryId?: string | null;
  signatoryName: string;
  signatoryEmail?: string | null;
}

export interface CreateContractArgs {
  employeeId: string;
  templateId?: string | null;
  title: string;
  contractType: ContractType;
  startDate?: string | null;
  endDate?: string | null;
  probationEndDate?: string | null;
  compensationAmount?: number | null;
  compensationCurrency?: string | null;
  compensationPeriod?: CompensationPeriod | null;
  body?: string | null;
  onboardingCaseId?: string | null;
  signatories?: CreateContractSignatoryInput[];
}
export interface CreateContractResult { contractId: string; contractNo: string; status: ContractStatus; }

export interface IssueContractArgs { contractId: string; signatories?: CreateContractSignatoryInput[]; }
export interface RecordSignatureArgs {
  signatoryRowId: string;
  decision: 'signed' | 'declined';
  method?: SignatureMethod;
  declineReason?: string | null;
}
export interface RenewContractArgs {
  contractId: string;
  startDate?: string | null;
  endDate?: string | null;
  probationEndDate?: string | null;
  compensationAmount?: number | null;
  compensationCurrency?: string | null;
  compensationPeriod?: CompensationPeriod | null;
  title?: string | null;
}
export interface RenewContractResult { contractId: string; contractNo: string; parentContractId: string; }
export interface TerminateContractArgs { contractId: string; reason: string; effectiveDate?: string | null; }
export interface CancelContractArgs { contractId: string; reason?: string | null; }
export interface ContractLifecycleResult { contractId: string; status: ContractStatus; }

export interface CreateTemplateArgs {
  templateKey: string;
  name: string;
  description?: string | null;
  contractType: ContractType;
  workerTypes?: string[];
  bodyTemplate?: string;
  clauses?: ContractClause[];
  defaultDurationMonths?: number | null;
  probationMonths?: number | null;
}
export interface UpdateTemplateArgs extends Partial<CreateTemplateArgs> { templateId: string; }

export interface ExpireContractsResult { expired: number; contractNos: string[]; }
