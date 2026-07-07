// lib/hr/contractsService.ts — HR Contract Management lifecycle mutations.
//
// draft → pending_signature → active → (expired | terminated | superseded | cancelled).
// Renewal/amendment chain via parent_contract_id. Every mutation routes through
// runModuleMutation (idempotent; emits app_events + notifications; tracked in
// module_mutation_runs) and writes an HR audit row. Compensating rollback on
// satellite-insert failure — never a silent swallow. THROWS on failure; errors
// carry a `status` for the route layer. Distinct from HSE Contractors.

import { sb }                from '../db';
import { emitAppEvent }      from '../appEvents';
import { nextRef }           from '../refGenerator';
import { runModuleMutation } from '../moduleServiceAdapter';
import { writeHrAudit }      from './employeeCore';
import type {
  CreateContractArgs, CreateContractResult, IssueContractArgs, RecordSignatureArgs,
  RenewContractArgs, RenewContractResult, TerminateContractArgs, CancelContractArgs,
  ContractLifecycleResult, CreateTemplateArgs, UpdateTemplateArgs, ExpireContractsResult,
  CreateContractSignatoryInput, ContractStatus,
} from '../../../../types/hrContracts';

const httpErr = (msg: string, status = 500): Error & { status: number } =>
  Object.assign(new Error(msg), { status });
const nowIso = (): string => new Date().toISOString();

interface EmpRow { id: string; full_name: string | null }
async function loadEmployee(employeeId: string): Promise<EmpRow> {
  const { data } = await sb.from('app_users').select('id, full_name').eq('id', employeeId).maybeSingle<EmpRow>();
  if (!data) throw httpErr('Employee not found.', 404);
  return data;
}

interface ContractRow {
  id: string; contract_no: string; employee_id: string; template_id: string | null;
  contract_type: string; title: string; body: string; status: ContractStatus;
  start_date: string | null; end_date: string | null; parent_contract_id: string | null;
}
async function loadContract(contractId: string): Promise<ContractRow> {
  const { data } = await sb.from('hr_contracts')
    .select('id, contract_no, employee_id, template_id, contract_type, title, body, status, start_date, end_date, parent_contract_id')
    .eq('id', contractId).maybeSingle<ContractRow>();
  if (!data) throw httpErr('Contract not found.', 404);
  return data;
}

/** Fill {{placeholders}} from the known context; unknown tokens are left intact. */
function renderBody(tpl: string, ctx: Record<string, string>): string {
  return tpl.replace(/\{\{\s*([a-z_]+)\s*\}\}/gi, (m, key: string) => ctx[key.toLowerCase()] ?? m);
}

function defaultSignatories(emp: EmpRow, provided?: CreateContractSignatoryInput[]): CreateContractSignatoryInput[] {
  if (provided && provided.length) return provided;
  return [
    { party: 'employer', signatoryName: 'Authorised HR representative' },
    { party: 'employee', signatoryId: emp.id, signatoryName: emp.full_name ?? emp.id },
  ];
}
async function insertSignatories(contractId: string, sigs: CreateContractSignatoryInput[]): Promise<void> {
  if (!sigs.length) return;
  const { error } = await sb.from('hr_contract_signatories').insert(sigs.map(s => ({
    contract_id: contractId, party: s.party, signatory_id: s.signatoryId ?? null,
    signatory_name: s.signatoryName, signatory_email: s.signatoryEmail ?? null, status: 'pending',
  })));
  if (error) throw httpErr(error.message);
}

