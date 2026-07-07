// lib/hr/contractsQueries.ts — HR Contract Management read side.
// Maps snake_case rows → the shared camelCase DTO (types/hrContracts). Employee
// ids are resolved to names here (never surfaced raw). THROWS on DB error.

import { sb } from '../db';
import type {
  Contract, ContractTemplate, ContractSignatory, ContractDetail, ContractChainLink,
  ContractDashboardStats, ContractType, ContractStatus,
} from '../../../../types/hrContracts';

const httpErr = (msg: string, status = 500): Error & { status: number } => Object.assign(new Error(msg), { status });

// ── row shapes ────────────────────────────────────────────────────────────────
interface TemplateRow {
  id: string; template_key: string; name: string; description: string | null; contract_type: string;
  worker_types: string[] | null; body_template: string; clauses: unknown; default_duration_months: number | null;
  probation_months: number | null; status: string; version_no: number; created_at: string; updated_at: string | null;
}
interface ContractDbRow {
  id: string; contract_no: string; employee_id: string; template_id: string | null; title: string;
  contract_type: string; start_date: string | null; end_date: string | null; probation_end_date: string | null;
  compensation_amount: string | number | null; compensation_currency: string | null; compensation_period: string | null;
  body: string; status: string; issued_at: string | null; activated_at: string | null; terminated_at: string | null;
  termination_reason: string | null; parent_contract_id: string | null; onboarding_case_id: string | null;
  metadata: Record<string, unknown> | null; created_at: string; updated_at: string | null;
}
interface SignatoryRow {
  id: string; contract_id: string; party: string; signatory_id: string | null; signatory_name: string;
  signatory_email: string | null; status: string; signature_method: string | null; signed_at: string | null; decline_reason: string | null;
}

const CONTRACT_COLS =
  'id, contract_no, employee_id, template_id, title, contract_type, start_date, end_date, probation_end_date, ' +
  'compensation_amount, compensation_currency, compensation_period, body, status, issued_at, activated_at, ' +
  'terminated_at, termination_reason, parent_contract_id, onboarding_case_id, metadata, created_at, updated_at';