// ── Create (draft) ────────────────────────────────────────────────────────────
export async function createContract(actorId: string, args: CreateContractArgs): Promise<CreateContractResult> {
  const emp = await loadEmployee(args.employeeId);
  if (!args.title?.trim()) throw httpErr('A contract title is required.', 400);

  let body = args.body ?? '';
  if (args.templateId && !args.body) {
    const { data: tpl } = await sb.from('hr_contract_templates')
      .select('body_template').eq('id', args.templateId).maybeSingle<{ body_template: string }>();
    if (tpl?.body_template) body = renderBody(tpl.body_template, {
      employee_name: emp.full_name ?? emp.id, contractor_name: emp.full_name ?? emp.id,
      job_title: args.title.trim(), company_name: 'SIOMAC',
      start_date: args.startDate ?? '', end_date: args.endDate ?? '',
    });
  }
  const sigs = defaultSignatories(emp, args.signatories);

  const result = await runModuleMutation<{ id: string; contractNo: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'create', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.create:${args.employeeId}:${args.title.trim()}:${args.startDate ?? 'na'}`,
      eventType: 'hr.contract.created', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.contractNo }),
      buildEventPayload: (r) => ({ employeeId: emp.id, contractType: args.contractType, contractNo: r.contractNo }),
    },
    writeRecord: async () => {
      const contractNo = await nextRef('CTR');
      const { data: row, error } = await sb.from('hr_contracts').insert({
        contract_no: contractNo, employee_id: emp.id, template_id: args.templateId ?? null,
        title: args.title.trim(), contract_type: args.contractType,
        start_date: args.startDate ?? null, end_date: args.endDate ?? null, probation_end_date: args.probationEndDate ?? null,
        compensation_amount: args.compensationAmount ?? null, compensation_currency: args.compensationCurrency ?? 'TTD',
        compensation_period: args.compensationPeriod ?? 'annual', body, status: 'draft',
        onboarding_case_id: args.onboardingCaseId ?? null, created_by: actorId,
      }).select('id, contract_no').single<{ id: string; contract_no: string }>();
      if (error) throw httpErr(error.message);

      try { await insertSignatories(row.id, sigs); }
      catch (e) { await sb.from('hr_contracts').delete().eq('id', row.id); throw e; }

      await writeHrAudit({ employeeId: emp.id, submoduleKey: 'contracts', recordId: row.id, actorId,
        action: 'hr.contract.created', newState: { contractNo, title: args.title.trim(), contractType: args.contractType } });
      return { id: row.id, contractNo: row.contract_no };
    },
  });
  return { contractId: result.entityId, contractNo: result.record.contractNo, status: 'draft' };
}

// ── Issue (draft → pending_signature) ──────────────────────────────────────────
export async function issueContract(actorId: string, args: IssueContractArgs): Promise<ContractLifecycleResult> {
  const c = await loadContract(args.contractId);
  if (c.status !== 'draft') throw httpErr(`Only a draft contract can be issued (this one is ${c.status}).`, 409);

  await runModuleMutation<{ id: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'submit', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.issue:${c.id}`,
      eventType: 'hr.contract.issued', eventSeverity: 'info',
      notification: { title: `Contract ${c.contract_no} awaiting your signature`, body: c.title, actionRoute: 's-hr-contracts', actionRequired: true, type: 'contract' },
      explicitRecipients: [{ userId: c.employee_id, reason: 'owner' }],
      getEntityIdentity: () => ({ id: c.id, ref: c.contract_no }),
    },
    writeRecord: async () => {
      if (args.signatories?.length) await insertSignatories(c.id, args.signatories);
      const { error } = await sb.from('hr_contracts')
        .update({ status: 'pending_signature', issued_at: nowIso(), issued_by: actorId }).eq('id', c.id);
      if (error) throw httpErr(error.message);
      await writeHrAudit({ employeeId: c.employee_id, submoduleKey: 'contracts', recordId: c.id, actorId,
        action: 'hr.contract.issued', newState: { status: 'pending_signature' } });
      return { id: c.id };
    },
  });
  return { contractId: c.id, status: 'pending_signature' };
}

// ── Record a signature (may auto-activate when all parties have signed) ─────────
export async function recordSignature(actorId: string, args: RecordSignatureArgs): Promise<{ signatoryRowId: string; status: string; contractStatus: ContractStatus }> {
  const { data: sig } = await sb.from('hr_contract_signatories')
    .select('id, contract_id, party, status').eq('id', args.signatoryRowId)
    .maybeSingle<{ id: string; contract_id: string; party: string; status: string }>();
  if (!sig) throw httpErr('Signatory not found.', 404);
  const c = await loadContract(sig.contract_id);
  if (c.status !== 'pending_signature') throw httpErr(`Signatures can only be recorded while a contract is pending signature (this one is ${c.status}).`, 409);
  if (args.decision === 'declined' && !args.declineReason?.trim()) throw httpErr('A reason is required to decline.', 400);

  const result = await runModuleMutation<{ contractStatus: ContractStatus }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'update', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.sign:${sig.id}:${args.decision}`,
      eventType: args.decision === 'signed' ? 'hr.contract.signed' : 'hr.contract.sign_declined',
      eventSeverity: args.decision === 'signed' ? 'info' : 'warning',
      getEntityIdentity: () => ({ id: c.id, ref: c.contract_no }),
      buildEventPayload: () => ({ party: sig.party, decision: args.decision }),
    },
    writeRecord: async () => {
      const { error } = await sb.from('hr_contract_signatories').update({
        status: args.decision, signature_method: args.method ?? 'e_signature',
        signed_at: args.decision === 'signed' ? nowIso() : null,
        decline_reason: args.decision === 'declined' ? (args.declineReason ?? null) : null,
      }).eq('id', sig.id);
      if (error) throw httpErr(error.message);

      // All signatories signed → activate.
      let contractStatus: ContractStatus = c.status;
      if (args.decision === 'signed') {
        const { data: remaining } = await sb.from('hr_contract_signatories')
          .select('id').eq('contract_id', c.id).neq('status', 'signed');
        if ((remaining ?? []).length === 0) {
          await activateContractInternal(actorId, c);
          contractStatus = 'active';
        }
      }
      await writeHrAudit({ employeeId: c.employee_id, submoduleKey: 'contracts', recordId: c.id, actorId,
        action: `hr.contract.${args.decision}`, newState: { party: sig.party } });
      return { contractStatus };
    },
  });
  return { signatoryRowId: sig.id, status: args.decision, contractStatus: result.record.contractStatus };
}

/** Set a contract active; supersede its parent (renewal chain) if the parent is still active. */
async function activateContractInternal(actorId: string, c: ContractRow): Promise<void> {
  const { error } = await sb.from('hr_contracts').update({ status: 'active', activated_at: nowIso() }).eq('id', c.id);
  if (error) throw httpErr(error.message);
  if (c.parent_contract_id) {
    await sb.from('hr_contracts').update({ status: 'superseded' }).eq('id', c.parent_contract_id).eq('status', 'active');
  }
  await writeHrAudit({ employeeId: c.employee_id, submoduleKey: 'contracts', recordId: c.id, actorId,
    action: 'hr.contract.activated', newState: { status: 'active' } });
}

// ── Activate (pending_signature → active), explicit (wet/uploaded signatures) ───
export async function activateContract(actorId: string, args: { contractId: string }): Promise<ContractLifecycleResult> {
  const c = await loadContract(args.contractId);
  if (c.status !== 'pending_signature') throw httpErr(`Only a pending-signature contract can be activated (this one is ${c.status}).`, 409);

  await runModuleMutation<{ id: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'approve', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.activate:${c.id}`,
      eventType: 'hr.contract.activated', eventSeverity: 'info',
      notification: { title: `Your contract ${c.contract_no} is now active`, body: c.title, actionRoute: 's-hr-contracts', type: 'contract' },
      explicitRecipients: [{ userId: c.employee_id, reason: 'owner' }],
      getEntityIdentity: () => ({ id: c.id, ref: c.contract_no }),
    },
    writeRecord: async () => { await activateContractInternal(actorId, c); return { id: c.id }; },
  });
  return { contractId: c.id, status: 'active' };
}