// ── mappers ───────────────────────────────────────────────────────────────────
function mapTemplate(r: TemplateRow): ContractTemplate {
  return {
    id: r.id, templateKey: r.template_key, name: r.name, description: r.description,
    contractType: r.contract_type as ContractType, workerTypes: r.worker_types ?? [],
    bodyTemplate: r.body_template, clauses: Array.isArray(r.clauses) ? r.clauses as ContractTemplate['clauses'] : [],
    defaultDurationMonths: r.default_duration_months, probationMonths: r.probation_months,
    status: r.status as ContractTemplate['status'], versionNo: r.version_no, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapContract(r: ContractDbRow, names: Map<string, string | null>): Contract {
  return {
    id: r.id, contractNo: r.contract_no, employeeId: r.employee_id, employeeName: names.get(r.employee_id) ?? null,
    templateId: r.template_id, title: r.title, contractType: r.contract_type as ContractType,
    startDate: r.start_date, endDate: r.end_date, probationEndDate: r.probation_end_date,
    compensationAmount: r.compensation_amount == null ? null : Number(r.compensation_amount),
    compensationCurrency: r.compensation_currency, compensationPeriod: r.compensation_period as Contract['compensationPeriod'],
    body: r.body, status: r.status as ContractStatus, issuedAt: r.issued_at, activatedAt: r.activated_at,
    terminatedAt: r.terminated_at, terminationReason: r.termination_reason, parentContractId: r.parent_contract_id,
    onboardingCaseId: r.onboarding_case_id, metadata: r.metadata ?? {}, createdAt: r.created_at, updatedAt: r.updated_at,
  };
}
function mapSignatory(r: SignatoryRow): ContractSignatory {
  return {
    id: r.id, contractId: r.contract_id, party: r.party as ContractSignatory['party'], signatoryId: r.signatory_id,
    signatoryName: r.signatory_name, signatoryEmail: r.signatory_email, status: r.status as ContractSignatory['status'],
    signatureMethod: r.signature_method as ContractSignatory['signatureMethod'], signedAt: r.signed_at, declineReason: r.decline_reason,
  };
}

async function resolveNames(ids: string[]): Promise<Map<string, string | null>> {
  const uniq = [...new Set(ids)].filter(Boolean);
  if (!uniq.length) return new Map();
  const { data } = await sb.from('app_users').select('id, full_name').in('id', uniq);
  return new Map(((data ?? []) as { id: string; full_name: string | null }[]).map(u => [u.id, u.full_name]));
}

// ── queries ───────────────────────────────────────────────────────────────────
export async function listTemplates(opts: { status?: string; contractType?: string } = {}): Promise<ContractTemplate[]> {
  let q = sb.from('hr_contract_templates').select('*').order('name');
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.contractType) q = q.eq('contract_type', opts.contractType);
  const { data, error } = await q;
  if (error) throw httpErr(error.message);
  return (data as TemplateRow[]).map(mapTemplate);
}

export async function listContracts(opts: { status?: string; employeeId?: string; contractType?: string } = {}): Promise<Contract[]> {
  let q = sb.from('hr_contracts').select(CONTRACT_COLS).order('created_at', { ascending: false });
  if (opts.status) q = q.eq('status', opts.status);
  if (opts.employeeId) q = q.eq('employee_id', opts.employeeId);
  if (opts.contractType) q = q.eq('contract_type', opts.contractType);
  const { data, error } = await q;
  if (error) throw httpErr(error.message);
  const rows = data as unknown as ContractDbRow[];
  const names = await resolveNames(rows.map(r => r.employee_id));
  return rows.map(r => mapContract(r, names));
}

export async function getContractDetail(contractId: string): Promise<ContractDetail | null> {
  const { data: row, error } = await sb.from('hr_contracts').select(CONTRACT_COLS).eq('id', contractId).maybeSingle<ContractDbRow>();
  if (error) throw httpErr(error.message);
  if (!row) return null;

  const names = await resolveNames([row.employee_id]);
  const contract = mapContract(row, names);

  const [{ data: sigs }, tpl, chain] = await Promise.all([
    sb.from('hr_contract_signatories').select('*').eq('contract_id', contractId).order('party'),
    row.template_id
      ? sb.from('hr_contract_templates').select('*').eq('id', row.template_id).maybeSingle<TemplateRow>().then(r => r.data ? mapTemplate(r.data) : null)
      : Promise.resolve(null),
    loadRenewalChain(row.employee_id, contractId),
  ]);

  return {
    contract,
    signatories: (sigs as SignatoryRow[] ?? []).map(mapSignatory),
    template: tpl,
    renewalChain: chain,
  };
}

/** The connected renewal/amendment chain containing `contractId`, ordered oldest→newest. */
async function loadRenewalChain(employeeId: string, contractId: string): Promise<ContractChainLink[]> {
  const { data } = await sb.from('hr_contracts')
    .select('id, contract_no, status, start_date, end_date, parent_contract_id, created_at')
    .eq('employee_id', employeeId);
  const all = (data ?? []) as Array<{ id: string; contract_no: string; status: string; start_date: string | null; end_date: string | null; parent_contract_id: string | null; created_at: string }>;
  if (all.length <= 1) return [];
  const byId = new Map(all.map(r => [r.id, r]));
  const children = new Map<string, string[]>();
  for (const r of all) if (r.parent_contract_id) children.set(r.parent_contract_id, [...(children.get(r.parent_contract_id) ?? []), r.id]);

  // Collect the connected component reachable via parent + child edges.
  const seen = new Set<string>(); const stack = [contractId];
  while (stack.length) {
    const id = stack.pop()!;
    if (seen.has(id) || !byId.has(id)) continue;
    seen.add(id);
    const node = byId.get(id)!;
    if (node.parent_contract_id) stack.push(node.parent_contract_id);
    for (const ch of children.get(id) ?? []) stack.push(ch);
  }
  if (seen.size <= 1) return [];
  return [...seen].map(id => byId.get(id)!)
    .sort((a, b) => (a.start_date ?? a.created_at).localeCompare(b.start_date ?? b.created_at))
    .map(r => ({ id: r.id, contractNo: r.contract_no, status: r.status as ContractStatus, startDate: r.start_date, endDate: r.end_date }));
}

export async function getContractDashboardStats(): Promise<ContractDashboardStats> {
  const { data, error } = await sb.from('hr_contracts').select('status, contract_type, end_date');
  if (error) throw httpErr(error.message);
  const rows = (data ?? []) as { status: string; contract_type: string; end_date: string | null }[];
  const soon = new Date(); soon.setDate(soon.getDate() + 60);
  const soonIso = soon.toISOString().slice(0, 10);
  const today = new Date().toISOString().slice(0, 10);

  const byType: Partial<Record<ContractType, number>> = {};
  let draft = 0, pendingSignature = 0, active = 0, expiringSoon = 0, terminated = 0;
  for (const r of rows) {
    byType[r.contract_type as ContractType] = (byType[r.contract_type as ContractType] ?? 0) + 1;
    if (r.status === 'draft') draft++;
    else if (r.status === 'pending_signature') pendingSignature++;
    else if (r.status === 'active') { active++; if (r.end_date && r.end_date >= today && r.end_date <= soonIso) expiringSoon++; }
    else if (r.status === 'terminated') terminated++;
  }
  return { total: rows.length, draft, pendingSignature, active, expiringSoon, terminated, byType };
}