// ── Renew (create a linked successor draft) ─────────────────────────────────────
export async function renewContract(actorId: string, args: RenewContractArgs): Promise<RenewContractResult> {
  const src = await loadContract(args.contractId);
  if (!['active', 'expired', 'pending_signature'].includes(src.status))
    throw httpErr(`Only an active, pending or expired contract can be renewed (this one is ${src.status}).`, 409);

  const result = await runModuleMutation<{ id: string; contractNo: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'create', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.renew:${src.id}`,
      eventType: 'hr.contract.renewed', eventSeverity: 'info',
      getEntityIdentity: (r) => ({ id: r.id, ref: r.contractNo }),
      buildEventPayload: (r) => ({ parentContractId: src.id, contractNo: r.contractNo }),
    },
    writeRecord: async () => {
      const emp = await loadEmployee(src.employee_id);
      const contractNo = await nextRef('CTR');
      const { data: row, error } = await sb.from('hr_contracts').insert({
        contract_no: contractNo, employee_id: src.employee_id, template_id: src.template_id,
        title: (args.title ?? src.title).trim(), contract_type: src.contract_type,
        start_date: args.startDate ?? null, end_date: args.endDate ?? null, probation_end_date: args.probationEndDate ?? null,
        compensation_amount: args.compensationAmount ?? null, compensation_currency: args.compensationCurrency ?? 'TTD',
        compensation_period: args.compensationPeriod ?? 'annual', body: src.body, status: 'draft',
        parent_contract_id: src.id, created_by: actorId,
      }).select('id, contract_no').single<{ id: string; contract_no: string }>();
      if (error) throw httpErr(error.message);
      try { await insertSignatories(row.id, defaultSignatories(emp)); }
      catch (e) { await sb.from('hr_contracts').delete().eq('id', row.id); throw e; }
      await writeHrAudit({ employeeId: src.employee_id, submoduleKey: 'contracts', recordId: row.id, actorId,
        action: 'hr.contract.renewed', newState: { contractNo, parentContractId: src.id } });
      return { id: row.id, contractNo: row.contract_no };
    },
  });
  return { contractId: result.entityId, contractNo: result.record.contractNo, parentContractId: src.id };
}

// ── Terminate (active → terminated) ─────────────────────────────────────────────
export async function terminateContract(actorId: string, args: TerminateContractArgs): Promise<ContractLifecycleResult> {
  const c = await loadContract(args.contractId);
  if (c.status !== 'active') throw httpErr(`Only an active contract can be terminated (this one is ${c.status}).`, 409);
  if (!args.reason?.trim()) throw httpErr('A termination reason is required.', 400);

  await runModuleMutation<{ id: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'close', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.terminate:${c.id}`,
      eventType: 'hr.contract.terminated', eventSeverity: 'warning',
      notification: { title: `Contract ${c.contract_no} terminated`, body: args.reason.trim(), actionRoute: 's-hr-contracts', type: 'contract' },
      explicitRecipients: [{ userId: c.employee_id, reason: 'owner' }],
      getEntityIdentity: () => ({ id: c.id, ref: c.contract_no }),
    },
    writeRecord: async () => {
      const { error } = await sb.from('hr_contracts').update({
        status: 'terminated', terminated_at: args.effectiveDate ?? nowIso(),
        termination_reason: args.reason.trim(), terminated_by: actorId,
      }).eq('id', c.id);
      if (error) throw httpErr(error.message);
      await writeHrAudit({ employeeId: c.employee_id, submoduleKey: 'contracts', recordId: c.id, actorId,
        action: 'hr.contract.terminated', newState: { status: 'terminated', reason: args.reason.trim() } });
      return { id: c.id };
    },
  });
  return { contractId: c.id, status: 'terminated' };
}

// ── Cancel (draft | pending_signature → cancelled) ──────────────────────────────
export async function cancelContract(actorId: string, args: CancelContractArgs): Promise<ContractLifecycleResult> {
  const c = await loadContract(args.contractId);
  if (!['draft', 'pending_signature'].includes(c.status))
    throw httpErr(`Only a draft or pending contract can be cancelled (this one is ${c.status}).`, 409);

  await runModuleMutation<{ id: string }>({
    context: { actorUserId: actorId },
    options: {
      module: 'hr', operation: 'cancel', entityType: 'hr_contract',
      idempotencyKey: `hr.contract.cancel:${c.id}`,
      eventType: 'hr.contract.cancelled', eventSeverity: 'info',
      getEntityIdentity: () => ({ id: c.id, ref: c.contract_no }),
    },
    writeRecord: async () => {
      const { error } = await sb.from('hr_contracts').update({ status: 'cancelled' }).eq('id', c.id);
      if (error) throw httpErr(error.message);
      await writeHrAudit({ employeeId: c.employee_id, submoduleKey: 'contracts', recordId: c.id, actorId,
        action: 'hr.contract.cancelled', newState: { status: 'cancelled', reason: args.reason?.trim() ?? null } });
      return { id: c.id };
    },
  });
  return { contractId: c.id, status: 'cancelled' };
}

// ── Expiry sweep (active with end_date < today → expired) ───────────────────────
export async function expireContracts(actorId: string): Promise<ExpireContractsResult> {
  const today = nowIso().slice(0, 10);
  const { data: due } = await sb.from('hr_contracts')
    .select('id, contract_no, employee_id').eq('status', 'active').lt('end_date', today);
  const rows = (due ?? []) as { id: string; contract_no: string; employee_id: string }[];
  if (!rows.length) return { expired: 0, contractNos: [] };

  const ids = rows.map(r => r.id);
  const { error } = await sb.from('hr_contracts').update({ status: 'expired' }).in('id', ids);
  if (error) throw httpErr(error.message);

  for (const r of rows) {
    void emitAppEvent({
      eventType: 'hr.contract.expired', sourceModule: 'hr', sourceEntityType: 'hr_contract',
      sourceEntityId: r.id, actorUserId: actorId, severity: 'warning',
      payload: { contractNo: r.contract_no, employeeId: r.employee_id },
    });
    await writeHrAudit({ employeeId: r.employee_id, submoduleKey: 'contracts', recordId: r.id, actorId,
      action: 'hr.contract.expired', newState: { status: 'expired' } });
  }
  return { expired: rows.length, contractNos: rows.map(r => r.contract_no) };
}

// ── Templates (config CRUD) ─────────────────────────────────────────────────────
export async function createTemplate(actorId: string, args: CreateTemplateArgs): Promise<{ templateId: string; templateKey: string }> {
  if (!args.templateKey?.trim() || !args.name?.trim()) throw httpErr('Template key and name are required.', 400);
  const { data, error } = await sb.from('hr_contract_templates').insert({
    template_key: args.templateKey.trim(), name: args.name.trim(), description: args.description ?? null,
    contract_type: args.contractType, worker_types: args.workerTypes ?? [], body_template: args.bodyTemplate ?? '',
    clauses: args.clauses ?? [], default_duration_months: args.defaultDurationMonths ?? null,
    probation_months: args.probationMonths ?? null, status: 'active', created_by: actorId,
  }).select('id, template_key').single<{ id: string; template_key: string }>();
  if (error) throw httpErr(error.message.includes('duplicate') ? 'A template with that key already exists.' : error.message, 409);
  void emitAppEvent({ eventType: 'hr.contract_template.created', sourceModule: 'hr', sourceEntityType: 'hr_contract_template',
    sourceEntityId: data.id, actorUserId: actorId, severity: 'info', payload: { templateKey: data.template_key } });
  return { templateId: data.id, templateKey: data.template_key };
}

export async function updateTemplate(actorId: string, args: UpdateTemplateArgs): Promise<{ templateId: string }> {
  const patch: Record<string, unknown> = {};
  if (args.name !== undefined) patch.name = args.name?.trim();
  if (args.description !== undefined) patch.description = args.description;
  if (args.contractType !== undefined) patch.contract_type = args.contractType;
  if (args.workerTypes !== undefined) patch.worker_types = args.workerTypes;
  if (args.bodyTemplate !== undefined) patch.body_template = args.bodyTemplate;
  if (args.clauses !== undefined) patch.clauses = args.clauses;
  if (args.defaultDurationMonths !== undefined) patch.default_duration_months = args.defaultDurationMonths;
  if (args.probationMonths !== undefined) patch.probation_months = args.probationMonths;
  if (!Object.keys(patch).length) return { templateId: args.templateId };
  const { error } = await sb.from('hr_contract_templates').update(patch).eq('id', args.templateId);
  if (error) throw httpErr(error.message);
  void emitAppEvent({ eventType: 'hr.contract_template.updated', sourceModule: 'hr', sourceEntityType: 'hr_contract_template',
    sourceEntityId: args.templateId, actorUserId: actorId, severity: 'info', payload: {} });
  return { templateId: args.templateId };
}

export async function retireTemplate(actorId: string, args: { templateId: string }): Promise<{ templateId: string; status: 'retired' }> {
  const { error } = await sb.from('hr_contract_templates').update({ status: 'retired' }).eq('id', args.templateId);
  if (error) throw httpErr(error.message);
  void emitAppEvent({ eventType: 'hr.contract_template.retired', sourceModule: 'hr', sourceEntityType: 'hr_contract_template',
    sourceEntityId: args.templateId, actorUserId: actorId, severity: 'info', payload: {} });
  return { templateId: args.templateId, status: 'retired' };
}
